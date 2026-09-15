import 'dart:convert';
import 'dart:math';
import 'package:flutter/foundation.dart';
import '../../core/config/app_config.dart';
import '../../core/network/api_client.dart';
import '../../shared/data/activity_page.dart';
import '../orders/order_models.dart' show object, uuid;
import '../orders/order_repository.dart';
import 'domain/shipping_request.dart';

const recipientFields = [
  'name',
  'phone',
  'postalCode',
  'address1',
  'address2',
  'notes',
  'country',
];
Map<String, dynamic> shippingRecipient(dynamic value) {
  final j = object(value);
  return {
    for (final key in recipientFields)
      key: j[key] is String ? j[key] : invalidActivity(),
  };
}

String canonicalRecipient(dynamic value) =>
    jsonEncode(shippingRecipient(value));
List<int> shippingIds(dynamic value) {
  if (value is! List || value.isEmpty || value.length > 100) {
    invalidActivity();
  }
  final ids =
      value
          .map((x) => activityInt(object(x)['inventoryItemId'], min: 1))
          .toList()
        ..sort();
  if (ids.toSet().length != ids.length) {
    invalidActivity();
  }
  return ids;
}

class ShippingQuote {
  final Map<String, dynamic> json;
  final String id;
  final int fee, balance;
  final DateTime expiresAt;
  final List<int> ids;
  ShippingQuote(dynamic raw)
    : json = Map.unmodifiable(object(raw)),
      id = uuid(object(raw)['quoteId']),
      fee = activityInt(object(raw)['feeGP']),
      balance = activityInt(object(raw)['balance']),
      expiresAt = activityDate(object(raw)['expiresAt']),
      ids = shippingIds(object(raw)['items']) {
    shippingRecipient(json['recipient']);
  }
  Map<String, dynamic> get recipient => shippingRecipient(json['recipient']);
}

class FulfillmentRepository {
  final OrderRepository session;
  final bool enabled;
  FulfillmentRepository(
    this.session, {
    this.enabled = AppConfig.shippingPreviewEnabled,
  });
  static final _running = <String>{};
  String get _scope => '${session.scope}_fulfillment';
  Future<T> _exclusive<T>(Future<T> Function() action) async {
    if (!_running.add(_scope)) {
      throw ApiException(statusCode: 409, message: '배송 요청 결과를 확인 중입니다');
    }
    try {
      return await action();
    } finally {
      _running.remove(_scope);
    }
  }

  Future<void> _owner() async {
    if (object(await session.api.get('/users/me'))['id'] != session.userId) {
      throw ApiException(statusCode: 401, message: '배송 신청 계정으로 다시 로그인해주세요');
    }
  }

  void _gate() {
    if (kReleaseMode || !enabled) {
      throw ApiException(statusCode: 503, message: '배송 서비스를 준비 중입니다');
    }
  }

  Future<Map<String, dynamic>?> pending() async {
    final raw = await session.store.read(_scope);
    if (raw == null) {
      return null;
    }
    final p = object(jsonDecode(raw));
    if (p['kind'] == 'create') {
      uuid(p['key']);
      ShippingQuote(p['quote']);
    } else if (p['kind'] == 'cancel') {
      uuid(p['id']);
    } else {
      invalidActivity();
    }
    return p;
  }

  String _key() {
    final r = Random.secure(), b = List.generate(16, (_) => r.nextInt(256));
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    final h = b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();
    return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-${h.substring(16, 20)}-${h.substring(20)}';
  }

  Future<ShippingQuote> quote(
    List<int> ids,
    Map<String, dynamic> recipient,
  ) async {
    _gate();
    await _owner();
    final cap = object(await session.api.get('/fulfillments/capabilities'));
    if (cap['contract'] != 'FULFILLMENT_V1' || cap['enabled'] != true) {
      throw ApiException(statusCode: 503, message: '현재 배송 견적을 제공할 수 없습니다');
    }
    if (ids.isEmpty ||
        ids.length > 100 ||
        ids.toSet().length != ids.length ||
        ids.any((i) => i < 1)) {
      invalidActivity();
    }
    final r = ShippingQuote(
      await session.api.post(
        '/fulfillments/quotes',
        body: {'inventoryItemIds': ids, 'recipient': recipient},
      ),
    );
    final sorted = [...ids]..sort();
    if (jsonEncode(r.ids) != jsonEncode(sorted) ||
        canonicalRecipient(r.recipient) != canonicalRecipient(recipient)) {
      invalidActivity();
    }
    return r;
  }

  Future<ShippingRequest> submit(ShippingQuote q) => _exclusive(() async {
    _gate();
    await _owner();
    if (await pending() != null) {
      throw ApiException(statusCode: 409, message: '이전 배송 요청 결과부터 확인해주세요');
    }
    if (!q.expiresAt.isAfter(DateTime.now())) {
      throw ApiException(statusCode: 409, message: '배송 견적이 만료되었습니다. 다시 확인해주세요');
    }
    final p = {'kind': 'create', 'key': _key(), 'quote': q.json};
    await session.store.write(_scope, jsonEncode(p));
    return _create(p);
  });
  Future<ShippingRequest> _accept(Map<String, dynamic> p, dynamic raw) async {
    final r = ShippingRequest.fromJson(object(raw));
    if (p['kind'] == 'create') {
      final q = ShippingQuote(p['quote']);
      if (r.feeGP != q.fee ||
          jsonEncode(shippingIds(object(raw)['items'])) != jsonEncode(q.ids) ||
          canonicalRecipient(object(raw)['recipient']) !=
              canonicalRecipient(q.recipient)) {
        invalidActivity();
      }
    } else if (r.id != p['id'] || r.status != ShippingStatus.cancelled) {
      invalidActivity();
    }
    await session.store.remove(_scope);
    return r;
  }

  Future<ShippingRequest> _create(Map<String, dynamic> p) async {
    _gate();
    try {
      return await _accept(
        p,
        await session.api.post(
          '/fulfillments',
          body: {'quoteId': ShippingQuote(p['quote']).id},
          idempotencyKey: p['key'],
        ),
      );
    } on ApiException catch (e) {
      if ([400, 404, 409, 422].contains(e.httpStatusCode)) {
        await session.store.remove(_scope);
      }
      rethrow;
    }
  }

  Future<ShippingRequest> cancel(String id) => _exclusive(() async {
    _gate();
    await _owner();
    uuid(id);
    if (await pending() != null) {
      throw ApiException(statusCode: 409, message: '이전 배송 요청부터 확인해주세요');
    }
    final p = {'kind': 'cancel', 'id': id};
    await session.store.write(_scope, jsonEncode(p));
    return _cancel(p);
  });
  Future<ShippingRequest> _cancel(Map<String, dynamic> p) async {
    _gate();
    try {
      return await _accept(
        p,
        await session.api.post('/fulfillments/${p['id']}/cancel', body: {}),
      );
    } on ApiException catch (e) {
      if ([400, 404, 409, 422].contains(e.httpStatusCode)) {
        await session.store.remove(_scope);
      }
      rethrow;
    }
  }

  Future<ShippingRequest?> recover() => _exclusive(() async {
    await _owner();
    final p = await pending();
    if (p == null) {
      return null;
    }
    if (p['kind'] == 'cancel') {
      final current = object(await session.api.get('/fulfillments/${p['id']}'));
      if (current['status'] == 'CANCELLED') {
        return _accept(p, current);
      }
      return _cancel(p);
    }
    try {
      return await _accept(
        p,
        await session.api.get('/fulfillments/by-request/${p['key']}'),
      );
    } on ApiException catch (e) {
      if (e.httpStatusCode != 404) {
        rethrow;
      }
      return _create(p);
    }
  });
}
