// Separate debug-only entrypoint: real V33 widgets, explicitly synthetic data.
// No auth, repositories, transaction callbacks or production API configuration.
import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:gacha_vault/features/home/presentation/catalog_views.dart';
import 'package:gacha_vault/features/gacha/presentation/product_detail_view.dart';
import 'package:gacha_vault/shared/widgets/gachi_components.dart';
import 'fixtures.dart';

void main() {
  if (kReleaseMode) throw UnsupportedError('UI probe is debug-only');
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
  SystemChrome.setSystemUIOverlayStyle(SystemUiOverlayStyle.dark);
  FlutterError.onError = (details) {
    FlutterError.presentError(details);
    debugPrint('V33_UI_PROBE_FAILED: ${details.exceptionAsString()}');
  };
  runApp(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: GachiTheme.data,
      home: const V33UiProbe(),
    ),
  );
}

class V33UiProbe extends StatefulWidget {
  const V33UiProbe({super.key});
  @override
  State<V33UiProbe> createState() => _V33UiProbeState();
}

class _V33UiProbeState extends State<V33UiProbe> {
  int _screen = 0;
  Timer? _timer;
  static const names = ['HOME', 'SHOP', 'DETAIL'];
  @override
  void initState() {
    super.initState();
    _announce();
  }

  void _announce() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _timer = Timer(const Duration(seconds: 2), () {
        if (!mounted) return;
        debugPrint('V33_${names[_screen]}_READY');
        _timer = Timer(const Duration(seconds: 12), () {
          if (mounted && _screen < 2) {
            setState(() => _screen++);
            if (_screen == 2) {
              Navigator.of(
                context,
              ).push(MaterialPageRoute(builder: (_) => _frame(_detail())));
            }
            _announce();
          }
        });
      });
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final screens = [
      HomeScreen(
        boxes: v33Boxes,
        balance: '9,900',
        onRefresh: () async {},
        onOpen: (_) {},
        onWallet: () {},
        onShop: () {},
        onRanking: () {},
        onOpenUnopened: () {},
        onCollection: () {},
        onUpdates: () {},
      ),
      BoxShopScreen(
        boxes: v33Boxes,
        balance: '9,900',
        onRefresh: () async {},
        onOpen: (_) {},
        onWallet: () {},
        onUpdates: () {},
      ),
    ];
    return _frame(screens[_screen == 0 ? 0 : 1], tab: _screen == 0 ? 0 : 1);
  }

  Widget _detail() => GachiScaffold(
    title: '박스 상세',
    body: ProductDetailView(
      box: v33Boxes.first,
      detail: v33Detail,
      odds: v33Odds,
      quantity: 1,
      maxQuantity: 100,
      totalPriceLabel: '1,000 GP',
      onDecrement: () {},
      onIncrement: () {},
      onPurchase: () {},
    ),
  );

  Widget _frame(Widget screen, {int? tab}) => Scaffold(
    body: SafeArea(
      bottom: false,
      child: Column(
        children: [
          Container(
            width: double.infinity,
            color: GachiColors.ivory,
            padding: const EdgeInsets.all(4),
            child: const Text(
              'UI 검증용 합성 데이터 · 거래 실행 없음',
              textAlign: TextAlign.center,
              style: GachiType.meta,
            ),
          ),
          Expanded(child: screen),
        ],
      ),
    ),
    bottomNavigationBar: tab == null
        ? null
        : GachiBottomNavigation(selectedIndex: tab, onSelected: (_) {}),
  );
}
