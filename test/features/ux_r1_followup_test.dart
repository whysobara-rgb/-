import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/features/orders/batch_opening_page.dart';
import 'package:gacha_vault/features/orders/order_flow_page.dart';
import 'package:gacha_vault/shared/widgets/gachi_components.dart';
import 'package:gacha_vault/shared/widgets/gachi_opening.dart';
import '../../tool/unified_ux/catalog.dart';
import '../../tool/unified_ux/review_order_fixtures.dart';
import '../../tool/v33_stage2/fixtures.dart';
import 'v33_stage1_test.dart' as capture;
import 'v33_stage2_test.dart' as stage2;

Map<String, dynamic> oddsWith(int count) => {
  ...reviewFixture['odds'],
  'snapshot': {
    'schemaVersion': 1,
    'mode': 'FIXED_PPM',
    'entries': List.generate(
      count,
      (i) => {
        ...prizeData(name: '합성 구성 상품 ${i + 1}'),
        'itemId': i + 1,
        'probabilityPpm': 1000000 ~/ count,
      },
    ),
  },
};

double contrast(Color a, Color b) {
  final values = [a.computeLuminance(), b.computeLuminance()]..sort();
  return (values.last + .05) / (values.first + .05);
}

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
  test(
    'Review purchase, result and collection use the same catalog snapshot',
    () {
      final receipt = reviewReceipt();
      final results = reviewBatch().results;
      expect(receipt.title, reviewBoxes.first.name);
      expect(receipt.unitPrice, reviewOdds.price);
      for (final result in results) {
        expect(
          reviewOdds.prizes.map((p) => p.itemId),
          contains(result.prize.itemId),
        );
        final item = reviewInventory().singleWhere(
          (i) => i.numericId == result.inventoryId,
        );
        expect(item.name, result.prize.name);
        expect(item.conversionGP, result.prize.conversionGP);
        expect(item.grade, result.prize.displayGrade);
      }
    },
  );
  testWidgets(
    'Catalog and actual batch route share theme, shell and safe area',
    (t) async {
      Color? actualBackground;
      for (final page in [
        BatchOpeningPage(repository: readOnlyRepository(batch: reviewBatch())),
        reviewScreen('Result'),
        reviewScreen('Partial'),
      ]) {
        await stage2.mount(t, page);
        expect(find.byType(GachiOpeningScaffold), findsOneWidget);
        final heading = find.byType(GachiOpeningHeading).first;
        final context = t.element(heading);
        final theme = Theme.of(context);
        expect(theme.brightness, Brightness.dark);
        expect(
          theme.scaffoldBackgroundColor,
          actualBackground ?? GachiColors.navy,
        );
        actualBackground = theme.scaffoldBackgroundColor;
        expect(
          contrast(GachiColors.ivory, actualBackground),
          greaterThanOrEqualTo(4.5),
        );
        expect(
          contrast(GachiOpeningColors.secondary, actualBackground),
          greaterThanOrEqualTo(4.5),
        );
        expect(
          find.ancestor(of: heading, matching: find.byType(SafeArea)),
          findsWidgets,
        );
        expect(t.takeException(), isNull);
      }
    },
  );

  for (final prizes in [2, 20, 100]) {
    for (final quantity in [1, 10, 50, 100]) {
      testWidgets(
        '$prizes prize confirmation keeps $quantity purchase amount and action ahead of full odds',
        (t) async {
          var posts = 0;
          final odds = oddsWith(prizes);
          final repo = fixtureRepository((r) async {
            if (r.method != 'GET') posts++;
            return fixtureOk(odds);
          });
          await stage2.mount(
            t,
            OrderFlowPage(
              userId: 10,
              gachaId: 901,
              title: '합성 박스',
              initialQuantity: quantity,
              repository: repo,
            ),
          );
          final button = find.text('GP로 구매하고 보관하기');
          expect(button.hitTestable(), findsOneWidget);
          expect(
            t.widget<Text>(find.textContaining('합계 ')).data,
            '합계 ${(quantity * 1000).toString().replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+(?!\d))'), (m) => '${m[1]},')} GP',
          );
          await t.tap(button);
          expect(posts, 0); // explicit consent still required
          expect(find.text('합성 구성 상품 $prizes'), findsNothing);
          await t.ensureVisible(
            find.byKey(const Key('purchase-odds-disclosure')),
          );
          await t.tap(find.byKey(const Key('purchase-odds-disclosure')));
          await t.pumpAndSettle();
          final list = find.byKey(const Key('purchase-odds-list'));
          expect(
            t.widget<ListView>(list).childrenDelegate.estimatedChildCount,
            prizes,
          );
          await t.scrollUntilVisible(
            find.text('합성 구성 상품 $prizes'),
            500,
            maxScrolls: 100,
            scrollable: find.descendant(
              of: list,
              matching: find.byType(Scrollable),
            ),
          );
          expect(find.text('합성 구성 상품 $prizes'), findsOneWidget);
          expect(posts, 0);
          expect(t.takeException(), isNull);
        },
      );
    }
  }

  testWidgets(
    'Purchase prepares only that receipt, without sending any open request',
    (t) async {
      final posts = <String>[];
      Map<String, dynamic>? body;
      final repo = fixtureRepository((r) async {
        if (r.method == 'POST') {
          posts.add(r.url.path);
          body = jsonDecode(r.body) as Map<String, dynamic>;
          return fixtureOk(reviewReceiptData());
        }
        if (r.url.path == '/capsules') {
          return fixtureOk({
            'items': reviewReceiptData()['capsules'],
            'totalCount': 3,
            'page': 1,
            'limit': 20,
          });
        }
        return fixtureOk(reviewFixture['odds']);
      });
      await stage2.mount(
        t,
        OrderFlowPage(
          userId: 10,
          gachaId: 901,
          title: reviewBoxes.first.name,
          initialQuantity: 3,
          repository: repo,
        ),
      );
      await t.ensureVisible(find.byType(CheckboxListTile));
      await t.tap(find.byType(CheckboxListTile));
      await t.pump();
      await t.tap(find.text('GP로 구매하고 보관하기'));
      await t.pumpAndSettle();
      expect(posts, ['/orders/gp']);
      expect(body!['quantity'], 3);
      await t.ensureVisible(find.text('구매한 3개 개봉 준비'));
      await t.tap(find.text('구매한 3개 개봉 준비'));
      await t.pumpAndSettle();
      expect(find.text('선택한 3개 개봉 · 0 GP').hitTestable(), findsOneWidget);
      expect(find.text('이번 구매'), findsOneWidget);
      expect(find.text('이전'), findsNothing);
      expect(find.text('다음'), findsNothing);
      expect(posts, ['/orders/gp']);
      await t.tap(find.text('선택한 3개 개봉 · 0 GP'));
      await t.pumpAndSettle();
      expect(find.text('박스 3개를 개봉할까요?'), findsOneWidget);
      expect(posts, ['/orders/gp']);
      await t.tap(find.text('돌아가기'));
      await t.pumpAndSettle();
      expect(posts, ['/orders/gp']);
    },
  );

  testWidgets(
    'Normal result has no recovery/zero statuses, partial keeps all three meanings',
    (t) async {
      await stage2.mount(t, reviewScreen('Result'));
      expect(find.byType(GachiOpeningBreakdown), findsNothing);
      expect(find.textContaining('남은 박스 이어서'), findsNothing);
      expect(find.text('보관함 보기').hitTestable(), findsOneWidget);
      await stage2.mount(t, reviewScreen('Partial'));
      expect(find.text('개봉 완료 1개'), findsOneWidget);
      expect(find.text('처리 결과 확인 중 1개'), findsOneWidget);
      expect(find.text('아직 미개봉 1개'), findsOneWidget);
      expect(find.text('처리 중인 결과 확인 후 이어가기'), findsOneWidget);
      await stage2.mount(t, reviewScreen('Unopened Retained'));
      expect(find.text('아직 미개봉 3개'), findsOneWidget);
      expect(find.textContaining('일부'), findsNothing);
    },
  );

  for (final width in [320.0, 360.0, 390.0, 430.0]) {
    for (final scale in [1.0, 2.0]) {
      testWidgets('R1 actions and readable states at $width / $scale', (
        t,
      ) async {
        for (final screen in [
          'Purchase',
          'Purchase Complete',
          'Open',
          'Single Result',
          'Result',
          'Partial',
        ]) {
          await capture.mount(
            t,
            reviewProviders(reviewScreen(screen)),
            width: width,
            scale: scale,
            nav: false,
          );
          if (screen == 'Purchase') {
            await t.scrollUntilVisible(
              find.text('GP로 구매하고 보관하기'),
              160,
              maxScrolls: 12,
            );
            await t.pumpAndSettle();
            expect(find.text('GP로 구매하고 보관하기').hitTestable(), findsOneWidget);
          }
          if (screen == 'Result') {
            await t.ensureVisible(find.text('보관함 보기'));
            await t.pumpAndSettle();
            expect(find.text('보관함 보기').hitTestable(), findsOneWidget);
          }
          if (screen == 'Partial') {
            expect(find.byType(GachiOpeningBreakdown), findsOneWidget);
          }
          expect(
            MediaQuery.textScalerOf(
              t.element(find.byType(Scaffold).last),
            ).scale(10),
            scale * 10,
          );
          expect(t.takeException(), isNull);
          if (width == 390 && scale == 1 || width == 320 && scale == 2) {
            await capture.capture(
              t,
              'r1-${screen.toLowerCase().replaceAll(' ', '-')}-${width.toInt()}-${scale.toInt()}',
            );
          }
        }
      });
    }
  }
}
