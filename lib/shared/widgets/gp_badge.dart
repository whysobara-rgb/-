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
              padding: const EdgeInsets.fromLTRB(5, 5, 12, 5),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const GpCoin(size: 20),
                  const SizedBox(width: 6),
                  Text(
                    formatNumber(balance),
                    style: AppText.num(
                      AppText.bodyStrong,
                    ).copyWith(height: 1, fontWeight: FontWeight.w800),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// GP 코인 글리프: 제이드 원 안의 "G".
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
          colors: [Color(0xFF7FF5C9), AppColors.brand, AppColors.brandPressed],
        ),
      ),
      child: Text(
        'G',
        style: TextStyle(
          fontFamily: AppText.family,
          fontSize: size * 0.56,
          height: 1,
          fontWeight: FontWeight.w900,
          color: AppColors.onBrand,
        ),
      ),
    );
  }
}
