import 'dart:async';
import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';

/// 가치가차 - 홈 메인 배너 (다크 프로모션 카드, 3개, 자동 슬라이드).
///
/// PageView + PageController + Timer로 3초 간격 자동 슬라이드하며,
/// 우하단에 반투명 검정 pill로 "1/3" 형식의 페이지 표시를 보여준다.
class HomeBannerCarousel extends StatefulWidget {
  const HomeBannerCarousel({super.key});

  @override
  State<HomeBannerCarousel> createState() => _HomeBannerCarouselState();
}

class _BannerData {
  final List<Color> gradient;
  final IconData icon;

  const _BannerData({required this.gradient, required this.icon});
}

class _HomeBannerCarouselState extends State<HomeBannerCarousel> {
  static const List<_BannerData> _banners = [
    _BannerData(
      gradient: [Color(0xFF1E1E1E), Color(0xFF3A2E12)],
      icon: Icons.watch_rounded,
    ),
    _BannerData(
      gradient: [Color(0xFF1E1E1E), Color(0xFF2A2338)],
      icon: Icons.diamond_rounded,
    ),
    _BannerData(
      gradient: [Color(0xFF1E1E1E), Color(0xFF1F3A2E)],
      icon: Icons.shopping_bag_rounded,
    ),
  ];

  late final PageController _pageController;
  Timer? _autoSlideTimer;
  int _currentPage = 0;

  @override
  void initState() {
    super.initState();
    _pageController = PageController();
    _startAutoSlide();
  }

  void _startAutoSlide() {
    _autoSlideTimer = Timer.periodic(const Duration(seconds: 3), (_) {
      if (!_pageController.hasClients) return;
      final nextPage = (_currentPage + 1) % _banners.length;
      _pageController.animateToPage(
        nextPage,
        duration: const Duration(milliseconds: 400),
        curve: Curves.easeInOut,
      );
    });
  }

  @override
  void dispose() {
    _autoSlideTimer?.cancel();
    _pageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 140,
      child: PageView.builder(
        controller: _pageController,
        itemCount: _banners.length,
        onPageChanged: (index) {
          setState(() => _currentPage = index);
        },
        itemBuilder: (context, index) {
          return _BannerCard(
            banner: _banners[index],
            pageLabel: '${index + 1}/${_banners.length}',
          );
        },
      ),
    );
  }
}

class _BannerCard extends StatelessWidget {
  final _BannerData banner;
  final String pageLabel;

  const _BannerCard({required this.banner, required this.pageLabel});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          gradient: LinearGradient(
            colors: banner.gradient,
            begin: Alignment.centerLeft,
            end: Alignment.centerRight,
          ),
        ),
        child: Stack(
          children: [
            // 좌측 텍스트
            const Positioned(
              left: 20,
              top: 0,
              bottom: 0,
              child: Center(
                child: Text(
                  '오늘의\n럭키 PICK!',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 22,
                    fontWeight: FontWeight.w900,
                    height: 1.3,
                  ),
                ),
              ),
            ),
            // 우측 상품 아이콘
            Positioned(
              right: 20,
              top: 0,
              bottom: 0,
              child: Center(
                child: Icon(
                  banner.icon,
                  size: 70,
                  color: AppColors.goldPrimary,
                ),
              ),
            ),
            // 우하단 페이지 표시 pill
            Positioned(
              right: 12,
              bottom: 12,
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 4,
                ),
                decoration: BoxDecoration(
                  color: Colors.black.withValues(alpha: 0.45),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  pageLabel,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
