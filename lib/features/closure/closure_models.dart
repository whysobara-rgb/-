import '../orders/order_models.dart' show object, uuid, invalidResponse;

const closureSummaryLabels = {
  'balance': '현재 GP 잔액',
  'unopened': '미개봉·환불 대기 캡슐',
  'inventory': '보관·배송 중 상품',
  'shipping': '진행 중 배송',
  'payments': '미확정 결제',
  'refunds': '진행 중 환불',
  'tickets': '미종료 문의',
};

String closureReason(dynamic value) {
  if (value is! String || value.trim().isEmpty ||
      value.trim().length > 255 || RegExp(r'[\x00-\x1f\x7f]').hasMatch(value)) {
    invalidResponse();
  }
  return value.trim();
}

DateTime closureDate(dynamic value) {
  if (value is! String || !RegExp(
      r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$').hasMatch(value)) {
    invalidResponse();
  }
  final date = DateTime.tryParse(value);
  if (date == null || date.year != int.parse(value.substring(0, 4)) ||
      date.month != int.parse(value.substring(5, 7)) ||
      date.day != int.parse(value.substring(8, 10)) ||
      date.hour != int.parse(value.substring(11, 13)) ||
      date.minute != int.parse(value.substring(14, 16)) ||
      date.second != int.parse(value.substring(17, 19))) {
    invalidResponse();
  }
  return date;
}

class ClosureSummary {
  final Map<String, int> values;
  ClosureSummary(dynamic input) : values = _parse(input);
  static Map<String, int> _parse(dynamic input) {
    final j = object(input), result = <String, int>{};
    for (final key in closureSummaryLabels.keys) {
      final value = j[key];
      if (value is! int || value < 0 || value > 9007199254740991) {
        invalidResponse();
      }
      result[key] = value;
    }
    return Map.unmodifiable(result);
  }
}

class ClosureActive {
  final String id, reason;
  final DateTime createdAt;
  ClosureActive(dynamic input) : this._(object(input));
  ClosureActive._(Map<String, dynamic> j)
      : id = uuid(j['id']), reason = closureReason(j['reason']),
        createdAt = closureDate(j['createdAt']) {
    if (j['status'] != 'REQUESTED') { invalidResponse(); }
  }
}

class ClosureCheck {
  final ClosureSummary summary;
  final ClosureActive? active;
  ClosureCheck(dynamic input) : this._(object(input));
  ClosureCheck._(Map<String, dynamic> j)
      : summary = ClosureSummary(j['summary']),
        active = j['active'] == null ? null : ClosureActive(j['active']) {
    if (j['mode'] != 'REQUEST_ONLY' || j['automaticDeletionEnabled'] != false ||
        !j.containsKey('active')) { invalidResponse(); }
  }
}

class ClosureReceipt {
  final String id, status, reason;
  final ClosureSummary summary;
  final DateTime createdAt;
  final DateTime? cancelledAt;
  ClosureReceipt(dynamic input) : this._(object(input));
  ClosureReceipt._(Map<String, dynamic> j)
      : id = uuid(j['requestId']), status = j['status'] is String ? j['status'] : '',
        reason = closureReason(j['reason']), summary = ClosureSummary(j['summary']),
        createdAt = closureDate(j['createdAt']),
        cancelledAt = j['cancelledAt'] == null ? null : closureDate(j['cancelledAt']) {
    if (j['accountDeleted'] != false ||
        !{'REQUESTED', 'CANCELLED'}.contains(status) ||
        !j.containsKey('cancelledAt') ||
        (status == 'CANCELLED') != (cancelledAt != null) ||
        (cancelledAt != null && cancelledAt!.isBefore(createdAt))) {
      invalidResponse();
    }
  }
  bool get cancelled => status == 'CANCELLED';
}

/// Passwords and tokens are intentionally not representable in this journal.
class PendingClosure {
  final String kind, key, reason;
  PendingClosure(this.kind, this.key, this.reason) {
    uuid(key);
    if (!{'request', 'cancel'}.contains(kind) || closureReason(reason) != reason) {
      invalidResponse();
    }
  }
  factory PendingClosure.fromJson(dynamic input) {
    final j = object(input);
    if (j.length != 4 || j['version'] != 1 ||
        !j.keys.every({'version', 'kind', 'key', 'reason'}.contains)) {
      invalidResponse();
    }
    return PendingClosure(j['kind'] as String, j['key'] as String, j['reason'] as String);
  }
  Map<String, dynamic> toJson() => {
    'version': 1, 'kind': kind, 'key': key, 'reason': reason,
  };
}
