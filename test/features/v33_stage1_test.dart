import 'dart:async';
import 'dart:io';
import 'package:cached_network_image/cached_network_image.dart';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:gacha_vault/features/home/presentation/home_page.dart';
import 'package:gacha_vault/features/home/presentation/widgets/capsule_box_card.dart';
import 'package:gacha_vault/features/home/domain/capsule_box.dart';
import 'package:gacha_vault/features/home/domain/gacha_detail.dart';
import 'package:gacha_vault/features/gacha/presentation/product_detail_view.dart';
import 'package:gacha_vault/shared/widgets/gachi_components.dart';
import 'package:gacha_vault/shared/providers/auth_provider.dart';
import 'package:gacha_vault/shared/providers/gp_provider.dart';
import '../../tool/v33/fixtures.dart';
import '../../tool/v33/ui_probe.dart';

void noop() {}
HomeScreen home({
  List<CapsuleBox> boxes = v33Boxes,
  bool loading = false,
  String? error,
  Future<void> Function()? refresh,
}) => HomeScreen(
  boxes: boxes,
  balance: '9,900',
  loading: loading,
  error: error,
  onRefresh: refresh ?? () async {},
  onOpen: (_) {},
  onWallet: noop,
  onShop: noop,
  onRanking: noop,
  onOpenUnopened: noop,
  onCollection: noop,
  onUpdates: noop,
);
BoxShopScreen shop({
  List<CapsuleBox> boxes = v33Boxes,
  bool loading = false,
  String? error,
  Future<void> Function()? refresh,
}) => BoxShopScreen(
  boxes: boxes,
  balance: '9,900',
  loading: loading,
  error: error,
  onRefresh: refresh ?? () async {},
  onOpen: (_) {},
  onWallet: noop,
);
Widget detail({
  GachaDetail data = v33Detail,
  int quantity = 1,
  int maxQuantity = 100,
  VoidCallback onPurchase = noop,
  VoidCallback onIncrement = noop,
}) => GachiScaffold(
  title: '박스 상세',
  body: ProductDetailView(
    box: v33Boxes.first,
    detail: data,
    odds: v33Odds,
    quantity: quantity,
    maxQuantity: maxQuantity,
    totalPriceLabel: '1,000 GP',
    onDecrement: noop,
    onIncrement: onIncrement,
    onPurchase: onPurchase,
  ),
);

Future<void> mount(
  WidgetTester tester,
  Widget screen, {
  double width = 390,
  double height = 844,
  double scale = 1,
  bool nav = true,
  bool settle = true,
  double keyboard = 0,
}) async {
  tester.view.physicalSize = Size(width, height);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      key: UniqueKey(),
      theme: GachiTheme.data,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: TextScaler.linear(scale),
          padding: const EdgeInsets.only(top: 44, bottom: 34),
          viewPadding: const EdgeInsets.only(top: 44, bottom: 34),
          viewInsets: EdgeInsets.only(bottom: keyboard),
        ),
        child: child!,
      ),
      home: RepaintBoundary(
        key: const ValueKey('v33-capture'),
        child: Scaffold(
          body: screen,
          bottomNavigationBar: nav
              ? GachiBottomNavigation(
                  selectedIndex: screen is BoxShopScreen ? 1 : 0,
                  onSelected: (_) {},
                )
              : null,
        ),
      ),
    ),
  );
  if (settle) {
    await tester.pumpAndSettle();
  } else {
    await tester.pump();
  }
}

Future<void> capture(WidgetTester tester, String name) async {
  final boundary = tester.renderObject<RenderRepaintBoundary>(
    find.byKey(const ValueKey('v33-capture')),
  );
  await tester.runAsync(() async {
    final image = await boundary.toImage(pixelRatio: 1.5);
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    final file = File('build/ui-previews/v33-$name.png');
    await file.parent.create(recursive: true);
    await file.writeAsBytes(data!.buffer.asUint8List());
    image.dispose();
  });
}

Future<void> inspectScroll(WidgetTester tester) async {
  final scroll = find.byType(CustomScrollView).evaluate().isNotEmpty
      ? find.byType(CustomScrollView).first
      : find.byType(ListView).first;
  for (var i = 0; i < 8; i++) {
    await tester.drag(scroll, const Offset(0, -400));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
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
  for (final width in [320.0, 360.0, 390.0, 430.0]) {
    for (final scale in [1.0, 2.0]) {
      for (final name in ['home', 'shop', 'detail']) {
        testWidgets(
          '$name width=$width scale=$scale, safe areas and full content',
          (tester) async {
            await mount(
              tester,
              name == 'home'
                  ? home()
                  : name == 'shop'
                  ? shop()
                  : detail(),
              width: width,
              scale: scale,
              nav: name != 'detail',
            );
            expect(tester.takeException(), isNull);
            if (width == 390 && scale == 1 || width == 320 && scale == 2) {
              await capture(tester, '$name-${width.toInt()}-${scale.toInt()}x');
            }
            await inspectScroll(tester);
            if (name == 'detail') {
              expect(find.text('1,000 GP · 구매 전 확인'), findsOneWidget);
              expect(find.text('90%'), findsOneWidget);
              expect(find.text('10%'), findsOneWidget);
            }
          },
        );
      }
    }
  }
  for (final name in ['home', 'shop', 'detail']) {
    testWidgets('$name landscape with 200% text remains scrollable', (
      tester,
    ) async {
      await mount(
        tester,
        name == 'home'
            ? home()
            : name == 'shop'
            ? shop()
            : detail(),
        width: 844,
        height: 390,
        scale: 2,
        nav: name != 'detail',
      );
      expect(tester.takeException(), isNull);
      await inspectScroll(tester);
    });
  }
  for (final isHome in [true, false]) {
    testWidgets('${isHome ? 'home' : 'shop'} loading, empty, error and retry', (
      tester,
    ) async {
      await mount(
        tester,
        isHome ? home(loading: true) : shop(loading: true),
        settle: false,
      );
      expect(find.byType(GachiLoadingState), findsOneWidget);
      expect(tester.takeException(), isNull);
      await mount(tester, isHome ? home(boxes: []) : shop(boxes: []));
      await inspectScroll(tester);
      expect(find.text('새로운 박스를 준비하고 있어요'), findsOneWidget);
      var retries = 0;
      Future<void> refresh() async {
        retries++;
      }

      await mount(
        tester,
        isHome
            ? home(error: '연결 실패', refresh: refresh)
            : shop(error: '연결 실패', refresh: refresh),
      );
      await tester.scrollUntilVisible(
        find.text('다시 불러오기'),
        200,
        scrollable: find
            .descendant(
              of: find.byType(CustomScrollView),
              matching: find.byType(Scrollable),
            )
            .first,
      );
      await tester.tap(find.text('다시 불러오기'));
      await tester.pump();
      expect(retries, 1);
      expect(tester.takeException(), isNull);
    });
  }
  testWidgets(
    'long title, category and GP sorting survive keyboard and text scale',
    (tester) async {
      const longBox = CapsuleBox(
        id: 904,
        category: 'tech',
        priceWon: 1200,
        name: '아주 긴 상품명도 생략하지 않고 끝까지 읽을 수 있는 컬렉션 박스 이름',
        icon: Icons.inventory_2_outlined,
        accentColor: GachiColors.gold,
      );
      await mount(
        tester,
        shop(boxes: [...v33Boxes, longBox]),
        width: 320,
        scale: 2,
        keyboard: 260,
      );
      await tester.ensureVisible(find.byType(TextField));
      await tester.enterText(find.byType(TextField), '아주 긴');
      await tester.pumpAndSettle();
      await inspectScroll(tester);
      expect(find.text(longBox.name), findsOneWidget);
      expect(
        tester
            .widgetList<CapsuleBoxCard>(find.byType(CapsuleBoxCard))
            .single
            .box
            .id,
        904,
      );
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'image loading/failure keeps its frame, name and detail action accessible',
    (tester) async {
      const url = 'https://fixtures.invalid/v33-failure.png';
      const provider = CachedNetworkImageProvider(url);
      final frame = Completer<ImageInfo>();
      // Controlled image stream, not a claim of HTTP/CDN integration.
      PaintingBinding.instance.imageCache.putIfAbsent(
        provider,
        () => OneFrameImageStreamCompleter(frame.future),
      );
      var opened = 0;
      const box = CapsuleBox(
        id: 999,
        name: '사진 실패 검증 박스',
        priceWon: 200,
        icon: Icons.inventory_2_outlined,
        accentColor: GachiColors.gold,
        imageUrl: url,
      );
      await mount(
        tester,
        GachiScaffold(
          body: SingleChildScrollView(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: CapsuleBoxCard(
                box: box,
                onTap: () {
                  opened++;
                },
              ),
            ),
          ),
        ),
        width: 320,
        scale: 2,
        nav: false,
        settle: false,
      );
      final before = tester.getSize(find.byType(GachiProductImage));
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      frame.completeError(StateError('Controlled image stream failure'));
      await tester.pumpAndSettle();
      expect(find.text('사진을 불러오지 못했어요'), findsOneWidget);
      expect(tester.getSize(find.byType(GachiProductImage)), before);
      await tester.ensureVisible(find.text(box.name));
      await tester.tap(find.text(box.name));
      expect(opened, 1);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      PaintingBinding.instance.imageCache.clear();
    },
  );
  testWidgets('long names remain readable on home and detail at 200%', (
    tester,
  ) async {
    const name = '아주 긴 상품명도 생략하지 않고 끝까지 읽을 수 있는 컬렉션 박스 이름';
    const box = CapsuleBox(
      id: 999,
      name: name,
      priceWon: 200,
      icon: Icons.inventory_2_outlined,
      accentColor: GachiColors.gold,
    );
    await mount(tester, home(boxes: [box]), width: 320, scale: 2);
    await inspectScroll(tester);
    expect(find.text(name), findsWidgets);
    const data = GachaDetail(
      id: 901,
      title: name,
      description: name,
      price: 1000,
      icon: Icons.inventory_2_outlined,
      accentColor: GachiColors.gold,
      totalStock: 10,
      soldStock: 0,
      lineup: [],
    );
    await mount(tester, detail(data: data), width: 320, scale: 2, nav: false);
    await inspectScroll(tester);
    expect(find.text('1,000 GP · 구매 전 확인'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  test('V33 text tokens retain readable foreground contrast', () {
    double contrast(Color foreground, Color background) {
      final a = foreground.computeLuminance(),
          b = background.computeLuminance();
      return (a > b ? a + .05 : b + .05) / (a > b ? b + .05 : a + .05);
    }

    for (final style in [
      GachiType.display,
      GachiType.pageTitle,
      GachiType.section,
      GachiType.product,
      GachiType.body,
      GachiType.meta,
      GachiType.english,
    ]) {
      expect(style.color, GachiColors.ink);
      expect(
        contrast(style.color!, GachiColors.ivory),
        greaterThanOrEqualTo(4.5),
      );
    }
    expect(
      contrast(GachiColors.muted, GachiColors.surface),
      greaterThanOrEqualTo(4.5),
    );
    expect(
      contrast(GachiColors.gold, GachiColors.navy),
      greaterThanOrEqualTo(4.5),
    );
  });
  testWidgets('detail quantity limits and sold-out action stay disabled', (
    tester,
  ) async {
    var calls = 0;
    await mount(
      tester,
      detail(
        quantity: 100,
        maxQuantity: 100,
        onIncrement: () {
          calls++;
        },
      ),
      nav: false,
    );
    expect(
      tester
          .widget<IconButton>(
            find.byWidgetPredicate(
              (w) => w is IconButton && w.tooltip == '수량 늘리기',
            ),
          )
          .onPressed,
      isNull,
    );
    await mount(tester, detail(), nav: false);
    expect(
      tester
          .widget<IconButton>(
            find.byWidgetPredicate(
              (w) => w is IconButton && w.tooltip == '수량 줄이기',
            ),
          )
          .onPressed,
      isNull,
    );
    const sold = GachaDetail(
      id: 901,
      title: '실제 재고 소진',
      description: '',
      price: 1000,
      icon: Icons.inventory_2_outlined,
      accentColor: GachiColors.gold,
      totalStock: 1,
      soldStock: 1,
      lineup: [],
    );
    await mount(
      tester,
      detail(
        data: sold,
        onPurchase: () {
          calls++;
        },
      ),
      nav: false,
    );
    expect(find.text('품절된 박스예요'), findsOneWidget);
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
      isNull,
    );
    expect(calls, 0);
  });
  testWidgets(
    'shared catalog owner preserves shop state and avoids tab refetch',
    (tester) async {
      var requests = 0, showShop = false, revision = 0;
      late StateSetter update;
      final auth = _Auth();
      final gp = GpProvider(initialBalance: 42);
      addTearDown(auth.dispose);
      addTearDown(gp.dispose);
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider<AuthProvider>.value(value: auth),
            ChangeNotifierProvider<GpProvider>.value(value: gp),
          ],
          child: MaterialApp(
            home: StatefulBuilder(
              builder: (_, setState) {
                update = setState;
                return HomePage(
                  showShop: showShop,
                  refreshRevision: revision,
                  onGoToWallet: noop,
                  onShop: noop,
                  onRanking: noop,
                  onOpenUnopened: noop,
                  onCollection: noop,
                  loadCatalog: () async {
                    requests++;
                    return v33Boxes;
                  },
                );
              },
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(requests, 1);
      update(() => showShop = true);
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), '데일리');
      await tester.pumpAndSettle();
      update(() => showShop = false);
      await tester.pumpAndSettle();
      update(() => showShop = true);
      await tester.pumpAndSettle();
      expect(requests, 1);
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        '데일리',
      );
      update(() => revision++);
      await tester.pumpAndSettle();
      expect(requests, 2);
      await tester.pumpWidget(const SizedBox());
    },
  );
  testWidgets(
    'native capture probe visits all three real presentations without transactions',
    (tester) async {
      await mount(tester, const V33UiProbe(), nav: false);
      expect(find.byType(HomeScreen), findsOneWidget);
      await tester.pump(const Duration(seconds: 2));
      await tester.pump(const Duration(seconds: 12));
      expect(find.byType(BoxShopScreen), findsOneWidget);
      await tester.pump(const Duration(seconds: 2));
      await tester.pump(const Duration(seconds: 12));
      await tester.pump(const Duration(seconds: 2));
      expect(find.byType(ProductDetailView), findsOneWidget);
      expect(find.byType(BackButton), findsOneWidget);
      expect(find.text('UI 검증용 합성 데이터 · 거래 실행 없음'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
  testWidgets('bottom navigation exposes five labelled button roles at 200%', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();

    final selected = <int>[];
    await mount(
      tester,
      GachiBottomNavigation(selectedIndex: 0, onSelected: selected.add),
      width: 320,
      scale: 2,
      nav: false,
    );
    for (var i = 0; i < GachiBottomNavigation.labels.length; i++) {
      final node = tester.getSemantics(
        find.bySemanticsLabel(GachiBottomNavigation.labels[i]),
      );
      expect(node.flagsCollection.isButton, isTrue);
      await tester.tap(find.text(GachiBottomNavigation.labels[i]));
    }
    semantics.dispose();
    expect(selected, [0, 1, 2, 3, 4]);
    expect(tester.takeException(), isNull);
  });
}

class _Auth extends AuthProvider {
  @override
  Future<void> refreshProfile() async {}
}
