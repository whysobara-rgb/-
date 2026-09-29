// Actual application widgets, read-only review data. Not an application route.
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:gacha_vault/features/home/domain/capsule_box.dart';
import 'package:gacha_vault/features/home/domain/gacha_detail.dart';
import 'package:gacha_vault/features/home/presentation/catalog_views.dart';
import 'package:gacha_vault/features/gacha/presentation/product_detail_view.dart';
import 'package:gacha_vault/features/orders/order_models.dart';
import 'package:gacha_vault/features/orders/order_flow_page.dart';
import 'package:gacha_vault/features/orders/batch_result_view.dart';
import 'package:gacha_vault/features/inventory/presentation/inventory_page.dart';
import 'package:gacha_vault/features/profile/presentation/profile_page.dart';
import 'package:gacha_vault/features/auth/presentation/login_page.dart';
import 'package:gacha_vault/shared/providers/auth_provider.dart';
import 'package:gacha_vault/shared/providers/gp_provider.dart';
import 'package:gacha_vault/shared/widgets/gachi_components.dart';
import '../v33_stage2/fixtures.dart';
import 'fixture_data.dart';

final reviewFixture = jsonDecode(unifiedFixtureJson) as Map<String, dynamic>;
final reviewBoxes = (reviewFixture['boxes'] as List)
    .map((b) => CapsuleBox.fromJson(Map<String, dynamic>.from(b)))
    .toList();
final reviewDetail = GachaDetail.fromJson(
  Map<String, dynamic>.from(reviewFixture['boxes'][0]),
);
final reviewOdds = Odds(Map<String, dynamic>.from(reviewFixture['odds']));
const reviewScreens = [
  'Home',
  'Box Shop',
  'Product Detail',
  'Open',
  'Result',
  'Partial',
  'Collection',
  'My',
  'Login',
];

Widget reviewScreen(String screen) {
  void none() {}
  switch (screen) {
    case 'Home':
      return HomeScreen(
        boxes: reviewBoxes,
        balance: '9,900',
        onRefresh: () async {},
        onOpen: (_) {},
        onWallet: none,
        onShop: none,
        onRanking: none,
        onOpenUnopened: none,
        onCollection: none,
        onUpdates: none,
      );
    case 'Box Shop':
      return BoxShopScreen(
        boxes: reviewBoxes,
        balance: '9,900',
        onRefresh: () async {},
        onOpen: (_) {},
        onWallet: none,
        onUpdates: none,
      );
    case 'Product Detail':
      return GachiScaffold(
        title: '박스 상세',
        body: ProductDetailView(
          box: reviewBoxes.first,
          detail: reviewDetail,
          odds: reviewOdds,
          quantity: 1,
          maxQuantity: 100,
          totalPriceLabel: '1,000 GP',
          onDecrement: none,
          onIncrement: none,
          onPurchase: none,
        ),
      );
    case 'Open':
      return OrderFlowPage(userId: 10, repository: readOnlyRepository());
    case 'Result':
    case 'Partial':
      return GachiScaffold(
        title: '개봉 결과',
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(GachiSpace.page),
          child: BatchResultView(
            batch: screen == 'Result'
                ? batchFixture()
                : batchFixture(completed: 1, total: 3, pending: true),
            working: false,
            continuing: false,
            grade: '전체',
            onGrade: (_) {},
            onCollection: none,
            onClose: none,
            onResume: none,
          ),
        ),
      );
    case 'Collection':
      return InventoryPage(repository: FixtureInventory(inventoryFixtures()));
    case 'My':
      return ProfilePage(onGoToWallet: none);
    default:
      return const LoginPage();
  }
}

Widget reviewProviders(Widget child) => MultiProvider(
  providers: [
    ChangeNotifierProvider<AuthProvider>(create: (_) => FixtureAuth()),
    ChangeNotifierProvider(create: (_) => GpProvider(initialBalance: 9900)),
  ],
  child: child,
);

void main() {
  if (!kDebugMode) throw UnsupportedError('Review catalog is debug-only');
  runApp(
    reviewProviders(
      MaterialApp(
        theme: GachiTheme.data,
        debugShowCheckedModeBanner: false,
        home: const ReviewCatalog(),
      ),
    ),
  );
}

class ReviewCatalog extends StatefulWidget {
  const ReviewCatalog({super.key});
  @override
  State<ReviewCatalog> createState() => _ReviewCatalogState();
}

class _ReviewCatalogState extends State<ReviewCatalog> {
  String screen = 'Home';
  double scale = 1;
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('실제 Flutter 위젯 · 합성 데이터')),
    body: Column(
      children: [
        Wrap(
          spacing: 16,
          children: [
            DropdownButton<String>(
              value: screen,
              items: reviewScreens
                  .map((s) => DropdownMenuItem(value: s, child: Text(s)))
                  .toList(),
              onChanged: (s) => setState(() => screen = s!),
            ),
            DropdownButton<double>(
              value: scale,
              items: [1.0, 2.0]
                  .map(
                    (s) => DropdownMenuItem(
                      value: s,
                      child: Text('${(s * 100).round()}%'),
                    ),
                  )
                  .toList(),
              onChanged: (s) => setState(() => scale = s!),
            ),
          ],
        ),
        const Padding(
          padding: EdgeInsets.all(8),
          child: Text('읽기 전용 화면 카탈로그 · 화면 선택만 가능 · 로그인/거래/서버 호출 없음'),
        ),
        Expanded(
          child: IgnorePointer(
            child: MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: TextScaler.linear(scale)),
              child: KeyedSubtree(
                key: ValueKey(screen),
                child: reviewScreen(screen),
              ),
            ),
          ),
        ),
      ],
    ),
  );
}
