import 'dart:async';
import 'dart:math' as math;
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import '../../../../core/domain/product_category.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/utils/format.dart';
import '../../../../shared/widgets/pack_art.dart';
import '../../domain/home_banner.dart';

/// 홈 최상단 배너 캐러셀(`GET /banners`).
///
/// 배너 대부분에 이미지가 없어서, 서버 색(accentColorHex)·배지·제목만으로
/// 완성되는 **색면 포스터**를 그린다: 선명한 단색 면 + 큰 글자 + 링크 종류별
/// 도형 일러스트(박스 링크는 그 박스의 패키지, 출석은 도장 카드, 충전은
/// 코인, 10+1은 카드 부채, 천장은 게이지). 4.5초마다 넘어가고, 손으로
/// 넘기는 동안은 멈춘다.
class HeroCarousel extends StatefulWidget {
  final List<HomeBanner> banners;
  final ValueChanged<HomeBanner> onTap;

  /// GACHA 배너의 박스 분류(패키지 디자인용). 모르면 null.
  final ProductCategory? Function(int gachaId)? categoryOf;

  const HeroCarousel({
    super.key,
    required this.banners,
    required this.onTap,
    this.categoryOf,
  });

  @override
  State<HeroCarousel> createState() => _HeroCarouselState();
}

class _HeroCarouselState extends State<HeroCarousel> {
  static const _interval = Duration(milliseconds: 4500);
  late final PageController _page = PageController(viewportFraction: 0.9);

  /// 자동 넘김은 Timer로만 센다(대기 중에는 프레임을 그리지 않는다).
  Timer? _timer;
  int _index = 0;
  bool _userDragging = false;

  @override
  void initState() {
    super.initState();
    _schedule();
  }

  @override
  void dispose() {
    _timer?.cancel();
    _page.dispose();
    super.dispose();
  }

  void _schedule() {
    _timer?.cancel();
    if (widget.banners.length < 2) return;
    _timer = Timer(_interval, _advance);
  }

  void _advance() {
    if (!mounted || _userDragging || widget.banners.length < 2) return;
    // 화면 밖 탭이면(TickerMode 꺼짐) 넘기지 않고 다음 차례를 기다린다.
    if (!TickerMode.valuesOf(context).enabled) return _schedule();
    final next = (_index + 1) % widget.banners.length;
    if (!_page.hasClients) return;
    if (next == 0) {
      _page.jumpToPage(0);
    } else {
      _page.animateToPage(
        next,
        duration: Motion.page,
        curve: Motion.emphasized,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final banners = widget.banners;
    return SizedBox(
      height: 212,
      child: NotificationListener<ScrollNotification>(
        onNotification: (n) {
          if (n is ScrollStartNotification && n.dragDetails != null) {
            _userDragging = true;
            _timer?.cancel();
          } else if (n is ScrollEndNotification && _userDragging) {
            _userDragging = false;
            _schedule();
          }
          return false;
        },
        child: PageView.builder(
          controller: _page,
          itemCount: banners.length,
          onPageChanged: (i) {
            setState(() => _index = i);
            if (!_userDragging) _schedule();
          },
          itemBuilder: (context, i) {
            final b = banners[i];
            return Padding(
              padding: const EdgeInsets.fromLTRB(5, 4, 5, 16),
              child: BannerSlide(
                banner: b,
                index: i,
                count: banners.length,
                category: b.gachaId == null
                    ? null
                    : widget.categoryOf?.call(b.gachaId!),
                onTap: b.tappable ? () => widget.onTap(b) : null,
              ),
            );
          },
        ),
      ),
    );
  }
}

enum _Motif { pack, stamps, coins, cards, gauge, rosette }

/// 배너 한 장의 색 설계.
@immutable
class _Poster {
  final Color field;
  final Color fieldDeep;
  final Color ink;
  final PackStyle? pack;
  const _Poster(this.field, this.fieldDeep, this.ink, this.pack);

  bool get dark => ink == Colors.white;
}

class BannerSlide extends StatelessWidget {
  final HomeBanner banner;
  final int index;
  final int count;
  final ProductCategory? category;
  final VoidCallback? onTap;

  const BannerSlide({
    super.key,
    required this.banner,
    required this.index,
    required this.count,
    this.category,
    this.onTap,
  });

  _Motif get _motif {
    final badge = banner.badge ?? '';
    switch (banner.linkType) {
      case BannerLinkType.gacha:
        return _Motif.pack;
      case BannerLinkType.attendance:
        return _Motif.stamps;
      case BannerLinkType.topup:
        return _Motif.coins;
      case BannerLinkType.odds:
        return badge.contains('10+1') || banner.title.contains('10회')
            ? _Motif.cards
            : _Motif.gauge;
      case BannerLinkType.url:
      case BannerLinkType.none:
        return _Motif.rosette;
    }
  }

  _Poster _poster() {
    final accent = banner.accent ?? AppColors.brand;
    final hsl = HSLColor.fromColor(accent);
    if (_motif == _Motif.pack) {
      final pack = PackStyle.of(
        category: category ?? ProductCategory.jewel,
        accent: accent,
        badge: banner.badge,
      );
      // 축하 패키지(레드 뚜껑) → 브랜드 레드 면, 먹색 패키지 → 샴페인 면,
      // 그 밖 → 박스 색을 옅게 깐 면.
      if (pack.lid == AppColors.brand) {
        return _Poster(
          AppColors.brand,
          AppColors.brandDeep,
          Colors.white,
          pack,
        );
      }
      if (pack.body.computeLuminance() < 0.05) {
        return _Poster(
          const Color(0xFFEBD3A0),
          const Color(0xFFC49A4C),
          AppColors.text,
          pack,
        );
      }
      final f = Color.lerp(pack.backdrop, pack.body, 0.45)!;
      return _Poster(
        f,
        Color.lerp(f, Colors.black, 0.18)!,
        f.computeLuminance() > 0.4 ? AppColors.text : Colors.white,
        pack,
      );
    }
    if (hsl.saturation < 0.12) {
      return const _Poster(
        Color(0xFF23252B),
        Color(0xFF111216),
        Colors.white,
        null,
      );
    }
    final field = hsl
        .withSaturation(math.max(hsl.saturation, 0.72))
        .withLightness(hsl.lightness.clamp(0.42, 0.52))
        .toColor();
    final fh = HSLColor.fromColor(field);
    final deep = fh.withLightness((fh.lightness - 0.12).clamp(0, 1)).toColor();
    return _Poster(
      field,
      deep,
      field.computeLuminance() > 0.42 ? AppColors.text : Colors.white,
      null,
    );
  }

  /// 그림에 넣을 숫자는 배너 문구에 실제로 있는 것만 쓴다.
  String? get _figure {
    final text = [banner.title, banner.subtitle ?? '', banner.badge ?? ''];
    switch (_motif) {
      case _Motif.coins:
        for (final t in text) {
          final m = RegExp(r'(\d+)\s*%').firstMatch(t);
          if (m != null) return '+${m[1]}%';
        }
        return null;
      case _Motif.stamps:
        for (final t in text) {
          final m = RegExp(r'([\d,]+)\s*GP').firstMatch(t);
          if (m != null) return m[1];
        }
        return null;
      case _Motif.pack:
      case _Motif.cards:
      case _Motif.gauge:
      case _Motif.rosette:
        return null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = _poster();
    final hasImage = banner.imageUrl != null && banner.imageUrl!.isNotEmpty;
    final art = _PosterArt(poster: p, motif: _motif, figure: _figure);

    return GestureDetector(
      onTap: onTap,
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: Radii.hero,
          boxShadow: Shadows.tinted(p.fieldDeep, strength: 0.7),
        ),
        child: ClipRRect(
          borderRadius: Radii.hero,
          child: Stack(
            fit: StackFit.expand,
            children: [
              if (hasImage)
                CachedNetworkImage(
                  imageUrl: banner.imageUrl!,
                  fit: BoxFit.cover,
                  placeholder: (_, _) => art,
                  errorWidget: (_, _, _) => art,
                )
              else
                art,
              if (hasImage)
                const DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.centerLeft,
                      end: Alignment.centerRight,
                      colors: [Color(0xB3000000), Color(0x00000000)],
                      stops: [0.2, 0.75],
                    ),
                  ),
                ),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 18, 14, 14),
                child: _PosterCopy(
                  banner: banner,
                  ink: hasImage ? Colors.white : p.ink,
                  field: p.fieldDeep,
                  index: index,
                  count: count,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PosterCopy extends StatelessWidget {
  final HomeBanner banner;
  final Color ink;
  final Color field;
  final int index;
  final int count;

  const _PosterCopy({
    required this.banner,
    required this.ink,
    required this.field,
    required this.index,
    required this.count,
  });

  @override
  Widget build(BuildContext context) {
    final onDark = ink == Colors.white;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (banner.badge != null)
          Container(
            height: 22,
            padding: const EdgeInsets.symmetric(horizontal: 8),
            decoration: BoxDecoration(
              color: onDark ? Colors.white : AppColors.text,
              borderRadius: const BorderRadius.all(Radius.circular(6)),
            ),
            child: Center(
              widthFactor: 1,
              child: Text(
                banner.badge!,
                style: AppText.micro.copyWith(
                  color: onDark ? field : Colors.white,
                  fontSize: 11,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 0.2,
                  height: 1,
                ),
              ),
            ),
          ),
        const Spacer(),
        FractionallySizedBox(
          widthFactor: 0.58,
          alignment: Alignment.centerLeft,
          child: Text(
            keepAll(banner.title),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: AppText.hero.copyWith(
              fontSize: 24,
              height: 1.2,
              fontWeight: FontWeight.w900,
              letterSpacing: -1.1,
              color: ink,
            ),
          ),
        ),
        if (banner.subtitle != null) ...[
          const SizedBox(height: 6),
          FractionallySizedBox(
            widthFactor: 0.56,
            alignment: Alignment.centerLeft,
            child: Text(
              keepAll(banner.subtitle!),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: AppText.caption.copyWith(
                color: ink.withValues(alpha: 0.82),
                fontWeight: FontWeight.w600,
                height: 1.35,
              ),
            ),
          ),
        ],
        const SizedBox(height: 10),
        Row(
          children: [
            if (banner.endLabel != null)
              Text(
                '${banner.endLabel} 까지',
                style: AppText.num(AppText.micro).copyWith(
                  color: ink.withValues(alpha: 0.75),
                  fontWeight: FontWeight.w700,
                ),
              ),
            const Spacer(),
            Container(
              height: 22,
              padding: const EdgeInsets.symmetric(horizontal: 9),
              decoration: BoxDecoration(
                color: Colors.black.withValues(alpha: onDark ? 0.22 : 0.16),
                borderRadius: Radii.pill,
              ),
              child: Center(
                widthFactor: 1,
                child: Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(
                        text: '${index + 1}',
                        style: const TextStyle(fontWeight: FontWeight.w800),
                      ),
                      TextSpan(
                        text: ' / $count',
                        style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.7),
                        ),
                      ),
                    ],
                  ),
                  style: AppText.num(
                    AppText.micro,
                  ).copyWith(color: Colors.white, height: 1),
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _PosterArt extends StatelessWidget {
  final _Poster poster;
  final _Motif motif;

  /// 배너 문구에서 읽은 숫자(예: "+20%", "500"). 없으면 그림에 숫자를 쓰지 않는다.
  final String? figure;
  const _PosterArt({required this.poster, required this.motif, this.figure});

  @override
  Widget build(BuildContext context) {
    return RepaintBoundary(
      child: CustomPaint(
        painter: _PosterPainter(poster: poster, motif: motif, figure: figure),
      ),
    );
  }
}

class _PosterPainter extends CustomPainter {
  final _Poster poster;
  final _Motif motif;
  final String? figure;

  _PosterPainter({required this.poster, required this.motif, this.figure});

  static const _shade = Color(0xFF0B0D12);

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final f = poster.field;
    canvas.drawRect(
      rect,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color.lerp(f, Colors.white, 0.08)!, f, poster.fieldDeep],
          stops: const [0, 0.55, 1],
        ).createShader(rect),
    );
    final h = size.height;
    // 그림은 오른쪽 40% 칸 안에만 그린다(왼쪽은 글자 자리).
    final focus = Offset(size.width * 0.78, h * 0.5);
    // 큰 원 하나가 오른쪽 밖으로 걸쳐 있다(포스터의 색면 구성).
    final disc = focus + Offset(h * 0.1, -h * 0.02);
    canvas.drawCircle(
      disc,
      h * 0.6,
      Paint()..color = Colors.white.withValues(alpha: poster.dark ? 0.1 : 0.28),
    );
    canvas.drawCircle(
      disc,
      h * 0.8,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.2
        ..color = Colors.white.withValues(alpha: poster.dark ? 0.16 : 0.4),
    );
    // 왼쪽 아래 점 격자(인쇄물 질감).
    final dot = Paint()
      ..color = (poster.dark ? Colors.white : _shade).withValues(alpha: 0.07);
    for (var x = 8.0; x < size.width * 0.5; x += 9) {
      for (var y = h * 0.62; y < h; y += 9) {
        canvas.drawCircle(Offset(x, y), 1.1, dot);
      }
    }

    switch (motif) {
      case _Motif.pack:
        _rays(canvas, focus, h);
        canvas.save();
        canvas.translate(focus.dx - h * 0.5, 0);
        PackPainter(
          style: poster.pack!,
          scale: 0.56,
          center: const Offset(0.5, 0.56),
        ).paint(canvas, Size(h, h));
        canvas.restore();
      case _Motif.stamps:
        _stampCard(canvas, focus, h);
      case _Motif.coins:
        _coins(canvas, focus, h);
      case _Motif.cards:
        _cardFan(canvas, focus, h);
      case _Motif.gauge:
        _gauge(canvas, focus, h);
      case _Motif.rosette:
        for (var k = 1; k < 7; k++) {
          canvas.drawCircle(
            focus,
            h * 0.07 * k,
            Paint()
              ..style = PaintingStyle.stroke
              ..strokeWidth = 1.4
              ..color = Colors.white.withValues(alpha: 0.5 - k * 0.05),
          );
        }
    }
  }

  void _rays(Canvas canvas, Offset c, double h) {
    const n = 16;
    final r = h * 1.1;
    final paint = Paint()
      ..shader = RadialGradient(
        colors: [
          Colors.white.withValues(alpha: poster.dark ? 0.28 : 0.5),
          Colors.white.withValues(alpha: 0),
        ],
      ).createShader(Rect.fromCircle(center: c, radius: r));
    for (var i = 0; i < n; i++) {
      final a = i / n * 2 * math.pi + 0.1;
      const w = math.pi / n * 0.45;
      canvas.drawPath(
        Path()
          ..moveTo(c.dx, c.dy)
          ..lineTo(c.dx + math.cos(a - w) * r, c.dy + math.sin(a - w) * r)
          ..lineTo(c.dx + math.cos(a + w) * r, c.dy + math.sin(a + w) * r)
          ..close(),
        paint,
      );
    }
  }

  /// 출석 도장 카드: 흰 카드에 7칸, 찍힌 칸은 레드 인주 도장, 마지막 칸은 금.
  void _stampCard(Canvas canvas, Offset c, double h) {
    canvas.save();
    canvas.translate(c.dx + h * 0.02, c.dy + h * 0.04);
    canvas.rotate(-0.1);
    final w = h * 0.74;
    final ch = h * 0.54;
    final card = RRect.fromRectAndRadius(
      Rect.fromCenter(center: Offset.zero, width: w, height: ch),
      Radius.circular(h * 0.06),
    );
    canvas.drawRRect(
      card.shift(Offset(0, h * 0.03)),
      Paint()..color = _shade.withValues(alpha: 0.18),
    );
    canvas.drawRRect(card, Paint()..color = Colors.white);
    _label(
      canvas,
      'ATTENDANCE',
      Offset(-w * 0.42, -ch * 0.4),
      h * 0.05,
      poster.fieldDeep,
      spacing: 1.2,
    );
    final r = h * 0.07;
    for (var i = 0; i < 7; i++) {
      final row = i < 4 ? 0 : 1;
      final col = i < 4 ? i : i - 4;
      final x = -w * 0.33 + col * w * 0.22 + (row == 1 ? w * 0.11 : 0);
      final y = -ch * 0.05 + row * ch * 0.36;
      final p = Offset(x, y);
      if (i == 6) {
        canvas.drawCircle(
          p,
          r * 1.15,
          Paint()
            ..shader = FoilTone.gold.gradient().createShader(
              Rect.fromCircle(center: p, radius: r * 1.15),
            ),
        );
        final f = figure;
        if (f != null) {
          _label(
            canvas,
            f,
            p,
            r * (f.length > 3 ? 0.56 : 0.72),
            const Color(0xFF5A3D00),
            center: true,
          );
        } else {
          _sparkleAt(canvas, p, r * 0.6, const Color(0xFF5A3D00));
        }
      } else if (i < 3) {
        canvas.drawCircle(p, r, Paint()..color = AppColors.brand);
        canvas.drawCircle(
          p,
          r * 0.78,
          Paint()
            ..style = PaintingStyle.stroke
            ..strokeWidth = 1
            ..color = Colors.white.withValues(alpha: 0.6),
        );
        final check = Path()
          ..moveTo(p.dx - r * 0.38, p.dy)
          ..lineTo(p.dx - r * 0.08, p.dy + r * 0.3)
          ..lineTo(p.dx + r * 0.42, p.dy - r * 0.3);
        canvas.drawPath(
          check,
          Paint()
            ..style = PaintingStyle.stroke
            ..strokeWidth = r * 0.2
            ..strokeCap = StrokeCap.round
            ..strokeJoin = StrokeJoin.round
            ..color = Colors.white,
        );
      } else {
        canvas.drawCircle(p, r, Paint()..color = const Color(0xFFF0F2F5));
        _label(
          canvas,
          '${i + 1}',
          p,
          r * 0.8,
          const Color(0xFFA0A6B0),
          center: true,
        );
      }
    }
    canvas.restore();
  }

  /// 충전: 겹쳐 쌓인 흰 GP 코인 + "+20%".
  void _coins(Canvas canvas, Offset c, double h) {
    final r = h * 0.15;
    final side = Color.lerp(poster.fieldDeep, _shade, 0.2)!;
    for (var i = 0; i < 4; i++) {
      final p = c + Offset(-h * 0.08 + i * 3.0, h * 0.26 - i * h * 0.075);
      final face = Rect.fromCenter(center: p, width: r * 2.4, height: r * 0.9);
      canvas.drawOval(face.shift(Offset(0, h * 0.035)), Paint()..color = side);
      canvas.drawRect(
        Rect.fromLTRB(face.left, p.dy, face.right, p.dy + h * 0.035),
        Paint()..color = side,
      );
      canvas.drawOval(
        face,
        Paint()
          ..shader = const LinearGradient(
            colors: [Colors.white, Color(0xFFDDE3EA)],
          ).createShader(face),
      );
      canvas.drawOval(
        face.deflate(r * 0.18),
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1
          ..color = poster.field.withValues(alpha: 0.5),
      );
    }
    final top = c + Offset(h * 0.2, -h * 0.04);
    canvas.drawCircle(
      top + Offset(0, h * 0.025),
      r * 1.05,
      Paint()..color = _shade.withValues(alpha: 0.2),
    );
    canvas.drawCircle(
      top,
      r * 1.05,
      Paint()
        ..shader = const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Colors.white, Color(0xFFDDE3EA)],
        ).createShader(Rect.fromCircle(center: top, radius: r)),
    );
    canvas.drawCircle(
      top,
      r * 0.8,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.2
        ..color = poster.field.withValues(alpha: 0.6),
    );
    _label(canvas, 'G', top, r * 1.05, poster.fieldDeep, center: true);
    final f = figure;
    if (f != null) {
      _label(
        canvas,
        f,
        c + Offset(-h * 0.06, -h * 0.3),
        h * 0.17,
        Colors.white,
        center: true,
        spacing: -1.5,
      );
    }
    _sparkle(canvas, top + Offset(r * 1.3, -r * 0.9), h * 0.05);
  }

  /// 10+1: 흰 카드 열 장이 부채꼴로, 맨 앞 카드는 금박 "+1".
  void _cardFan(Canvas canvas, Offset c, double h) {
    const n = 11;
    final cw = h * 0.21;
    final ch = cw * 1.4;
    final pivot = c + Offset(h * 0.04, h * 0.56);
    for (var i = 0; i < n; i++) {
      final last = i == n - 1;
      final a = -0.5 + 1.0 * i / (n - 1);
      canvas.save();
      canvas.translate(pivot.dx, pivot.dy);
      canvas.rotate(a);
      final rect = RRect.fromRectAndRadius(
        Rect.fromCenter(center: Offset(0, -h * 0.52), width: cw, height: ch),
        Radius.circular(cw * 0.12),
      );
      canvas.drawRRect(
        rect.shift(const Offset(0, 2)),
        Paint()..color = _shade.withValues(alpha: 0.16),
      );
      if (last) {
        canvas.drawRRect(
          rect,
          Paint()
            ..shader = FoilTone.gold.gradient().createShader(rect.outerRect),
        );
        _label(
          canvas,
          '+1',
          rect.center,
          cw * 0.42,
          const Color(0xFF5A3D00),
          center: true,
        );
      } else {
        canvas.drawRRect(rect, Paint()..color = Colors.white);
        canvas.drawRRect(
          rect.deflate(cw * 0.1),
          Paint()
            ..style = PaintingStyle.stroke
            ..strokeWidth = 1
            ..color = poster.field.withValues(alpha: 0.45),
        );
        canvas.drawCircle(
          rect.center,
          cw * 0.14,
          Paint()..color = poster.field.withValues(alpha: 0.75),
        );
      }
      canvas.restore();
    }
  }

  /// 천장: 흰 반원 게이지 + 금빛 끝 + "SSR 확정".
  void _gauge(Canvas canvas, Offset c, double h) {
    final r = h * 0.29;
    final rect = Rect.fromCircle(center: c + Offset(0, h * 0.06), radius: r);
    const start = math.pi * 0.8;
    const sweep = math.pi * 1.4;
    final stroke = h * 0.075;
    canvas.drawArc(
      rect,
      start,
      sweep,
      false,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = stroke
        ..strokeCap = StrokeCap.round
        ..color = Colors.white.withValues(alpha: 0.3),
    );
    canvas.drawArc(
      rect,
      start,
      sweep * 0.78,
      false,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = stroke
        ..strokeCap = StrokeCap.round
        ..color = Colors.white,
    );
    const end = start + sweep * 0.78;
    final head = rect.center + Offset(math.cos(end), math.sin(end)) * r;
    canvas.drawCircle(
      head,
      stroke * 0.85,
      Paint()
        ..shader = FoilTone.gold.gradient().createShader(
          Rect.fromCircle(center: head, radius: stroke),
        ),
    );
    for (var i = 0; i <= 8; i++) {
      final a = start + sweep * i / 8;
      final dir = Offset(math.cos(a), math.sin(a));
      canvas.drawLine(
        rect.center + dir * (r - stroke * 1.1),
        rect.center + dir * (r - stroke * 1.55),
        Paint()
          ..strokeWidth = 1.4
          ..strokeCap = StrokeCap.round
          ..color = Colors.white.withValues(alpha: 0.7),
      );
    }
    _label(canvas, 'SSR', rect.center, h * 0.15, Colors.white, center: true);
    _label(
      canvas,
      '확정',
      rect.center + Offset(0, h * 0.13),
      h * 0.065,
      Colors.white.withValues(alpha: 0.85),
      center: true,
      spacing: 0,
    );
  }

  void _sparkleAt(Canvas canvas, Offset p, double s, Color color) {
    final path = Path()
      ..moveTo(p.dx, p.dy - s)
      ..quadraticBezierTo(p.dx, p.dy, p.dx + s, p.dy)
      ..quadraticBezierTo(p.dx, p.dy, p.dx, p.dy + s)
      ..quadraticBezierTo(p.dx, p.dy, p.dx - s, p.dy)
      ..quadraticBezierTo(p.dx, p.dy, p.dx, p.dy - s);
    canvas.drawPath(path, Paint()..color = color);
  }

  void _sparkle(Canvas canvas, Offset p, double s) {
    final path = Path()
      ..moveTo(p.dx, p.dy - s)
      ..quadraticBezierTo(p.dx, p.dy, p.dx + s, p.dy)
      ..quadraticBezierTo(p.dx, p.dy, p.dx, p.dy + s)
      ..quadraticBezierTo(p.dx, p.dy, p.dx - s, p.dy)
      ..quadraticBezierTo(p.dx, p.dy, p.dx, p.dy - s);
    canvas.drawPath(path, Paint()..color = Colors.white);
  }

  void _label(
    Canvas canvas,
    String text,
    Offset at,
    double size,
    Color color, {
    bool center = false,
    double spacing = -0.5,
  }) {
    final tp = TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(
          fontFamily: AppText.family,
          fontSize: size,
          fontWeight: FontWeight.w900,
          height: 1,
          letterSpacing: spacing,
          color: color,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    tp.paint(canvas, center ? at - Offset(tp.width / 2, tp.height / 2) : at);
  }

  @override
  bool shouldRepaint(covariant _PosterPainter old) =>
      old.poster.field != poster.field ||
      old.poster.pack != poster.pack ||
      old.motif != motif ||
      old.figure != figure;
}
