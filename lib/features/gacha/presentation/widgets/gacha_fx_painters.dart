import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../../../core/domain/rarity.dart';
import '../../../../core/theme/rarity_style.dart';

/// 뽑기 연출용 CustomPainter 모음.
///
/// 3차: 무대는 검정이 아니라 등급 색면(슬레이트 → 블루 → 바이올렛 → 금)이고,
/// 빛은 흰색에 가깝게 맑게 그린다. 외부 엔진 없이 Canvas만으로 그린다. 파티클 수는 등급별 상한
/// (RevealTimeline.sparkCount)을 넘지 않고, 모든 위치는 시드 고정 난수 +
/// 시간으로 계산해 프레임마다 객체를 새로 만들지 않는다.

/// 무대 위 빛(빛줄기·입자·충격파) 색. 등급 색면보다 밝다.
Color stageLight(Rarity r) => r.stageLight;

/// 승급 한 단계의 빛 색: 이전 등급 → (흰 섬광) → 새 등급.
/// 보라→금처럼 색상환 반대편으로 갈 때 탁한 중간색이 보이지 않게
/// 흰색을 거쳐 바꾼다.
Color stageStep(Rarity from, Rarity to, double t) {
  if (from == to || t >= 1) return stageLight(to);
  if (t <= 0) return stageLight(from);
  final a = stageLight(from);
  final b = stageLight(to);
  final mid = Color.lerp(Color.lerp(a, b, 0.5), Colors.white, 0.7)!;
  return t < 0.4
      ? Color.lerp(a, mid, t / 0.4)!
      : Color.lerp(mid, b, (t - 0.4) / 0.6)!;
}

/// 승급 한 단계의 무대 색면: 이전 등급 색면 → (밝은 섬광) → 새 등급 색면.
StageField stageFieldStep(Rarity from, Rarity to, double t) {
  if (from == to || t >= 1) return to.field;
  if (t <= 0) return from.field;
  final mid = StageField.lerp(from.field, to.field, 0.5).brighten(0.55);
  return t < 0.4
      ? StageField.lerp(from.field, mid, t / 0.4)
      : StageField.lerp(mid, to.field, (t - 0.4) / 0.6);
}

/// 색면 위 글자색: 금 색면(SSR)은 짙은 갈색, 나머지는 흰색.
Color stageInk(Rarity r) =>
    r == Rarity.ssr ? const Color(0xFF3A2600) : Colors.white;

/// ── 무대 배경 ─────────────────────────────────────────────────────
///
/// 등급 색면(가운데 밝고 가장자리 깊은 방사형) + 위에서 내려오는 흰 빛줄기 +
/// 상자 뒤 후광 + 바닥 반사. 검정이 아니라 채도 높은 색면이라 어둡거나
/// 탁하지 않다. [energy]가 오를수록 가운데가 밝아지고 빛이 넓어진다.
class StageBackdropPainter extends CustomPainter {
  final StageField field;
  final Color color;
  final double energy;
  final double time;

  /// 빛의 중심(세로 비율).
  final double focusY;

  StageBackdropPainter({
    required this.field,
    required this.color,
    required this.energy,
    required this.time,
    this.focusY = 0.45,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final c = Offset(size.width / 2, size.height * focusY);
    final e = energy.clamp(0.0, 1.0);
    canvas.drawRect(
      rect,
      Paint()
        ..shader = RadialGradient(
          center: Alignment(0, focusY * 2 - 1),
          radius: 1.05,
          colors: [
            Color.lerp(field.center, Colors.white, 0.18 * e)!,
            field.mid,
            field.edge,
          ],
          stops: [0, 0.42 + 0.12 * e, 1],
        ).createShader(rect),
    );

    // 위에서 비스듬히 내려오는 흰 빛줄기(블러 대신 늘린 원형 그라데이션).
    for (var i = 0; i < 4; i++) {
      final side = i.isEven ? -1.0 : 1.0;
      final sway = math.sin(time * (0.5 + i * 0.2) + i * 1.7) * 0.06;
      final origin = Offset(
        size.width * (0.5 + side * (0.18 + i * 0.12)),
        -size.height * 0.04,
      );
      final angle = side * (0.22 + sway + i * 0.08);
      final len = size.height * 0.95;
      final w = size.width * (0.1 + 0.05 * i) * (0.8 + 0.5 * e);
      canvas.save();
      canvas.translate(origin.dx, origin.dy);
      canvas.rotate(angle);
      canvas.scale(w / len, 1);
      canvas.drawCircle(
        Offset.zero,
        len,
        Paint()
          ..shader = RadialGradient(
            colors: [
              Colors.white.withValues(alpha: 0.10 + 0.16 * e),
              Colors.white.withValues(alpha: 0.03 + 0.05 * e),
              Colors.transparent,
            ],
            stops: const [0, 0.5, 1],
          ).createShader(Rect.fromCircle(center: Offset.zero, radius: len)),
      );
      canvas.restore();
    }

    // 상자 뒤 후광.
    final bloomR = size.width * (0.42 + 0.45 * e);
    canvas.drawCircle(
      c,
      bloomR,
      Paint()
        ..shader = RadialGradient(
          colors: [
            Color.lerp(
              color,
              Colors.white,
              0.5,
            )!.withValues(alpha: 0.22 + 0.4 * e),
            color.withValues(alpha: 0.10 + 0.12 * e),
            color.withValues(alpha: 0),
          ],
          stops: const [0, 0.45, 1],
        ).createShader(Rect.fromCircle(center: c, radius: bloomR)),
    );

    // 무대 동심원(아주 옅게).
    final ring = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1
      ..color = Colors.white.withValues(alpha: 0.06 + 0.05 * e);
    for (var k = 1; k <= 4; k++) {
      canvas.drawCircle(c, size.width * (0.3 + 0.17 * k), ring);
    }

    final floor = Rect.fromCenter(
      center: Offset(size.width / 2, size.height * (focusY + 0.2)),
      width: size.width * 1.2,
      height: size.height * 0.16,
    );
    canvas.drawOval(
      floor,
      Paint()
        ..shader = RadialGradient(
          colors: [
            Colors.white.withValues(alpha: 0.12 + 0.2 * e),
            Colors.transparent,
          ],
        ).createShader(floor),
    );
  }

  @override
  bool shouldRepaint(covariant StageBackdropPainter old) =>
      old.field != field ||
      old.color != color ||
      old.energy != energy ||
      old.time != time ||
      old.focusY != focusY;
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
      // 블러 대신 넓고 옅은 획 두 겹으로 번짐을 흉내 낸다.
      final glowPaint = Paint()..style = PaintingStyle.stroke;
      canvas.drawCircle(
        c,
        r,
        glowPaint
          ..strokeWidth = (26 * weight) * fade + 2
          ..color = color.withValues(alpha: 0.12 * fade),
      );
      canvas.drawCircle(
        c,
        r,
        glowPaint
          ..strokeWidth = (11 * weight) * fade + 1
          ..color = color.withValues(alpha: 0.22 * fade),
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
    // 레이어(saveLayer) 없이: 가는 삼각형마다 중심에서 멀어질수록 사라지는
    // 원형 그라데이션을 칠한다. 넓고 옅은 띠 + 좁고 밝은 띠 두 겹.
    final shader = RadialGradient(
      colors: [
        Color.lerp(
          color,
          Colors.white,
          0.4,
        )!.withValues(alpha: 0.36 * intensity),
        color.withValues(alpha: 0.14 * intensity),
        color.withValues(alpha: 0),
      ],
      stops: const [0.06, 0.42, 1],
    ).createShader(Rect.fromCircle(center: c, radius: r));
    final wide = Paint()..shader = shader;
    final core = Paint()
      ..shader = RadialGradient(
        colors: [
          Colors.white.withValues(alpha: 0.42 * intensity),
          Colors.white.withValues(alpha: 0.12 * intensity),
          color.withValues(alpha: 0),
        ],
        stops: const [0.04, 0.32, 0.85],
      ).createShader(Rect.fromCircle(center: c, radius: r));
    for (var i = 0; i < rays; i++) {
      final a = rotation + i / rays * 2 * math.pi;
      final half = (i.isEven ? 0.55 : 0.32) * math.pi / rays;
      Path tri(double h) => Path()
        ..moveTo(c.dx, c.dy)
        ..lineTo(c.dx + math.cos(a - h) * r, c.dy + math.sin(a - h) * r)
        ..lineTo(c.dx + math.cos(a + h) * r, c.dy + math.sin(a + h) * r)
        ..close();
      canvas.drawPath(tri(half), wide);
      canvas.drawPath(tri(half * 0.35), core);
    }
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

/// SSR 금박·색종이 팔레트(백색·샴페인·짙은 금 — 금 색면 위에서 보이게,
/// 무지개 아님).
const List<Color> kGoldLeafPalette = [
  Color(0xFFFFFFFF),
  Color(0xFFFFF4D6),
  Color(0xFFFFFFFF),
  Color(0xFFB47A00),
  Color(0xFFFFE08A),
  Color(0xFF8A5A00),
];

/// 흰 바탕(결과 화면) 위 색종이: 금·짙은 금·샴페인·캡슐 레드.
const List<Color> kConfettiOnLight = [
  Color(0xFFF2B01E),
  Color(0xFFB47A00),
  Color(0xFFFFD86B),
  Color(0xFFE32D1A),
  Color(0xFFF7C948),
  Color(0xFF9442FF),
];

/// ── SSR 전용: 금박과 리본 색종이가 흩날린다 ──────────────────────────
class GoldLeafPainter extends CustomPainter {
  final double progress;
  final List<GoldLeaf> pieces;

  GoldLeafPainter({required this.progress, required this.pieces});

  static List<GoldLeaf> generate(
    int count, {
    int seed = 99,
    List<Color> palette = kGoldLeafPalette,
  }) {
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
        color: palette[rng.nextInt(palette.length)],
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
