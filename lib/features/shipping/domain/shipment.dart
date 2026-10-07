import '../../../core/domain/rarity.dart';
import '../../../core/utils/format.dart';

/// 배송 신청 상태 (서버 ShippingRequestStatus).
enum ShipmentStatus {
  requested('REQUESTED', '발송 준비 중'),
  shipping('SHIPPING', '배송 중'),
  delivered('DELIVERED', '배송 완료');

  const ShipmentStatus(this.code, this.label);
  final String code;
  final String label;

  static ShipmentStatus fromCode(Object? code) =>
      ShipmentStatus.values.firstWhere(
        (s) => s.code == code?.toString().toUpperCase(),
        orElse: () => ShipmentStatus.requested,
      );

  /// 진행 단계(0: 신청, 1: 발송, 2: 배송 완료).
  int get step => index;
}

class ShipmentItem {
  final int inventoryItemId;
  final String name;
  final Rarity rarity;
  final int? estimatedValue;

  const ShipmentItem({
    required this.inventoryItemId,
    required this.name,
    required this.rarity,
    this.estimatedValue,
  });

  factory ShipmentItem.fromJson(Map<String, dynamic> json) => ShipmentItem(
    inventoryItemId: asInt(json['inventoryItemId']),
    name: asStringOrNull(json['name']) ?? '',
    rarity: Rarity.fromCode(json['rarity']),
    estimatedValue: asIntOrNull(json['estimatedValue']),
  );
}

/// 배송 신청 한 건 (`GET /shipping-requests`, 관리자 목록도 같은 모양).
class Shipment {
  final int id;
  final ShipmentStatus status;
  final String recipientName;
  final String phone;
  final String address;
  final String? notes;
  final String? trackingCompany;
  final String? trackingNumber;
  final DateTime? createdAt;
  final DateTime? shippedAt;
  final DateTime? deliveredAt;
  final List<ShipmentItem> items;

  /// 관리자 목록에만 있다.
  final String? userNickname;
  final String? userEmail;

  const Shipment({
    required this.id,
    required this.status,
    required this.recipientName,
    required this.phone,
    required this.address,
    required this.items,
    this.notes,
    this.trackingCompany,
    this.trackingNumber,
    this.createdAt,
    this.shippedAt,
    this.deliveredAt,
    this.userNickname,
    this.userEmail,
  });

  factory Shipment.fromJson(Map<String, dynamic> json) {
    final user = asMap(json['user']);
    return Shipment(
      id: asInt(json['shippingRequestId'] ?? json['id']),
      status: ShipmentStatus.fromCode(json['status']),
      recipientName: asStringOrNull(json['recipientName']) ?? '',
      phone: asStringOrNull(json['phone']) ?? '',
      address: asStringOrNull(json['address']) ?? '',
      notes: asStringOrNull(json['notes']),
      trackingCompany: asStringOrNull(json['trackingCompany']),
      trackingNumber: asStringOrNull(json['trackingNumber']),
      createdAt: asDateOrNull(json['createdAt']),
      shippedAt: asDateOrNull(json['shippedAt']),
      deliveredAt: asDateOrNull(json['deliveredAt']),
      items: asMapList(json['items']).map(ShipmentItem.fromJson).toList(),
      userNickname: asStringOrNull(user['nickname']),
      userEmail: asStringOrNull(user['email']),
    );
  }

  bool get hasTracking =>
      (trackingNumber ?? '').isNotEmpty && (trackingCompany ?? '').isNotEmpty;

  bool get isActive => status != ShipmentStatus.delivered;

  /// "에어팟 프로 외 2개"
  String get itemSummary {
    if (items.isEmpty) return '상품 정보 없음';
    final first = items.first.name;
    return items.length == 1 ? first : '$first 외 ${items.length - 1}개';
  }

  /// 010-1234-5678 → 010-****-5678
  String get maskedPhone {
    final digits = phone.replaceAll(RegExp(r'\D'), '');
    if (digits.length < 8) return phone;
    final head = digits.substring(0, 3);
    final tail = digits.substring(digits.length - 4);
    return '$head-****-$tail';
  }
}
