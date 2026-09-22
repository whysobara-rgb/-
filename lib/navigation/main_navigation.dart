import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../core/config/app_config.dart';
import '../core/theme/app_colors.dart';
import '../shared/providers/auth_provider.dart';
import '../shared/widgets/gachi_components.dart';
import '../features/home/presentation/home_page.dart';
import '../features/inventory/presentation/inventory_page.dart';
import '../features/profile/presentation/profile_page.dart';
import '../features/ranking/presentation/ranking_screen.dart';
import '../features/wallet/presentation/wallet_page.dart';
import '../features/orders/order_flow_page.dart';

/// Home/shop share one catalog owner. Deferred screens keep their existing theme.
class MainNavigation extends StatefulWidget {
  const MainNavigation({super.key});
  @override
  State<MainNavigation> createState() => _MainNavigationState();
}

class _MainNavigationState extends State<MainNavigation> {
  int _currentIndex = 0, _inventoryRevision = 0, _homeRevision = 0;
  bool _openingRoute = false;

  void _onTap(int index) {
    FocusManager.instance.primaryFocus?.unfocus();
    if (index == 2) {
      _openUnopened();
      return;
    }
    setState(() {
      // Home <-> shop uses the same result; returning from another section refreshes.
      if (index <= 1 && _currentIndex > 1) _homeRevision++;
      if (index == 3) _inventoryRevision++;
      _currentIndex = index;
    });
  }

  Future<void> _openUnopened() async {
    // Same feature gate as InventoryPage's existing unopened entry point.
    if (!AppConfig.orderPreviewEnabled) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('현재 캡슐 구매 서비스를 준비하고 있습니다.')));
      return;
    }
    final user = context.read<AuthProvider>().currentUser;
    if (user == null || _openingRoute) return;
    _openingRoute = true;
    try {
      await Navigator.of(
        context,
      ).push(MaterialPageRoute(builder: (_) => OrderFlowPage(userId: user.id)));
      if (mounted) {
        setState(() {
          _inventoryRevision++;
          _homeRevision++;
        });
      }
    } finally {
      _openingRoute = false;
    }
  }

  void _goToWallet() => Navigator.of(context).push(
    MaterialPageRoute(
      builder: (walletContext) => WalletPage(
        onGoToHome: () {
          Navigator.of(walletContext).popUntil((route) => route.isFirst);
          _onTap(0);
        },
      ),
    ),
  );

  void _goToRanking() => Navigator.of(
    context,
  ).push(MaterialPageRoute(builder: (_) => const RankingScreen()));

  @override
  Widget build(BuildContext context) {
    final bodyIndex = _currentIndex <= 1
        ? 0
        : _currentIndex == 3
        ? 1
        : 2;
    final screens = [
      HomePage(
        onGoToWallet: _goToWallet,
        showShop: _currentIndex == 1,
        refreshRevision: _homeRevision,
        onShop: () => _onTap(1),
        onRanking: _goToRanking,
        onOpenUnopened: _openUnopened,
        onCollection: () => _onTap(3),
      ),
      InventoryPage(key: ValueKey(_inventoryRevision)),
      ProfilePage(onGoToWallet: _goToWallet),
    ];
    return Scaffold(
      backgroundColor: AppColors.scaffoldBg,
      body: IndexedStack(
        index: bodyIndex,
        children: screens
            .asMap()
            .entries
            .map((e) => TickerMode(enabled: e.key == bodyIndex, child: e.value))
            .toList(),
      ),
      bottomNavigationBar: GachiBottomNavigation(
        selectedIndex: _currentIndex,
        onSelected: _onTap,
      ),
    );
  }
}
