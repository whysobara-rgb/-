import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../../../core/domain/rarity.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/theme/rarity_style.dart';
import '../../../../core/utils/format.dart';
import '../../../../shared/widgets/collectible_card.dart';
import '../../../../shared/widgets/product_image.dart';
import '../../../../shared/widgets/rarity_tag.dart';
import '../../domain/draw_result.dart';
import 'gacha_fx_painters.dart';

/// 공개 카드 앞면: 레어도 포일 프레임 + 상품 사진(또는 상품 일러스트) +
/// 아래 등급 띠. SSR은 홀로 포일이 기울기([tilt])를 따라 흐르고, 띠도 금박.
class RevealCardFace extends StatelessWidget {
  final DrawResult result;
  final double width;
  final Offset tilt;
  final bool compact;

  /// 프레임 그림자 세기. 3D 변환(틸트·뒤집기) 안에서는 0으로 두고
  /// [CardGlow]를 변환 밖에 깐다(웹에서 흐린 그림자가 사각형으로 잘리지 않게).
  final double? glow;

  const RevealCardFace({
    super.key,
    required this.result,
    required this.width,
    this.tilt = Offset.zero,
    this.compact = false,
    this.glow,
  });

  @override
  Widget build(BuildContext context) {
    final r = result.rarity;
    final h = width * 1.4;
    final labels = [if (result.isPity) '천장', if (result.isBonus) '보너스'];
    final foilBand = r == Rarity.ssr || r == Rarity.sr;
    return SizedBox(
      width: width,
      height: h,
      child: RarityFrame(
        rarity: r,
        holo: r == Rarity.ssr,
        holoIntensity: compact ? 0.4 : 0.75,
        tilt: tilt,
        radius: compact ? 9 : 18,
        glow: glow ?? (compact ? 0.7 : 1.5),
        child: ColoredBox(
          color: Colors.white,
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
                    if (!compact)
                      Positioned(
                        left: 10,
                        top: 10,
                        child: RarityTag(r, large: true),
                      ),
                    if (labels.isNotEmpty && !compact)
                      Positioned(
                        right: 10,
                        top: 12,
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
                  height: 40,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  decoration: BoxDecoration(
                    gradient: foilBand
                        ? r.foilGradient(
                            begin: Alignment.centerLeft,
                            end: Alignment.centerRight,
                          )
                        : null,
                    color: foilBand ? null : r.color.withValues(alpha: 0.12),
                  ),
                  child: Row(
                    children: [
                      Text(
                        '${r.code} · ${r.label}',
                        style: AppText.micro.copyWith(
                          color: foilBand ? r.onColor : r.ink,
                          fontSize: 12,
                          fontWeight: FontWeight.w900,
                          letterSpacing: 0.4,
                          height: 1,
                        ),
                      ),
                      const Spacer(),
                      Text(
                        formatWonShort(result.estimatedValue),
                        style: AppText.num(AppText.micro).copyWith(
                          color: (foilBand ? r.onColor : AppColors.text)
                              .withValues(alpha: 0.85),
                          fontSize: 12,
                          fontWeight: FontWeight.w800,
                          height: 1,
                        ),
                      ),
                    ],
                  ),
                )
              else
                Container(
                  height: 18,
                  alignment: Alignment.center,
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  decoration: BoxDecoration(
                    gradient: foilBand
                        ? r.foilGradient(
                            begin: Alignment.centerLeft,
                            end: Alignment.centerRight,
                          )
                        : null,
                    color: foilBand ? null : r.color.withValues(alpha: 0.14),
                  ),
                  child: Text(
                    labels.isNotEmpty
                        ? labels.first
                        : formatWonShort(result.estimatedValue),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.num(AppText.micro).copyWith(
                      color: foilBand ? r.onColor : r.ink,
                      fontSize: 9.5,
                      fontWeight: FontWeight.w900,
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

/// 카드 크기의 등급 그림자만 그린다(3D 변환 밖, 카드 뒤에 깐다).
class CardGlow extends StatelessWidget {
  final Rarity rarity;
  final double width;
  final double radius;
  final double strength;

  const CardGlow({
    super.key,
    required this.rarity,
    required this.width,
    this.radius = 18,
    this.strength = 1.5,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: width * 1.4,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(radius),
        boxShadow: rarity.glow(strength),
      ),
    );
  }
}

/// 카드 뒷면: 캡슐 레드 면 + 흰 다이아 격자 + 가운데 흰 봉인 + 워드마크.
///
/// [glow]가 있으면(실제 결과가 SR/SSR인 카드만) 그 등급 포일 테두리와
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
    final border = g == null ? (small ? 2.0 : 3.0) : (small ? 2.5 : 4.0);
    return Container(
      width: width,
      height: h,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(radius),
        gradient: g == null
            ? const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Colors.white, Color(0xFFE9ECF1)],
              )
            : g.foilGradient(),
        boxShadow: light == null
            ? [
                BoxShadow(
                  color: const Color(0xFF0B0D12).withValues(alpha: 0.28),
                  blurRadius: small ? 8 : 16,
                  offset: Offset(0, small ? 3 : 6),
                ),
              ]
            : [
                BoxShadow(
                  color: Color.lerp(light, Colors.white, 0.3)!.withValues(
                    alpha: (0.45 + 0.3 * beat + 0.25 * charge).clamp(0.0, 1.0),
                  ),
                  blurRadius: (small ? 12 : 24) + 10 * beat + 26 * charge,
                  spreadRadius: (small ? 1 : 2) + 2 * beat + 5 * charge,
                ),
              ],
      ),
      padding: EdgeInsets.all(border),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(radius - border),
        child: Stack(
          fit: StackFit.expand,
          children: [
            CustomPaint(
              painter: _CardBackPainter(
                small: small,
                charge: charge,
                glow: light,
              ),
            ),
            Center(child: _Seal(size: width * 0.42)),
            if (!small)
              Positioned(
                left: 0,
                right: 0,
                bottom: h * 0.07,
                child: Text(
                  'GACHI GACHA',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontFamily: AppText.family,
                    fontSize: width * 0.055,
                    fontWeight: FontWeight.w800,
                    letterSpacing: width * 0.02,
                    height: 1,
                    color: Colors.white.withValues(alpha: 0.75),
                  ),
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

class _CardBackPainter extends CustomPainter {
  final bool small;
  final double charge;
  final Color? glow;

  _CardBackPainter({required this.small, required this.charge, this.glow});

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    canvas.drawRect(
      rect,
      Paint()
        ..shader = const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.brandBright, AppColors.brand, AppColors.brandDeep],
          stops: [0, 0.5, 1],
        ).createShader(rect),
    );
    // 다이아 격자.
    final step = size.width / (small ? 5 : 7);
    final line = Paint()
      ..strokeWidth = small ? 0.6 : 0.9
      ..color = Colors.white.withValues(alpha: 0.12);
    for (var k = -size.height; k < size.width + size.height; k += step) {
      canvas.drawLine(Offset(k, 0), Offset(k + size.height, size.height), line);
      canvas.drawLine(Offset(k, 0), Offset(k - size.height, size.height), line);
    }
    // 안쪽 테두리.
    final inset = size.width * 0.06;
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        rect.deflate(inset),
        Radius.circular(size.width * 0.06),
      ),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = small ? 0.7 : 1.2
        ..color = Colors.white.withValues(alpha: 0.55),
    );
    // 가운데 빛(포커스 차지·SR/SSR).
    if (glow != null || charge > 0) {
      final c = rect.center;
      final r = size.width * 0.7;
      canvas.drawCircle(
        c,
        r,
        Paint()
          ..shader = RadialGradient(
            colors: [
              Colors.white.withValues(alpha: 0.18 + 0.4 * charge),
              (glow ?? Colors.white).withValues(alpha: 0.12 + 0.2 * charge),
              Colors.transparent,
            ],
            stops: const [0, 0.4, 1],
          ).createShader(Rect.fromCircle(center: c, radius: r)),
      );
    }
    // 유광 띠.
    canvas.drawRect(
      rect,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Colors.white.withValues(alpha: 0),
            Colors.white.withValues(alpha: 0.22),
            Colors.white.withValues(alpha: 0),
          ],
          stops: const [0.25, 0.38, 0.52],
        ).createShader(rect),
    );
  }

  @override
  bool shouldRepaint(covariant _CardBackPainter old) =>
      old.small != small || old.charge != charge || old.glow != glow;
}

/// 뒷면 가운데 흰 봉인: 톱니 원 + 레드 "가".
class _Seal extends StatelessWidget {
  final double size;
  const _Seal({required this.size});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: Colors.white,
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF5A0D04).withValues(alpha: 0.35),
            blurRadius: size * 0.12,
            offset: Offset(0, size * 0.05),
          ),
        ],
      ),
      child: Container(
        width: size * 0.82,
        height: size * 0.82,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          border: Border.all(
            color: AppColors.brand.withValues(alpha: 0.55),
            width: size < 40 ? 0.8 : 1.2,
          ),
        ),
        child: Text(
          '가',
          style: TextStyle(
            fontFamily: AppText.family,
            fontSize: size * 0.42,
            fontWeight: FontWeight.w900,
            height: 1,
            color: AppColors.brand,
          ),
        ),
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
