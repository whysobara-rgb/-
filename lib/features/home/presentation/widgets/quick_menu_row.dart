import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';

/// 가치가차 - 홈 화면 퀵메뉴 5종 (클레이모피즘 스타일).
///
/// 각 아이템은 부드러운 클레이 3D 원형 배경(그라데이션 + 딥 소프트
/// 섀도우 + 하이라이트) 위에 두툼한 화이트 라운드 아이콘을 얹은
/// 형태로 구성된다.
class QuickMenuRow extends StatelessWidget {
  const QuickMenuRow({super.key});

  static const List<_QuickMenuItem> _items = [
    _QuickMenuItem(
      label: '무료뽑기',
      icon: Icons.card_giftcard_rounded,
      gradient: AppColors.clayOrange,
      shadowColor: Color(0xFFFF6B3D),
    ),
    _QuickMenuItem(
      label: '컬렉션',
      icon: Icons.star_rounded,
      gradient: AppColors.clayMint,
      shadowColor: Color(0xFF17B894),
    ),
    _QuickMenuItem(
      label: '가게',
      icon: Icons.storefront_rounded,
      gradient: AppColors.clayViolet,
      shadowColor: AppColors.accentViolet,
    ),
    _QuickMenuItem(
      label: '혜택',
      icon: Icons.confirmation_number_rounded,
      gradient: AppColors.clayYellow,
      shadowColor: Color(0xFFE8A317),
    ),
    _QuickMenuItem(
      label: '커뮤니티',
      icon: Icons.forum_rounded,
      gradient: AppColors.claySky,
      shadowColor: AppColors.accentSky,
    ),
  ];

  void _onTap(BuildContext context, String label) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text('$label 기능은 준비중입니다')));
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: _items.map((item) {
        return GestureDetector(
          onTap: () => _onTap(context, item.label),
          behavior: HitTestBehavior.opaque,
          child: Column(
            children: [
              Container(
                width: 58,
                height: 58,
                decoration: BoxDecoration(
                  gradient: item.gradient,
                  shape: BoxShape.circle,
                  boxShadow: [
                    // 깊은 소프트 그림자 (입체감)
                    BoxShadow(
                      color: item.shadowColor.withValues(alpha: 0.45),
                      blurRadius: 14,
                      offset: const Offset(0, 7),
                    ),
                    // 상단 하이라이트 (클레이 볼륨감)
                    BoxShadow(
                      color: Colors.white.withValues(alpha: 0.5),
                      blurRadius: 4,
                      offset: const Offset(-2, -2),
                    ),
                  ],
                ),
                child: Icon(
                  item.icon,
                  color: Colors.white,
                  size: 26,
                  shadows: [
                    Shadow(
                      color: item.shadowColor.withValues(alpha: 0.5),
                      offset: const Offset(0, 1.5),
                      blurRadius: 2,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              Text(
                item.label,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                  letterSpacing: -0.2,
                ),
              ),
            ],
          ),
        );
      }).toList(),
    );
  }
}

class _QuickMenuItem {
  final String label;
  final IconData icon;
  final Gradient gradient;
  final Color shadowColor;

  const _QuickMenuItem({
    required this.label,
    required this.icon,
    required this.gradient,
    required this.shadowColor,
  });
}
