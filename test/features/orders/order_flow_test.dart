import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/core/network/token_storage.dart';
import 'package:gacha_vault/features/orders/order_models.dart';
import 'package:gacha_vault/features/orders/order_repository.dart';
import 'package:gacha_vault/features/orders/order_flow_page.dart';
import 'package:gacha_vault/shared/models/app_user.dart';
import 'package:gacha_vault/shared/providers/auth_provider.dart';

const orderId = 'd4b608db-b251-4616-8017-c1eea6a9c1a1';
const capsuleId = 'a4b608db-b251-4616-8017-c1eea6a9c1a1';
final version = 'a' * 64;
final prize = {
  'itemId': 1,
  'name': '테스트 상품',
  'rarity': 'N',
  'imageUrl': null,
  'estimatedValue': 1000,
  'isPremium': false,
  'conversionGP': 100,
  'probabilityPpm': 1000000,
};
Map<String, dynamic> oddsData() => {
  'gachaId': 1,
  'unitPrice': 100,
  'currency': 'GP',
  'version': version,
  'snapshot': {
    'schemaVersion': 1,
    'mode': 'FIXED_PPM',
    'entries': [prize],
  },
};
Map<String, dynamic> receiptData() => {
  'orderId': orderId,
  'title': '테스트 캡슐',
  'gachaId': 1,
  'quantity': 1,
  'unitPrice': 100,
  'total': 100,
  'currency': 'GP',
  'status': 'PAID',
  'probabilityVersion': version,
  'capsules': [
    {'id': capsuleId, 'orderId': orderId, 'sequence': 1, 'status': 'UNOPENED'},
  ],
};
Map<String, dynamic> openingData() => {
  'capsuleId': capsuleId,
  'inventoryItemId': 7,
  'prize': prize,
};
http.Response ok(dynamic data) => http.Response(
  jsonEncode({'statusCode': 10000, 'data': data}),
  200,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

class MemoryStore implements OrderStore {
  final values = <String, String>{};
  bool failWrite = false;
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String value) async {
    if (failWrite) throw StateError('storage failed');
    values[key] = value;
  }

  @override
  Future<void> remove(String key) async {
    values.remove(key);
  }
}

class FixedToken extends TokenStorage {
  @override
  Future<String?> readToken() async => 'fixture-token';
}

OrderRepository repository(
  MemoryStore store,
  Future<http.Response> Function(http.Request) handler, {
  int userId = 10,
  bool enabled = true,
  String server = 'https://test.example',
}) => OrderRepository(
  api: ApiClient(
    client: MockClient((r) async {
      if (r.url.path == '/users/me') return ok({'id': 10});
      return handler(r);
    }),
    apiBaseUrl: server,
    tokenStorage: FixedToken(),
    timeout: const Duration(milliseconds: 30),
  ),
  store: store,
  userId: userId,
  server: server,
  enabled: enabled,
);

class TestAuth extends AuthProvider {
  @override
  AppUser? get currentUser => const AppUser(
    id: 10,
    email: 'fixture@example.test',
    nickname: 'test',
    coinBalance: 1000,
  );
  @override
  Future<void> refreshProfile() async {}
}

void main() {
  test(
    'timeout survives repository restart and retries identical body and request key',
    () async {
      final store = MemoryStore();
      final sent = <http.Request>[];
      final first = repository(store, (r) async {
        sent.add(r);
        expect(store.values, isNotEmpty);
        throw http.ClientException('lost response');
      });
      await expectLater(
        first.purchase(Odds(oddsData()), 1, '테스트 캡슐'),
        throwsA(isA<ApiException>()),
      );
      final second = repository(store, (r) async {
        sent.add(r);
        return ok(receiptData());
      });
      final receipt = await second.retryPurchase();
      expect(receipt.id, orderId);
      expect(sent.length, 2);
      expect(
        sent[0].headers['idempotency-key'],
        sent[1].headers['idempotency-key'],
      );
      expect(sent[0].body, sent[1].body);
      expect(sent[0].headers['authorization'], 'Bearer fixture-token');
      expect(await second.pendingPurchase(), isNull);
    },
  );
  test('storage failure prevents the mutation', () async {
    var calls = 0;
    final store = MemoryStore()..failWrite = true;
    final repo = repository(store, (r) async {
      calls++;
      return ok(receiptData());
    });
    await expectLater(
      repo.purchase(Odds(oddsData()), 1, 'test'),
      throwsStateError,
    );
    expect(calls, 0);
  });
  test(
    'malformed success retains pending request and never invents a receipt',
    () async {
      final store = MemoryStore();
      final repo = repository(
        store,
        (r) async => ok({...receiptData(), 'total': 1}),
      );
      await expectLater(
        repo.purchase(Odds(oddsData()), 1, 'test'),
        throwsA(isA<ApiException>()),
      );
      expect(await repo.pendingPurchase(), isNotNull);
    },
  );
  test('new purchase is blocked while an uncertain purchase exists', () async {
    final store = MemoryStore();
    var calls = 0;
    final repo = repository(store, (r) async {
      calls++;
      throw http.ClientException('offline');
    });
    await expectLater(
      repo.purchase(Odds(oddsData()), 1, 'test'),
      throwsA(isA<ApiException>()),
    );
    await expectLater(
      repo.purchase(Odds(oddsData()), 1, 'new'),
      throwsA(isA<ApiException>()),
    );
    expect(calls, 1);
  });
  test(
    'unclassified conflicts retain the key; explicit no-debit rejection allows a fresh quote',
    () async {
      for (final tagged in [false, true]) {
        final store = MemoryStore();
        final repo = repository(
          store,
          (r) async => http.Response(
            jsonEncode({
              'statusCode': 10005,
              'message': '가격 변경',
              'errors': tagged ? ['ORDER_REJECTED'] : [],
            }),
            409,
            headers: {'content-type': 'application/json; charset=utf-8'},
          ),
        );
        await expectLater(
          repo.purchase(Odds(oddsData()), 1, 'test'),
          throwsA(isA<ApiException>()),
        );
        expect(await repo.pendingPurchase(), tagged ? isNull : isNotNull);
      }
    },
  );
  test('pending transactions are separated by account and server', () async {
    final store = MemoryStore();
    final repo = repository(
      store,
      (r) async => throw http.ClientException('offline'),
    );
    await expectLater(
      repo.purchase(Odds(oddsData()), 1, 'test'),
      throwsA(isA<ApiException>()),
    );
    expect(
      await repository(
        store,
        (r) async => ok({}),
        userId: 11,
      ).pendingPurchase(),
      isNull,
    );
    expect(
      await repository(
        store,
        (r) async => ok({}),
        server: 'https://other.example',
      ).pendingPurchase(),
      isNull,
    );
  });
  test(
    'disabled rollout and wrong account do not send purchase requests',
    () async {
      var calls = 0;
      final store = MemoryStore();
      for (final repo in [
        repository(store, (r) async {
          calls++;
          return ok({});
        }, enabled: false),
        repository(store, (r) async {
          calls++;
          return ok({});
        }, userId: 11),
      ]) {
        await expectLater(
          repo.purchase(Odds(oddsData()), 1, 'test'),
          throwsA(isA<ApiException>()),
        );
      }
      expect(calls, 0);
      expect(store.values, isEmpty);
    },
  );
  test(
    'same-account concurrent attempts are serialized before durable writes',
    () async {
      final gate = Completer<http.Response>();
      final store = MemoryStore();
      final repo = repository(store, (r) => gate.future);
      final future = repo.purchase(Odds(oddsData()), 1, 'test');
      await expectLater(
        repo.purchase(Odds(oddsData()), 1, 'test'),
        throwsA(isA<ApiException>()),
      );
      gate.complete(ok(receiptData()));
      await future;
    },
  );
  test(
    'opening recovery is GET-only, survives restart, and needs acknowledgment',
    () async {
      final store = MemoryStore();
      final first = repository(
        store,
        (r) async => throw http.ClientException('lost'),
      );
      await expectLater(first.open(capsuleId), throwsA(isA<ApiException>()));
      expect(await first.pendingOpening(), capsuleId);
      final second = repository(store, (r) async {
        expect(r.method, 'GET');
        expect(r.url.path, '/capsules/$capsuleId/result');
        return ok(openingData());
      });
      expect((await second.result(capsuleId)).inventoryId, 7);
      expect(await second.pendingOpening(), capsuleId);
      await second.acknowledgeOpening(capsuleId);
      expect(await second.pendingOpening(), isNull);
    },
  );
  test(
    'another capsule cannot open until prior result is acknowledged',
    () async {
      var calls = 0;
      final repo = repository(MemoryStore(), (r) async {
        calls++;
        return ok(openingData());
      });
      await repo.open(capsuleId);
      await expectLater(repo.open(orderId), throwsA(isA<ApiException>()));
      expect(calls, 1);
    },
  );
  test(
    'fixed probabilities and bigint balances are parsed without rounding',
    () {
      expect(Odds(oddsData()).prizes.single.probability, '100%');
      expect(
        () => Odds({
          ...oddsData(),
          'snapshot': {
            'schemaVersion': 1,
            'mode': 'FIXED_PPM',
            'entries': [
              {...prize, 'probabilityPpm': 999999},
            ],
          },
        }),
        throwsA(isA<ApiException>()),
      );
      expect(
        AppUser.fromJson({
          'id': 10,
          'email': 'test',
          'coinBalance': '1000',
        }).coinBalance,
        1000,
      );
      expect(
        () =>
            AppUser.fromJson({'id': 10, 'email': 'test', 'coinBalance': '1.5'}),
        throwsFormatException,
      );
    },
  );
  testWidgets(
    'purchase needs odds consent, shows unopened receipt, and never opens automatically',
    (tester) async {
      final mutations = <String>[];
      final repo = repository(MemoryStore(), (r) async {
        if (r.method == 'GET') return ok(oddsData());
        mutations.add(r.url.path);
        return ok(receiptData());
      });
      await tester.pumpWidget(
        ChangeNotifierProvider<AuthProvider>(
          create: (_) => TestAuth(),
          child: MaterialApp(
            home: OrderFlowPage(
              userId: 10,
              gachaId: 1,
              title: '테스트 캡슐',
              repository: repo,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('당첨 확률 100%'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('GP로 구매하고 보관하기'), 200);
      await tester.tap(find.text('GP로 구매하고 보관하기'));
      await tester.pump();
      expect(mutations, isEmpty);
      await tester.tap(find.byType(CheckboxListTile));
      await tester.pump();
      await tester.tap(find.text('GP로 구매하고 보관하기'));
      await tester.pumpAndSettle();
      expect(find.text('구매가 완료됐어요'), findsOneWidget);
      expect(mutations, ['/orders/gp']);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets('narrow screen with large text can render the odds flow', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final repo = repository(MemoryStore(), (r) async => ok(oddsData()));
    await tester.pumpWidget(
      ChangeNotifierProvider<AuthProvider>(
        create: (_) => TestAuth(),
        child: MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(1.8)),
            child: child!,
          ),
          home: OrderFlowPage(
            userId: 10,
            gachaId: 1,
            title: '테스트 캡슐',
            repository: repo,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}
