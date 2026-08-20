import 'package:flutter/material.dart';
import '../../core/theme/app_colors.dart';

/// 각 탭 화면 구현 전까지 사용하는 공용 "준비중" 더미 뷰.
class ComingSoonView extends StatelessWidget {
  final String title;
  final IconData icon;

  const ComingSoonView({super.key, required this.title, required this.icon});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 88,
            height: 88,
            decoration: BoxDecoration(
              color: AppColors.surfaceElevated,
              shape: BoxShape.circle,
              border: Border.all(color: AppColors.surfaceBorder, width: 1.5),
            ),
            child: Icon(icon, size: 40, color: AppColors.goldPrimary),
          ),
          const SizedBox(height: 24),
          Text(
            '$title 화면 준비중',
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 17,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            '곧 만나보실 수 있어요',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
          ),
        ],
      ),
    );
  }
}
