import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../core/domain/product_category.dart';
import 'pack_art.dart';

/// 2차(나이트 볼트) 아트 킷의 호환 층.
///
/// 3차에서 플레이스홀더 그림은 [PackArt](박스 패키지)와 상품 일러스트
/// (product_art.dart)로 바뀌었다. 다른 화면이 쓰는 이름(BoxArt,
/// GuillochePainter)은 생성자 그대로 남겨 두고, BoxArt는 새 패키지를 그린다.
/// 쓰는 곳이 없어진 금고 엠블럼·아이소메트릭 상자·vaultTone은 지웠다.
/// 새 코드에서는 pack_art.dart / product_art.dart를 직접 쓴다.

/// 기요셰(guilloché) 각인: 원 [rings]개를 겹친 로제트. 아주 낮은 불투명도로
/// 바탕 질감만 만든다. 지폐·카드 같은 '증서' 면에만 쓴다.
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

/// 박스 그림. 3차부터 밝은 스튜디오 위의 박스 패키지([PackScene])를 그린다.
/// [tone]은 박스 고유 색, [category]는 패키지 디자인(워드마크·무늬)을 고른다.
class BoxArt extends StatelessWidget {
  final Color tone;
  final ProductCategory category;

  /// 상자 크기(짧은 변 대비, 2차 단위).
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
  Widget build(BuildContext context) => PackScene(
    style: PackStyle.of(category: category, accent: tone),
    scale: (scale * 1.55).clamp(0.3, 0.92),
    centerY: centerY,
  );
}
