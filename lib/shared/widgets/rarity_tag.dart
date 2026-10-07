import 'package:flutter/material.dart';
import '../../core/domain/rarity.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import 'holo.dart';

/// 레어도 코드 배지 ("SSR", "SR", "R", "N").
///
/// N은 스틸 테두리, R은 코발트 면, SR은 자수정 금속 그라데이션,
/// SSR은 금박 그라데이션 + (선택) 움직이는 홀로 반사광.
class RarityTag extends StatelessWidget {
  final Rarity rarity;
  final bool dense;

  /// 큰 표기(결과·연출 카드). 높이 26.
  final bool large;

  /// SSR 홀로 반사광 애니메이션. 목록에서 수십 개가 동시에 돌지 않게
  /// 기본은 끄고, 대표 위치에서만 켠다.
  final bool holo;

  const RarityTag(
    this.rarity, {
    super.key,
    this.dense = false,
    this.large = false,
    this.holo = false,
  });

  @override
  Widget build(BuildContext context) {
    final h = large ? 26.0 : (dense ? 16.0 : 19.0);
    final fs = large ? 14.0 : (dense ? 9.5 : 10.5);
    final isN = rarity == Rarity.n;
    final label = Text(
      rarity.code,
      style: AppText.micro.copyWith(
        color: isN ? AppColors.rarityNLight : rarity.onColor,
        fontSize: fs,
        fontWeight: FontWeight.w900,
        letterSpacing: large ? 1.2 : 0.5,
        height: 1,
      ),
    );
    final radius = BorderRadius.circular(large ? 6 : 3.5);
    Widget tag = Container(
      height: h,
      padding: EdgeInsets.symmetric(horizontal: large ? 9 : (dense ? 4 : 5.5)),
      decoration: BoxDecoration(
        color: isN ? AppColors.rarityN.withValues(alpha: 0.14) : null,
        gradient: isN
            ? null
            : rarity.foilGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
              ),
        border: isN
            ? Border.all(color: AppColors.rarityN.withValues(alpha: 0.45))
            : null,
        borderRadius: radius,
      ),
      child: Center(widthFactor: 1, child: label),
    );
    if (rarity == Rarity.ssr && holo) {
      tag = HoloFoil(
        borderRadius: radius,
        intensity: 0.9,
        sparkles: 2,
        child: tag,
      );
    }
    return tag;
  }
}

/// 작은 텍스트 라벨 ("보너스", "천장", "NEW" 등).
class QuietLabel extends StatelessWidget {
  final String text;
  final Color? color;

  /// true면 면 채움(진한 바탕 + 어두운 글씨).
  final bool filled;

  const QuietLabel(this.text, {super.key, this.color, this.filled = false});

  @override
  Widget build(BuildContext context) {
    final c = color ?? AppColors.text;
    return Container(
      height: 19,
      padding: const EdgeInsets.symmetric(horizontal: 6),
      decoration: BoxDecoration(
        color: filled ? c : AppColors.canvas.withValues(alpha: 0.72),
        border: filled ? null : Border.all(color: c.withValues(alpha: 0.5)),
        borderRadius: const BorderRadius.all(Radius.circular(3.5)),
      ),
      child: Center(
        widthFactor: 1,
        child: Text(
          text,
          style: AppText.micro.copyWith(
            color: filled ? AppColors.canvas : c,
            fontSize: 10.5,
            fontWeight: FontWeight.w800,
            height: 1,
          ),
        ),
      ),
    );
  }
}

/// 서버 박스 배지(OPEN 기념 / NEW / HOT / DREAM / SPECIAL)를 그린다.
/// 금고 톤에 맞춰 대부분은 먹색 바탕 + 흰 글씨, DREAM만 금박.
class BoxBadge extends StatelessWidget {
  final String raw;
  const BoxBadge(this.raw, {super.key});

  static String labelOf(String raw) => switch (raw.toUpperCase()) {
    'NEW' => 'NEW',
    'HOT' => 'HOT',
    'SPECIAL' => '기획전',
    _ => raw,
  };

  @override
  Widget build(BuildContext context) {
    final upper = raw.toUpperCase();
    final dream = upper == 'DREAM';
    final hot = upper == 'HOT';
    return Container(
      height: 20,
      padding: const EdgeInsets.symmetric(horizontal: 7),
      decoration: BoxDecoration(
        color: dream
            ? null
            : hot
            ? AppColors.brand
            : AppColors.canvas.withValues(alpha: 0.78),
        gradient: dream
            ? Rarity.ssr.foilGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
              )
            : null,
        border: dream || hot
            ? null
            : Border.all(color: Colors.white.withValues(alpha: 0.22)),
        borderRadius: Radii.chip,
      ),
      child: Center(
        widthFactor: 1,
        child: Text(
          labelOf(raw),
          style: AppText.micro.copyWith(
            color: dream
                ? Rarity.ssr.onColor
                : hot
                ? AppColors.onBrand
                : AppColors.text,
            fontSize: 10.5,
            fontWeight: FontWeight.w900,
            letterSpacing: 0.6,
            height: 1,
          ),
        ),
      ),
    );
  }
}
