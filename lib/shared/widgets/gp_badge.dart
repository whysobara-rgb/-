import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/utils/format.dart';
import '../../navigation/tab_navigator.dart';
import '../providers/gp_provider.dart';

/// 앱바 우측 보유 GP 알약. 누르면 충전 탭으로 간다.
class GpBadge extends StatelessWidget {
  const GpBadge({super.key});

  @override
  Widget build(BuildContext context) {
    final balance = context.watch<GpProvider>().balance;
    return Padding(
      padding: const EdgeInsets.only(right: Space.x3),
      child: Center(
        child: DecoratedBox(
          decoration: const BoxDecoration(
            borderRadius: Radii.pill,
            boxShadow: Shadows.small,
          ),
          child: Material(
            color: AppColors.raised,
            shape: const StadiumBorder(
              side: BorderSide(color: AppColors.hairline),
            ),
            child: InkWell(
              customBorder: const StadiumBorder(),
              onTap: () =>
                  context.read<TabNavigator>().goTo(context, AppTab.wallet),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(4, 4, 11, 4),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const GpCoin(size: 22),
                    const SizedBox(width: 6),
                    Text(
                      formatNumber(balance),
                      style: AppText.num(AppText.bodyStrong).copyWith(
                        height: 1,
                        fontWeight: FontWeight.w800,
                        fontSize: 15,
                        color: AppColors.text,
                      ),
                    ),
                    const SizedBox(width: 2),
                    const Icon(
                      Icons.add_rounded,
                      size: 16,
                      color: AppColors.textSecondary,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// GP 코인: 캡슐 레드 동전 안의 흰 "G"(테두리 홈 + 윗면 반사).
class GpCoin extends StatelessWidget {
  final double size;
  const GpCoin({super.key, this.size = 18});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: const BoxDecoration(
        shape: BoxShape.circle,
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.brandBright, AppColors.brand, AppColors.brandDeep],
        ),
      ),
      child: Container(
        width: size * 0.78,
        height: size * 0.78,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          border: Border.all(
            color: Colors.white.withValues(alpha: 0.4),
            width: size < 20 ? 0.6 : 0.9,
          ),
        ),
        child: Text(
          'G',
          style: TextStyle(
            fontFamily: AppText.family,
            fontSize: size * 0.5,
            height: 1,
            fontWeight: FontWeight.w900,
            color: Colors.white,
          ),
        ),
      ),
    );
  }
}
