import 'package:flutter/material.dart';
import '../../core/domain/rarity.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/theme/rarity_style.dart';
import 'holo.dart';
import 'pack_art.dart';

/// 레어도 코드 배지 ("SSR", "SR", "R", "N").
///
/// N은 옅은 회색 면 + 회색 글자(깨끗하게), R은 블루 면, SR은 퍼플 포일,
/// SSR은 금박 포일 + (선택) 움직이는 홀로 반사광. 포일 배지는 윗변에
/// 가는 반사선이 있어 종이 위 박 인쇄처럼 보인다.
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
        color: isN ? AppColors.rarityNInk : rarity.onColor,
        fontSize: fs,
        fontWeight: FontWeight.w900,
        letterSpacing: large ? 1.0 : 0.4,
        height: 1,
      ),
    );
    final radius = BorderRadius.circular(large ? 7 : (dense ? 4 : 5));
    Widget tag = Container(
      height: h,
      padding: EdgeInsets.symmetric(horizontal: large ? 9 : (dense ? 4.5 : 6)),
      decoration: BoxDecoration(
        color: isN ? AppColors.rarityNLight : null,
        gradient: isN
            ? null
            : rarity.foilGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
        border: isN
            ? Border.all(color: AppColors.rarityN.withValues(alpha: 0.35))
            : Border(
                top: BorderSide(
                  color: Colors.white.withValues(alpha: 0.55),
                  width: 0.8,
                ),
              ),
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

/// 작은 텍스트 라벨 ("보너스", "천장", "NEW" 등). 사진·그림 위에 얹어도
/// 읽히도록 흰 면 + 그림자.
class QuietLabel extends StatelessWidget {
  final String text;
  final Color? color;

  /// true면 면 채움(색 바탕 + 흰 글씨).
  final bool filled;

  const QuietLabel(this.text, {super.key, this.color, this.filled = false});

  @override
  Widget build(BuildContext context) {
    final c = color ?? AppColors.text;
    return Container(
      height: 19,
      padding: const EdgeInsets.symmetric(horizontal: 6),
      decoration: BoxDecoration(
        color: filled ? c : Colors.white.withValues(alpha: 0.94),
        border: filled ? null : Border.all(color: c.withValues(alpha: 0.18)),
        borderRadius: const BorderRadius.all(Radius.circular(5)),
        boxShadow: filled ? null : Shadows.small,
      ),
      child: Center(
        widthFactor: 1,
        child: Text(
          text,
          style: AppText.micro.copyWith(
            color: filled ? Colors.white : c,
            fontSize: 10.5,
            fontWeight: FontWeight.w800,
            height: 1,
          ),
        ),
      ),
    );
  }
}

/// 서버 박스 배지(OPEN 기념 / NEW / HOT / DREAM / SPECIAL).
///
/// HOT은 브랜드 레드, NEW는 잉크, DREAM은 먹색 바탕에 금박 글자(등급 SSR과
/// 헷갈리지 않게 면은 칠하지 않는다), 그 밖은 흰 바탕 + 레드 글자.
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
    final isNew = upper == 'NEW';
    final Color bg = hot
        ? AppColors.brand
        : (dream || isNew)
        ? AppColors.text
        : Colors.white;
    final Color fg = hot || isNew
        ? Colors.white
        : dream
        ? const Color(0xFFF2C75C)
        : AppColors.brand;
    final text = Text(
      labelOf(raw),
      style: AppText.micro.copyWith(
        color: fg,
        fontSize: 10.5,
        fontWeight: FontWeight.w900,
        letterSpacing: 0.4,
        height: 1,
        foreground: dream
            ? (Paint()
                ..shader = FoilTone.gold.gradient().createShader(
                  const Rect.fromLTWH(0, 0, 40, 12),
                ))
            : null,
      ),
    );
    return Container(
      height: 20,
      padding: const EdgeInsets.symmetric(horizontal: 7),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: const BorderRadius.all(Radius.circular(5)),
        boxShadow: Shadows.small,
      ),
      child: Center(widthFactor: 1, child: text),
    );
  }
}

/// 확률·정가 같은 짧은 수치 알약(레어도 색 옅은 면 + 진한 글자).
class RarityPill extends StatelessWidget {
  final Rarity rarity;
  final String text;
  final bool dense;

  const RarityPill(this.rarity, this.text, {super.key, this.dense = false});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: dense ? 18 : 22,
      padding: EdgeInsets.symmetric(horizontal: dense ? 5 : 7),
      decoration: BoxDecoration(
        color: rarity == Rarity.n
            ? AppColors.surface
            : rarity.color.withValues(alpha: 0.12),
        borderRadius: Radii.pill,
      ),
      child: Center(
        widthFactor: 1,
        child: Text(
          text,
          style: AppText.num(AppText.micro).copyWith(
            color: rarity.ink,
            fontSize: dense ? 10 : 11.5,
            fontWeight: FontWeight.w800,
            height: 1,
          ),
        ),
      ),
    );
  }
}
