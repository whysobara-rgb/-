import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../core/domain/product_category.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_typography.dart';

/// 박스 패키지 아트.
///
/// 박스 사진이 없을 때(또는 사진을 불러오는 동안) 각 박스를 실제 판매되는
/// 프리미엄 선물 상자처럼 그린다. 정면이 보이는 사선 투영(cabinet projection)
/// 이라 정면 타이포가 똑바로 읽힌다.
///
/// 구성: 박스 고유 색 몸통 + 분류별 패턴 + 굵은 분류 워드마크(BEAUTY, TECH…)
/// + 뚜껑 띠와 리본 + 뚜껑과 몸통에 걸친 포일 봉인 + 유광 하이라이트.
/// 뽑기 연출에서는 같은 그림의 뚜껑이 들리고 이음새로 빛이 샌다.
///
/// 색은 서버 accentColorHex에서, 워드마크·패턴·마감은 박스 분류(iconName)
/// 에서 정한다. 운영자가 색을 바꾸면 패키지 색도 따라간다.

/// 패키지 바탕 무늬.
enum PackMotif {
  sunburst,
  tickets,
  dots,
  waves,
  grid,
  pinstripe,
  quilt,
  facets,
}

/// 봉인 포일의 금속.
enum FoilTone {
  gold,
  silver,
  rose,

  /// 은박 위에 무지개 결.
  holo,
}

extension FoilToneColors on FoilTone {
  /// 대각선 포일 그라데이션(밝음 → 기본 → 그림자 → 반사 → 기본).
  List<Color> get colors => switch (this) {
    FoilTone.gold => const [
      Color(0xFFFFF5CF),
      Color(0xFFF4C54E),
      Color(0xFFB88310),
      Color(0xFFFFE590),
      Color(0xFFDDA428),
    ],
    FoilTone.silver => const [
      Color(0xFFFFFFFF),
      Color(0xFFDDE2E8),
      Color(0xFF9CA5B1),
      Color(0xFFF2F4F7),
      Color(0xFFC4CBD4),
    ],
    FoilTone.rose => const [
      Color(0xFFFFEDE6),
      Color(0xFFF2B19C),
      Color(0xFFB8664F),
      Color(0xFFFFD9CB),
      Color(0xFFE29780),
    ],
    FoilTone.holo => const [
      Color(0xFFFFFFFF),
      Color(0xFFD9E4F2),
      Color(0xFF9AA6B8),
      Color(0xFFF1EBFF),
      Color(0xFFC9D2E0),
    ],
  };

  /// 포일 위 글자·선(눌린 자국).
  Color get ink => switch (this) {
    FoilTone.gold => const Color(0xFF7A5200),
    FoilTone.silver => const Color(0xFF4F5865),
    FoilTone.rose => const Color(0xFF7E3A28),
    FoilTone.holo => const Color(0xFF465166),
  };

  LinearGradient gradient({
    Alignment begin = Alignment.topLeft,
    Alignment end = Alignment.bottomRight,
  }) => LinearGradient(
    begin: begin,
    end: end,
    colors: colors,
    stops: const [0, 0.32, 0.58, 0.8, 1],
  );
}

/// 박스 한 종류의 패키지 디자인.
@immutable
class PackStyle {
  /// 몸통 정면 색.
  final Color body;

  /// 뚜껑 색.
  final Color lid;

  /// 리본 색.
  final Color ribbon;

  /// 워드마크 색. [foilType]이면 무시하고 포일로 칠한다.
  final Color type;

  /// 워드마크를 포일(금박 글자)로.
  final bool foilType;

  /// 패턴 선·점 색(투명도 포함).
  final Color pattern;

  final PackMotif motif;
  final FoilTone foil;

  /// 정면 큰 글자(BEAUTY, TECH…).
  final String word;

  /// 워드마크 위 작은 글자.
  final String kicker;

  /// 장면 배경(밝은 스튜디오 색).
  final Color backdrop;

  const PackStyle({
    required this.body,
    required this.lid,
    required this.ribbon,
    required this.type,
    required this.pattern,
    required this.motif,
    required this.foil,
    required this.word,
    required this.backdrop,
    this.kicker = 'RANDOM BOX',
    this.foilType = false,
  });

  /// 분류·박스 색·배지로 패키지를 고른다.
  ///
  /// 출시 박스 8종(오픈 기념·기프티콘·뷰티·테크·가전·애플·명품·드림)은
  /// 분류가 모두 달라서 서로 다른 SKU처럼 보인다.
  factory PackStyle.of({
    required ProductCategory category,
    Color? accent,
    String? badge,
  }) {
    final a = accent ?? AppColors.brand;
    final hsl = HSLColor.fromColor(a);
    Color tune(double s, double l, [double? hue]) => HSLColor.fromAHSL(
      1,
      hue ?? hsl.hue,
      s.clamp(0.0, 1.0),
      l.clamp(0.0, 1.0),
    ).toColor();
    final neutral = hsl.saturation < 0.12;
    Color backdropOf(Color c) =>
        neutral ? const Color(0xFFEDEFF3) : Color.lerp(Colors.white, c, 0.16)!;

    switch (category) {
      // 기프티콘: 코발트 몸통 + 쿠폰 사선 + 흰 리본 + 은박.
      case ProductCategory.giftCard:
      case ProductCategory.cafe:
        final body = tune(math.max(hsl.saturation, 0.8), 0.56);
        return PackStyle(
          body: body,
          lid: tune(math.max(hsl.saturation, 0.75), 0.36),
          ribbon: const Color(0xFFFDFDFE),
          type: Colors.white,
          pattern: Colors.white.withValues(alpha: 0.13),
          motif: PackMotif.tickets,
          foil: FoilTone.silver,
          word: 'GIFT',
          kicker: 'MOBILE VOUCHER',
          backdrop: backdropOf(body),
        );

      // 뷰티: 로즈 몸통 + 블러시 뚜껑 + 물방울 무늬 + 로즈골드.
      case ProductCategory.beauty:
      case ProductCategory.fragrance:
      case ProductCategory.hair:
        final body = tune(math.max(hsl.saturation, 0.7), 0.62);
        return PackStyle(
          body: body,
          lid: tune(math.max(hsl.saturation, 0.6), 0.86),
          ribbon: tune(0.62, 0.42),
          type: Colors.white,
          pattern: Colors.white.withValues(alpha: 0.24),
          motif: PackMotif.dots,
          foil: FoilTone.rose,
          word: 'BEAUTY',
          kicker: 'SKIN · SCENT · HAIR',
          backdrop: backdropOf(body),
        );

      // 테크: 페트롤 블루 몸통 + 네이비 뚜껑 + 동심원 + 홀로.
      case ProductCategory.audio:
      case ProductCategory.charger:
      case ProductCategory.gadget:
      case ProductCategory.wearable:
        final body = tune(math.max(hsl.saturation, 0.66), 0.46);
        return PackStyle(
          body: body,
          lid: tune(0.62, 0.17),
          ribbon: const Color(0xFF7FF0E2),
          type: Colors.white,
          pattern: Colors.white.withValues(alpha: 0.13),
          motif: PackMotif.waves,
          foil: FoilTone.holo,
          word: 'TECH',
          kicker: 'AUDIO · CHARGE · GEAR',
          backdrop: backdropOf(body),
        );

      // 가전: 세이지 그린 몸통 + 크림 뚜껑 + 타일 격자 + 금박.
      case ProductCategory.appliance:
        final body = tune(math.max(hsl.saturation, 0.38), 0.45);
        return PackStyle(
          body: body,
          lid: const Color(0xFFF4EEDD),
          ribbon: tune(0.42, 0.26),
          type: const Color(0xFFFFFBEF),
          pattern: Colors.white.withValues(alpha: 0.14),
          motif: PackMotif.grid,
          foil: FoilTone.gold,
          word: 'HOME',
          kicker: 'LIVING APPLIANCE',
          backdrop: backdropOf(body),
        );

      // 애플: 그래파이트 몸통 + 핀스트라이프 + 은빛 리본 + 홀로 은박.
      case ProductCategory.phone:
      case ProductCategory.laptop:
      case ProductCategory.tablet:
        return PackStyle(
          body: const Color(0xFF2D3036),
          lid: const Color(0xFF17181C),
          ribbon: const Color(0xFFDDE1E7),
          type: const Color(0xFFF3F5F8),
          pattern: Colors.white.withValues(alpha: 0.07),
          motif: PackMotif.pinstripe,
          foil: FoilTone.holo,
          word: 'PRO',
          kicker: 'PHONE · MAC · WATCH',
          backdrop: neutral
              ? const Color(0xFFE9ECF1)
              : Color.lerp(Colors.white, a, 0.14)!,
        );

      // 명품 잡화: 코냑 가죽 몸통 + 퀼팅 스티치 + 에스프레소 뚜껑 + 금박.
      case ProductCategory.bag:
      case ProductCategory.leather:
      case ProductCategory.fashion:
        final body = tune(math.max(hsl.saturation, 0.52), 0.44, hsl.hue - 10);
        return PackStyle(
          body: body,
          lid: tune(0.36, 0.17, hsl.hue - 8),
          ribbon: tune(0.36, 0.17, hsl.hue - 8),
          type: const Color(0xFFFFF4E2),
          pattern: const Color(0xFF3A2414).withValues(alpha: 0.26),
          motif: PackMotif.quilt,
          foil: FoilTone.gold,
          word: 'LUXE',
          kicker: 'BAG · LEATHER · SCENT',
          backdrop: Color.lerp(Colors.white, body, 0.18)!,
        );

      // 드림: 오닉스 몸통 + 금빛 다이아 패싯 + 금 리본 + 금박 글자.
      case ProductCategory.jewel:
      case ProductCategory.watch:
        final gold = neutral || hsl.hue < 25 || hsl.hue > 60
            ? const Color(0xFFE2B341)
            : tune(0.72, 0.56);
        return PackStyle(
          body: const Color(0xFF16161B),
          lid: const Color(0xFF0B0B0E),
          ribbon: gold,
          type: gold,
          foilType: true,
          pattern: gold.withValues(alpha: 0.2),
          motif: PackMotif.facets,
          foil: FoilTone.gold,
          word: category == ProductCategory.watch ? 'TIME' : 'DREAM',
          kicker: 'THE TOP SHELF',
          backdrop: const Color(0xFFF1ECE2),
        );

      // 기념·기본: 박스 색 몸통 + 선버스트. 금색 계열이면 브랜드 레드 뚜껑으로
      // '그랜드 오픈' 같은 축하 패키지가 된다.
      case ProductCategory.box:
      case ProductCategory.dessert:
      case ProductCategory.food:
        final goldish = !neutral && hsl.hue >= 30 && hsl.hue <= 62;
        final word = _latinWord(badge) ?? 'BOX';
        final body = goldish
            ? tune(0.78, 0.6, 44)
            : tune(math.max(hsl.saturation, 0.7), 0.55);
        return PackStyle(
          body: body,
          lid: goldish ? AppColors.brand : tune(0.7, 0.36),
          ribbon: goldish ? AppColors.brand : Colors.white,
          type: goldish ? AppColors.brandDeep : Colors.white,
          pattern: Colors.white.withValues(alpha: goldish ? 0.28 : 0.16),
          motif: PackMotif.sunburst,
          foil: FoilTone.gold,
          word: word,
          kicker: word == 'OPEN' ? 'GRAND' : 'SURPRISE',
          backdrop: Color.lerp(Colors.white, body, 0.2)!,
        );
    }
  }

  /// 배지에서 워드마크로 쓸 짧은 라틴 단어("OPEN 기념" → OPEN).
  static String? _latinWord(String? badge) {
    if (badge == null) return null;
    final words = RegExp(
      r'[A-Za-z]{2,7}',
    ).allMatches(badge).map((m) => m[0]!.toUpperCase());
    return words.isEmpty ? null : words.first;
  }

  /// 몸통 위 글자를 잉크로 쓸지(밝은 몸통) 흰색으로 쓸지.
  bool get lightBody => body.computeLuminance() > 0.45;

  @override
  bool operator ==(Object other) =>
      other is PackStyle &&
      other.body == body &&
      other.lid == lid &&
      other.ribbon == ribbon &&
      other.type == type &&
      other.foilType == foilType &&
      other.pattern == pattern &&
      other.motif == motif &&
      other.foil == foil &&
      other.word == word &&
      other.kicker == kicker &&
      other.backdrop == backdrop;

  @override
  int get hashCode => Object.hash(
    body,
    lid,
    ribbon,
    type,
    foilType,
    pattern,
    motif,
    foil,
    word,
    kicker,
    backdrop,
  );
}

/// 패키지만 그린다(배경 없음). [lift] 0→1로 뚜껑이 들리고,
/// [seamGlow]만큼 이음새로 [glow] 색 빛이 샌다(뽑기 연출).
class PackArt extends StatelessWidget {
  final PackStyle style;

  /// 정면 폭(짧은 변 대비).
  final double scale;

  /// 상자 중심(가로·세로 비율).
  final Offset center;
  final double lift;
  final double seamGlow;
  final Color? glow;

  /// 봉인 주위 후광(0~1). 연출에서 지금까지 밝혀진 등급 색으로 빛난다.
  final double sealGlow;

  /// 바닥 그림자.
  final bool shadow;

  const PackArt({
    super.key,
    required this.style,
    this.scale = 0.56,
    this.center = const Offset(0.5, 0.52),
    this.lift = 0,
    this.seamGlow = 0,
    this.glow,
    this.sealGlow = 0,
    this.shadow = true,
  });

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: PackPainter(
        style: style,
        scale: scale,
        center: center,
        lift: lift,
        seamGlow: seamGlow,
        glow: glow,
        sealGlow: sealGlow,
        shadow: shadow,
      ),
    );
  }
}

/// 밝은 스튜디오 배경 위의 패키지(카드·헤더·배너 썸네일).
class PackScene extends StatelessWidget {
  final PackStyle style;
  final double scale;
  final double centerY;

  /// 패키지 뒤로 퍼지는 흰 선버스트(상세 헤더·배너).
  final bool rays;

  const PackScene({
    super.key,
    required this.style,
    this.scale = 0.56,
    this.centerY = 0.52,
    this.rays = false,
  });

  @override
  Widget build(BuildContext context) {
    return RepaintBoundary(
      child: CustomPaint(
        painter: _BackdropPainter(
          color: style.backdrop,
          centerY: centerY,
          rays: rays,
        ),
        child: PackArt(
          style: style,
          scale: scale,
          center: Offset(0.5, centerY),
        ),
      ),
    );
  }
}

class _BackdropPainter extends CustomPainter {
  final Color color;
  final double centerY;
  final bool rays;

  _BackdropPainter({
    required this.color,
    required this.centerY,
    required this.rays,
  });

  @override
  void paint(Canvas canvas, Size size) {
    if (size.isEmpty) return;
    final rect = Offset.zero & size;
    final top = Color.lerp(color, Colors.white, 0.45)!;
    final bottom = Color.lerp(color, const Color(0xFF101828), 0.04)!;
    canvas.drawRect(
      rect,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [top, color, bottom],
          stops: const [0, 0.62, 1],
        ).createShader(rect),
    );
    final c = Offset(size.width / 2, size.height * (centerY - 0.04));
    final side = size.shortestSide;
    if (rays) {
      const n = 18;
      final r = size.longestSide * 0.95;
      final paint = Paint()
        ..shader = RadialGradient(
          colors: [
            Colors.white.withValues(alpha: 0.55),
            Colors.white.withValues(alpha: 0.18),
            Colors.white.withValues(alpha: 0),
          ],
          stops: const [0.1, 0.45, 1],
        ).createShader(Rect.fromCircle(center: c, radius: r));
      for (var i = 0; i < n; i++) {
        final a = i / n * 2 * math.pi;
        final h = math.pi / n * 0.42;
        canvas.drawPath(
          Path()
            ..moveTo(c.dx, c.dy)
            ..lineTo(c.dx + math.cos(a - h) * r, c.dy + math.sin(a - h) * r)
            ..lineTo(c.dx + math.cos(a + h) * r, c.dy + math.sin(a + h) * r)
            ..close(),
          paint,
        );
      }
    }
    // 패키지 뒤 스포트라이트.
    final spot = side * 0.62;
    canvas.drawCircle(
      c,
      spot,
      Paint()
        ..shader = RadialGradient(
          colors: [
            Colors.white.withValues(alpha: 0.85),
            Colors.white.withValues(alpha: 0),
          ],
        ).createShader(Rect.fromCircle(center: c, radius: spot)),
    );
  }

  @override
  bool shouldRepaint(covariant _BackdropPainter old) =>
      old.color != color || old.centerY != centerY || old.rays != rays;
}

/// 패키지 그리기.
class PackPainter extends CustomPainter {
  final PackStyle style;
  final double scale;
  final Offset center;
  final double lift;
  final double seamGlow;
  final Color? glow;
  final double sealGlow;
  final bool shadow;

  PackPainter({
    required this.style,
    this.scale = 0.56,
    this.center = const Offset(0.5, 0.52),
    this.lift = 0,
    this.seamGlow = 0,
    this.glow,
    this.sealGlow = 0,
    this.shadow = true,
  });

  static const _shade = Color(0xFF0B0D12);

  @override
  void paint(Canvas canvas, Size size) {
    if (size.isEmpty) return;
    final side = size.shortestSide;
    final w = side * scale;
    final h = w * 0.84;
    final dx = w * 0.2;
    final dy = -w * 0.15;
    final lidH = h * 0.27;
    final ov = w * 0.028;
    final cx = size.width * center.dx;
    final cy = size.height * center.dy;
    final x0 = cx - (w + dx) / 2;
    final y0 = cy - (h - dy) / 2 - dy;
    final liftPx = h * 1.25 * Curves.easeIn.transform(lift.clamp(0.0, 1.0));
    final lidAlpha = (1 - lift * 1.3).clamp(0.0, 1.0);
    final glowColor = glow ?? Colors.white;

    // ── 바닥 그림자(블러 없이 눌린 원형 그라데이션) ──
    if (shadow) {
      final sc = Offset(x0 + (w + dx) / 2, y0 + h + dy * 0.2);
      _ellipseShadow(
        canvas,
        sc,
        (w + dx) * 0.78,
        0.16,
        style.body.withValues(alpha: 0.22),
      );
      _ellipseShadow(
        canvas,
        sc + Offset(0, -w * 0.01),
        (w + dx) * 0.56,
        0.13,
        _shade.withValues(alpha: 0.28),
      );
    }

    final bodyTop = y0 + lidH * 0.3;
    final bodyFront = Rect.fromLTRB(x0, bodyTop, x0 + w, y0 + h);
    final bodySide = Path()
      ..addPolygon([
        Offset(x0 + w, bodyTop),
        Offset(x0 + w + dx, bodyTop + dy),
        Offset(x0 + w + dx, y0 + h + dy),
        Offset(x0 + w, y0 + h),
      ], true);

    // ── 몸통 옆면 ──
    canvas.drawPath(
      bodySide,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            Color.lerp(style.body, _shade, 0.24)!,
            Color.lerp(style.body, _shade, 0.4)!,
          ],
        ).createShader(bodySide.getBounds()),
    );

    // ── 몸통 정면 ──
    canvas.drawRect(bodyFront, Paint()..color = style.body);
    canvas.save();
    canvas.clipRect(bodyFront);
    _paintMotif(canvas, bodyFront, w);
    _paintWordmark(canvas, bodyFront, w, y0 + lidH);
    // 볼륨: 위는 밝게, 아래는 어둡게.
    canvas.drawRect(
      bodyFront,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            Colors.white.withValues(alpha: 0.10),
            Colors.white.withValues(alpha: 0),
            _shade.withValues(alpha: 0.14),
          ],
          stops: const [0, 0.45, 1],
        ).createShader(bodyFront),
    );
    // 유광: 대각선 반사 띠.
    _gloss(canvas, bodyFront, 0.2);
    canvas.restore();
    // 옆면과 만나는 모서리 하이라이트.
    canvas.drawLine(
      Offset(x0 + w, bodyTop),
      Offset(x0 + w, y0 + h),
      Paint()
        ..color = Colors.white.withValues(alpha: 0.22)
        ..strokeWidth = math.max(0.8, w * 0.006),
    );

    // ── 뚜껑이 들리면: 상자 안쪽 + 솟아오르는 빛 ──
    if (lift > 0) {
      final open = Path()
        ..addPolygon([
          Offset(x0, bodyTop),
          Offset(x0 + w, bodyTop),
          Offset(x0 + w + dx, bodyTop + dy),
          Offset(x0 + dx, bodyTop + dy),
        ], true);
      canvas.drawPath(
        open,
        Paint()..color = Color.lerp(style.body, _shade, 0.7)!,
      );
      canvas.drawPath(
        open,
        Paint()
          ..color = Color.lerp(
            glowColor,
            Colors.white,
            0.4,
          )!.withValues(alpha: (0.5 + 0.5 * seamGlow).clamp(0.0, 1.0)),
      );
      final beamH = h * 3.2 * Curves.easeOut.transform(lift.clamp(0.0, 1.0));
      final beam = Rect.fromLTRB(
        x0 + w * 0.04,
        bodyTop + dy * 0.5 - beamH,
        x0 + w + dx - w * 0.04,
        bodyTop + dy * 0.5,
      );
      canvas.drawRect(
        beam,
        Paint()
          ..shader = LinearGradient(
            begin: Alignment.bottomCenter,
            end: Alignment.topCenter,
            colors: [
              Colors.white.withValues(alpha: 0.95 * lidAlpha + 0.2),
              glowColor.withValues(alpha: 0.5 * lidAlpha + 0.1),
              glowColor.withValues(alpha: 0),
            ],
            stops: const [0, 0.35, 1],
          ).createShader(beam),
      );
    }

    // ── 이음새 빛(뚜껑과 몸통 사이) ──
    final seamY = y0 + lidH;
    if (seamGlow > 0) {
      final seam = Path()
        ..moveTo(x0 - ov, seamY)
        ..lineTo(x0 + w + ov, seamY)
        ..lineTo(x0 + w + ov + dx, seamY + dy);
      for (final (width, alpha) in const [
        (16.0, 0.16),
        (8.0, 0.3),
        (3.0, 0.9),
      ]) {
        canvas.drawPath(
          seam,
          Paint()
            ..style = PaintingStyle.stroke
            ..strokeCap = StrokeCap.round
            ..strokeJoin = StrokeJoin.round
            ..strokeWidth = width * (w / 160) * (0.6 + 0.6 * seamGlow)
            ..color =
                (alpha > 0.5
                        ? Color.lerp(glowColor, Colors.white, 0.6)!
                        : glowColor)
                    .withValues(alpha: (alpha * seamGlow).clamp(0.0, 1.0)),
        );
      }
    }

    if (lidAlpha <= 0) return;

    // ── 뚜껑 ──
    canvas.save();
    canvas.translate(0, -liftPx);
    if (lidAlpha < 1) {
      canvas.saveLayer(
        null,
        Paint()..color = Colors.white.withValues(alpha: lidAlpha),
      );
    }
    final lt = y0;
    final lb = y0 + lidH;
    final lidFront = Rect.fromLTRB(x0 - ov, lt, x0 + w + ov, lb);
    final lidSide = Path()
      ..addPolygon([
        Offset(x0 + w + ov, lt),
        Offset(x0 + w + ov + dx, lt + dy),
        Offset(x0 + w + ov + dx, lb + dy),
        Offset(x0 + w + ov, lb),
      ], true);
    final lidTop = Path()
      ..addPolygon([
        Offset(x0 - ov, lt),
        Offset(x0 + w + ov, lt),
        Offset(x0 + w + ov + dx, lt + dy),
        Offset(x0 - ov + dx, lt + dy),
      ], true);

    // 뚜껑 아래 그림자(몸통 위로 드리움).
    if (lift < 0.05) {
      canvas.drawRect(
        Rect.fromLTRB(x0, lb, x0 + w, lb + h * 0.06),
        Paint()
          ..shader = LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              _shade.withValues(alpha: 0.28),
              _shade.withValues(alpha: 0),
            ],
          ).createShader(Rect.fromLTRB(x0, lb, x0 + w, lb + h * 0.06)),
      );
    }

    canvas.drawPath(
      lidSide,
      Paint()..color = Color.lerp(style.lid, _shade, 0.3)!,
    );
    canvas.drawRect(lidFront, Paint()..color = style.lid);
    canvas.drawPath(
      lidTop,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.bottomLeft,
          end: Alignment.topRight,
          colors: [
            Color.lerp(style.lid, Colors.white, 0.1)!,
            Color.lerp(style.lid, Colors.white, 0.26)!,
          ],
        ).createShader(lidTop.getBounds()),
    );

    // 리본: 뚜껑 윗면 십자 + 뚜껑 정면 세로 띠.
    final rw = w * 0.11;
    final mid = x0 + w / 2;
    final ribbonPaint = Paint()..color = style.ribbon;
    final ribbonShade = Paint()
      ..color = Color.lerp(style.ribbon, _shade, 0.22)!;
    canvas.drawPath(
      Path()..addPolygon([
        Offset(mid - rw / 2, lt),
        Offset(mid + rw / 2, lt),
        Offset(mid + rw / 2 + dx, lt + dy),
        Offset(mid - rw / 2 + dx, lt + dy),
      ], true),
      ribbonPaint,
    );
    final across = 0.5;
    canvas.drawPath(
      Path()..addPolygon([
        Offset(x0 - ov + dx * (across - 0.18), lt + dy * (across - 0.18)),
        Offset(x0 + w + ov + dx * (across - 0.18), lt + dy * (across - 0.18)),
        Offset(x0 + w + ov + dx * (across + 0.18), lt + dy * (across + 0.18)),
        Offset(x0 - ov + dx * (across + 0.18), lt + dy * (across + 0.18)),
      ], true),
      ribbonPaint,
    );
    // 옆면으로 넘어가는 가로 띠.
    canvas.drawPath(
      Path()..addPolygon([
        Offset(x0 + w + ov + dx * (across - 0.18), lt + dy * (across - 0.18)),
        Offset(x0 + w + ov + dx * (across + 0.18), lt + dy * (across + 0.18)),
        Offset(x0 + w + ov + dx * (across + 0.18), lb + dy * (across + 0.18)),
        Offset(x0 + w + ov + dx * (across - 0.18), lb + dy * (across - 0.18)),
      ], true),
      ribbonShade,
    );
    canvas.drawRect(
      Rect.fromLTRB(mid - rw / 2, lt, mid + rw / 2, lb),
      ribbonPaint,
    );
    // 리본 결(가는 하이라이트).
    canvas.drawLine(
      Offset(mid - rw * 0.22, lt),
      Offset(mid - rw * 0.22, lb),
      Paint()
        ..color = Colors.white.withValues(alpha: 0.35)
        ..strokeWidth = math.max(0.6, w * 0.006),
    );

    // 뚜껑 정면 글자: 왼쪽 "가치가차".
    final lidInk = style.lid.computeLuminance() > 0.45
        ? const Color(0xFF3A3328)
        : Colors.white.withValues(alpha: 0.86);
    _text(
      canvas,
      '가치가차',
      Offset(x0 + w * 0.07, lt + lidH / 2),
      size: lidH * 0.3,
      color: lidInk,
      weight: FontWeight.w900,
      spacing: -0.4,
      alignCenterY: true,
    );
    _text(
      canvas,
      'RANDOM BOX',
      Offset(x0 + w * 0.93, lt + lidH / 2),
      size: lidH * 0.17,
      color: lidInk.withValues(alpha: 0.72),
      weight: FontWeight.w800,
      spacing: lidH * 0.04,
      alignCenterY: true,
      alignRight: true,
    );

    // 뚜껑 유광 + 윗모서리 하이라이트.
    canvas.save();
    canvas.clipRect(lidFront);
    _gloss(canvas, lidFront, 0.16);
    canvas.restore();
    final edge = Paint()
      ..color = Colors.white.withValues(alpha: 0.5)
      ..strokeWidth = math.max(0.8, w * 0.007);
    canvas.drawLine(Offset(x0 - ov, lt), Offset(x0 + w + ov, lt), edge);
    canvas.drawLine(
      Offset(x0 + w + ov, lt),
      Offset(x0 + w + ov + dx, lt + dy),
      edge..color = Colors.white.withValues(alpha: 0.35),
    );
    // 뚜껑 아랫단 포일 선.
    canvas.drawRect(
      Rect.fromLTRB(x0 - ov, lb - w * 0.012, x0 + w + ov, lb),
      Paint()
        ..shader = style.foil
            .gradient(begin: Alignment.centerLeft, end: Alignment.centerRight)
            .createShader(Rect.fromLTRB(x0 - ov, lb - 2, x0 + w + ov, lb)),
    );

    // ── 포일 봉인: 뚜껑과 몸통에 걸쳐 붙어 있다 ──
    if (sealGlow > 0) {
      final sc = Offset(mid, lb);
      final hr = w * (0.3 + 0.18 * sealGlow);
      canvas.drawCircle(
        sc,
        hr,
        Paint()
          ..shader = RadialGradient(
            colors: [
              Colors.white.withValues(alpha: 0.9 * sealGlow),
              glowColor.withValues(alpha: 0.6 * sealGlow),
              glowColor.withValues(alpha: 0),
            ],
            stops: const [0, 0.35, 1],
          ).createShader(Rect.fromCircle(center: sc, radius: hr)),
      );
    }
    _seal(canvas, Offset(mid, lb), w * 0.125 * (1 + 0.12 * sealGlow));

    if (lidAlpha < 1) canvas.restore();
    canvas.restore();
  }

  void _ellipseShadow(
    Canvas canvas,
    Offset c,
    double rx,
    double squash,
    Color color,
  ) {
    canvas.save();
    canvas.translate(c.dx, c.dy);
    canvas.scale(1, squash);
    canvas.drawCircle(
      Offset.zero,
      rx,
      Paint()
        ..shader = RadialGradient(
          colors: [
            color,
            color.withValues(alpha: color.a * 0.35),
            Colors.transparent,
          ],
          stops: const [0, 0.5, 1],
        ).createShader(Rect.fromCircle(center: Offset.zero, radius: rx)),
    );
    canvas.restore();
  }

  void _gloss(Canvas canvas, Rect r, double strength) {
    canvas.drawRect(
      r,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Colors.white.withValues(alpha: 0),
            Colors.white.withValues(alpha: strength),
            Colors.white.withValues(alpha: 0),
            Colors.white.withValues(alpha: 0),
            Colors.white.withValues(alpha: strength * 0.45),
            Colors.white.withValues(alpha: 0),
          ],
          stops: const [0.12, 0.22, 0.34, 0.6, 0.66, 0.74],
        ).createShader(r),
    );
  }

  void _paintMotif(Canvas canvas, Rect r, double w) {
    final p = Paint()..color = style.pattern;
    switch (style.motif) {
      case PackMotif.sunburst:
        final o = Offset(r.left + r.width * 0.78, r.bottom + r.height * 0.15);
        final rad = r.longestSide * 1.8;
        const n = 22;
        for (var i = 0; i < n; i += 2) {
          final a0 = math.pi + i / n * math.pi;
          final a1 = math.pi + (i + 1) / n * math.pi;
          canvas.drawPath(
            Path()
              ..moveTo(o.dx, o.dy)
              ..lineTo(o.dx + math.cos(a0) * rad, o.dy + math.sin(a0) * rad)
              ..lineTo(o.dx + math.cos(a1) * rad, o.dy + math.sin(a1) * rad)
              ..close(),
            p,
          );
        }
        // 색종이 몇 점.
        final rng = math.Random(5);
        for (var i = 0; i < 9; i++) {
          final c = Offset(
            r.left + rng.nextDouble() * r.width,
            r.top + rng.nextDouble() * r.height * 0.55,
          );
          canvas.save();
          canvas.translate(c.dx, c.dy);
          canvas.rotate(rng.nextDouble() * math.pi);
          canvas.drawRect(
            Rect.fromCenter(
              center: Offset.zero,
              width: w * 0.035,
              height: w * 0.014,
            ),
            Paint()..color = Colors.white.withValues(alpha: 0.6),
          );
          canvas.restore();
        }
      case PackMotif.tickets:
        final step = w * 0.15;
        final stripe = w * 0.06;
        canvas.save();
        canvas.translate(r.left, r.top);
        canvas.rotate(-math.pi / 4);
        for (var x = -r.height * 2; x < r.width * 2; x += step) {
          canvas.drawRect(
            Rect.fromLTWH(x, -r.height * 2, stripe, r.height * 4),
            p,
          );
        }
        canvas.restore();
        // 쿠폰 절취선.
        final y = r.top + r.height * 0.24;
        final dash = Paint()
          ..color = Colors.white.withValues(alpha: 0.5)
          ..strokeWidth = math.max(0.8, w * 0.008);
        for (var x = r.left + w * 0.04; x < r.right; x += w * 0.045) {
          canvas.drawLine(Offset(x, y), Offset(x + w * 0.022, y), dash);
        }
      case PackMotif.dots:
        final step = w * 0.105;
        final rad = w * 0.02;
        var row = 0;
        for (var y = r.top + step * 0.4; y < r.bottom; y += step * 0.86) {
          final off = row.isOdd ? step / 2 : 0.0;
          for (var x = r.left + off; x < r.right + step; x += step) {
            canvas.drawCircle(Offset(x, y), rad, p);
          }
          row++;
        }
      case PackMotif.waves:
        final o = Offset(r.right - w * 0.05, r.bottom - r.height * 0.05);
        final stroke = Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = math.max(0.8, w * 0.012)
          ..color = style.pattern;
        for (var k = 1; k < 16; k++) {
          canvas.drawCircle(o, w * 0.07 * k, stroke);
        }
      case PackMotif.grid:
        final step = w * 0.1;
        final stroke = Paint()
          ..strokeWidth = math.max(0.7, w * 0.007)
          ..color = style.pattern;
        for (var x = r.left + step; x < r.right; x += step) {
          canvas.drawLine(Offset(x, r.top), Offset(x, r.bottom), stroke);
        }
        for (var y = r.top + step * 0.6; y < r.bottom; y += step) {
          canvas.drawLine(Offset(r.left, y), Offset(r.right, y), stroke);
        }
      case PackMotif.pinstripe:
        final step = w * 0.034;
        final stroke = Paint()
          ..strokeWidth = math.max(0.6, w * 0.005)
          ..color = style.pattern;
        for (var x = r.left + step; x < r.right; x += step) {
          canvas.drawLine(Offset(x, r.top), Offset(x, r.bottom), stroke);
        }
      case PackMotif.quilt:
        final step = w * 0.15;
        final stroke = Paint()
          ..strokeWidth = math.max(0.8, w * 0.009)
          ..color = style.pattern;
        final hi = Paint()
          ..strokeWidth = math.max(0.6, w * 0.005)
          ..color = Colors.white.withValues(alpha: 0.14);
        final span = r.width + r.height;
        for (var k = -span; k < span; k += step) {
          // 바느질 점선.
          for (var t = 0.0; t < span; t += w * 0.04) {
            final a = Offset(r.left + k + t, r.top + t);
            final b = Offset(r.left + k + t + w * 0.024, r.top + t + w * 0.024);
            canvas.drawLine(a, b, stroke);
            canvas.drawLine(
              a + const Offset(0, 1.2),
              b + const Offset(0, 1.2),
              hi,
            );
            final c = Offset(r.right - k - t, r.top + t);
            final d = Offset(
              r.right - k - t - w * 0.024,
              r.top + t + w * 0.024,
            );
            canvas.drawLine(c, d, stroke);
            canvas.drawLine(
              c + const Offset(0, 1.2),
              d + const Offset(0, 1.2),
              hi,
            );
          }
        }
      case PackMotif.facets:
        final o = Offset(r.left + r.width * 0.86, r.top - r.height * 0.1);
        final stroke = Paint()
          ..strokeWidth = math.max(0.7, w * 0.006)
          ..color = style.pattern;
        for (var i = 0; i <= 14; i++) {
          final x = r.left - r.width * 0.2 + r.width * 1.4 * i / 14;
          canvas.drawLine(o, Offset(x, r.bottom), stroke);
        }
        for (var i = 1; i < 5; i++) {
          final y = r.top + r.height * (0.2 * i);
          canvas.drawLine(
            Offset(r.left, y),
            Offset(r.right, y + r.height * 0.06),
            stroke,
          );
        }
        _sparkle(
          canvas,
          Offset(r.left + r.width * 0.2, r.top + r.height * 0.24),
          w * 0.05,
        );
        _sparkle(
          canvas,
          Offset(r.left + r.width * 0.84, r.top + r.height * 0.5),
          w * 0.035,
        );
    }
  }

  void _paintWordmark(Canvas canvas, Rect r, double w, double seamY) {
    final pad = w * 0.075;
    final maxW = r.width - pad * 2;
    final word = style.word;
    // 폭에 맞춰 크기를 정한다(짧은 단어는 높이 제한).
    var fs = r.height * 0.42;
    TextPainter make(double size) => TextPainter(
      text: TextSpan(
        text: word,
        style: TextStyle(
          fontFamily: AppText.family,
          fontSize: size,
          fontWeight: FontWeight.w900,
          height: 1,
          letterSpacing: -size * 0.04,
          // foreground와 color는 함께 줄 수 없다(디버그 assert).
          color: style.foilType ? null : style.type,
          foreground: style.foilType
              ? (Paint()
                  ..shader = FoilTone.gold
                      .gradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      )
                      .createShader(
                        Rect.fromLTWH(
                          r.left,
                          r.bottom - size * 1.2,
                          maxW,
                          size,
                        ),
                      ))
              : null,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    var tp = make(fs);
    if (tp.width > maxW) {
      fs = fs * maxW / tp.width;
      tp = make(fs);
    }
    final pos = Offset(
      r.left + pad - fs * 0.02,
      r.bottom - pad * 0.7 - tp.height * 0.92,
    );
    // 아주 옅은 눌림 그림자(박 인쇄 느낌).
    if (!style.foilType) {
      final shadowTp = TextPainter(
        text: TextSpan(
          text: word,
          style: TextStyle(
            fontFamily: AppText.family,
            fontSize: fs,
            fontWeight: FontWeight.w900,
            height: 1,
            letterSpacing: -fs * 0.04,
            color: _shade.withValues(alpha: 0.16),
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      shadowTp.paint(canvas, pos + Offset(0, fs * 0.03));
    }
    tp.paint(canvas, pos);
    // 키커(작은 글자).
    final kickerColor = style.foilType
        ? style.type.withValues(alpha: 0.8)
        : style.type.withValues(alpha: 0.78);
    _text(
      canvas,
      style.kicker,
      Offset(r.left + pad, pos.dy - w * 0.035),
      size: math.max(5.0, w * 0.046),
      color: kickerColor,
      weight: FontWeight.w800,
      spacing: w * 0.012,
      bottom: true,
      maxWidth: maxW,
    );
  }

  void _seal(Canvas canvas, Offset c, double r) {
    // 그림자.
    canvas.drawCircle(
      c + Offset(0, r * 0.12),
      r * 1.08,
      Paint()
        ..shader =
            RadialGradient(
              colors: [
                _shade.withValues(alpha: 0.32),
                _shade.withValues(alpha: 0),
              ],
            ).createShader(
              Rect.fromCircle(
                center: c + Offset(0, r * 0.12),
                radius: r * 1.08,
              ),
            ),
    );
    // 톱니 가장자리.
    const bumps = 22;
    final path = Path();
    for (var i = 0; i <= bumps * 4; i++) {
      final a = i / (bumps * 4) * 2 * math.pi;
      final rr = r * (1 + 0.055 * math.cos(a * bumps));
      final p = c + Offset(math.cos(a), math.sin(a)) * rr;
      if (i == 0) {
        path.moveTo(p.dx, p.dy);
      } else {
        path.lineTo(p.dx, p.dy);
      }
    }
    path.close();
    final rect = Rect.fromCircle(center: c, radius: r);
    canvas.drawPath(
      path,
      Paint()..shader = style.foil.gradient().createShader(rect),
    );
    if (style.foil == FoilTone.holo) {
      canvas.drawPath(
        path,
        Paint()
          ..blendMode = BlendMode.softLight
          ..shader = SweepGradient(
            colors: [...AppColors.holoSpectrum, AppColors.holoSpectrum.first],
          ).createShader(rect),
      );
    }
    final ink = style.foil.ink;
    canvas.drawCircle(
      c,
      r * 0.74,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = math.max(0.7, r * 0.05)
        ..color = ink.withValues(alpha: 0.5),
    );
    // 점선 링.
    final dots = Paint()..color = ink.withValues(alpha: 0.4);
    for (var i = 0; i < 24; i++) {
      final a = i / 24 * 2 * math.pi;
      canvas.drawCircle(
        c + Offset(math.cos(a), math.sin(a)) * r * 0.86,
        r * 0.025,
        dots,
      );
    }
    _text(
      canvas,
      '가',
      c,
      size: r * 0.82,
      color: ink.withValues(alpha: 0.85),
      weight: FontWeight.w900,
      spacing: 0,
      alignCenterY: true,
      alignCenterX: true,
    );
    // 반사 호.
    canvas.drawArc(
      Rect.fromCircle(center: c, radius: r * 0.62),
      math.pi * 1.1,
      math.pi * 0.5,
      false,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeCap = StrokeCap.round
        ..strokeWidth = math.max(0.8, r * 0.08)
        ..color = Colors.white.withValues(alpha: 0.55),
    );
  }

  void _sparkle(Canvas canvas, Offset p, double s) {
    final path = Path()
      ..moveTo(p.dx, p.dy - s)
      ..quadraticBezierTo(p.dx, p.dy, p.dx + s, p.dy)
      ..quadraticBezierTo(p.dx, p.dy, p.dx, p.dy + s)
      ..quadraticBezierTo(p.dx, p.dy, p.dx - s, p.dy)
      ..quadraticBezierTo(p.dx, p.dy, p.dx, p.dy - s);
    canvas.drawPath(
      path,
      Paint()..color = style.ribbon.withValues(alpha: 0.85),
    );
  }

  void _text(
    Canvas canvas,
    String text,
    Offset at, {
    required double size,
    required Color color,
    FontWeight weight = FontWeight.w700,
    double spacing = 0,
    bool alignCenterY = false,
    bool alignCenterX = false,
    bool alignRight = false,
    bool bottom = false,
    double? maxWidth,
  }) {
    TextPainter make(double fontSize, double letterSpacing) => TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(
          fontFamily: AppText.family,
          fontSize: fontSize,
          fontWeight: weight,
          height: 1,
          letterSpacing: letterSpacing,
          color: color,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    var tp = make(size, spacing);
    // 좁은 면(작은 썸네일)에서는 면 밖으로 넘치지 않게 줄인다.
    if (maxWidth != null && tp.width > maxWidth && tp.width > 0) {
      final k = maxWidth / tp.width;
      tp = make(size * k, spacing * k);
    }
    var dx = at.dx;
    var dy = at.dy;
    if (alignCenterX) dx -= tp.width / 2;
    if (alignRight) dx -= tp.width;
    if (alignCenterY) dy -= tp.height / 2;
    if (bottom) dy -= tp.height;
    tp.paint(canvas, Offset(dx, dy));
  }

  @override
  bool shouldRepaint(covariant PackPainter old) =>
      old.style != style ||
      old.scale != scale ||
      old.center != center ||
      old.lift != lift ||
      old.seamGlow != seamGlow ||
      old.glow != glow ||
      old.sealGlow != sealGlow ||
      old.shadow != shadow;
}
