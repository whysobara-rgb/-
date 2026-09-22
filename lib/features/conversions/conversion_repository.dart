import 'dart:convert';
import 'dart:math';
import 'package:flutter/foundation.dart';
import '../../core/config/app_config.dart';
import '../../core/network/api_client.dart';
import '../orders/order_models.dart';
import '../orders/order_repository.dart';
import 'conversion_models.dart';

class ConversionRepository {
  final OrderRepository session;
  final bool enabled;
  static final Set<String> _running = {};
  ConversionRepository(
    this.session, {
    this.enabled = AppConfig.conversionPreviewEnabled,
  });
  int get userId => session.userId;
  String get _scope => '${session.scope}_conversion';
  ApiClient get _api => session.api;
  static Future<ConversionRepository> forUser(int id) async =>
      ConversionRepository(await OrderRepository.forUser(id));

  Future<PendingConversion?> pending() async {
    final raw = await session.store.read(_scope);
    return raw == null ? null : PendingConversion.fromJson(jsonDecode(raw));
  }

  Future<void> _owner() async {
    if (object(await _api.get('/users/me'))['id'] != userId) {
      throw ApiException(statusCode: 401, message: '전환한 계정으로 다시 로그인해주세요');
    }
  }

  Future<void> _gate() async {
    if (kReleaseMode || !enabled) {
      throw ApiException(statusCode: 0, message: 'GP 전환 서비스를 준비하고 있습니다');
    }
    await _owner();
    final cap = object(await _api.get('/inventory-conversions/capabilities'));
    if (cap['enabled'] != true ||
        cap['contract'] != 'INVENTORY_CONVERSION_V1') {
      throw ApiException(statusCode: 0, message: '현재 서버에서 GP 전환을 준비하고 있습니다');
    }
  }

  Future<T> _exclusive<T>(Future<T> Function() action) async {
    if (!_running.add(_scope)) {
      throw ApiException(statusCode: 0, message: '이전 전환 요청을 확인하고 있습니다');
    }
    try {
      return await action();
    } finally {
      _running.remove(_scope);
    }
  }

  String _key() {
    final random = Random.secure();
    final b = List.generate(16, (_) => random.nextInt(256));
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    final h = b.map((v) => v.toRadixString(16).padLeft(2, '0')).join();
    return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-${h.substring(16, 20)}-${h.substring(20)}';
  }

  Future<ConversionQuote> quote(List<int> ids) async {
    final expected = conversionIds(ids);
    await _gate();
    final q = ConversionQuote(
      await _api.post(
        '/inventory-conversions/quote',
        body: {'inventoryItemIds': expected},
      ),
    );
    if (!listEquals(
      expected,
      conversionIds(q.entries.map((e) => e.inventoryId)),
    )) {
      invalidResponse();
    }
    return q;
  }

  Future<(List<ConversionReceipt>, int)> list(int page) async {
    positive(page);
    await _owner();
    final j = object(
      await _api.get('/inventory-conversions?page=$page&limit=20'),
    );
    if (j['page'] != page || j['limit'] != 20 || j['items'] is! List) {
      invalidResponse();
    }
    final rows = (j['items'] as List).map(ConversionReceipt.new).toList();
    if (rows.length > 20 ||
        rows.map((r) => r.id).toSet().length != rows.length) {
      invalidResponse();
    }
    return (rows, positive(j['totalCount'], zero: true));
  }

  Future<ConversionReceipt> detail(String id) async {
    final r = ConversionReceipt(
      await _api.get('/inventory-conversions/${uuid(id)}'),
    );
    if (r.id != id) invalidResponse();
    return r;
  }

  Future<ConversionReceipt> convert(ConversionQuote q) => _exclusive(() async {
    await _gate();
    if (await pending() != null) {
      throw ApiException(statusCode: 0, message: '이전 전환 결과를 먼저 확인해주세요');
    }
    final p = PendingConversion('convert', _key(), q.request);
    await session.store.write(_scope, jsonEncode(p.toJson()));
    return _send(p);
  });
  Future<ConversionReceipt> restore(String id) => _exclusive(() async {
    await _gate();
    if (await pending() != null) {
      throw ApiException(statusCode: 0, message: '이전 전환 결과를 먼저 확인해주세요');
    }
    final current = await detail(uuid(id));
    if (!current.canRestore) {
      throw ApiException(
        statusCode: 0,
        message: current.restoreReason ?? '복구할 수 없는 상품입니다',
      );
    }
    final p = PendingConversion('restore', _key(), {'conversionId': id});
    await session.store.write(_scope, jsonEncode(p.toJson()));
    return _send(p);
  });
  void _matches(PendingConversion p, ConversionReceipt r) {
    if (p.kind == 'convert') {
      if (r.total != p.body['expectedTotalGP'] ||
          !listEquals(
            conversionIds(r.entries.map((e) => e.inventoryId)),
            conversionIds((p.body['inventoryItemIds'] as List).cast<int>()),
          )) {
        invalidResponse();
      }
    } else if (r.id != p.body['conversionId']) {
      invalidResponse();
    }
  }

  Future<ConversionReceipt> _send(PendingConversion p) async {
    dynamic value;
    try {
      value = await _api.post(
        p.kind == 'convert'
            ? '/inventory-conversions'
            : '/inventory-conversions/${p.body['conversionId']}/restore',
        body: p.kind == 'convert' ? p.body : null,
        idempotencyKey: p.kind == 'convert' ? p.key : null,
      );
    } on ApiException catch (e) {
      // The idempotent server replays committed receipts before evaluating new
      // business rules. Only a definite business rejection releases this intent.
      if ({400, 404, 409}.contains(e.httpStatusCode) &&
          {10001, 10004, 10005}.contains(e.statusCode)) {
        await session.store.remove(_scope);
      }
      rethrow;
    }
    final r = ConversionReceipt(value);
    _matches(p, r);
    if (p.kind == 'restore' && !r.restored) invalidResponse();
    // Leave the intent until the user acknowledges a validated receipt.
    return r;
  }

  Future<ConversionReceipt?> recover() => _exclusive(() async {
    await _owner();
    final p = await pending();
    if (p == null) return null;
    ConversionReceipt r;
    if (p.kind == 'restore') {
      r = await detail(p.body['conversionId']);
      if (!r.restored) return null;
    } else {
      try {
        r = ConversionReceipt(
          await _api.get('/inventory-conversions/requests/${p.key}'),
        );
      } on ApiException catch (e) {
        if (e.httpStatusCode == 404 &&
            e.errors.contains('CONVERSION_REQUEST_NOT_FOUND')) {
          return null;
        }
        rethrow;
      }
    }
    _matches(p, r);
    return r;
  });
  Future<ConversionReceipt> retry() => _exclusive(() async {
    await _gate();
    final p = await pending();
    if (p == null) invalidResponse();
    return _send(p);
  });
  Future<void> acknowledge(ConversionReceipt r) => _exclusive(() async {
    await _owner();
    final p = await pending();
    if (p == null) return;
    _matches(p, r);
    if (p.kind == 'restore' && !r.restored) invalidResponse();
    await session.store.remove(_scope);
  });
}
