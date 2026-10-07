import 'package:flutter/material.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_typography.dart';
import '../../core/utils/format.dart';

/// 실재고 막대: 판매 수량 / 전체 수량. 서버 숫자만 그린다.
///
/// 평소에는 잉크 막대, 70% 이상 팔리면 브랜드 레드(마감 임박),
/// 품절이면 회색.
class StockBar extends StatelessWidget {
  final int total;
  final int sold;
  final bool soldOut;

  /// 카드용 얇은 막대 + 한 줄 라벨.
  final bool compact;

  const StockBar({
    super.key,
    required this.total,
    required this.sold,
    this.soldOut = false,
    this.compact = true,
  });

  double get ratio => total <= 0 ? 0 : (sold.clamp(0, total) / total);

  @override
  Widget build(BuildContext context) {
    final left = (total - sold).clamp(0, total);
    final hot = !soldOut && ratio >= 0.7;
    final fill = soldOut
        ? AppColors.textDisabled
        : hot
        ? AppColors.brand
        : AppColors.text;
    final label = soldOut ? '품절' : '남은 ${formatNumber(left)}개';
    final pct = '${(ratio * 100).floor()}% 판매';
    final base = compact ? AppText.micro : AppText.caption;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppText.num(base).copyWith(
                  color: hot ? AppColors.brand : AppColors.text,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            Text(
              compact ? pct : '${formatNumber(sold)} / ${formatNumber(total)}',
              style: AppText.num(base).copyWith(
                color: hot ? AppColors.brand : AppColors.textSecondary,
                fontWeight: hot ? FontWeight.w700 : FontWeight.w500,
              ),
            ),
          ],
        ),
        SizedBox(height: compact ? 5 : 8),
        _Bar(ratio: ratio, color: fill, height: compact ? 4 : 6),
      ],
    );
  }
}

class _Bar extends StatelessWidget {
  final double ratio;
  final Color color;
  final double height;
  const _Bar({required this.ratio, required this.color, required this.height});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: height,
      child: LayoutBuilder(
        builder: (context, c) {
          final w = c.maxWidth * ratio.clamp(0.0, 1.0);
          return Stack(
            children: [
              Container(
                decoration: BoxDecoration(
                  color: AppColors.high,
                  borderRadius: BorderRadius.circular(height),
                ),
              ),
              if (w > 0 && c.maxWidth >= height)
                Container(
                  width: w.clamp(height, c.maxWidth),
                  decoration: BoxDecoration(
                    color: color,
                    borderRadius: BorderRadius.circular(height),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

/// 천장 게이지: 금박 그라데이션 막대 + 25/50/75% 눈금 + 끝점의 흰 알갱이.
/// 블러 없이 그라데이션만 쓴다.
class GlowMeter extends StatelessWidget {
  final double progress;
  final Color color;
  final Color? highlight;
  final double height;
  final int ticks;

  const GlowMeter({
    super.key,
    required this.progress,
    this.color = AppColors.raritySSR,
    this.highlight,
    this.height = 10,
    this.ticks = 4,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      height: height + 8,
      child: CustomPaint(
        painter: _GlowMeterPainter(
          progress: progress.clamp(0.0, 1.0),
          color: color,
          highlight: highlight ?? Color.lerp(color, Colors.white, 0.6)!,
          barHeight: height,
          ticks: ticks,
        ),
      ),
    );
  }
}

class _GlowMeterPainter extends CustomPainter {
  final double progress;
  final Color color;
  final Color highlight;
  final double barHeight;
  final int ticks;

  _GlowMeterPainter({
    required this.progress,
    required this.color,
    required this.highlight,
    required this.barHeight,
    required this.ticks,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final y = size.height / 2;
    final r = Radius.circular(barHeight / 2);
    final track = RRect.fromLTRBR(
      0,
      y - barHeight / 2,
      size.width,
      y + barHeight / 2,
      r,
    );
    canvas.drawRRect(track, Paint()..color = AppColors.high);
    final tickPaint = Paint()
      ..color = Colors.white
      ..strokeWidth = 2;
    for (var i = 1; i < ticks; i++) {
      final x = size.width * i / ticks;
      canvas.drawLine(
        Offset(x, y - barHeight / 2),
        Offset(x, y + barHeight / 2),
        tickPaint,
      );
    }
    if (progress <= 0 || size.width < barHeight) return;
    final w = (size.width * progress).clamp(barHeight, size.width);
    final fill = RRect.fromLTRBR(0, y - barHeight / 2, w, y + barHeight / 2, r);
    // 아래로 번지는 옅은 그림자(그라데이션).
    final under = Rect.fromLTRB(0, y, w, y + barHeight * 1.1);
    canvas.drawRect(
      under,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [color.withValues(alpha: 0.28), color.withValues(alpha: 0)],
        ).createShader(under),
    );
    canvas.drawRRect(
      fill,
      Paint()
        ..shader = LinearGradient(
          colors: [Color.lerp(color, Colors.black, 0.18)!, color, highlight],
          stops: const [0, 0.7, 1],
        ).createShader(fill.outerRect),
    );
    // 윗변 반사.
    canvas.drawLine(
      Offset(barHeight / 2, y - barHeight * 0.22),
      Offset(w - barHeight / 2, y - barHeight * 0.22),
      Paint()
        ..color = Colors.white.withValues(alpha: 0.45)
        ..strokeWidth = barHeight * 0.18
        ..strokeCap = StrokeCap.round,
    );
    for (var i = 1; i < ticks; i++) {
      final x = size.width * i / ticks;
      if (x >= w) break;
      canvas.drawLine(
        Offset(x, y - barHeight / 2),
        Offset(x, y + barHeight / 2),
        Paint()
          ..color = Colors.white.withValues(alpha: 0.6)
          ..strokeWidth = 1.5,
      );
    }
    final head = Offset(w - barHeight / 2, y);
    canvas.drawCircle(head, barHeight * 0.62, Paint()..color = Colors.white);
    canvas.drawCircle(head, barHeight * 0.3, Paint()..color = color);
  }

  @override
  bool shouldRepaint(covariant _GlowMeterPainter old) =>
      old.progress != progress || old.color != color;
}
