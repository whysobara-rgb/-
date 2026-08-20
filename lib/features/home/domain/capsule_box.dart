import 'package:flutter/material.dart';
import '../../../core/utils/icon_mapper.dart';

/// 가치가차 - "인기 랜덤박스" 그리드에 사용되는 캡슐 박스 모델.
///
/// 백엔드 GET /gachas 응답을 기반으로 하며, [id]는 뽑기 요청
/// (POST /draws)에 그대로 전달되는 백엔드 Gacha.id(숫자)이다.
class CapsuleBox {
  /// 백엔드 Gacha.id.
  final int id;

  /// 카드에는 노출되지 않는 홍보용 태그라인 (예: "PREMIUM HIT!").
  /// 추후 상세 화면 등에서 활용 가능하도록 보관.
  final String? tagline;

  final String name;

  /// GP(포인트) 가격. 백엔드 Gacha.price(통화 GP)와 1:1 대응.
  final int priceWon;

  /// 썸네일 중앙에 표시할 대표 아이콘.
  final IconData icon;

  /// 백엔드 원본 iconName 문자열. 로컬 3D 클레이 렌더링 상품
  /// 이미지([ProductImageMapper])를 찾기 위한 키로 사용된다.
  final String? iconName;

  /// 카드 좌상단 뱃지 라벨 (예: SPECIAL, NEW). 없으면 null.
  final String? badgeLabel;

  /// 카드 상단 썸네일 그라데이션에 사용되는 포인트 컬러.
  final Color accentColor;

  /// 실제 상품 사진 URL. null이면 카드/배너는 [icon] 기반 폴백을 사용한다.
  final String? imageUrl;

  const CapsuleBox({
    required this.id,
    this.tagline,
    required this.name,
    required this.priceWon,
    required this.icon,
    this.iconName,
    this.badgeLabel,
    required this.accentColor,
    this.imageUrl,
  });

  /// 백엔드 `GET /gachas` 응답 아이템 1개를 [CapsuleBox]로 변환한다.
  factory CapsuleBox.fromJson(Map<String, dynamic> json) {
    return CapsuleBox(
      id: json['id'] as int,
      tagline: json['tagline'] as String?,
      name: json['title'] as String,
      priceWon: (json['price'] as num).toInt(),
      icon: IconMapper.resolve(json['iconName'] as String?),
      iconName: json['iconName'] as String?,
      badgeLabel: json['badgeLabel'] as String?,
      accentColor: colorFromHex(json['accentColorHex'] as String?),
      imageUrl: json['imageUrl'] as String?,
    );
  }

  /// 화면 표시용 GP 가격 포맷 (예: "10,000 GP")
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
    return '${buffer.toString()} GP';
  }
}
