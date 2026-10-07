import 'package:flutter/material.dart';
import '../../core/domain/rarity.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';

/// 레어도 코드 배지 ("SSR", "SR", "R", "N").
///
/// 레어도 색은 이 배지와 뽑기 연출에서만 쓴다. SSR만 금속 느낌의
/// 은은한 세로 그라데이션을 허용한다.
class RarityTag extends StatelessWidget {
  final Rarity rarity;

  /// true면 색 바탕에 흰 글씨(이미지 위에 얹을 때), false면 옅은 틴트 바탕.
  final bool solid;
  final bool dense;

  const RarityTag(
    this.rarity, {
    super.key,
    this.solid = false,
    this.dense = false,
  });

  @override
  Widget build(BuildContext context) {
    final isSsr = rarity == Rarity.ssr;
    final useSolid = solid || isSsr;
    final textColor = useSolid ? AppColors.onInk : rarity.color;

    return Container(
      height: dense ? 16 : 18,
      padding: EdgeInsets.symmetric(horizontal: dense ? 4 : 5),
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: useSolid && !isSsr ? rarity.color : (isSsr ? null : rarity.tint),
        gradient: isSsr
            ? const LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  AppColors.raritySSRLight,
                  AppColors.raritySSR,
                  AppColors.raritySSRDeep,
                ],
                stops: [0, 0.55, 1],
              )
            : null,
        borderRadius: Radii.chip,
      ),
      child: Text(
        rarity.code,
        style: AppText.micro.copyWith(
          color: textColor,
          fontSize: dense ? 10 : 11,
          fontWeight: FontWeight.w800,
          letterSpacing: 0.2,
          height: 1,
        ),
      ),
    );
  }
}

/// 결과 아이템에 붙는 작은 텍스트 라벨 ("보너스", "천장" 등).
class QuietLabel extends StatelessWidget {
  final String text;
  final Color? color;
  final bool outlined;

  const QuietLabel(this.text, {super.key, this.color, this.outlined = true});

  @override
  Widget build(BuildContext context) {
    final c = color ?? AppColors.ink;
    return Container(
      height: 18,
      padding: const EdgeInsets.symmetric(horizontal: 5),
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: outlined ? AppColors.bg : c,
        border: outlined
            ? Border.all(color: c.withValues(alpha: 0.6), width: 1)
            : null,
        borderRadius: Radii.chip,
      ),
      child: Text(
        text,
        style: AppText.micro.copyWith(
          color: outlined ? c : AppColors.onInk,
          fontSize: 10.5,
          fontWeight: FontWeight.w700,
          height: 1,
        ),
      ),
    );
  }
}
