import 'package:flutter/material.dart';
import '../core/theme/app_colors.dart';
import '../features/home/presentation/home_page.dart';
import '../features/inventory/presentation/inventory_page.dart';
import '../features/profile/presentation/profile_page.dart';
import '../features/ranking/presentation/ranking_screen.dart';
import '../features/wallet/presentation/wallet_page.dart';

/// 가치가차 - 하단 네비게이션 5탭 메인 셸
/// 홈 / 랭킹 / 박스 / 충전 / 마이
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

  /// 충전(WalletPage) 탭에서 "랜덤박스 구매하러 가기"를 눌렀을 때
  /// 홈(0번) 탭으로 전환하기 위한 콜백.
  void _goToHome() {
    setState(() => _currentIndex = 0);
  }

  /// 마이(ProfilePage) 탭에서 "충전 탭 가기"를 눌렀을 때
  /// 충전(3번) 탭으로 전환하기 위한 콜백.
  void _goToWallet() {
    setState(() => _currentIndex = 3);
  }

  // WalletPage/ProfilePage에 탭 전환 콜백을 전달해야 하므로 static const
  // 대신 build() 내부(또는 getter)에서 매번 구성한다.
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
      body: IndexedStack(index: _currentIndex, children: _screens),
      bottomNavigationBar: DecoratedBox(
        decoration: const BoxDecoration(
          border: Border(
            top: BorderSide(color: AppColors.surfaceBorder, width: 1),
          ),
        ),
        child: BottomNavigationBar(
          currentIndex: _currentIndex,
          onTap: _onTap,
          items: const [
            BottomNavigationBarItem(
              icon: Icon(Icons.home_outlined),
              activeIcon: Icon(Icons.home_rounded),
              label: '홈',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.emoji_events_outlined),
              activeIcon: Icon(Icons.emoji_events_rounded),
              label: '랭킹',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.all_inbox_outlined),
              activeIcon: Icon(Icons.all_inbox_rounded),
              label: '박스',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.monetization_on_outlined),
              activeIcon: Icon(Icons.monetization_on_rounded),
              label: '충전',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.person_outline_rounded),
              activeIcon: Icon(Icons.person_rounded),
              label: '마이',
            ),
          ],
        ),
      ),
    );
  }
}
