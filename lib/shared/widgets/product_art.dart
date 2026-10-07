import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../core/domain/product_category.dart';
import '../../core/domain/rarity.dart';
import '../../core/theme/app_typography.dart';

/// 상품 사진이 아직 없을 때 쓰는 상품 일러스트.
///
/// "사진 없음" 아이콘이 아니라 커머스 앱의 상품 픽토그램처럼 보이도록,
/// 분류별 물건(시계·가방·폰·이어폰 케이스·향수병…)을 납작한 2.5D로 그린다.
/// 상품권·기프티콘은 상품명에서 사용처와 금액을 읽어 실제 카드처럼 그린다.
///
/// - 물건 본체는 그래파이트·실버·화이트 같은 중립색, 포인트 하나만 레어도 색.
/// - 바탕은 밝은 상품 우물(well) + 바닥 그림자. 실제 사진이 들어오면
///   같은 우물 위에 사진이 놓인다(ProductImage).
/// - 모든 그림은 100단위 좌표계(가운데 원점)에서 그린 뒤 크기에 맞춰 늘린다.
class ProductArt extends StatelessWidget {
  final ProductCategory category;
  final Rarity rarity;

  /// 변형(헤드폰/이어폰, 립/크림…)과 상품권 문구를 고르는 상품명.
  final String? name;

  /// 우물 배경까지 그릴지. false면 물건과 그림자만.
  final bool background;

  const ProductArt({
    super.key,
    required this.category,
    this.rarity = Rarity.n,
    this.name,
    this.background = true,
  });

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: ProductArtPainter(
        category: category,
        rarity: rarity,
        name: name ?? '',
        background: background,
      ),
    );
  }
}

/// 상품권 이름에서 (사용처, 금액)을 뽑는다. "신세계상품권 10만원" → (신세계, 10만원).
(String, String?) parseVoucher(String name) {
  final m = RegExp(r'(\d+(?:[.,]\d+)?)\s*(만|천)?\s*원').firstMatch(name);
  final amount = m == null ? null : '${m[1]}${m[2] ?? ''}원';
  var merchant = m == null ? name : name.replaceRange(m.start, m.end, '');
  for (final w in const ['모바일상품권', '상품권', '기프트카드', 'e카드', '기프티콘']) {
    merchant = merchant.replaceAll(w, '');
  }
  merchant = merchant.replaceAll(RegExp(r'\s+'), ' ').trim();
  return (merchant.isEmpty ? '상품권' : merchant, amount);
}

class ProductArtPainter extends CustomPainter {
  final ProductCategory category;
  final Rarity rarity;
  final String name;
  final bool background;

  ProductArtPainter({
    required this.category,
    required this.rarity,
    required this.name,
    this.background = true,
  });

  // 중립 팔레트.
  static const _graphite = Color(0xFF2A2E36);
  static const _graphiteHi = Color(0xFF474D59);
  static const _silver = Color(0xFFE3E7EC);
  static const _silverLo = Color(0xFFB4BCC7);
  static const _white = Color(0xFFFFFFFF);
  static const _whiteLo = Color(0xFFE4E8EE);
  static const _shade = Color(0xFF0B0D12);

  /// 레어도 포인트 색(물건 위). 흰 바탕에서 또렷하게.
  Color get _hero => switch (rarity) {
    Rarity.n => const Color(0xFF8E98A6),
    Rarity.r => const Color(0xFF3B83FF),
    Rarity.sr => const Color(0xFF9A55FF),
    Rarity.ssr => const Color(0xFFE5A92C),
  };

  Color get _heroLight => Color.lerp(_hero, Colors.white, 0.5)!;
  Color get _heroDeep => Color.lerp(_hero, _shade, 0.32)!;

  bool _has(List<String> words) {
    final lower = name.toLowerCase();
    return words.any(lower.contains);
  }

  @override
  void paint(Canvas canvas, Size size) {
    if (size.isEmpty) return;
    final rect = Offset.zero & size;
    if (background) _paintWell(canvas, rect);
    final u = size.shortestSide * (size.shortestSide < 70 ? 0.7 : 0.6);
    final c = Offset(size.width / 2, size.height * 0.5);
    // 바닥 그림자.
    _floor(canvas, c + Offset(0, u * 0.47), u * 0.44);
    canvas.save();
    canvas.translate(c.dx, c.dy);
    canvas.scale(u / 100);
    _paintObject(canvas);
    canvas.restore();
  }

  void _paintWell(Canvas canvas, Rect rect) {
    final tint = switch (rarity) {
      Rarity.n => const Color(0xFFEFF1F4),
      Rarity.r => const Color(0xFFE6EEFC),
      Rarity.sr => const Color(0xFFEFE8FC),
      Rarity.ssr => const Color(0xFFFBF1D8),
    };
    canvas.drawRect(
      rect,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [const Color(0xFFFBFBFC), tint],
        ).createShader(rect),
    );
    final c = rect.center + Offset(0, -rect.height * 0.04);
    final r = rect.shortestSide * 0.55;
    canvas.drawCircle(
      c,
      r,
      Paint()
        ..shader = RadialGradient(
          colors: [Colors.white, Colors.white.withValues(alpha: 0)],
        ).createShader(Rect.fromCircle(center: c, radius: r)),
    );
  }

  void _floor(Canvas canvas, Offset c, double rx) {
    canvas.save();
    canvas.translate(c.dx, c.dy);
    canvas.scale(1, 0.16);
    canvas.drawCircle(
      Offset.zero,
      rx,
      Paint()
        ..shader = RadialGradient(
          colors: [
            _shade.withValues(alpha: 0.22),
            _shade.withValues(alpha: 0.06),
            _shade.withValues(alpha: 0),
          ],
          stops: const [0, 0.55, 1],
        ).createShader(Rect.fromCircle(center: Offset.zero, radius: rx)),
    );
    canvas.restore();
  }

  // ── 그리기 도구 ────────────────────────────────────────────

  Paint _grad(
    Rect r,
    List<Color> colors, {
    Alignment begin = Alignment.topLeft,
    Alignment end = Alignment.bottomRight,
    List<double>? stops,
  }) => Paint()
    ..shader = LinearGradient(
      begin: begin,
      end: end,
      colors: colors,
      stops: stops,
    ).createShader(r);

  Paint _metal(Rect r, Color base) => _grad(
    r,
    [
      Color.lerp(base, Colors.white, 0.55)!,
      base,
      Color.lerp(base, _shade, 0.22)!,
      Color.lerp(base, Colors.white, 0.3)!,
    ],
    stops: const [0, 0.4, 0.75, 1],
  );

  void _rrect(Canvas canvas, Rect r, double radius, Paint paint) => canvas
      .drawRRect(RRect.fromRectAndRadius(r, Radius.circular(radius)), paint);

  Paint _stroke(Color color, double width) => Paint()
    ..style = PaintingStyle.stroke
    ..strokeWidth = width
    ..strokeCap = StrokeCap.round
    ..strokeJoin = StrokeJoin.round
    ..color = color;

  /// 위쪽 가장자리의 가는 반사광.
  void _rim(Canvas canvas, Rect r, double radius, [double alpha = 0.55]) {
    canvas.save();
    canvas.clipRRect(RRect.fromRectAndRadius(r, Radius.circular(radius)));
    canvas.drawRRect(
      RRect.fromRectAndRadius(r.deflate(0.9), Radius.circular(radius)),
      _stroke(Colors.white.withValues(alpha: alpha), 1.4),
    );
    canvas.restore();
  }

  /// 대각선 유광 띠.
  void _sheen(Canvas canvas, Path clip, Rect r, [double alpha = 0.32]) {
    canvas.save();
    canvas.clipPath(clip);
    canvas.drawRect(
      r,
      _grad(
        r,
        [
          Colors.white.withValues(alpha: 0),
          Colors.white.withValues(alpha: alpha),
          Colors.white.withValues(alpha: 0),
        ],
        stops: const [0.2, 0.32, 0.46],
      ),
    );
    canvas.restore();
  }

  void _label(
    Canvas canvas,
    String text,
    Offset at, {
    required double size,
    required Color color,
    FontWeight weight = FontWeight.w800,
    double spacing = -0.3,
    TextAlign align = TextAlign.left,
    double? maxWidth,
  }) {
    final tp = TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(
          fontFamily: AppText.family,
          fontSize: size,
          fontWeight: weight,
          height: 1,
          letterSpacing: spacing,
          color: color,
        ),
      ),
      textDirection: TextDirection.ltr,
      maxLines: 1,
      ellipsis: '…',
    )..layout(maxWidth: maxWidth ?? double.infinity);
    final dx = switch (align) {
      TextAlign.right => at.dx - tp.width,
      TextAlign.center => at.dx - tp.width / 2,
      _ => at.dx,
    };
    tp.paint(canvas, Offset(dx, at.dy - tp.height / 2));
  }

  // ── 분류별 물건 ────────────────────────────────────────────

  void _paintObject(Canvas canvas) {
    switch (category) {
      case ProductCategory.watch:
        _watch(canvas);
      case ProductCategory.bag:
        _bag(canvas);
      case ProductCategory.leather:
        _cardCase(canvas);
      case ProductCategory.phone:
        _phone(canvas);
      case ProductCategory.laptop:
        _laptop(canvas);
      case ProductCategory.tablet:
        _tablet(canvas);
      case ProductCategory.audio:
        _has(['맥스', '헤드폰', 'max']) ? _headphones(canvas) : _earbudsCase(canvas);
      case ProductCategory.wearable:
        _smartwatch(canvas);
      case ProductCategory.charger:
        _has(['맥세이프'])
            ? _puck(canvas)
            : _has(['케이블', '홀더'])
            ? _cable(canvas)
            : _charger(canvas);
      case ProductCategory.gadget:
        _has(['에어태그'])
            ? _tag(canvas)
            : _has(['필름'])
            ? _glass(canvas)
            : _mouse(canvas);
      case ProductCategory.appliance:
        _has(['청소기'])
            ? _vacuum(canvas)
            : _has(['토스터'])
            ? _toaster(canvas)
            : _has(['선풍기'])
            ? _fan(canvas)
            : _has(['가습기'])
            ? _humidifier(canvas)
            : _has(['칫솔', '면도기'])
            ? _slimDevice(canvas)
            : _fryer(canvas);
      case ProductCategory.hair:
        _styler(canvas);
      case ProductCategory.beauty:
        _has(['립'])
            ? _lipstick(canvas)
            : _has(['크림', '밤', '튜브'])
            ? _tube(canvas)
            : _jar(canvas);
      case ProductCategory.fragrance:
        _perfume(canvas);
      case ProductCategory.fashion:
        _has(['캡', '모자']) ? _cap(canvas) : _tee(canvas);
      case ProductCategory.giftCard:
        _voucher(canvas);
      case ProductCategory.cafe:
        _cup(canvas);
      case ProductCategory.dessert:
        _iceCream(canvas);
      case ProductCategory.food:
        _bowl(canvas);
      case ProductCategory.jewel:
        _diamond(canvas);
      case ProductCategory.box:
        _giftBox(canvas);
    }
  }

  void _watch(Canvas canvas) {
    // 브레이슬릿.
    for (final top in [true, false]) {
      final r = top
          ? const Rect.fromLTRB(-15, -50, 15, -18)
          : const Rect.fromLTRB(-15, 18, 15, 50);
      _rrect(canvas, r, 4, _metal(r, rarity == Rarity.ssr ? _hero : _silverLo));
      for (var y = r.top + 6; y < r.bottom - 2; y += 7) {
        canvas.drawLine(
          Offset(r.left + 1, y),
          Offset(r.right - 1, y),
          _stroke(_shade.withValues(alpha: 0.14), 0.8),
        );
      }
      canvas.drawLine(
        Offset(r.left + 10, r.top),
        Offset(r.left + 10, r.bottom),
        _stroke(_shade.withValues(alpha: 0.1), 0.8),
      );
      canvas.drawLine(
        Offset(r.right - 10, r.top),
        Offset(r.right - 10, r.bottom),
        _stroke(_shade.withValues(alpha: 0.1), 0.8),
      );
    }
    // 용두.
    _rrect(
      canvas,
      const Rect.fromLTRB(26, -5, 33, 5),
      2,
      _metal(const Rect.fromLTRB(26, -5, 33, 5), _silverLo),
    );
    // 케이스.
    final caseR = Rect.fromCircle(center: Offset.zero, radius: 29);
    canvas.drawCircle(
      Offset.zero,
      29,
      _metal(caseR, rarity == Rarity.ssr ? _hero : _silver),
    );
    // 베젤.
    canvas.drawCircle(
      Offset.zero,
      25,
      Paint()..color = rarity == Rarity.n ? _graphite : _heroDeep,
    );
    for (var i = 0; i < 60; i += 5) {
      final a = i / 60 * 2 * math.pi;
      final dir = Offset(math.cos(a), math.sin(a));
      canvas.drawLine(
        dir * 21.5,
        dir * 24,
        _stroke(Colors.white.withValues(alpha: 0.8), i % 15 == 0 ? 1.6 : 0.9),
      );
    }
    // 다이얼.
    canvas.drawCircle(
      Offset.zero,
      20,
      _grad(Rect.fromCircle(center: Offset.zero, radius: 20), [
        const Color(0xFF263042),
        const Color(0xFF0F141E),
      ]),
    );
    for (var i = 0; i < 12; i++) {
      final a = i / 12 * 2 * math.pi;
      final p = Offset(math.cos(a), math.sin(a)) * 16;
      canvas.drawCircle(
        p,
        i % 3 == 0 ? 1.8 : 1.2,
        Paint()..color = const Color(0xFFF5F2E6),
      );
    }
    // 바늘.
    canvas.drawLine(
      Offset.zero,
      const Offset(-7, -9),
      _stroke(const Color(0xFFF5F2E6), 2.4),
    );
    canvas.drawLine(
      Offset.zero,
      const Offset(11, -8),
      _stroke(const Color(0xFFF5F2E6), 1.6),
    );
    canvas.drawLine(
      const Offset(-3, 4),
      const Offset(5, -15),
      _stroke(_heroLight, 0.9),
    );
    canvas.drawCircle(Offset.zero, 1.6, Paint()..color = _white);
    // 날짜창.
    _rrect(
      canvas,
      const Rect.fromLTRB(9, -2.5, 15, 2.5),
      0.8,
      Paint()..color = _white,
    );
    // 크리스털 반사.
    canvas.drawArc(
      Rect.fromCircle(center: Offset.zero, radius: 17),
      math.pi * 1.1,
      math.pi * 0.45,
      false,
      _stroke(Colors.white.withValues(alpha: 0.32), 2.2),
    );
  }

  void _bag(Canvas canvas) {
    final leather = rarity == Rarity.n ? const Color(0xFF6F7682) : _graphite;
    // 체인 손잡이.
    final chain = Path()
      ..moveTo(-26, -6)
      ..cubicTo(-26, -52, 26, -52, 26, -6);
    canvas.drawPath(
      chain,
      _stroke(rarity == Rarity.ssr ? _hero : _silverLo, 3.2),
    );
    canvas.drawPath(chain, _stroke(Colors.white.withValues(alpha: 0.5), 1));
    // 몸통.
    const body = Rect.fromLTRB(-40, -8, 40, 40);
    _rrect(
      canvas,
      body,
      9,
      _grad(body, [
        Color.lerp(leather, Colors.white, 0.16)!,
        leather,
        Color.lerp(leather, _shade, 0.3)!,
      ]),
    );
    // 플랩(퀼팅).
    final flap = Path()
      ..moveTo(-40, -2)
      ..quadraticBezierTo(-40, -8, -32, -8)
      ..lineTo(32, -8)
      ..quadraticBezierTo(40, -8, 40, -2)
      ..lineTo(40, 16)
      ..quadraticBezierTo(0, 30, -40, 16)
      ..close();
    canvas.drawPath(
      flap,
      _grad(body, [
        Color.lerp(leather, Colors.white, 0.24)!,
        Color.lerp(leather, Colors.white, 0.06)!,
      ]),
    );
    canvas.save();
    canvas.clipPath(flap);
    final q = _stroke(Colors.white.withValues(alpha: 0.16), 0.9);
    for (var k = -90.0; k < 90; k += 13) {
      canvas.drawLine(Offset(k, -10), Offset(k + 40, 30), q);
      canvas.drawLine(Offset(k + 40, -10), Offset(k, 30), q);
    }
    canvas.restore();
    // 잠금 장식.
    const clasp = Rect.fromLTRB(-8, 17, 8, 27);
    _rrect(
      canvas,
      clasp,
      3,
      _metal(clasp, rarity == Rarity.n ? _silver : _hero),
    );
    _rim(canvas, body, 9, 0.35);
    _sheen(
      canvas,
      Path()..addRRect(RRect.fromRectAndRadius(body, const Radius.circular(9))),
      body,
      0.16,
    );
  }

  void _cardCase(Canvas canvas) {
    final leather = rarity == Rarity.n
        ? const Color(0xFF7A828E)
        : Color.lerp(_hero, _shade, 0.45)!;
    canvas.save();
    canvas.rotate(-0.08);
    const r = Rect.fromLTRB(-42, -27, 42, 27);
    _rrect(
      canvas,
      r,
      7,
      _grad(r, [
        Color.lerp(leather, Colors.white, 0.2)!,
        leather,
        Color.lerp(leather, _shade, 0.25)!,
      ]),
    );
    // 카드 슬롯.
    final slot = Path()
      ..moveTo(-34, -12)
      ..quadraticBezierTo(0, -3, 34, -12);
    canvas.drawPath(slot, _stroke(_shade.withValues(alpha: 0.35), 1.6));
    canvas.drawPath(
      slot.shift(const Offset(0, 1.4)),
      _stroke(Colors.white.withValues(alpha: 0.18), 1),
    );
    // 스티치.
    final stitch = RRect.fromRectAndRadius(
      r.deflate(4),
      const Radius.circular(4),
    );
    final metrics = (Path()..addRRect(stitch)).computeMetrics();
    final dash = _stroke(Colors.white.withValues(alpha: 0.4), 0.9);
    for (final m in metrics) {
      for (var d = 0.0; d < m.length; d += 4) {
        canvas.drawPath(m.extractPath(d, d + 2), dash);
      }
    }
    // 로고 플레이트.
    const plate = Rect.fromLTRB(-9, 6, 9, 14);
    _rrect(
      canvas,
      plate,
      1.5,
      _metal(plate, rarity == Rarity.n ? _silver : const Color(0xFFE5C27A)),
    );
    _sheen(
      canvas,
      Path()..addRRect(RRect.fromRectAndRadius(r, const Radius.circular(7))),
      r,
      0.14,
    );
    canvas.restore();
  }

  void _screen(Canvas canvas, Rect r, double radius) {
    _rrect(
      canvas,
      r,
      radius,
      _grad(r, [_heroLight, _hero, _heroDeep], stops: const [0, 0.5, 1]),
    );
    canvas.save();
    canvas.clipRRect(RRect.fromRectAndRadius(r, Radius.circular(radius)));
    // 배경화면 물결.
    final w = Path()
      ..moveTo(r.left, r.center.dy + r.height * 0.1)
      ..cubicTo(
        r.left + r.width * 0.3,
        r.center.dy - r.height * 0.15,
        r.left + r.width * 0.7,
        r.center.dy + r.height * 0.3,
        r.right,
        r.center.dy,
      )
      ..lineTo(r.right, r.bottom)
      ..lineTo(r.left, r.bottom)
      ..close();
    canvas.drawPath(w, Paint()..color = _heroDeep.withValues(alpha: 0.35));
    canvas.drawRect(
      r,
      _grad(
        r,
        [
          Colors.white.withValues(alpha: 0.28),
          Colors.white.withValues(alpha: 0),
        ],
        begin: Alignment.topLeft,
        end: Alignment.center,
      ),
    );
    canvas.restore();
  }

  void _phone(Canvas canvas) {
    const r = Rect.fromLTRB(-25, -48, 25, 48);
    _rrect(canvas, r, 11, _grad(r, [_graphiteHi, _graphite]));
    _rrect(
      canvas,
      r.deflate(1),
      10,
      _stroke(_silverLo.withValues(alpha: 0.7), 1),
    );
    _screen(canvas, const Rect.fromLTRB(-22, -45, 22, 45), 8.5);
    _rrect(
      canvas,
      const Rect.fromLTRB(-8, -41, 8, -36.5),
      2.3,
      Paint()..color = const Color(0xFF07080A),
    );
    _label(
      canvas,
      '9:41',
      const Offset(0, -24),
      size: 10,
      color: Colors.white,
      align: TextAlign.center,
      weight: FontWeight.w700,
    );
    // 측면 버튼.
    _rrect(
      canvas,
      const Rect.fromLTRB(25, -26, 27, -12),
      1,
      Paint()..color = _graphiteHi,
    );
    _rrect(
      canvas,
      const Rect.fromLTRB(-27, -30, -25, -22),
      1,
      Paint()..color = _graphiteHi,
    );
  }

  void _laptop(Canvas canvas) {
    const lid = Rect.fromLTRB(-44, -38, 44, 18);
    _rrect(canvas, lid, 5, Paint()..color = _graphite);
    _screen(canvas, const Rect.fromLTRB(-40.5, -34.5, 40.5, 14.5), 2.5);
    _rrect(
      canvas,
      const Rect.fromLTRB(-4, -38, 4, -35.5),
      1,
      Paint()..color = const Color(0xFF07080A),
    );
    final base = Path()
      ..moveTo(-50, 18)
      ..lineTo(50, 18)
      ..lineTo(48, 25)
      ..quadraticBezierTo(47, 27, 44, 27)
      ..lineTo(-44, 27)
      ..quadraticBezierTo(-47, 27, -48, 25)
      ..close();
    canvas.drawPath(
      base,
      _metal(const Rect.fromLTRB(-50, 18, 50, 27), _silver),
    );
    _rrect(
      canvas,
      const Rect.fromLTRB(-9, 18, 9, 20.5),
      1.2,
      Paint()..color = _silverLo,
    );
  }

  void _tablet(Canvas canvas) {
    const r = Rect.fromLTRB(-35, -46, 35, 46);
    _rrect(canvas, r, 8, _metal(r, _silver));
    _rrect(canvas, r.deflate(3.5), 5, Paint()..color = _graphite);
    _screen(canvas, r.deflate(5.5), 4);
    canvas.drawCircle(const Offset(0, -43.5), 0.9, Paint()..color = _graphite);
  }

  void _headphones(Canvas canvas) {
    final band = Path()
      ..moveTo(-34, 4)
      ..cubicTo(-36, -50, 36, -50, 34, 4);
    canvas.drawPath(band, _stroke(_silverLo, 7));
    canvas.drawPath(band, _stroke(_silver, 4.4));
    final canopy = Path()
      ..moveTo(-26, -14)
      ..cubicTo(-26, -42, 26, -42, 26, -14);
    canvas.drawPath(canopy, _stroke(_graphite.withValues(alpha: 0.85), 5));
    for (final sx in [-1.0, 1.0]) {
      final cup = Rect.fromLTRB(sx < 0 ? -46 : 24, -4, sx < 0 ? -24 : 46, 38);
      _rrect(canvas, cup, 9, _metal(cup, rarity == Rarity.n ? _silver : _hero));
      final cushion = Rect.fromLTRB(
        sx < 0 ? -26 : 20,
        -1,
        sx < 0 ? -20 : 26,
        35,
      );
      _rrect(canvas, cushion, 3, Paint()..color = _graphiteHi);
      _rim(canvas, cup, 9, 0.5);
    }
  }

  void _earbudsCase(Canvas canvas) {
    const r = Rect.fromLTRB(-32, -30, 32, 30);
    _rrect(
      canvas,
      r,
      19,
      _grad(r, [_white, const Color(0xFFF2F4F7), _whiteLo]),
    );
    _rrect(canvas, r, 19, _stroke(_silverLo.withValues(alpha: 0.6), 0.8));
    canvas.drawLine(
      const Offset(-31.5, -9),
      const Offset(31.5, -9),
      _stroke(_silverLo, 0.9),
    );
    canvas.drawLine(
      const Offset(-31, -7.8),
      const Offset(31, -7.8),
      _stroke(Colors.white, 0.8),
    );
    canvas.drawCircle(const Offset(0, 6), 1.8, Paint()..color = _hero);
    canvas.drawCircle(
      const Offset(0, 6),
      3.6,
      Paint()..color = _hero.withValues(alpha: 0.18),
    );
    _sheen(
      canvas,
      Path()..addRRect(RRect.fromRectAndRadius(r, const Radius.circular(19))),
      r,
      0.5,
    );
    // 힌지.
    _rrect(
      canvas,
      const Rect.fromLTRB(-6, -31, 6, -28.5),
      1,
      Paint()..color = _silverLo,
    );
  }

  void _smartwatch(Canvas canvas) {
    for (final r in const [
      Rect.fromLTRB(-16, -50, 16, -20),
      Rect.fromLTRB(-16, 20, 16, 50),
    ]) {
      _rrect(canvas, r, 6, _grad(r, [_heroLight, _hero]));
    }
    _rrect(
      canvas,
      const Rect.fromLTRB(24, -9, 29, 2),
      2,
      _metal(const Rect.fromLTRB(24, -9, 29, 2), _silverLo),
    );
    const c = Rect.fromLTRB(-25, -29, 25, 29);
    _rrect(canvas, c, 12, _metal(c, _silverLo));
    _rrect(
      canvas,
      c.deflate(2.5),
      10,
      Paint()..color = const Color(0xFF07080A),
    );
    for (final (rad, col) in [
      (17.0, _hero),
      (12.5, _heroLight),
      (8.0, Colors.white),
    ]) {
      canvas.drawCircle(
        Offset.zero,
        rad,
        _stroke(col.withValues(alpha: 0.22), 3.4),
      );
      canvas.drawArc(
        Rect.fromCircle(center: Offset.zero, radius: rad),
        -math.pi / 2,
        math.pi * (rad / 12),
        false,
        _stroke(col, 3.4),
      );
    }
  }

  void _charger(Canvas canvas) {
    final cable = Path()
      ..moveTo(0, 22)
      ..cubicTo(0, 44, -38, 30, -30, 8)
      ..cubicTo(-24, -10, -44, -20, -40, -38);
    canvas.drawPath(cable, _stroke(_silverLo, 4.4));
    canvas.drawPath(cable, _stroke(_white, 2.6));
    _rrect(
      canvas,
      const Rect.fromLTRB(-43, -46, -37, -36),
      2,
      Paint()..color = _hero,
    );
    const r = Rect.fromLTRB(-20, -28, 22, 22);
    _rrect(canvas, r, 9, _grad(r, [_white, _whiteLo]));
    _rrect(canvas, r, 9, _stroke(_silverLo.withValues(alpha: 0.6), 0.8));
    _rrect(
      canvas,
      const Rect.fromLTRB(-7, -6, 9, -1),
      2.5,
      Paint()..color = _graphite,
    );
    _label(
      canvas,
      '30W',
      const Offset(1, 10),
      size: 7,
      color: _hero,
      align: TextAlign.center,
      weight: FontWeight.w900,
    );
    _sheen(
      canvas,
      Path()..addRRect(RRect.fromRectAndRadius(r, const Radius.circular(9))),
      r,
      0.45,
    );
  }

  void _puck(Canvas canvas) {
    final cable = Path()
      ..moveTo(0, 10)
      ..cubicTo(10, 40, 46, 30, 44, 50);
    canvas.drawPath(cable, _stroke(_silverLo, 3.6));
    canvas.drawPath(cable, _stroke(_white, 2));
    canvas.drawCircle(
      Offset.zero,
      30,
      _metal(Rect.fromCircle(center: Offset.zero, radius: 30), _silver),
    );
    canvas.drawCircle(Offset.zero, 25, Paint()..color = _white);
    canvas.drawCircle(
      Offset.zero,
      25,
      _stroke(_silverLo.withValues(alpha: 0.6), 0.8),
    );
    canvas.drawCircle(Offset.zero, 10, _stroke(_hero, 2.4));
    canvas.drawCircle(Offset.zero, 3, Paint()..color = _hero);
  }

  void _cable(Canvas canvas) {
    // 느슨하게 감긴 케이블 + 양 끝 커넥터.
    final coil = Path()..moveTo(-30, 30);
    for (var i = 0; i < 3; i++) {
      final r = 26.0 - i * 4;
      coil.addArc(
        Rect.fromCircle(center: Offset(i * 3.0, -4.0 + i * 2), radius: r),
        math.pi * 0.75,
        math.pi * 1.9,
      );
    }
    canvas.drawPath(coil, _stroke(_silverLo, 4.2));
    canvas.drawPath(coil, _stroke(_white, 2.4));
    final tailA = Path()
      ..moveTo(-18, 14)
      ..quadraticBezierTo(-30, 30, -38, 36);
    final tailB = Path()
      ..moveTo(22, 12)
      ..quadraticBezierTo(30, 30, 40, 34);
    for (final t in [tailA, tailB]) {
      canvas.drawPath(t, _stroke(_silverLo, 4.2));
      canvas.drawPath(t, _stroke(_white, 2.4));
    }
    canvas.save();
    canvas.translate(-40, 37);
    canvas.rotate(0.6);
    _rrect(
      canvas,
      const Rect.fromLTRB(-6, -3.5, 6, 3.5),
      2,
      Paint()..color = _hero,
    );
    canvas.restore();
    canvas.save();
    canvas.translate(42, 35);
    canvas.rotate(-0.3);
    _rrect(
      canvas,
      const Rect.fromLTRB(-6, -3.5, 6, 3.5),
      2,
      _metal(const Rect.fromLTRB(-6, -3.5, 6, 3.5), _silver),
    );
    canvas.restore();
  }

  void _tag(Canvas canvas) {
    canvas.drawCircle(
      Offset.zero,
      30,
      _grad(Rect.fromCircle(center: Offset.zero, radius: 30), [
        _white,
        _whiteLo,
      ]),
    );
    canvas.drawCircle(
      Offset.zero,
      30,
      _stroke(_silverLo.withValues(alpha: 0.7), 0.8),
    );
    canvas.drawCircle(
      const Offset(0, 4),
      22,
      _metal(Rect.fromCircle(center: const Offset(0, 4), radius: 22), _silver),
    );
    canvas.drawCircle(const Offset(0, 4), 6, _stroke(_hero, 2));
    _sheen(
      canvas,
      Path()..addOval(Rect.fromCircle(center: Offset.zero, radius: 30)),
      const Rect.fromLTRB(-30, -30, 30, 30),
      0.5,
    );
  }

  void _glass(Canvas canvas) {
    for (var i = 1; i >= 0; i--) {
      canvas.save();
      canvas.translate(i * 9.0, i * -6.0);
      canvas.rotate(-0.12 + i * 0.1);
      const r = Rect.fromLTRB(-23, -44, 23, 44);
      _rrect(
        canvas,
        r,
        9,
        Paint()..color = _hero.withValues(alpha: 0.10 + 0.06 * (1 - i)),
      );
      _rrect(canvas, r, 9, _stroke(_hero.withValues(alpha: 0.55), 1.2));
      _rrect(
        canvas,
        const Rect.fromLTRB(-6, -40, 6, -36),
        2,
        Paint()..color = _hero.withValues(alpha: 0.35),
      );
      _sheen(
        canvas,
        Path()..addRRect(RRect.fromRectAndRadius(r, const Radius.circular(9))),
        r,
        0.7,
      );
      canvas.restore();
    }
  }

  void _mouse(Canvas canvas) {
    final body = Path()
      ..moveTo(-6, -44)
      ..cubicTo(22, -46, 34, -20, 30, 8)
      ..cubicTo(26, 36, 12, 46, -6, 44)
      ..cubicTo(-26, 42, -34, 22, -32, 0)
      ..cubicTo(-30, -26, -24, -42, -6, -44)
      ..close();
    canvas.drawPath(
      body,
      _grad(const Rect.fromLTRB(-34, -46, 34, 46), [_graphiteHi, _graphite]),
    );
    // 엄지 받침.
    final thumb = Path()
      ..moveTo(-32, 0)
      ..cubicTo(-44, 6, -42, 30, -26, 34)
      ..cubicTo(-30, 24, -32, 12, -32, 0);
    canvas.drawPath(thumb, Paint()..color = const Color(0xFF1C1F25));
    canvas.drawLine(
      const Offset(-2, -43),
      const Offset(-1, -12),
      _stroke(_shade.withValues(alpha: 0.6), 1),
    );
    _rrect(
      canvas,
      const Rect.fromLTRB(-4.5, -34, 2.5, -18),
      3.5,
      _metal(const Rect.fromLTRB(-4.5, -34, 2.5, -18), _hero),
    );
    _sheen(canvas, body, const Rect.fromLTRB(-34, -46, 34, 46), 0.2);
  }

  void _vacuum(Canvas canvas) {
    canvas.drawLine(
      const Offset(4, -18),
      const Offset(-12, 36),
      _stroke(_silverLo, 5),
    );
    canvas.drawLine(
      const Offset(4, -18),
      const Offset(-12, 36),
      _stroke(_silver, 2.6),
    );
    // 헤드.
    const head = Rect.fromLTRB(-34, 34, 12, 46);
    _rrect(canvas, head, 5, _grad(head, [_graphiteHi, _graphite]));
    _rrect(
      canvas,
      const Rect.fromLTRB(-30, 42, 8, 45),
      1.5,
      Paint()..color = _hero,
    );
    // 모터 + 투명 먼지통.
    canvas.save();
    canvas.translate(10, -30);
    canvas.rotate(-0.3);
    const bin = Rect.fromLTRB(-12, -6, 12, 26);
    _rrect(canvas, bin, 6, Paint()..color = _hero.withValues(alpha: 0.22));
    _rrect(canvas, bin, 6, _stroke(_hero, 1.4));
    for (var k = 0; k < 4; k++) {
      canvas.drawLine(
        Offset(-8 + k * 5.3, 0),
        Offset(-8 + k * 5.3, 20),
        _stroke(_hero.withValues(alpha: 0.35), 0.8),
      );
    }
    const motor = Rect.fromLTRB(-10, -24, 10, -4);
    _rrect(canvas, motor, 8, _metal(motor, _hero));
    _rrect(
      canvas,
      const Rect.fromLTRB(10, -18, 26, -12),
      3,
      Paint()..color = _graphite,
    );
    _rrect(
      canvas,
      const Rect.fromLTRB(20, -18, 26, 4),
      3,
      Paint()..color = _graphite,
    );
    canvas.restore();
  }

  void _toaster(Canvas canvas) {
    const r = Rect.fromLTRB(-42, -24, 42, 32);
    _rrect(
      canvas,
      r,
      14,
      _grad(r, [Color.lerp(_graphiteHi, _hero, 0.25)!, _graphite]),
    );
    _rrect(
      canvas,
      const Rect.fromLTRB(-34, -14, 22, 20),
      6,
      Paint()..color = const Color(0xFF0B0D10),
    );
    _rrect(
      canvas,
      const Rect.fromLTRB(-31, 4, 19, 17),
      4,
      _grad(const Rect.fromLTRB(-31, 4, 19, 17), [
        _hero.withValues(alpha: 0.95),
        const Color(0xFFFF6A2B),
      ]),
    );
    canvas.drawCircle(
      const Offset(32, -8),
      4.6,
      _metal(
        Rect.fromCircle(center: const Offset(32, -8), radius: 4.6),
        _silver,
      ),
    );
    canvas.drawCircle(
      const Offset(32, 8),
      4.6,
      _metal(
        Rect.fromCircle(center: const Offset(32, 8), radius: 4.6),
        _silver,
      ),
    );
    _rrect(
      canvas,
      const Rect.fromLTRB(-36, 32, -26, 36),
      1.5,
      Paint()..color = _graphite,
    );
    _rrect(
      canvas,
      const Rect.fromLTRB(26, 32, 36, 36),
      1.5,
      Paint()..color = _graphite,
    );
    _rim(canvas, r, 14, 0.25);
  }

  void _fryer(Canvas canvas) {
    const r = Rect.fromLTRB(-32, -40, 32, 40);
    _rrect(canvas, r, 16, _grad(r, [_graphiteHi, _graphite]));
    const drawer = Rect.fromLTRB(-28, 2, 28, 36);
    _rrect(
      canvas,
      drawer,
      10,
      _grad(drawer, [const Color(0xFF3A3F49), const Color(0xFF22262D)]),
    );
    _rrect(
      canvas,
      const Rect.fromLTRB(-10, 12, 10, 20),
      4,
      _metal(const Rect.fromLTRB(-10, 12, 10, 20), _silver),
    );
    _rrect(
      canvas,
      const Rect.fromLTRB(-16, -30, 16, -16),
      4,
      Paint()..color = const Color(0xFF0B0D10),
    );
    _label(
      canvas,
      '200°',
      const Offset(0, -23),
      size: 7,
      color: _hero,
      align: TextAlign.center,
      weight: FontWeight.w900,
    );
    _rim(canvas, r, 16, 0.25);
  }

  void _fan(Canvas canvas) {
    _rrect(
      canvas,
      const Rect.fromLTRB(-4, 8, 4, 40),
      3,
      Paint()..color = _silverLo,
    );
    _rrect(
      canvas,
      const Rect.fromLTRB(-22, 38, 22, 46),
      4,
      _grad(const Rect.fromLTRB(-22, 38, 22, 46), [_white, _whiteLo]),
    );
    canvas.drawCircle(
      const Offset(0, -12),
      30,
      Paint()..color = _hero.withValues(alpha: 0.12),
    );
    for (var i = 0; i < 5; i++) {
      canvas.save();
      canvas.translate(0, -12);
      canvas.rotate(i / 5 * 2 * math.pi);
      final blade = Path()
        ..moveTo(0, 0)
        ..cubicTo(8, -6, 14, -22, 4, -26)
        ..cubicTo(-4, -24, -6, -10, 0, 0);
      canvas.drawPath(blade, Paint()..color = _hero.withValues(alpha: 0.85));
      canvas.restore();
    }
    canvas.drawCircle(const Offset(0, -12), 30, _stroke(_silverLo, 2));
    for (var i = 0; i < 16; i++) {
      final a = i / 16 * math.pi * 2;
      canvas.drawLine(
        const Offset(0, -12) + Offset(math.cos(a), math.sin(a)) * 8,
        const Offset(0, -12) + Offset(math.cos(a), math.sin(a)) * 30,
        _stroke(_silverLo.withValues(alpha: 0.5), 0.6),
      );
    }
    canvas.drawCircle(
      const Offset(0, -12),
      6,
      _metal(Rect.fromCircle(center: const Offset(0, -12), radius: 6), _silver),
    );
  }

  void _humidifier(Canvas canvas) {
    for (var i = 0; i < 3; i++) {
      canvas.drawCircle(
        Offset(-6.0 + i * 6, -34.0 - i * 6),
        7.0 - i,
        Paint()..color = _hero.withValues(alpha: 0.16 - i * 0.04),
      );
    }
    const r = Rect.fromLTRB(-22, -26, 22, 40);
    _rrect(canvas, r, 20, _grad(r, [_white, _whiteLo]));
    _rrect(canvas, r, 20, _stroke(_silverLo.withValues(alpha: 0.6), 0.8));
    _rrect(
      canvas,
      const Rect.fromLTRB(-22, 10, 22, 40),
      20,
      Paint()..color = _hero.withValues(alpha: 0.2),
    );
    canvas.drawCircle(const Offset(0, -18), 6, Paint()..color = _graphite);
    canvas.drawCircle(const Offset(0, 22), 3, Paint()..color = _hero);
    _sheen(
      canvas,
      Path()..addRRect(RRect.fromRectAndRadius(r, const Radius.circular(20))),
      r,
      0.5,
    );
  }

  void _slimDevice(Canvas canvas) {
    canvas.save();
    canvas.rotate(0.22);
    const r = Rect.fromLTRB(-10, -30, 10, 46);
    _rrect(canvas, r, 10, _grad(r, [_white, _whiteLo]));
    _rrect(canvas, r, 10, _stroke(_silverLo.withValues(alpha: 0.7), 0.8));
    _rrect(
      canvas,
      const Rect.fromLTRB(-4, -46, 4, -28),
      3,
      Paint()..color = _hero,
    );
    canvas.drawCircle(const Offset(0, 2), 3.4, Paint()..color = _hero);
    canvas.drawCircle(
      const Offset(0, 12),
      1.2,
      Paint()..color = _graphite.withValues(alpha: 0.6),
    );
    canvas.restore();
  }

  void _styler(Canvas canvas) {
    canvas.save();
    canvas.rotate(-0.18);
    const handle = Rect.fromLTRB(-9, -4, 9, 44);
    _rrect(
      canvas,
      handle,
      9,
      _metal(handle, rarity == Rarity.n ? _silver : _hero),
    );
    const barrel = Rect.fromLTRB(-8, -46, 8, -4);
    _rrect(canvas, barrel, 7, _metal(barrel, _silver));
    for (var y = -40.0; y < -8; y += 4) {
      canvas.drawLine(Offset(-6, y), Offset(6, y + 2), _stroke(_silverLo, 0.9));
    }
    canvas.drawCircle(
      const Offset(0, 8),
      2.4,
      Paint()..color = Colors.white.withValues(alpha: 0.9),
    );
    canvas.restore();
    final cord = Path()
      ..moveTo(8, 44)
      ..cubicTo(14, 52, 30, 44, 34, 50);
    canvas.drawPath(cord, _stroke(_graphite, 2.2));
  }

  void _lipstick(Canvas canvas) {
    canvas.save();
    canvas.rotate(0.12);
    const base = Rect.fromLTRB(-13, 4, 13, 44);
    _rrect(canvas, base, 3, _metal(base, rarity == Rarity.n ? _silver : _hero));
    const sleeve = Rect.fromLTRB(-10, -14, 10, 6);
    _rrect(canvas, sleeve, 2, _metal(sleeve, _silver));
    final bullet = Path()
      ..moveTo(-8, -14)
      ..lineTo(-8, -34)
      ..quadraticBezierTo(-6, -42, 8, -46)
      ..lineTo(8, -14)
      ..close();
    canvas.drawPath(
      bullet,
      _grad(const Rect.fromLTRB(-8, -46, 8, -14), [
        const Color(0xFFFF8FAE),
        const Color(0xFFD8335F),
      ]),
    );
    canvas.drawLine(
      const Offset(-4, -36),
      const Offset(-4, -16),
      _stroke(Colors.white.withValues(alpha: 0.5), 1.4),
    );
    canvas.restore();
    // 뚜껑.
    canvas.save();
    canvas.translate(30, 20);
    canvas.rotate(-0.4);
    const cap = Rect.fromLTRB(-11, -16, 11, 20);
    _rrect(canvas, cap, 3, _metal(cap, rarity == Rarity.n ? _silver : _hero));
    canvas.restore();
  }

  void _tube(Canvas canvas) {
    canvas.save();
    canvas.rotate(-0.28);
    final tube = Path()
      ..moveTo(-20, -44)
      ..lineTo(20, -44)
      ..lineTo(14, 26)
      ..lineTo(-14, 26)
      ..close();
    canvas.drawPath(
      tube,
      _grad(const Rect.fromLTRB(-20, -44, 20, 26), [_white, _whiteLo]),
    );
    canvas.drawPath(tube, _stroke(_silverLo.withValues(alpha: 0.6), 0.8));
    _rrect(
      canvas,
      const Rect.fromLTRB(-21, -47, 21, -42),
      1,
      Paint()..color = _whiteLo,
    );
    for (var x = -18.0; x < 19; x += 3) {
      canvas.drawLine(
        Offset(x, -46.5),
        Offset(x, -42.5),
        _stroke(_silverLo, 0.6),
      );
    }
    _rrect(
      canvas,
      const Rect.fromLTRB(-16, -26, 16, 2),
      3,
      Paint()..color = _hero.withValues(alpha: 0.9),
    );
    if (_has(['b5'])) {
      _label(
        canvas,
        'B5',
        const Offset(0, -12),
        size: 11,
        color: Colors.white,
        align: TextAlign.center,
        weight: FontWeight.w900,
      );
    } else {
      canvas.drawLine(
        const Offset(-10, -16),
        const Offset(10, -16),
        _stroke(Colors.white, 1.6),
      );
      canvas.drawLine(
        const Offset(-7, -9),
        const Offset(7, -9),
        _stroke(Colors.white.withValues(alpha: 0.6), 1.1),
      );
    }
    const cap = Rect.fromLTRB(-11, 26, 11, 44);
    _rrect(canvas, cap, 3, _metal(cap, rarity == Rarity.n ? _silver : _hero));
    _sheen(canvas, tube, const Rect.fromLTRB(-20, -44, 20, 26), 0.5);
    canvas.restore();
  }

  void _jar(Canvas canvas) {
    const lid = Rect.fromLTRB(-30, -26, 30, -6);
    const jar = Rect.fromLTRB(-34, -8, 34, 32);
    _rrect(canvas, jar, 12, _grad(jar, [_white, _whiteLo]));
    _rrect(canvas, jar, 12, _stroke(_silverLo.withValues(alpha: 0.6), 0.8));
    _rrect(canvas, lid, 6, _metal(lid, rarity == Rarity.n ? _silver : _hero));
    _rrect(
      canvas,
      const Rect.fromLTRB(-20, 4, 20, 20),
      3,
      Paint()..color = _hero.withValues(alpha: 0.12),
    );
    canvas.drawLine(
      const Offset(-14, 12),
      const Offset(14, 12),
      _stroke(_hero.withValues(alpha: 0.6), 1.4),
    );
    _sheen(
      canvas,
      Path()..addRRect(RRect.fromRectAndRadius(jar, const Radius.circular(12))),
      jar,
      0.45,
    );
  }

  void _perfume(Canvas canvas) {
    const cap = Rect.fromLTRB(-11, -46, 11, -24);
    const neck = Rect.fromLTRB(-6, -26, 6, -16);
    const bottle = Rect.fromLTRB(-30, -18, 30, 42);
    _rrect(canvas, bottle, 9, Paint()..color = _hero.withValues(alpha: 0.16));
    final liquid = Rect.fromLTRB(-27, 0, 27, 39);
    _rrect(
      canvas,
      liquid,
      7,
      _grad(
        liquid,
        [_heroLight.withValues(alpha: 0.85), _hero.withValues(alpha: 0.75)],
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
      ),
    );
    _rrect(
      canvas,
      bottle,
      9,
      _stroke(Color.lerp(_hero, _shade, 0.1)!.withValues(alpha: 0.5), 1.4),
    );
    _rrect(
      canvas,
      const Rect.fromLTRB(-18, 6, 18, 26),
      1.5,
      Paint()..color = const Color(0xFFFAF8F2),
    );
    canvas.drawLine(
      const Offset(-12, 13),
      const Offset(12, 13),
      _stroke(_graphite.withValues(alpha: 0.7), 1.4),
    );
    canvas.drawLine(
      const Offset(-8, 19),
      const Offset(8, 19),
      _stroke(_graphite.withValues(alpha: 0.35), 1),
    );
    _rrect(canvas, neck, 1.5, _metal(neck, _silver));
    _rrect(canvas, cap, 3, _grad(cap, [_graphiteHi, _graphite]));
    canvas.drawLine(
      const Offset(-22, -12),
      const Offset(-22, 34),
      _stroke(Colors.white.withValues(alpha: 0.7), 2.4),
    );
  }

  void _tee(Canvas canvas) {
    final shirt = Path()
      ..moveTo(-14, -40)
      ..quadraticBezierTo(0, -30, 14, -40)
      ..lineTo(44, -26)
      ..lineTo(34, -6)
      ..lineTo(26, -10)
      ..lineTo(26, 42)
      ..lineTo(-26, 42)
      ..lineTo(-26, -10)
      ..lineTo(-34, -6)
      ..lineTo(-44, -26)
      ..close();
    final fabric = rarity == Rarity.n ? _whiteLo : _heroLight;
    canvas.drawPath(
      shirt,
      _grad(const Rect.fromLTRB(-44, -40, 44, 42), [
        Color.lerp(fabric, Colors.white, 0.5)!,
        fabric,
      ]),
    );
    canvas.drawPath(shirt, _stroke(_shade.withValues(alpha: 0.12), 1));
    final collar = Path()
      ..moveTo(-14, -40)
      ..quadraticBezierTo(0, -30, 14, -40);
    canvas.drawPath(collar, _stroke(Color.lerp(fabric, _shade, 0.2)!, 3));
    canvas.drawCircle(const Offset(-12, -14), 4.5, Paint()..color = _hero);
  }

  void _cap(Canvas canvas) {
    final crown = Path()
      ..moveTo(-38, 10)
      ..cubicTo(-38, -36, 26, -40, 30, 6)
      ..close();
    final col = rarity == Rarity.n ? const Color(0xFF59606C) : _hero;
    canvas.drawPath(
      crown,
      _grad(const Rect.fromLTRB(-38, -38, 30, 10), [
        Color.lerp(col, Colors.white, 0.25)!,
        col,
      ]),
    );
    final brim = Path()
      ..moveTo(18, 2)
      ..quadraticBezierTo(50, 4, 50, 14)
      ..quadraticBezierTo(30, 18, 4, 12)
      ..close();
    canvas.drawPath(brim, Paint()..color = Color.lerp(col, _shade, 0.25)!);
    canvas.drawLine(
      const Offset(-6, -32),
      const Offset(-2, 8),
      _stroke(Colors.white.withValues(alpha: 0.25), 1),
    );
    canvas.drawCircle(
      const Offset(-6, -34),
      2.4,
      Paint()..color = Color.lerp(col, _shade, 0.3)!,
    );
    canvas.drawCircle(
      const Offset(-16, -10),
      4,
      Paint()..color = Colors.white.withValues(alpha: 0.9),
    );
  }

  void _voucher(Canvas canvas) {
    final (merchant, amount) = parseVoucher(name);
    final colors = switch (rarity) {
      Rarity.n => const [Color(0xFFF4F6F8), Color(0xFFCBD2DB)],
      Rarity.r => const [Color(0xFF6EA6FF), Color(0xFF1F5FE0)],
      Rarity.sr => const [Color(0xFFB98BFF), Color(0xFF6527D8)],
      Rarity.ssr => const [Color(0xFFFFE6A0), Color(0xFFD99A1C)],
    };
    final ink = rarity == Rarity.n
        ? _graphite
        : rarity == Rarity.ssr
        ? const Color(0xFF4A3200)
        : Colors.white;
    // 뒤 카드.
    canvas.save();
    canvas.translate(6, -8);
    canvas.rotate(0.1);
    const back = Rect.fromLTRB(-46, -29, 46, 29);
    _rrect(
      canvas,
      back,
      7,
      Paint()..color = Color.lerp(colors.last, Colors.white, 0.55)!,
    );
    canvas.restore();
    // 앞 카드.
    canvas.save();
    canvas.rotate(-0.07);
    const r = Rect.fromLTRB(-48, -30, 48, 30);
    _rrect(canvas, r, 7, _grad(r, colors));
    canvas.save();
    canvas.clipRRect(RRect.fromRectAndRadius(r, const Radius.circular(7)));
    for (var k = 0; k < 5; k++) {
      canvas.drawCircle(
        Offset(48, 34 + k * 2.0),
        26.0 + k * 9,
        _stroke(Colors.white.withValues(alpha: 0.14), 1),
      );
    }
    canvas.drawRect(
      r,
      _grad(
        r,
        [
          Colors.white.withValues(alpha: 0.35),
          Colors.white.withValues(alpha: 0),
        ],
        begin: Alignment.topLeft,
        end: Alignment.center,
      ),
    );
    canvas.restore();
    _label(
      canvas,
      merchant,
      const Offset(-40, -18),
      size: merchant.length > 5 ? 9.5 : 12,
      color: ink,
      weight: FontWeight.w900,
      maxWidth: 70,
    );
    _label(
      canvas,
      'GIFT CARD',
      const Offset(-40, -6),
      size: 5.6,
      color: ink.withValues(alpha: 0.7),
      weight: FontWeight.w800,
      spacing: 1,
    );
    if (amount != null) {
      _label(
        canvas,
        amount,
        const Offset(41, 17),
        size: 15,
        color: ink,
        weight: FontWeight.w900,
        align: TextAlign.right,
        spacing: -0.6,
      );
    }
    // 바코드.
    for (var i = 0; i < 12; i++) {
      final x = -40.0 + i * 2.2;
      canvas.drawLine(
        Offset(x, 12),
        Offset(x, 22),
        _stroke(ink.withValues(alpha: 0.55), i % 3 == 0 ? 1.2 : 0.6),
      );
    }
    _rrect(canvas, r, 7, _stroke(Colors.white.withValues(alpha: 0.5), 0.8));
    canvas.restore();
  }

  void _cup(Canvas canvas) {
    final body = Path()
      ..moveTo(-26, -26)
      ..lineTo(26, -26)
      ..lineTo(19, 44)
      ..lineTo(-19, 44)
      ..close();
    canvas.drawPath(
      body,
      _grad(const Rect.fromLTRB(-26, -26, 26, 44), [_white, _whiteLo]),
    );
    canvas.drawPath(body, _stroke(_silverLo.withValues(alpha: 0.6), 0.8));
    final sleeve = Path()
      ..moveTo(-24.2, -8)
      ..lineTo(24.2, -8)
      ..lineTo(21.6, 24)
      ..lineTo(-21.6, 24)
      ..close();
    canvas.drawPath(
      sleeve,
      Paint()..color = rarity == Rarity.n ? const Color(0xFFB8875A) : _hero,
    );
    canvas.drawCircle(
      const Offset(0, 8),
      7,
      Paint()..color = Colors.white.withValues(alpha: 0.9),
    );
    canvas.drawCircle(
      const Offset(0, 8),
      4,
      Paint()..color = rarity == Rarity.n ? const Color(0xFFB8875A) : _hero,
    );
    const lid = Rect.fromLTRB(-29, -34, 29, -25);
    _rrect(canvas, lid, 3.5, _grad(lid, [_white, _whiteLo]));
    _rrect(canvas, lid, 3.5, _stroke(_silverLo.withValues(alpha: 0.6), 0.8));
    _rrect(
      canvas,
      const Rect.fromLTRB(-20, -40, 20, -33),
      3,
      Paint()..color = _whiteLo,
    );
    _sheen(canvas, body, const Rect.fromLTRB(-26, -26, 26, 44), 0.45);
  }

  void _iceCream(Canvas canvas) {
    final cup = Path()
      ..moveTo(-28, 4)
      ..lineTo(28, 4)
      ..lineTo(20, 44)
      ..lineTo(-20, 44)
      ..close();
    canvas.drawPath(
      cup,
      _grad(const Rect.fromLTRB(-28, 4, 28, 44), [_heroLight, _hero]),
    );
    for (var i = 0; i < 6; i++) {
      canvas.drawCircle(
        Offset(-16.0 + i * 6.4, 24),
        1.6,
        Paint()..color = Colors.white.withValues(alpha: 0.75),
      );
    }
    canvas.drawCircle(
      const Offset(0, -12),
      22,
      _grad(const Rect.fromLTRB(-22, -34, 22, 10), [
        const Color(0xFFFFF0F4),
        const Color(0xFFFFC2D3),
      ]),
    );
    canvas.drawCircle(
      const Offset(-7, -20),
      5,
      Paint()..color = Colors.white.withValues(alpha: 0.55),
    );
    for (final p in const [
      Offset(6, -24),
      Offset(12, -12),
      Offset(-4, -6),
      Offset(-12, -14),
    ]) {
      canvas.drawCircle(p, 1.4, Paint()..color = const Color(0xFF8A4A5E));
    }
    final spoon = Path()
      ..moveTo(14, -20)
      ..lineTo(34, -46);
    canvas.drawPath(spoon, _stroke(_hero, 3));
  }

  void _bowl(Canvas canvas) {
    final bowl = Path()
      ..moveTo(-40, -4)
      ..lineTo(40, -4)
      ..quadraticBezierTo(38, 38, 0, 40)
      ..quadraticBezierTo(-38, 38, -40, -4)
      ..close();
    canvas.drawPath(
      bowl,
      _grad(const Rect.fromLTRB(-40, -4, 40, 40), [_white, _whiteLo]),
    );
    canvas.drawPath(bowl, _stroke(_silverLo.withValues(alpha: 0.6), 0.8));
    canvas.drawOval(
      const Rect.fromLTRB(-40, -12, 40, 4),
      Paint()..color = const Color(0xFFFFF5E0),
    );
    canvas.drawLine(
      const Offset(-30, 14),
      const Offset(30, 14),
      _stroke(_hero, 2.4),
    );
    canvas.drawLine(
      const Offset(12, -40),
      const Offset(26, -4),
      _stroke(_graphite, 2.4),
    );
    canvas.drawLine(
      const Offset(20, -42),
      const Offset(30, -4),
      _stroke(_graphite, 2.4),
    );
  }

  void _diamond(Canvas canvas) {
    final ice = rarity == Rarity.ssr
        ? const Color(0xFFFFF4D6)
        : Color.lerp(_heroLight, Colors.white, 0.4)!;
    final crown = Path()
      ..moveTo(-24, -26)
      ..lineTo(24, -26)
      ..lineTo(40, -8)
      ..lineTo(-40, -8)
      ..close();
    final pavilion = Path()
      ..moveTo(-40, -8)
      ..lineTo(40, -8)
      ..lineTo(0, 40)
      ..close();
    canvas.drawPath(
      pavilion,
      _grad(const Rect.fromLTRB(-40, -8, 40, 40), [
        ice,
        _hero.withValues(alpha: 0.75),
      ]),
    );
    canvas.drawPath(
      crown,
      _grad(const Rect.fromLTRB(-40, -26, 40, -8), [Colors.white, ice]),
    );
    final facet = _stroke(Colors.white.withValues(alpha: 0.85), 0.9);
    for (final (a, b) in const [
      (Offset(-24, -26), Offset(-12, -8)),
      (Offset(0, -26), Offset(-12, -8)),
      (Offset(0, -26), Offset(12, -8)),
      (Offset(24, -26), Offset(12, -8)),
      (Offset(-12, -8), Offset(0, 40)),
      (Offset(12, -8), Offset(0, 40)),
      (Offset(-40, -8), Offset(0, 40)),
      (Offset(40, -8), Offset(0, 40)),
      (Offset(-26, -8), Offset(0, 40)),
      (Offset(26, -8), Offset(0, 40)),
    ]) {
      canvas.drawLine(a, b, facet);
    }
    canvas.drawPath(
      crown,
      _stroke(Color.lerp(_hero, _shade, 0.1)!.withValues(alpha: 0.5), 1),
    );
    canvas.drawPath(
      pavilion,
      _stroke(Color.lerp(_hero, _shade, 0.1)!.withValues(alpha: 0.5), 1),
    );
    _sparkle(canvas, const Offset(30, -34), 7);
    _sparkle(canvas, const Offset(-34, 14), 4.5);
  }

  void _giftBox(Canvas canvas) {
    const box = Rect.fromLTRB(-34, -10, 34, 40);
    _rrect(canvas, box, 4, _grad(box, [_heroLight, _hero]));
    const lid = Rect.fromLTRB(-38, -22, 38, -8);
    _rrect(
      canvas,
      lid,
      3,
      _grad(lid, [Color.lerp(_hero, Colors.white, 0.3)!, _hero]),
    );
    canvas.drawRect(
      const Rect.fromLTRB(-6, -22, 6, 40),
      Paint()..color = Colors.white.withValues(alpha: 0.9),
    );
    final bowL = Path()
      ..moveTo(0, -22)
      ..cubicTo(-10, -44, -30, -34, -14, -24)
      ..close();
    final bowR = Path()
      ..moveTo(0, -22)
      ..cubicTo(10, -44, 30, -34, 14, -24)
      ..close();
    canvas.drawPath(bowL, Paint()..color = Colors.white);
    canvas.drawPath(bowR, Paint()..color = Colors.white);
    canvas.drawPath(bowL, _stroke(_silverLo, 0.8));
    canvas.drawPath(bowR, _stroke(_silverLo, 0.8));
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
      Paint()..color = rarity == Rarity.n ? _silverLo : _hero,
    );
  }

  @override
  bool shouldRepaint(covariant ProductArtPainter old) =>
      old.category != category ||
      old.rarity != rarity ||
      old.name != name ||
      old.background != background;
}
