import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/widgets/gp_badge.dart';

/// 랭킹 탭 화면 (더미).
///
/// 실제 랭킹 로직 구현 전까지 사용되는 준비중 안내 화면.
class RankingScreen extends StatelessWidget {
  const RankingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('랭킹'), actions: const [GpBadge()]),
      body: Center(
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
              child: const Icon(
                Icons.emoji_events_rounded,
                size: 40,
                color: AppColors.goldPrimary,
              ),
            ),
            const SizedBox(height: 24),
            const Text(
              '랭킹 기능은 준비중입니다',
              style: TextStyle(
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
      ),
    );
  }
}
