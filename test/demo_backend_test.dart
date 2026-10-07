import 'dart:io';
import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/core/network/token_storage.dart';
import 'package:gacha_vault/demo/backend/demo_backend.dart';
import 'package:gacha_vault/demo/backend/demo_http_client.dart';
import 'package:gacha_vault/demo/data/catalog.dart';
import 'package:gacha_vault/demo/data/demo_storage.dart';
import 'package:gacha_vault/demo/demo_config.dart';
import 'package:gacha_vault/demo/engine/rules.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// 체험판 백엔드가 서버 규칙을 그대로 따르는지 확인한다.
/// 카탈로그는 실제 서버에서 찍은 assets/demo/catalog.json.
void main() {
  final catalogJson = File('assets/demo/catalog.json').readAsStringSync();
  final catalog = DemoCatalog.fromJsonString(catalogJson);

  DemoBackend make({
    Random? random,
    DateTime Function()? clock,
    DemoStorage? storage,
  }) => DemoBackend(
    loadCatalog: () async => DemoCatalog.fromJsonString(catalogJson),
    storage: storage ?? MemoryDemoStorage(),
    random: random,
    clock: clock,
  );

  Future<String> login(
    DemoBackend b, {
    String email = DemoConfig.defaultEmail,
    String password = DemoConfig.defaultPassword,
  }) async {
    final r = await b.handle(
      'POST',
      '/auth/login',
      body: {'email': email, 'password': password},
    );
    expect(r.body['statusCode'], 10000, reason: '${r.body}');
    return (r.body['data'] as Map)['accessToken'] as String;
  }

  /// 성공 응답의 data.
  Future<Map<String, dynamic>> ok(
    DemoBackend b,
    String method,
    String url, {
    String? token,
    Object? body,
  }) async {
    final r = await b.handle(method, url, token: token, body: body);
    expect(r.body['statusCode'], 10000, reason: '$method $url → ${r.body}');
    return (r.body['data'] as Map).cast<String, dynamic>();
  }

  /// 실패 응답 본문.
  Future<Map<String, dynamic>> fails(
    DemoBackend b,
    String method,
    String url,
    int code, {
    String? token,
    Object? body,
  }) async {
    final r = await b.handle(method, url, token: token, body: body);
    expect(r.body['statusCode'], code, reason: '$method $url → ${r.body}');
    expect(r.body.containsKey('errors'), isTrue);
    expect(r.body['url'], isNotNull);
    return r.body;
  }

  group('카탈로그 스냅샷', () {
    test('실제 서버의 판매 박스 8개(9~16)와 배너·패키지를 담고 있다', () {
      expect(catalog.gachas.map((g) => g['id']), [
        9,
        10,
        11,
        12,
        13,
        14,
        15,
        16,
      ]);
      expect(catalog.banners, isNotEmpty);
      expect(catalog.packages.map((p) => p['id']), [
        'gp5000',
        'gp10000',
        'gp30000',
        'gp50000',
        'gp100000',
        'gp300000',
      ]);
      expect(catalog.firstTopupRate, firstTopupBonusRate);
      expect(catalog.firstTopupMaxGp, firstTopupBonusMaxGp);
    });

    test('옮긴 확률·기대값 계산이 서버가 공시한 값과 같다', () {
      for (final g in catalog.gachas) {
        final id = g['id'] as int;
        final odds = catalog.odds[id]!;
        final pool = catalog.pools[id]!;
        final entries = [for (final p in pool) p.economy];
        final total = totalWeight(entries.map((e) => e.weight));
        final price = (odds['price'] as num).toInt();
        final threshold = (g['pityThreshold'] as num?)?.toInt();

        for (final item in (odds['items'] as List).cast<Map>()) {
          expect(
            toPercent(probabilityOf(item['weight'] as int, total)),
            item['probabilityPercent'],
            reason: 'box $id item ${item['itemId']}',
          );
          expect(
            exchangeValueOf(item['estimatedValue'] as int),
            item['exchangeValue'],
          );
        }
        for (final tier in (odds['rarities'] as List).cast<Map>()) {
          final w = totalWeight(
            entries
                .where((e) => e.rarity == tier['rarity'])
                .map((e) => e.weight),
          );
          expect(toPercent(w / total), tier['probabilityPercent']);
        }
        final economy = summarizeEconomy(entries, price, threshold);
        final pity = odds['pity'] as Map;
        expect(
          toPercent(economy.pity.effectiveTopTierRate),
          pity['effectiveRatePercent'],
          reason: 'box $id effective SSR',
        );
        expect(
          jsRound(economy.pity.expectedDrawsToTopTier! * 10) / 10,
          pity['expectedDrawsToHit'],
        );
        final ev = odds['expectedValue'] as Map;
        expect(jsRound(economy.expectedValue), ev['perDraw']);
        expect(jsRound(economy.pity.expectedValue), ev['perDrawWithPity']);
        final payout = odds['payoutRatioPercent'] as Map;
        expect(roundRatioPercent(economy.payoutRatio), payout['singleDraw']);
        expect(
          roundRatioPercent(economy.multiDrawPayoutRatio),
          payout['multiDraw'],
        );
      }
    });
  });

  group('뽑기', () {
    test('Random.secure 가중치 추첨이 공시 확률과 맞는다(상품별, 5σ)', () {
      final rng = Random.secure();
      const n = 400000;
      for (final g in catalog.gachas) {
        final id = g['id'] as int;
        final pool = catalog.pools[id]!;
        final total = totalWeight(pool.map((p) => p.weight));
        final hits = <int, int>{};
        for (var i = 0; i < n; i++) {
          final picked = pickWeighted(pool, rng.nextInt);
          hits[picked.itemId] = (hits[picked.itemId] ?? 0) + 1;
        }
        for (final p in pool) {
          final expected = p.weight / total;
          final observed = (hits[p.itemId] ?? 0) / n;
          final sigma = sqrt(expected * (1 - expected) / n);
          expect(
            (observed - expected).abs(),
            lessThanOrEqualTo(5 * sigma + 1e-9),
            reason: 'box $id ${p.name}: $observed vs $expected',
          );
        }
      }
    });

    test('천장을 포함한 실질 SSR 비율이 공시한 실질 확률과 맞는다', () {
      final rng = Random.secure();
      // 천장이 낮은 박스 셋: 천장 효과가 크게 보인다.
      for (final id in [10, 9, 11]) {
        final pool = catalog.pools[id]!;
        final odds = catalog.odds[id]!;
        final threshold = (odds['pity'] as Map)['threshold'] as int;
        final effective =
            ((odds['pity'] as Map)['effectiveRatePercent'] as num) / 100;
        const n = 1500000;
        var counter = 0;
        var ssr = 0;
        var pityHits = 0;
        for (var i = 0; i < n; i++) {
          final plan = planDraws(
            pool: pool,
            paidCount: 1,
            pityThreshold: threshold,
            drawsSinceTopTier: counter,
            rng: rng.nextInt,
          );
          counter = plan.drawsSinceTopTier;
          if (plan.draws.single.entry.rarity == 'SSR') ssr++;
          if (plan.draws.single.isPity) pityHits++;
        }
        final observed = ssr / n;
        final sigma = sqrt(effective * (1 - effective) / n);
        expect(
          (observed - effective).abs(),
          lessThanOrEqualTo(5 * sigma),
          reason: 'box $id effective $observed vs $effective',
        );
        expect(pityHits, greaterThan(0));
      }
    });

    test('천장은 정확히 threshold번째 뽑기에서 SSR을 확정한다', () async {
      // SSR이 나오지 않는 난수: 언제나 마지막 칸(풀 마지막 상품은 N).
      final b = make(random: _LastSlot());
      final token = await login(b);
      b.state.users.first.coinBalance = 10000000;
      const box = 10; // 기프티콘 박스: 천장 300, 3,000 GP
      expect(catalog.pools[box]!.last.rarity, isNot('SSR'));

      var drawn = 0;
      for (final count in [100, 100, 72]) {
        final r = await ok(
          b,
          'POST',
          '/draws',
          token: token,
          body: {'gachaId': box, 'count': count},
        );
        final results = (r['results'] as List).cast<Map>();
        expect(results.where((x) => x['isPity'] == true), isEmpty);
        expect(results.where((x) => x['rarity'] == 'SSR'), isEmpty);
        drawn += results.length;
      }
      expect(drawn, 299);
      final pity = await ok(b, 'GET', '/gachas/$box/pity', token: token);
      expect(pity, {
        'gachaId': box,
        'threshold': 300,
        'drawsSinceTopTier': 299,
        'remaining': 1,
      });

      final r = await ok(
        b,
        'POST',
        '/draws',
        token: token,
        body: {'gachaId': box},
      );
      final hit = (r['results'] as List).single as Map;
      expect(hit['isPity'], isTrue);
      expect(hit['rarity'], 'SSR');
      expect(r['highestRarity'], 'SSR');
      expect(r['pity'], {
        'threshold': 300,
        'drawsSinceTopTier': 0,
        'remaining': 300,
      });
    });

    test('천장은 10+1 묶음 안에서도 정확한 순번에 걸린다(보너스 포함)', () {
      final pool = catalog.pools[10]!;
      final plan = planDraws(
        pool: pool,
        paidCount: 10,
        pityThreshold: 300,
        drawsSinceTopTier: 295,
        rng: (max) => max - 1,
      );
      expect(plan.draws.length, 11);
      expect(
        [for (final d in plan.draws) d.isPity],
        [
          false, false, false, false, true, // 296..300번째
          false, false, false, false, false, false,
        ],
      );
      expect(plan.draws[4].entry.rarity, 'SSR');
      expect(plan.draws.last.isBonus, isTrue);
      expect(plan.drawsSinceTopTier, 6);
    });

    test('10회는 11개, 20회는 22개(보너스 무료, 재고는 보너스 포함)', () async {
      final b = make();
      final token = await login(b);
      final before = await ok(b, 'GET', '/users/me', token: token);

      final r = await ok(
        b,
        'POST',
        '/draws',
        token: token,
        body: {'gachaId': 9, 'count': 10},
      );
      expect(r['count'], 10);
      expect(r['bonusCount'], 1);
      expect(r['totalResults'], 11);
      expect(r['spent'], 50000);
      expect(r['balanceAfter'], (before['coinBalance'] as int) - 50000);
      final results = (r['results'] as List).cast<Map>();
      expect(results.where((x) => x['isBonus'] == true).length, 1);
      expect(results.last['isBonus'], isTrue);
      expect(r['stock'], {
        'totalStock': 3000,
        'soldStock': 11,
        'remaining': 2989,
      });
      for (final x in results) {
        expect(x['exchangeValue'], exchangeValueOf(x['estimatedValue'] as int));
      }
      expect(
        r['highestRarity'],
        highestRarity([for (final x in results) x['rarity'] as String]),
      );

      final r2 = await ok(
        b,
        'POST',
        '/draws',
        token: token,
        body: {'gachaId': 10, 'count': 20},
      );
      expect(r2['totalResults'], 22);
      expect(r2['bonusCount'], 2);

      final detail = await ok(b, 'GET', '/gachas/9');
      expect(detail['soldStock'], 11);
      final stats = await ok(b, 'GET', '/draws/stats', token: token);
      expect(stats['totalDrawCount'], 33);
      final history = await ok(
        b,
        'GET',
        '/wallet/point-history?page=1&limit=5',
        token: token,
      );
      final first = (history['items'] as List).first as Map;
      expect(first['reason'], 'DRAW');
      expect(first['description'], '기프티콘 박스 뽑기 x20 (+2 보너스)');
      expect(first['amount'], -60000);
    });

    test('잔액 부족은 10006, 품절·수량 부족은 10009(remaining:N)', () async {
      final b = make();
      final token = await login(b);
      b.state.users.first.coinBalance = 4999;
      final poor = await fails(
        b,
        'POST',
        '/draws',
        10006,
        token: token,
        body: {'gachaId': 9},
      );
      expect(poor['message'], 'Insufficient balance');

      b.state.users.first.coinBalance = 1000000;
      b.state.gachas[9]!.totalStock = 5;
      final few = await fails(
        b,
        'POST',
        '/draws',
        10009,
        token: token,
        body: {'gachaId': 9, 'count': 10},
      );
      expect(few['message'], 'Only 5 boxes left');
      expect(few['errors'], ['remaining:5']);
      // 실패한 뽑기는 아무것도 바꾸지 않는다.
      final me = await ok(b, 'GET', '/users/me', token: token);
      expect(me['coinBalance'], 1000000);

      await ok(
        b,
        'POST',
        '/draws',
        token: token,
        body: {'gachaId': 9, 'count': 5},
      );
      final soldOut = await fails(
        b,
        'POST',
        '/draws',
        10009,
        token: token,
        body: {'gachaId': 9},
      );
      expect(soldOut['message'], 'Sold out');
      expect(soldOut['errors'], ['remaining:0']);
      final list = await ok(b, 'GET', '/gachas?page=1&limit=50');
      final box9 = (list['items'] as List).cast<Map>().firstWhere(
        (g) => g['id'] == 9,
      );
      expect(box9['soldOut'], isTrue);
      expect(box9['soldStock'], 5);

      // 없는 박스 / 잘못된 입력.
      await fails(
        b,
        'POST',
        '/draws',
        10004,
        token: token,
        body: {'gachaId': 999},
      );
      await fails(
        b,
        'POST',
        '/draws',
        10001,
        token: token,
        body: {'gachaId': 9, 'count': 101},
      );
    });
  });

  group('보관함', () {
    test('포인트 전환은 예상 가치의 80%(내림)이고 한 번만 된다', () async {
      final b = make();
      final token = await login(b);
      final r = await ok(
        b,
        'POST',
        '/draws',
        token: token,
        body: {'gachaId': 14, 'count': 1},
      );
      final won = (r['results'] as List).single as Map;
      final ex = await ok(
        b,
        'POST',
        '/inventory/exchange',
        token: token,
        body: {
          'inventoryItemIds': [won['inventoryItemId']],
        },
      );
      expect(ex['totalGp'], ((won['estimatedValue'] as int) * 0.8).floor());
      expect(
        ex['balanceAfter'],
        (r['balanceAfter'] as int) + (ex['totalGp'] as int),
      );

      final again = await fails(
        b,
        'POST',
        '/inventory/exchange',
        10005,
        token: token,
        body: {
          'inventoryItemIds': [won['inventoryItemId']],
        },
      );
      expect(again['message'], contains('not eligible for exchange'));
      final stored = await ok(
        b,
        'GET',
        '/inventory?page=1&limit=100',
        token: token,
      );
      expect(stored['items'], isEmpty);
      final exchanged = await ok(
        b,
        'GET',
        '/inventory?page=1&limit=100&status=EXCHANGED',
        token: token,
      );
      expect((exchanged['items'] as List).single['status'], 'EXCHANGED');

      final history = await ok(b, 'GET', '/wallet/point-history', token: token);
      final top = (history['items'] as List).first as Map;
      expect(top['reason'], 'EXCHANGE');
      expect(top['type'], 'EARN');
      expect(top['description'], '${won['name']} 포인트 전환');
    });

    test('배송 신청은 3,000 GP, 시뮬레이션은 체험판 택배로 배송 완료까지', () async {
      final b = make();
      final token = await login(b);
      final r = await ok(
        b,
        'POST',
        '/draws',
        token: token,
        body: {'gachaId': 10, 'count': 2},
      );
      final ids = [
        for (final x in (r['results'] as List).cast<Map>())
          x['inventoryItemId'],
      ];
      final s = await ok(
        b,
        'POST',
        '/shipping-requests',
        token: token,
        body: {
          'recipientName': '김체험',
          'phone': '010-1234-5678',
          'address': '서울시 어딘가 1',
          'inventoryItemIds': ids,
        },
      );
      expect(s['status'], 'REQUESTED');
      expect(s['deliveryFee'], 3000);
      expect(s['balanceAfter'], (r['balanceAfter'] as int) - 3000);

      final id = s['shippingRequestId'] as int;
      expect(await b.simulateShippingStep(token, id), 'SHIPPING');
      var list = await ok(
        b,
        'GET',
        '/shipping-requests?page=1&limit=50',
        token: token,
      );
      var row = (list['items'] as List).single as Map;
      expect(row['trackingCompany'], '체험판 택배');
      expect(row['trackingNumber'], startsWith('DEMO-'));
      expect(row['shippedAt'], isNotNull);
      final inv = await ok(b, 'GET', '/inventory', token: token);
      expect((inv['items'] as List).map((i) => (i as Map)['status']).toSet(), {
        'SHIPPING',
      });

      expect(await b.simulateShippingStep(token, id), 'DELIVERED');
      list = await ok(b, 'GET', '/shipping-requests', token: token);
      row = (list['items'] as List).single as Map;
      expect(row['status'], 'DELIVERED');
      expect(row['deliveredAt'], isNotNull);
      await expectLater(
        b.simulateShippingStep(token, id),
        throwsA(isA<DemoActionException>()),
      );

      // 배송 중 상품은 전환·재신청할 수 없다.
      await fails(
        b,
        'POST',
        '/inventory/exchange',
        10005,
        token: token,
        body: {'inventoryItemIds': ids},
      );
    });
  });

  group('출석체크(KST)', () {
    test('7일 주기 100/100/150/150/200/200/500, 같은 날은 10008, 빠지면 1일차', () async {
      var now = DateTime.utc(2026, 10, 6, 15); // KST 10/7 00:00
      final b = make(clock: () => now);
      final token = await login(b);

      final rewards = <int>[];
      for (var day = 0; day < 8; day++) {
        final status = await ok(b, 'GET', '/rewards/attendance', token: token);
        expect(status['checkedInToday'], isFalse);
        final r = await ok(b, 'POST', '/rewards/attendance', token: token);
        rewards.add(r['reward'] as int);
        expect(r['streakDay'], day % 7 + 1);
        await fails(b, 'POST', '/rewards/attendance', 10008, token: token);
        final after = await ok(b, 'GET', '/rewards/attendance', token: token);
        expect(after['checkedInToday'], isTrue);
        expect(after['streakDay'], day % 7 + 1);
        now = now.add(const Duration(days: 1));
      }
      expect(rewards, [100, 100, 150, 150, 200, 200, 500, 100]);

      // 8번째 출석은 KST 10/14. 10/15 23:59:59(KST)까지가 다음 날이다.
      now = DateTime.utc(2026, 10, 15, 14, 59, 59);
      final day2 = await ok(b, 'POST', '/rewards/attendance', token: token);
      expect(day2['checkinDate'], '2026-10-15');
      expect(day2['streakDay'], 2);
      now = DateTime.utc(2026, 10, 15, 15); // KST 10/16 00:00
      expect(
        (await ok(b, 'GET', '/rewards/attendance', token: token))['today'],
        '2026-10-16',
      );
      now = DateTime.utc(2026, 10, 16, 15); // KST 10/17: 10/16을 빠뜨림
      final status = await ok(b, 'GET', '/rewards/attendance', token: token);
      expect(status['streakDay'], 0);
      expect(status['nextStreakDay'], 1);
      final r = await ok(b, 'POST', '/rewards/attendance', token: token);
      expect(r['streakDay'], 1);
      expect(r['reward'], 100);

      final history = await ok(b, 'GET', '/wallet/point-history', token: token);
      final top = (history['items'] as List).first as Map;
      expect(top['reason'], 'ATTENDANCE');
      expect(top['description'], '출석체크 1일차');
    });
  });

  group('충전', () {
    test('첫 충전 +20%(최대 10,000)와 대량 보너스를 서버처럼 지급한다', () async {
      final b = make();
      final token = await login(b);
      final config = await ok(b, 'GET', '/payments/config', token: token);
      expect(config['enabled'], isTrue);
      expect(config['firstTopupBonus'], {
        'rate': 0.2,
        'maxGp': 10000,
        'eligible': true,
      });
      expect(
        [
          for (final p in (config['packages'] as List).cast<Map>())
            p['firstTopupBonusGp'],
        ],
        [1000, 2000, 6000, 10000, 10000, 10000],
      );

      final order = await ok(
        b,
        'POST',
        '/payments/orders',
        token: token,
        body: {'packageId': 'gp50000'},
      );
      expect(order['orderId'], matches(RegExp(r'^GV[0-9a-f]{32}$')));
      expect(order['orderName'], '가치가차 50,000 GP');
      expect(order['amount'], 50000);
      expect(order['bonusGp'], 1000);
      expect(order['firstTopupBonusGp'], 10000);

      final before = await ok(b, 'GET', '/users/me', token: token);
      final confirm = {
        'paymentKey': 'demo_abc',
        'orderId': order['orderId'],
        'amount': 50000,
      };
      final done = await ok(
        b,
        'POST',
        '/payments/confirm',
        token: token,
        body: confirm,
      );
      expect(done['status'], 'DONE');
      expect(done['gp'], 50000);
      expect(done['bonusGp'], 1000);
      expect(done['firstTopupBonusGp'], 10000);
      expect(done['totalGp'], 61000);
      expect(done['balanceAfter'], (before['coinBalance'] as int) + 61000);

      // 같은 값으로 다시 불러도 한 번만 지급한다.
      final again = await ok(
        b,
        'POST',
        '/payments/confirm',
        token: token,
        body: confirm,
      );
      expect(again['balanceAfter'], done['balanceAfter']);

      final history = await ok(
        b,
        'GET',
        '/wallet/point-history?limit=3',
        token: token,
      );
      expect(
        [
          for (final h in (history['items'] as List).cast<Map>())
            '${h['reason']} ${h['amount']} ${h['description']}',
        ],
        [
          'BONUS 10000 첫 충전 보너스',
          'BONUS 1000 대량 충전 보너스',
          'TOPUP 50000 GP 충전 (50,000원 결제)',
        ],
      );

      // 두 번째 결제는 첫 충전 보너스가 없다.
      final config2 = await ok(b, 'GET', '/payments/config', token: token);
      expect((config2['firstTopupBonus'] as Map)['eligible'], isFalse);
      final o2 = await ok(
        b,
        'POST',
        '/payments/orders',
        token: token,
        body: {'packageId': 'gp10000'},
      );
      expect(o2['firstTopupBonusGp'], 0);
      final d2 = await ok(
        b,
        'POST',
        '/payments/confirm',
        token: token,
        body: {
          'paymentKey': 'demo_2',
          'orderId': o2['orderId'],
          'amount': 10000,
        },
      );
      expect(d2['totalGp'], 10000);

      // 금액이 다르면 승인하지 않고 주문은 FAILED로 남는다.
      final o3 = await ok(
        b,
        'POST',
        '/payments/orders',
        token: token,
        body: {'packageId': 'gp5000'},
      );
      final bad = await fails(
        b,
        'POST',
        '/payments/confirm',
        10014,
        token: token,
        body: {'paymentKey': 'demo_3', 'orderId': o3['orderId'], 'amount': 1},
      );
      expect(bad['message'], 'Amount does not match the order');
      final orders = await ok(b, 'GET', '/payments/orders', token: token);
      expect(
        [for (final o in (orders['items'] as List).cast<Map>()) o['status']],
        ['FAILED', 'DONE', 'DONE'],
      );
      await fails(
        b,
        'POST',
        '/payments/confirm',
        10005,
        token: token,
        body: {
          'paymentKey': 'demo_3',
          'orderId': o3['orderId'],
          'amount': 5000,
        },
      );
    });

    test('월 충전 한도: 낮추면 즉시, 올리면 7일 뒤, 넘으면 10007', () async {
      var now = DateTime.utc(2026, 10, 7, 3);
      final b = make(clock: () => now);
      final token = await login(b);

      var limit = await ok(
        b,
        'PUT',
        '/wallet/limit',
        token: token,
        body: {'monthlyLimit': 30000},
      );
      expect(limit['monthlyLimit'], 30000);
      expect(limit['pending'], isNull);

      final o = await ok(
        b,
        'POST',
        '/payments/orders',
        token: token,
        body: {'packageId': 'gp30000'},
      );
      await ok(
        b,
        'POST',
        '/payments/confirm',
        token: token,
        body: {
          'paymentKey': 'demo_x',
          'orderId': o['orderId'],
          'amount': 30000,
        },
      );
      limit = await ok(b, 'GET', '/wallet/limit', token: token);
      // 첫 충전 보너스(BONUS)는 한도에 넣지 않는다.
      expect(limit['usedThisMonth'], 30000);
      expect(limit['remainingThisMonth'], 0);

      final over = await fails(
        b,
        'POST',
        '/payments/orders',
        10007,
        token: token,
        body: {'packageId': 'gp5000'},
      );
      expect(over['errors'], ['remaining:0']);

      limit = await ok(
        b,
        'PUT',
        '/wallet/limit',
        token: token,
        body: {'monthlyLimit': 100000},
      );
      expect(limit['monthlyLimit'], 30000);
      expect((limit['pending'] as Map)['monthlyLimit'], 100000);
      expect(
        (limit['pending'] as Map)['effectiveAt'],
        DateTime.utc(2026, 10, 14, 3).toIso8601String(),
      );

      now = DateTime.utc(2026, 10, 14, 3);
      limit = await ok(b, 'GET', '/wallet/limit', token: token);
      expect(limit['monthlyLimit'], 100000);
      expect(limit['pending'], isNull);
      expect(limit['remainingThisMonth'], 70000);

      // 해제(null)도 7일 뒤.
      limit = await ok(
        b,
        'PUT',
        '/wallet/limit',
        token: token,
        body: {'monthlyLimit': null},
      );
      expect(limit['monthlyLimit'], 100000);
      expect((limit['pending'] as Map)['monthlyLimit'], isNull);

      // 다음 달(KST)에는 사용액이 0부터.
      now = DateTime.utc(2026, 10, 31, 15); // KST 11/1 00:00
      limit = await ok(b, 'GET', '/wallet/limit', token: token);
      expect(limit['usedThisMonth'], 0);
    });
  });

  group('계정·운영자·저장', () {
    test('가입은 3,000 GP·필수 동의 10010·중복 10005, 소셜은 없음', () async {
      final b = make();
      final providers = await ok(b, 'GET', '/auth/providers');
      expect(providers['providers'], isEmpty);

      await fails(
        b,
        'POST',
        '/auth/signup',
        10010,
        body: {
          'email': 'new@gachigacha.app',
          'password': 'abcd1234',
          'nickname': '새손님',
        },
      );
      final s = await ok(
        b,
        'POST',
        '/auth/signup',
        body: {
          'email': 'new@gachigacha.app',
          'password': 'abcd1234',
          'nickname': '새손님',
          'agreeTerms': true,
          'agreePrivacy': true,
          'agreeAge14': true,
        },
      );
      expect(s['welcomeGp'], 3000);
      await fails(
        b,
        'POST',
        '/auth/signup',
        10005,
        body: {
          'email': 'new@gachigacha.app',
          'password': 'abcd1234',
          'nickname': '새손님',
          'agreeTerms': true,
          'agreePrivacy': true,
          'agreeAge14': true,
        },
      );
      final token = await login(
        b,
        email: 'new@gachigacha.app',
        password: 'abcd1234',
      );
      final me = await ok(b, 'GET', '/users/me', token: token);
      expect(me['coinBalance'], 3000);
      expect(me['role'], 'USER');
      final wrong = await fails(
        b,
        'POST',
        '/auth/login',
        10002,
        body: {'email': 'new@gachigacha.app', 'password': 'abcd12345'},
      );
      expect(wrong['message'], 'Invalid email or password');
      await fails(
        b,
        'POST',
        '/auth/social-login',
        10012,
        body: {'provider': 'KAKAO', 'token': 'xxxxxxxxxxxx'},
      );
      await fails(b, 'GET', '/users/me', 10002, token: 'nope');
    });

    test('운영자 모드 체험: 권한 전에는 10003, 켜면 로컬 데이터로 통계', () async {
      final b = make();
      final token = await login(b);
      await fails(b, 'GET', '/admin/stats', 10003, token: token);

      await ok(
        b,
        'POST',
        '/draws',
        token: token,
        body: {'gachaId': 9, 'count': 10},
      );
      final o = await ok(
        b,
        'POST',
        '/payments/orders',
        token: token,
        body: {'packageId': 'gp10000'},
      );
      await ok(
        b,
        'POST',
        '/payments/confirm',
        token: token,
        body: {
          'paymentKey': 'demo_a',
          'orderId': o['orderId'],
          'amount': 10000,
        },
      );

      await b.setAdmin(token, true);
      expect((await ok(b, 'GET', '/users/me', token: token))['role'], 'ADMIN');
      final stats = await ok(b, 'GET', '/admin/stats', token: token);
      expect(stats['today'], {
        'revenue': 10000,
        'payingUsers': 1,
        'draws': 11,
        'gpSpentOnDraws': 50000,
        'newUsers': 1,
      });
      expect((stats['total'] as Map)['users'], 1);
      expect(
        (stats['total'] as Map)['gpOutstanding'],
        (await ok(b, 'GET', '/users/me', token: token))['coinBalance'],
      );

      final gachas = await ok(b, 'GET', '/admin/gachas', token: token);
      final box9 = (gachas['items'] as List).cast<Map>().first;
      expect(box9['soldCount'], 11);
      expect(box9['revenueGp'], 55000);
      expect(box9['payoutRatioPercent'], {'singleDraw': 90, 'multiDraw': 99});

      await ok(
        b,
        'PATCH',
        '/admin/gachas/9',
        token: token,
        body: {'active': false},
      );
      final list = await ok(b, 'GET', '/gachas');
      expect(
        (list['items'] as List).map((g) => (g as Map)['id']),
        isNot(contains(9)),
      );
      await fails(
        b,
        'POST',
        '/draws',
        10004,
        token: token,
        body: {'gachaId': 9},
      );
      final tooSmall = await fails(
        b,
        'PATCH',
        '/admin/gachas/10',
        10001,
        token: token,
        body: {'totalStock': -1},
      );
      expect(tooSmall['errors'], isNotEmpty);

      final payments = await ok(
        b,
        'GET',
        '/admin/payments?page=1&limit=50',
        token: token,
      );
      expect((payments['items'] as List).single['status'], 'DONE');

      await b.setAdmin(token, false);
      await fails(b, 'GET', '/admin/stats', 10003, token: token);
    });

    test('상태는 저장소에 남아 새로 열어도 이어지고, 초기화하면 처음으로', () async {
      final storage = MemoryDemoStorage();
      final b1 = make(storage: storage);
      final token = await login(b1);
      final r = await ok(
        b1,
        'POST',
        '/draws',
        token: token,
        body: {'gachaId': 10},
      );

      final b2 = make(storage: storage);
      final me = await ok(b2, 'GET', '/users/me', token: token);
      expect(me['coinBalance'], r['balanceAfter']);
      final inv = await ok(b2, 'GET', '/inventory', token: token);
      expect((inv['items'] as List).length, 1);

      await b2.reset();
      await fails(b2, 'GET', '/users/me', 10002, token: token);
      final fresh = await login(b2);
      final again = await ok(b2, 'GET', '/users/me', token: fresh);
      expect(again['coinBalance'], DemoConfig.defaultBalance);
      expect((await ok(b2, 'GET', '/gachas/10'))['soldStock'], 0);
    });

    test('ApiClient가 DemoHttpClient로 서버와 같은 봉투를 해석한다', () async {
      SharedPreferences.setMockInitialValues({});
      final b = make();
      const tokens = TokenStorage();
      final api = ApiClient(
        httpClient: DemoHttpClient(b),
        tokenStorage: tokens,
      );
      final session = await api.post(
        '/auth/login',
        body: {
          'email': DemoConfig.defaultEmail,
          'password': DemoConfig.defaultPassword,
        },
        withAuth: false,
      );
      await tokens.saveToken((session as Map)['accessToken'] as String);
      final me = await api.get('/users/me') as Map;
      expect(me['coinBalance'], DemoConfig.defaultBalance);

      try {
        await api.post('/draws', body: {'gachaId': 16, 'count': 3});
        fail('should throw');
      } on ApiException catch (e) {
        expect(e.statusCode, ApiCode.insufficientBalance);
        expect(e.displayMessage, 'GP가 부족해요');
      }
      try {
        await api.post('/rewards/attendance');
        await api.post('/rewards/attendance');
        fail('should throw');
      } on ApiException catch (e) {
        expect(e.statusCode, ApiCode.alreadyCheckedIn);
      }
    });

    test('랭킹·당첨 피드는 이 기기의 기록만(없으면 빈 목록)', () async {
      final b = make();
      expect((await ok(b, 'GET', '/rankings/wins'))['items'], isEmpty);
      expect((await ok(b, 'GET', '/rankings/users'))['items'], isEmpty);
      expect((await ok(b, 'GET', '/rankings/gachas'))['items'], isEmpty);
      final token = await login(b);
      await ok(
        b,
        'POST',
        '/draws',
        token: token,
        body: {'gachaId': 10, 'count': 2},
      );
      final wins = await ok(b, 'GET', '/rankings/wins');
      expect((wins['items'] as List).length, 2);
      expect((wins['items'] as List).first['nickname'], '체**');
      final users = await ok(b, 'GET', '/rankings/users');
      expect((users['items'] as List).single['drawCount'], 2);
    });
  });
}

/// 항상 마지막 칸을 고르는 난수(테스트용).
class _LastSlot implements Random {
  @override
  int nextInt(int max) => max - 1;
  @override
  double nextDouble() => 0.999;
  @override
  bool nextBool() => true;
}
