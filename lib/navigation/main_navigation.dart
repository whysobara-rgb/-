import 'package:flutter/material.dart';
import '../core/theme/app_colors.dart';
import '../features/home/presentation/home_page.dart';
import '../features/inventory/presentation/inventory_page.dart';
import '../features/profile/presentation/profile_page.dart';
import '../features/ranking/presentation/ranking_screen.dart';
import '../features/wallet/presentation/wallet_page.dart';

/// 가치가차 - 앱 하단 탭 네비게이션 컨테이너.
///
/// [IndexedStack]으로 5개 탭(홈/랭킹/박스/충전/마이)의 상태를 유지하며,
/// 하단 네비게이션은 Claymorphism & Pastel 3D 스타일의 플로팅
/// 라운드 바(아이콘 전용, 선택 시 그라데이션 소프트 원형 배경)로 구성된다.
class MainNavigation extends StatefulWidget {
  const MainNavigation({super.key});

  @override
  State<MainNavigation> createState() => _MainNavigationState();
}

class _MainNavigationState extends State<MainNavigation> {
  int _currentIndex = 0;

  void _onTap(int index) {
    setState(() => _currentIndex = index);
  }

  void _goToHome() => setState(() => _currentIndex = 0);

  void _goToWallet() => setState(() => _currentIndex = 3);

  List<Widget> get _screens => [
    HomePage(onGoToWallet: _goToWallet),
    const RankingScreen(),
    const InventoryPage(),
    WalletPage(onGoToHome: _goToHome),
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

/// 플로팅 라운드 코너 하단 네비게이션 바.
///
/// 5개의 미니멀 라인 아이콘(홈/카테고리/장바구니/선물상자/프로필)으로
/// 구성되며, 선택된 아이템은 코랄→바이올렛 그라데이션 소프트 원형
/// 배경으로 강조된다. 텍스트 라벨은 사용하지 않는다.
class _FloatingNavBar extends StatelessWidget {
  final int currentIndex;
  final ValueChanged<int> onTap;

  const _FloatingNavBar({required this.currentIndex, required this.onTap});

  static const List<IconData> _icons = [
    Icons.home_rounded,
    Icons.grid_view_rounded,
    Icons.shopping_cart_rounded,
    Icons.card_giftcard_rounded,
    Icons.person_rounded,
  ];

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      minimum: const EdgeInsets.fromLTRB(20, 0, 20, 14),
      child: Container(
        height: 66,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(33),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.10),
              blurRadius: 20,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: List.generate(_icons.length, (index) {
            final isSelected = index == currentIndex;
            return _NavItem(
              icon: _icons[index],
              isSelected: isSelected,
              onTap: () => onTap(index),
            );
          }),
        ),
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  final IconData icon;
  final bool isSelected;
  final VoidCallback onTap;

  const _NavItem({
    required this.icon,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        width: 48,
        height: 48,
        decoration: BoxDecoration(
          gradient: isSelected ? AppColors.navActiveGradient : null,
          shape: BoxShape.circle,
          boxShadow: isSelected
              ? [
                  BoxShadow(
                    color: AppColors.accentViolet.withValues(alpha: 0.35),
                    blurRadius: 10,
                    offset: const Offset(0, 4),
                  ),
                ]
              : null,
        ),
        alignment: Alignment.center,
        child: Icon(
          icon,
          size: 24,
          color: isSelected ? Colors.white : const Color(0xFFBFB8C4),
        ),
      ),
    );
  }
}
