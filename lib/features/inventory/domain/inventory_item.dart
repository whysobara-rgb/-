import '../../../core/domain/rarity.dart';
import '../../../core/utils/format.dart';

/// 보관함 아이템 상태 (백엔드 InventoryStatus).
enum InventoryStatus {
  stored('STORED', '보관 중'),
  shippingRequested('SHIPPING_REQUESTED', '배송 요청'),
  shipping('SHIPPING', '배송 중'),
  delivered('DELIVERED', '배송 완료'),
  exchanged('EXCHANGED', '포인트 전환');

  const InventoryStatus(this.code, this.label);

  final String code;
  final String label;

  static InventoryStatus fromCode(Object? code) => InventoryStatus.values
      .firstWhere((s) => s.code == code, orElse: () => InventoryStatus.stored);
}

/// 보관함 아이템 (`GET /inventory` items[]).
class InventoryItem {
  final int id;
  final int? itemId;
  final String name;
  final Rarity rarity;
  final int estimatedValue;

  /// 포인트 전환 시 받는 GP. 구버전 서버면 null → 전환 불가로 취급.
  final int? exchangeValue;
  final String? imageUrl;
  final InventoryStatus status;
  final bool isLocked;
  final DateTime acquiredAt;

  const InventoryItem({
    required this.id,
    required this.name,
    required this.rarity,
    required this.estimatedValue,
    required this.status,
    required this.acquiredAt,
    this.itemId,
    this.exchangeValue,
    this.imageUrl,
    this.isLocked = false,
  });

  factory InventoryItem.fromJson(Map<String, dynamic> json) => InventoryItem(
    id: asInt(json['inventoryItemId'] ?? json['id']),
    itemId: asIntOrNull(json['itemId']),
    name: asStringOrNull(json['name']) ?? '',
    rarity: Rarity.fromCode(json['rarity']),
    estimatedValue: asInt(json['estimatedValue']),
    exchangeValue: asIntOrNull(json['exchangeValue']),
    imageUrl: asStringOrNull(json['imageUrl']),
    status: InventoryStatus.fromCode(json['status']),
    isLocked: asBool(json['isLocked']),
    acquiredAt: asDateOrNull(json['acquiredAt']) ?? DateTime.now(),
  );

  /// 배송 신청·포인트 전환이 가능한 상태인지.
  bool get isActionable => status == InventoryStatus.stored && !isLocked;

  bool get canExchange => isActionable && (exchangeValue ?? 0) > 0;
}

enum InventorySort {
  recent('최근 획득순'),
  valueHigh('정가 높은순'),
  valueLow('정가 낮은순');

  const InventorySort(this.label);
  final String label;
}

/// `POST /inventory/exchange` 응답.
class ExchangeResult {
  final List<int> exchangedItemIds;
  final int totalGp;
  final int? balanceAfter;

  const ExchangeResult({
    required this.exchangedItemIds,
    required this.totalGp,
    required this.balanceAfter,
  });

  factory ExchangeResult.fromJson(Map<String, dynamic> json) => ExchangeResult(
    exchangedItemIds: (json['exchangedItemIds'] is List)
        ? (json['exchangedItemIds'] as List).map(asInt).toList()
        : const [],
    totalGp: asInt(json['totalGp']),
    balanceAfter: asIntOrNull(json['balanceAfter']),
  );
}
