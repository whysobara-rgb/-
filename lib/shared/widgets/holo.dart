import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../core/theme/app_colors.dart';

/// SSR 홀로 포일.
///
/// 자식 위에 (1) 천천히 흐르는 무지개 결, (2) 빠르게 지나가는 흰 반사광,
/// (3) 반짝이는 금박 알갱이를 얹는다. 실제 트레이딩 카드의 홀로 포일처럼
/// 빛이 표면을 '지나가는' 느낌만 주고, 면 전체를 무지개로 칠하지 않는다.
///
/// 컨트롤러는 위젯마다 하나(3.6초 반복)이고 [RepaintBoundary]로 감싸
/// 다른 영역을 다시 그리지 않는다. 화면 밖 탭·라우트에서는 TickerMode로 멈춘다.
class HoloFoil extends StatefulWidget {
  final Widget child;
  final BorderRadius borderRadius;

  /// 0~1. 작은 배지는 낮게, 큰 카드는 높게.
  final double intensity;

  /// 기울기(-1~1). 카드 틸트와 연결하면 빛이 기울기를 따라 움직인다.
  final Offset tilt;

  /// false면 정지 상태(테스트·저사양).
  final bool animate;

  final int sparkles;

  const HoloFoil({
    super.key,
    required this.child,
    this.borderRadius = BorderRadius.zero,
    this.intensity = 1,
    this.tilt = Offset.zero,
    this.animate = true,
    this.sparkles = 14,
  });

  @override
  State<HoloFoil> createState() => _HoloFoilState();
}

class _HoloFoilState extends State<HoloFoil>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 3600),
  );

  @override
  void initState() {
    super.initState();
    if (widget.animate) _c.repeat();
  }

  @override
  void didUpdateWidget(covariant HoloFoil oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.animate && !_c.isAnimating) _c.repeat();
    if (!widget.animate && _c.isAnimating) _c.stop();
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return RepaintBoundary(
      child: CustomPaint(
        foregroundPainter: HoloSheenPainter(
          progress: _c,
          intensity: widget.intensity,
          borderRadius: widget.borderRadius,
          tilt: widget.tilt,
          sparkles: widget.sparkles,
        ),
        child: widget.child,
      ),
    );
  }
}

/// 홀로 포일 반사광. [progress]가 0→1로 한 바퀴.
class HoloSheenPainter extends CustomPainter {
  final Animation<double>? progress;
  final double fixedT;
  final double intensity;
  final BorderRadius borderRadius;
  final Offset tilt;
  final int sparkles;

  HoloSheenPainter({
    this.progress,
    this.fixedT = 0.3,
    this.intensity = 1,
    this.borderRadius = BorderRadius.zero,
    this.tilt = Offset.zero,
    this.sparkles = 14,
  }) : super(repaint: progress);

  static final List<(double, double, double, double)> _glitter = () {
    final rng = math.Random(31);
    return List.generate(
      40,
      (_) => (
        rng.nextDouble(),
        rng.nextDouble(),
        rng.nextDouble(),
        0.6 + rng.nextDouble() * 1.2,
      ),
    );
  }();

  @override
  void paint(Canvas canvas, Size size) {
    if (intensity <= 0 || size.isEmpty) return;
    final t = progress?.value ?? fixedT;
    final rect = Offset.zero & size;
    canvas.save();
    canvas.clipRRect(borderRadius.toRRect(rect));

    // (1) 무지개 결: 대각선으로 길게 늘어선 띠가 천천히 흐른다.
    final shift = (t + tilt.dx * 0.25) * 2;
    final spectrum = AppColors.holoSpectrum;
    final colors = <Color>[];
    final stops = <double>[];
    const reps = 2;
    for (var r = 0; r < reps; r++) {
      for (var i = 0; i < spectrum.length; i++) {
        colors.add(spectrum[i].withValues(alpha: 0.16 * intensity));
        stops.add((r * spectrum.length + i) / (reps * spectrum.length - 1));
      }
    }
    canvas.drawRect(
      rect,
      Paint()
        ..blendMode = BlendMode.screen
        ..shader = LinearGradient(
          begin: Alignment(-1.0 + shift, -1.0 + tilt.dy * 0.4),
          end: Alignment(1.0 + shift, 1.0 + tilt.dy * 0.4),
          colors: colors,
          stops: stops,
          tileMode: TileMode.mirror,
        ).createShader(rect),
    );

    // (2) 흰 반사광: 한 바퀴에 한 번 대각선으로 지나간다.
    final sweep = ((t * 1.0) % 1.0) * 3.2 - 1.6 + tilt.dx * 0.6;
    canvas.drawRect(
      rect,
      Paint()
        ..blendMode = BlendMode.plus
        ..shader = LinearGradient(
          begin: Alignment(sweep - 0.6, -1),
          end: Alignment(sweep + 0.6, 1),
          colors: [
            const Color(0x00FFF3D0),
            const Color(0xFFFFF3D0).withValues(alpha: 0.34 * intensity),
            const Color(0x00FFF3D0),
          ],
          stops: const [0.42, 0.5, 0.58],
        ).createShader(rect),
    );

    // (3) 금박 알갱이: 각자 다른 박자로 깜빡인다.
    if (sparkles > 0) {
      final n = math.min(sparkles, _glitter.length);
      final paint = Paint()..blendMode = BlendMode.plus;
      for (var i = 0; i < n; i++) {
        final (gx, gy, phase, r) = _glitter[i];
        final s = math.sin((t * 2 + phase) * math.pi * 2);
        final a = math.pow(math.max(0.0, s), 10).toDouble() * intensity;
        if (a < 0.02) continue;
        final p = Offset(gx * size.width, gy * size.height);
        final rad = r * (size.shortestSide / 120).clamp(0.6, 1.6);
        paint.color = Colors.white.withValues(alpha: a);
        canvas.drawCircle(p, rad, paint);
        // 십자 반짝임.
        paint.color = Colors.white.withValues(alpha: a * 0.6);
        canvas.drawRect(
          Rect.fromCenter(center: p, width: rad * 7, height: 0.7),
          paint,
        );
        canvas.drawRect(
          Rect.fromCenter(center: p, width: 0.7, height: rad * 7),
          paint,
        );
      }
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant HoloSheenPainter old) =>
      old.intensity != intensity ||
      old.tilt != tilt ||
      old.fixedT != fixedT ||
      old.progress != progress;
}
