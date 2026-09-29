import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:gacha_vault/core/config/app_config.dart';
import 'package:gacha_vault/core/theme/app_theme.dart';
import 'package:gacha_vault/features/gacha/presentation/gacha_detail_page.dart';
import 'package:gacha_vault/features/orders/order_flow_page.dart';
import 'package:gacha_vault/features/orders/order_repository.dart';
import 'package:gacha_vault/features/orders/batch_result_view.dart';
import 'package:gacha_vault/features/orders/single_opening_view.dart';
import 'package:gacha_vault/shared/widgets/gachi_components.dart';
import 'package:gacha_vault/shared/widgets/gachi_opening.dart';
import '../../tool/unified_ux/catalog.dart';
import '../../tool/unified_ux/review_order_fixtures.dart';
import '../../tool/v33_stage2/fixtures.dart';
import 'v33_stage1_test.dart' as capture;
import 'ux_r1_followup_test.dart' show contrast;

Future<void> actualRoot(
  WidgetTester t,
  Widget page, {
  double width = 390,
  double scale = 1,
}) async {
  t.view.physicalSize = Size(width, 844);
  t.view.devicePixelRatio = 1;
  addTearDown(t.view.resetPhysicalSize);
  addTearDown(t.view.resetDevicePixelRatio);
  await t.pumpWidget(
    reviewProviders(
      MaterialApp(
        key: UniqueKey(),
        theme: AppTheme.lightTheme,
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
            textScaler: TextScaler.linear(scale),
            padding: const EdgeInsets.only(top: 44, bottom: 34),
            viewPadding: const EdgeInsets.only(top: 44, bottom: 34),
          ),
          child: RepaintBoundary(
            key: const ValueKey('v33-capture'),
            child: child!,
          ),
        ),
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute<void>(builder: (_) => page),
              ),
              child: const Text('검토 경로 열기'),
            ),
          ),
        ),
      ),
    ),
  );
  await t.tap(find.text('검토 경로 열기'));
  await t.pumpAndSettle();
}

Future<void> tapVisible(WidgetTester t, Finder target) async {
  if (target.evaluate().isEmpty) {
    final scroll = find.byType(Scrollable).last;
    t.state<ScrollableState>(scroll).position.jumpTo(0);
    await t.pumpAndSettle();
    await t.scrollUntilVisible(
      target,
      350,
      maxScrolls: 100,
      scrollable: scroll,
    );
  }
  await t.ensureVisible(target);
  await t.pumpAndSettle();
  expect(target.hitTestable(), findsOneWidget);
  await t.tap(target);
  await t.pumpAndSettle();
}

OrderFlowPage purchase(OrderRepository repo) => OrderFlowPage(
  userId: 10,
  gachaId: 901,
  title: reviewBoxes.first.name,
  initialQuantity: 3,
  repository: repo,
);

class ScopeFixture {
  final calls = <String>[];
  final selectedForOpen = <String>[];
  final recent = reviewReceiptData();
  final old = List.generate(
    2,
    (i) => {
      'id': capsuleId(101 + i),
      'orderId': capsuleId(801),
      'sequence': i + 1,
      'status': 'UNOPENED',
    },
  );
  late List<dynamic> available = [...recent['capsules'], ...old];
  late final repo = fixtureRepository((r) async {
    calls.add('${r.method} ${r.url.path}');
    if (r.url.path == '/orders/gp') return fixtureOk(recent);
    if (r.url.path == '/capsules') {
      return fixtureOk({
        'items': available,
        'totalCount': available.length,
        'page': 1,
        'limit': 20,
      });
    }
    if (r.url.path == '/orders/${capsuleId(800)}') return fixtureOk(recent);
    if (r.url.path.endsWith('/open')) {
      final id = r.url.path.split('/')[2];
      selectedForOpen.add(id);
      return fixtureOk({
        'capsuleId': id,
        'inventoryItemId': selectedForOpen.length,
        'prize': prizeData(),
      });
    }
    if (r.url.path == '/gachas/901/odds') {
      return fixtureOk(reviewFixture['odds']);
    }
    throw StateError('Unexpected request ${r.method} ${r.url.path}');
  });

  Future<void> buyAndPrepare(WidgetTester t) async {
    await actualRoot(t, purchase(repo));
    await tapVisible(t, find.byType(CheckboxListTile));
    await tapVisible(t, find.text('GP로 구매하고 보관하기'));
    await tapVisible(t, find.text('구매한 3개 개봉 준비'));
    expect(find.text('이번 구매에서 3개 선택'), findsOneWidget);
    expect(selectedForOpen, isEmpty);
  }
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

  testWidgets(
    'Real detail Navigator route keeps local purchase theme under AppTheme root',
    (t) async {
      SharedPreferences.setMockInitialValues({});
      FlutterSecureStorage.setMockInitialValues({
        'gacha_vault_access_token': 'synthetic-only',
      });
      final calls = <String>[];
      await http.runWithClient(
        () async {
          await actualRoot(
            t,
            GachaDetailPage(box: reviewBoxes.first, onGoToWallet: () {}),
          );
          await tapVisible(t, find.textContaining('· 구매 전 확인'));
          expect(find.byType(OrderFlowPage), findsOneWidget);
          final theme = Theme.of(t.element(find.text('구매 전 마지막 확인')));
          expect(theme.colorScheme.primary, GachiColors.navy);
          expect(theme.scaffoldBackgroundColor, GachiColors.ivory);
          expect(calls.every((r) => r.startsWith('GET ')), isTrue);
        },
        () => MockClient((r) async {
          calls.add('${r.method} ${r.url.path}');
          if (r.url.path == '/gachas/901') {
            return fixtureOk(reviewFixture['boxes'][0]);
          }
          if (r.url.path == '/gachas/901/odds') {
            return fixtureOk(reviewFixture['odds']);
          }
          if (r.url.path == '/users/me') return fixtureOk({'id': 10});
          throw StateError('Unexpected detail request');
        }),
      );
    },
    skip: !AppConfig.orderPreviewEnabled || AppConfig.apiBaseUrl.isEmpty,
  );

  testWidgets(
    'Purchase, completion and odds sheet use brand controls with real legacy root',
    (t) async {
      final f = ScopeFixture();
      await actualRoot(t, purchase(f.repo));
      final theme = Theme.of(t.element(find.text('구매 전 마지막 확인')));
      expect(theme.scaffoldBackgroundColor, GachiColors.ivory);
      expect(theme.colorScheme.primary, GachiColors.navy);
      expect(
        theme.filledButtonTheme.style!.minimumSize!.resolve({}),
        GachiTheme.data.filledButtonTheme.style!.minimumSize!.resolve({}),
      );
      await capture.capture(t, 'r1-strict-purchase-actual-root');
      await tapVisible(t, find.byKey(const Key('purchase-odds-disclosure')));
      final sheetTheme = Theme.of(
        t.element(find.byKey(const Key('purchase-odds-list'))),
      );
      expect(sheetTheme.colorScheme.primary, GachiColors.navy);
      expect(sheetTheme.textTheme, theme.textTheme);
      await capture.capture(t, 'r1-strict-odds-actual-root');
      await tapVisible(t, find.byTooltip('확률 안내 닫기'));
      await tapVisible(t, find.byType(CheckboxListTile));
      await tapVisible(t, find.text('GP로 구매하고 보관하기'));
      expect(find.byType(GachiScaffold), findsOneWidget);
      final actual = Theme.of(t.element(find.text('구매한 3개 개봉 준비')));
      await actualRoot(t, reviewScreen('Purchase Complete'));
      expect(
        Theme.of(t.element(find.text('구매한 3개 개봉 준비'))).scaffoldBackgroundColor,
        actual.scaffoldBackgroundColor,
      );
      expect(f.calls.where((r) => r.startsWith('POST')).toList(), [
        'POST /orders/gp',
      ]);
    },
  );

  testWidgets(
    'B3 and old A2 never silently cross recent/all scope; cancel preserves only current selection',
    (t) async {
      final f = ScopeFixture();
      await f.buyAndPrepare(t);
      for (final chip in t.widgetList<ChoiceChip>(find.byType(ChoiceChip))) {
        expect(
          contrast(
            chip.labelStyle!.color!,
            chip.selected ? chip.selectedColor! : chip.backgroundColor!,
          ),
          greaterThanOrEqualTo(4.5),
        );
      }
      await capture.capture(t, 'r1-strict-recent-selected');
      await tapVisible(t, find.text('전체 미개봉'));
      expect(find.byKey(const Key('opening-selection-scope')), findsNothing);
      await tapVisible(t, find.byKey(ValueKey('unopened-${capsuleId(101)}')));
      expect(find.text('전체 미개봉에서 1개 선택'), findsOneWidget);
      await tapVisible(t, find.text('이번 구매'));
      expect(find.byKey(const Key('opening-selection-scope')), findsNothing);
      expect(find.byKey(ValueKey('unopened-${capsuleId(101)}')), findsNothing);
      await tapVisible(t, find.text('이 페이지 선택'));
      await tapVisible(t, find.text('선택한 3개 개봉 · 0 GP'));
      expect(find.textContaining('이번 구매에서 3개 선택'), findsWidgets);
      await tapVisible(t, find.text('돌아가기'));
      expect(f.selectedForOpen, isEmpty);
      expect(find.text('이번 구매에서 3개 선택'), findsOneWidget);
      await tapVisible(t, find.text('선택한 3개 개봉 · 0 GP'));
      await tapVisible(t, find.text('3개 개봉'));
      expect(f.selectedForOpen, [capsuleId(1), capsuleId(2), capsuleId(3)]);
      expect(
        f.selectedForOpen.toSet().intersection(
          f.old.map((c) => c['id'] as String).toSet(),
        ),
        isEmpty,
      );
    },
  );

  testWidgets(
    'Refresh invalidates selection when another session opened/refunded capsules',
    (t) async {
      final f = ScopeFixture();
      await f.buyAndPrepare(t);
      // Authoritative unopened query now excludes opened B1 and refunded B2.
      f.available = [f.recent['capsules'][2], ...f.old];
      await tapVisible(t, find.text('새로고침'));
      expect(find.byKey(const Key('opening-selection-scope')), findsNothing);
      expect(find.byKey(ValueKey('unopened-${capsuleId(1)}')), findsNothing);
      expect(find.byKey(ValueKey('unopened-${capsuleId(2)}')), findsNothing);
      await tapVisible(t, find.text('이 페이지 선택'));
      await tapVisible(t, find.text('선택한 3개 개봉 · 0 GP'));
      await tapVisible(t, find.text('3개 개봉'));
      expect(f.selectedForOpen, [capsuleId(3), capsuleId(101), capsuleId(102)]);
    },
  );

  testWidgets('Cross-page selection is retained, disclosed and capped at 100', (
    t,
  ) async {
    final repo = fixtureRepository((r) async {
      final page = int.parse(r.url.queryParameters['page']!);
      return fixtureOk({
        'items': List.generate(
          20,
          (i) => {
            'id': capsuleId((page - 1) * 20 + i + 1),
            'orderId': capsuleId(800 + page),
            'sequence': i + 1,
            'status': 'UNOPENED',
          },
        ),
        'totalCount': 120,
        'page': page,
        'limit': 20,
      });
    });
    await actualRoot(t, OrderFlowPage(userId: 10, repository: repo));
    for (var page = 1; page <= 6; page++) {
      await tapVisible(t, find.text('이 페이지 선택'));
      expect(
        find.text('선택한 ${page.clamp(1, 5) * 20}개 개봉 · 0 GP'),
        findsOneWidget,
      );
      if (page > 1) expect(find.textContaining('다른 페이지 '), findsOneWidget);
      if (page < 6) await tapVisible(t, find.text('다음'));
    }
    await tapVisible(t, find.text('선택한 100개 개봉 · 0 GP'));
    expect(find.textContaining('다른 페이지 100개 포함'), findsWidgets);
    await tapVisible(t, find.text('돌아가기'));
  });

  for (final width in [320.0, 360.0, 390.0, 430.0]) {
    for (final scale in [1.0, 2.0]) {
      testWidgets(
        'Purchase consent, odds, selection and confirmation reachable at $width/$scale',
        (t) async {
          final f = ScopeFixture();
          await actualRoot(t, purchase(f.repo), width: width, scale: scale);
          await tapVisible(
            t,
            find.byKey(const Key('purchase-odds-disclosure')),
          );
          expect(find.byKey(const Key('purchase-odds-list')), findsOneWidget);
          await tapVisible(t, find.byTooltip('확률 안내 닫기'));
          await tapVisible(t, find.byType(CheckboxListTile));
          await tapVisible(t, find.text('GP로 구매하고 보관하기'));
          await tapVisible(t, find.text('구매한 3개 개봉 준비'));
          await tapVisible(t, find.text('선택한 3개 개봉 · 0 GP'));
          expect(find.textContaining('이번 구매에서 3개 선택'), findsWidgets);
          await tapVisible(t, find.text('돌아가기'));
          expect(f.selectedForOpen, isEmpty);
          expect(t.takeException(), isNull);
        },
      );
      testWidgets(
        'GET-only direct recovery shares result shell at $width/$scale and acknowledges on close',
        (t) async {
          final store = FixtureStore();
          final calls = <String>[];
          final result = reviewBatch(completed: 1, total: 1).results.single;
          final repo = fixtureRepository((r) async {
            calls.add('${r.method} ${r.url.path}');
            if (r.url.path.endsWith('/result')) {
              return fixtureOk(result.toJson());
            }
            if (r.url.path.endsWith('/odds')) {
              return fixtureOk(reviewFixture['odds']);
            }
            throw StateError('Unexpected recovery request');
          }, store: store);
          store.values['${repo.scope}_opening'] = result.capsuleId;
          await actualRoot(t, purchase(repo), width: width, scale: scale);
          await tapVisible(t, find.text('이전 개봉 결과 확인'));
          expect(find.byType(SingleOpeningView), findsOneWidget);
          expect(find.byType(GachiOpeningScaffold), findsOneWidget);
          final theme = Theme.of(t.element(find.byType(GachiOpeningHeading)));
          expect(theme.brightness, Brightness.dark);
          expect(
            contrast(GachiColors.ivory, theme.scaffoldBackgroundColor),
            greaterThanOrEqualTo(4.5),
          );
          expect(calls.where((c) => c.endsWith('/result')).length, 1);
          expect(calls.every((c) => c.startsWith('GET ')), isTrue);
          expect(
            t
                .widget<SingleOpeningView>(find.byType(SingleOpeningView))
                .opening!
                .toJson(),
            result.toJson(),
          );
          expect(await repo.pendingOpening(), result.capsuleId);
          if (width == 390 && scale == 1 || width == 320 && scale == 2) {
            await capture.capture(
              t,
              'r1-strict-direct-recovery-${width.toInt()}-${scale.toInt()}',
            );
          }
          await t.ensureVisible(find.text('보관함 보기'));
          await t.pumpAndSettle();
          expect(find.text('보관함 보기').hitTestable(), findsOneWidget);
          await tapVisible(t, find.text('확인하고 돌아가기'));
          expect(await repo.pendingOpening(), isNull);
          expect(find.text('검토 경로 열기'), findsOneWidget);
          expect(t.takeException(), isNull);
        },
      );

      testWidgets(
        'Single and partial result CTAs really respond at $width/$scale',
        (t) async {
          for (final partial in [false, true]) {
            var collection = 0, resume = 0;
            await actualRoot(
              t,
              GachiOpeningScaffold(
                body: ListView(
                  padding: const EdgeInsets.all(GachiSpace.page),
                  children: [
                    BatchResultView(
                      batch: reviewBatch(
                        completed: 1,
                        total: partial ? 3 : 1,
                        pending: partial,
                      ),
                      working: false,
                      continuing: false,
                      grade: '전체',
                      onGrade: (_) {},
                      onCollection: () => collection++,
                      onClose: () {},
                      onResume: () => resume++,
                    ),
                  ],
                ),
              ),
              width: width,
              scale: scale,
            );
            await tapVisible(t, find.text('보관함 보기'));
            expect(collection, 1);
            if (partial) {
              await tapVisible(t, find.text('처리 중인 결과 확인 후 이어가기'));
              expect(resume, 1);
            }
            expect(t.takeException(), isNull);
          }
        },
      );
    }
  }

  testWidgets(
    '100 normal results large-text first view keeps collection ahead of deferred list',
    (t) async {
      await actualRoot(
        t,
        GachiOpeningScaffold(
          body: ListView(
            padding: const EdgeInsets.all(GachiSpace.page),
            children: [
              BatchResultView(
                batch: reviewBatch(completed: 100, total: 100),
                working: false,
                continuing: false,
                grade: '전체',
                onGrade: (_) {},
                onCollection: () {},
                onClose: () {},
                onResume: () {},
              ),
            ],
          ),
        ),
        width: 320,
        scale: 2,
      );
      await capture.capture(t, 'r1-strict-100-result-320-2-first-view');
      await tapVisible(t, find.text('보관함 보기'));
      expect(t.takeException(), isNull);
    },
  );
}
