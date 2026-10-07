import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../../../core/domain/rarity.dart';
import '../../../../core/theme/app_colors.dart';

/// 뽑기 연출용 CustomPainter 모음.
///
/// 외부 엔진 없이 Canvas만으로 그린다. 파티클 수는 등급별 상한
/// (RevealTimeline.sparkCount)을 넘지 않고, 모든 위치는 시드 고정 난수 +
/// 시간으로 계산해 프레임마다 객체를 새로 만들지 않는다.

/// 어두운 무대 위에서 쓰는 등급 빛 색(셸의 레어도 색보다 밝게).
Color stageLight(Rarity r) => switch (r) {
  Rarity.n => const Color(0xFFE4E8EE),
  Rarity.r => const Color(0xFF6FA6FF),
  Rarity.sr => const Color(0xFFC490FF),
  Rarity.ssr => const Color(0xFFF7CB5C),
};

/// ── 무대 배경 ─────────────────────────────────────────────────────
///
/// 비네팅 + 가장자리에서 새어 드는 빛줄기(light leak) + 바닥 반사.
/// [energy]가 오를수록 빛이 진해지고 넓어진다.
class StageBackdropPainter extends CustomPainter {
  final Color color;
  final double energy;
  final double time;

  StageBackdropPainter({
    required this.color,
    required this.energy,
    required this.time,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final c = Offset(size.width / 2, size.height * 0.46);
    canvas.drawRect(
      rect,
      Paint()
        ..shader = RadialGradient(
          center: const Alignment(0, -0.1),
          radius: 0.95,
          colors: [
            Color.lerp(const Color(0xFF15151A), color, 0.06 + 0.10 * energy)!,
            AppColors.stage,
          ],
        ).createShader(rect),
    );

    final bloomR = size.width * (0.45 + 0.5 * energy);
    canvas.drawCircle(
      c,
      bloomR,
      Paint()
        ..shader = RadialGradient(
          colors: [
            color.withValues(alpha: 0.10 + 0.32 * energy),
            color.withValues(alpha: 0),
          ],
        ).createShader(Rect.fromCircle(center: c, radius: bloomR)),
    );

    // 빛줄기: 위 양쪽 모서리에서 대각선으로 들어오는 부드러운 띠.
    if (energy > 0.02) {
      for (var i = 0; i < 3; i++) {
        final side = i.isEven ? -1.0 : 1.0;
        final sway = math.sin(time * (0.6 + i * 0.25) + i) * 0.08;
        final origin = Offset(
          size.width * (0.5 + side * (0.62 + i * 0.08)),
          -size.height * 0.05,
        );
        final angle = side * (0.5 + sway + i * 0.12);
        final len = size.height * 0.95;
        final w = size.width * (0.16 + 0.08 * i) * (0.7 + 0.5 * energy);
        canvas.save();
        canvas.translate(origin.dx, origin.dy);
        canvas.rotate(angle);
        final beam = Rect.fromLTWH(-w / 2, 0, w, len);
        canvas.drawRect(
          beam,
          Paint()
            ..shader = LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [
                color.withValues(alpha: 0.22 * energy),
                color.withValues(alpha: 0.05 * energy),
                Colors.transparent,
              ],
            ).createShader(beam)
            ..maskFilter = MaskFilter.blur(BlurStyle.normal, w * 0.3),
        );
        canvas.restore();
      }
    }

    final floor = Rect.fromCenter(
      center: Offset(size.width / 2, size.height * 0.64),
      width: size.width * 1.1,
      height: size.height * 0.16,
    );
    canvas.drawOval(
      floor,
      Paint()
        ..shader = RadialGradient(
          colors: [
            color.withValues(alpha: 0.10 + 0.22 * energy),
            Colors.transparent,
          ],
        ).createShader(floor),
    );
  }

  @override
  bool shouldRepaint(covariant StageBackdropPainter old) =>
      old.color != color || old.energy != energy || old.time != time;
}

/// ── 아이소메트릭 박스 ─────────────────────────────────────────────
///
/// 흑연색 상자. 뚜껑 이음새와 균열로 등급 빛이 새어 나온다.
class VaultBoxPainter extends CustomPainter {
  final double appear;
  final double crack;
  final Color color;
  final double pulse;
  final double lidOpen;
  final double intensity;

  VaultBoxPainter({
    required this.appear,
    required this.crack,
    required this.color,
    this.pulse = 1,
    this.lidOpen = 0,
    this.intensity = 1,
  });

  static const _top = Color(0xFF3A3A42);
  static const _left = Color(0xFF26262C);
  static const _right = Color(0xFF18181C);

  @override
  void paint(Canvas canvas, Size size) {
    if (appear <= 0) return;
    final c = size.center(Offset.zero) + const Offset(0, 6);
    final s =
        size.width *
        0.25 *
        pulse *
        (0.6 + 0.4 * Curves.easeOutBack.transform(appear.clamp(0.0, 1.0)));
    final cos30 = math.cos(math.pi / 6);
    final opacity = appear.clamp(0.0, 1.0);

    final t = c + Offset(0, -s);
    final ul = c + Offset(-s * cos30, -s / 2);
    final ur = c + Offset(s * cos30, -s / 2);
    final ll = c + Offset(-s * cos30, s / 2);
    final lr = c + Offset(s * cos30, s / 2);
    final b = c + Offset(0, s);

    canvas.drawOval(
      Rect.fromCenter(
        center: b + Offset(0, s * 0.18),
        width: s * 2.3,
        height: s * 0.42,
      ),
      Paint()
        ..color = Colors.black.withValues(alpha: 0.6 * opacity)
        ..maskFilter = MaskFilter.blur(BlurStyle.normal, s * 0.12),
    );

    final glow = (0.2 + 0.8 * crack) * intensity;
    final glowR = s * (1.6 + 1.1 * crack);
    canvas.drawCircle(
      c,
      glowR,
      Paint()
        ..shader = RadialGradient(
          colors: [
            color.withValues(alpha: (0.45 * glow).clamp(0.0, 0.85) * opacity),
            color.withValues(alpha: 0),
          ],
        ).createShader(Rect.fromCircle(center: c, radius: glowR)),
    );

    final lidLift = Offset(
      0,
      -s * 1.8 * Curves.easeIn.transform(lidOpen.clamp(0.0, 1.0)),
    );
    final lidAlpha = (1 - lidOpen * 1.4).clamp(0.0, 1.0);

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

    const seamT = 0.22;
    final seamL1 = Offset.lerp(ul, ll, seamT)!;
    final seamC = Offset.lerp(c, b, seamT)!;
    final seamR1 = Offset.lerp(ur, lr, seamT)!;

    if (crack > 0) {
      final rng = math.Random(7);
      final count = (crack * 7).ceil().clamp(0, 7);
      for (var i = 0; i < count; i++) {
        final onLeft = i.isEven;
        final a = onLeft ? seamL1 : seamC;
        final bEdge = onLeft ? seamC : seamR1;
        final start = Offset.lerp(a, bEdge, 0.2 + rng.nextDouble() * 0.6)!;
        final path = Path()..moveTo(start.dx, start.dy);
        var p = start;
        const segs = 4;
        final reach = s * 0.95 * (crack * 1.2 - i * 0.11).clamp(0.0, 1.0);
        for (var k = 1; k <= segs; k++) {
          p = p + Offset((rng.nextDouble() - 0.5) * s * 0.24, reach / segs);
          path.lineTo(p.dx, p.dy);
        }
        canvas.save();
        canvas.clipPath(onLeft ? leftFace : rightFace);
        canvas.drawPath(
          path,
          Paint()
            ..color = color.withValues(alpha: 0.65 * opacity)
            ..style = PaintingStyle.stroke
            ..strokeWidth = 7
            ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 5),
        );
        canvas.drawPath(
          path,
          Paint()
            ..color = Color.lerp(
              color,
              Colors.white,
              0.6,
            )!.withValues(alpha: opacity)
            ..style = PaintingStyle.stroke
            ..strokeWidth = 1.6
            ..strokeCap = StrokeCap.round
            ..strokeJoin = StrokeJoin.round,
        );
        canvas.restore();
      }
    }

    final seamPath = Path()
      ..moveTo(seamL1.dx, seamL1.dy)
      ..lineTo(seamC.dx, seamC.dy)
      ..lineTo(seamR1.dx, seamR1.dy);
    final seamStrength = (0.3 + 0.7 * crack) * opacity;
    canvas.drawPath(
      seamPath,
      Paint()
        ..color = color.withValues(alpha: (0.85 * seamStrength).clamp(0.0, 1.0))
        ..style = PaintingStyle.stroke
        ..strokeWidth = 4 + 7 * crack * intensity
        ..maskFilter = MaskFilter.blur(BlurStyle.normal, 4 + 7 * crack),
    );
    canvas.drawPath(
      seamPath,
      Paint()
        ..color = Color.lerp(
          color,
          Colors.white,
          0.55,
        )!.withValues(alpha: seamStrength)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5,
    );

    if (lidOpen > 0) {
      final beamH = s * 4.5 * lidOpen;
      final beamRect = Rect.fromLTRB(
        ul.dx + s * 0.15,
        seamC.dy - beamH,
        ur.dx - s * 0.15,
        seamC.dy,
      );
      canvas.drawRect(
        beamRect,
        Paint()
          ..shader = LinearGradient(
            begin: Alignment.bottomCenter,
            end: Alignment.topCenter,
            colors: [
              Colors.white.withValues(alpha: 0.95 * (1 - lidOpen * 0.6)),
              color.withValues(alpha: 0.55 * (1 - lidOpen * 0.6)),
              color.withValues(alpha: 0),
            ],
          ).createShader(beamRect)
          ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 10),
      );
    }

    canvas.save();
    canvas.translate(lidLift.dx, lidLift.dy);
    final lidLeft = Path()..addPolygon([ul, c, seamC, seamL1], true);
    final lidRight = Path()..addPolygon([c, ur, seamR1, seamC], true);
    final topFace = Path()..addPolygon([t, ur, c, ul], true);
    canvas.drawPath(
      lidLeft,
      Paint()
        ..color = const Color(0xFF2E2E35).withValues(alpha: opacity * lidAlpha),
    );
    canvas.drawPath(
      lidRight,
      Paint()
        ..color = const Color(0xFF1F1F24).withValues(alpha: opacity * lidAlpha),
    );
    canvas.drawPath(
      topFace,
      Paint()..color = _top.withValues(alpha: opacity * lidAlpha),
    );
    final edge = Paint()
      ..color = Colors.white.withValues(alpha: 0.16 * opacity * lidAlpha)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;
    canvas.drawPath(topFace, edge);
    canvas.drawLine(c, seamC, edge);
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
        ..color = color.withValues(alpha: 0.35 * opacity * lidAlpha)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1,
    );
    canvas.restore();

    canvas.drawPath(
      Path()
        ..moveTo(ll.dx, ll.dy)
        ..lineTo(b.dx, b.dy)
        ..lineTo(lr.dx, lr.dy),
      Paint()
        ..color = Colors.white.withValues(alpha: 0.07 * opacity)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1,
    );
  }

  @override
  bool shouldRepaint(covariant VaultBoxPainter old) =>
      old.appear != appear ||
      old.crack != crack ||
      old.color != color ||
      old.pulse != pulse ||
      old.lidOpen != lidOpen ||
      old.intensity != intensity;
}

/// ── 바닥 링 ──────────────────────────────────────────────────────
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
    final center = size.center(Offset.zero) + Offset(0, size.height * 0.30);
    final rx = size.width * 0.44 * appear;
    final ry = rx * 0.26;
    final rect = Rect.fromCenter(center: center, width: rx * 2, height: ry * 2);
    canvas.drawOval(
      rect,
      Paint()
        ..color = color.withValues(alpha: 0.4 * appear)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.2,
    );
    canvas.drawOval(
      rect.inflate(12),
      Paint()
        ..color = color.withValues(alpha: 0.12 * appear)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1,
    );
    const ticks = 48;
    final tick = Paint();
    for (var i = 0; i < ticks; i++) {
      final a = rotation + i / ticks * 2 * math.pi;
      final front = math.sin(a) > 0;
      final p1 =
          center + Offset(math.cos(a) * rx * 0.9, math.sin(a) * ry * 0.9);
      final p2 = center + Offset(math.cos(a) * rx, math.sin(a) * ry);
      tick
        ..color = color.withValues(alpha: (front ? 0.6 : 0.18) * appear)
        ..strokeWidth = i % 6 == 0 ? 1.8 : 0.8;
      canvas.drawLine(p1, p2, tick);
    }
  }

  @override
  bool shouldRepaint(covariant FloorRingPainter old) =>
      old.rotation != rotation || old.appear != appear || old.color != color;
}

/// ── 차지: 주변 빛 입자가 박스로 빨려 든다 ─────────────────────────
///
/// [density] 0~1에 따라 보이는 입자 수가 늘어난다(최대 [maxCount]).
/// [time]은 초 단위 연속 시간.
class ConvergeParticlesPainter extends CustomPainter {
  final double time;
  final double density;
  final Color color;
  final int maxCount;
  final Offset? origin;

  ConvergeParticlesPainter({
    required this.time,
    required this.density,
    required this.color,
    this.maxCount = 90,
    this.origin,
  });

  static final List<(double, double, double, double)> _seeds = () {
    final rng = math.Random(42);
    return List.generate(
      120,
      (_) => (
        rng.nextDouble() * 2 * math.pi,
        rng.nextDouble(),
        0.5 + rng.nextDouble() * 0.9,
        1.1 + rng.nextDouble() * 2.0,
      ),
    );
  }();

  @override
  void paint(Canvas canvas, Size size) {
    if (density <= 0) return;
    final center = origin ?? size.center(Offset.zero);
    final maxR = size.longestSide * 0.62;
    final n = (math.min(maxCount, _seeds.length) * density).round();
    final paint = Paint()..strokeCap = StrokeCap.round;
    final hot = Color.lerp(color, Colors.white, 0.5)!;
    for (var i = 0; i < n; i++) {
      final (angle, phase, speed, sz) = _seeds[i];
      final cycle = (time * speed * (0.6 + density * 0.9) + phase) % 1.0;
      final r = maxR * (1 - Curves.easeIn.transform(cycle));
      final a = angle + cycle * 0.9;
      final dir = Offset(math.cos(a), math.sin(a));
      final pos = center + dir * r;
      final alpha = math.sin(cycle * math.pi).clamp(0.0, 1.0);
      final tail = 8 + 26 * cycle * density;
      paint
        ..color = (i.isEven ? hot : color).withValues(alpha: alpha)
        ..strokeWidth = sz;
      canvas.drawLine(pos, pos + dir * tail, paint);
    }
  }

  @override
  bool shouldRepaint(covariant ConvergeParticlesPainter old) =>
      old.time != time || old.density != density || old.color != color;
}

/// ── 충격파 고리 ───────────────────────────────────────────────────
///
/// [rings]: (진행도 0~1, 굵기 배율) 목록. 진행도에 따라 퍼지며 사라진다.
class ShockwavePainter extends CustomPainter {
  final List<(double, double)> rings;
  final Color color;
  final Offset? origin;
  final double maxRadius;

  ShockwavePainter({
    required this.rings,
    required this.color,
    this.origin,
    this.maxRadius = 0,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final c = origin ?? size.center(Offset.zero);
    final maxR = maxRadius > 0 ? maxRadius : size.longestSide * 0.75;
    for (final (p, weight) in rings) {
      if (p <= 0 || p >= 1) continue;
      final e = Curves.easeOutCubic.transform(p);
      final r = maxR * e;
      final fade = 1 - p;
      canvas.drawCircle(
        c,
        r,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = (18 * weight) * fade + 1
          ..color = color.withValues(alpha: 0.35 * fade)
          ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 8),
      );
      canvas.drawCircle(
        c,
        r,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2.2 * weight * fade + 0.5
          ..color = Color.lerp(
            color,
            Colors.white,
            0.6,
          )!.withValues(alpha: 0.9 * fade),
      );
    }
  }

  @override
  bool shouldRepaint(covariant ShockwavePainter old) => true;
}

/// ── 빛줄기(god rays) ──────────────────────────────────────────────
class LightRaysPainter extends CustomPainter {
  final double rotation;
  final double intensity;
  final Color color;
  final int rays;
  final Offset? origin;

  LightRaysPainter({
    required this.rotation,
    required this.intensity,
    required this.color,
    this.rays = 12,
    this.origin,
  });

  @override
  void paint(Canvas canvas, Size size) {
    if (intensity <= 0) return;
    final c = origin ?? size.center(Offset.zero);
    final r = size.longestSide * 0.8;
    final rect = Rect.fromCircle(center: c, radius: r);
    final colors = <Color>[];
    final stops = <double>[];
    for (var i = 0; i < rays; i++) {
      final start = i / rays;
      final width = (i.isEven ? 0.5 : 0.32) / rays;
      colors.addAll([
        color.withValues(alpha: 0),
        color.withValues(alpha: (i.isEven ? 0.30 : 0.18) * intensity),
        color.withValues(alpha: 0),
        color.withValues(alpha: 0),
      ]);
      stops.addAll([
        start,
        start + width * 0.5,
        start + width,
        (start + 1 / rays).clamp(0.0, 1.0),
      ]);
    }
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
    canvas.drawCircle(
      c,
      r,
      Paint()
        ..shader = RadialGradient(
          colors: [Colors.transparent, Colors.black.withValues(alpha: 0.95)],
          stops: const [0.12, 0.9],
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

/// ── 불꽃 폭발 ─────────────────────────────────────────────────────
///
/// 중심에서 사방으로 튀는 불꽃 줄기. [age]는 폭발 후 경과 초(슬로모션을
/// 반영한 가상 시간). 공기 저항 + 중력으로 감속·낙하한다.
class SparkBurstPainter extends CustomPainter {
  final double age;
  final Color color;
  final int count;
  final Offset? origin;
  final double power;

  SparkBurstPainter({
    required this.age,
    required this.color,
    required this.count,
    this.origin,
    this.power = 1,
  });

  static final List<(double, double, double, double)> _seeds = () {
    final rng = math.Random(11);
    return List.generate(
      120,
      (_) => (
        rng.nextDouble() * 2 * math.pi,
        0.35 + rng.nextDouble() * 0.9,
        rng.nextDouble(),
        0.9 + rng.nextDouble() * 1.6,
      ),
    );
  }();

  @override
  void paint(Canvas canvas, Size size) {
    if (age <= 0 || count <= 0) return;
    final c = origin ?? size.center(Offset.zero);
    final speed0 = size.width * 1.5 * power;
    const drag = 2.6;
    const life = 1.5;
    final gravity = size.height * 0.35;
    final paint = Paint()..strokeCap = StrokeCap.round;
    final n = math.min(count, _seeds.length);
    for (var i = 0; i < n; i++) {
      final (angle, sp, mix, width) = _seeds[i];
      final lifeI = life * (0.6 + mix * 0.6);
      if (age > lifeI) continue;
      final v0 = speed0 * sp;
      final travel = v0 / drag * (1 - math.exp(-drag * age));
      final dir = Offset(math.cos(angle), math.sin(angle));
      final pos = c + dir * travel + Offset(0, 0.5 * gravity * age * age);
      final vNow = v0 * math.exp(-drag * age);
      final tail = (vNow * 0.045).clamp(2.0, 46.0);
      final vel = dir * vNow + Offset(0, gravity * age);
      final back = vel.distance == 0 ? dir : vel / vel.distance;
      final fade = (1 - age / lifeI).clamp(0.0, 1.0);
      paint
        ..strokeWidth = width
        ..color = Color.lerp(
          Colors.white,
          color,
          ((0.25 + mix * 0.75) * (age / lifeI + 0.3)).clamp(0.0, 1.0),
        )!.withValues(alpha: fade);
      canvas.drawLine(pos, pos - back * tail, paint);
    }
  }

  @override
  bool shouldRepaint(covariant SparkBurstPainter old) =>
      old.age != age || old.color != color || old.count != count;
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
  final bool ribbon;
  const GoldLeaf({
    required this.startX,
    required this.delay,
    required this.fallSpeed,
    required this.size,
    required this.swayFreq,
    required this.swayAmp,
    required this.rotSpeed,
    required this.color,
    required this.ribbon,
  });
}

/// SSR 금박·색종이 팔레트(금·샴페인·백색 — 무지개 아님).
const List<Color> kGoldLeafPalette = [
  Color(0xFFF7CB5C),
  Color(0xFFFFE6A6),
  Color(0xFFFFFFFF),
  Color(0xFFD9A43A),
  Color(0xFFFFF4D6),
  Color(0xFFB8862B),
];

/// ── SSR 전용: 금박과 리본 색종이가 흩날린다 ──────────────────────────
class GoldLeafPainter extends CustomPainter {
  final double progress;
  final List<GoldLeaf> pieces;

  GoldLeafPainter({required this.progress, required this.pieces});

  static List<GoldLeaf> generate(int count, {int seed = 99}) {
    final rng = math.Random(seed);
    return List.generate(
      count,
      (i) => GoldLeaf(
        startX: rng.nextDouble(),
        delay: rng.nextDouble() * 0.35,
        fallSpeed: 0.55 + rng.nextDouble() * 0.6,
        size: 4 + rng.nextDouble() * 7,
        swayFreq: 1.2 + rng.nextDouble() * 2.5,
        swayAmp: 8 + rng.nextDouble() * 18,
        rotSpeed: (rng.nextDouble() - 0.5) * 12,
        color: kGoldLeafPalette[rng.nextInt(kGoldLeafPalette.length)],
        ribbon: i % 3 == 0,
      ),
    );
  }

  @override
  void paint(Canvas canvas, Size size) {
    if (progress <= 0) return;
    final paint = Paint();
    for (final p in pieces) {
      final local = ((progress - p.delay) / (1 - p.delay)).clamp(0.0, 1.0);
      if (local <= 0) continue;
      final dy = local * p.fallSpeed * (size.height + 80) - 40;
      final sway = math.sin(local * p.swayFreq * math.pi * 2) * p.swayAmp;
      final dx = p.startX * size.width + sway;
      final flip = math.cos(local * p.rotSpeed).abs().clamp(0.12, 1.0);
      canvas.save();
      canvas.translate(dx, dy);
      canvas.rotate(local * p.rotSpeed * 0.5);
      paint.color = p.color.withValues(
        alpha: local < 0.75 ? 1.0 : ((1 - local) / 0.25).clamp(0.0, 1.0),
      );
      canvas.drawRect(
        Rect.fromCenter(
          center: Offset.zero,
          width: p.size * flip * (p.ribbon ? 0.45 : 1),
          height: p.size * (p.ribbon ? 1.8 : 0.6),
        ),
        paint,
      );
      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(covariant GoldLeafPainter old) => old.progress != progress;
}
