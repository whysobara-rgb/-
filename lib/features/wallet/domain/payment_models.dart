import '../../../core/utils/format.dart';

/// 결제 주문 상태 (서버 PaymentOrderStatus).
enum PaymentStatus {
  ready('READY', '결제 대기'),
  inProgress('IN_PROGRESS', '확인 중'),
  done('DONE', '충전 완료'),
  failed('FAILED', '실패'),
  canceled('CANCELED', '취소됨');

  const PaymentStatus(this.code, this.label);
  final String code;
  final String label;

  static PaymentStatus fromCode(Object? code) =>
      PaymentStatus.values.firstWhere(
        (s) => s.code == code?.toString().toUpperCase(),
        orElse: () => PaymentStatus.ready,
      );
}

/// 충전 패키지 (`GET /payments/config` packages[]).
class TopupPackage {
  final String id;

  /// 결제 금액(원).
  final int price;

  /// 산 GP.
  final int gp;

  /// 대량 충전 보너스 GP.
  final int bonusGp;

  /// 첫 충전이면 더 받는 GP(대상이 아니면 0).
  final int firstTopupBonusGp;

  const TopupPackage({
    required this.id,
    required this.price,
    required this.gp,
    this.bonusGp = 0,
    this.firstTopupBonusGp = 0,
  });

  factory TopupPackage.fromJson(Map<String, dynamic> json) => TopupPackage(
    id: asStringOrNull(json['id']) ?? '',
    price: asInt(json['price']),
    gp: asInt(json['gp']),
    bonusGp: asInt(json['bonusGp']),
    firstTopupBonusGp: asInt(json['firstTopupBonusGp']),
  );

  int get totalGp => gp + bonusGp + firstTopupBonusGp;

  /// 첫 충전 보너스가 산 GP의 몇 %인지(상한에 걸리면 20%보다 작다).
  int get firstBonusPercent =>
      gp == 0 ? 0 : (firstTopupBonusGp * 100 / gp).round();
}

/// 첫 충전 보너스 규칙.
class FirstTopupBonus {
  final double rate;
  final int maxGp;
  final bool eligible;

  const FirstTopupBonus({
    required this.rate,
    required this.maxGp,
    required this.eligible,
  });

  factory FirstTopupBonus.fromJson(Map<String, dynamic> json) =>
      FirstTopupBonus(
        rate: asDouble(json['rate']),
        maxGp: asInt(json['maxGp']),
        eligible: asBool(json['eligible']),
      );

  int get percent => (rate * 100).round();
}

/// `GET /payments/config`.
class PaymentConfig {
  /// false면 서버에 결제가 설정돼 있지 않다. 충전을 막는다.
  final bool enabled;
  final String? clientKey;
  final String? customerKey;
  final List<TopupPackage> packages;
  final FirstTopupBonus? firstTopupBonus;

  const PaymentConfig({
    required this.enabled,
    required this.packages,
    this.clientKey,
    this.customerKey,
    this.firstTopupBonus,
  });

  factory PaymentConfig.fromJson(Map<String, dynamic> json) {
    final bonus = json['firstTopupBonus'];
    return PaymentConfig(
      enabled: asBool(json['enabled']),
      clientKey: asStringOrNull(json['clientKey']),
      customerKey: asStringOrNull(json['customerKey']),
      packages: asMapList(json['packages'])
          .map(TopupPackage.fromJson)
          .where((p) => p.id.isNotEmpty && p.price > 0)
          .toList(),
      firstTopupBonus: bonus is Map<String, dynamic>
          ? FirstTopupBonus.fromJson(bonus)
          : null,
    );
  }

  bool get firstTopupEligible => firstTopupBonus?.eligible ?? false;
}

/// `POST /payments/orders` — 결제위젯에 넘길 주문.
class PaymentOrder {
  final String orderId;
  final String orderName;
  final int amount;
  final int gp;
  final int bonusGp;
  final int firstTopupBonusGp;
  final String? clientKey;
  final String? customerKey;

  const PaymentOrder({
    required this.orderId,
    required this.orderName,
    required this.amount,
    required this.gp,
    this.bonusGp = 0,
    this.firstTopupBonusGp = 0,
    this.clientKey,
    this.customerKey,
  });

  factory PaymentOrder.fromJson(Map<String, dynamic> json) => PaymentOrder(
    orderId: asStringOrNull(json['orderId']) ?? '',
    orderName: asStringOrNull(json['orderName']) ?? 'GP 충전',
    amount: asInt(json['amount']),
    gp: asInt(json['gp']),
    bonusGp: asInt(json['bonusGp']),
    firstTopupBonusGp: asInt(json['firstTopupBonusGp']),
    clientKey: asStringOrNull(json['clientKey']),
    customerKey: asStringOrNull(json['customerKey']),
  );

  int get totalGp => gp + bonusGp + firstTopupBonusGp;
}

/// `POST /payments/confirm` 결과, `GET /payments/orders` 항목.
class PaymentReceipt {
  final String orderId;
  final PaymentStatus status;
  final String? packageId;
  final int amount;
  final int gp;
  final int bonusGp;
  final int firstTopupBonusGp;
  final int totalGp;
  final String? method;
  final DateTime? approvedAt;
  final DateTime? createdAt;

  /// 확인 직후 보유 GP. 목록 항목에는 없다.
  final int? balanceAfter;

  const PaymentReceipt({
    required this.orderId,
    required this.status,
    required this.amount,
    required this.gp,
    required this.totalGp,
    this.packageId,
    this.bonusGp = 0,
    this.firstTopupBonusGp = 0,
    this.method,
    this.approvedAt,
    this.createdAt,
    this.balanceAfter,
  });

  factory PaymentReceipt.fromJson(Map<String, dynamic> json) {
    final gp = asInt(json['gp']);
    final bonus = asInt(json['bonusGp']);
    final first = asInt(json['firstTopupBonusGp']);
    return PaymentReceipt(
      orderId: asStringOrNull(json['orderId']) ?? '',
      status: PaymentStatus.fromCode(json['status']),
      packageId: asStringOrNull(json['packageId']),
      amount: asInt(json['amount']),
      gp: gp,
      bonusGp: bonus,
      firstTopupBonusGp: first,
      totalGp: asIntOrNull(json['totalGp']) ?? gp + bonus + first,
      method: asStringOrNull(json['method']),
      approvedAt: asDateOrNull(json['approvedAt']),
      createdAt: asDateOrNull(json['createdAt']),
      balanceAfter: asIntOrNull(json['balanceAfter']),
    );
  }
}
