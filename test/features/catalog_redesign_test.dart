import 'package:gacha_vault/features/wallet/presentation/point_history_page.dart';
import 'package:gacha_vault/features/shipping/domain/shipping_request.dart';
import 'package:gacha_vault/features/shipping/presentation/shipping_history_page.dart';
import 'package:gacha_vault/shared/data/activity_page.dart';
import 'dart:io';
import 'package:provider/provider.dart';
import 'package:gacha_vault/shared/providers/auth_provider.dart';
import 'package:gacha_vault/shared/providers/gp_provider.dart';
import 'package:gacha_vault/shared/models/app_user.dart';
import 'package:gacha_vault/features/profile/presentation/profile_page.dart';
import 'package:gacha_vault/features/wallet/presentation/wallet_page.dart';
import 'package:gacha_vault/features/wallet/domain/point_history.dart';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/core/theme/app_theme.dart';
import 'package:gacha_vault/features/home/domain/capsule_box.dart';
import 'package:gacha_vault/features/home/domain/gacha_detail.dart';
import 'package:gacha_vault/features/home/presentation/home_page.dart';
import 'package:gacha_vault/features/home/presentation/widgets/capsule_box_card.dart';
import 'package:gacha_vault/features/gacha/presentation/gacha_detail_page.dart';
import 'package:gacha_vault/features/orders/order_models.dart';

import 'package:gacha_vault/features/orders/prize_reveal.dart';
import 'package:gacha_vault/features/inventory/domain/inventory_item.dart';
import 'package:gacha_vault/features/inventory/presentation/collection_detail_page.dart';
import 'package:gacha_vault/features/inventory/presentation/collection_card.dart';

// Synthetic visual fixtures only. Never sent to the API or mixed into live catalogs.
const boxes = [
  CapsuleBox(
    id: 901,
    name: '취향을 채우는 컬렉션 박스',
    priceWon: 1000,
    icon: Icons.style_rounded,
    accentColor: Color(0xFFCF7158),
    badgeLabel: 'PREVIEW',
  ),
  CapsuleBox(
    id: 902,
    name: '작은 행복, 데일리 박스',
    priceWon: 100,
    icon: Icons.card_giftcard_rounded,
    accentColor: Color(0xFF638C7B),
    badgeLabel: 'PREVIEW',
  ),
  CapsuleBox(
    id: 903,
    name: '새로운 발견',
    priceWon: 500,
    icon: Icons.headphones_rounded,
    accentColor: Color(0xFF7C75AB),
  ),
];
final odds = Odds({
  'gachaId': 901,
  'unitPrice': 1000,
  'currency': 'GP',
  'version': 'a' * 64,
  'snapshot': {
    'schemaVersion': 1,
    'mode': 'FIXED_PPM',
    'entries': [
      {
        'itemId': 1,
        'name': '일반 컬렉션 카드',
        'rarity': 'N',
        'conversionGP': 0,
        'probabilityPpm': 900000,
        'isPremium': false,
      },
      {
        'itemId': 2,
        'name': '프리미엄 컬렉션 카드',
        'rarity': 'SSR',
        'conversionGP': 0,
        'probabilityPpm': 100000,
        'isPremium': true,
      },
    ],
  },
});
const detail = GachaDetail(
  id: 901,
  title: '취향을 채우는 컬렉션 박스',
  description: '새로운 취향을 발견하는 순간.\n구성 상품과 확률을 확인하고 나만의 컬렉션을 시작하세요.',
  price: 1000,
  icon: Icons.style_rounded,
  accentColor: Color(0xFFCF7158),
  badgeLabel: 'PREVIEW',
  totalStock: 1000,
  soldStock: 120,
  lineup: [],
);

void main() {
  setUpAll(() async {
    final fonts = FontLoader('Pretendard')
      ..addFont(rootBundle.load('assets/fonts/Pretendard-Regular.otf'))
      ..addFont(rootBundle.load('assets/fonts/Pretendard-Bold.otf'));
    await fonts.load();
    final icons = FontLoader('MaterialIcons')
      ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
    await icons.load();
  });
  Future<void> mount(
    WidgetTester tester,
    Widget screen, {
    double width = 390,
    double scale = 1,
    bool settle = true,
  }) async {
    tester.view.physicalSize = Size(width, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        key: UniqueKey(),
        theme: AppTheme.lightTheme,
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: TextScaler.linear(scale)),
          child: child!,
        ),
        home: RepaintBoundary(key: const ValueKey('capture'), child: screen),
      ),
    );
    if (settle) await tester.pumpAndSettle();
  }

  CatalogScreen catalog() => CatalogScreen(
    boxes: boxes,
    balance: '9,900',
    onRefresh: () async {},
    onOpen: (_) {},
    onWallet: () {},
  );
  Future<void> capture(WidgetTester tester, String name) async {
    expect(tester.takeException(), isNull);
    final boundary = tester.renderObject<RenderRepaintBoundary>(
      find.byKey(const ValueKey('capture')),
    );
    await tester.runAsync(() async {
      final image = await boundary.toImage(pixelRatio: 1.5);
      final data = await image.toByteData(format: ui.ImageByteFormat.png);
      final file = File('build/ui-previews/$name.png');
      await file.parent.create(recursive: true);
      await file.writeAsBytes(data!.buffer.asUint8List());
      image.dispose();
    });
  }

  testWidgets('catalog renders and search/sort change the displayed cards', (
    tester,
  ) async {
    await mount(tester, catalog());
    await capture(tester, 'home');
    await tester.tap(find.text('낮은 가격순'));
    await tester.pumpAndSettle();
    expect(
      tester
          .widgetList<CapsuleBoxCard>(find.byType(CapsuleBoxCard))
          .first
          .box
          .id,
      902,
    );
    await tester.enterText(find.byType(TextField), '데일리');
    await tester.pumpAndSettle();
    expect(
      tester
          .widgetList<CapsuleBoxCard>(find.byType(CapsuleBoxCard))
          .single
          .box
          .id,
      902,
    );
    await tester.enterText(find.byType(TextField), '없는 이름');
    await tester.pumpAndSettle();
    expect(find.text('검색 결과가 없어요'), findsOneWidget);
  });
  testWidgets('detail shows actual odds and single-step purchase action', (
    tester,
  ) async {
    var purchases = 0;
    await mount(
      tester,
      Scaffold(
        appBar: AppBar(title: const Text('박스 상세')),
        body: ProductDetailView(
          box: boxes.first,
          detail: detail,
          odds: odds,
          quantity: 1,
          maxQuantity: 100,
          totalPriceLabel: '1,000 GP',
          onDecrement: () {},
          onIncrement: () {},
          onPurchase: () {
            purchases++;
          },
        ),
      ),
    );
    await capture(tester, 'detail');
    await tester.tap(find.text('1,000 GP · 구매 전 확인'));
    expect(purchases, 1);
    await tester.drag(find.byType(ListView), const Offset(0, -600));
    await tester.pumpAndSettle();
    expect(find.text('90%'), findsOneWidget);
    expect(find.text('10%'), findsOneWidget);
    await capture(tester, 'detail-odds');
  });
  testWidgets('320px and large text catalog has no overflow', (tester) async {
    await mount(tester, catalog(), width: 320, scale: 1.6);
    expect(tester.takeException(), isNull);
    await tester.drag(find.byType(CustomScrollView), const Offset(0, -700));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
  testWidgets(
    'confirmed capsule opening stages render without choosing new prizes',
    (tester) async {
      await mount(
        tester,
        Scaffold(
          body: SingleChildScrollView(
            child: PrizeReveal(prize: odds.prizes.last),
          ),
        ),
        settle: false,
      );
      await tester.pump(const Duration(milliseconds: 150));
      await capture(tester, 'capsule-opening');
      await tester.pump(const Duration(milliseconds: 600));
      await capture(tester, 'capsule-opening-mid');
      await tester.pumpAndSettle();
      expect(find.text(odds.prizes.last.name), findsOneWidget);
      expect(find.text('내 보관함에 저장 완료'), findsOneWidget);
    },
  );
  testWidgets(
    'confirmed reveal and collection screens render with Korean fonts',
    (tester) async {
      await mount(
        tester,
        Scaffold(
          appBar: AppBar(title: const Text('개봉 결과')),
          body: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: PrizeReveal(prize: odds.prizes.last),
          ),
        ),
      );
      expect(find.text('내 보관함에 저장 완료'), findsOneWidget);
      await capture(tester, 'reveal');
      final item = InventoryItem(
        id: '901',
        name: '프리미엄 컬렉션 카드',
        grade: odds.prizes.last.displayGrade,
        price: 1000,
        icon: Icons.style_rounded,
        status: InventoryStatus.stored,
        acquiredAt: DateTime(2026, 9, 14),
        isLocked: true,
      );
      await mount(
        tester,
        Scaffold(
          appBar: AppBar(title: const Text('내 컬렉션')),
          body: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: CollectionCard(
              item: item,
              selected: false,
              onSelect: () {},
              onLock: () {},
            ),
          ),
        ),
      );
      await capture(tester, 'collection-card');
      await mount(tester, CollectionDetailPage(item: item));
      await capture(tester, 'collection-detail');
      await mount(
        tester,
        CollectionDetailPage(item: item),
        width: 320,
        scale: 1.6,
      );
      await tester.drag(find.byType(ListView), const Offset(0, -500));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets('product image renders in reveal and detail and survives zoom', (
    tester,
  ) async {
    const url = 'https://preview.invalid/sample-watch.png';
    final bytes = await tester.runAsync(
      () async => (await rootBundle.load(
        'assets/images/products/product_watch.png',
      )).buffer.asUint8List(),
    );
    final frame = await tester.runAsync(() async {
      final codec = await ui.instantiateImageCodec(bytes!);
      final frame = await codec.getNextFrame();
      codec.dispose();
      return frame;
    });
    // Seed decoded pixels under the network key: rendering test, not an HTTP test.
    const provider = NetworkImage(url);
    PaintingBinding.instance.imageCache.putIfAbsent(
      provider,
      () => OneFrameImageStreamCompleter(
        Future.value(ImageInfo(image: frame!.image)),
      ),
    );
    addTearDown(() => PaintingBinding.instance.imageCache.clear());
    final prize = Prize({
      'itemId': 902,
      'name': '시계 이미지 표시 테스트',
      'rarity': 'SSR',
      'conversionGP': 0,
      'probabilityPpm': 1000000,
      'isPremium': true,
      'imageUrl': url,
    });
    await mount(
      tester,
      Scaffold(
        appBar: AppBar(title: const Text('샘플 개봉 결과')),
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: PrizeReveal(prize: prize),
        ),
      ),
    );
    expect(
      tester
          .widgetList<RawImage>(find.byType(RawImage))
          .any((image) => image.image != null),
      isTrue,
    );
    expect(find.byIcon(Icons.card_giftcard_rounded), findsNothing);
    await capture(tester, 'reveal-image');
    final item = InventoryItem(
      id: '902',
      name: prize.name,
      grade: prize.displayGrade,
      price: 1000,
      icon: Icons.watch,
      status: InventoryStatus.stored,
      acquiredAt: DateTime(2026, 9, 14),
      imageUrl: url,
    );
    await mount(tester, CollectionDetailPage(item: item));
    expect(
      tester
          .widgetList<RawImage>(find.byType(RawImage))
          .any((image) => image.image != null),
      isTrue,
    );
    await capture(tester, 'collection-image');
    await tester.tap(find.text('2배 확대'));
    await tester.pump();
    final viewer = tester.widget<InteractiveViewer>(
      find.byType(InteractiveViewer),
    );
    expect(viewer.transformationController!.value.getMaxScaleOnAxis(), 2);
    await tester.tap(find.text('원래 크기'));
    await tester.pump();
    expect(viewer.transformationController!.value.getMaxScaleOnAxis(), 1);
    expect(tester.takeException(), isNull);
  });
  testWidgets(
    'activity and shipping details render at normal and accessible sizes',
    (tester) async {
      final auth = PreviewAuth();
      final gp = GpProvider(initialBalance: 9900);
      addTearDown(auth.dispose);
      addTearDown(gp.dispose);
      Widget account(Widget child) => MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>.value(value: auth),
          ChangeNotifierProvider<GpProvider>.value(value: gp),
        ],
        child: child,
      );
      await mount(
        tester,
        account(PointHistoryPage(repository: PreviewPagedHistory())),
      );
      await capture(tester, 'point-history');
      await mount(tester, ShippingHistoryPage(repository: PreviewShipping()));
      await capture(tester, 'shipping-history');
      await tester.tap(find.text('신청 상세 보기'));
      await tester.pumpAndSettle();
      expect(find.text('샘플 배송지 · 실제 주소가 아닙니다'), findsOneWidget);
      await mount(
        tester,
        ShippingDetailPage(request: previewShippingRequest()),
      );
      await capture(tester, 'shipping-detail');
      await mount(
        tester,
        ShippingDetailPage(request: previewShippingRequest()),
        width: 320,
        scale: 1.6,
      );
      expect(tester.takeException(), isNull);
      await tester.drag(find.byType(ListView), const Offset(0, -700));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await mount(
        tester,
        account(PointHistoryPage(repository: PreviewPagedHistory())),
        width: 320,
        scale: 1.6,
      );
      expect(tester.takeException(), isNull);
      await tester.drag(find.byType(CustomScrollView), const Offset(0, -400));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'profile and wallet show sample account and recover history errors',
    (tester) async {
      final auth = PreviewAuth();
      final gp = GpProvider(initialBalance: 9900);
      addTearDown(auth.dispose);
      addTearDown(gp.dispose);
      Widget account(Widget child) => MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>.value(value: auth),
          ChangeNotifierProvider<GpProvider>.value(value: gp),
        ],
        child: child,
      );
      var walletVisits = 0;
      await mount(
        tester,
        account(ProfilePage(onGoToWallet: () => walletVisits++)),
      );
      await capture(tester, 'profile');
      await tester.tap(find.text('GP 지갑 보기'));
      expect(walletVisits, 1);
      final history = PreviewHistory();
      await mount(
        tester,
        account(WalletPage(onGoToHome: () {}, repository: history)),
      );
      await capture(tester, 'wallet');
      expect(find.text('-100 GP'), findsOneWidget);
      history.fail = true;
      await mount(
        tester,
        account(
          WalletPage(
            key: const ValueKey('failed'),
            onGoToHome: () {},
            repository: history,
          ),
        ),
      );
      expect(find.text('GP 내역을 불러오지 못했습니다'), findsOneWidget);
      history.fail = false;
      await tester.ensureVisible(find.text('다시 시도'));
      await tester.tap(find.text('다시 시도'));
      await tester.pumpAndSettle();
      expect(find.text('-100 GP'), findsOneWidget);
      await mount(
        tester,
        account(ProfilePage(onGoToWallet: () {})),
        width: 320,
        scale: 1.6,
      );
      expect(tester.takeException(), isNull);
    },
  );
}

class PreviewAuth extends AuthProvider {
  @override
  AppUser get currentUser => const AppUser(
    id: 901,
    email: 'preview@example.invalid',
    nickname: '컬렉션 미리보기',
    coinBalance: 9900,
  );
  @override
  Future<void> refreshProfile() async {}
}

class PreviewHistory extends PointHistoryRepository {
  bool fail = false;
  @override
  Future<List<PointHistoryEntry>> getAll({
    PointHistoryType? type,
    int limit = 100,
  }) async {
    if (fail) throw StateError('Synthetic history failure');
    return [
      PointHistoryEntry(
        id: '901',
        description: '테스트 캡슐 구매',
        type: PointHistoryType.use,
        amount: 100,
        date: DateTime(2026, 9, 14),
      ),
    ];
  }
}

class PreviewPagedHistory extends PointHistoryRepository {
  @override
  Future<ActivityPage<PointHistoryEntry>> getPage({
    int page = 1,
    int limit = 20,
    PointHistoryType? type,
  }) async => ActivityPage(
    items: [
      PointHistoryEntry(
        id: '1',
        description: '작은 행복, 데일리 캡슐 구매',
        type: PointHistoryType.use,
        amount: 100,
        date: DateTime(2026, 9, 14),
      ),
      PointHistoryEntry(
        id: '2',
        description: '내 컬렉션 상품 GP 전환',
        type: PointHistoryType.earn,
        amount: 1000,
        date: DateTime(2026, 9, 13),
      ),
    ].where((e) => type == null || type == e.type).toList(),
    page: page,
    limit: limit,
    total: type == null ? 2 : 1,
  );
}

ShippingRequest previewShippingRequest() => ShippingRequest.fromJson({
  'shippingRequestId': 901,
  'recipientName': '미리보기 계정',
  'phone': '010-0000-0000',
  'address': '샘플 배송지 · 실제 주소가 아닙니다',
  'notes': '샘플 화면용 요청사항',
  'status': 'SHIPPING',
  'createdAt': '2026-09-14T00:00:00Z',
  'items': [
    {'inventoryItemId': 1, 'name': '프리미엄 컬렉션 카드'},
    {'inventoryItemId': 2, 'name': '데일리 컬렉션 카드'},
  ],
});

class PreviewShipping extends ShippingRepository {
  @override
  Future<ActivityPage<ShippingRequest>> getPage({
    int page = 1,
    int limit = 20,
  }) async => ActivityPage(
    items: [previewShippingRequest()],
    page: page,
    limit: limit,
    total: 1,
  );
}
