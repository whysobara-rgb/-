import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:provider/provider.dart';
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/features/conversions/conversion_models.dart';
import 'package:gacha_vault/features/conversions/conversion_repository.dart';
import 'package:gacha_vault/features/conversions/conversion_page.dart';
import 'package:gacha_vault/shared/providers/auth_provider.dart';
import 'orders/order_flow_test.dart' as f;

const conversionId = '00000000-0000-4000-8000-000000000099';
Map<String, dynamic> policy() => {
  'version': 1,
  'normalRate': 10,
  'premiumRate': 100,
  'restoreHours': 24,
  'maxRestoresPerItem': 1,
  'restoreRule': 'NO_GP_SPEND_SINCE_CONVERSION',
};
Map<String, dynamic> entry() => {
  'inventoryItemId': 7,
  'prize': f.prize,
  'amountGP': 100,
};
Map<String, dynamic> quote() => {
  'totalGP': 100,
  'balance': 1000,
  'quoteVersion': 'a' * 64,
  'policy': policy(),
  'entries': [entry()],
  'restoreEligible': true,
};
Map<String, dynamic> receipt({bool restored = false, bool allowed = true}) => {
  'conversionId': conversionId,
  'totalGP': 100,
  'balanceAfter': 1100,
  'restoredBalanceAfter': restored ? 1000 : null,
  'status': restored ? 'RESTORED' : 'CONVERTED',
  'createdAt': '2026-09-15T09:00:00Z',
  'restoreUntil': '2026-09-16T09:00:00Z',
  'policy': policy(),
  'items': [entry()],
  'canRestore': !restored && allowed,
  'restoreReason': restored
      ? '이미 복구된 상품입니다'
      : allowed
      ? null
      : '전환 이후 GP 사용 내역이 있어 복구할 수 없습니다',
};
http.Response failure(int status, {List<String> errors = const []}) =>
    http.Response(
      jsonEncode({
        'statusCode': status == 404
            ? 10004
            : status == 409
            ? 10005
            : 10099,
        'message': 'server failure',
        'errors': errors,
      }),
      status,
      headers: {'content-type': 'application/json; charset=utf-8'},
    );
ConversionRepository repo(
  f.MemoryStore store,
  Future<http.Response> Function(http.Request) handler, {
  bool enabled = true,
  int userId = 10,
  String server = 'https://test.example',
}) => ConversionRepository(
  f.repository(
    store,
    (r) async {
      if (r.url.path == '/inventory-conversions/capabilities') {
        return f.ok({'enabled': true, 'contract': 'INVENTORY_CONVERSION_V1'});
      }
      return handler(r);
    },
    userId: userId,
    server: server,
  ),
  enabled: enabled,
);

void main() {
  test(
    'validates quote ownership, selection bounds, policy, amounts and duplicate entries',
    () async {
      final s = f.MemoryStore();
      var requests = 0;
      final r = repo(s, (req) async {
        requests++;
        return f.ok(quote());
      });
      await expectLater(r.quote([7, 7]), throwsA(isA<ApiException>()));
      await expectLater(
        r.quote(List.generate(101, (i) => i + 1)),
        throwsA(isA<ApiException>()),
      );
      expect(requests, 0);
      await expectLater(r.quote([8]), throwsA(isA<ApiException>()));
      expect(
        () => ConversionQuote({...quote(), 'totalGP': 101}),
        throwsA(isA<ApiException>()),
      );
      expect(
        () => ConversionQuote({
          ...quote(),
          'policy': {...policy(), 'restoreRule': 'UNKNOWN'},
        }),
        throwsA(isA<ApiException>()),
      );
      expect(
        () => ConversionQuote({
          ...quote(),
          'entries': [entry(), entry()],
          'totalGP': 200,
        }),
        throwsA(isA<ApiException>()),
      );
    },
  );
  test(
    'saves before mutation and preserves lost-response intent across restart; GET recovery never credits again',
    () async {
      final s = f.MemoryStore();
      final calls = <http.Request>[];
      final first = repo(s, (req) async {
        calls.add(req);
        expect(s.values, isNotEmpty);
        throw http.ClientException('lost');
      });
      await expectLater(
        first.convert(ConversionQuote(quote())),
        throwsA(isA<ApiException>()),
      );
      final saved = (await first.pending())!;
      final second = repo(s, (req) async {
        calls.add(req);
        expect(req.method, 'GET');
        expect(req.url.path, '/inventory-conversions/requests/${saved.key}');
        return f.ok(receipt());
      });
      final result = (await second.recover())!;
      expect(calls.where((c) => c.method == 'POST').length, 1);
      expect(await second.pending(), isNotNull);
      await second.acknowledge(result);
      expect(await second.pending(), isNull);
    },
  );
  test('explicit same-request retry preserves original id and body', () async {
    final s = f.MemoryStore();
    final calls = <http.Request>[];
    final first = repo(s, (req) async {
      calls.add(req);
      return failure(503);
    });
    await expectLater(
      first.convert(ConversionQuote(quote())),
      throwsA(isA<ApiException>()),
    );
    final second = repo(s, (req) async {
      calls.add(req);
      return f.ok(receipt());
    });
    await second.retry();
    expect(calls[1].body, calls[0].body);
    expect(
      calls[1].headers['idempotency-key'],
      calls[0].headers['idempotency-key'],
    );
  });
  test(
    'storage failure prevents request; bad receipt and unknown GET keep recovery data',
    () async {
      final s = f.MemoryStore()..failWrite = true;
      var requests = 0;
      final r = repo(s, (req) async {
        requests++;
        return f.ok({...receipt(), 'totalGP': 999});
      });
      await expectLater(r.convert(ConversionQuote(quote())), throwsStateError);
      expect(requests, 0);
      s.failWrite = false;
      await expectLater(
        r.convert(ConversionQuote(quote())),
        throwsA(isA<ApiException>()),
      );
      expect(await r.pending(), isNotNull);
      final unavailable = repo(s, (req) async => failure(404));
      await expectLater(unavailable.recover(), throwsA(isA<ApiException>()));
      expect(await unavailable.pending(), isNotNull);
      final absent = repo(
        s,
        (req) async => failure(404, errors: ['CONVERSION_REQUEST_NOT_FOUND']),
      );
      expect(await absent.recover(), isNull);
      expect(await absent.pending(), isNotNull);
    },
  );
  test(
    'another account, disabled build and concurrent double tap cannot send changes',
    () async {
      final s = f.MemoryStore();
      var count = 0;
      Future<http.Response> handler(http.Request r) async {
        count++;
        return f.ok(receipt());
      }

      await expectLater(
        repo(s, handler, enabled: false).convert(ConversionQuote(quote())),
        throwsA(isA<ApiException>()),
      );
      await expectLater(
        repo(s, handler, userId: 11).convert(ConversionQuote(quote())),
        throwsA(isA<ApiException>()),
      );
      expect(count, 0);
      final held = Completer<http.Response>();
      final started = Completer<void>();
      final a = repo(s, (r) {
        count++;
        started.complete();
        return held.future;
      });
      final work = a.convert(ConversionQuote(quote()));
      await started.future;
      await expectLater(
        repo(s, handler).convert(ConversionQuote(quote())),
        throwsA(isA<ApiException>()),
      );
      held.complete(f.ok(receipt()));
      await work;
      expect(count, 1);
      expect(
        await repo(s, handler, server: 'https://other.example').pending(),
        isNull,
      );
      expect(await repo(s, handler, userId: 11).pending(), isNull);
    },
  );
  test(
    'restore checks server eligibility and recovers committed result without another debit',
    () async {
      final s = f.MemoryStore();
      var posts = 0;
      final denied = repo(s, (r) async => f.ok(receipt(allowed: false)));
      await expectLater(
        denied.restore(conversionId),
        throwsA(isA<ApiException>()),
      );
      expect(await denied.pending(), isNull);
      final a = repo(s, (r) async {
        if (r.method == 'GET') return f.ok(receipt());
        posts++;
        return failure(503);
      });
      await expectLater(a.restore(conversionId), throwsA(isA<ApiException>()));
      final b = repo(s, (r) async {
        expect(r.method, 'GET');
        return f.ok(receipt(restored: true));
      });
      final recovered = (await b.recover())!;
      expect(recovered.restored, isTrue);
      expect(posts, 1);
      await b.acknowledge(recovered);
      expect(await b.pending(), isNull);
    },
  );
  test(
    'a definite stale quote rejection allows selecting a new quote',
    () async {
      final s = f.MemoryStore();
      final r = repo(s, (req) async => failure(409));
      await expectLater(
        r.convert(ConversionQuote(quote())),
        throwsA(isA<ApiException>()),
      );
      expect(await r.pending(), isNull);
    },
  );
  testWidgets(
    'selection consent, conversion receipt, history and restore consent form one flow',
    (tester) async {
      final s = f.MemoryStore();
      bool restored = false;
      var posts = 0;
      final r = repo(s, (req) async {
        if (req.url.path.endsWith('/quote')) return f.ok(quote());
        if (req.method == 'POST') {
          posts++;
          if (req.url.path.endsWith('/restore')) restored = true;
          return f.ok(receipt(restored: restored));
        }
        if (req.url.path.endsWith(conversionId)) {
          return f.ok(receipt(restored: restored));
        }
        return f.ok({
          'items': [receipt(restored: restored)],
          'page': 1,
          'limit': 20,
          'totalCount': 1,
        });
      });
      await tester.pumpWidget(
        ChangeNotifierProvider<AuthProvider>(
          create: (_) => f.TestAuth(),
          child: MaterialApp(
            home: ConversionPage(
              userId: 10,
              inventoryIds: const [7],
              repository: r,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<FilledButton>(find.byKey(const Key('conversion-submit')))
            .onPressed,
        isNull,
      );
      await tester.ensureVisible(find.byKey(const Key('conversion-consent')));
      await tester.tap(find.byKey(const Key('conversion-consent')));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const Key('conversion-submit')));
      await tester.tap(find.byKey(const Key('conversion-submit')));
      await tester.pumpAndSettle();
      expect(find.text('GP 전환 완료'), findsOneWidget);
      expect(posts, 1);
      await tester.ensureVisible(find.text('확인하고 전환 내역 보기'));
      await tester.tap(find.text('확인하고 전환 내역 보기'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('1개 상품 · 100 GP'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('상품 복구 확인'));
      await tester.tap(find.text('상품 복구 확인'));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<FilledButton>(find.byKey(const Key('restore-submit')))
            .onPressed,
        isNull,
      );
      await tester.ensureVisible(find.byKey(const Key('conversion-consent')));
      await tester.tap(find.byKey(const Key('conversion-consent')));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const Key('restore-submit')));
      await tester.tap(find.byKey(const Key('restore-submit')));
      await tester.pumpAndSettle();
      expect(find.text('상품 복구 완료'), findsOneWidget);
      expect(posts, 2);
      expect(tester.takeException(), isNull);
    },
  );
}
