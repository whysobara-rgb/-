import 'dart:convert';
import 'dart:math';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../../core/config/app_config.dart';
import '../../core/network/api_client.dart';
import '../../core/network/token_storage.dart';
import 'order_models.dart';

abstract class OrderStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> remove(String key);
}

class SecureOrderStore implements OrderStore {
  final FlutterSecureStorage storage = const FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );
  @override
  Future<String?> read(String key) => storage.read(key: key);
  @override
  Future<void> write(String key, String value) =>
      storage.write(key: key, value: value);
  @override
  Future<void> remove(String key) => storage.delete(key: key);
}

class _SessionToken extends TokenStorage {
  final String token;
  _SessionToken(this.token);
  @override
  Future<String?> readToken() async => token;
}

class OrderRepository {
  final ApiClient api;
  final OrderStore store;
  final int userId;
  final String scope;
  final bool enabled;
  static final Set<String> _running = {};
  OrderRepository({
    required this.api,
    required this.store,
    required this.userId,
    required String server,
    this.enabled = AppConfig.orderPreviewEnabled,
  }) : scope = 'capsule_v1_${Uri.encodeComponent(server)}_$userId';
  static Future<OrderRepository> forUser(int userId) async {
    final token = await const TokenStorage().readToken();
    if (token == null || token.isEmpty)
      throw ApiException(statusCode: 401, message: '다시 로그인해주세요');
    return OrderRepository(
      api: ApiClient(tokenStorage: _SessionToken(token)),
      store: SecureOrderStore(),
      userId: userId,
      server: AppConfig.apiBaseUrl,
    );
  }

  String get _purchaseKey => '${scope}_purchase';
  String get _openingKey => '${scope}_opening';
  Future<PendingPurchase?> pendingPurchase() async {
    final raw = await store.read(_purchaseKey);
    return raw == null ? null : PendingPurchase.fromJson(jsonDecode(raw));
  }

  Future<String?> pendingOpening() async {
    final raw = await store.read(_openingKey);
    return raw == null ? null : uuid(raw);
  }

  Future<void> _owner() async {
    if (object(await api.get('/users/me'))['id'] != userId)
      throw ApiException(statusCode: 401, message: '구매한 계정으로 다시 로그인해주세요');
  }

  void _gate() {
    if (kReleaseMode || !enabled)
      throw ApiException(statusCode: 0, message: '현재 서비스를 준비하고 있습니다');
  }

  Future<T> _exclusive<T>(Future<T> Function() work) async {
    if (!_running.add(scope))
      throw ApiException(statusCode: 0, message: '이전 요청을 확인하고 있습니다');
    try {
      return await work();
    } finally {
      _running.remove(scope);
    }
  }

  String _newKey() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }

  Future<Odds> odds(int id) async {
    final result = Odds(await api.get('/gachas/${positive(id)}/odds'));
    if (result.gachaId != id) invalidResponse();
    return result;
  }

  Future<Receipt> purchase(
    Odds odds,
    int quantity,
    String title,
  ) => _exclusive(() async {
    _gate();
    await _owner();
    if (await pendingPurchase() != null)
      throw ApiException(statusCode: 0, message: '이전 구매 결과를 먼저 확인해주세요');
    final pending = PendingPurchase(_newKey(), title, {
      'gachaId': odds.gachaId,
      'quantity': quantity,
      'expectedUnitPrice': odds.price,
      'expectedProbabilityVersion': odds.version,
    });
    // Save before the first network mutation. A storage error means no purchase.
    await store.write(_purchaseKey, jsonEncode(pending.toJson()));
    return _sendPurchase(pending);
  });
  Future<Receipt> retryPurchase() => _exclusive(() async {
    _gate();
    await _owner();
    final pending = await pendingPurchase();
    if (pending == null) invalidResponse();
    return _sendPurchase(pending);
  });
  Future<Receipt> _sendPurchase(PendingPurchase pending) async {
    dynamic data;
    try {
      data = await api.post(
        '/orders/gp',
        body: pending.body,
        idempotencyKey: pending.key,
      );
    } on ApiException catch (e) {
      // A well-formed business rejection from this endpoint means no new debit.
      // Transport/5xx/401/503 and malformed success remain recoverable with the same key.
      if ({400, 404, 409}.contains(e.httpStatusCode) &&
          ({10001, 10004, 10006}.contains(e.statusCode) ||
              (e.statusCode == 10005 && e.errors.contains('ORDER_REJECTED'))))
        await store.remove(_purchaseKey);
      rethrow;
    }
    final receipt = Receipt(data);
    if (receipt.gachaId != pending.body['gachaId'] ||
        receipt.quantity != pending.body['quantity'] ||
        receipt.unitPrice != pending.body['expectedUnitPrice'] ||
        receipt.version != pending.body['expectedProbabilityVersion'])
      invalidResponse();
    await store.remove(_purchaseKey);
    return receipt;
  }

  Future<Receipt> order(String id) async {
    final result = Receipt(await api.get('/orders/${uuid(id)}'));
    if (result.id != id) invalidResponse();
    return result;
  }

  Future<(List<Capsule>, int)> capsules(int page) async {
    final data = object(
      await api.get('/capsules?page=${positive(page)}&limit=20'),
    );
    final items = (data['items'] as List).map(Capsule.new).toList();
    if (items.length > 20 ||
        items.any((c) => c.status != 'UNOPENED') ||
        data['page'] != page ||
        data['limit'] != 20)
      invalidResponse();
    return (items, positive(data['totalCount'], zero: true));
  }

  Future<Opening> open(String id) => _exclusive(() async {
    _gate();
    uuid(id);
    await _owner();
    final pending = await pendingOpening();
    if (pending != null && pending != id)
      throw ApiException(statusCode: 0, message: '이전 개봉 결과를 먼저 확인해주세요');
    await store.write(_openingKey, id);
    final result = Opening(await api.post('/capsules/$id/open'));
    if (result.capsuleId != id) invalidResponse();
    return result;
  });
  Future<Opening> result(String id) async {
    final result = Opening(await api.get('/capsules/${uuid(id)}/result'));
    if (result.capsuleId != id) invalidResponse();
    return result;
  }

  Future<void> acknowledgeOpening(String id) => _exclusive(() async {
    if (await pendingOpening() == id) await store.remove(_openingKey);
  });
}
