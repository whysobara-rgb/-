import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../domain/gacha_grade.dart';

/// 뽑기 연출용 CustomPainter 모음.
///
/// 외부 엔진 없이 Canvas만으로 그린다. 셸은 조용하게, 이 무대는 화려하게:
/// 어두운 무채색 무대 위에서 오직 실제 결과 등급의 빛 색만 쓴다.

/// ── 아이소메트릭 박스 ─────────────────────────────────────────────
///
/// 흑연색 상자. 뚜껑 이음새와 균열로 등급 빛이 새어 나온다.
class VaultBoxPainter extends CustomPainter {
  /// 0~1 등장(스케일·불투명도).
  final double appear;

  /// 0~1 균열 진행도.
  final double crack;

  /// 현재 빛 색.
  final Color color;

  /// 맥동 스케일(1.0 기준).
  final double pulse;

  /// 0~1 뚜껑 열림(개봉 단계).
  final double lidOpen;

  /// 0~1 반복값. SSR 금속 광택 회전.
  final double sheen;

  /// SSR 금속 광택 사용 여부.
  final bool metallic;

  /// 빛의 세기 배율(등급이 높을수록 큼).
  final double intensity;

  VaultBoxPainter({
    required this.appear,
    required this.crack,
    required this.color,
    this.pulse = 1,
    this.lidOpen = 0,
    this.sheen = 0,
    this.metallic = false,
    this.intensity = 1,
  });

  static const _top = Color(0xFF34343A);
  static const _left = Color(0xFF222226);
  static const _right = Color(0xFF17171A);

  @override
  void paint(Canvas canvas, Size size) {
    if (appear <= 0) return;
    final c = size.center(Offset.zero) + const Offset(0, 6);
    final s =
        size.width *
        0.27 *
        pulse *
        (0.6 + 0.4 * Curves.easeOutBack.transform(appear.clamp(0.0, 1.0)));
    final cos30 = math.cos(math.pi / 6);
    final opacity = appear.clamp(0.0, 1.0);

    // 꼭짓점.
    final t = c + Offset(0, -s);
    final ul = c + Offset(-s * cos30, -s / 2);
    final ur = c + Offset(s * cos30, -s / 2);
    final ll = c + Offset(-s * cos30, s / 2);
    final lr = c + Offset(s * cos30, s / 2);
    final b = c + Offset(0, s);

    // 바닥 그림자.
    canvas.drawOval(
      Rect.fromCenter(
        center: b + Offset(0, s * 0.18),
        width: s * 2.3,
        height: s * 0.42,
      ),
      Paint()
        ..color = Colors.black.withValues(alpha: 0.55 * opacity)
        ..maskFilter = MaskFilter.blur(BlurStyle.normal, s * 0.12),
    );

    // 등 뒤 후광: 균열이 진행될수록 커진다.
    final glow = (0.15 + 0.85 * crack) * intensity;
    if (glow > 0) {
      canvas.drawCircle(
        c,
        s * (1.6 + 0.9 * crack),
        Paint()
          ..shader =
              RadialGradient(
                colors: [
                  color.withValues(
                    alpha: (0.42 * glow).clamp(0.0, 0.8) * opacity,
                  ),
                  color.withValues(alpha: 0),
                ],
              ).createShader(
                Rect.fromCircle(center: c, radius: s * (1.6 + 0.9 * crack)),
              ),
      );
    }

    final lidLift = Offset(
      0,
      -s * 1.6 * Curves.easeIn.transform(lidOpen.clamp(0.0, 1.0)),
    );
    final lidAlpha = (1 - lidOpen * 1.4).clamp(0.0, 1.0);

    // 몸통 좌/우 면.
    final leftFace = Path()..addPolygon([ul, c, b, ll], true);
    final rightFace = Path()..addPolygon([c, ur, lr, b], true);
    canvas.drawPath(
      leftFace,
      Paint()..color = _left.withValues(alpha: opacity),
    );
    canvas.drawPath(
      rightFace,
      Paint()..color = _right.withValues(alpha: opacity),
    );

    if (metallic) {
      // SSR: 면 위로 아주 옅은 금속 광택 띠가 천천히 지나간다.
      final band = Rect.fromLTRB(ll.dx, t.dy, lr.dx, b.dy);
      final shift = sheen * 2 - 0.5;
      final sheenPaint = Paint()
        ..shader = LinearGradient(
          begin: Alignment(-1 + shift * 2, -1),
          end: Alignment(1 + shift * 2, 1),
          colors: [
            Colors.transparent,
            const Color(0xFFF2C14E).withValues(alpha: 0.16 * opacity),
            Colors.transparent,
          ],
          stops: const [0.35, 0.5, 0.65],
        ).createShader(band);
      canvas.drawPath(leftFace, sheenPaint);
      canvas.drawPath(rightFace, sheenPaint);
    }

    // 뚜껑 이음새 높이(옆면 위쪽 22%).
    const seamT = 0.22;
    final seamL1 = Offset.lerp(ul, ll, seamT)!;
    final seamC = Offset.lerp(c, b, seamT)!;
    final seamR1 = Offset.lerp(ur, lr, seamT)!;

    // 균열: 이음새에서 아래로 번개처럼 갈라진다.
    if (crack > 0) {
      final rng = math.Random(7);
      final count = (crack * 6).ceil().clamp(0, 6);
      final crackPaint = Paint()
        ..color = color.withValues(alpha: opacity)
        ..style = PaintingStyle.stroke
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round;
      for (var i = 0; i < count; i++) {
        final onLeft = i.isEven;
        final a = onLeft ? seamL1 : seamC;
        final bEdge = onLeft ? seamC : seamR1;
        final start = Offset.lerp(a, bEdge, 0.2 + rng.nextDouble() * 0.6)!;
        final path = Path()..moveTo(start.dx, start.dy);
        var p = start;
        final segs = 4;
        final reach = s * 0.95 * (crack * 1.2 - i * 0.12).clamp(0.0, 1.0);
        for (var k = 1; k <= segs; k++) {
          p = p + Offset((rng.nextDouble() - 0.5) * s * 0.22, reach / segs);
          path.lineTo(p.dx, p.dy);
        }
        final clip = onLeft ? leftFace : rightFace;
        canvas.save();
        canvas.clipPath(clip);
        canvas.drawPath(
          path,
          Paint()
            ..color = color.withValues(alpha: 0.6 * opacity)
            ..style = PaintingStyle.stroke
            ..strokeWidth = 6
            ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 5),
        );
        canvas.drawPath(path, crackPaint..strokeWidth = 1.6);
        canvas.restore();
      }
    }

    // 이음새 빛.
    final seamPath = Path()
      ..moveTo(seamL1.dx, seamL1.dy)
      ..lineTo(seamC.dx, seamC.dy)
      ..lineTo(seamR1.dx, seamR1.dy);
    final seamStrength = (0.25 + 0.75 * crack) * opacity;
    canvas.drawPath(
      seamPath,
      Paint()
        ..color = color.withValues(alpha: (0.8 * seamStrength).clamp(0.0, 1.0))
        ..style = PaintingStyle.stroke
        ..strokeWidth = 4 + 6 * crack * intensity
        ..maskFilter = MaskFilter.blur(BlurStyle.normal, 4 + 6 * crack),
    );
    canvas.drawPath(
      seamPath,
      Paint()
        ..color = Color.lerp(
          color,
          Colors.white,
          0.5,
        )!.withValues(alpha: seamStrength)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.4,
    );

    // 열린 뚜껑 아래로 쏟아지는 빛 기둥.
    if (lidOpen > 0) {
      final beamH = s * 4 * lidOpen;
      final beamRect = Rect.fromLTRB(
        ul.dx + s * 0.2,
        seamC.dy - beamH,
        ur.dx - s * 0.2,
        seamC.dy,
      );
      canvas.drawRect(
        beamRect,
        Paint()
          ..shader = LinearGradient(
            begin: Alignment.bottomCenter,
            end: Alignment.topCenter,
            colors: [
              Colors.white.withValues(alpha: 0.9 * (1 - lidOpen * 0.6)),
              color.withValues(alpha: 0.5 * (1 - lidOpen * 0.6)),
              color.withValues(alpha: 0),
            ],
          ).createShader(beamRect)
          ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 10),
      );
    }

    // 뚜껑(윗면 + 옆면 윗부분).
    canvas.save();
    canvas.translate(lidLift.dx, lidLift.dy);
    final lidLeft = Path()..addPolygon([ul, c, seamC, seamL1], true);
    final lidRight = Path()..addPolygon([c, ur, seamR1, seamC], true);
    final topFace = Path()..addPolygon([t, ur, c, ul], true);
    canvas.drawPath(
      lidLeft,
      Paint()
        ..color = const Color(0xFF29292E).withValues(alpha: opacity * lidAlpha),
    );
    canvas.drawPath(
      lidRight,
      Paint()
        ..color = const Color(0xFF1C1C20).withValues(alpha: opacity * lidAlpha),
    );
    canvas.drawPath(
      topFace,
      Paint()..color = _top.withValues(alpha: opacity * lidAlpha),
    );

    // 모서리 하이라이트.
    final edge = Paint()
      ..color = Colors.white.withValues(alpha: 0.14 * opacity * lidAlpha)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;
    canvas.drawPath(Path()..addPolygon([t, ur, c, ul], true), edge);
    canvas.drawLine(c, seamC, edge);

    // 윗면 각인(브랜드 마크 대신 얇은 사각 테두리).
    final inset = Path()
      ..addPolygon([
        Offset.lerp(t, c, 0.22)!,
        Offset.lerp(ur, ul, 0.22)!,
        Offset.lerp(c, t, 0.22)!,
        Offset.lerp(ul, ur, 0.22)!,
      ], true);
    canvas.drawPath(
      inset,
      Paint()
        ..color = (metallic ? const Color(0xFFF2C14E) : Colors.white)
            .withValues(alpha: (metallic ? 0.35 : 0.08) * opacity * lidAlpha)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1,
    );
    canvas.restore();

    // 몸통 모서리.
    canvas.drawPath(
      Path()
        ..moveTo(ll.dx, ll.dy)
        ..lineTo(b.dx, b.dy)
        ..lineTo(lr.dx, lr.dy),
      Paint()
        ..color = Colors.white.withValues(alpha: 0.06 * opacity)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1,
    );
    canvas.drawLine(
      seamC,
      b,
      Paint()..color = Colors.white.withValues(alpha: 0.08 * opacity),
    );
  }

  @override
  bool shouldRepaint(covariant VaultBoxPainter old) =>
      old.appear != appear ||
      old.crack != crack ||
      old.color != color ||
      old.pulse != pulse ||
      old.lidOpen != lidOpen ||
      old.sheen != sheen ||
      old.metallic != metallic;
}

/// ── 바닥 링 ──────────────────────────────────────────────────────
///
/// 박스 아래 원근 타원 링과 회전 눈금. 등급 빛을 아주 약하게 반사한다.
class FloorRingPainter extends CustomPainter {
  final double rotation;
  final double appear;
  final Color color;

  FloorRingPainter({
    required this.rotation,
    required this.appear,
    required this.color,
  });

  @override
  void paint(Canvas canvas, Size size) {
    if (appear <= 0) return;
    final center = size.center(Offset.zero) + Offset(0, size.height * 0.31);
    final rx = size.width * 0.44 * appear;
    final ry = rx * 0.26;
    final rect = Rect.fromCenter(center: center, width: rx * 2, height: ry * 2);

    canvas.drawOval(
      rect,
      Paint()
        ..color = color.withValues(alpha: 0.35 * appear)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.2,
    );
    canvas.drawOval(
      rect.inflate(10),
      Paint()
        ..color = color.withValues(alpha: 0.12 * appear)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1,
    );

    const ticks = 36;
    for (var i = 0; i < ticks; i++) {
      final a = rotation + i / ticks * 2 * math.pi;
      final front = math.sin(a) > 0; // 앞쪽 눈금만 조금 밝게.
      final p1 =
          center + Offset(math.cos(a) * rx * 0.9, math.sin(a) * ry * 0.9);
      final p2 = center + Offset(math.cos(a) * rx, math.sin(a) * ry);
      canvas.drawLine(
        p1,
        p2,
        Paint()
          ..color = color.withValues(alpha: (front ? 0.55 : 0.2) * appear)
          ..strokeWidth = i % 6 == 0 ? 1.6 : 0.8,
      );
    }
  }

  @override
  bool shouldRepaint(covariant FloorRingPainter old) =>
      old.rotation != rotation || old.appear != appear || old.color != color;
}

class AbsorbParticle {
  final double angle;
  final double startRadius;
  final double delay;
  final double size;
  const AbsorbParticle({
    required this.angle,
    required this.startRadius,
    required this.delay,
    required this.size,
  });
}

/// ── 박스 등장: 주변 빛 입자가 박스로 빨려 든다 ──────────────────────
class AbsorbParticlesPainter extends CustomPainter {
  final double progress;
  final Color color;
  final List<AbsorbParticle> particles;

  AbsorbParticlesPainter({
    required this.progress,
    required this.color,
    required this.particles,
  });

  static List<AbsorbParticle> generate(int count, {int seed = 42}) {
    final rng = math.Random(seed);
    return List.generate(
      count,
      (_) => AbsorbParticle(
        angle: rng.nextDouble() * 2 * math.pi,
        startRadius: 0.6 + rng.nextDouble() * 0.5,
        delay: rng.nextDouble() * 0.5,
        size: 1.2 + rng.nextDouble() * 1.8,
      ),
    );
  }

  @override
  void paint(Canvas canvas, Size size) {
    if (progress <= 0) return;
    final center = size.center(Offset.zero);
    final maxR = size.width * 0.6;
    for (final p in particles) {
      final local = ((progress - p.delay) / (1 - p.delay)).clamp(0.0, 1.0);
      if (local <= 0 || local >= 1) continue;
      final r = maxR * p.startRadius * (1 - Curves.easeIn.transform(local));
      final pos = center + Offset(math.cos(p.angle), math.sin(p.angle)) * r;
      canvas.drawCircle(
        pos,
        p.size,
        Paint()..color = color.withValues(alpha: 0.8 * (1 - local)),
      );
    }
  }

  @override
  bool shouldRepaint(covariant AbsorbParticlesPainter old) =>
      old.progress != progress || old.color != color;
}

class BurstShard {
  final double angle;
  final double speed;
  final double size;
  final double rotSpeed;
  final double whiteMix;
  const BurstShard({
    required this.angle,
    required this.speed,
    required this.size,
    required this.rotSpeed,
    required this.whiteMix,
  });
}

/// ── 개봉: 박스 파편이 사방으로 흩어진다 ───────────────────────────
class BurstShardsPainter extends CustomPainter {
  final double progress;
  final Color color;
  final List<BurstShard> shards;

  BurstShardsPainter({
    required this.progress,
    required this.color,
    required this.shards,
  });

  static List<BurstShard> generate(int count, {int seed = 11}) {
    final rng = math.Random(seed);
    return List.generate(
      count,
      (_) => BurstShard(
        angle: rng.nextDouble() * 2 * math.pi,
        speed: 0.5 + rng.nextDouble() * 0.6,
        size: 3 + rng.nextDouble() * 7,
        rotSpeed: (rng.nextDouble() - 0.5) * 10,
        whiteMix: rng.nextDouble() * 0.6,
      ),
    );
  }

  @override
  void paint(Canvas canvas, Size size) {
    if (progress <= 0 || progress >= 1) return;
    final center = size.center(Offset.zero);
    final maxDist = size.width * 0.8;
    final eased = Curves.easeOutCubic.transform(progress);
    final alpha = (1 - progress).clamp(0.0, 1.0);
    for (final s in shards) {
      final pos =
          center +
          Offset(math.cos(s.angle), math.sin(s.angle)) *
              maxDist *
              s.speed *
              eased;
      canvas.save();
      canvas.translate(pos.dx, pos.dy);
      canvas.rotate(s.rotSpeed * progress);
      final shardColor = Color.lerp(color, Colors.white, s.whiteMix)!;
      canvas.drawPath(
        Path()
          ..moveTo(-s.size / 2, -s.size * 0.8)
          ..lineTo(s.size / 2, 0)
          ..lineTo(-s.size / 3, s.size * 0.8)
          ..close(),
        Paint()..color = shardColor.withValues(alpha: alpha),
      );
      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(covariant BurstShardsPainter old) =>
      old.progress != progress;
}

class GoldLeaf {
  final double startX;
  final double delay;
  final double fallSpeed;
  final double size;
  final double swayFreq;
  final double swayAmp;
  final double rotSpeed;
  final Color color;
  const GoldLeaf({
    required this.startX,
    required this.delay,
    required this.fallSpeed,
    required this.size,
    required this.swayFreq,
    required this.swayAmp,
    required this.rotSpeed,
    required this.color,
  });
}

/// ── SSR 전용: 금박이 천천히 흩날린다 ───────────────────────────────
class GoldLeafPainter extends CustomPainter {
  final double progress;
  final List<GoldLeaf> pieces;

  GoldLeafPainter({required this.progress, required this.pieces});

  static List<GoldLeaf> generate(int count, {int seed = 99}) {
    final rng = math.Random(seed);
    return List.generate(
      count,
      (_) => GoldLeaf(
        startX: rng.nextDouble(),
        delay: rng.nextDouble() * 0.3,
        fallSpeed: 0.55 + rng.nextDouble() * 0.6,
        size: 4 + rng.nextDouble() * 6,
        swayFreq: 1.5 + rng.nextDouble() * 2.5,
        swayAmp: 8 + rng.nextDouble() * 16,
        rotSpeed: (rng.nextDouble() - 0.5) * 10,
        color: kGoldLeafPalette[rng.nextInt(kGoldLeafPalette.length)],
      ),
    );
  }

  @override
  void paint(Canvas canvas, Size size) {
    for (final p in pieces) {
      final local = ((progress - p.delay) / (1 - p.delay)).clamp(0.0, 1.0);
      if (local <= 0) continue;
      final dy = local * p.fallSpeed * (size.height + 60) - 30;
      final sway = math.sin(local * p.swayFreq * math.pi * 2) * p.swayAmp;
      final dx = p.startX * size.width + sway;
      // 회전에 따라 폭이 줄었다 늘었다 — 얇은 금박이 뒤집히는 느낌.
      final flip = math.cos(local * p.rotSpeed).abs().clamp(0.15, 1.0);
      canvas.save();
      canvas.translate(dx, dy);
      canvas.rotate(local * p.rotSpeed * 0.5);
      canvas.drawRect(
        Rect.fromCenter(
          center: Offset.zero,
          width: p.size * flip,
          height: p.size * 0.55,
        ),
        Paint()
          ..color = p.color.withValues(
            alpha: local < 0.75 ? 1.0 : ((1 - local) / 0.25).clamp(0.0, 1.0),
          ),
      );
      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(covariant GoldLeafPainter old) => old.progress != progress;
}

/// ── SR/SSR: 카드 뒤에서 천천히 도는 빛줄기 ──────────────────────────
class LightRaysPainter extends CustomPainter {
  final double rotation;
  final double intensity;
  final Color color;
  final int rays;

  LightRaysPainter({
    required this.rotation,
    required this.intensity,
    required this.color,
    this.rays = 12,
  });

  @override
  void paint(Canvas canvas, Size size) {
    if (intensity <= 0) return;
    final c = size.center(Offset.zero);
    final r = size.longestSide * 0.75;
    final rect = Rect.fromCircle(center: c, radius: r);
    final colors = <Color>[];
    final stops = <double>[];
    for (var i = 0; i < rays; i++) {
      final start = i / rays;
      final mid = start + 0.5 / rays * 0.5;
      final end = start + 1 / rays * 0.5;
      colors.addAll([
        color.withValues(alpha: 0),
        color.withValues(alpha: 0.22 * intensity),
        color.withValues(alpha: 0),
        color.withValues(alpha: 0),
      ]);
      stops.addAll([start, mid, end, (start + 1 / rays).clamp(0.0, 1.0)]);
    }
    // 바깥으로 갈수록 지우는 마스크가 무대 배경까지 지우지 않도록 별도 레이어.
    canvas.saveLayer(rect, Paint());
    canvas.drawCircle(
      c,
      r,
      Paint()
        ..shader = SweepGradient(
          colors: colors,
          stops: stops,
          transform: GradientRotation(rotation),
        ).createShader(rect),
    );
    // 중앙으로 갈수록 밝고, 바깥은 사라지게.
    canvas.drawCircle(
      c,
      r,
      Paint()
        ..shader = RadialGradient(
          colors: [Colors.transparent, Colors.black.withValues(alpha: 0.9)],
          stops: const [0.15, 0.85],
        ).createShader(rect)
        ..blendMode = BlendMode.dstOut,
    );
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant LightRaysPainter old) =>
      old.rotation != rotation ||
      old.intensity != intensity ||
      old.color != color;
}

/// ── SR/SSR 컷인: 대각선 섬광이 화면을 가른다 ────────────────────────
class LightningCutinPainter extends CustomPainter {
  final double progress;
  final Color color;

  LightningCutinPainter({required this.progress, required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    if (progress <= 0 || progress >= 1) return;
    final w = size.width;
    final h = size.height;
    final sweep = (progress * 1.6 - 0.3) * (w + h);

    final paint = Paint()
      ..shader = LinearGradient(
        colors: [
          Colors.transparent,
          Colors.white.withValues(alpha: 0.85),
          color.withValues(alpha: 0.7),
          Colors.transparent,
        ],
        stops: const [0.0, 0.46, 0.54, 1.0],
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
      ).createShader(Rect.fromLTWH(0, 0, w, h));

    canvas.save();
    canvas.translate(sweep - h, 0);
    canvas.drawPath(
      Path()
        ..moveTo(0, h)
        ..lineTo(h * 0.55, 0)
        ..lineTo(h * 0.7, 0)
        ..lineTo(h * 0.15, h)
        ..close(),
      paint,
    );
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant LightningCutinPainter old) =>
      old.progress != progress;
}
