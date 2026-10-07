import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/utils/format.dart';
import '../../navigation/tab_navigator.dart';
import '../providers/gp_provider.dart';

/// 앱바 우측 보유 GP. 누르면 충전 탭으로 간다.
class GpBadge extends StatelessWidget {
  const GpBadge({super.key});

  @override
  Widget build(BuildContext context) {
    final balance = context.watch<GpProvider>().balance;
    return Padding(
      padding: const EdgeInsets.only(right: Space.x3),
      child: Center(
        child: InkWell(
          borderRadius: Radii.button,
          onTap: () =>
              context.read<TabNavigator>().goTo(context, AppTab.wallet),
          child: Container(
            height: 32,
            padding: const EdgeInsets.symmetric(horizontal: 10),
            decoration: BoxDecoration(
              border: Border.all(color: AppColors.line),
              borderRadius: Radii.button,
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  formatNumber(balance),
                  style: AppText.num(AppText.bodyStrong).copyWith(height: 1),
                ),
                const SizedBox(width: 3),
                Text(
                  'GP',
                  style: AppText.micro.copyWith(
                    color: AppColors.inkSecondary,
                    fontWeight: FontWeight.w700,
                    height: 1,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
