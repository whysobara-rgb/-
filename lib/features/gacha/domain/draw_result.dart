import '../../../core/domain/rarity.dart';
import '../../../core/utils/format.dart';
import 'gacha_grade.dart';
import 'gacha_models.dart';

/// 뽑기 결과 상품 1개 (`POST /draws` results[]).
class DrawResult {
  final int drawId;
  final int? inventoryItemId;
  final int itemId;
  final String name;
  final Rarity rarity;
  final int estimatedValue;
  final int exchangeValue;
  final String? imageUrl;

  /// 천장으로 확정된 결과.
  final bool isPity;

  /// 10+1 보너스로 받은 결과.
  final bool isBonus;

  const DrawResult({
    required this.drawId,
    required this.itemId,
    required this.name,
    required this.rarity,
    required this.estimatedValue,
    required this.exchangeValue,
    this.inventoryItemId,
    this.imageUrl,
    this.isPity = false,
    this.isBonus = false,
  });

  /// 연출 엔진 등급.
  GachaGrade get grade => GachaGrade.fromRarity(rarity);

  factory DrawResult.fromJson(Map<String, dynamic> json) {
    final value = asInt(json['estimatedValue']);
    return DrawResult(
      drawId: asInt(json['drawId']),
      inventoryItemId: asIntOrNull(json['inventoryItemId']),
      itemId: asInt(json['itemId']),
      name: asStringOrNull(json['name']) ?? '',
      rarity: Rarity.fromCode(json['rarity']),
      estimatedValue: value,
      // 구버전 서버: exchangeValue가 없으면 0으로 두고 전환 버튼을 숨긴다.
      exchangeValue: asInt(json['exchangeValue']),
      imageUrl: asStringOrNull(json['imageUrl']),
      isPity: asBool(json['isPity']),
      isBonus: asBool(json['isBonus']),
    );
  }
}

/// `POST /draws` 전체 응답.
class DrawOutcome {
  final int gachaId;
  final int count;
  final int bonusCount;
  final int spent;
  final int? balanceAfter;
  final Rarity highestRarity;
  final PityStatus? pity;
  final List<DrawResult> results;

  const DrawOutcome({
    required this.gachaId,
    required this.count,
    required this.bonusCount,
    required this.spent,
    required this.balanceAfter,
    required this.highestRarity,
    required this.pity,
    required this.results,
  });

  factory DrawOutcome.fromJson(Map<String, dynamic> json) {
    final results = asMapList(
      json['results'],
    ).map(DrawResult.fromJson).toList();
    final highestFromResults = results.isEmpty
        ? Rarity.n
        : results
              .map((r) => r.rarity)
              .reduce((a, b) => a.rank >= b.rank ? a : b);
    final pityRaw = json['pity'];
    return DrawOutcome(
      gachaId: asInt(json['gachaId']),
      count: asInt(json['count'], results.length),
      bonusCount: asInt(json['bonusCount']),
      spent: asInt(json['spent']),
      balanceAfter: asIntOrNull(json['balanceAfter']),
      highestRarity: json['highestRarity'] != null
          ? Rarity.fromCode(json['highestRarity'])
          : highestFromResults,
      pity: pityRaw is Map<String, dynamic>
          ? PityStatus.fromJson(pityRaw)
          : null,
      results: results,
    );
  }

  /// 희귀한 순으로 정렬한 결과.
  List<DrawResult> get sortedResults => [...results]
    ..sort((a, b) {
      final byRarity = Rarity.rarestFirst(a.rarity, b.rarity);
      return byRarity != 0
          ? byRarity
          : b.estimatedValue.compareTo(a.estimatedValue);
    });

  DrawResult? get best => results.isEmpty ? null : sortedResults.first;

  int get totalValue => results.fold(0, (s, r) => s + r.estimatedValue);
  int get totalExchange => results.fold(0, (s, r) => s + r.exchangeValue);

  List<int> get inventoryItemIds =>
      results.map((r) => r.inventoryItemId).whereType<int>().toList();
}
