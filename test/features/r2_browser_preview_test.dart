import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/core/theme/app_theme.dart';
import 'package:gacha_vault/features/orders/order_models.dart';
import 'package:gacha_vault/features/orders/order_flow_page.dart';
import 'package:gacha_vault/features/home/presentation/catalog_views.dart';
import '../../tool/r2/browser_preview.dart';
import '../../tool/r2/browser_fixtures.dart';
import '../../tool/r2/fixture.dart';
import '../../tool/unified_ux/catalog.dart' show reviewProviders;

Future<void> mount(WidgetTester t) async {
  t.view.physicalSize = const Size(1200, 1050);
  t.view.devicePixelRatio = 1;
  addTearDown(t.view.resetPhysicalSize);
  addTearDown(t.view.resetDevicePixelRatio);
  await t.pumpWidget(
    reviewProviders(
      MaterialApp(theme: AppTheme.lightTheme, home: const BrowserPreview()),
    ),
  );
  await t.tap(find.text('샘플 사진'));
  await t.pumpAndSettle();
}

Future<void> select(WidgetTester t, String screen) async {
  final d = t.widget<DropdownButton<String>>(
    find.byKey(const Key('review-screen')),
  );
  d.onChanged!(screen);
  await t.pumpAndSettle();
}

void main() {
  test('browser build configuration is fail-closed', () {
    expect(validateBrowserReviewConfiguration, returnsNormally);
  });
  test('all mutations and unknown reads are rejected by mock only', () async {
    final fixture = BrowserFixture();
    for (final method in ['POST', 'PUT', 'PATCH', 'DELETE']) {
      for (final path in [
        '/orders/gp',
        '/capsules/x/open',
        '/shipping',
        '/refund',
        '/conversion',
      ]) {
        await expectLater(
          fixture.handle(
            http.Request(method, Uri.https('stage2.invalid', path)),
          ),
          throwsA(
            isA<ApiException>().having(
              (e) => e.message,
              'message',
              mutationBlockedMessage,
            ),
          ),
        );
      }
    }
    await expectLater(
      fixture.handle(
        http.Request('GET', Uri.https('stage2.invalid', '/unmapped')),
      ),
      throwsA(isA<ApiException>()),
    );
    for (final b in r2Boxes) {
      final odds = await fixture.repository.odds(b.id);
      expect(odds.gachaId, b.id);
      expect(odds.price, b.priceWon);
      expect(odds.prizes.fold<int>(0, (sum, p) => sum + p.ppm), 1000000);
    }
  });
  test(
    'purchase cannot create a receipt or durable pending transaction',
    () async {
      final fixture = BrowserFixture();
      await expectLater(
        fixture.repository.purchase(
          Odds(browserOdds(r2Boxes.first)),
          1,
          r2Boxes.first.name,
        ),
        throwsA(isA<ApiException>()),
      );
      expect(await fixture.repository.pendingPurchase(), isNull);
      expect(
        fixture.calls.where((c) => c.startsWith('POST ')),
        ['/orders/gp'].map((p) => 'POST $p'),
      );
    },
  );
  testWidgets('home hero → real detail → real purchase and odds disclosure', (
    t,
  ) async {
    await mount(t);
    expect(find.byType(HomeScreen), findsOneWidget);
    await t.tap(find.text('구성·확률 보기'));
    await t.pumpAndSettle();
    expect(find.byType(BrowserDetailPage), findsOneWidget);
    expect(find.text('사운드 박스'), findsOneWidget);
    final purchase = find.textContaining('구매 전 확인');
    await t.ensureVisible(purchase);
    await t.tap(purchase);
    await t.pumpAndSettle();
    expect(find.byType(OrderFlowPage), findsOneWidget);
    expect(find.text('구매 전 마지막 확인'), findsOneWidget);
    await t.ensureVisible(find.byKey(const Key('purchase-odds-disclosure')));
    await t.tap(find.byKey(const Key('purchase-odds-disclosure')));
    await t.pumpAndSettle();
    expect(find.text('당첨 확률 90%'), findsWidgets);
    expect(find.text('당첨 확률 10%'), findsWidgets);
    expect(find.byTooltip('확률 안내 닫기'), findsOneWidget);
    expect(t.takeException(), isNull);
  });
  testWidgets('shop search and filter apply/cancel remain interactive', (
    t,
  ) async {
    await mount(t);
    await select(t, '박스샵');
    expect(find.byType(BoxShopScreen), findsOneWidget);
    await t.enterText(find.byType(TextField), '커피');
    await t.pumpAndSettle();
    expect(find.text('커피 브레이크'), findsOneWidget);
    expect(find.text('사운드 박스'), findsNothing);
    await t.enterText(find.byType(TextField), '');
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('catalog-filter')));
    await t.pumpAndSettle();
    await t.tap(find.text('낮은 가격순'));
    await t.tap(find.byTooltip('필터 닫기'));
    await t.pumpAndSettle();
    expect(find.text('낮은 가격순'), findsNothing);
    await t.tap(find.byKey(const Key('catalog-filter')));
    await t.pumpAndSettle();
    await t.tap(find.text('높은 가격순'));
    await t.tap(find.text('적용하기'));
    await t.pumpAndSettle();
    expect(find.textContaining('높은 가격순'), findsWidgets);
    expect(t.takeException(), isNull);
  });
  testWidgets('preset result → collection and route reset, large text', (
    t,
  ) async {
    await mount(t);
    await select(t, '단일 결과');
    await t.pumpAndSettle();
    final cta = find.text('보관함 보기');
    await t.ensureVisible(cta);
    await t.tap(cta);
    await t.pumpAndSettle();
    expect(find.text('일반 컬렉션 카드'), findsWidgets);
    await select(t, '홈');
    t
        .widget<DropdownButton<double>>(find.byKey(const Key('review-scale')))
        .onChanged!(2);
    await t.pumpAndSettle();
    expect(find.byType(HomeScreen), findsOneWidget);
    await t.ensureVisible(find.text('구성·확률 보기'));
    expect(find.text('구성·확률 보기').hitTestable(), findsOneWidget);
    expect(t.takeException(), isNull);
  });
  testWidgets('animation is a disposable preset, never a transaction', (
    t,
  ) async {
    await mount(t);
    await select(t, '개봉 연출');
    await t.pump(const Duration(seconds: 3));
    await t.pumpAndSettle();
    expect(find.text('1개 개봉 완료'), findsOneWidget);
    await select(t, '홈');
    expect(find.byType(HomeScreen), findsOneWidget);
    expect(t.takeException(), isNull);
  });
}
