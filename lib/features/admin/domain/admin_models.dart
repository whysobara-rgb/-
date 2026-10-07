import '../../../core/utils/format.dart';
import '../../wallet/domain/payment_models.dart';

/// `GET /admin/stats`.
class AdminStats {
  final int todayRevenue;
  final int todayPayingUsers;
  final int todayDraws;
  final int todayGpSpent;
  final int todayNewUsers;
  final int monthRevenue;
  final int monthPayingUsers;
  final int totalRevenue;
  final int totalDraws;
  final int totalGpSpent;
  final int totalUsers;

  /// 회원이 아직 가진 GP(상품으로 내줘야 할 선불 가치).
  final int gpOutstanding;
  final int shipmentsToSend;
  final int shipmentsInTransit;
  final int paymentsToReview;

  const AdminStats({
    required this.todayRevenue,
    required this.todayPayingUsers,
    required this.todayDraws,
    required this.todayGpSpent,
    required this.todayNewUsers,
    required this.monthRevenue,
    required this.monthPayingUsers,
    required this.totalRevenue,
    required this.totalDraws,
    required this.totalGpSpent,
    required this.totalUsers,
    required this.gpOutstanding,
    required this.shipmentsToSend,
    required this.shipmentsInTransit,
    required this.paymentsToReview,
  });

  factory AdminStats.fromJson(Map<String, dynamic> json) {
    final today = asMap(json['today']);
    final month = asMap(json['month']);
    final total = asMap(json['total']);
    final action = asMap(json['actionRequired']);
    return AdminStats(
      todayRevenue: asInt(today['revenue']),
      todayPayingUsers: asInt(today['payingUsers']),
      todayDraws: asInt(today['draws']),
      todayGpSpent: asInt(today['gpSpentOnDraws']),
      todayNewUsers: asInt(today['newUsers']),
      monthRevenue: asInt(month['revenue']),
      monthPayingUsers: asInt(month['payingUsers']),
      totalRevenue: asInt(total['revenue']),
      totalDraws: asInt(total['draws']),
      totalGpSpent: asInt(total['gpSpentOnDraws']),
      totalUsers: asInt(total['users']),
      gpOutstanding: asInt(total['gpOutstanding']),
      shipmentsToSend: asInt(action['shipmentsToSend']),
      shipmentsInTransit: asInt(action['shipmentsInTransit']),
      paymentsToReview: asInt(action['paymentsToReview']),
    );
  }
}

/// `GET /admin/gachas` 항목.
class AdminGacha {
  final int id;
  final String title;
  final bool active;
  final int price;
  final int totalStock;
  final int soldCount;
  final bool soldOut;
  final int revenueGp;
  final int pityThreshold;
  final int itemCount;
  final double? payoutSingle;
  final double? payoutMulti;

  const AdminGacha({
    required this.id,
    required this.title,
    required this.active,
    required this.price,
    required this.totalStock,
    required this.soldCount,
    required this.soldOut,
    required this.revenueGp,
    required this.pityThreshold,
    required this.itemCount,
    this.payoutSingle,
    this.payoutMulti,
  });

  factory AdminGacha.fromJson(Map<String, dynamic> json) {
    final payout = asMap(json['payoutRatioPercent']);
    final total = asInt(json['totalStock']);
    final sold = asInt(json['soldCount']);
    return AdminGacha(
      id: asInt(json['id']),
      title: asStringOrNull(json['title']) ?? '',
      active: asBool(json['active']),
      price: asInt(json['price']),
      totalStock: total,
      soldCount: sold,
      soldOut: json['soldOut'] is bool
          ? json['soldOut'] as bool
          : sold >= total,
      revenueGp: asInt(json['revenueGp']),
      pityThreshold: asInt(json['pityThreshold']),
      itemCount: asInt(json['itemCount']),
      payoutSingle: asDoubleOrNull(payout['singleDraw']),
      payoutMulti: asDoubleOrNull(payout['multiDraw']),
    );
  }

  AdminGacha copyWith({bool? active, int? totalStock}) => AdminGacha(
    id: id,
    title: title,
    active: active ?? this.active,
    price: price,
    totalStock: totalStock ?? this.totalStock,
    soldCount: soldCount,
    soldOut: soldCount >= (totalStock ?? this.totalStock),
    revenueGp: revenueGp,
    pityThreshold: pityThreshold,
    itemCount: itemCount,
    payoutSingle: payoutSingle,
    payoutMulti: payoutMulti,
  );
}

/// 배너 링크 종류(서버 BannerLinkType).
enum AdminLinkType {
  none('NONE', '연결 없음'),
  gacha('GACHA', '박스'),
  odds('ODDS', '확률 공시'),
  attendance('ATTENDANCE', '출석체크'),
  topup('TOPUP', '충전'),
  url('URL', '웹 주소');

  const AdminLinkType(this.code, this.label);
  final String code;
  final String label;

  static AdminLinkType fromCode(Object? code) =>
      AdminLinkType.values.firstWhere(
        (t) => t.code == code?.toString().toUpperCase(),
        orElse: () => AdminLinkType.none,
      );

  /// 대상이 필요한지(박스 ID·URL). ODDS는 비우면 확률 목록으로 간다.
  bool get takesTarget =>
      this == AdminLinkType.gacha ||
      this == AdminLinkType.odds ||
      this == AdminLinkType.url;
}

/// `GET /admin/banners` 항목.
class AdminBanner {
  final int id;
  final String title;
  final String? subtitle;
  final String? badge;
  final String? imageUrl;
  final String? accentColorHex;
  final AdminLinkType linkType;
  final String? linkTarget;
  final int priority;
  final bool active;
  final DateTime? startsAt;
  final DateTime? endsAt;

  const AdminBanner({
    required this.id,
    required this.title,
    required this.linkType,
    required this.priority,
    required this.active,
    this.subtitle,
    this.badge,
    this.imageUrl,
    this.accentColorHex,
    this.linkTarget,
    this.startsAt,
    this.endsAt,
  });

  factory AdminBanner.fromJson(Map<String, dynamic> json) {
    final link = asMap(json['link']);
    return AdminBanner(
      id: asInt(json['id']),
      title: asStringOrNull(json['title']) ?? '',
      subtitle: asStringOrNull(json['subtitle']),
      badge: asStringOrNull(json['badge']),
      imageUrl: asStringOrNull(json['imageUrl']),
      accentColorHex: asStringOrNull(json['accentColorHex']),
      linkType: AdminLinkType.fromCode(link['type'] ?? json['linkType']),
      linkTarget: asStringOrNull(link['target'] ?? json['linkTarget']),
      priority: asInt(json['priority']),
      active: asBool(json['active'], true),
      startsAt: asDateOrNull(json['startsAt']),
      endsAt: asDateOrNull(json['endsAt']),
    );
  }

  /// 지금 홈에 보이는지(활성 + 노출 기간 안).
  bool liveAt(DateTime now) =>
      active &&
      (startsAt == null || !startsAt!.isAfter(now)) &&
      (endsAt == null || endsAt!.isAfter(now));
}

/// `GET /admin/payments` 항목.
class AdminPayment {
  final String orderId;
  final PaymentStatus status;
  final int userId;
  final String userNickname;
  final int amount;
  final int totalGp;
  final String? method;
  final String? paymentKey;
  final String? failureReason;
  final DateTime? approvedAt;
  final DateTime? createdAt;

  const AdminPayment({
    required this.orderId,
    required this.status,
    required this.userId,
    required this.userNickname,
    required this.amount,
    required this.totalGp,
    this.method,
    this.paymentKey,
    this.failureReason,
    this.approvedAt,
    this.createdAt,
  });

  factory AdminPayment.fromJson(Map<String, dynamic> json) {
    final user = asMap(json['user']);
    return AdminPayment(
      orderId: asStringOrNull(json['orderId']) ?? '',
      status: PaymentStatus.fromCode(json['status']),
      userId: asInt(user['id']),
      userNickname: asStringOrNull(user['nickname']) ?? '-',
      amount: asInt(json['amount']),
      totalGp: asInt(json['totalGp']),
      method: asStringOrNull(json['method']),
      paymentKey: asStringOrNull(json['paymentKey']),
      failureReason: asStringOrNull(json['failureReason']),
      approvedAt: asDateOrNull(json['approvedAt']),
      createdAt: asDateOrNull(json['createdAt']),
    );
  }
}

/// 페이지 목록 응답.
class AdminList<T> {
  final List<T> items;
  final int totalCount;
  const AdminList(this.items, this.totalCount);

  bool get hasMore => items.length < totalCount;
}
