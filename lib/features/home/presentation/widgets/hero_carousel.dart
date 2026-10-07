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
import '../../../../shared/widgets/vault_art.dart';
import '../../domain/home_banner.dart';

/// 홈 최상단 배너 캐러셀(`GET /banners`).
///
/// 배너 대부분에 이미지가 없어서, 서버 색(accentColorHex)·배지·제목만으로
/// 완성되는 타이포그래픽 배너를 그린다: 박스 색 빛 + 기요셰 각인 +
/// 링크 종류별 그래픽 모티프 + 배지 글자를 크게 새긴 외곽선 워터마크.
/// 4.5초마다 넘어가고, 손으로 넘기는 동안은 멈춘다.
class HeroCarousel extends StatefulWidget {
  final List<HomeBanner> banners;
  final ValueChanged<HomeBanner> onTap;

  /// GACHA 배너의 박스 분류(모티프 각인용). 모르면 null.
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
  late final PageController _page = PageController(viewportFraction: 0.91);

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
        duration: const Duration(milliseconds: 520),
        curve: Curves.easeInOutCubic,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final banners = widget.banners;
    return SizedBox(
      height: 214,
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
              padding: const EdgeInsets.symmetric(horizontal: 5),
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

enum _Motif { vault, attendance, coins, cards, gauge, rosette }

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
        return _Motif.vault;
      case BannerLinkType.attendance:
        return _Motif.attendance;
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

  /// 배지에서 워터마크로 새길 짧은 라틴 문자열("10+1", "DREAM", "OPEN").
  String? get _watermark {
    final badge = banner.badge;
    if (badge == null) return null;
    final latin = RegExp(r'[A-Za-z0-9+%]+').allMatches(badge).map((m) => m[0]!);
    final word = latin.isEmpty
        ? null
        : latin.reduce((a, b) => a.length >= b.length ? a : b);
    if (word == null || word.length < 2 || word.length > 6) return null;
    return word.toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final tone = vaultTone(banner.accent ?? AppColors.brand);
    final hasImage = banner.imageUrl != null && banner.imageUrl!.isNotEmpty;
    final art = _TypeArt(
      tone: tone,
      motif: _motif,
      watermark: _watermark,
      category: category,
    );

    return GestureDetector(
      onTap: onTap,
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
                    colors: [Color(0xE6000000), Color(0x00000000)],
                    stops: [0.25, 0.85],
                  ),
                ),
              ),
            // 얇은 윗변 하이라이트.
            DecoratedBox(
              decoration: BoxDecoration(
                borderRadius: Radii.hero,
                border: Border.all(color: Colors.white.withValues(alpha: 0.07)),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 20, 16, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (banner.badge != null)
                    _BadgeChip(text: banner.badge!, tone: tone),
                  const Spacer(),
                  FractionallySizedBox(
                    widthFactor: 0.62,
                    alignment: Alignment.centerLeft,
                    child: Text(
                      keepAll(banner.title),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.hero.copyWith(
                        fontSize: 24,
                        height: 1.2,
                        letterSpacing: -1.0,
                        color: Colors.white,
                      ),
                    ),
                  ),
                  if (banner.subtitle != null) ...[
                    const SizedBox(height: 6),
                    FractionallySizedBox(
                      widthFactor: 0.64,
                      alignment: Alignment.centerLeft,
                      child: Text(
                        keepAll(banner.subtitle!),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.callout.copyWith(
                          color: Colors.white.withValues(alpha: 0.72),
                          height: 1.4,
                        ),
                      ),
                    ),
                  ],
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      if (banner.endLabel != null)
                        _MetaChip(
                          icon: Icons.schedule_rounded,
                          text: banner.endLabel!,
                        ),
                      const Spacer(),
                      _Counter(index: index, count: count),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TypeArt extends StatelessWidget {
  final Color tone;
  final _Motif motif;
  final String? watermark;
  final ProductCategory? category;

  const _TypeArt({
    required this.tone,
    required this.motif,
    required this.watermark,
    required this.category,
  });

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color.lerp(const Color(0xFF0E0E11), tone, 0.10)!,
            const Color(0xFF0C0C0F),
            Color.lerp(const Color(0xFF0C0C0F), tone, 0.16)!,
          ],
          stops: const [0, 0.5, 1],
        ),
      ),
      child: CustomPaint(
        painter: _MotifPainter(
          tone: tone,
          motif: motif,
          watermark: watermark,
          category: category,
        ),
      ),
    );
  }
}

class _MotifPainter extends CustomPainter {
  final Color tone;
  final _Motif motif;
  final String? watermark;
  final ProductCategory? category;

  _MotifPainter({
    required this.tone,
    required this.motif,
    required this.watermark,
    required this.category,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final focus = Offset(size.width * 0.79, size.height * 0.45);
    // 빛.
    final bloom = Rect.fromCircle(center: focus, radius: size.height * 1.05);
    canvas.drawCircle(
      focus,
      size.height * 1.05,
      Paint()
        ..shader = RadialGradient(
          colors: [
            tone.withValues(alpha: 0.42),
            tone.withValues(alpha: 0.10),
            Colors.transparent,
          ],
          stops: const [0, 0.45, 1],
        ).createShader(bloom),
    );
    // 기요셰.
    GuillochePainter(
      color: tone,
      opacity: 0.13,
      rings: 30,
      center: Offset(focus.dx / size.width, focus.dy / size.height),
      scale: 1.05,
    ).paint(canvas, size);

    // 외곽선 워터마크.
    final wm = watermark;
    if (wm != null) {
      final tp = TextPainter(
        text: TextSpan(
          text: wm,
          style: TextStyle(
            fontFamily: AppText.family,
            fontSize: size.height * 0.62,
            fontWeight: FontWeight.w900,
            letterSpacing: -4,
            height: 1,
            foreground: Paint()
              ..style = PaintingStyle.stroke
              ..strokeWidth = 1.2
              ..color = Colors.white.withValues(alpha: 0.09),
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      tp.paint(
        canvas,
        Offset(size.width - tp.width + 10, size.height - tp.height * 0.86),
      );
    }

    final h = size.height;
    switch (motif) {
      case _Motif.vault:
        PackPainter(
          style: PackStyle.of(
            category: category ?? ProductCategory.jewel,
            accent: tone,
          ),
          scale: 0.5,
          center: Offset(focus.dx / size.width, focus.dy / size.height),
        ).paint(canvas, size);
      case _Motif.attendance:
        _paintCoinArc(canvas, focus, h);
      case _Motif.coins:
        _paintCoinStack(canvas, focus, h);
      case _Motif.cards:
        _paintCardFan(canvas, focus, h);
      case _Motif.gauge:
        _paintGauge(canvas, focus, h);
      case _Motif.rosette:
        break;
    }
  }

  void _paintCoinArc(Canvas canvas, Offset c, double h) {
    const n = 7;
    final r = h * 0.36;
    for (var i = 0; i < n; i++) {
      final a = math.pi * (1.1 + 0.8 * i / (n - 1));
      final p = c + Offset(math.cos(a) * r, math.sin(a) * r + h * 0.18);
      final last = i == n - 1;
      final rad = last ? h * 0.095 : h * 0.05 + i * 1.2;
      if (last) {
        canvas.drawCircle(
          p,
          rad * 2.2,
          Paint()
            ..color = tone.withValues(alpha: 0.35)
            ..maskFilter = MaskFilter.blur(BlurStyle.normal, rad),
        );
      }
      canvas.drawCircle(
        p,
        rad,
        Paint()
          ..shader = LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: last
                ? [Color.lerp(tone, Colors.white, 0.6)!, tone]
                : [const Color(0xFF3A3A42), const Color(0xFF1E1E23)],
          ).createShader(Rect.fromCircle(center: p, radius: rad)),
      );
      canvas.drawCircle(
        p,
        rad,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1
          ..color = tone.withValues(alpha: last ? 0.9 : 0.55),
      );
      if (!last) {
        // 체크 표시.
        final path = Path()
          ..moveTo(p.dx - rad * 0.4, p.dy)
          ..lineTo(p.dx - rad * 0.08, p.dy + rad * 0.32)
          ..lineTo(p.dx + rad * 0.45, p.dy - rad * 0.3);
        canvas.drawPath(
          path,
          Paint()
            ..style = PaintingStyle.stroke
            ..strokeWidth = 1.6
            ..strokeCap = StrokeCap.round
            ..color = tone.withValues(alpha: 0.8),
        );
      } else {
        _glyphText(canvas, 'G', p, rad * 1.1, const Color(0xFF1A1405));
      }
    }
  }

  void _paintCoinStack(Canvas canvas, Offset c, double h) {
    final w = h * 0.42;
    final t = h * 0.06;
    for (var i = 0; i < 5; i++) {
      final cy = c.dy + h * 0.2 - i * t * 1.05;
      final cx = c.dx + (i.isEven ? 0 : 3.0);
      final rect = Rect.fromCenter(
        center: Offset(cx, cy),
        width: w,
        height: w * 0.36,
      );
      final side = Rect.fromLTRB(
        rect.left,
        rect.center.dy,
        rect.right,
        rect.center.dy + t,
      );
      canvas.drawRect(
        side,
        Paint()..color = Color.lerp(const Color(0xFF16161A), tone, 0.35)!,
      );
      canvas.drawOval(
        rect.shift(Offset(0, t)),
        Paint()..color = Color.lerp(const Color(0xFF101013), tone, 0.3)!,
      );
      canvas.drawOval(
        rect,
        Paint()
          ..shader = LinearGradient(
            colors: [
              Color.lerp(tone, Colors.white, 0.55)!,
              tone,
              Color.lerp(tone, Colors.black, 0.3)!,
            ],
          ).createShader(rect),
      );
      canvas.drawOval(
        rect.deflate(w * 0.08),
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1
          ..color = Colors.black.withValues(alpha: 0.25),
      );
    }
    // 반짝임.
    _sparkle(canvas, c + Offset(w * 0.55, -h * 0.22), h * 0.07);
    _sparkle(canvas, c + Offset(-w * 0.6, -h * 0.05), h * 0.045);
  }

  void _paintCardFan(Canvas canvas, Offset c, double h) {
    const n = 11;
    final cw = h * 0.22;
    final ch = cw * 1.4;
    final pivot = c + Offset(-h * 0.12, h * 0.42);
    for (var i = 0; i < n; i++) {
      final last = i == n - 1;
      final a = -0.55 + 1.05 * i / (n - 1);
      canvas.save();
      canvas.translate(pivot.dx, pivot.dy);
      canvas.rotate(a);
      final rect = RRect.fromRectAndRadius(
        Rect.fromCenter(center: Offset(0, -h * 0.42), width: cw, height: ch),
        const Radius.circular(5),
      );
      if (last) {
        canvas.drawRRect(
          rect.inflate(4),
          Paint()
            ..color = tone.withValues(alpha: 0.5)
            ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 10),
        );
      }
      canvas.drawRRect(
        rect,
        Paint()
          ..shader = LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: last
                ? [
                    Color.lerp(tone, Colors.white, 0.5)!,
                    tone,
                    Color.lerp(tone, Colors.black, 0.35)!,
                  ]
                : [const Color(0xFF34343C), const Color(0xFF1B1B20)],
          ).createShader(rect.outerRect),
      );
      canvas.drawRRect(
        rect,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 0.8
          ..color = (last ? Colors.white : tone).withValues(
            alpha: last ? 0.6 : 0.35,
          ),
      );
      if (last) {
        _glyphText(
          canvas,
          '+1',
          rect.center,
          cw * 0.42,
          const Color(0xFF14101E),
        );
      }
      canvas.restore();
    }
  }

  void _paintGauge(Canvas canvas, Offset c, double h) {
    final r = h * 0.3;
    final rect = Rect.fromCircle(center: c, radius: r);
    const start = math.pi * 0.75;
    const sweep = math.pi * 1.5;
    canvas.drawArc(
      rect,
      start,
      sweep,
      false,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = h * 0.05
        ..strokeCap = StrokeCap.round
        ..color = const Color(0xFF26262C),
    );
    canvas.drawArc(
      rect,
      start,
      sweep,
      false,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = h * 0.05
        ..strokeCap = StrokeCap.round
        ..color = tone.withValues(alpha: 0.5)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 8),
    );
    canvas.drawArc(
      rect,
      start,
      sweep,
      false,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = h * 0.05
        ..strokeCap = StrokeCap.round
        ..shader = SweepGradient(
          startAngle: start,
          endAngle: start + sweep,
          colors: [
            Color.lerp(tone, Colors.black, 0.3)!,
            tone,
            Color.lerp(tone, Colors.white, 0.6)!,
          ],
        ).createShader(rect),
    );
    for (var i = 0; i <= 10; i++) {
      final a = start + sweep * i / 10;
      final p1 = c + Offset(math.cos(a), math.sin(a)) * (r - h * 0.07);
      final p2 = c + Offset(math.cos(a), math.sin(a)) * (r - h * 0.1);
      canvas.drawLine(
        p1,
        p2,
        Paint()
          ..strokeWidth = 1
          ..color = Colors.white.withValues(alpha: 0.35),
      );
    }
    _glyphText(
      canvas,
      'SSR',
      c,
      h * 0.12,
      Color.lerp(tone, Colors.white, 0.7)!,
    );
  }

  void _sparkle(Canvas canvas, Offset p, double s) {
    final paint = Paint()..color = Colors.white.withValues(alpha: 0.85);
    final path = Path()
      ..moveTo(p.dx, p.dy - s)
      ..quadraticBezierTo(p.dx, p.dy, p.dx + s, p.dy)
      ..quadraticBezierTo(p.dx, p.dy, p.dx, p.dy + s)
      ..quadraticBezierTo(p.dx, p.dy, p.dx - s, p.dy)
      ..quadraticBezierTo(p.dx, p.dy, p.dx, p.dy - s);
    canvas.drawPath(path, paint);
  }

  void _glyphText(
    Canvas canvas,
    String text,
    Offset center,
    double size,
    Color color,
  ) {
    final tp = TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(
          fontFamily: AppText.family,
          fontSize: size,
          fontWeight: FontWeight.w900,
          height: 1,
          letterSpacing: -0.5,
          color: color,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    tp.paint(canvas, center - Offset(tp.width / 2, tp.height / 2));
  }

  @override
  bool shouldRepaint(covariant _MotifPainter old) =>
      old.tone != tone ||
      old.motif != motif ||
      old.watermark != watermark ||
      old.category != category;
}

class _BadgeChip extends StatelessWidget {
  final String text;
  final Color tone;
  const _BadgeChip({required this.text, required this.tone});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 24,
      padding: const EdgeInsets.symmetric(horizontal: 9),
      decoration: BoxDecoration(
        color: tone.withValues(alpha: 0.16),
        border: Border.all(color: tone.withValues(alpha: 0.6)),
        borderRadius: Radii.pill,
      ),
      child: Center(
        widthFactor: 1,
        child: Text(
          text,
          style: AppText.micro.copyWith(
            color: Color.lerp(tone, Colors.white, 0.55),
            fontSize: 11.5,
            fontWeight: FontWeight.w800,
            letterSpacing: 0.3,
            height: 1,
          ),
        ),
      ),
    );
  }
}

class _MetaChip extends StatelessWidget {
  final IconData icon;
  final String text;
  const _MetaChip({required this.icon, required this.text});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 24,
      padding: const EdgeInsets.symmetric(horizontal: 8),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.4),
        borderRadius: Radii.pill,
        border: Border.all(color: Colors.white.withValues(alpha: 0.12)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: Colors.white.withValues(alpha: 0.8)),
          const SizedBox(width: 4),
          Text(
            text,
            style: AppText.num(
              AppText.micro,
            ).copyWith(color: Colors.white.withValues(alpha: 0.9), height: 1),
          ),
        ],
      ),
    );
  }
}

/// "1 / 6".
class _Counter extends StatelessWidget {
  final int index;
  final int count;
  const _Counter({required this.index, required this.count});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 24,
      padding: const EdgeInsets.symmetric(horizontal: 9),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.45),
        borderRadius: Radii.pill,
      ),
      child: Center(
        widthFactor: 1,
        child: Text.rich(
          TextSpan(
            children: [
              TextSpan(
                text: '${index + 1}',
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w800,
                ),
              ),
              TextSpan(
                text: '  /  $count',
                style: TextStyle(color: Colors.white.withValues(alpha: 0.55)),
              ),
            ],
          ),
          style: AppText.num(AppText.micro).copyWith(height: 1),
        ),
      ),
    );
  }
}
