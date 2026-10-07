import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/core/theme/app_theme.dart';
import 'package:gacha_vault/features/wallet/data/payment_repository.dart';
import 'package:gacha_vault/features/wallet/domain/payment_confirmer.dart';
import 'package:gacha_vault/features/wallet/domain/payment_models.dart';
import 'package:gacha_vault/features/wallet/domain/topup_limit.dart';
import 'package:gacha_vault/features/wallet/payments/payment_checkout.dart';
import 'package:gacha_vault/features/wallet/presentation/topup_result_page.dart';
import 'package:gacha_vault/features/wallet/presentation/widgets/topup_sheet.dart';
import 'package:gacha_vault/shared/providers/auth_provider.dart';
import 'package:gacha_vault/shared/providers/gp_provider.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

http.Response envelope(
  int code, {
  Object? data,
  String message = 'error',
  List<String> errors = const [],
  int? status,
}) => http.Response(
  jsonEncode(
    code == 10000
        ? {'statusCode': code, 'message': 'success', 'data': data}
        : {'statusCode': code, 'message': message, 'errors': errors},
  ),
  status ?? (code == 10000 ? 200 : 503),
  headers: {'content-type': 'application/json; charset=utf-8'},
);

final pending = envelope(
  10016,
  message: 'Payment is still being confirmed; retry shortly',
  errors: ['toss:pending'],
);

/// What servers before the 10016 split sent while confirming.
final legacyPending = envelope(
  10015,
  message: 'Payment is still being confirmed; retry shortly',
  errors: ['toss:pending'],
);

final done = envelope(
  10000,
  data: {
    'orderId': 'GV${'a' * 32}',
    'status': 'DONE',
    'packageId': 'gp10000',
    'amount': 10000,
    'gp': 10000,
    'bonusGp': 0,
    'firstTopupBonusGp': 2000,
    'totalGp': 12000,
    'method': '카드',
    'approvedAt': '2026-10-07T07:00:00.000Z',
    'createdAt': '2026-10-07T06:59:00.000Z',
    'balanceAfter': 107676,
  },
);

/// 응답을 순서대로 내주고, 받은 승인 요청 본문을 기록한다.
class ConfirmServer {
  final List<Object> responses;
  final List<Map<String, dynamic>> bodies = [];
  ConfirmServer(this.responses);

  late final client = MockClient((req) async {
    if (req.url.path == '/users/me') {
      return envelope(
        10000,
        data: {'id': 1, 'email': 'a@b.c', 'coinBalance': 0},
      );
    }
    bodies.add(jsonDecode(req.body) as Map<String, dynamic>);
    final next = responses.removeAt(0);
    if (next is Exception) throw next;
    return next as http.Response;
  });

  PaymentRepository get repository =>
      PaymentRepository(apiClient: ApiClient(httpClient: client));
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('PaymentConfirmer', () {
    Future<(ConfirmOutcome, List<Duration>, ConfirmServer)> run(
      List<Object> responses,
    ) async {
      final server = ConfirmServer(responses);
      final slept = <Duration>[];
      final outcome = await PaymentConfirmer(
        confirm: () => server.repository.confirm(
          paymentKey: 'pk_ok_123',
          orderId: 'GV${'a' * 32}',
          amount: 10000,
        ),
        sleep: (d) async => slept.add(d),
      ).run();
      return (outcome, slept, server);
    }

    test('확인 중(10016)이면 같은 값으로 물러서며 다시 묻고, 승인되면 끝난다', () async {
      final (outcome, slept, server) = await run([pending, pending, done]);
      expect(outcome, isA<ConfirmDone>());
      final receipt = (outcome as ConfirmDone).receipt;
      expect(receipt.totalGp, 12000);
      expect(receipt.firstTopupBonusGp, 2000);
      expect(receipt.balanceAfter, 107676);
      expect(slept, const [Duration(seconds: 1), Duration(seconds: 2)]);
      expect(server.bodies, hasLength(3));
      expect(
        server.bodies.map(jsonEncode).toSet().length,
        1,
        reason: '매번 같은 paymentKey·orderId·amount',
      );
      expect(server.bodies.first, {
        'paymentKey': 'pk_ok_123',
        'orderId': 'GV${'a' * 32}',
        'amount': 10000,
      });
    });

    test('끝까지 결과가 없으면 실패가 아니라 확인 중으로 남는다', () async {
      final (outcome, slept, server) = await run([
        pending,
        pending,
        pending,
        pending,
        pending,
      ]);
      expect(outcome, isA<ConfirmPending>());
      expect((outcome as ConfirmPending).attempts, 5);
      expect(slept, PaymentConfirmer.defaultBackoff);
      expect(server.bodies, hasLength(5));
    });

    test('결제 실패(10014)는 다시 묻지 않고 메시지를 그대로 보여준다', () async {
      final (outcome, slept, server) = await run([
        envelope(
          10014,
          message: '카드 승인이 거절되었습니다',
          errors: ['code:REJECT_CARD_PAYMENT'],
          status: 400,
        ),
      ]);
      expect(outcome, isA<ConfirmFailed>());
      expect((outcome as ConfirmFailed).message, '카드 승인이 거절되었습니다');
      expect(outcome.code, ApiCode.paymentFailed);
      expect(slept, isEmpty);
      expect(server.bodies, hasLength(1));
    });

    test('서버에 닿지 못하면(결과 모름) 다시 묻는다', () async {
      final (outcome, _, server) = await run([
        http.ClientException('timeout'),
        done,
      ]);
      expect(outcome, isA<ConfirmDone>());
      expect(server.bodies, hasLength(2));
    });

    test('구버전 서버의 확인 중(10015 + toss:*)도 다시 묻는다', () async {
      final (outcome, _, server) = await run([legacyPending, done]);
      expect(outcome, isA<ConfirmDone>());
      expect(server.bodies, hasLength(2));
    });

    test('결제 미설정(10015, toss:* 없음)이면 바로 실패', () async {
      final (outcome, _, server) = await run([
        envelope(10015, message: 'Payments are not configured'),
      ]);
      expect(outcome, isA<ConfirmFailed>());
      expect((outcome as ConfirmFailed).message, '지금은 충전할 수 없어요');
      expect(server.bodies, hasLength(1));
    });
  });

  group('PaymentConfig', () {
    final config = PaymentConfig.fromJson({
      'enabled': true,
      'clientKey': 'test_ck',
      'customerKey': 'GVC_x',
      'packages': [
        {
          'id': 'gp10000',
          'price': 10000,
          'gp': 10000,
          'bonusGp': 0,
          'firstTopupBonusGp': 2000,
        },
        {
          'id': 'gp100000',
          'price': 100000,
          'gp': 100000,
          'bonusGp': 3000,
          'firstTopupBonusGp': 10000,
        },
        {'id': 'broken'},
      ],
      'firstTopupBonus': {'rate': 0.2, 'maxGp': 10000, 'eligible': true},
    });

    test('패키지와 첫 충전 보너스를 읽고 깨진 항목은 버린다', () {
      expect(config.enabled, isTrue);
      expect(config.packages.map((p) => p.id), ['gp10000', 'gp100000']);
      expect(config.firstTopupEligible, isTrue);
      expect(config.firstTopupBonus!.percent, 20);
      expect(config.packages.last.totalGp, 113000);
    });

    test('상한에 걸린 첫 충전 보너스는 실제 비율로 표시한다', () {
      expect(config.packages.first.firstBonusPercent, 20);
      expect(config.packages.last.firstBonusPercent, 10);
    });

    testWidgets('패키지 시트: 첫 충전 배지, 한도 초과 잠금, 웹은 결제 불가', (tester) async {
      tester.view.physicalSize = const Size(1170, 2532);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      Future<void> pump(CheckoutMode mode) async {
        await tester.pumpWidget(
          MaterialApp(
            theme: AppTheme.vault,
            home: Scaffold(
              body: TopupSheet(
                config: config,
                balance: 1000,
                mode: mode,
                limit: TopupLimit.fromJson({
                  'monthlyLimit': 50000,
                  'usedThisMonth': 0,
                  'remainingThisMonth': 50000,
                }),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
      }

      await pump(CheckoutMode.toss);
      expect(find.text('첫 충전 +20%'), findsOneWidget);
      // 10만원권은 남은 한도(5만원)를 넘어 '한도 초과'로 잠긴다.
      expect(find.text('한도 초과'), findsOneWidget);
      expect(find.textContaining('이번 달 남은 충전 한도 50,000원'), findsOneWidget);
      expect(find.text('10,000원 결제하기'), findsOneWidget);
      // 10만원권은 남은 한도(5만원)를 넘어 고를 수 없다.
      await tester.tap(find.text('100,000 GP'));
      await tester.pump();
      expect(find.text('10,000원 결제하기'), findsOneWidget);

      await pump(CheckoutMode.unavailable);
      final button = tester.widget<FilledButton>(
        find.ancestor(
          of: find.text('결제는 앱에서 가능해요'),
          matching: find.byType(FilledButton),
        ),
      );
      expect(button.onPressed, isNull);
    });
  });

  testWidgets('결과 화면: 확인 중을 거쳐 받은 GP 내역과 잔액을 보여준다', (tester) async {
    tester.view.physicalSize = const Size(1170, 2532);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final server = ConfirmServer([pending, done]);
    final auth = AuthProvider(apiClient: ApiClient(httpClient: server.client));
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider.value(value: auth),
          ChangeNotifierProxyProvider<AuthProvider, GpProvider>(
            create: (_) => GpProvider(),
            update: (_, a, gp) => gp!..syncFromUser(a.currentUser),
          ),
        ],
        child: MaterialApp(
          theme: AppTheme.vault,
          home: TopupResultPage(
            payment: CheckoutSuccess(
              paymentKey: 'pk_ok_1',
              orderId: 'GV${'a' * 32}',
              amount: 10000,
            ),
            order: PaymentOrder(
              orderId: 'GV${'a' * 32}',
              orderName: '가치가차 10,000 GP',
              amount: 10000,
              gp: 10000,
            ),
            repository: server.repository,
            backoff: const [Duration(milliseconds: 10)],
          ),
        ),
      ),
    );
    await tester.pump();
    expect(find.text('결제를 확인하고 있어요'), findsOneWidget);
    await tester.pumpAndSettle();
    expect(find.text('충전했어요'), findsOneWidget);
    expect(find.text('첫 충전 보너스'), findsOneWidget);
    expect(find.text('+2,000 GP'), findsOneWidget);
    expect(find.text('107,676 GP'), findsOneWidget);
    expect(server.bodies, hasLength(2));
  });
}
