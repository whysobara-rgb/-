import '../../../core/utils/format.dart';

/// `GET /wallet/limit` — 스스로 정한 월 충전 한도.
class TopupLimit {
  /// null이면 한도 없음.
  final int? monthlyLimit;
  final int usedThisMonth;
  final int? remainingThisMonth;
  final PendingLimit? pending;

  const TopupLimit({
    required this.monthlyLimit,
    required this.usedThisMonth,
    required this.remainingThisMonth,
    required this.pending,
  });

  factory TopupLimit.fromJson(Map<String, dynamic> json) {
    final pendingRaw = json['pending'];
    final limit = asIntOrNull(json['monthlyLimit']);
    final used = asInt(json['usedThisMonth']);
    return TopupLimit(
      monthlyLimit: limit,
      usedThisMonth: used,
      remainingThisMonth:
          asIntOrNull(json['remainingThisMonth']) ??
          (limit == null ? null : (limit - used).clamp(0, limit)),
      pending: pendingRaw is Map<String, dynamic>
          ? PendingLimit.fromJson(pendingRaw)
          : null,
    );
  }

  bool get hasLimit => monthlyLimit != null;

  double get usedRatio {
    final l = monthlyLimit;
    if (l == null || l == 0) return l == 0 ? 1 : 0;
    return (usedThisMonth / l).clamp(0.0, 1.0);
  }
}

/// 7일 뒤 적용 예정인 한도 변경(올리거나 해제할 때).
class PendingLimit {
  final int? monthlyLimit;
  final DateTime? effectiveAt;

  const PendingLimit({required this.monthlyLimit, required this.effectiveAt});

  factory PendingLimit.fromJson(Map<String, dynamic> json) => PendingLimit(
    monthlyLimit: asIntOrNull(json['monthlyLimit']),
    effectiveAt: asDateOrNull(json['effectiveAt']),
  );
}
