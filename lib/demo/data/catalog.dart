import 'dart:convert';

import '../engine/rules.dart';

/// 실제 서버에서 찍어 둔 카탈로그(`assets/demo/catalog.json`).
///
/// 응답은 서버가 준 모양 그대로 들고 있다가, 판매량(soldStock)처럼 체험판
/// 안에서 바뀌는 값만 덮어써서 돌려준다.
class DemoCatalog {
  /// 스냅샷을 찍은 서버와 시각(ISO-8601).
  final String source;
  final String snapshotAt;

  /// `GET /gachas` items (id 오름차순).
  final List<Map<String, dynamic>> gachas;

  /// `GET /gachas/:id`.
  final Map<int, Map<String, dynamic>> details;

  /// `GET /gachas/:id/odds`.
  final Map<int, Map<String, dynamic>> odds;

  /// 박스별 뽑기 풀(gacha_items id 순서 대신 itemId 순서, 확률은 같다).
  final Map<int, List<PoolItem>> pools;

  /// itemId → 상품.
  final Map<int, PoolItem> items;

  /// `GET /banners` items + 운영 정보(priority/active).
  final List<Map<String, dynamic>> banners;

  /// 충전 패키지 `{id, price, gp, bonusGp}`.
  final List<Map<String, dynamic>> packages;
  final double firstTopupRate;
  final int firstTopupMaxGp;

  DemoCatalog._({
    required this.source,
    required this.snapshotAt,
    required this.gachas,
    required this.details,
    required this.odds,
    required this.pools,
    required this.items,
    required this.banners,
    required this.packages,
    required this.firstTopupRate,
    required this.firstTopupMaxGp,
  });

  factory DemoCatalog.fromJsonString(String raw) =>
      DemoCatalog.fromJson(jsonDecode(raw) as Map<String, dynamic>);

  factory DemoCatalog.fromJson(Map<String, dynamic> json) {
    Map<String, dynamic> map(Object? v) => (v as Map).cast<String, dynamic>();
    List<Map<String, dynamic>> list(Object? v) => (v as List).map(map).toList();

    final gachas = list(json['gachas'])
      ..sort((a, b) => (a['id'] as num).compareTo(b['id'] as num));
    final details = <int, Map<String, dynamic>>{
      for (final e in map(json['details']).entries)
        int.parse(e.key): map(e.value),
    };
    final odds = <int, Map<String, dynamic>>{
      for (final e in map(json['odds']).entries) int.parse(e.key): map(e.value),
    };
    final pools = <int, List<PoolItem>>{};
    final items = <int, PoolItem>{};
    for (final entry in odds.entries) {
      final pool =
          list(
              entry.value['items'],
            ).map((i) => PoolItem.fromJson(entry.key, i)).toList()
            ..sort((a, b) => a.itemId.compareTo(b.itemId));
      pools[entry.key] = pool;
      for (final item in pool) {
        items[item.itemId] = item;
      }
    }
    final meta = json['bannerMeta'] is Map
        ? map(json['bannerMeta'])
        : const <String, dynamic>{};
    final banners = [
      for (final (i, b) in list(json['banners']).indexed)
        {
          ...b,
          'priority': (meta['${b['id']}'] as Map?)?['priority'] ?? (i + 1) * 10,
          'active': (meta['${b['id']}'] as Map?)?['active'] ?? true,
        },
    ];
    final payments = map(json['payments']);
    final first = map(payments['firstTopupBonus']);
    return DemoCatalog._(
      source: json['source']?.toString() ?? '',
      snapshotAt: json['snapshotAt']?.toString() ?? '',
      gachas: gachas,
      details: details,
      odds: odds,
      pools: pools,
      items: items,
      banners: banners,
      packages: list(payments['packages']),
      firstTopupRate:
          (first['rate'] as num?)?.toDouble() ?? firstTopupBonusRate,
      firstTopupMaxGp:
          (first['maxGp'] as num?)?.toInt() ?? firstTopupBonusMaxGp,
    );
  }

  Map<String, dynamic>? summaryOf(int gachaId) {
    for (final g in gachas) {
      if (g['id'] == gachaId) return g;
    }
    return null;
  }

  Map<String, dynamic>? packageOf(String id) {
    for (final p in packages) {
      if (p['id'] == id) return p;
    }
    return null;
  }
}

/// 뽑기 풀의 한 상품(서버 GachaItem + Item).
class PoolItem implements Weighted {
  final int gachaId;
  final int itemId;
  final String name;
  @override
  final String rarity;
  final int estimatedValue;
  final String? imageUrl;
  @override
  final int weight;

  const PoolItem({
    required this.gachaId,
    required this.itemId,
    required this.name,
    required this.rarity,
    required this.estimatedValue,
    required this.imageUrl,
    required this.weight,
  });

  factory PoolItem.fromJson(int gachaId, Map<String, dynamic> json) => PoolItem(
    gachaId: gachaId,
    itemId: (json['itemId'] as num).toInt(),
    name: json['name'] as String,
    rarity: json['rarity'] as String,
    estimatedValue: (json['estimatedValue'] as num).toInt(),
    imageUrl: json['imageUrl'] as String?,
    weight: (json['weight'] as num).toInt(),
  );

  EconomyEntry get economy => EconomyEntry(rarity, weight, estimatedValue);
}
