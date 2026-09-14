import 'dart:io';
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

// Synthetic visual fixtures only. Never sent to the API or mixed into live catalogs.
const boxes = [
  CapsuleBox(id: 901, name: '취향을 채우는 컬렉션 박스', priceWon: 1000,
    icon: Icons.style_rounded, accentColor: Color(0xFFCF7158), badgeLabel: 'PREVIEW'),
  CapsuleBox(id: 902, name: '작은 행복, 데일리 박스', priceWon: 100,
    icon: Icons.card_giftcard_rounded, accentColor: Color(0xFF638C7B), badgeLabel: 'PREVIEW'),
  CapsuleBox(id: 903, name: '새로운 발견', priceWon: 500,
    icon: Icons.headphones_rounded, accentColor: Color(0xFF7C75AB)),
];
final odds = Odds({
  'gachaId': 901, 'unitPrice': 1000, 'currency': 'GP', 'version': 'a' * 64,
  'snapshot': {'schemaVersion': 1, 'mode': 'FIXED_PPM', 'entries': [
    {'itemId': 1, 'name': '일반 컬렉션 카드', 'rarity': 'N', 'conversionGP': 0, 'probabilityPpm': 900000, 'isPremium': false},
    {'itemId': 2, 'name': '프리미엄 컬렉션 카드', 'rarity': 'SSR', 'conversionGP': 0, 'probabilityPpm': 100000, 'isPremium': true},
  ]},
});
const detail = GachaDetail(id: 901, title: '취향을 채우는 컬렉션 박스',
  description: '새로운 취향을 발견하는 순간.\n구성 상품과 확률을 확인하고 나만의 컬렉션을 시작하세요.',
  price: 1000, icon: Icons.style_rounded, accentColor: Color(0xFFCF7158),
  badgeLabel: 'PREVIEW', totalStock: 1000, soldStock: 120, lineup: []);

void main() {
  setUpAll(() async {
    // One complete Korean font face lets the test renderer synthesize weights
    // consistently; registering two unweighted faces made some glyph runs blank.
    final font = FontLoader('Pretendard')
      ..addFont(rootBundle.load('assets/fonts/Pretendard-Regular.otf'));
    await font.load();
  });
  Future<void> mount(WidgetTester tester, Widget screen, {double width = 390, double scale = 1}) async {
    tester.view.physicalSize = Size(width, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(MaterialApp(theme: AppTheme.lightTheme,
      builder: (context, child) => MediaQuery(data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)), child: child!),
      home: RepaintBoundary(key: const ValueKey('capture'), child: screen)));
    await tester.pumpAndSettle();
  }
  CatalogScreen catalog() => CatalogScreen(boxes: boxes, balance: '9,900',
    onRefresh: () async {}, onOpen: (_) {}, onWallet: () {});
  Future<void> capture(WidgetTester tester, String name) async {
    expect(tester.takeException(), isNull);
    final boundary = tester.renderObject<RenderRepaintBoundary>(find.byKey(const ValueKey('capture')));
    await tester.runAsync(() async {
      final image = await boundary.toImage(pixelRatio: 1.5);
      final data = await image.toByteData(format: ui.ImageByteFormat.png);
      final file = File('build/ui-previews/$name.png');
      await file.parent.create(recursive: true);
      await file.writeAsBytes(data!.buffer.asUint8List());
      image.dispose();
    });
  }
  testWidgets('catalog renders and search/sort change the displayed cards', (tester) async {
    await mount(tester, catalog());
    await capture(tester, 'home');
    await tester.tap(find.text('낮은 가격순'));
    await tester.pumpAndSettle();
    expect(tester.widgetList<CapsuleBoxCard>(find.byType(CapsuleBoxCard)).first.box.id, 902);
    await tester.enterText(find.byType(TextField), '데일리');
    await tester.pumpAndSettle();
    expect(tester.widgetList<CapsuleBoxCard>(find.byType(CapsuleBoxCard)).single.box.id, 902);
    await tester.enterText(find.byType(TextField), '없는 이름');
    await tester.pumpAndSettle();
    expect(find.text('검색 결과가 없어요'), findsOneWidget);
  });
  testWidgets('detail shows actual odds and single-step purchase action', (tester) async {
    var purchases = 0;
    await mount(tester, Scaffold(appBar: AppBar(title: const Text('박스 상세')),
      body: ProductDetailView(box: boxes.first, detail: detail, odds: odds, quantity: 1, maxQuantity: 100,
        totalPriceLabel: '1,000 GP', onDecrement: () {}, onIncrement: () {}, onPurchase: () { purchases++; })));
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
}
