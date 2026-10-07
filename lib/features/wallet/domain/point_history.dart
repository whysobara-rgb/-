import 'package:flutter/material.dart';
import '../../../core/utils/format.dart';

/// GP 내역 유형 (백엔드 WalletTransactionType).
enum PointHistoryType {
  earn('EARN', '적립'),
  use('USE', '사용'),
  expire('EXPIRE', '소멸');

  const PointHistoryType(this.code, this.label);
  final String code;
  final String label;

  static PointHistoryType fromCode(Object? code) => PointHistoryType.values
      .firstWhere((t) => t.code == code, orElse: () => PointHistoryType.earn);
}

/// GP 변동 사유 (백엔드 `reason`). 구버전 서버면 null → [PointReason.other].
enum PointReason {
  topup('TOPUP', '충전', Icons.add_card_outlined),
  signupBonus('SIGNUP_BONUS', '가입 혜택', Icons.redeem_outlined),
  attendance('ATTENDANCE', '출석체크', Icons.event_available_outlined),
  exchange('EXCHANGE', '포인트 전환', Icons.currency_exchange_outlined),
  draw('DRAW', '뽑기', Icons.inventory_2_outlined),
  shippingFee('SHIPPING_FEE', '배송비', Icons.local_shipping_outlined),
  adjustment('ADJUSTMENT', '조정', Icons.tune_outlined),
  other('', '기타', Icons.receipt_long_outlined);

  const PointReason(this.code, this.label, this.icon);
  final String code;
  final String label;
  final IconData icon;

  static PointReason fromCode(Object? code) => PointReason.values.firstWhere(
    (r) => r.code.isNotEmpty && r.code == code,
    orElse: () => PointReason.other,
  );
}

/// GP 내역 1건 (`GET /wallet/point-history` items[]).
class PointHistoryEntry {
  final int id;
  final String description;
  final PointHistoryType type;
  final PointReason reason;

  /// 부호 있는 금액(+적립 / -사용·소멸).
  final int signedAmount;
  final int? balanceAfter;
  final DateTime date;

  const PointHistoryEntry({
    required this.id,
    required this.description,
    required this.type,
    required this.reason,
    required this.signedAmount,
    required this.date,
    this.balanceAfter,
  });

  factory PointHistoryEntry.fromJson(Map<String, dynamic> json) {
    final type = PointHistoryType.fromCode(json['type']);
    final raw = asInt(json['amount']);
    // 서버 amount는 부호가 있지만, 없더라도 type으로 부호를 맞춘다.
    final signed = type == PointHistoryType.earn ? raw.abs() : -raw.abs();
    return PointHistoryEntry(
      id: asInt(json['id']),
      description: asStringOrNull(json['description']) ?? '',
      type: type,
      reason: PointReason.fromCode(json['reason']),
      signedAmount: signed,
      balanceAfter: asIntOrNull(json['balanceAfter']),
      date: asDateOrNull(json['createdAt']) ?? DateTime.now(),
    );
  }

  /// 행 제목: 사유 라벨을 우선, 없으면 서버 설명.
  String get title {
    if (reason != PointReason.other) return reason.label;
    return description.isNotEmpty ? description : type.label;
  }

  /// 보조 설명: 서버 설명이 사유 라벨과 다를 때만.
  String? get detail {
    if (description.isEmpty) return null;
    final stripped = description.replaceAll('GP', '').trim();
    return stripped == title || description == title ? null : description;
  }
}
