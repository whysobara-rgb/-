import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:provider/provider.dart';
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/features/orders/order_models.dart';
import 'package:gacha_vault/features/orders/order_flow_page.dart';
import 'package:gacha_vault/features/refunds/refund_models.dart';
import 'package:gacha_vault/shared/providers/auth_provider.dart';
import 'order_flow_test.dart' as support;

Map<String, dynamic> fixture() =>
    jsonDecode(
          File(
            'test/fixtures/stage4b3_refund_responses.json',
          ).readAsStringSync(),
        )
        as Map<String, dynamic>;

Future<void> mount(WidgetTester tester, Widget page) async {
  await tester.pumpWidget(
    ChangeNotifierProvider<AuthProvider>(
      create: (_) => support.TestAuth(),
      child: MaterialApp(home: page),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> tapVisible(WidgetTester tester, String label) async {
  await tester.scrollUntilVisible(find.text(label), 180);
  await tester.tap(find.text(label));
  await tester.pumpAndSettle();
}

void main() {
  test('actual PAID unopened purchase preserves every capsule and amount', () {
    final payload = fixture()['unopenedPurchase'];
    final order = Receipt(payload);
    expect(order.status, 'PAID');
    expect(order.quantity, 3);
    expect(order.total, 300);
    expect(order.unopenedCount, 3);
    expect(order.openedCount, 0);
    expect(order.refundedQuantity, 0);
    expect(order.hasRefund, isFalse);
    expect(order.capsules.every((c) => c.canOpen), isTrue);
  });

  test('actual PAID order with an opened capsule preserves its result', () {
    final f = fixture();
    final order = Receipt(f['refunds']['partial']['beforePayload']);
    final result = Opening(f['confirmedOpening']);
    expect(order.status, 'PAID');
    expect(order.openedCount, 1);
    expect(order.unopenedCount, 2);
    expect(order.capsules.singleWhere((c) => c.isOpened).id, result.capsuleId);
    expect(order.capsules.where((c) => c.canOpen).length, 2);
  });

  for (final kind in ['full', 'partial']) {
    test('actual $kind refund order decodes with separate capsule states', () {
      final sample = fixture()['refunds'][kind];
      final order = Receipt(sample['afterPayload']);
      final refundOrder = RefundOrder(sample['afterPayload']);
      expect(order.status, kind == 'full' ? 'REFUNDED' : 'PARTIALLY_REFUNDED');
      expect(order.status, refundOrder.summary.status);
      expect(order.refundedQuantity, kind == 'full' ? 1 : 2);
      expect(order.openedCount, kind == 'full' ? 0 : 1);
      expect(order.unopenedCount, 0);
      expect(order.capsules.any((c) => c.canOpen), isFalse);
      expect(
        order.capsules.where((c) => c.isRefunded).every((c) => !c.isOpened),
        isTrue,
      );
      final quote = RefundQuote(
        sample['quote'],
        RefundOrder(sample['beforePayload']),
        List<String>.from(sample['body']['capsuleIds']),
      );
      expect(quote.amount, RefundReceipt(sample['receipt']).amount);
    });

    test(
      'repository GET decodes actual $kind refund without mutation or recovery state',
      () async {
        final sample = fixture()['refunds'][kind];
        final payload = sample['afterPayload'];
        final store = support.MemoryStore();
        final calls = <http.Request>[];
        final repo = support.repository(store, (r) async {
          calls.add(r);
          expect(r.method, 'GET');
          expect(r.url.path, '/orders/${payload['orderId']}');
          return support.ok(payload);
        });
        final order = await repo.order(payload['orderId']);
        expect(order.status, payload['status']);
        expect(calls.length, 1);
        expect(store.values, isEmpty);
        expect(await repo.pendingOpening(), isNull);
        expect(await repo.pendingBatch(), isNull);
      },
    );

    test(
      'purchase recovery decodes actual $kind refund and clears only its pending purchase',
      () async {
        final f = fixture(), sample = f['refunds'][kind];
        final before = sample['beforePayload'], after = sample['afterPayload'];
        final store = support.MemoryStore();
        final repo = support.repository(store, (r) async {
          expect(r.method, 'POST');
          expect(r.url.path, '/orders/gp');
          expect(r.headers['idempotency-key'], sample['key']);
          return support.ok(after);
        });
        final pending = PendingPurchase(sample['key'], before['title'], {
          'gachaId': before['gachaId'],
          'quantity': before['quantity'],
          'expectedUnitPrice': before['unitPrice'],
          'expectedProbabilityVersion': before['probabilityVersion'],
        });
        await store.write(
          '${repo.scope}_purchase',
          jsonEncode(pending.toJson()),
        );
        final order = await repo.retryPurchase();
        expect(order.status, after['status']);
        expect(await repo.pendingPurchase(), isNull);
        expect(await repo.pendingOpening(), isNull);
        expect(await repo.pendingBatch(), isNull);
      },
    );

    testWidgets(
      'actual $kind refund receipt has no refunded open or recovery CTA',
      (tester) async {
        final f = fixture(), sample = f['refunds'][kind];
        final before = sample['beforePayload'], after = sample['afterPayload'];
        final calls = <http.Request>[];
        final store = support.MemoryStore();
        final repo = support.repository(store, (r) async {
          calls.add(r);
          if (r.url.path == '/orders/gp') return support.ok(after);
          if (r.url.path ==
              '/capsules/${f['confirmedOpening']['capsuleId']}/result') {
            expect(r.method, 'GET');
            return support.ok(f['confirmedOpening']);
          }
          throw StateError('Unexpected request ${r.method} ${r.url.path}');
        });
        await store.write(
          '${repo.scope}_purchase',
          jsonEncode(
            PendingPurchase(sample['key'], before['title'], {
              'gachaId': before['gachaId'],
              'quantity': before['quantity'],
              'expectedUnitPrice': before['unitPrice'],
              'expectedProbabilityVersion': before['probabilityVersion'],
            }).toJson(),
          ),
        );
        await mount(
          tester,
          OrderFlowPage(userId: 10, gachaId: 1, repository: repo),
        );
        await tapVisible(tester, '이전 구매 결과 확인');
        expect(
          find.text(kind == 'full' ? '전체 환불 완료' : '일부 환불 완료'),
          findsOneWidget,
        );
        expect(find.text('처리 결과 확인 중'), findsNothing);
        expect(find.text('캡슐 1개 개봉하기'), findsNothing);
        expect(find.text('이 캡슐 개봉 다시 요청'), findsNothing);
        expect(find.textContaining('번 미개봉 박스 확인'), findsNothing);
        expect(find.text('환불 완료'), findsWidgets);
        expect(await repo.pendingOpening(), isNull);
        expect(await repo.pendingBatch(), isNull);
        if (kind == 'partial') {
          await tapVisible(tester, '1번 박스 개봉 결과 보기');
          expect(
            find.text(f['confirmedOpening']['prize']['name']),
            findsOneWidget,
          );
          expect(find.text('1개 개봉 완료'), findsOneWidget);
          expect(calls.where((r) => r.url.path.endsWith('/result')).length, 1);
        }
        expect(calls.where((r) => r.url.path.endsWith('/open')), isEmpty);
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      'stale unopened list uses current $kind refunded capsule without open CTA',
      (tester) async {
        final f = fixture(), sample = f['refunds'][kind];
        final current = sample['afterPayload'];
        final refunded = (current['capsules'] as List).firstWhere(
          (dynamic c) => c['status'] == 'REFUNDED',
        );
        final stale = (sample['beforePayload']['capsules'] as List).singleWhere(
          (dynamic c) => c['id'] == refunded['id'],
        );
        final calls = <http.Request>[];
        final store = support.MemoryStore();
        final repo = support.repository(store, (r) async {
          calls.add(r);
          expect(r.method, 'GET');
          if (r.url.path == '/capsules') {
            return support.ok({
              'items': [stale],
              'page': 1,
              'limit': 20,
              'totalCount': 1,
            });
          }
          if (r.url.path == '/orders/${current['orderId']}') {
            return support.ok(current);
          }
          throw StateError('Unexpected read ${r.url.path}');
        });
        await mount(tester, OrderFlowPage(userId: 10, repository: repo));
        await tester.tap(find.byType(Checkbox));
        await tester.pumpAndSettle();
        expect(find.text('선택한 1개 개봉 · 0 GP'), findsOneWidget);
        await tester.tap(find.byTooltip('박스 정보 확인'));
        await tester.pumpAndSettle();
        expect(find.text('환불이 완료된 박스예요'), findsOneWidget);
        expect(find.text('캡슐 1개 개봉하기'), findsNothing);
        expect(find.text('선택한 1개 개봉 · 0 GP'), findsNothing);
        expect(find.text('처리 결과 확인 중'), findsNothing);
        expect(find.text('저장된 결과 다시 확인'), findsNothing);
        expect(calls.every((r) => r.method == 'GET'), isTrue);
        expect(store.values, isEmpty);
      },
    );
  }

  test(
    'partial refund preserves the confirmed prize, capsule and inventory reference',
    () {
      final f = fixture(), sample = f['refunds']['partial'];
      final before = Receipt(sample['beforePayload']);
      final after = Receipt(sample['afterPayload']);
      final resultBefore = Opening(f['confirmedOpening']);
      final resultAfter = Opening(f['confirmedOpening']);
      expect(
        after.capsules.singleWhere((c) => c.isOpened).id,
        before.capsules.singleWhere((c) => c.isOpened).id,
      );
      expect(resultAfter.toJson(), resultBefore.toJson());
      expect(resultAfter.inventoryId, 70);
      expect(resultAfter.prize.itemId, 2);
      expect(resultAfter.prize.rarity, 'SSR');
      expect(
        after.capsules.where((c) => c.isRefunded).map((c) => c.id),
        isNot(contains(resultAfter.capsuleId)),
      );
    },
  );

  test('capsule meaning stays separate from a partially refunded order', () {
    // Derived consistency case using only the observed capsule states.
    final payload = fixture()['refunds']['partial']['afterPayload'];
    payload['capsules'][2]['status'] = 'UNOPENED';
    payload['refundedQuantity'] = 1;
    final order = Receipt(payload);
    expect(order.status, 'PARTIALLY_REFUNDED');
    expect(order.capsules[0].isOpened, isTrue);
    expect(order.capsules[1].isRefunded, isTrue);
    expect(order.capsules[2].canOpen, isTrue);
    expect(order.unopenedCount, 1);
  });

  for (final bad in [
    'UNKNOWN',
    'PENDING',
    'SUCCEEDED',
    'REFUND_PENDING',
    '',
    null,
    1,
  ]) {
    test(
      'unsupported status $bad remains rejected at order and capsule boundary',
      () {
        final payload = fixture()['refunds']['full']['afterPayload'];
        expect(
          () => Receipt({...payload, 'status': bad}),
          throwsA(isA<ApiException>()),
        );
        expect(
          () => Capsule({...payload['capsules'][0], 'status': bad}),
          throwsA(isA<ApiException>()),
        );
      },
    );
  }

  test('order-only PARTIALLY_REFUNDED is never a capsule state', () {
    final c = fixture()['refunds']['partial']['afterPayload']['capsules'][0];
    expect(
      () => Capsule({...c, 'status': 'PARTIALLY_REFUNDED'}),
      throwsA(isA<ApiException>()),
    );
  });

  test('refund counts and order/capsule combinations remain strict', () {
    final full = fixture()['refunds']['full']['afterPayload'];
    final partial = fixture()['refunds']['partial']['afterPayload'];
    for (final malformed in [
      {...full, 'status': 'PAID'},
      {...full, 'status': 'PARTIALLY_REFUNDED'},
      {...partial, 'status': 'REFUNDED'},
      {...partial, 'refundedQuantity': 1},
      {...partial, 'refundedQuantity': null},
      <String, dynamic>{...full}..remove('refundedQuantity'),
      {...full, 'total': 1},
      {...partial, 'currency': 'KRW'},
    ]) {
      expect(() => Receipt(malformed), throwsA(isA<ApiException>()));
    }
  });

  test(
    'refunded capsule cannot leak into the unopened collection endpoint',
    () async {
      final capsule =
          fixture()['refunds']['full']['afterPayload']['capsules'][0];
      final repo = support.repository(
        support.MemoryStore(),
        (r) async => support.ok({
          'items': [capsule],
          'page': 1,
          'limit': 20,
          'totalCount': 1,
        }),
      );
      await expectLater(repo.capsules(1), throwsA(isA<ApiException>()));
    },
  );

  testWidgets(
    'opened capsule in partial refund uses result GET and preserves recovery without re-open',
    (tester) async {
      final f = fixture(), current = f['refunds']['partial']['afterPayload'];
      final stale = f['unopenedPurchase']['capsules'][0];
      var unavailable = true;
      final calls = <http.Request>[];
      final store = support.MemoryStore();
      final repo = support.repository(store, (r) async {
        calls.add(r);
        expect(r.method, 'GET');
        if (r.url.path == '/capsules') {
          return support.ok({
            'items': [stale],
            'page': 1,
            'limit': 20,
            'totalCount': 1,
          });
        }
        if (r.url.path == '/orders/${current['orderId']}') {
          return support.ok(current);
        }
        if (r.url.path.endsWith('/result')) {
          if (unavailable) {
            return http.Response(
              jsonEncode({'statusCode': 10005, 'message': '결과 확인 필요'}),
              409,
            );
          }
          return support.ok(f['confirmedOpening']);
        }
        throw StateError('Unexpected read ${r.url.path}');
      });
      await mount(tester, OrderFlowPage(userId: 10, repository: repo));
      await tester.tap(find.byTooltip('박스 정보 확인'));
      await tester.pumpAndSettle();
      expect(find.text('이미 개봉한 박스예요'), findsOneWidget);
      expect(find.text('캡슐 1개 개봉하기'), findsNothing);
      await tapVisible(tester, '확정된 개봉 결과 보기');
      expect(find.text('처리 결과 확인 중'), findsOneWidget);
      expect(find.text('이 캡슐 개봉 다시 요청'), findsNothing);
      unavailable = false;
      await tapVisible(tester, '저장된 결과 다시 확인');
      expect(find.text(f['confirmedOpening']['prize']['name']), findsOneWidget);
      expect(calls.where((r) => r.url.path.endsWith('/result')).length, 2);
      expect(calls.where((r) => r.method != 'GET'), isEmpty);
      expect(store.values, isEmpty);
    },
  );
}
