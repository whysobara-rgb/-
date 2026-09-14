import 'package:flutter/material.dart';
import '../core/theme/app_colors.dart';
import '../features/home/presentation/home_page.dart';
import '../features/inventory/presentation/inventory_page.dart';
import '../features/profile/presentation/profile_page.dart';
import '../features/ranking/presentation/ranking_screen.dart';
import '../features/wallet/presentation/wallet_page.dart';

/// Main tabs preserve their state; inventory refreshes when selected.
class MainNavigation extends StatefulWidget {
  const MainNavigation({super.key});

  @override
  State<MainNavigation> createState() => _MainNavigationState();
}

class _MainNavigationState extends State<MainNavigation> {
  int _currentIndex = 0;
  int _inventoryRevision = 0;
  int _walletRevision = 0;

  void _onTap(int index) {
    setState(() {
      _currentIndex = index;
      if (index == 2) _inventoryRevision++;
      if (index == 3) _walletRevision++;
    });
  }

  void _goToHome() => setState(() => _currentIndex = 0);

  void _goToWallet() => _onTap(3);

  List<Widget> get _screens => [
    HomePage(onGoToWallet: _goToWallet),
    const RankingScreen(),
    InventoryPage(key: ValueKey(_inventoryRevision)),
    WalletPage(key: ValueKey(_walletRevision), onGoToHome: _goToHome),
    ProfilePage(onGoToWallet: _goToWallet),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.scaffoldBg,
      body: IndexedStack(index: _currentIndex, children: _screens),
      bottomNavigationBar: _FloatingNavBar(
        currentIndex: _currentIndex,
        onTap: _onTap,
      ),
    );
  }
}

class _FloatingNavBar extends StatelessWidget {
  final int currentIndex;
  final ValueChanged<int> onTap;
  const _FloatingNavBar({required this.currentIndex, required this.onTap});
  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: const BoxDecoration(
      border: Border(top: BorderSide(color: AppColors.surfaceBorder)),
    ),
    child: NavigationBar(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      indicatorColor: const Color(0xFFFFE8E1),
      elevation: 0,
      selectedIndex: currentIndex,
      onDestinationSelected: onTap,
      labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      destinations: const [
        NavigationDestination(
          icon: Icon(Icons.home_outlined),
          selectedIcon: Icon(Icons.home_rounded),
          label: '홈',
        ),
        NavigationDestination(
          icon: Icon(Icons.leaderboard_outlined),
          selectedIcon: Icon(Icons.leaderboard_rounded),
          label: '랭킹',
        ),
        NavigationDestination(
          icon: Icon(Icons.inventory_2_outlined),
          selectedIcon: Icon(Icons.inventory_2_rounded),
          label: '보관함',
        ),
        NavigationDestination(
          icon: Icon(Icons.account_balance_wallet_outlined),
          selectedIcon: Icon(Icons.account_balance_wallet_rounded),
          label: 'GP',
        ),
        NavigationDestination(
          icon: Icon(Icons.person_outline_rounded),
          selectedIcon: Icon(Icons.person_rounded),
          label: '마이',
        ),
      ],
    ),
  );
}
