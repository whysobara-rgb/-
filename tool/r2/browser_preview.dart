// Browser review tool; never imported by lib/ or a native build.
import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:gacha_vault/core/config/app_config.dart';
import 'package:gacha_vault/core/theme/app_theme.dart';
import 'package:gacha_vault/features/home/domain/capsule_box.dart';
import 'package:gacha_vault/features/home/presentation/catalog_views.dart';
import 'package:gacha_vault/features/gacha/presentation/product_detail_view.dart';
import 'package:gacha_vault/features/orders/order_models.dart';
import 'package:gacha_vault/features/orders/order_flow_page.dart';
import 'package:gacha_vault/features/orders/single_opening_view.dart';
import 'package:gacha_vault/features/orders/batch_result_view.dart';
import 'package:gacha_vault/features/inventory/presentation/inventory_page.dart';
import 'package:gacha_vault/shared/widgets/gachi_components.dart';
import 'package:gacha_vault/shared/widgets/gachi_opening.dart';
import '../unified_ux/catalog.dart' show reviewProviders;
import '../unified_ux/review_order_fixtures.dart';
import '../v33_stage2/fixtures.dart';
import 'browser_fixtures.dart';
import 'fixture.dart';

void validateBrowserReviewConfiguration() {
  if (!kDebugMode ||
      AppConfig.apiBaseUrl.isNotEmpty ||
      AppConfig.orderPreviewEnabled ||
      AppConfig.shippingPreviewEnabled ||
      AppConfig.conversionPreviewEnabled ||
      AppConfig.refundPreviewEnabled ||
      AppConfig.legacyTransactionsEnabled) {
    throw StateError(
      'Browser review requires debug, no API origin, all gates off',
    );
  }
}

void main() {
  validateBrowserReviewConfiguration();
  // Defense in depth: uninjected http.Client() also has no network transport.
  http.runWithClient(() {
    WidgetsFlutterBinding.ensureInitialized();
    runApp(
      reviewProviders(
        MaterialApp(
          theme: AppTheme.lightTheme,
          debugShowCheckedModeBanner: false,
          home: const BrowserPreview(),
        ),
      ),
    );
  }, () => MockClient((_) async => throw StateError('Review network blocked')));
}

const browserScreens = [
  '홈',
  '박스샵',
  '상품 상세',
  '구매 확인',
  '미개봉 선택',
  '개봉 연출',
  '단일 결과',
  '다중 결과',
  '부분 완료',
  '보관함',
];

class BrowserPreview extends StatefulWidget {
  const BrowserPreview({super.key});
  @override
  State<BrowserPreview> createState() => _BrowserPreviewState();
}

class _BrowserPreviewState extends State<BrowserPreview> {
  final navigator = GlobalKey<NavigatorState>();
  int tab = 0;
  double scale = 1;
  bool photos = true;
  String screen = '홈';
  String notice = '구매 실행 차단 · 개봉/결과/보관함은 고정 검토 데이터';
  final revision = const String.fromEnvironment(
    'REVIEW_TOOL_SHA',
    defaultValue: 'local',
  );

  List<CapsuleBox> get boxes => List.generate(r2Boxes.length, (i) {
    final b = r2Boxes[i];
    final name = ['sound', 'table', 'coffee'][i];
    return CapsuleBox(
      id: b.id,
      name: b.name,
      category: b.category,
      priceWon: b.priceWon,
      icon: b.icon,
      accentColor: b.accentColor,
      imageUrl: photos
          ? Uri.base.resolve('review-photos/$name-review.jpg').toString()
          : null,
    );
  });

  void unavailable(String name) => setState(() {
    notice = '$name: 이번 미리보기 범위 밖 · 연결/거래하지 않습니다';
  });

  void push(Widget page, String name) {
    setState(() => notice = '$name · 기존 구현 / 합성 데이터');
    navigator.currentState!.push(MaterialPageRoute<void>(builder: (_) => page));
  }

  void collection() => push(
    InventoryPage(repository: FixtureInventory(reviewInventory())),
    '보관함',
  );
  void unopened() => push(
    OrderFlowPage(userId: 10, repository: BrowserFixture().repository),
    '미개봉 선택 · 실행 차단',
  );
  Widget purchase(CapsuleBox box, [int quantity = 1]) => OrderFlowPage(
    userId: 10,
    gachaId: box.id,
    title: box.name,
    initialQuantity: quantity,
    repository: BrowserFixture().repository,
  );
  void detail(CapsuleBox box) => push(
    BrowserDetailPage(
      box: box,
      onPurchase: (q) => push(purchase(box, q), '구매 확인 · 실행 차단'),
    ),
    '상품 상세',
  );

  Widget single({bool animate = false}) => BrowserSingleResult(
    animate: animate,
    onCollection: collection,
    onUnopened: unopened,
    onClose: () => select('홈'),
  );

  Widget batch({bool partial = false}) => BrowserBatchResult(
    partial: partial,
    onCollection: collection,
    onClose: () => select('홈'),
    onResume: () => unavailable('부분 완료의 재개/복구'),
  );

  void select(String name) {
    setState(() {
      screen = name;
      notice = name == '홈' || name == '박스샵'
          ? '홈·박스샵 R2-A1 · 합성 사진/가격/구성 (실제 상품 매칭 아님)'
          : '$name: 기존 구현 · 사전 정의 검토 데이터 / 실제 거래 없음';
      if (name == '홈' || name == '박스샵') tab = name == '홈' ? 0 : 1;
    });
    navigator.currentState!.popUntil((r) => r.isFirst);
    switch (name) {
      case '상품 상세':
        detail(boxes.first);
      case '구매 확인':
        push(purchase(boxes.first), '구매 확인 · 실행 차단');
      case '미개봉 선택':
        unopened();
      case '개봉 연출':
        push(single(animate: true), '개봉 연출 · 고정 샘플 자동 공개');
      case '단일 결과':
        push(single(), '단일 결과 · 고정 샘플');
      case '다중 결과':
        push(batch(), '다중 결과 · 고정 샘플');
      case '부분 완료':
        push(batch(partial: true), '부분 완료 · 고정 샘플');
      case '보관함':
        collection();
    }
  }

  Widget home() => Scaffold(
    body: tab == 0
        ? HomeScreen(
            boxes: boxes,
            balance: '9,900',
            onRefresh: () async {},
            onOpen: detail,
            onWallet: () => unavailable('GP 지갑'),
            onShop: () => select('박스샵'),
            onRanking: () => unavailable('랭킹'),
            onOpenUnopened: unopened,
            onCollection: collection,
            onUpdates: () => unavailable('소식'),
          )
        : BoxShopScreen(
            boxes: boxes,
            balance: '9,900',
            onRefresh: () async {},
            onOpen: detail,
            onWallet: () => unavailable('GP 지갑'),
            onUpdates: () => unavailable('소식'),
          ),
    bottomNavigationBar: GachiBottomNavigation(
      selectedIndex: tab,
      onSelected: (i) {
        switch (i) {
          case 0:
            select('홈');
          case 1:
            select('박스샵');
          case 2:
            unopened();
          case 3:
            collection();
          default:
            unavailable('마이/계정');
        }
      },
    ),
  );

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xffe6e8eb),
    body: SafeArea(
      child: Column(
        children: [
          Container(
            width: double.infinity,
            color: Colors.white,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Wrap(
                  spacing: 14,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    const Text(
                      'R2-A1 검토',
                      style: TextStyle(fontWeight: FontWeight.bold),
                    ),
                    DropdownButton<String>(
                      key: const Key('review-screen'),
                      value: screen,
                      items: browserScreens
                          .map(
                            (s) => DropdownMenuItem(value: s, child: Text(s)),
                          )
                          .toList(),
                      onChanged: (s) => select(s!),
                    ),
                    DropdownButton<double>(
                      key: const Key('review-scale'),
                      value: scale,
                      items: [1.0, 2.0]
                          .map(
                            (s) => DropdownMenuItem(
                              value: s,
                              child: Text('글자 ${(s * 100).round()}%'),
                            ),
                          )
                          .toList(),
                      onChanged: (s) => setState(() => scale = s!),
                    ),
                    FilterChip(
                      label: const Text('샘플 사진'),
                      selected: photos,
                      onSelected: (s) {
                        setState(() => photos = s);
                        select('홈');
                      },
                    ),
                    TextButton(
                      onPressed: () => navigator.currentState!.maybePop(),
                      child: const Text('이전 화면'),
                    ),
                  ],
                ),
                Text(
                  '합성 데이터 · 실제 거래 없음 | 홈/샵 R2-A1, 나머지 기존 구현 · R2-B/C/D·운영 연결·실기기 인수 미완료',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                Text(
                  notice,
                  key: const Key('review-notice'),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                SelectableText(
                  '앱 소스 $applicationSourceSha · 검토 도구 $revision',
                  style: Theme.of(context).textTheme.labelSmall,
                ),
              ],
            ),
          ),
          Expanded(
            child: LayoutBuilder(
              builder: (context, constraints) {
                final size = Size(
                  math.min(430, constraints.maxWidth),
                  math.min(844, constraints.maxHeight),
                );
                return Align(
                  alignment: Alignment.topCenter,
                  child: SizedBox(
                    width: size.width,
                    height: size.height,
                    child: MediaQuery(
                      data: MediaQuery.of(context).copyWith(
                        size: size,
                        textScaler: TextScaler.linear(scale),
                        padding: const EdgeInsets.only(top: 24, bottom: 20),
                        viewPadding: const EdgeInsets.only(top: 24, bottom: 20),
                      ),
                      child: Navigator(
                        key: navigator,
                        onGenerateRoute: (_) => MaterialPageRoute<void>(
                          builder: (_) => ListenableBuilder(
                            listenable: _homeUpdates,
                            builder: (_, _) => home(),
                          ),
                        ),
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    ),
  );

  // The persistent nested route must rebuild when review controls change.
  final _homeUpdates = ValueNotifier<int>(0);
  @override
  void setState(VoidCallback fn) {
    super.setState(fn);
    _homeUpdates.value++;
  }

  @override
  void dispose() {
    _homeUpdates.dispose();
    super.dispose();
  }
}

class BrowserDetailPage extends StatefulWidget {
  final CapsuleBox box;
  final ValueChanged<int> onPurchase;
  const BrowserDetailPage({
    super.key,
    required this.box,
    required this.onPurchase,
  });
  @override
  State<BrowserDetailPage> createState() => _BrowserDetailPageState();
}

class _BrowserDetailPageState extends State<BrowserDetailPage> {
  int quantity = 1;
  @override
  Widget build(BuildContext context) => GachiScaffold(
    title: '박스 상세',
    body: ProductDetailView(
      box: widget.box,
      detail: browserDetail(widget.box),
      odds: Odds(browserOdds(widget.box)),
      quantity: quantity,
      maxQuantity: 100,
      totalPriceLabel: '${widget.box.priceWon * quantity} GP',
      onDecrement: () => setState(() => quantity = math.max(1, quantity - 1)),
      onIncrement: () => setState(() => quantity = math.min(100, quantity + 1)),
      onPurchase: () => widget.onPurchase(quantity),
    ),
  );
}

class BrowserSingleResult extends StatefulWidget {
  final bool animate;
  final VoidCallback onCollection, onUnopened, onClose;
  const BrowserSingleResult({
    super.key,
    required this.animate,
    required this.onCollection,
    required this.onUnopened,
    required this.onClose,
  });
  @override
  State<BrowserSingleResult> createState() => _BrowserSingleResultState();
}

class _BrowserSingleResultState extends State<BrowserSingleResult> {
  Timer? timer;
  late bool ready = !widget.animate;
  @override
  void initState() {
    super.initState();
    if (widget.animate) {
      timer = Timer(const Duration(seconds: 2), () {
        if (mounted) setState(() => ready = true);
      });
    }
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => GachiOpeningScaffold(
    title: '개봉 결과',
    body: ListView(
      padding: const EdgeInsets.all(GachiSpace.page),
      children: [
        SingleOpeningView(
          opening: ready
              ? reviewBatch(completed: 1, total: 1).results.single
              : null,
          onCollection: widget.onCollection,
          onUnopened: widget.onUnopened,
          onClose: widget.onClose,
        ),
      ],
    ),
  );
}

class BrowserBatchResult extends StatefulWidget {
  final bool partial;
  final VoidCallback onCollection, onClose, onResume;
  const BrowserBatchResult({
    super.key,
    required this.partial,
    required this.onCollection,
    required this.onClose,
    required this.onResume,
  });
  @override
  State<BrowserBatchResult> createState() => _BrowserBatchResultState();
}

class _BrowserBatchResultState extends State<BrowserBatchResult> {
  String grade = '전체';
  @override
  Widget build(BuildContext context) => GachiOpeningScaffold(
    title: '개봉 결과',
    body: ListView(
      padding: const EdgeInsets.all(GachiSpace.page),
      children: [
        BatchResultView(
          batch: reviewBatch(
            completed: widget.partial ? 1 : 3,
            pending: widget.partial,
          ),
          working: false,
          continuing: false,
          grade: grade,
          onGrade: (s) => setState(() => grade = s),
          onCollection: widget.onCollection,
          onClose: widget.onClose,
          onResume: widget.onResume,
        ),
      ],
    ),
  );
}
