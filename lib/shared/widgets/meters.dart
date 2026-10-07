import 'package:flutter/material.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_typography.dart';
import '../../core/utils/format.dart';

/// 실재고 막대: 판매 수량 / 전체 수량. 서버 숫자만 그린다.
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
        ? AppColors.textTertiary
        : hot
        ? AppColors.danger
        : AppColors.text;
    final label = soldOut ? '품절' : '남은 ${formatNumber(left)}개';
    final pct = '${(ratio * 100).floor()}%';
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
                style: AppText.num(compact ? AppText.micro : AppText.caption)
                    .copyWith(
                      color: hot ? AppColors.danger : AppColors.textSecondary,
                      fontWeight: FontWeight.w700,
                    ),
              ),
            ),
            Text(
              compact ? pct : '${formatNumber(sold)} / ${formatNumber(total)}',
              style: AppText.num(
                compact ? AppText.micro : AppText.caption,
              ).copyWith(color: AppColors.textTertiary),
            ),
          ],
        ),
        SizedBox(height: compact ? 5 : 7),
        _Bar(ratio: ratio, color: fill, height: compact ? 3 : 4),
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
              if (w > 0)
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

/// 빛나는 게이지(천장 진행도). 25/50/75% 눈금과 끝점의 빛 알갱이.
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
    this.height = 8,
    this.ticks = 4,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: height + 10,
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
    // 눈금.
    final tickPaint = Paint()
      ..color = AppColors.canvas.withValues(alpha: 0.9)
      ..strokeWidth = 1.5;
    for (var i = 1; i < ticks; i++) {
      final x = size.width * i / ticks;
      canvas.drawLine(
        Offset(x, y - barHeight / 2),
        Offset(x, y + barHeight / 2),
        tickPaint,
      );
    }
    if (progress <= 0) return;
    final w = (size.width * progress).clamp(barHeight, size.width);
    final fill = RRect.fromLTRBR(0, y - barHeight / 2, w, y + barHeight / 2, r);
    // 후광.
    canvas.drawRRect(
      fill.inflate(1),
      Paint()
        ..color = color.withValues(alpha: 0.45)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 6),
    );
    canvas.drawRRect(
      fill,
      Paint()
        ..shader = LinearGradient(
          colors: [Color.lerp(color, Colors.black, 0.25)!, color, highlight],
          stops: const [0, 0.7, 1],
        ).createShader(fill.outerRect),
    );
    // 다시 눈금(채운 면 위에 얇게).
    for (var i = 1; i < ticks; i++) {
      final x = size.width * i / ticks;
      if (x >= w) break;
      canvas.drawLine(
        Offset(x, y - barHeight / 2),
        Offset(x, y + barHeight / 2),
        Paint()
          ..color = Colors.black.withValues(alpha: 0.25)
          ..strokeWidth = 1,
      );
    }
    // 끝점 빛 알갱이.
    final head = Offset(w - barHeight / 2, y);
    canvas.drawCircle(
      head,
      barHeight * 1.1,
      Paint()
        ..color = highlight.withValues(alpha: 0.55)
        ..maskFilter = MaskFilter.blur(BlurStyle.normal, barHeight * 0.8),
    );
    canvas.drawCircle(head, barHeight * 0.32, Paint()..color = Colors.white);
  }

  @override
  bool shouldRepaint(covariant _GlowMeterPainter old) =>
      old.progress != progress || old.color != color;
}
