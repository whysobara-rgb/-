import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'order_models.dart';
import 'capsule_shell.dart';

/// Presentation only: receives a confirmed prize and never performs a draw.
class PrizeReveal extends StatefulWidget {
  final Prize prize;
  const PrizeReveal({super.key, required this.prize});

  @override
  State<PrizeReveal> createState() => _PrizeRevealState();
}

class _PrizeRevealState extends State<PrizeReveal>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1800),
  );
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.disableAnimationsOf(context)) {
      _controller.value = 1;
      _started = true;
    } else if (!_started) {
      _started = true;
      _controller.forward();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final prize = widget.prize;
    final accent = prize.premium
        ? const Color(0xFFFFD58A)
        : const Color(0xFFB9A4FF);
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        final reveal = Curves.easeOutCubic.transform(
          ((_controller.value - 0.38) / 0.62).clamp(0.0, 1.0),
        );
        final opening = Curves.easeInOutCubic.transform(
          ((_controller.value - 0.15) / 0.5).clamp(0.0, 1.0),
        );
        final revealed = reveal > 0.2;
        return Container(
          width: double.infinity,
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(28),
            gradient: const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [Color(0xFF29203E), Color(0xFF101018)],
            ),
            border: Border.all(color: accent.withValues(alpha: 0.45)),
          ),
          child: Column(
            children: [
              Text(
                revealed
                    ? (prize.premium ? 'PREMIUM COLLECTION' : 'YOUR COLLECTION')
                    : 'GACHI GACHA',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: accent,
                  letterSpacing: 2,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 20),
              SizedBox(
                height: 230,
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    ExcludeSemantics(
                      child: CustomPaint(
                        size: const Size(230, 230),
                        painter: _Rays(accent, reveal),
                      ),
                    ),
                    if (opening < 1)
                      ExcludeSemantics(
                        child: Opacity(
                          opacity: 1 - opening,
                          child: Transform.rotate(
                            angle:
                                math.sin(_controller.value * math.pi * 8) *
                                0.06 *
                                (1 - opening),
                            child: CustomPaint(
                              size: const Size(230, 230),
                              painter: CapsuleShellPainter(
                                opening: opening,
                                accent: accent,
                              ),
                            ),
                          ),
                        ),
                      ),
                    Transform.scale(
                      scale: 0.82 + reveal * 0.18,
                      child: Opacity(
                        opacity: reveal,
                        child: Container(
                          width: 160,
                          height: 190,
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: const Color(0xFFFAF8FF),
                            borderRadius: BorderRadius.circular(20),
                            border: Border.all(color: accent, width: 2),
                            boxShadow: [
                              BoxShadow(
                                color: accent.withValues(alpha: 0.25),
                                blurRadius: 32,
                                spreadRadius: 4,
                              ),
                            ],
                          ),
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(10),
                            child:
                                prize.imageUrl == null ||
                                    prize.imageUrl!.isEmpty
                                ? const Icon(
                                    Icons.card_giftcard_rounded,
                                    size: 72,
                                    color: Color(0xFF554074),
                                  )
                                : Image.network(
                                    prize.imageUrl!,
                                    fit: BoxFit.contain,
                                    errorBuilder: (_, error, stack) =>
                                        const Icon(
                                          Icons.card_giftcard_rounded,
                                          size: 72,
                                          color: Color(0xFF554074),
                                        ),
                                  ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              Semantics(
                liveRegion: true,
                child: Text(
                  revealed ? prize.name : '캡슐이 열리는 순간',
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 24,
                    height: 1.3,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Text(
                revealed ? prize.displayGrade : '나의 새로운 컬렉션을 만나보세요',
                style: TextStyle(
                  color: accent,
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                revealed
                    ? '전환 시 ${prize.conversionGP.toString().replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+(?!\d))'), (m) => '${m[1]},')} GP'
                    : ' ',
                style: const TextStyle(color: Color(0xFFD8D3E3)),
              ),
              const SizedBox(height: 16),
              if (_controller.value < 1)
                TextButton(
                  style: TextButton.styleFrom(foregroundColor: Colors.white),
                  onPressed: () => _controller.value = 1,
                  child: const Text('연출 건너뛰기'),
                )
              else
                const Text(
                  '내 보관함에 저장 완료',
                  style: TextStyle(color: Color(0xFFD8D3E3)),
                ),
            ],
          ),
        );
      },
    );
  }
}

class _Rays extends CustomPainter {
  final Color color;
  final double progress;
  const _Rays(this.color, this.progress);

  @override
  void paint(Canvas canvas, Size size) {
    final center = size.center(Offset.zero);
    final paint = Paint()
      ..color = color.withValues(alpha: (1 - progress * 0.65) * 0.6)
      ..strokeWidth = 2
      ..strokeCap = StrokeCap.round;
    for (var i = 0; i < 16; i++) {
      final angle = i * math.pi / 8;
      final direction = Offset(math.cos(angle), math.sin(angle));
      canvas.drawLine(
        center + direction * (80 + progress * 15),
        center + direction * (92 + progress * 23),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _Rays oldDelegate) =>
      oldDelegate.progress != progress || oldDelegate.color != color;
}
