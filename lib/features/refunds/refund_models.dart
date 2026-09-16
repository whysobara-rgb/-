import 'dart:convert';
import '../orders/order_models.dart' show object, uuid, invalidResponse;

int boundedInt(dynamic value, {int min = 0, int max = 2147483647}) =>
    value is int && value >= min && value <= max ? value : invalidResponse();
String boundedText(dynamic value, {int max = 255}) =>
    value is String && value.trim().isNotEmpty && value.length <= max &&
        !RegExp(r'[\x00-\x1f\x7f]').hasMatch(value)
    ? value : invalidResponse();
bool flag(dynamic value) => value is bool ? value : invalidResponse();
String currencyOf(dynamic value) =>
    {'GP', 'KRW'}.contains(value) ? value as String : invalidResponse();
String stateOf(dynamic value, Set<String> allowed) =>
    allowed.contains(value) ? value as String : invalidResponse();

DateTime refundDate(dynamic value) {
  if (value is! String) { invalidResponse(); }
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$').firstMatch(value);
  if (m == null) { invalidResponse(); }
  final y = int.parse(m[1]!), mo = int.parse(m[2]!), d = int.parse(m[3]!);
  final calendar = DateTime.utc(y, mo, d);
  if (calendar.year != y || calendar.month != mo || calendar.day != d ||
      int.parse(m[4]!) > 23 || int.parse(m[5]!) > 59 || int.parse(m[6]!) > 59) { invalidResponse(); }
  final zone = m[7]!;
  if (zone != 'Z' && (int.parse(zone.substring(1, 3)) > 23 || int.parse(zone.substring(4)) > 59)) { invalidResponse(); }
  return DateTime.tryParse(value)?.toUtc() ?? invalidResponse();
}

String canonicalJson(dynamic input) {
  dynamic sorted(dynamic v) {
    if (v is Map<String, dynamic>) {
      return {for (final k in v.keys.toList()..sort()) k: sorted(v[k])};
    }
    if (v is List) return v.map(sorted).toList();
    return v;
  }
  return jsonEncode(sorted(input));
}
List<String> refundIds(dynamic value) {
  if (value is! List || value.isEmpty || value.length > 100) { invalidResponse(); }
  final ids = value.map(uuid).toList()..sort();
  if (ids.toSet().length != ids.length) { invalidResponse(); }
  return List.unmodifiable(ids);
}
bool sameRefundIds(List<String> a, List<String> b) =>
    a.length == b.length && a.every(b.contains);

class OrderSummary {
  final String id, title, currency, status;
  final int quantity, total, refundedQuantity, unopenedCount;
  final bool refundEligible;
  final DateTime createdAt;
  final DateTime? refundUntil;
  OrderSummary(dynamic value) : this._(object(value));
  OrderSummary._(Map<String, dynamic> j)
      : id = uuid(j['orderId']), title = boundedText(j['title']),
        currency = currencyOf(j['currency']),
        status = stateOf(j['status'], {'PAID','PARTIALLY_REFUNDED','REFUNDED'}),
        quantity = boundedInt(j['quantity'], min: 1, max: 100),
        total = boundedInt(j['total'], min: 1),
        refundedQuantity = boundedInt(j['refundedQuantity'], max: 100),
        unopenedCount = boundedInt(j['unopenedCount'], max: 100),
        refundEligible = flag(j['refundEligible']),
        createdAt = refundDate(j['createdAt']),
        refundUntil = j['refundUntil'] == null ? null : refundDate(j['refundUntil']) {
    if (total % quantity != 0 || refundedQuantity + unopenedCount > quantity ||
        (status == 'PAID' && refundedQuantity != 0) ||
        (status == 'PARTIALLY_REFUNDED' && (refundedQuantity == 0 || refundedQuantity >= quantity)) ||
        (status == 'REFUNDED' && refundedQuantity != quantity) ||
        (refundEligible && refundUntil == null)) { invalidResponse(); }
  }
  int get unitPrice => total ~/ quantity;
}

class RefundCapsule {
  final String id, orderId, status;
  final int sequence;
  RefundCapsule(dynamic value) : this._(object(value));
  RefundCapsule._(Map<String, dynamic> j)
      : id = uuid(j['id']), orderId = uuid(j['orderId']),
        status = stateOf(j['status'], {'UNOPENED','OPENED','REFUND_PENDING','REFUNDED'}),
        sequence = boundedInt(j['sequence'], min: 1, max: 100);
}

class RefundOrder {
  final OrderSummary summary;
  final List<RefundCapsule> capsules;
  final String policyJson;
  RefundOrder(dynamic value) : this._(object(value));
  RefundOrder._(Map<String, dynamic> j)
      : capsules = List.unmodifiable((j['capsules'] is List ? j['capsules'] as List : invalidResponse()).map(RefundCapsule.new)),
        policyJson = canonicalJson(j['refundPolicy']),
        summary = OrderSummary({...j, 'unopenedCount':
            (j['capsules'] is List ? j['capsules'] as List : invalidResponse())
                .where((c) => object(c)['status'] == 'UNOPENED').length}) {
    if (j['unitPrice'] != summary.unitPrice || capsules.length != summary.quantity ||
        capsules.any((c) => c.orderId != summary.id || c.sequence > summary.quantity) ||
        capsules.map((c) => c.id).toSet().length != capsules.length ||
        capsules.map((c) => c.sequence).toSet().length != capsules.length ||
        capsules.where((c) => c.status == 'REFUNDED').length != summary.refundedQuantity) { invalidResponse(); }
  }
}

class RefundCapabilities {
  final bool enabled, cashEnabled;
  RefundCapabilities(dynamic value) : this._(object(value));
  RefundCapabilities._(Map<String, dynamic> j)
      : enabled = flag(j['enabled']), cashEnabled = flag(j['cashEnabled']) {
    if (j['contract'] != 'ORDER_REFUND_V1' || j['businessDays'] != 7) { invalidResponse(); }
  }
}

class RefundQuote {
  final String orderId, currency, policyJson;
  final List<String> ids;
  final int amount;
  final DateTime until;
  final bool cashEnabled;
  RefundQuote(dynamic value, RefundOrder order, List<String> selected)
      : this._(object(value), order, refundIds(selected));
  RefundQuote._(Map<String, dynamic> j, RefundOrder order, List<String> selected)
      : orderId = uuid(j['orderId']), currency = currencyOf(j['currency']),
        amount = boundedInt(j['amount'], min: 1),
        until = refundDate(j['refundUntil']), cashEnabled = flag(j['cashEnabled']),
        policyJson = canonicalJson(j['refundPolicy']),
        ids = refundIds((j['capsules'] is List ? j['capsules'] as List : invalidResponse()).map((c) => object(c)['id']).toList()) {
    final rows = j['capsules'] as List;
    if (orderId != order.summary.id || currency != order.summary.currency ||
        !sameRefundIds(ids, selected) || j['quantity'] != ids.length ||
        amount != order.summary.unitPrice * ids.length ||
        until != order.summary.refundUntil || policyJson != order.policyJson ||
        !order.summary.refundEligible ||
        !{'PAID','PARTIALLY_REFUNDED'}.contains(order.summary.status)) { invalidResponse(); }
    for (final row in rows) {
      final c = object(row);
      final matching = order.capsules.where((v) => v.id == c['id']);
      if (matching.length != 1 || matching.single.status != 'UNOPENED' ||
          c['status'] != 'UNOPENED' || c['sequence'] != matching.single.sequence) { invalidResponse(); }
    }
  }
}

class RefundReceipt {
  final String id, orderId, currency, status, reason;
  final List<String> ids;
  final int amount;
  final int? balanceAfter;
  final DateTime createdAt;
  final DateTime? completedAt;
  RefundReceipt(dynamic value) : this._(object(value));
  RefundReceipt._(Map<String, dynamic> j)
      : id = uuid(j['refundId']), orderId = uuid(j['orderId']),
        currency = currencyOf(j['currency']),
        status = stateOf(j['status'], {'PROCESSING','UNKNOWN','APPROVED','SUCCEEDED'}),
        reason = boundedText(j['reason']), ids = refundIds(j['capsuleIds']),
        amount = boundedInt(j['amount'], min: 1),
        balanceAfter = j['balanceAfter'] == null ? null : boundedInt(j['balanceAfter'], max: 9007199254740991),
        createdAt = refundDate(j['createdAt']),
        completedAt = j['completedAt'] == null ? null : refundDate(j['completedAt']) {
    if (j['quantity'] != ids.length || (succeeded != (completedAt != null)) ||
        (completedAt != null && completedAt!.isBefore(createdAt)) ||
        (currency == 'KRW' && balanceAfter != null) ||
        (currency == 'GP' && succeeded && balanceAfter == null) ||
        (!succeeded && balanceAfter != null)) { invalidResponse(); }
  }
  bool get succeeded => status == 'SUCCEEDED';
}

class PendingRefund {
  final String key, orderId, currency, reason, scope;
  final int amount;
  final List<String> ids;
  PendingRefund({required this.key, required this.orderId, required this.currency,
      required this.reason, required this.scope, required this.amount, required List<String> ids})
      : ids = refundIds(ids) {
    uuid(key); uuid(orderId); currencyOf(currency); boundedText(reason);
    boundedInt(amount, min: 1); boundedText(scope, max: 2048);
    if (reason != reason.trim()) { invalidResponse(); }
  }
  factory PendingRefund.fromJson(dynamic value, String expectedScope) {
    final j = object(value);
    if (j['schemaVersion'] != 1 || j['scope'] != expectedScope) { invalidResponse(); }
    return PendingRefund(key: uuid(j['key']), orderId: uuid(j['orderId']),
        currency: currencyOf(j['currency']), reason: boundedText(j['reason']),
        scope: expectedScope, amount: boundedInt(j['amount'], min: 1), ids: refundIds(j['capsuleIds']));
  }
  Map<String, dynamic> get request => {'capsuleIds': ids, 'expectedAmount': amount, 'reason': reason};
  Map<String, dynamic> toJson() => {'schemaVersion': 1, 'scope': scope,
      'key': key, 'orderId': orderId, 'currency': currency, 'amount': amount,
      'reason': reason, 'capsuleIds': ids};
  void matches(RefundReceipt r) {
    if (r.orderId != orderId || r.currency != currency || r.amount != amount ||
        r.reason != reason || !sameRefundIds(r.ids, ids)) { invalidResponse(); }
  }
}

class RefundRecovery {
  final PendingRefund pending;
  final RefundReceipt? receipt;
  const RefundRecovery(this.pending, this.receipt);
  bool get retryAllowed => receipt == null || receipt!.status == 'APPROVED';
}

String orderStateLabel(String state) => const {
  'PAID':'구매 완료', 'PARTIALLY_REFUNDED':'일부 환불 완료', 'REFUNDED':'전체 환불 완료',
  'UNOPENED':'미개봉', 'OPENED':'개봉 완료', 'REFUND_PENDING':'환불 처리 중',
  'PROCESSING':'환불 요청 처리 중', 'UNKNOWN':'결제사 결과 확인 필요',
  'APPROVED':'승인 확인 · 내부 처리 대기', 'SUCCEEDED':'환불 처리 완료',
}[state] ?? '상태 확인 필요';
String refundMoney(int amount, String currency) =>
    '${amount.toString().replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+(?!\d))'), (m) => '${m[1]},')} ${currency == 'KRW' ? '원' : 'GP'}';
