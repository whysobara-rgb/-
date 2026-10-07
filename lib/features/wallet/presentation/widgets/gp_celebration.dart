import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/utils/format.dart';
import '../../../../shared/widgets/gp_badge.dart';
import '../../../../shared/widgets/vault_art.dart';

/// GP가 들어온 순간(가입 축하·충전 완료)의 머리 부분.
///
/// 제이드 기요셰 로제트 위로 코인이 떠오르고, 받은 GP가 0부터 실제 값까지
/// 올라간다. 표시하는 숫자는 서버가 돌려준 값 그대로다.
class GpCelebration extends StatefulWidget {
  final int amount;
  final String eyebrow;
  final String title;

  const GpCelebration({
    super.key,
    required this.amount,
    required this.eyebrow,
    required this.title,
  });

  @override
  State<GpCelebration> createState() => _GpCelebrationState();
}

class _GpCelebrationState extends State<GpCelebration>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1400),
  )..forward();

  @override
  void initState() {
    super.initState();
    HapticFeedback.mediumImpact();
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final rise = CurvedAnimation(
      parent: _c,
      curve: const Interval(0, 0.55, curve: Curves.easeOutBack),
    );
    final count = CurvedAnimation(
      parent: _c,
      curve: const Interval(0.2, 1, curve: Curves.easeOutCubic),
    );
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          height: 210,
          child: Stack(
            alignment: Alignment.center,
            children: [
              Positioned.fill(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: RadialGradient(
                      colors: [
                        AppColors.brand.withValues(alpha: 0.22),
                        AppColors.brand.withValues(alpha: 0),
                      ],
                      stops: const [0, 0.7],
                    ),
                  ),
                ),
              ),
              const Positioned.fill(
                child: CustomPaint(
                  painter: GuillochePainter(
                    color: AppColors.brand,
                    opacity: 0.12,
                    rings: 32,
                    scale: 0.66,
                  ),
                ),
              ),
              AnimatedBuilder(
                animation: rise,
                builder: (_, child) => Transform.translate(
                  offset: Offset(0, 24 * (1 - rise.value)),
                  child: Transform.scale(
                    scale: 0.6 + 0.4 * rise.value,
                    child: Opacity(
                      opacity: rise.value.clamp(0.0, 1.0),
                      child: child,
                    ),
                  ),
                ),
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    boxShadow: [
                      BoxShadow(
                        color: AppColors.brand.withValues(alpha: 0.45),
                        blurRadius: 36,
                      ),
                    ],
                  ),
                  child: const GpCoin(size: 88),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: Space.x2),
        Text(widget.eyebrow, style: AppText.eyebrow),
        const SizedBox(height: Space.x2),
        Text(widget.title, style: AppText.title1, textAlign: TextAlign.center),
        const SizedBox(height: Space.x3),
        AnimatedBuilder(
          animation: count,
          builder: (_, _) => Text.rich(
            TextSpan(
              children: [
                TextSpan(
                  text:
                      '+${formatNumber((widget.amount * count.value).round())}',
                ),
                const TextSpan(text: ' GP', style: TextStyle(fontSize: 22)),
              ],
            ),
            style: AppText.numeral.copyWith(
              fontSize: 44,
              color: AppColors.brand,
            ),
          ),
        ),
      ],
    );
  }
}
