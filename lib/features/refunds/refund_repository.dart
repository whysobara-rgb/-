import 'dart:convert';
import 'dart:math';
import 'package:flutter/foundation.dart';
import '../../core/config/app_config.dart';
import '../../core/network/api_client.dart';
import '../orders/order_models.dart' show object, uuid, invalidResponse;
import '../orders/order_repository.dart';
import 'refund_models.dart';

/// A captured-token session plus a login-generation lease protects both reads
/// and writes. The journal contains no password, token or card information.
class RefundRepository {
  final OrderRepository session;
  final bool Function() sessionIsCurrent;
  final bool enabled;
  static final Set<String> _running = {};
  RefundRepository(this.session, {required this.sessionIsCurrent,
      this.enabled = AppConfig.refundPreviewEnabled});
  String get scope => '${session.scope}_refund_v1';
  bool get canRequest => !kReleaseMode && enabled;
  ApiClient get _api => session.api;

  static Future<RefundRepository> forUser(int id, bool Function() current) async {
    if (!current()) throw ApiSessionChangedException();
    final session = await OrderRepository.forUser(id);
    if (!current()) throw ApiSessionChangedException();
    return RefundRepository(session, sessionIsCurrent: current);
  }

  void _current() {
    bool valid;
    try { valid = sessionIsCurrent(); } catch (_) { valid = false; }
    if (!valid) throw ApiSessionChangedException();
  }
  Future<dynamic> _get(String path) =>
      _api.getForSession(path, sessionIsCurrent: sessionIsCurrent);
  Future<dynamic> _post(String path, Map<String, dynamic> body, {String? key}) =>
      _api.postForSession(path, body: body, sessionIsCurrent: sessionIsCurrent,
          idempotencyKey: key);
  Future<void> _owner() async {
    _current();
    if (object(await _get('/users/me'))['id'] != session.userId) {
      throw ApiSessionChangedException();
    }
    _current();
  }
  Future<T> _exclusive<T>(Future<T> Function() action) async {
    _current();
    if (!_running.add(scope)) {
      throw ApiException(statusCode: 0, message: '이전 환불 요청을 확인 중입니다');
    }
    try { return await action(); } finally { _running.remove(scope); }
  }
  Future<PendingRefund?> pending() async {
    _current();
    final raw = await session.store.read(scope);
    _current();
    if (raw == null) return null;
    if (raw.length > 32768) invalidResponse();
    return PendingRefund.fromJson(jsonDecode(raw), scope);
  }

  Future<RefundCapabilities> capabilities() async {
    await _owner();
    return RefundCapabilities(await _get('/order-refunds/capabilities'));
  }
  Future<void> _gate(String currency) async {
    _current(); currencyOf(currency);
    if (!canRequest) throw ApiException(statusCode: 0, message: '환불 신청 기능을 준비하고 있습니다');
    final c = await capabilities();
    if (!c.enabled || (currency == 'KRW' && !c.cashEnabled)) {
      throw ApiException(statusCode: 0, message: '이 서버에서 해당 결제수단의 환불을 준비하고 있습니다');
    }
  }

  (List<T>, int) _page<T>(dynamic value, int page, T Function(dynamic) parse,
      String Function(T) id) {
    final j = object(value);
    if (j['page'] != page || j['limit'] != 20 || j['items'] is! List) invalidResponse();
    final total = boundedInt(j['totalCount']);
    final rows = (j['items'] as List).map(parse).toList(growable: false);
    final remaining = max(0, total - (page - 1) * 20);
    if (rows.length != min(20, remaining) || rows.map(id).toSet().length != rows.length) invalidResponse();
    return (List.unmodifiable(rows), total);
  }
  Future<(List<OrderSummary>, int)> orders(int page) async {
    boundedInt(page, min: 1, max: 100000); await _owner();
    final c = object(await _get('/transactions/capabilities'));
    if (c['contract'] != 'TRANSACTION_HISTORY_V1' || c['enabled'] != true) invalidResponse();
    return _page(await _get('/transactions/orders?page=$page&limit=20'),
        page, OrderSummary.new, (r) => r.id);
  }
  Future<(List<RefundReceipt>, int)> refunds(int page) async {
    boundedInt(page, min: 1, max: 100000); await capabilities();
    return _page(await _get('/order-refunds?page=$page&limit=20'),
        page, RefundReceipt.new, (r) => r.id);
  }
  Future<RefundOrder> order(String id) async {
    uuid(id); await _owner();
    final order = RefundOrder(await _get('/orders/$id'));
    if (order.summary.id != id) invalidResponse();
    return order;
  }
  Future<RefundQuote> quote(RefundOrder order, List<String> selected) async {
    final ids = refundIds(selected);
    if (ids.any((id) => !order.capsules.any((c) => c.id == id && c.status == 'UNOPENED'))) invalidResponse();
    await _gate(order.summary.currency);
    return RefundQuote(await _post('/orders/${order.summary.id}/refund-quote',
        {'capsuleIds': ids}), order, ids);
  }

  String _key() {
    final random = Random.secure();
    final b = List.generate(16, (_) => random.nextInt(256));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    final h = b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();
    return '${h.substring(0,8)}-${h.substring(8,12)}-${h.substring(12,16)}-${h.substring(16,20)}-${h.substring(20)}';
  }
  Future<RefundReceipt> submit(RefundQuote quote, String reason) => _exclusive(() async {
    await _gate(quote.currency);
    if (await pending() != null) {
      throw ApiException(statusCode: 0, message: '이전 환불 결과를 먼저 확인해주세요');
    }
    final p = PendingRefund(key: _key(), orderId: quote.orderId,
        currency: quote.currency, amount: quote.amount, ids: quote.ids,
        reason: reason.trim(), scope: scope);
    await session.store.write(scope, jsonEncode(p.toJson()));
    _current();
    return _send(p, firstAttempt: true);
  });

  Future<RefundReceipt?> _lookup(PendingRefund p) async {
    try {
      final r = RefundReceipt(await _get('/order-refunds/by-request/${p.key}'));
      p.matches(r); return r;
    } on ApiException catch (e) {
      // Only this endpoint's authenticated NOT_FOUND is an absent record.
      // Absence is not proof that an earlier request cannot still commit.
      if (e.httpStatusCode == 404 && e.statusCode == 10004) return null;
      rethrow;
    }
  }
  Future<void> _removeSame(PendingRefund p) async {
    _current();
    final stored = await pending();
    if (stored == null || stored.key != p.key || canonicalJson(stored.toJson()) != canonicalJson(p.toJson())) invalidResponse();
    _current(); await session.store.remove(scope); _current();
  }
  Future<RefundReceipt> _send(PendingRefund p, {bool firstAttempt = false}) async {
    dynamic value;
    try {
      value = await _post('/orders/${p.orderId}/refunds', p.request, key: p.key);
    } on ApiException catch (e) {
      // Only a direct, definite FIRST-attempt rejection, followed by an absent
      // server journal, can release this intent. Ambiguous/replayed requests
      // retain their exact key/body; a post-approval failure has a server record.
      if (firstAttempt && {400,404,409}.contains(e.httpStatusCode) &&
          {10001,10004,10005}.contains(e.statusCode)) {
        try {
          if (await _lookup(p) == null) await _removeSame(p);
        } catch (_) { /* keep recovery state when verification is inconclusive */ }
      }
      rethrow;
    }
    final r = RefundReceipt(value); p.matches(r);
    return r; // Even success is retained until a server-verified acknowledgement.
  }
  Future<RefundRecovery?> recover() => _exclusive(() async {
    await _owner(); final p = await pending();
    if (p == null) return null;
    return RefundRecovery(p, await _lookup(p));
  });
  Future<RefundReceipt?> retry() => _exclusive(() async {
    await _owner(); final p = await pending();
    if (p == null) invalidResponse();
    final r = await _lookup(p);
    if (r != null && r.status != 'APPROVED') return r;
    await _gate(p.currency);
    // Explicit user action only. APPROVED replays internal completion; UNKNOWN
    // and PROCESSING are read-only until the provider/server resolves them.
    return _send(p);
  });
  Future<void> acknowledge() => _exclusive(() async {
    await _owner(); final p = await pending();
    if (p == null) return;
    final r = await _lookup(p);
    if (r == null || !r.succeeded) {
      throw ApiException(statusCode: 0, message: '환불 완료 결과를 먼저 확인해주세요');
    }
    await _removeSame(p);
  });
}
