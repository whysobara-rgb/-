import 'package:flutter/material.dart';
import '../domain/capsule_box.dart';
import '../domain/capsule_category.dart';

/// 가치가차 - 캡슐(랜덤박스) 더미 데이터 저장소.
///
/// 지금은 코드 내 고정 List를 반환하지만, 추후 실제 API 연동 시
/// 이 클래스 내부 구현만 교체하면 되도록 인터페이스를 단순하게 유지.
class CapsuleBoxRepository {
  const CapsuleBoxRepository();

  /// 전체 캡슐 박스 더미 목록.
  List<CapsuleBox> getAll() => _dummyBoxes;

  /// 카테고리로 필터링된 캡슐 박스 목록.
  ///
  /// 현재 더미 데이터는 카테고리 매핑이 없어 항상 전체 목록을 반환한다.
  /// (추후 실제 API 연동 시 카테고리별 필터링 로직으로 교체)
  List<CapsuleBox> getByCategory(CapsuleCategory category) => _dummyBoxes;

  static final List<CapsuleBox> _dummyBoxes = [
    const CapsuleBox(
      id: 'box_luxury_watch',
      tagline: 'PREMIUM HIT!',
      name: '명품 시계 박스',
      priceWon: 10000,
      icon: Icons.watch_rounded,
      badgeLabel: 'SPECIAL',
      accentColor: Color(0xFFB8860B),
    ),
    const CapsuleBox(
      id: 'box_digital_apple',
      tagline: 'TECH ZONE!',
      name: '애플 대란',
      priceWon: 10000,
      icon: Icons.phone_iphone,
      accentColor: Color(0xFF3C3C3C),
    ),
    const CapsuleBox(
      id: 'box_fashion_lucky',
      tagline: 'FASHION HIT!',
      name: '패션 럭키박스',
      priceWon: 10000,
      icon: Icons.checkroom,
      badgeLabel: 'NEW',
      accentColor: Color(0xFF6A3FBF),
    ),
    const CapsuleBox(
      id: 'box_beauty_special',
      tagline: 'BEAUTY SPECIAL!',
      name: '뷰티 럭키박스',
      priceWon: 10000,
      icon: Icons.face_retouching_natural,
      badgeLabel: 'SPECIAL',
      accentColor: Color(0xFFD6558C),
    ),
    const CapsuleBox(
      id: 'box_luxury_bag',
      tagline: 'LUXURY BOX',
      name: '명품 가방 박스',
      priceWon: 15000,
      icon: Icons.shopping_bag,
      accentColor: Color(0xFF8A6D3B),
    ),
    const CapsuleBox(
      id: 'box_digital_pro',
      tagline: 'DIGITAL PRO',
      name: '가전 프리미엄',
      priceWon: 8000,
      icon: Icons.devices,
      badgeLabel: 'NEW',
      accentColor: Color(0xFF2A7DAF),
    ),
    const CapsuleBox(
      id: 'box_food_lucky',
      tagline: 'FOOD LUCKY',
      name: '식품 랜덤박스',
      priceWon: 5000,
      icon: Icons.restaurant,
      accentColor: Color(0xFF4C8C4A),
    ),
    const CapsuleBox(
      id: 'box_gifticon',
      tagline: 'GIFTICON BOX',
      name: '기프티콘 모음',
      priceWon: 3000,
      icon: Icons.card_giftcard,
      accentColor: Color(0xFF9AA0A6),
    ),
  ];
}
