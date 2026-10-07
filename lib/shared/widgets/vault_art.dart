import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../core/domain/product_category.dart';
import '../../core/domain/rarity.dart';
import '../../core/theme/app_colors.dart';

/// 사진이 없을 때 쓰는 '금고' 일러스트 모음.
///
/// 깨진 이미지 아이콘 대신, 지폐·시계 다이얼의 기요셰 각인 위에 분류 엠블럼을
/// 올린 의도된 플레이스홀더를 그린다. 모두 Canvas + Material 아이콘 글리프로만
/// 그린다(외부 이미지 없음).

/// ── 기요셰(guilloché) 각인 ─────────────────────────────────────────
///
/// 원 [rings]개를 중심 둘레에 겹쳐 그린 로제트. 아주 낮은 불투명도로
/// 바탕 질감만 만든다.
class GuillochePainter extends CustomPainter {
  final Color color;
  final double opacity;
  final int rings;
  final Offset center;

  /// 로제트 반경(짧은 변 대비).
  final double scale;

  const GuillochePainter({
    required this.color,
    this.opacity = 0.09,
    this.rings = 22,
    this.center = const Offset(0.5, 0.5),
    this.scale = 0.42,
  });

  @override
  void paint(Canvas canvas, Size size) {
    if (size.isEmpty) return;
    final c = Offset(size.width * center.dx, size.height * center.dy);
    final side = size.shortestSide;
    final orbit = side * scale * 0.5;
    final r = side * scale * 0.62;
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = side < 120 ? 0.5 : 0.7
      ..color = color.withValues(alpha: opacity);
    for (var i = 0; i < rings; i++) {
      final a = i / rings * 2 * math.pi;
      canvas.drawCircle(c + Offset(math.cos(a), math.sin(a)) * orbit, r, paint);
    }
    // 바깥 동심원 두 줄.
    paint.color = color.withValues(alpha: opacity * 1.3);
    canvas.drawCircle(c, orbit + r + side * 0.03, paint);
    canvas.drawCircle(c, orbit + r + side * 0.05, paint);
  }

  @override
  bool shouldRepaint(covariant GuillochePainter old) =>
      old.color != color ||
      old.opacity != opacity ||
      old.rings != rings ||
      old.center != center ||
      old.scale != scale;
}

/// ── 상품 엠블럼 ───────────────────────────────────────────────────
///
/// 레어도 색 빛 + 기요셰 + 가는 링 안의 분류 아이콘.
class VaultEmblem extends StatelessWidget {
  final ProductCategory category;
  final Rarity? rarity;

  /// 레어도가 없을 때(박스 등) 쓸 색.
  final Color? tone;

  const VaultEmblem({
    super.key,
    required this.category,
    this.rarity,
    this.tone,
  });

  @override
  Widget build(BuildContext context) {
    final color = rarity?.color ?? tone ?? AppColors.rarityN;
    final light = rarity?.light ?? Color.lerp(color, Colors.white, 0.55)!;
    return LayoutBuilder(
      builder: (context, c) {
        final side = c.biggest.shortestSide.isFinite
            ? c.biggest.shortestSide
            : 80.0;
        final small = side < 64;
        return DecoratedBox(
          decoration: BoxDecoration(
            gradient: RadialGradient(
              center: const Alignment(0, -0.25),
              radius: 0.95,
              colors: [
                Color.lerp(AppColors.high, color, 0.30)!,
                Color.lerp(AppColors.surface, color, 0.06)!,
              ],
            ),
          ),
          child: Stack(
            fit: StackFit.expand,
            children: [
              if (!small)
                CustomPaint(
                  painter: GuillochePainter(
                    color: light,
                    opacity: 0.08,
                    rings: side > 160 ? 28 : 20,
                  ),
                ),
              Center(
                child: Container(
                  width: side * (small ? 0.62 : 0.46),
                  height: side * (small ? 0.62 : 0.46),
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: AppColors.canvas.withValues(alpha: 0.55),
                    border: Border.all(
                      color: color.withValues(alpha: small ? 0.35 : 0.5),
                      width: small ? 0.8 : 1,
                    ),
                    boxShadow: small
                        ? null
                        : [
                            BoxShadow(
                              color: color.withValues(alpha: 0.28),
                              blurRadius: side * 0.12,
                            ),
                          ],
                  ),
                  alignment: Alignment.center,
                  child: Icon(
                    category.icon,
                    size: side * (small ? 0.34 : 0.21),
                    color: light,
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

/// ── 박스 아트 ─────────────────────────────────────────────────────
///
/// 박스 사진이 없을 때: 박스 고유 색(서버 accentColorHex)으로 빛나는
/// 흑연색 아이소메트릭 금고 상자. 윗면에 분류 엠블럼이 각인돼 있다.
class BoxArt extends StatelessWidget {
  final Color tone;
  final ProductCategory category;

  /// 0~1 상자 크기(짧은 변 대비).
  final double scale;

  /// 상자 중심의 세로 위치(0=위, 1=아래).
  final double centerY;

  const BoxArt({
    super.key,
    required this.tone,
    required this.category,
    this.scale = 0.36,
    this.centerY = 0.52,
  });

  @override
  Widget build(BuildContext context) {
    final glow = vaultTone(tone);
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: RadialGradient(
          center: Alignment(0, centerY * 2 - 1.25),
          radius: 1.0,
          colors: [
            Color.lerp(AppColors.raised, glow, 0.30)!,
            Color.lerp(AppColors.surface, glow, 0.06)!,
            AppColors.surface,
          ],
          stops: const [0, 0.55, 1],
        ),
      ),
      child: CustomPaint(
        painter: _BoxArtPainter(
          tone: glow,
          category: category,
          scale: scale,
          centerY: centerY,
        ),
      ),
    );
  }
}

/// 서버 색(박스·배너 accentColorHex)을 어두운 바탕에서 빛나 보이게 보정한다.
/// 무채색(#1A1A1A 등)은 플래티넘으로 바꾼다.
Color vaultTone(Color c) {
  final hsl = HSLColor.fromColor(c);
  if (hsl.saturation < 0.12) return const Color(0xFFD5D9E0);
  return hsl
      .withLightness(hsl.lightness.clamp(0.5, 0.64))
      .withSaturation(hsl.saturation.clamp(0.5, 0.88))
      .toColor();
}

class _BoxArtPainter extends CustomPainter {
  final Color tone;
  final ProductCategory category;
  final double scale;
  final double centerY;

  _BoxArtPainter({
    required this.tone,
    required this.category,
    required this.scale,
    required this.centerY,
  });

  @override
  void paint(Canvas canvas, Size size) {
    if (size.isEmpty) return;
    final side = size.shortestSide;
    final c = Offset(size.width / 2, size.height * centerY);

    // 기요셰 바탕.
    GuillochePainter(
      color: tone,
      opacity: 0.055,
      rings: 26,
      center: Offset(0.5, centerY - 0.04),
      scale: 0.78,
    ).paint(canvas, size);

    final s = side * scale * 0.62;
    paintIsoVault(canvas, c, s, tone: tone, glyph: category.icon);
  }

  @override
  bool shouldRepaint(covariant _BoxArtPainter old) =>
      old.tone != tone ||
      old.category != category ||
      old.scale != scale ||
      old.centerY != centerY;
}

/// 아이소메트릭 금고 상자 한 개를 그린다. [s]는 꼭짓점까지 반경.
/// 홈 카드·배너·상세 헤더가 함께 쓴다.
void paintIsoVault(
  Canvas canvas,
  Offset c,
  double s, {
  required Color tone,
  IconData? glyph,
  double seamGlow = 1,
}) {
  final cos30 = math.cos(math.pi / 6);
  final t = c + Offset(0, -s);
  final ul = c + Offset(-s * cos30, -s / 2);
  final ur = c + Offset(s * cos30, -s / 2);
  final ll = c + Offset(-s * cos30, s / 2);
  final lr = c + Offset(s * cos30, s / 2);
  final b = c + Offset(0, s);

  // 바닥 반사광 + 그림자.
  canvas.drawOval(
    Rect.fromCenter(
      center: b + Offset(0, s * 0.16),
      width: s * 2.6,
      height: s * 0.5,
    ),
    Paint()
      ..shader =
          RadialGradient(
            colors: [
              tone.withValues(alpha: 0.32 * seamGlow),
              Colors.transparent,
            ],
          ).createShader(
            Rect.fromCenter(
              center: b + Offset(0, s * 0.16),
              width: s * 2.6,
              height: s * 0.5,
            ),
          ),
  );
  // 블러 없이 눌린 원형 그라데이션으로 그림자.
  canvas.save();
  canvas.translate(b.dx, b.dy + s * 0.1);
  canvas.scale(1, 0.18);
  canvas.drawCircle(
    Offset.zero,
    s * 1.05,
    Paint()
      ..shader = RadialGradient(
        colors: [Colors.black.withValues(alpha: 0.65), Colors.transparent],
      ).createShader(Rect.fromCircle(center: Offset.zero, radius: s * 1.05)),
  );
  canvas.restore();

  // 몸통.
  final leftFace = Path()..addPolygon([ul, c, b, ll], true);
  final rightFace = Path()..addPolygon([c, ur, lr, b], true);
  final topFace = Path()..addPolygon([t, ur, c, ul], true);
  canvas.drawPath(
    leftFace,
    Paint()
      ..shader = LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [const Color(0xFF2B2B31), const Color(0xFF1C1C21)],
      ).createShader(Rect.fromPoints(ul, b)),
  );
  canvas.drawPath(
    rightFace,
    Paint()
      ..shader = LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [const Color(0xFF1E1E23), const Color(0xFF121215)],
      ).createShader(Rect.fromPoints(c, lr)),
  );
  canvas.drawPath(
    topFace,
    Paint()
      ..shader = LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [const Color(0xFF3C3C44), const Color(0xFF2A2A30)],
      ).createShader(Rect.fromPoints(ul, ur + Offset(0, s))),
  );

  // 이음새(뚜껑 선)에서 새어 나오는 빛.
  const seamT = 0.24;
  final sL = Offset.lerp(ul, ll, seamT)!;
  final sC = Offset.lerp(c, b, seamT)!;
  final sR = Offset.lerp(ur, lr, seamT)!;
  final seam = Path()
    ..moveTo(sL.dx, sL.dy)
    ..lineTo(sC.dx, sC.dy)
    ..lineTo(sR.dx, sR.dy);
  canvas.drawPath(
    seam,
    Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = s * 0.09
      ..color = tone.withValues(alpha: 0.55 * seamGlow)
      ..maskFilter = MaskFilter.blur(BlurStyle.normal, s * 0.07),
  );
  canvas.drawPath(
    seam,
    Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = math.max(1.0, s * 0.018)
      ..color = Color.lerp(tone, Colors.white, 0.55)!,
  );

  // 모서리 하이라이트.
  final edge = Paint()
    ..style = PaintingStyle.stroke
    ..strokeWidth = 1
    ..color = Colors.white.withValues(alpha: 0.16);
  canvas.drawPath(topFace, edge);
  canvas.drawLine(c, b, edge..color = Colors.white.withValues(alpha: 0.08));

  // 윗면 각인: 테두리 + 분류 글리프(아이소메트릭 변형).
  final inset = Path()
    ..addPolygon([
      Offset.lerp(t, c, 0.2)!,
      Offset.lerp(ur, ul, 0.2)!,
      Offset.lerp(c, t, 0.2)!,
      Offset.lerp(ul, ur, 0.2)!,
    ], true);
  canvas.drawPath(
    inset,
    Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1
      ..color = tone.withValues(alpha: 0.5),
  );
  if (glyph != null) {
    final topCenter = Offset.lerp(t, c, 0.5)!;
    canvas.save();
    canvas.translate(topCenter.dx, topCenter.dy);
    // 정사각형을 윗면 마름모로: x축 30° 기울임 + 세로 압축.
    final m = Matrix4.identity()
      ..setEntry(0, 0, cos30)
      ..setEntry(0, 1, -cos30)
      ..setEntry(1, 0, 0.5)
      ..setEntry(1, 1, 0.5);
    canvas.transform(m.storage);
    final tp = TextPainter(
      text: TextSpan(
        text: String.fromCharCode(glyph.codePoint),
        style: TextStyle(
          fontFamily: glyph.fontFamily,
          package: glyph.fontPackage,
          fontSize: s * 0.62,
          color: Color.lerp(tone, Colors.white, 0.35)!.withValues(alpha: 0.9),
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    tp.paint(canvas, Offset(-tp.width / 2, -tp.height / 2));
    canvas.restore();
  }
}
