import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';

/// 천장 진행 막대. SSR 확정과 관련된 정보라 SSR 금색을 쓴다.
class PityBar extends StatelessWidget {
  final double progress;
  const PityBar({super.key, required this.progress});

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: const BorderRadius.all(Radius.circular(2)),
      child: SizedBox(
        height: 6,
        child: Stack(
          fit: StackFit.expand,
          children: [
            const ColoredBox(color: AppColors.high),
            FractionallySizedBox(
              alignment: Alignment.centerLeft,
              widthFactor: progress.clamp(0.0, 1.0),
              child: const ColoredBox(color: AppColors.raritySSR),
            ),
          ],
        ),
      ),
    );
  }
}
