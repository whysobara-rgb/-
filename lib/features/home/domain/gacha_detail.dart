import 'package:flutter/material.dart';
import '../../../core/utils/icon_mapper.dart';

/// 가치가차 - 캡슐 박스 상세 화면 전용 모델.
///
/// 백엔드 `GET /gachas/:id` 응답을 그대로 매핑한다. 목록 API
/// ([CapsuleBox])와 달리 실시간 재고(totalStock/soldStock)와
/// 실제 럭키 라인업(lineup) 정보를 포함한다.
class GachaDetail {
  final int id;
  final String title;
  final String description;
  final int price;
  final String? tagline;
  final IconData icon;
  final String? badgeLabel;
  final Color accentColor;
  final String? imageUrl;
  final int totalStock;
  final int soldStock;
  final List<LineupItem> lineup;

  const GachaDetail({
    required this.id,
    required this.title,
    required this.description,
    required this.price,
    this.tagline,
    required this.icon,
    this.badgeLabel,
    required this.accentColor,
    this.imageUrl,
    required this.totalStock,
    required this.soldStock,
    required this.lineup,
  });

  double get soldRatio => totalStock == 0 ? 0 : soldStock / totalStock;

  factory GachaDetail.fromJson(Map<String, dynamic> json) {
    final lineupJson = (json['lineup'] as List<dynamic>? ?? []);
    return GachaDetail(
      id: json['id'] as int,
      title: json['title'] as String,
      description: json['description'] as String? ?? '',
      price: (json['price'] as num).toInt(),
      tagline: json['tagline'] as String?,
      icon: IconMapper.resolve(json['iconName'] as String?),
      badgeLabel: json['badgeLabel'] as String?,
      accentColor: colorFromHex(json['accentColorHex'] as String?),
      imageUrl: json['imageUrl'] as String?,
      totalStock: (json['totalStock'] as num?)?.toInt() ?? 0,
      soldStock: (json['soldStock'] as num?)?.toInt() ?? 0,
      lineup: lineupJson
          .map((e) => LineupItem.fromJson(e as Map<String, dynamic>))
          .toList()
        ..sort((a, b) => _rarityOrder(b.rarity) - _rarityOrder(a.rarity)),
    );
  }

  static int _rarityOrder(String rarity) {
    switch (rarity) {
      case 'SSR':
        return 4;
      case 'SR':
        return 3;
      case 'R':
        return 2;
      case 'N':
      default:
        return 1;
    }
  }

  /// 화면 표시용 GP 가격 포맷 (예: "500 GP")
  String get formattedPrice {
    final str = price.toString();
    final buffer = StringBuffer();
    for (int i = 0; i < str.length; i++) {
      final posFromEnd = str.length - i;
      buffer.write(str[i]);
      if (posFromEnd > 1 && posFromEnd % 3 == 1) buffer.write(',');
    }
    return '${buffer.toString()} GP';
  }
}

/// LUCKY LINEUP에 노출되는 실제 상품 아이템.
class LineupItem {
  final int itemId;
  final String name;
  final String rarity; // N / R / SR / SSR
  final int estimatedValue;
  final String? imageUrl;
  final int weight;

  const LineupItem({
    required this.itemId,
    required this.name,
    required this.rarity,
    required this.estimatedValue,
    this.imageUrl,
    required this.weight,
  });

  factory LineupItem.fromJson(Map<String, dynamic> json) {
    return LineupItem(
      itemId: json['itemId'] as int,
      name: json['name'] as String,
      rarity: json['rarity'] as String? ?? 'N',
      estimatedValue: (json['estimatedValue'] as num?)?.toInt() ?? 0,
      imageUrl: json['imageUrl'] as String?,
      weight: (json['weight'] as num?)?.toInt() ?? 0,
    );
  }

  /// 확률 라벨 (예: "12.0%"). weight 합계는 호출부에서 넘겨준다.
  String probabilityLabel(int totalWeight) {
    if (totalWeight == 0) return '0%';
    final pct = weight / totalWeight * 100;
    return '${pct.toStringAsFixed(pct < 10 ? 1 : 0)}%';
  }
}
