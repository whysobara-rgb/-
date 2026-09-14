import 'dart:math' as math;
import 'package:flutter/material.dart';

/// Decorative capsule. Its progress never controls the server result.
class CapsuleShellPainter extends CustomPainter {
  final double opening;
  final Color accent;
  const CapsuleShellPainter({required this.opening, required this.accent});
  @override
  void paint(Canvas canvas, Size size) {
    final center = size.center(Offset.zero);
    final radius = size.shortestSide * 0.34;
    final circle = Rect.fromCircle(center: center, radius: radius);
    canvas.drawOval(
      Rect.fromCenter(
        center: center + Offset(0, radius + 18),
        width: radius * 1.5,
        height: 18,
      ),
      Paint()
        ..color = Colors.black.withValues(alpha: 0.25 * (1 - opening))
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 12),
    );
    for (final upper in [true, false]) {
      canvas.save();
      canvas.translate(0, (upper ? -1 : 1) * opening * radius * 0.95);
      canvas.clipRect(
        Rect.fromLTRB(
          circle.left - 2,
          upper ? circle.top - 2 : center.dy,
          circle.right + 2,
          upper ? center.dy : circle.bottom + 2,
        ),
      );
      canvas.drawCircle(
        center,
        radius,
        Paint()
          ..shader = RadialGradient(
            center: const Alignment(-0.6, -0.7),
            radius: 1.3,
            colors: upper
                ? [const Color(0xFFFFFFFF), accent, const Color(0xFF614580)]
                : [
                    const Color(0xFFFFFFFF),
                    const Color(0xFFF4EFFF),
                    const Color(0xFF9C8AAF),
                  ],
          ).createShader(circle),
      );
      canvas.drawCircle(
        center,
        radius,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.5
          ..color = Colors.white.withValues(alpha: 0.55),
      );
      canvas.drawLine(
        Offset(circle.left, center.dy),
        Offset(circle.right, center.dy),
        Paint()
          ..strokeWidth = 5
          ..color = const Color(0xFF352945),
      );
      if (upper) {
        final gleam = Rect.fromCircle(
          center: center + Offset(-radius * 0.18, -radius * 0.1),
          radius: radius * 0.68,
        );
        canvas.drawArc(
          gleam,
          math.pi * 1.05,
          math.pi * 0.34,
          false,
          Paint()
            ..style = PaintingStyle.stroke
            ..strokeWidth = 6
            ..strokeCap = StrokeCap.round
            ..color = Colors.white.withValues(alpha: 0.7),
        );
      }
      canvas.restore();
    }
    if (opening < 0.25) {
      canvas.drawCircle(center, 16, Paint()..color = const Color(0xFF352945));
      canvas.drawCircle(center, 10, Paint()..color = Colors.white);
      canvas.drawCircle(center, 5, Paint()..color = accent);
    }
  }

  @override
  bool shouldRepaint(covariant CapsuleShellPainter oldDelegate) =>
      opening != oldDelegate.opening || accent != oldDelegate.accent;
}
