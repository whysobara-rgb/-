import 'package:flutter/material.dart';

/// 가치가차 - 보관함(내 박스)에 보관 중인 뽑기 획득 상품의 배송/처리 상태.
enum InventoryStatus {
  /// 보관중 (아직 별도 요청 없음)
  stored,

  /// 배송요청 (사용자가 배송을 요청한 상태)
  shippingRequested,

  /// 배송중
  shipping,

  /// 배송완료
  delivered,
}

extension InventoryStatusLabel on InventoryStatus {
  String get label {
    switch (this) {
      case InventoryStatus.stored:
        return '보관중';
      case InventoryStatus.shippingRequested:
        return '배송요청';
      case InventoryStatus.shipping:
        return '배송중';
      case InventoryStatus.delivered:
        return '배송완료';
    }
  }
}

/// 가치가차 - 보관함에 표시되는 뽑기 획득 상품 아이템 모델.
///
/// 추후 실제 API 응답 모델로 교체하기 쉽도록 필드를 단순하게 유지한다.
class InventoryItem {
  final String id;
  final String name;

  /// 등급 코드 ("S"/"A"/"B"/"C")
  final String grade;

  /// 상품 소비자가 (원화)
  final int price;

  final IconData icon;

  final InventoryStatus status;

  /// 잠금 여부. 잠금된 상품은 포인트 전환이 불가하다.
  final bool isLocked;

  /// 획득 시각 (최근 획득순 정렬에 사용).
  final DateTime acquiredAt;

  const InventoryItem({
    required this.id,
    required this.name,
    required this.grade,
    required this.price,
    required this.icon,
    required this.status,
    required this.acquiredAt,
    this.isLocked = false,
  });

  /// 화면 표시용 가격 포맷 (예: "1,200,000원")
  String get formattedPrice {
    final str = price.toString();
    final buffer = StringBuffer();
    for (int i = 0; i < str.length; i++) {
      final posFromEnd = str.length - i;
      buffer.write(str[i]);
      if (posFromEnd > 1 && posFromEnd % 3 == 1) buffer.write(',');
    }
    return '${buffer.toString()}원';
  }
}

/// 정렬 기준.
enum InventorySortOption {
  /// 최근 획득순 (기본)
  recentFirst,

  /// 획득가치 높은순
  valueHighToLow,

  /// 획득가치 낮은순
  valueLowToHigh,
}

extension InventorySortOptionLabel on InventorySortOption {
  String get label {
    switch (this) {
      case InventorySortOption.recentFirst:
        return '최근 획득순';
      case InventorySortOption.valueHighToLow:
        return '획득가치 높은순';
      case InventorySortOption.valueLowToHigh:
        return '획득가치 낮은순';
    }
  }
}

/// 보관함 더미 데이터 저장소.
///
/// 추후 실제 API/DB 연동 시 이 클래스의 구현만 교체하면 되도록
/// 인터페이스를 단순하게 유지한다.
class InventoryRepository {
  const InventoryRepository();

  List<InventoryItem> getDummyItems() {
    final now = DateTime.now();
    return [
      InventoryItem(
        id: 'inv_001',
        name: '명품 시계',
        grade: 'S',
        price: 2500000,
        icon: Icons.watch_rounded,
        status: InventoryStatus.stored,
        acquiredAt: now.subtract(const Duration(minutes: 5)),
        isLocked: true,
      ),
      InventoryItem(
        id: 'inv_002',
        name: '프리미엄 지갑',
        grade: 'A',
        price: 450000,
        icon: Icons.account_balance_wallet_rounded,
        status: InventoryStatus.shippingRequested,
        acquiredAt: now.subtract(const Duration(hours: 2)),
      ),
      InventoryItem(
        id: 'inv_003',
        name: '무선 이어폰',
        grade: 'A',
        price: 329000,
        icon: Icons.headphones_rounded,
        status: InventoryStatus.shipping,
        acquiredAt: now.subtract(const Duration(hours: 6)),
      ),
      InventoryItem(
        id: 'inv_004',
        name: '브랜드 운동화',
        grade: 'B',
        price: 89000,
        icon: Icons.sports_soccer_rounded,
        status: InventoryStatus.delivered,
        acquiredAt: now.subtract(const Duration(days: 1)),
      ),
      InventoryItem(
        id: 'inv_005',
        name: '향수 세트',
        grade: 'B',
        price: 65000,
        icon: Icons.local_florist_rounded,
        status: InventoryStatus.stored,
        acquiredAt: now.subtract(const Duration(days: 2)),
      ),
      InventoryItem(
        id: 'inv_006',
        name: '카페 기프티콘',
        grade: 'C',
        price: 6500,
        icon: Icons.local_cafe_rounded,
        status: InventoryStatus.delivered,
        acquiredAt: now.subtract(const Duration(days: 3)),
      ),
      InventoryItem(
        id: 'inv_007',
        name: '편의점 상품권',
        grade: 'C',
        price: 5000,
        icon: Icons.card_giftcard_rounded,
        status: InventoryStatus.stored,
        acquiredAt: now.subtract(const Duration(days: 4)),
        isLocked: true,
      ),
      InventoryItem(
        id: 'inv_008',
        name: '프리미엄 스마트폰',
        grade: 'S',
        price: 1200000,
        icon: Icons.phone_iphone_rounded,
        status: InventoryStatus.shipping,
        acquiredAt: now.subtract(const Duration(days: 5)),
      ),
    ];
  }
}
