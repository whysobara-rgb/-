import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:provider/provider.dart';
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/features/orders/batch_opening.dart';
import 'package:gacha_vault/features/orders/batch_opening_page.dart';
import 'package:gacha_vault/features/orders/order_flow_page.dart';
import 'package:gacha_vault/shared/providers/auth_provider.dart';
import 'order_flow_test.dart' as fixture;

String id(int n) =>
    '00000000-0000-4000-8000-${n.toRadixString(16).padLeft(12, '0')}';
Map<String, dynamic> opened(String capsule, int inventory) => {
  'capsuleId': capsule,
  'inventoryItemId': inventory,
  'prize': fixture.prize,
};
http.Response failure(int status, int code) => http.Response(
  jsonEncode({'statusCode': code, 'message': 'test'}),
  status,
  headers: {'content-type': 'application/json; charset=utf-8'},
);
Widget app(Widget page) => ChangeNotifierProvider<AuthProvider>(
  create: (_) => fixture.TestAuth(),
  child: MaterialApp(home: page),
);

void main() {
  test(
    '100 purchased capsules open once each without purchasing or using GP',
    () async {
      final store = fixture.MemoryStore(), calls = <String>[];
      final ids = List.generate(100, (i) => id(i + 1));
      final repo = fixture.repository(store, (r) async {
        calls.add('${r.method} ${r.url.path}');
        expect(r.method, 'POST');
        final capsule = r.url.path.split('/')[2];
        return fixture.ok(opened(capsule, ids.indexOf(capsule) + 1));
      });
      var batch = await repo.startBatch(ids);
      expect(calls, isEmpty);
      for (var i = 0; i < 100; i++) {
        batch = await repo.advanceBatch();
      }
      expect(batch.complete, isTrue);
      expect(batch.results.length, 100);
      expect(calls.length, 100);
      expect(calls.toSet().length, 100);
      await repo.advanceBatch();
      expect(calls.length, 100);
      expect((await repo.pendingBatch())!.results.length, 100);
    },
  );
  test(
    'lost response is recovered with GET before moving to the next capsule',
    () async {
      final store = fixture.MemoryStore();
      final first = fixture.repository(
        store,
        (r) async => throw http.ClientException('lost'),
      );
      await first.startBatch([id(1), id(2)]);
      await expectLater(first.advanceBatch(), throwsA(isA<ApiException>()));
      expect((await first.pendingBatch())!.inFlight, id(1));
      final calls = <String>[];
      final restarted = fixture.repository(store, (r) async {
        calls.add('${r.method} ${r.url.path}');
        return fixture.ok(
          opened(r.url.path.split('/')[2], r.method == 'GET' ? 1 : 2),
        );
      });
      final recovered = await restarted.advanceBatch();
      expect(recovered.results.length, 1);
      expect(calls, ['GET /capsules/${id(1)}/result']);
      expect((await restarted.advanceBatch()).complete, isTrue);
      expect(calls.last, 'POST /capsules/${id(2)}/open');
    },
  );
  test(
    'write failure before first POST prevents opening; after POST retains recovery',
    () async {
      final store = fixture.MemoryStore();
      var calls = 0;
      final repo = fixture.repository(store, (r) async {
        calls++;
        store.failWrite = true;
        return fixture.ok(opened(id(1), 1));
      });
      await repo.startBatch([id(1)]);
      store.failWrite = true;
      await expectLater(repo.advanceBatch(), throwsStateError);
      expect(calls, 0);
      store.failWrite = false;
      await expectLater(repo.advanceBatch(), throwsStateError);
      expect(calls, 1);
      expect((await repo.pendingBatch())!.inFlight, id(1));
      store.failWrite = false;
      final resumed = fixture.repository(store, (r) async {
        expect(r.method, 'GET');
        return fixture.ok(opened(id(1), 1));
      });
      expect((await resumed.advanceBatch()).complete, isTrue);
    },
  );
  test(
    'ambiguous recovery never starts another mutation or discards the queue',
    () async {
      final store = fixture.MemoryStore();
      final first = fixture.repository(
        store,
        (r) async => throw http.ClientException('lost'),
      );
      final batch = await first.startBatch([id(1)]);
      await expectLater(first.advanceBatch(), throwsA(isA<ApiException>()));
      for (final status in [401, 404, 500]) {
        final repo = fixture.repository(store, (r) async {
          expect(r.method, 'GET');
          return failure(status, 10004);
        });
        await expectLater(repo.advanceBatch(), throwsA(isA<ApiException>()));
        await expectLater(
          repo.acknowledgeBatch(batch.id),
          throwsA(isA<ApiException>()),
        );
        expect((await repo.pendingBatch())!.inFlight, id(1));
      }
    },
  );
  test('explicit unopened response retries only the same capsule', () async {
    final store = fixture.MemoryStore();
    final first = fixture.repository(
      store,
      (r) async => throw http.ClientException('lost'),
    );
    await first.startBatch([id(1)]);
    await expectLater(first.advanceBatch(), throwsA(isA<ApiException>()));
    final methods = <String>[];
    final resumed = fixture.repository(store, (r) async {
      methods.add(r.method);
      expect(r.url.path, contains(id(1)));
      return r.method == 'GET'
          ? failure(409, 10005)
          : fixture.ok(opened(id(1), 1));
    });
    expect((await resumed.advanceBatch()).complete, isTrue);
    expect(methods, ['GET', 'POST']);
  });
  test(
    'partial batch can be acknowledged only after the current result is saved',
    () async {
      final calls = <String>[];
      final repo = fixture.repository(fixture.MemoryStore(), (r) async {
        calls.add(r.url.path);
        return fixture.ok(opened(id(1), 1));
      });
      final batch = await repo.startBatch([id(1), id(2)]);
      await repo.advanceBatch();
      await repo.acknowledgeBatch(batch.id);
      expect(await repo.pendingBatch(), isNull);
      expect(calls, ['/capsules/${id(1)}/open']);
    },
  );
  test(
    'single opening, another batch and concurrent advance cannot race the queue',
    () async {
      final gate = Completer<http.Response>(), store = fixture.MemoryStore();
      var calls = 0;
      final repo = fixture.repository(store, (r) {
        calls++;
        return gate.future;
      });
      await repo.startBatch([id(1)]);
      await expectLater(repo.open(id(2)), throwsA(isA<ApiException>()));
      await expectLater(repo.startBatch([id(2)]), throwsA(isA<ApiException>()));
      final advancing = repo.advanceBatch();
      await expectLater(repo.advanceBatch(), throwsA(isA<ApiException>()));
      gate.complete(fixture.ok(opened(id(1), 1)));
      await advancing;
      expect(calls, 1);
    },
  );
  test(
    'invalid selection and cross-account access cannot open capsules',
    () async {
      final store = fixture.MemoryStore();
      var calls = 0;
      final repo = fixture.repository(store, (r) async {
        calls++;
        return fixture.ok({});
      });
      for (final ids in <List<String>>[
        [],
        [id(1), id(1)],
        List.generate(101, (i) => id(i + 1)),
      ]) {
        await expectLater(repo.startBatch(ids), throwsA(isA<ApiException>()));
      }
      expect(calls, 0);
      expect(store.values, isEmpty);
      await repo.startBatch([id(1)]);
      final other = fixture.repository(store, (r) async {
        calls++;
        return fixture.ok({});
      }, userId: 11);
      expect(await other.pendingBatch(), isNull);
      await expectLater(
        other.startBatch([id(1)]),
        throwsA(isA<ApiException>()),
      );
      expect(calls, 0);
    },
  );
  test(
    'malformed or mismatched success keeps the in-flight result recoverable',
    () async {
      final repo = fixture.repository(
        fixture.MemoryStore(),
        (r) async => fixture.ok(opened(id(2), 1)),
      );
      await repo.startBatch([id(1)]);
      await expectLater(repo.advanceBatch(), throwsA(isA<ApiException>()));
      expect((await repo.pendingBatch())!.inFlight, id(1));
      expect(
        () => BatchOpening.fromJson({'schemaVersion': 2}),
        throwsA(isA<ApiException>()),
      );
    },
  );
  testWidgets('selection requires confirmation and two results are grouped', (
    tester,
  ) async {
    var count = 0;
    final repo = fixture.repository(fixture.MemoryStore(), (r) async {
      if (r.url.path == '/capsules')
        return fixture.ok({
          'items': List.generate(
            2,
            (i) => {
              'id': id(i + 1),
              'orderId': fixture.orderId,
              'sequence': i + 1,
              'status': 'UNOPENED',
            },
          ),
          'page': 1,
          'limit': 20,
          'totalCount': 2,
        });
      count++;
      return fixture.ok(opened(r.url.path.split('/')[2], count));
    });
    await tester.pumpWidget(app(OrderFlowPage(userId: 10, repository: repo)));
    await tester.pumpAndSettle();
    await tester.tap(find.text('이 페이지 선택'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('선택한 2개 개봉 · 0 GP'));
    await tester.pumpAndSettle();
    expect(count, 0);
    expect(find.text('박스 2개를 개봉할까요?'), findsOneWidget);
    await tester.tap(find.text('2개 개봉'));
    await tester.pumpAndSettle();
    expect(count, 2);
    expect(find.text('2개 개봉 완료'), findsOneWidget);
    expect(find.text('× 2'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  testWidgets(
    'stop waits for the current result and leaves the next capsule unopened',
    (tester) async {
      final gate = Completer<http.Response>();
      var calls = 0;
      final repo = fixture.repository(fixture.MemoryStore(), (r) {
        calls++;
        return gate.future;
      });
      await tester.pumpWidget(
        app(BatchOpeningPage(repository: repo, initialIds: [id(1), id(2)])),
      );
      await tester.pump();
      await tester.pump();
      await tester.tap(find.text('현재 박스까지 열고 멈추기'));
      await tester.pump();
      gate.complete(fixture.ok(opened(id(1), 1)));
      await tester.pumpAndSettle();
      expect(calls, 1);
      expect(find.text('남은 박스 이어서 개봉'), findsOneWidget);
      expect((await repo.pendingBatch())!.results.length, 1);
      expect(tester.takeException(), isNull);
    },
  );
}
