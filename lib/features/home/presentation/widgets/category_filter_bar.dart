import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../domain/capsule_category.dart';

/// 가치가차 - 홈 카테고리 가로 스크롤 필터 탭.
///
/// 선택된 카테고리는 골드 텍스트 + 하단 2px 골드 밑줄로 강조.
class CategoryFilterBar extends StatelessWidget {
  final CapsuleCategory selected;
  final ValueChanged<CapsuleCategory> onSelected;

  const CategoryFilterBar({
    super.key,
    required this.selected,
    required this.onSelected,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 40,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: CapsuleCategory.values.length,
        separatorBuilder: (context, index) => const SizedBox(width: 20),
        itemBuilder: (context, index) {
          final category = CapsuleCategory.values[index];
          final isSelected = category == selected;
          return GestureDetector(
            onTap: () => onSelected(category),
            behavior: HitTestBehavior.opaque,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  category.label,
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: isSelected ? FontWeight.w800 : FontWeight.w500,
                    color: isSelected
                        ? AppColors.goldPrimary
                        : AppColors.textSecondary,
                  ),
                ),
                const SizedBox(height: 6),
                AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  height: 2,
                  width: isSelected ? 20 : 0,
                  decoration: BoxDecoration(
                    color: AppColors.goldPrimary,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}
