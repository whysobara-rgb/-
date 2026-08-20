import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';

/// 가치가차 - 홈 화면 원형 아이콘 퀵메뉴 5개.
///
/// 프리미엄 / 프로모션 / 컬렉션 / 코인샵 / 매일보상.
/// 각 아이템이 서로 다른 비비드 액센트 컬러(코랄/바이올렛/민트/옐로우/스카이)를
/// 사용해 화면이 단조롭지 않도록 구성한다. 탭 시 "준비중" SnackBar를 표시한다.
class QuickMenuRow extends StatelessWidget {
  const QuickMenuRow({super.key});

  static const List<_QuickMenuItem> _items = [
    _QuickMenuItem(
      label: '프리미엄',
      icon: Icons.workspace_premium,
      backgroundColor: AppColors.primary,
    ),
    _QuickMenuItem(
      label: '프로모션',
      icon: Icons.local_offer,
      backgroundColor: AppColors.accentViolet,
    ),
    _QuickMenuItem(
      label: '컬렉션',
      icon: Icons.grid_view,
      backgroundColor: AppColors.accentMint,
    ),
    _QuickMenuItem(
      label: '코인샵',
      icon: Icons.monetization_on,
      backgroundColor: AppColors.accentYellow,
    ),
    _QuickMenuItem(
      label: '매일보상',
      icon: Icons.card_giftcard,
      backgroundColor: AppColors.accentSky,
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
      children: _items
          .map(
            (item) => GestureDetector(
              onTap: () => _onTap(context, item.label),
              behavior: HitTestBehavior.opaque,
              child: Column(
                children: [
                  Container(
                    width: 52,
                    height: 52,
                    decoration: BoxDecoration(
                      color: item.backgroundColor,
                      shape: BoxShape.circle,
                      boxShadow: [
                        BoxShadow(
                          color: item.backgroundColor.withValues(alpha: 0.35),
                          blurRadius: 10,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: Icon(
                      item.icon,
                      color: item.backgroundColor == AppColors.accentYellow
                          ? const Color(0xFF2B2430)
                          : Colors.white,
                      size: 24,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    item.label,
                    style: const TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
          )
          .toList(),
    );
  }
}

class _QuickMenuItem {
  final String label;
  final IconData icon;
  final Color backgroundColor;

  const _QuickMenuItem({
    required this.label,
    required this.icon,
    required this.backgroundColor,
  });
}
