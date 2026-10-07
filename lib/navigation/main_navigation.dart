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

/// 고정 하단 바: 흰 바 + 헤어라인. 활성 탭은 채운 아이콘(캡슐 레드) + 잉크 라벨.
class _BottomBar extends StatelessWidget {
  final AppTab current;
  final ValueChanged<AppTab> onSelect;

  const _BottomBar({required this.current, required this.onSelect});

  static const _icons = <AppTab, (IconData, IconData)>{
    AppTab.home: (Icons.home_outlined, Icons.home_rounded),
    AppTab.ranking: (Icons.leaderboard_outlined, Icons.leaderboard_rounded),
    AppTab.inventory: (Icons.inventory_2_outlined, Icons.inventory_2_rounded),
    AppTab.wallet: (
      Icons.account_balance_wallet_outlined,
      Icons.account_balance_wallet_rounded,
    ),
    AppTab.my: (Icons.person_outline_rounded, Icons.person_rounded),
  };

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: AppColors.raised,
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
    final color = selected ? AppColors.text : AppColors.textTertiary;
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
            Icon(icon, size: 25, color: selected ? AppColors.brand : color),
            const SizedBox(height: 4),
            Text(
              label,
              style: AppText.micro.copyWith(
                color: color,
                fontSize: 11,
                fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
                height: 1,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
