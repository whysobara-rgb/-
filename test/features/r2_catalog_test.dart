import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:gacha_vault/core/config/app_config.dart';
import 'package:gacha_vault/core/theme/app_theme.dart';
import 'package:gacha_vault/features/home/domain/capsule_box.dart';
import 'package:gacha_vault/features/home/presentation/home_page.dart';
import 'package:gacha_vault/features/home/presentation/catalog_views.dart';
import 'package:gacha_vault/features/home/presentation/widgets/capsule_box_card.dart';
import 'package:gacha_vault/features/gacha/presentation/gacha_detail_page.dart';
import 'package:gacha_vault/shared/models/app_user.dart';
import 'package:gacha_vault/shared/providers/auth_provider.dart';
import 'package:gacha_vault/shared/providers/gp_provider.dart';
import 'package:gacha_vault/shared/widgets/gachi_components.dart';
import '../../tool/r2/fixture.dart' as review;
import 'v33_stage1_test.dart' as v33;

// State/route tests isolate image I/O; actual photo/error frames have separate captures.
final r2Boxes = review.r2Boxes
    .map(
      (b) => CapsuleBox(
        id: b.id,
        name: b.name,
        category: b.category,
        priceWon: b.priceWon,
        icon: b.icon,
        accentColor: b.accentColor,
      ),
    )
    .toList();

void main() {
  testWidgets(
    'Home first viewport contains exact box, GP and actionable detail CTA',
    (tester) async {
      final opened = <int>[];
      await v33.mount(
        tester,
        HomeScreen(
          boxes: r2Boxes,
          balance: '93,800',
          onRefresh: () async {},
          onOpen: (b) => opened.add(b.id),
          onWallet: () {},
          onShop: () {},
          onRanking: () {},
          onOpenUnopened: () {},
          onCollection: () {},
        ),
      );
      expect(find.text('사운드 박스'), findsOneWidget);
      expect(find.text('1개 · 1,000 GP'), findsOneWidget);
      final cta = find.text('구성·확률 보기');
      expect(
        tester.getBottomRight(cta).dy,
        lessThan(tester.getTopLeft(find.byType(GachiBottomNavigation)).dy),
      );
      await tester.tap(cta);
      expect(opened, [9901]);
      expect(find.byType(GachiCategoryTabs), findsNothing);
      expect(find.byType(GachiCampaignPager), findsNothing);
      await tester.ensureVisible(find.text('전체 보기'));
      expect(tester.takeException(), isNull);
    },
  );
  for (final count in [null, 0, 5]) {
    testWidgets(
      'Home unopened $count is conditional, labelled and actionable',
      (tester) async {
        var opened = 0;
        await v33.mount(
          tester,
          HomeScreen(
            boxes: r2Boxes,
            balance: '1,000',
            unopenedCount: count,
            onRefresh: () async {},
            onOpen: (_) {},
            onWallet: () {},
            onShop: () {},
            onRanking: () {},
            onOpenUnopened: () => opened++,
            onCollection: () {},
          ),
        );
        final row = find.byKey(const Key('home-unopened'));
        if (count == 5) {
          await tester.ensureVisible(row);
          await tester.tap(row);
          expect(opened, 1);
          expect(find.text('미개봉 5개'), findsOneWidget);
        } else {
          expect(row, findsNothing);
          expect(opened, 0);
        }
      },
    );
  }
  testWidgets(
    'Filter draft cancel, category+sort apply, search and clear preserve exact IDs',
    (tester) async {
      await v33.mount(tester, v33.shop(boxes: r2Boxes));
      Future<void> panel() async {
        await tester.tap(find.byKey(const Key('catalog-filter')));
        await tester.pumpAndSettle();
      }

      List<int> ids() => tester
          .widgetList<CapsuleBoxCard>(find.byType(CapsuleBoxCard))
          .map((c) => c.box.id)
          .toList();
      await panel();
      await tester.tap(find.text('리빙'));
      await tester.tap(find.byTooltip('필터 닫기'));
      await tester.pumpAndSettle();
      expect(ids(), [9901, 9902, 9903]);
      await panel();
      await tester.tap(find.text('리빙'));
      await tester.tap(find.byKey(const Key('catalog-filter-apply')));
      await tester.pumpAndSettle();
      expect(ids(), [9902]);
      expect(find.text('리빙 · 기본순'), findsOneWidget);
      await panel();
      await tester.tap(find.text('필터 초기화'));
      await tester.tap(find.text('낮은 가격순'));
      await tester.tap(find.byKey(const Key('catalog-filter-apply')));
      await tester.pumpAndSettle();
      expect(ids(), [9903, 9902, 9901]);
      await tester.enterText(find.byType(TextField), '사운드');
      await tester.pumpAndSettle();
      expect(ids(), [9901]);
      await tester.enterText(find.byType(TextField), '없음');
      await tester.pumpAndSettle();
      expect(find.text('검색 결과가 없어요'), findsOneWidget);
      await tester.ensureVisible(find.text('전체 보기'));
      await tester.tap(find.text('전체 보기'));
      await tester.pumpAndSettle();
      expect(ids(), [9901, 9902, 9903]);
      expect(find.text('전체 · 기본순'), findsOneWidget);
    },
  );
  for (final width in [320.0, 360.0, 390.0, 430.0]) {
    for (final scale in [1.0, 2.0]) {
      testWidgets(
        'Filter panel reachable width=$width scale=$scale including keyboard',
        (tester) async {
          await v33.mount(
            tester,
            v33.shop(boxes: r2Boxes),
            width: width,
            scale: scale,
            keyboard: 250,
          );
          await tester.ensureVisible(find.byKey(const Key('catalog-filter')));
          await tester.tap(find.byKey(const Key('catalog-filter')));
          await tester.pumpAndSettle();
          await tester.ensureVisible(find.text('기타'));
          await tester.tap(find.text('기타'));
          await tester.ensureVisible(
            find.byKey(const Key('catalog-filter-apply')),
          );
          await tester.tap(find.byKey(const Key('catalog-filter-apply')));
          await tester.pumpAndSettle();
          expect(find.text('기타 · 기본순'), findsOneWidget);
          expect(tester.takeException(), isNull);
        },
      );
    }
  }
  testWidgets('Home primary action stays readable and tappable at 320 / 200%', (
    tester,
  ) async {
    var calls = 0;
    await v33.mount(
      tester,
      HomeScreen(
        boxes: r2Boxes,
        balance: '123,456,789',
        onRefresh: () async {},
        onOpen: (_) => calls++,
        onWallet: () {},
        onShop: () {},
        onRanking: () {},
        onOpenUnopened: () {},
        onCollection: () {},
      ),
      width: 320,
      scale: 2,
    );
    await tester.scrollUntilVisible(
      find.text('구성·확률 보기'),
      250,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    expect(find.text('구성·확률 보기').hitTestable(), findsOneWidget);
    await tester.tap(find.text('구성·확률 보기'));
    expect(calls, 1);
    expect(tester.takeException(), isNull);
  });
  testWidgets(
    'Shop lazily builds a large catalog and reaches the last real record',
    (tester) async {
      final many = List.generate(
        150,
        (i) => CapsuleBox(
          id: i + 1,
          name: '박스 번호 ${i + 1}',
          priceWon: i + 1,
          icon: Icons.inventory_2,
          accentColor: GachiColors.gold,
        ),
      );
      int? opened;
      await v33.mount(
        tester,
        BoxShopScreen(
          boxes: many,
          balance: '0',
          onRefresh: () async {},
          onOpen: (b) => opened = b.id,
          onWallet: () {},
        ),
      );
      expect(find.byType(CapsuleBoxCard).evaluate().length, lessThan(15));
      await tester.scrollUntilVisible(
        find.text('박스 번호 150'),
        600,
        scrollable: find.byType(Scrollable).first,
        maxScrolls: 90,
      );
      await tester.tap(find.text('박스 번호 150'));
      expect(opened, 150);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'HomePage actual detail route uses selected ID and performs read-only requests',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final requests = <String>[];
      SharedPreferences.setMockInitialValues({});
      FlutterSecureStorage.setMockInitialValues({});
      final auth = SessionAuth(), gp = GpProvider(initialBalance: 93800);
      await http.runWithClient(
        () async {
          await tester.pumpWidget(
            MultiProvider(
              providers: [
                ChangeNotifierProvider<AuthProvider>.value(value: auth),
                ChangeNotifierProvider<GpProvider>.value(value: gp),
              ],
              child: MaterialApp(
                theme: AppTheme.lightTheme,
                home: HomePage(
                  loadCatalog: () async => r2Boxes,
                  loadUnopenedCount: (_) async => 0,
                  onGoToWallet: () {},
                  onShop: () {},
                  onRanking: () {},
                  onOpenUnopened: () {},
                  onCollection: () {},
                ),
              ),
            ),
          );
          await tester.pumpAndSettle();
          await tester.ensureVisible(find.text('구성·확률 보기'));
          await tester.pumpAndSettle();
          await tester.tap(find.text('구성·확률 보기'));
          await tester.pumpAndSettle();
          expect(
            tester.widget<GachaDetailPage>(find.byType(GachaDetailPage)).box.id,
            9901,
          );
          expect(requests, contains('GET /gachas/9901'));
          expect(requests, contains('GET /gachas/9901/odds'));
          expect(requests.every((r) => r.startsWith('GET ')), isTrue);
          expect(find.text('1,000 GP'), findsWidgets);
          expect(tester.takeException(), isNull);
        },
        () => MockClient((r) async {
          requests.add('${r.method} ${r.url.path}');
          if (r.url.path == '/gachas/9901') {
            return http.Response(
              jsonEncode({
                'statusCode': 10000,
                'data': {
                  'id': 9901,
                  'title': '사운드 박스',
                  'price': 1000,
                  'description': '합성 데이터',
                  'totalStock': 100,
                  'soldStock': 0,
                  'lineup': [],
                },
              }),
              200,
              headers: {'content-type': 'application/json'},
            );
          }
          return http.Response(
            jsonEncode({'statusCode': 404, 'message': 'Not in this fixture'}),
            404,
          );
        }),
      );
      await tester.pumpWidget(const SizedBox());
      auth.dispose();
      gp.dispose();
    },
    skip: AppConfig.apiBaseUrl.isEmpty,
  );
  testWidgets(
    'Unopened count is session-bound, ignores late account response, refreshes and fails closed',
    (tester) async {
      final auth = SessionAuth(), gp = GpProvider(initialBalance: 93800);
      final first = Completer<int>();
      var calls = 0, revision = 0;
      late StateSetter update;
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider<AuthProvider>.value(value: auth),
            ChangeNotifierProvider<GpProvider>.value(value: gp),
          ],
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: StatefulBuilder(
              builder: (_, set) {
                update = set;
                return HomePage(
                  refreshRevision: revision,
                  loadCatalog: () async => r2Boxes,
                  loadUnopenedCount: (id) {
                    calls++;
                    return calls == 1
                        ? first.future
                        : calls == 3
                        ? Future.error(StateError('Synthetic count failure'))
                        : Future.value(7);
                  },
                  onGoToWallet: () {},
                  onShop: () {},
                  onRanking: () {},
                  onOpenUnopened: () {},
                  onCollection: () {},
                );
              },
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      if (!AppConfig.orderPreviewEnabled) {
        expect(calls, 0);
        expect(find.byKey(const Key('home-unopened')), findsNothing);
      } else {
        expect(calls, 1);
        auth.changeAccount(2);
        await tester.pumpAndSettle();
        expect(calls, 2);
        first.complete(99);
        await tester.pumpAndSettle();
        expect(find.text('미개봉 99개'), findsNothing);
        await tester.scrollUntilVisible(
          find.text('미개봉 7개'),
          200,
          scrollable: find.byType(Scrollable).first,
        );
        expect(find.text('미개봉 7개'), findsOneWidget);
        update(() => revision++);
        await tester.pumpAndSettle();
        expect(calls, 3);
        expect(find.byKey(const Key('home-unopened')), findsNothing);
        auth.changeAccount(null);
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('home-unopened')), findsNothing);
      }
      await tester.pumpWidget(const SizedBox());
      auth.dispose();
      gp.dispose();
    },
  );
}

class SessionAuth extends AuthProvider {
  int generation = 1;
  int? id = 1;
  @override
  int get sessionGeneration => generation;
  @override
  AppUser? get currentUser => id == null
      ? null
      : AppUser(
          id: id!,
          email: 'review@invalid.test',
          nickname: '합성',
          coinBalance: 93800,
        );
  @override
  bool isSessionCurrent(int generation) =>
      generation == this.generation && id != null;
  @override
  Future<void> refreshProfile() async {}
  void changeAccount(int? value) {
    id = value;
    generation++;
    notifyListeners();
  }
}
