import '../../../core/domain/rarity.dart';
import '../../../core/utils/format.dart';

/// `GET /gachas` 목록 항목.
class GachaSummary {
  final int id;
  final String title;
  final String description;
  final int price;
  final String? tagline;
  final String? badgeLabel;
  final String? imageUrl;
  final String? iconName;

  /// 천장(SSR 확정) 횟수. 없으면 천장 없음.
  final int? pityThreshold;

  /// 실재고. 구버전 서버면 null.
  final int? totalStock;
  final int? soldStock;
  final bool soldOut;

  const GachaSummary({
    required this.id,
    required this.title,
    required this.price,
    this.description = '',
    this.tagline,
    this.badgeLabel,
    this.imageUrl,
    this.iconName,
    this.pityThreshold,
    this.totalStock,
    this.soldStock,
    this.soldOut = false,
  });

  /// 남은 수량. 재고 정보가 없으면 null(제한 없음으로 취급).
  int? get remaining => remainingStock(totalStock, soldStock);

  factory GachaSummary.fromJson(Map<String, dynamic> json) => GachaSummary(
    id: asInt(json['id']),
    title: asStringOrNull(json['title']) ?? '',
    description: asStringOrNull(json['description']) ?? '',
    price: asInt(json['price']),
    tagline: asStringOrNull(json['tagline']),
    badgeLabel: asStringOrNull(json['badgeLabel']),
    imageUrl: asStringOrNull(json['imageUrl']),
    iconName: asStringOrNull(json['iconName']),
    pityThreshold: _positiveOrNull(json['pityThreshold']),
    totalStock: asIntOrNull(json['totalStock']),
    soldStock: asIntOrNull(json['soldStock']),
    soldOut: _soldOut(json),
  );
}

/// soldOut 필드가 없으면 재고 숫자로 판단한다.
bool _soldOut(Map<String, dynamic> json) {
  if (json['soldOut'] != null) return asBool(json['soldOut']);
  final left = remainingStock(
    asIntOrNull(json['totalStock']),
    asIntOrNull(json['soldStock']),
  );
  return left != null && left <= 0;
}

int? remainingStock(int? total, int? sold) {
  if (total == null || sold == null || total <= 0) return null;
  return (total - sold).clamp(0, total);
}

int? _positiveOrNull(Object? value) {
  final v = asIntOrNull(value);
  return v == null || v <= 0 ? null : v;
}

/// 박스 구성 상품 1개 (`GET /gachas/:id` lineup[]).
class LineupItem {
  final int itemId;
  final String name;
  final Rarity rarity;
  final int estimatedValue;

  /// 포인트 전환 시 받는 GP. 구버전 서버면 null.
  final int? exchangeValue;
  final String? imageUrl;
  final int weight;

  /// 0.6867 = 0.6867%.
  final double probabilityPercent;

  const LineupItem({
    required this.itemId,
    required this.name,
    required this.rarity,
    required this.estimatedValue,
    required this.weight,
    required this.probabilityPercent,
    this.exchangeValue,
    this.imageUrl,
  });

  factory LineupItem.fromJson(
    Map<String, dynamic> json, {
    int totalWeight = 0,
  }) {
    final weight = asInt(json['weight']);
    final pct =
        asDoubleOrNull(json['probabilityPercent']) ??
        (totalWeight > 0 ? weight / totalWeight * 100 : 0.0);
    return LineupItem(
      itemId: asInt(json['itemId']),
      name: asStringOrNull(json['name']) ?? '',
      rarity: Rarity.fromCode(json['rarity']),
      estimatedValue: asInt(json['estimatedValue']),
      exchangeValue: asIntOrNull(json['exchangeValue']),
      imageUrl: asStringOrNull(json['imageUrl']),
      weight: weight,
      probabilityPercent: pct,
    );
  }

  /// lineup 배열을 파싱하면서 probabilityPercent가 없으면 weight로 계산한다.
  static List<LineupItem> listFromJson(Object? raw) {
    final maps = asMapList(raw);
    final total = maps.fold<int>(0, (sum, m) => sum + asInt(m['weight']));
    final items = maps
        .map((m) => LineupItem.fromJson(m, totalWeight: total))
        .toList();
    items.sort((a, b) {
      final byRarity = Rarity.rarestFirst(a.rarity, b.rarity);
      return byRarity != 0
          ? byRarity
          : b.estimatedValue.compareTo(a.estimatedValue);
    });
    return items;
  }
}

/// 레어도별 합계 확률.
class RarityOdds {
  final Rarity rarity;
  final double probabilityPercent;
  final int itemCount;

  const RarityOdds({
    required this.rarity,
    required this.probabilityPercent,
    required this.itemCount,
  });

  factory RarityOdds.fromJson(Map<String, dynamic> json) => RarityOdds(
    rarity: Rarity.fromCode(json['rarity']),
    probabilityPercent: asDouble(json['probabilityPercent']),
    itemCount: asInt(json['itemCount']),
  );

  /// lineup에서 레어도별 합계를 만든다 (odds API가 없을 때의 대체 계산).
  static List<RarityOdds> fromLineup(List<LineupItem> items) {
    final result = <RarityOdds>[];
    for (final rarity in Rarity.values.reversed) {
      final tier = items.where((i) => i.rarity == rarity).toList();
      if (tier.isEmpty) continue;
      result.add(
        RarityOdds(
          rarity: rarity,
          probabilityPercent: tier.fold(
            0.0,
            (s, i) => s + i.probabilityPercent,
          ),
          itemCount: tier.length,
        ),
      );
    }
    return result;
  }
}

/// `GET /gachas/:id` 상세.
class GachaDetail {
  final int id;
  final String title;
  final String description;
  final int price;
  final String? tagline;
  final String? badgeLabel;
  final String? imageUrl;
  final int totalStock;
  final int soldStock;
  final bool soldOut;
  final int? pityThreshold;
  final List<LineupItem> lineup;

  const GachaDetail({
    required this.id,
    required this.title,
    required this.description,
    required this.price,
    required this.totalStock,
    required this.soldStock,
    required this.lineup,
    this.tagline,
    this.badgeLabel,
    this.imageUrl,
    this.pityThreshold,
    this.soldOut = false,
  });

  factory GachaDetail.fromJson(Map<String, dynamic> json) => GachaDetail(
    id: asInt(json['id']),
    title: asStringOrNull(json['title']) ?? '',
    description: asStringOrNull(json['description']) ?? '',
    price: asInt(json['price']),
    tagline: asStringOrNull(json['tagline']),
    badgeLabel: asStringOrNull(json['badgeLabel']),
    imageUrl: asStringOrNull(json['imageUrl']),
    totalStock: asInt(json['totalStock']),
    soldStock: asInt(json['soldStock']),
    soldOut: _soldOut(json),
    pityThreshold: _positiveOrNull(json['pityThreshold']),
    lineup: LineupItem.listFromJson(json['lineup']),
  );

  /// 남은 수량. 재고 정보가 없으면 null(제한 없음).
  int? get remaining => remainingStock(totalStock, soldStock);

  List<RarityOdds> get rarityOdds => RarityOdds.fromLineup(lineup);

  /// 가장 비싼 구성품 정가 (상세 상단 "최대 ~" 표기용).
  int get topValue =>
      lineup.fold(0, (m, i) => i.estimatedValue > m ? i.estimatedValue : m);
}

/// `GET /gachas/:id/odds` 의 천장 정보.
class PityRule {
  final int threshold;
  final Rarity rarity;
  final double baseRatePercent;
  final double effectiveRatePercent;
  final double expectedDrawsToHit;

  const PityRule({
    required this.threshold,
    required this.rarity,
    required this.baseRatePercent,
    required this.effectiveRatePercent,
    required this.expectedDrawsToHit,
  });

  static PityRule? fromJson(Object? raw) {
    if (raw is! Map<String, dynamic>) return null;
    final threshold = asInt(raw['threshold']);
    if (threshold <= 0) return null;
    return PityRule(
      threshold: threshold,
      rarity: Rarity.fromCode(raw['rarity'] ?? 'SSR'),
      baseRatePercent: asDouble(raw['baseRatePercent']),
      effectiveRatePercent: asDouble(raw['effectiveRatePercent']),
      expectedDrawsToHit: asDouble(raw['expectedDrawsToHit']),
    );
  }
}

/// `GET /gachas/:id/odds` — 확률 및 구성 정보.
class GachaOdds {
  final int gachaId;
  final String title;
  final int price;
  final List<LineupItem> items;
  final List<RarityOdds> rarities;
  final PityRule? pity;
  final int bonusEvery;
  final int bonusCount;
  final double exchangeRatePercent;
  final int expectedValuePerDraw;
  final int expectedValueWithPity;
  final double payoutSinglePercent;
  final double payoutMultiPercent;

  const GachaOdds({
    required this.gachaId,
    required this.title,
    required this.price,
    required this.items,
    required this.rarities,
    required this.pity,
    required this.bonusEvery,
    required this.bonusCount,
    required this.exchangeRatePercent,
    required this.expectedValuePerDraw,
    required this.expectedValueWithPity,
    required this.payoutSinglePercent,
    required this.payoutMultiPercent,
  });

  factory GachaOdds.fromJson(Map<String, dynamic> json) {
    final items = LineupItem.listFromJson(json['items']);
    final rarityMaps = asMapList(json['rarities']);
    final rarities = rarityMaps.isEmpty
        ? RarityOdds.fromLineup(items)
        : (rarityMaps.map(RarityOdds.fromJson).toList()
            ..sort((a, b) => Rarity.rarestFirst(a.rarity, b.rarity)));
    final bonus = asMap(json['multiDrawBonus']);
    final ev = asMap(json['expectedValue']);
    final payout = asMap(json['payoutRatioPercent']);
    return GachaOdds(
      gachaId: asInt(json['gachaId']),
      title: asStringOrNull(json['title']) ?? '',
      price: asInt(json['price']),
      items: items,
      rarities: rarities,
      pity: PityRule.fromJson(json['pity']),
      bonusEvery: asInt(bonus['every'], 10),
      bonusCount: asInt(bonus['bonus'], 1),
      exchangeRatePercent: asDouble(json['exchangeRatePercent'], 80),
      expectedValuePerDraw: asInt(ev['perDraw']),
      expectedValueWithPity: asInt(ev['perDrawWithPity']),
      payoutSinglePercent: asDouble(payout['singleDraw']),
      payoutMultiPercent: asDouble(payout['multiDraw']),
    );
  }
}

/// `GET /gachas/:id/pity` — 내 천장 진행도.
class PityStatus {
  final int? threshold;
  final int drawsSinceTopTier;
  final int? remaining;

  const PityStatus({
    required this.threshold,
    required this.drawsSinceTopTier,
    required this.remaining,
  });

  factory PityStatus.fromJson(Map<String, dynamic> json) {
    final threshold = _positiveOrNull(json['threshold']);
    final since = asInt(json['drawsSinceTopTier']);
    final remaining =
        asIntOrNull(json['remaining']) ??
        (threshold == null ? null : (threshold - since).clamp(0, threshold));
    return PityStatus(
      threshold: threshold,
      drawsSinceTopTier: since,
      remaining: remaining,
    );
  }

  bool get hasPity => threshold != null && remaining != null;

  double get progress {
    final t = threshold;
    if (t == null || t == 0) return 0;
    return (drawsSinceTopTier / t).clamp(0.0, 1.0);
  }
}

/// 서버 배지 라벨(SPECIAL/NEW 등)을 짧은 한국어 라벨로.
String badgeLabelText(String raw) => switch (raw.toUpperCase()) {
  'NEW' => '신규',
  'SPECIAL' => '기획전',
  'HOT' => '인기',
  _ => raw,
};
