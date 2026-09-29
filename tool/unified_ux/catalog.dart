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
import 'package:gacha_vault/core/theme/app_theme.dart';
import 'package:gacha_vault/features/orders/single_opening_view.dart';
import 'package:gacha_vault/features/orders/purchase_completion_view.dart';
import 'review_order_fixtures.dart';
import 'package:gacha_vault/features/orders/order_flow_page.dart';
import 'package:gacha_vault/features/orders/batch_result_view.dart';
import 'package:gacha_vault/features/inventory/presentation/inventory_page.dart';
import 'package:gacha_vault/features/profile/presentation/profile_page.dart';
import 'package:gacha_vault/features/auth/presentation/login_page.dart';
import 'package:gacha_vault/shared/providers/auth_provider.dart';
import 'package:gacha_vault/shared/providers/gp_provider.dart';
import 'package:gacha_vault/shared/widgets/gachi_components.dart';
import 'package:gacha_vault/shared/widgets/gachi_opening.dart';
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
  'Purchase',
  'Purchase Complete',
  'Open',
  'Single Result',
  'Direct Single Recovery',
  'Result',
  'Partial',
  'Unopened Retained',
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
    case 'Purchase':
      return OrderFlowPage(
        userId: 10,
        gachaId: reviewOdds.gachaId,
        title: reviewBoxes.first.name,
        repository: reviewOrderRepository(),
      );
    case 'Purchase Complete':
      return GachiScaffold(
        title: '구매 확인',
        body: ListView(
          padding: const EdgeInsets.all(GachiSpace.page),
          children: [
            PurchaseCompletionView(
              receipt: reviewReceipt(),
              onPrepareOpening: none,
              onLater: none,
            ),
          ],
        ),
      );
    case 'Direct Single Recovery':
      return GachiOpeningScaffold(
        title: '개봉 결과',
        body: ListView(
          padding: const EdgeInsets.all(GachiSpace.page),
          children: [
            SingleOpeningView(
              opening: reviewBatch(completed: 1, total: 1).results.single,
              onCollection: none,
              onUnopened: none,
              onClose: none,
            ),
          ],
        ),
      );
    case 'Open':
      return OrderFlowPage(userId: 10, repository: reviewOrderRepository());
    case 'Result':
    case 'Single Result':
    case 'Partial':
    case 'Unopened Retained':
      return GachiOpeningScaffold(
        body: ListView(
          padding: const EdgeInsets.all(GachiSpace.page),
          children: [
            BatchResultView(
              batch: reviewBatch(
                completed: screen == 'Unopened Retained'
                    ? 0
                    : screen == 'Single Result' || screen == 'Partial'
                    ? 1
                    : 3,
                total: screen == 'Single Result' ? 1 : 3,
                pending: screen == 'Partial',
              ),
              working: false,
              continuing: false,
              grade: '전체',
              onGrade: (_) {},
              onCollection: none,
              onClose: none,
              onResume: none,
            ),
          ],
        ),
      );
    case 'Collection':
      return InventoryPage(repository: FixtureInventory(reviewInventory()));
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
        theme: AppTheme.lightTheme,
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
