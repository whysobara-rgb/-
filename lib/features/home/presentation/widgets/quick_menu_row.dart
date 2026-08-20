import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';

/// 가치가차 - 홈 화면 원형 아이콘 퀵메뉴 5개.
///
/// 프리미엄 / 프로모션 / 컬렉션 / 코인샵 / 매일보상.
/// 각 아이템 탭 시 "준비중" SnackBar를 표시한다.
class QuickMenuRow extends StatelessWidget {
  const QuickMenuRow({super.key});

  static const List<_QuickMenuItem> _items = [
    _QuickMenuItem(
      label: '프리미엄',
      icon: Icons.workspace_premium,
      backgroundColor: AppColors.goldPrimary,
    ),
    _QuickMenuItem(
      label: '프로모션',
      icon: Icons.local_offer,
      backgroundColor: AppColors.badgeSpecial,
    ),
    _QuickMenuItem(
      label: '컬렉션',
      icon: Icons.grid_view,
      backgroundColor: Colors.black,
    ),
    _QuickMenuItem(
      label: '코인샵',
      icon: Icons.monetization_on,
      backgroundColor: AppColors.goldPrimary,
    ),
    _QuickMenuItem(
      label: '매일보상',
      icon: Icons.card_giftcard,
      backgroundColor: Color(0xFFFF7A00),
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
                    ),
                    child: Icon(item.icon, color: Colors.white, size: 24),
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
