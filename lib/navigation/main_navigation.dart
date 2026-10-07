import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../core/theme/app_colors.dart';
import '../core/theme/app_typography.dart';
import '../features/home/presentation/home_page.dart';
import '../features/inventory/presentation/inventory_page.dart';
import '../features/profile/presentation/profile_page.dart';
import '../features/ranking/presentation/ranking_screen.dart';
import '../features/wallet/presentation/wallet_page.dart';
import 'tab_navigator.dart';

/// 하단 탭 컨테이너. 탭 상태는 [IndexedStack]으로 유지한다.
class MainNavigation extends StatelessWidget {
  const MainNavigation({super.key});

  static const _pages = <Widget>[
    HomePage(),
    RankingScreen(),
    InventoryPage(),
    WalletPage(),
    ProfilePage(),
  ];

  @override
  Widget build(BuildContext context) {
    final current = context.watch<TabNavigator>().current;
    return Scaffold(
      // 보이지 않는 탭의 애니메이션(홀로 반사광 등)은 멈춘다.
      body: IndexedStack(
        index: current.index,
        children: [
          for (var i = 0; i < _pages.length; i++)
            TickerMode(enabled: i == current.index, child: _pages[i]),
        ],
      ),
      bottomNavigationBar: _BottomBar(
        current: current,
        onSelect: context.read<TabNavigator>().select,
      ),
    );
  }
}

/// 고정 하단 바: 아이콘 + 한글 라벨, 활성 탭만 액센트.
class _BottomBar extends StatelessWidget {
  final AppTab current;
  final ValueChanged<AppTab> onSelect;

  const _BottomBar({required this.current, required this.onSelect});

  static const _icons = <AppTab, (IconData, IconData)>{
    AppTab.home: (Icons.home_outlined, Icons.home),
    AppTab.ranking: (Icons.leaderboard_outlined, Icons.leaderboard),
    AppTab.inventory: (Icons.inventory_2_outlined, Icons.inventory_2),
    AppTab.wallet: (
      Icons.account_balance_wallet_outlined,
      Icons.account_balance_wallet,
    ),
    AppTab.my: (Icons.person_outline, Icons.person),
  };

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: Color(0xFF0B0B0E),
        border: Border(top: BorderSide(color: AppColors.hairline)),
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 56,
          child: Row(
            children: [
              for (final tab in AppTab.values)
                Expanded(
                  child: _BarItem(
                    label: tab.label,
                    icon: tab == current ? _icons[tab]!.$2 : _icons[tab]!.$1,
                    selected: tab == current,
                    onTap: () => onSelect(tab),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _BarItem extends StatelessWidget {
  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  const _BarItem({
    required this.label,
    required this.icon,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final color = selected ? AppColors.brand : AppColors.textTertiary;
    final glow = selected
        ? [
            Shadow(
              color: AppColors.brand.withValues(alpha: 0.6),
              blurRadius: 12,
            ),
          ]
        : null;
    return Semantics(
      selected: selected,
      button: true,
      label: label,
      excludeSemantics: true,
      child: InkResponse(
        onTap: onTap,
        radius: 32,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 24, color: color, shadows: glow),
            const SizedBox(height: 3),
            Text(
              label,
              style: AppText.micro.copyWith(
                color: selected ? AppColors.text : AppColors.textTertiary,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                height: 1,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
