import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../domain/gacha_grade.dart';

/// 가치가차 - CLOVE 오리파 스타일 가챠 연출용 CustomPainter 모음.
///
/// 외부 무거운 3D 엔진(Three.js 등) 없이, Flutter 표준 `CustomPainter`
/// (dart:ui Canvas)만으로 에너지 구체·마법진·파티클·크랙·번개·폭발
/// 파편·컨페티 효과를 직접 그린다.

/// ── Stage 1~2: 중앙 에너지 구체 (반투명 3D 그라데이션 + 크랙 균열) ──
class EnergyOrbPainter extends CustomPainter {
  /// 0.0~1.0 구체 소환/팽창 진행도.
  final double growth;

  /// 0.0~1.0 크랙(균열) 진행도. 0이면 균열 없음, 1이면 전체 균열+임계.
  final double crackProgress;

  /// 현재 표시할 구체 색상 (등급 승급 보간 결과).
  final Color color;

  /// 구체 표면 펄스(맥동) 스케일 보정값 (1.0 기준 ±).
  final double pulseScale;

  /// 레인보우 셰이더 적용 여부 (SSS 최종 단계).
  final bool rainbow;

  /// 무지개 애니메이션 진행 오프셋 (rainbow=true일 때 사용).
  final double rainbowShift;

  EnergyOrbPainter({
    required this.growth,
    required this.crackProgress,
    required this.color,
    this.pulseScale = 1.0,
    this.rainbow = false,
    this.rainbowShift = 0,
  });

  @override
  void paint(Canvas canvas, Size size) {
    if (growth <= 0) return;
    final center = size.center(Offset.zero);
    final baseRadius = size.width / 2;
    final radius = baseRadius * growth * pulseScale;
    if (radius <= 0) return;

    // 외곽 아우라(글로우) - 여러 겹의 흐릿한 원.
    for (int i = 3; i >= 1; i--) {
      final glowPaint = Paint()
        ..color = color.withValues(alpha: 0.10 * i * growth)
        ..maskFilter = MaskFilter.blur(BlurStyle.normal, 18.0 * i);
      canvas.drawCircle(center, radius * (1 + 0.16 * i), glowPaint);
    }

    // 본체 - 방사형 그라데이션 (레인보우 옵션).
    final Shader coreShader;
    if (rainbow) {
      coreShader = SweepGradient(
        colors: [...kRainbowPalette, kRainbowPalette.first],
        transform: GradientRotation(rainbowShift * 2 * math.pi),
      ).createShader(Rect.fromCircle(center: center, radius: radius));
    } else {
      coreShader = RadialGradient(
        colors: [
          Colors.white.withValues(alpha: 0.95),
          color.withValues(alpha: 0.85),
          color.withValues(alpha: 0.35),
        ],
        stops: const [0.0, 0.55, 1.0],
      ).createShader(Rect.fromCircle(center: center, radius: radius));
    }
    final corePaint = Paint()..shader = coreShader;
    canvas.drawCircle(center, radius, corePaint);

    // 유리질 하이라이트 (좌상단 반사광)
    final highlight = Paint()
      ..color = Colors.white.withValues(alpha: 0.5 * growth)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 10);
    canvas.drawCircle(
      center + Offset(-radius * 0.32, -radius * 0.32),
      radius * 0.22,
      highlight,
    );

    // 크랙(균열) 라인 - crackProgress에 따라 갈라진 선을 점점 더 그린다.
    if (crackProgress > 0) {
      final crackPaint = Paint()
        ..color = Colors.white.withValues(alpha: 0.85)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.2
        ..strokeCap = StrokeCap.round;
      final rng = math.Random(7);
      final crackCount = (crackProgress * 7).clamp(0, 7).floor();
      for (int i = 0; i < crackCount; i++) {
        final angle = (i / 7) * 2 * math.pi + rng.nextDouble() * 0.3;
        final path = Path();
        final start = center + Offset(math.cos(angle), math.sin(angle)) * (radius * 0.15);
        path.moveTo(start.dx, start.dy);
        var current = start;
        var currentAngle = angle;
        final segs = 3;
        for (int s = 1; s <= segs; s++) {
          currentAngle += (rng.nextDouble() - 0.5) * 0.6;
          final dist = radius * (0.15 + 0.28 * s) * crackProgress.clamp(0, 1);
          final next = center + Offset(math.cos(currentAngle), math.sin(currentAngle)) * dist;
          path.lineTo(next.dx, next.dy);
          current = next;
        }
        canvas.drawPath(path, crackPaint);
        // Small branch line
        final branchAngle = currentAngle + (rng.nextDouble() - 0.5) * 1.2;
        final branchEnd = current + Offset(math.cos(branchAngle), math.sin(branchAngle)) * radius * 0.12;
        canvas.drawLine(current, branchEnd, crackPaint..strokeWidth = 1.2);
      }
    }
  }

  @override
  bool shouldRepaint(covariant EnergyOrbPainter oldDelegate) {
    return oldDelegate.growth != growth ||
        oldDelegate.crackProgress != crackProgress ||
        oldDelegate.color != color ||
        oldDelegate.pulseScale != pulseScale ||
        oldDelegate.rainbowShift != rainbowShift;
  }
}

/// ── Stage 1: 하단 마법진 링 (perspective + rotateX 회전 원근 왜곡) ──
class MagicCirclePainter extends CustomPainter {
  /// 링 회전 각도 (라디안, 계속 증가).
  final double rotation;

  /// 0~1 등장 진행도 (스케일/투명도).
  final double appear;

  final Color color;

  MagicCirclePainter({
    required this.rotation,
    required this.appear,
    required this.color,
  });

  @override
  void paint(Canvas canvas, Size size) {
    if (appear <= 0) return;
    final center = size.center(Offset.zero);
    final radiusX = size.width / 2 * appear;
    final radiusY = radiusX * 0.36; // rotateX(65deg) 원근 압축 근사치

    final outerPaint = Paint()
      ..color = color.withValues(alpha: 0.55 * appear)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.4;
    final innerPaint = Paint()
      ..color = Colors.white.withValues(alpha: 0.75 * appear)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.4;

    final rect = Rect.fromCenter(center: center, width: radiusX * 2, height: radiusY * 2);
    canvas.drawOval(rect, outerPaint);
    canvas.drawOval(rect.deflate(6), innerPaint);

    // 회전하는 눈금(마법진 룬 대체) - N개 짧은 방사형 선.
    const tickCount = 24;
    for (int i = 0; i < tickCount; i++) {
      final angle = rotation + (i / tickCount) * 2 * math.pi;
      final cosA = math.cos(angle);
      final sinA = math.sin(angle);
      final p1 = Offset(center.dx + cosA * radiusX * 0.86, center.dy + sinA * radiusY * 0.86);
      final p2 = Offset(center.dx + cosA * radiusX * 1.0, center.dy + sinA * radiusY * 1.0);
      final tickPaint = Paint()
        ..color = (i % 4 == 0 ? Colors.white : color).withValues(alpha: 0.7 * appear)
        ..strokeWidth = i % 4 == 0 ? 2.4 : 1.2;
      canvas.drawLine(p1, p2, tickPaint);
    }

    // 회전 방향 반대의 보조 링 (이중 회전감).
    final rect2 = Rect.fromCenter(center: center, width: radiusX * 1.5, height: radiusY * 1.5);
    final counterPaint = Paint()
      ..color = color.withValues(alpha: 0.28 * appear)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2;
    canvas.save();
    canvas.translate(center.dx, center.dy);
    canvas.rotate(-rotation * 0.6);
    canvas.translate(-center.dx, -center.dy);
    canvas.drawOval(rect2, counterPaint);
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant MagicCirclePainter oldDelegate) {
    return oldDelegate.rotation != rotation ||
        oldDelegate.appear != appear ||
        oldDelegate.color != color;
  }
}

class AbsorbParticle {
  final double angle;
  final double startRadius;
  final double delay;
  final double size;
  final Color color;
  const AbsorbParticle({
    required this.angle,
    required this.startRadius,
    required this.delay,
    required this.size,
    required this.color,
  });
}

/// ── Stage 1: 주변 파티클이 중심으로 흡수되는 효과 ──
class AbsorbParticlesPainter extends CustomPainter {
  final double progress; // 0~1
  final Color color;
  final List<AbsorbParticle> particles;

  AbsorbParticlesPainter({required this.progress, required this.color, required this.particles});

  static List<AbsorbParticle> generate(int count, Color color, {int seed = 42}) {
    final rng = math.Random(seed);
    return List.generate(count, (i) {
      return AbsorbParticle(
        angle: rng.nextDouble() * 2 * math.pi,
        startRadius: 0.65 + rng.nextDouble() * 0.55,
        delay: rng.nextDouble() * 0.5,
        size: 2.5 + rng.nextDouble() * 3.5,
        color: Color.lerp(color, Colors.white, rng.nextDouble() * 0.6)!,
      );
    });
  }

  @override
  void paint(Canvas canvas, Size size) {
    if (progress <= 0) return;
    final center = size.center(Offset.zero);
    final maxR = size.width * 0.62;
    for (final p in particles) {
      final local = ((progress - p.delay) / (1 - p.delay)).clamp(0.0, 1.0);
      if (local <= 0) continue;
      final r = maxR * p.startRadius * (1 - local);
      final pos = center + Offset(math.cos(p.angle), math.sin(p.angle)) * r;
      final alpha = (1 - local * 0.3).clamp(0.0, 1.0);
      final paint = Paint()
        ..color = p.color.withValues(alpha: alpha)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 1.4);
      canvas.drawCircle(pos, p.size * (1 - local * 0.4), paint);
    }
  }

  @override
  bool shouldRepaint(covariant AbsorbParticlesPainter oldDelegate) => oldDelegate.progress != progress;
}

class BurstShard {
  final double angle;
  final double speed;
  final double size;
  final double rotSpeed;
  final Color color;
  const BurstShard({
    required this.angle,
    required this.speed,
    required this.size,
    required this.rotSpeed,
    required this.color,
  });
}

/// ── Stage 4: 구체 폭발 파편 비산 효과 ──
class BurstShardsPainter extends CustomPainter {
  final double progress; // 0~1
  final List<BurstShard> shards;

  BurstShardsPainter({required this.progress, required this.shards});

  static List<BurstShard> generate(int count, Color color, {int seed = 11}) {
    final rng = math.Random(seed);
    return List.generate(count, (i) {
      return BurstShard(
        angle: rng.nextDouble() * 2 * math.pi,
        speed: 0.55 + rng.nextDouble() * 0.55,
        size: 4 + rng.nextDouble() * 10,
        rotSpeed: (rng.nextDouble() - 0.5) * 10,
        color: Color.lerp(color, Colors.white, rng.nextDouble() * 0.5)!,
      );
    });
  }

  @override
  void paint(Canvas canvas, Size size) {
    if (progress <= 0) return;
    final center = size.center(Offset.zero);
    final maxDist = size.width * 0.75;
    for (final s in shards) {
      final dist = maxDist * s.speed * progress;
      final pos = center + Offset(math.cos(s.angle), math.sin(s.angle)) * dist;
      final alpha = (1 - progress).clamp(0.0, 1.0);
      if (alpha <= 0) continue;
      canvas.save();
      canvas.translate(pos.dx, pos.dy);
      canvas.rotate(s.rotSpeed * progress);
      final paint = Paint()..color = s.color.withValues(alpha: alpha);
      final path = Path()
        ..moveTo(-s.size / 2, -s.size)
        ..lineTo(s.size / 2, 0)
        ..lineTo(-s.size / 2, s.size)
        ..close();
      canvas.drawPath(path, paint);
      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(covariant BurstShardsPainter oldDelegate) => oldDelegate.progress != progress;
}

class ConfettiPiece3D {
  final double startX;
  final double delay;
  final double fallSpeed;
  final double size;
  final double swayFreq;
  final double swayAmp;
  final double rotSpeed;
  final Color color;
  const ConfettiPiece3D({
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

/// ── Stage 4 (SSS 전용): 무지개 3D 컨페티 폭발 낙하 ──
class RainbowConfettiPainter extends CustomPainter {
  final double progress; // 0~1 (전체 재생 길이 기준)
  final List<ConfettiPiece3D> pieces;

  RainbowConfettiPainter({required this.progress, required this.pieces});

  static List<ConfettiPiece3D> generate(int count, {int seed = 99}) {
    final rng = math.Random(seed);
    return List.generate(count, (i) {
      return ConfettiPiece3D(
        startX: rng.nextDouble(),
        delay: rng.nextDouble() * 0.25,
        fallSpeed: 0.7 + rng.nextDouble() * 0.6,
        size: 5 + rng.nextDouble() * 7,
        swayFreq: 2 + rng.nextDouble() * 3,
        swayAmp: 10 + rng.nextDouble() * 18,
        rotSpeed: (rng.nextDouble() - 0.5) * 12,
        color: kRainbowPalette[rng.nextInt(kRainbowPalette.length)],
      );
    });
  }

  @override
  void paint(Canvas canvas, Size size) {
    for (final p in pieces) {
      final local = ((progress - p.delay) / (1 - p.delay)).clamp(0.0, 1.0);
      if (local <= 0) continue;
      final dy = local * p.fallSpeed * (size.height + 60) - 30;
      final sway = math.sin(local * p.swayFreq * math.pi * 2) * p.swayAmp;
      final dx = p.startX * size.width + sway;
      final alpha = (1 - local * 0.15).clamp(0.0, 1.0);
      canvas.save();
      canvas.translate(dx, dy);
      canvas.rotate(local * p.rotSpeed);
      final paint = Paint()..color = p.color.withValues(alpha: alpha);
      canvas.drawRect(Rect.fromCenter(center: Offset.zero, width: p.size, height: p.size * 0.45), paint);
      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(covariant RainbowConfettiPainter oldDelegate) => oldDelegate.progress != progress;
}

/// ── Stage 3 (S/SSS 전용): 대각선 번개 섬광 컷인 ──
class LightningCutinPainter extends CustomPainter {
  final double progress; // 0~1, 빠르게 스윕
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
          Colors.white.withValues(alpha: 0.95),
          color.withValues(alpha: 0.85),
          Colors.transparent,
        ],
        stops: const [0.0, 0.45, 0.55, 1.0],
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
      ).createShader(Rect.fromLTWH(0, 0, w, h));

    canvas.save();
    canvas.translate(sweep - h, 0);
    final path = Path()
      ..moveTo(0, h)
      ..lineTo(h * 0.55, 0)
      ..lineTo(h * 0.85, 0)
      ..lineTo(h * 0.3, h)
      ..close();
    canvas.drawPath(path, paint);
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant LightningCutinPainter oldDelegate) => oldDelegate.progress != progress;
}
