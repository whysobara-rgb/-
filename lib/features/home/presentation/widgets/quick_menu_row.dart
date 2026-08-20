import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';

/// 가치가차 - 홈 화면 퀵메뉴 5종 (클레이모피즘 스타일).
///
/// 각 아이템은 부드러운 클레이 3D 원형 배경(그라데이션 + 딥 소프트
/// 섀도우 + 하이라이트) 위에 실제 3D 렌더링 이미지 에셋을 얹은
/// 형태로 구성된다.
class QuickMenuRow extends StatelessWidget {
  const QuickMenuRow({super.key});

  static const List<_QuickMenuItem> _items = [
    _QuickMenuItem(
      label: '무료뽑기',
      imagePath: 'assets/images/quick_free_draw.png',
      gradient: AppColors.clayOrange,
      shadowColor: Color(0xFFFF6B3D),
    ),
    _QuickMenuItem(
      label: '컬렉션',
      imagePath: 'assets/images/quick_collection.png',
      gradient: AppColors.clayMint,
      shadowColor: Color(0xFF17B894),
    ),
    _QuickMenuItem(
      label: '가게',
      imagePath: 'assets/images/quick_shop.png',
      gradient: AppColors.clayViolet,
      shadowColor: AppColors.accentViolet,
    ),
    _QuickMenuItem(
      label: '혜택',
      imagePath: 'assets/images/quick_benefit.png',
      gradient: AppColors.clayYellow,
      shadowColor: Color(0xFFE8A317),
    ),
    _QuickMenuItem(
      label: '커뮤니티',
      imagePath: 'assets/images/quick_community.png',
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
                width: 64,
                height: 64,
                decoration: BoxDecoration(
                  gradient: item.gradient,
                  shape: BoxShape.circle,
                  boxShadow: [
                    // 깊은 소프트 그림자 (입체감)
                    BoxShadow(
                      color: item.shadowColor.withValues(alpha: 0.5),
                      blurRadius: 16,
                      offset: const Offset(0, 8),
                    ),
                    // 상단 하이라이트 (클레이 볼륨감)
                    BoxShadow(
                      color: Colors.white.withValues(alpha: 0.6),
                      blurRadius: 4,
                      offset: const Offset(-2, -2),
                    ),
                  ],
                ),
                padding: const EdgeInsets.all(8),
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    // 은은한 화이트 글로우 - 3D 오브젝트 시인성/대비 강화
                    Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: Colors.white.withValues(alpha: 0.22),
                      ),
                    ),
                    Image.asset(
                      item.imagePath,
                      fit: BoxFit.contain,
                      errorBuilder: (context, error, stackTrace) =>
                          const SizedBox.shrink(),
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
  final String imagePath;
  final Gradient gradient;
  final Color shadowColor;

  const _QuickMenuItem({
    required this.label,
    required this.imagePath,
    required this.gradient,
    required this.shadowColor,
  });
}
