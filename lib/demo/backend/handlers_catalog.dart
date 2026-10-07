part of 'demo_backend.dart';

/// 박스·뽑기·배너·랭킹.
/// 원본: gacha.service.ts, draws.service.ts, banners.service.ts,
/// rankings.service.ts.
extension _CatalogHandlers on DemoBackend {
  // ── gacha.service.ts ──────────────────────────────────────────────

  /// 서버 응답 모양을 지키면서 체험판 판매 상태로 덮어쓴다.
  Map<String, dynamic> _withStock(Map<String, dynamic> snapshot, int gachaId) {
    final state = _db.gachas[gachaId]!;
    return {
      ...snapshot,
      'active': state.active,
      'totalStock': state.totalStock,
      'soldStock': state.soldCount,
      'soldOut': state.soldCount >= state.totalStock,
    };
  }

  Map<String, dynamic> _listGachas(Map<String, String> q) {
    final (page, limit) = _paging(q);
    final active = _catalog.gachas
        .where((g) => _db.gachas[g['id'] as int]!.active)
        .toList();
    return {
      'items': [
        for (final g in DemoBackend._pageOf(active, page, limit))
          _withStock(g, g['id'] as int),
      ],
      'page': page,
      'limit': limit,
      'totalCount': active.length,
    };
  }

  /// 서버 findOne/getOdds/getPity는 판매 중지 박스도 보여준다.
  Map<String, dynamic> _gachaOrThrow(int id) {
    final detail = _catalog.details[id];
    if (detail == null) throw _Fail(404, 10004, 'Gacha not found');
    return detail;
  }

  Map<String, dynamic> _gachaDetail(int id) =>
      _withStock(_gachaOrThrow(id), id);

  /// 확률 공시는 스냅샷 그대로(판매량과 무관).
  Map<String, dynamic> _gachaOdds(int id) {
    _gachaOrThrow(id);
    return _catalog.odds[id]!;
  }

  Map<String, dynamic> _gachaPity(DemoUser user, int id) {
    final detail = _gachaOrThrow(id);
    return {
      'gachaId': id,
      ...pityProgress(
        (detail['pityThreshold'] as num?)?.toInt(),
        _db.pity['${user.id}:$id'] ?? 0,
      ),
    };
  }

  // ── draws.service.ts ──────────────────────────────────────────────

  /// count회 유료 뽑기 + 10+1 보너스. 검사 순서·응답이 서버와 같다.
  Map<String, dynamic> _createDraw(DemoUser user, Map<String, dynamic> body) {
    final c = _Check(body);
    final gachaId = c.integer('gachaId', min: 1);
    final count = c.integer('count', optional: true, min: 1, max: 100) ?? 1;
    c.done();

    // 2. 박스 확인.
    final summary = _catalog.summaryOf(gachaId!);
    final state = _db.gachas[gachaId];
    if (summary == null || state == null || !state.active) {
      throw _Fail(404, 10004, 'Gacha not found or inactive');
    }
    final pool = _catalog.pools[gachaId] ?? const <PoolItem>[];
    if (pool.isEmpty) throw _Fail(409, 10005, 'Gacha pool is empty');

    // 3. 잔액(유료분만), 재고(보너스 포함).
    final price = (summary['price'] as num).toInt();
    final totalCost = price * count;
    if (user.coinBalance < totalCost) {
      throw _Fail(400, 10006, 'Insufficient balance');
    }
    final boxesNeeded = count + bonusDrawsFor(count);
    if (state.soldCount + boxesNeeded > state.totalStock) {
      throw _soldOut(state.totalStock - state.soldCount);
    }

    // 4. 천장 진행도로 결과를 정한다(Random.secure).
    final pityKey = '${user.id}:$gachaId';
    final threshold = (summary['pityThreshold'] as num?)?.toInt();
    final plan = planDraws<PoolItem>(
      pool: pool,
      paidCount: count,
      pityThreshold: threshold,
      drawsSinceTopTier: _db.pity[pityKey] ?? 0,
      rng: _random.nextInt,
    );

    final draws = <DemoDraw>[];
    final rows = <DemoInventoryItem>[];
    for (final planned in plan.draws) {
      final draw = DemoDraw(
        id: _db.nextId('draws'),
        userId: user.id,
        gachaId: gachaId,
        spent: planned.isBonus ? 0 : price,
        isPity: planned.isPity,
        isBonus: planned.isBonus,
        createdAt: _now,
      );
      draws.add(draw);
    }
    for (final (i, planned) in plan.draws.indexed) {
      rows.add(
        DemoInventoryItem(
          id: _db.nextId('inventory_items'),
          userId: user.id,
          itemId: planned.entry.itemId,
          drawId: draws[i].id,
          createdAt: _now,
        ),
      );
    }
    _db.draws.addAll(draws);
    _db.inventory.addAll(rows);
    _db.pity[pityKey] = plan.drawsSinceTopTier;

    // 5. 잔액을 한 번에 빼고 내역 한 줄.
    user.coinBalance -= totalCost;
    final title = summary['title'] as String;
    final bonusLabel = plan.bonusCount > 0 ? ' (+${plan.bonusCount} 보너스)' : '';
    _ledger(
      user,
      type: 'USE',
      reason: 'DRAW',
      amount: -totalCost,
      description: count > 1 ? '$title 뽑기 x$count$bonusLabel' : '$title 뽑기',
    );

    // 6. 재고 차감(실제로 열린 수, 보너스 포함).
    state.soldCount += plan.draws.length;

    final results = [
      for (final (i, planned) in plan.draws.indexed)
        {
          'drawId': draws[i].id,
          'inventoryItemId': rows[i].id,
          'itemId': planned.entry.itemId,
          'name': planned.entry.name,
          'rarity': planned.entry.rarity,
          'estimatedValue': planned.entry.estimatedValue,
          'exchangeValue': exchangeValueOf(planned.entry.estimatedValue),
          'imageUrl': planned.entry.imageUrl,
          'isPity': planned.isPity,
          'isBonus': planned.isBonus,
          'createdAt': DemoBackend._iso(draws[i].createdAt),
        },
    ];
    return {
      'gachaId': gachaId,
      'userId': user.id,
      'count': count,
      'bonusCount': plan.bonusCount,
      'totalResults': results.length,
      'spent': totalCost,
      'currency': summary['currency'],
      'balanceAfter': user.coinBalance,
      'highestRarity': highestRarity([
        for (final r in results) r['rarity'] as String,
      ]),
      'pity': pityProgress(threshold, plan.drawsSinceTopTier),
      'stock': {
        'totalStock': state.totalStock,
        'soldStock': state.soldCount,
        'remaining': state.totalStock - state.soldCount,
      },
      'results': results,
    };
  }

  static _Fail _soldOut(int remaining) {
    final left = max(0, remaining);
    return _Fail(409, 10009, left == 0 ? 'Sold out' : 'Only $left boxes left', [
      'remaining:$left',
    ]);
  }

  // ── banners.service.ts ────────────────────────────────────────────

  Map<String, dynamic> _bannerResponse(DemoBanner b) => {
    'id': b.id,
    'title': b.title,
    'subtitle': b.subtitle,
    'badge': b.badge,
    'imageUrl': b.imageUrl,
    'accentColorHex': b.accentColorHex,
    'link': {'type': b.linkType, 'target': b.linkTarget},
    'startsAt': DemoBackend._isoOrNull(b.startsAt),
    'endsAt': DemoBackend._isoOrNull(b.endsAt),
  };

  static int _bannerOrder(DemoBanner a, DemoBanner b) {
    final byPriority = a.priority.compareTo(b.priority);
    return byPriority != 0 ? byPriority : a.id.compareTo(b.id);
  }

  /// 켜져 있고 노출 기간 안인 배너, 우선순위 순.
  Map<String, dynamic> _activeBanners() {
    final rows =
        _db.banners
            .where(
              (b) =>
                  b.active &&
                  (b.startsAt == null || !b.startsAt!.isAfter(_now)) &&
                  (b.endsAt == null || b.endsAt!.isAfter(_now)),
            )
            .toList()
          ..sort(_bannerOrder);
    return {
      'items': [for (final b in rows) _bannerResponse(b)],
    };
  }

  // ── rankings.service.ts (이 기기의 기록만) ─────────────────────────

  Map<String, dynamic> _rankUsers(int limit) {
    final byUser = <int, ({int draws, int value})>{};
    final invByDraw = {for (final i in _db.inventory) i.drawId: i};
    for (final d in _db.draws) {
      final inv = invByDraw[d.id];
      final value = inv == null
          ? 0
          : _catalog.items[inv.itemId]?.estimatedValue ?? 0;
      final prev = byUser[d.userId] ?? (draws: 0, value: 0);
      byUser[d.userId] = (draws: prev.draws + 1, value: prev.value + value);
    }
    final rows = byUser.entries.toList()
      ..sort((a, b) {
        final byValue = b.value.value.compareTo(a.value.value);
        return byValue != 0 ? byValue : b.value.draws.compareTo(a.value.draws);
      });
    return {
      'items': [
        for (final (i, e) in rows.take(limit).indexed)
          {
            'rank': i + 1,
            'userId': e.key,
            'nickname': _userById(e.key)?.nickname ?? '',
            'drawCount': e.value.draws,
            'totalValue': e.value.value,
          },
      ],
    };
  }

  Map<String, dynamic> _rankGachas(int limit) {
    final counts = <int, int>{};
    for (final d in _db.draws) {
      if (_db.gachas[d.gachaId]?.active ?? false) {
        counts[d.gachaId] = (counts[d.gachaId] ?? 0) + 1;
      }
    }
    final rows = counts.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    return {
      'items': [
        for (final (i, e) in rows.take(limit).indexed)
          {
            'rank': i + 1,
            'gachaId': e.key,
            'title': _catalog.summaryOf(e.key)!['title'],
            'imageUrl': _catalog.summaryOf(e.key)!['imageUrl'],
            'accentColorHex': _catalog.summaryOf(e.key)!['accentColorHex'],
            'price': _catalog.summaryOf(e.key)!['price'],
            'drawCount': e.value,
          },
      ],
    };
  }

  Map<String, dynamic> _recentWins(int limit) {
    final rows = [..._db.inventory]..sort(_AccountHandlers._newestFirst);
    final gachaOfDraw = {for (final d in _db.draws) d.id: d.gachaId};
    return {
      'items': [
        for (final row in rows.take(limit))
          {
            'inventoryItemId': row.id,
            'nickname': _maskNickname(_userById(row.userId)?.nickname ?? ''),
            'gachaTitle':
                _catalog.summaryOf(gachaOfDraw[row.drawId] ?? 0)?['title'] ??
                '',
            'itemName': _catalog.items[row.itemId]!.name,
            'rarity': _catalog.items[row.itemId]!.rarity,
            'estimatedValue': _catalog.items[row.itemId]!.estimatedValue,
            'imageUrl': _catalog.items[row.itemId]!.imageUrl,
            'wonAt': DemoBackend._iso(row.createdAt),
          },
      ],
    };
  }

  /// "김철수" → "김**".
  static String _maskNickname(String nickname) {
    if (nickname.length <= 1) return nickname;
    return nickname[0] + '*' * min(nickname.length - 1, 2);
  }
}
