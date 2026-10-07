import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../../../core/domain/rarity.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/utils/format.dart';
import '../../../../shared/widgets/collectible_card.dart';
import '../../../../shared/widgets/product_image.dart';
import '../../../../shared/widgets/rarity_tag.dart';
import '../../../../shared/widgets/vault_art.dart';
import '../../domain/draw_result.dart';
import 'gacha_fx_painters.dart';

/// 공개 카드 앞면: 레어도 프레임 + 상품 이미지(또는 엠블럼) + 이름·정가.
/// SSR은 홀로 포일이 기울기([tilt])를 따라 흐른다.
class RevealCardFace extends StatelessWidget {
  final DrawResult result;
  final double width;
  final Offset tilt;
  final bool compact;

  const RevealCardFace({
    super.key,
    required this.result,
    required this.width,
    this.tilt = Offset.zero,
    this.compact = false,
  });

  @override
  Widget build(BuildContext context) {
    final r = result.rarity;
    final h = width * 1.4;
    final labels = [if (result.isPity) '천장', if (result.isBonus) '보너스'];
    return SizedBox(
      width: width,
      height: h,
      child: RarityFrame(
        rarity: r,
        holo: r == Rarity.ssr,
        tilt: tilt,
        radius: compact ? 9 : 16,
        glow: compact ? 0.6 : 1.4,
        child: ColoredBox(
          color: AppColors.surface,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    ProductImage(
                      url: result.imageUrl,
                      rarity: r,
                      name: result.name,
                      borderRadius: BorderRadius.zero,
                    ),
                    Positioned(
                      left: compact ? 4 : 10,
                      top: compact ? 4 : 10,
                      child: RarityTag(r, dense: compact, large: !compact),
                    ),
                    if (labels.isNotEmpty && !compact)
                      Positioned(
                        right: 10,
                        top: 10,
                        child: Row(
                          children: [
                            for (final l in labels) ...[
                              const SizedBox(width: 4),
                              QuietLabel(l),
                            ],
                          ],
                        ),
                      ),
                  ],
                ),
              ),
              if (!compact)
                Container(
                  padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [
                        AppColors.surface,
                        r.color.withValues(alpha: 0.10),
                      ],
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        result.name,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.bodyStrong.copyWith(
                          color: AppColors.text,
                          height: 1.3,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        '정가 ${formatWon(result.estimatedValue)}',
                        style: AppText.num(
                          AppText.caption,
                        ).copyWith(color: r.light, fontWeight: FontWeight.w700),
                      ),
                    ],
                  ),
                )
              else
                Container(
                  height: 18,
                  color: r.color.withValues(alpha: 0.14),
                  alignment: Alignment.center,
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: Text(
                    labels.isNotEmpty
                        ? labels.first
                        : formatWonShort(result.estimatedValue),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.num(AppText.micro).copyWith(
                      color: labels.isNotEmpty ? AppColors.text : r.light,
                      fontSize: 9.5,
                      fontWeight: FontWeight.w800,
                      height: 1,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// 카드 뒷면: 흑연색 바탕 + 기요셰 + 금고 모노그램.
///
/// [glow]가 있으면(실제 결과가 SR/SSR인 카드만) 그 등급 색으로 테두리와
/// 후광이 숨 쉬듯 빛난다 — 뒤집기 전의 정직한 기대감.
class RevealCardBack extends StatelessWidget {
  final double width;
  final Rarity? glow;

  /// 0~1 반복값(후광 맥동).
  final double pulse;
  final double radius;
  final List<String> labels;

  /// 0~1 추가 밝기(포커스 차지 중).
  final double charge;

  const RevealCardBack({
    super.key,
    required this.width,
    this.glow,
    this.pulse = 0,
    this.radius = 16,
    this.labels = const [],
    this.charge = 0,
  });

  @override
  Widget build(BuildContext context) {
    final h = width * 1.4;
    final g = glow;
    final light = g == null ? null : stageLight(g);
    final beat = 0.5 + 0.5 * math.sin(pulse * 2 * math.pi);
    final small = width < 120;
    return Container(
      width: width,
      height: h,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(radius),
        gradient: g == null
            ? const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  Color(0xFF4A4A54),
                  Color(0xFF26262C),
                  Color(0xFF3A3A42),
                ],
              )
            : g.foilGradient(),
        boxShadow: light == null
            ? [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.5),
                  blurRadius: 10,
                  offset: const Offset(0, 4),
                ),
              ]
            : [
                BoxShadow(
                  color: light.withValues(
                    alpha: (0.35 + 0.35 * beat + 0.3 * charge).clamp(0.0, 1.0),
                  ),
                  blurRadius: (small ? 14 : 26) + 10 * beat + 30 * charge,
                  spreadRadius: (small ? 1 : 2) + 2 * beat + 6 * charge,
                ),
              ],
      ),
      padding: EdgeInsets.all(small ? 1.5 : 2.5),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(radius - (small ? 1.5 : 2.5)),
        child: Stack(
          fit: StackFit.expand,
          children: [
            DecoratedBox(
              decoration: BoxDecoration(
                gradient: RadialGradient(
                  center: const Alignment(0, -0.2),
                  radius: 1.1,
                  colors: [
                    light == null
                        ? const Color(0xFF202026)
                        : Color.lerp(
                            const Color(0xFF1B1B20),
                            light,
                            0.18 + 0.12 * beat + 0.4 * charge,
                          )!,
                    const Color(0xFF0E0E11),
                  ],
                ),
              ),
            ),
            CustomPaint(
              painter: GuillochePainter(
                color: light ?? const Color(0xFFB9BEC7),
                opacity: light == null ? 0.10 : 0.16 + 0.1 * charge,
                rings: small ? 14 : 24,
                scale: 0.9,
              ),
            ),
            Center(
              child: _Monogram(
                size: width * 0.34,
                color: light ?? const Color(0xFFB9BEC7),
              ),
            ),
            if (labels.isNotEmpty)
              Positioned(
                left: 0,
                right: 0,
                bottom: small ? 5 : 10,
                child: Center(child: QuietLabel(labels.first)),
              ),
          ],
        ),
      ),
    );
  }
}

/// 뒷면 가운데 모노그램: 겹친 마름모 안의 "가".
class _Monogram extends StatelessWidget {
  final double size;
  final Color color;
  const _Monogram({required this.size, required this.color});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        alignment: Alignment.center,
        children: [
          Transform.rotate(
            angle: math.pi / 4,
            child: Container(
              width: size * 0.7,
              height: size * 0.7,
              decoration: BoxDecoration(
                border: Border.all(
                  color: color.withValues(alpha: 0.7),
                  width: 1,
                ),
              ),
            ),
          ),
          Transform.rotate(
            angle: math.pi / 4,
            child: Container(
              width: size * 0.56,
              height: size * 0.56,
              decoration: BoxDecoration(
                border: Border.all(
                  color: color.withValues(alpha: 0.35),
                  width: 0.8,
                ),
              ),
            ),
          ),
          Text(
            '가',
            style: TextStyle(
              fontFamily: AppText.family,
              fontSize: size * 0.32,
              fontWeight: FontWeight.w900,
              height: 1,
              color: color.withValues(alpha: 0.9),
            ),
          ),
        ],
      ),
    );
  }
}

/// 등급 도장: 크게 떨어져 "쾅" 찍히는 레어도 코드.
///
/// [t] 0~1: 0~0.45 동안 2.8배에서 1배로 떨어지고, 이후 살짝 튕긴다.
/// N은 떨어지지 않고 조용히 나타난다.
class RarityStamp extends StatelessWidget {
  final Rarity rarity;
  final double t;
  final double size;

  const RarityStamp({
    super.key,
    required this.rarity,
    required this.t,
    this.size = 64,
  });

  static const double impactAt = 0.45;

  @override
  Widget build(BuildContext context) {
    if (t <= 0) return const SizedBox.shrink();
    final slam = rarity.rank >= Rarity.r.rank;
    double scale;
    double opacity;
    if (!slam) {
      scale = 1;
      opacity = (t / 0.5).clamp(0.0, 1.0);
    } else if (t < impactAt) {
      final p = Curves.easeIn.transform(t / impactAt);
      scale = 2.8 - 1.8 * p;
      opacity = (t / 0.15).clamp(0.0, 1.0);
    } else {
      final p = (t - impactAt) / (1 - impactAt);
      scale = 1 - 0.08 * math.sin(p * math.pi) * (1 - p);
      opacity = 1;
    }
    final ringT = slam && t >= impactAt ? (t - impactAt) / (1 - impactAt) : 0.0;
    final textSize = size * (rarity.code.length >= 3 ? 0.36 : 0.44);
    return SizedBox(
      width: size * 1.8,
      height: size * 1.8,
      child: Stack(
        alignment: Alignment.center,
        children: [
          if (ringT > 0 && ringT < 1)
            Container(
              width: size * (1 + 0.8 * ringT),
              height: size * (1 + 0.8 * ringT),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                  color: stageLight(rarity).withValues(alpha: 1 - ringT),
                  width: 3 * (1 - ringT) + 0.5,
                ),
              ),
            ),
          Opacity(
            opacity: opacity,
            child: Transform.rotate(
              angle: -0.2,
              child: Transform.scale(
                scale: scale,
                child: Container(
                  width: size,
                  height: size,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: rarity.foilGradient(),
                    boxShadow: [
                      BoxShadow(
                        color: stageLight(rarity).withValues(alpha: 0.55),
                        blurRadius: 18,
                      ),
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.5),
                        blurRadius: 6,
                        offset: const Offset(0, 3),
                      ),
                    ],
                  ),
                  child: Container(
                    margin: EdgeInsets.all(size * 0.07),
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: rarity.onColor.withValues(alpha: 0.45),
                        width: 1.2,
                      ),
                    ),
                    alignment: Alignment.center,
                    child: Text(
                      rarity.code,
                      style: TextStyle(
                        fontFamily: AppText.family,
                        fontSize: textSize,
                        fontWeight: FontWeight.w900,
                        letterSpacing: -0.5,
                        height: 1,
                        color: rarity.onColor,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 뒷면 → 앞면으로 Y축 회전. [flip] 0=뒷면, 1=앞면.
class FlipCard extends StatelessWidget {
  final double flip;
  final Widget front;
  final Widget back;
  final Offset tilt;

  const FlipCard({
    super.key,
    required this.flip,
    required this.front,
    required this.back,
    this.tilt = Offset.zero,
  });

  @override
  Widget build(BuildContext context) {
    final angle = math.pi * (1 - flip.clamp(0.0, 1.0));
    final showFront = angle < math.pi / 2;
    final m = Matrix4.identity()
      ..setEntry(3, 2, 0.0012)
      ..rotateY(angle + tilt.dx * 0.18)
      ..rotateX(-tilt.dy * 0.14);
    return Transform(
      alignment: Alignment.center,
      transform: m,
      child: showFront
          ? front
          : Transform(
              alignment: Alignment.center,
              transform: Matrix4.rotationY(math.pi),
              child: back,
            ),
    );
  }
}
