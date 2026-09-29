import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/features/auth/presentation/login_page.dart';
import 'package:gacha_vault/features/home/presentation/catalog_views.dart';
import 'package:gacha_vault/features/home/presentation/widgets/capsule_box_card.dart';
import 'package:gacha_vault/features/orders/batch_result_view.dart';
import 'package:gacha_vault/features/orders/order_models.dart';
import 'package:gacha_vault/shared/widgets/gachi_components.dart';
import '../../tool/unified_ux/catalog.dart';
import '../../tool/v33_stage2/fixtures.dart';
import 'v33_stage1_test.dart' as v33;

void main() {
  setUpAll(() async {
    await (FontLoader('Pretendard')
          ..addFont(rootBundle.load('assets/fonts/Pretendard-Regular.otf'))
          ..addFont(rootBundle.load('assets/fonts/Pretendard-Bold.otf')))
        .load();
    await (FontLoader(
      'MaterialIcons',
    )..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'))).load();
  });
  test('Shared review fixture and compiled review catalog are identical', () {
    expect(
      reviewFixture,
      jsonDecode(File('tool/unified_ux/fixture.json').readAsStringSync()),
    );
    expect(reviewBoxes.map((b) => b.priceWon), [1000, 100, 500]);
    expect(reviewOdds.price, 1000);
    expect(
      reviewFixture['odds']['snapshot']['entries'].fold<int>(
        0,
        (int sum, dynamic p) => sum + (p['probabilityPpm'] as int),
      ),
      1000000,
    );
  });
  testWidgets(
    'Home has one real catalog hero and two distinct boxes without duplicated quick menu',
    (tester) async {
      await v33.mount(
        tester,
        v33.home(boxes: [...reviewBoxes, ...reviewBoxes]),
      );
      await tester.drag(find.byType(CustomScrollView), const Offset(0, -350));
      await tester.pumpAndSettle();
      expect(find.byType(CapsuleBoxCard), findsNWidgets(2));
      expect(
        tester.widget<GachiCatalogHero>(find.byType(GachiCatalogHero)).box.id,
        reviewBoxes.first.id,
      );
      expect(
        tester
            .widgetList<CapsuleBoxCard>(find.byType(CapsuleBoxCard))
            .map((c) => c.box.id),
        reviewBoxes.skip(1).map((b) => b.id),
      );
      expect(find.text('구성·확률 보기'), findsOneWidget);
      expect(find.text('보관함'), findsOneWidget); // only bottom navigation
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'All categories remain visible and reachable without horizontal clipping',
    (tester) async {
      String? selected;
      await v33.mount(
        tester,
        SingleChildScrollView(
          child: GachiCategoryTabs(
            selected: 'all',
            onSelected: (s) => selected = s,
          ),
        ),
        width: 320,
        scale: 2,
        nav: false,
      );
      expect(find.text('기타'), findsOneWidget);
      await tester.ensureVisible(find.text('기타'));
      await tester.tap(find.text('기타'));
      expect(selected, 'other');
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'One hundred confirmed groups use a lazy full list without changing results',
    (tester) async {
      final groups = List.generate(
        100,
        (i) => [
          Opening({
            ...openingData(i + 1),
            'prize': {...prizeData(name: '확정 상품 ${i + 1}'), 'itemId': i + 1},
          }),
        ],
      );
      final before = groups.map((g) => g.first.toJson()).toList();
      await v33.mount(
        tester,
        SingleChildScrollView(child: GachiResultGroups(groups: groups)),
        nav: false,
      );
      expect(find.byType(GachiConfirmedResultRow), findsNWidgets(3));
      await tester.ensureVisible(find.byKey(const Key('result-groups-toggle')));
      await tester.tap(find.byKey(const Key('result-groups-toggle')));
      await tester.pumpAndSettle();
      final all = find.byKey(const Key('all-confirmed-results'));
      expect(all, findsOneWidget);
      expect(
        find.byType(GachiConfirmedResultRow).evaluate().length,
        lessThan(25),
      );
      await tester.scrollUntilVisible(
        find.text('확정 상품 100'),
        600,
        scrollable: find.descendant(of: all, matching: find.byType(Scrollable)),
      );
      expect(find.text('확정 상품 100'), findsOneWidget);
      expect(groups.map((g) => g.first.toJson()).toList(), before);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'Login required errors are inline, keyboard and large text remain scrollable',
    (tester) async {
      await v33.mount(
        tester,
        reviewProviders(const LoginPage()),
        width: 320,
        scale: 2,
        keyboard: 280,
        nav: false,
      );
      final button = find.widgetWithText(GachiPrimaryButton, '이메일로 로그인');
      await tester.ensureVisible(button);
      await tester.tap(button);
      await tester.pumpAndSettle();
      expect(find.text('이메일을 입력해주세요'), findsOneWidget);
      expect(find.text('비밀번호를 입력해주세요'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
  for (final screen in reviewScreens) {
    testWidgets('Read-only real-widget catalog captures $screen', (
      tester,
    ) async {
      await v33.mount(
        tester,
        reviewProviders(reviewScreen(screen)),
        nav: screen == 'Home' || screen == 'Box Shop',
      );
      if (screen.contains('Result') || screen == 'Partial') {
        final skip = find.text('스킵');
        if (skip.evaluate().isNotEmpty) {
          await tester.tap(skip);
          await tester.pumpAndSettle();
        }
      }
      expect(tester.takeException(), isNull);
      await v33.capture(
        tester,
        'unified-${screen.toLowerCase().replaceAll(' ', '-')}-390-1x',
      );
    });
  }
}
