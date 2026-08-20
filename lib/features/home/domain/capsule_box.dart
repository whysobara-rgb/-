import 'package:flutter/material.dart';

/// 가치가차 - "인기 랜덤박스" 그리드에 사용되는 캡슐 박스 모델.
///
/// 다크 프로모션 카드 스타일(썸네일 그라데이션 + 뱃지 + 이름/가격)로
/// 표시되는 더미 데이터 모델. 추후 실제 API 응답 모델로 교체하기 쉽도록
/// 필드를 단순하게 유지.
class CapsuleBox {
  final String id;

  /// 카드에는 노출되지 않는 홍보용 태그라인 (예: "PREMIUM HIT!").
  /// 추후 상세 화면 등에서 활용 가능하도록 보관.
  final String? tagline;

  final String name;

  /// 원화 가격 (예: 10000 -> "₩10,000")
  final int priceWon;

  /// 썸네일 중앙에 표시할 대표 아이콘.
  final IconData icon;

  /// 카드 좌상단 뱃지 라벨 (예: SPECIAL, NEW). 없으면 null.
  final String? badgeLabel;

  /// 카드 상단 썸네일 그라데이션에 사용되는 포인트 컬러.
  final Color accentColor;

  const CapsuleBox({
    required this.id,
    this.tagline,
    required this.name,
    required this.priceWon,
    required this.icon,
    this.badgeLabel,
    required this.accentColor,
  });

  /// 화면 표시용 원화 가격 포맷 (예: "₩10,000")
  String get formattedPrice {
    final str = priceWon.toString();
    final buffer = StringBuffer();
    for (int i = 0; i < str.length; i++) {
      final posFromEnd = str.length - i;
      buffer.write(str[i]);
      if (posFromEnd > 1 && posFromEnd % 3 == 1) {
        buffer.write(',');
      }
    }
    return '₩${buffer.toString()}';
  }
}
