import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import '../../../../core/domain/rarity.dart';
import '../../../../core/feedback/haptics.dart';
import '../../../../core/feedback/sfx.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/utils/format.dart';
import '../../domain/draw_result.dart';
import '../../domain/reveal_timeline.dart';
import 'gacha_fx_painters.dart';
import 'reveal_card.dart';

/// 10+1 카드 펼치기.
///
/// - 카드는 낮은 등급부터 놓이고, 가장 좋은 카드가 맨 끝([RevealDeck.order]).
/// - 실제로 SR/SSR인 카드는 뒤집기 전부터 그 등급 색으로 빛난다.
/// - 탭해서 한 장씩, 또는 "모두 뒤집기". N/R은 빠르게 톡톡,
///   마지막 카드가 SR 이상이면 화면 가운데로 끌어와 클라이맥스 연출.
/// - 보너스·천장 라벨은 뒷면·앞면 모두에 보인다.
class RevealSpread extends StatefulWidget {
  final List<DrawResult> ordered;
  final Haptics haptics;
  final VoidCallback onShowResult;

  /// 카드가 튀어나오는 원점(박스 위치, 이 위젯 좌표계 비율 0~1).
  final Offset origin;

  const RevealSpread({
    super.key,
    required this.ordered,
    required this.haptics,
    required this.onShowResult,
    this.origin = const Offset(0.5, 0.42),
  });

  @override
  State<RevealSpread> createState() => _RevealSpreadState();
}

class _RevealSpreadState extends State<RevealSpread>
    with SingleTickerProviderStateMixin {
  late final Ticker _ticker;
  double _now = 0;

  late final List<double?> _flipAt = List.filled(widget.ordered.length, null);
  final List<Timer> _timers = [];

  /// 포커스 연출 시작 시각(ms). null이면 포커스 전.
  double? _focusStart;
  RevealTimeline? _focusTl;
  bool _focusDismissed = false;
  final Set<String> _firedFocusCues = {};

  late final List<GoldLeaf> _leaves = GoldLeafPainter.generate(54);

  SfxPlayer get _sfx => SfxPlayer.instance;
  int get _last => widget.ordered.length - 1;
  bool get _focusCard => RevealDeck.bestGetsFocus(widget.ordered);

  static const _entryStagger = 60.0;
  static const _entryMs = 520.0;

  @override
  void initState() {
    super.initState();
    _ticker = createTicker((elapsed) {
      setState(() => _now = elapsed.inMicroseconds / 1000);
      _maybeFocusCues();
    })..start();
    _sfx.play(Sfx.summon, volume: 0.8);
  }

  @override
  void dispose() {
    for (final t in _timers) {
      t.cancel();
    }
    _ticker.dispose();
    super.dispose();
  }

  double get _entryDone => _entryStagger * widget.ordered.length + _entryMs;

  static double _flipMs(Rarity r) => switch (r) {
    Rarity.n => 240,
    Rarity.r => 300,
    Rarity.sr => 460,
    Rarity.ssr => 520,
  };

  bool _isFlipped(int i) {
    if (_focusCard && i == _last) {
      final tl = _focusTl;
      final start = _focusStart;
      if (tl == null || start == null) return false;
      return _now - start >= tl.startOf(RevealPhase.emerge);
    }
    final at = _flipAt[i];
    return at != null && _now - at >= _flipMs(widget.ordered[i].rarity);
  }

  bool get _allRevealed {
    for (var i = 0; i < widget.ordered.length; i++) {
      if (!_isFlipped(i)) return false;
    }
    final tl = _focusTl;
    if (_focusCard && tl != null && _now - _focusStart! < tl.totalMs) {
      return false;
    }
    return true;
  }

  bool get _focusActive =>
      _focusStart != null && !_focusDismissed && _focusCard;

  void _tapCard(int i) {
    if (_now < _entryDone * 0.6) return;
    if (_focusCard && i == _last) {
      _startFocus();
      return;
    }
    _flip(i);
  }

  void _flip(int i) {
    if (_flipAt[i] != null) return;
    final r = widget.ordered[i].rarity;
    setState(() => _flipAt[i] = _now);
    _sfx.play(Sfx.flip, volume: 0.55);
    _timers.add(
      Timer(Duration(milliseconds: _flipMs(r).round()), () {
        if (!mounted) return;
        widget.haptics.play(HapticPattern.reveal(r));
        switch (r) {
          case Rarity.n:
            _sfx.play(Sfx.pop, volume: 0.5);
          case Rarity.r:
            _sfx.play(Sfx.pop, volume: 0.7);
            _sfx.play(Sfx.step1, volume: 0.45);
          case Rarity.sr:
            _sfx.play(Sfx.step2, volume: 0.8);
          case Rarity.ssr:
            _sfx.play(Sfx.step3, volume: 0.9);
        }
      }),
    );
  }

  void _flipAll() {
    final flipped = <int>{
      for (var i = 0; i < widget.ordered.length; i++)
        if (_flipAt[i] != null) i,
    };
    final schedule = RevealDeck.flipAllSchedule(
      widget.ordered.map((r) => r.rarity).toList(),
      flipped,
    );
    var end = 0;
    for (final (index, at) in schedule) {
      end = at;
      _timers.add(
        Timer(Duration(milliseconds: at), () {
          if (mounted) _flip(index);
        }),
      );
    }
    if (_focusCard && _focusStart == null) {
      final last = schedule.isEmpty ? 0 : end + 200;
      _timers.add(
        Timer(Duration(milliseconds: last + RevealDeck.focusDelayMs), () {
          if (mounted) _startFocus();
        }),
      );
    }
    setState(() {});
  }

  void _startFocus() {
    if (_focusStart != null) {
      if (_focusDismissed) setState(() => _focusDismissed = false);
      return;
    }
    setState(() {
      _focusStart = _now;
      _focusTl = RevealTimeline.focus(widget.ordered[_last].rarity);
    });
  }

  void _maybeFocusCues() {
    final tl = _focusTl;
    final start = _focusStart;
    if (tl == null || start == null) return;
    final ms = _now - start;
    final r = tl.highest;
    void cue(String key, int at, VoidCallback fire) {
      if (ms >= at && _firedFocusCues.add(key)) fire();
    }

    cue('charge', 0, () {
      _sfx.play(Sfx.charge, volume: 0.8);
      widget.haptics.play(HapticPattern.charge);
    });
    cue('tension', tl.startOf(RevealPhase.tension), () {
      _sfx.stop(Sfx.charge);
      _sfx.play(Sfx.tick, volume: 0.8);
    });
    cue('climax', tl.startOf(RevealPhase.climax), () {
      _sfx.play(Sfx.impact);
      _sfx.play(r == Rarity.ssr ? Sfx.step3 : Sfx.step2);
      widget.haptics.play(HapticPattern.climax(r));
    });
    cue('emerge', tl.startOf(RevealPhase.emerge), () {
      _sfx.play(Sfx.flip, volume: 0.7);
    });
    final stampSeg = tl.segment(RevealPhase.stamp)!;
    cue(
      'stamp',
      stampSeg.startMs + (stampSeg.durationMs * RarityStamp.impactAt).round(),
      () {
        _sfx.play(Sfx.stamp);
        _sfx.play(r == Rarity.ssr ? Sfx.fanfare : Sfx.srSting);
        widget.haptics.play(HapticPattern.reveal(r));
      },
    );
  }

  // ── 레이아웃 ──────────────────────────────────────────────

  /// 4장씩 줄을 맞추고 마지막 줄은 가운데 정렬.
  List<Rect> _slots(Size size, double cardW) {
    final n = widget.ordered.length;
    const cols = 4;
    const gapX = 10.0;
    const gapY = 14.0;
    final cardH = cardW * 1.4;
    final rows = (n / cols).ceil();
    final gridH = rows * cardH + (rows - 1) * gapY;
    final top = (size.height - gridH) / 2 - 10;
    final rects = <Rect>[];
    for (var i = 0; i < n; i++) {
      final row = i ~/ cols;
      final inRow = math.min(cols, n - row * cols);
      final rowW = inRow * cardW + (inRow - 1) * gapX;
      final left = (size.width - rowW) / 2 + (i % cols) * (cardW + gapX);
      rects.add(Rect.fromLTWH(left, top + row * (cardH + gapY), cardW, cardH));
    }
    return rects;
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, c) {
        final size = c.biggest;
        final cardW = math.min(84.0, (size.width - Space.gutter * 2 - 30) / 4);
        final slots = _slots(size, cardW);
        final origin = Offset(
          size.width * widget.origin.dx,
          size.height * widget.origin.dy,
        );
        final pulse = (_now / 1400) % 1.0;
        final focusOn = _focusActive;

        return Stack(
          clipBehavior: Clip.none,
          children: [
            // 뒤집힌 R 이상 카드의 작은 충격파·불꽃.
            Positioned.fill(
              child: IgnorePointer(
                child: CustomPaint(
                  painter: _FlipBurstPainter(
                    now: _now,
                    flipAt: _flipAt,
                    rarities: widget.ordered.map((r) => r.rarity).toList(),
                    slots: slots,
                    flipMs: _flipMs,
                  ),
                ),
              ),
            ),
            for (var i = 0; i < widget.ordered.length; i++)
              _buildCard(i, slots[i], origin, cardW, pulse),
            if (focusOn) Positioned.fill(child: _buildFocus(size, slots)),
            Positioned(
              left: Space.gutter,
              right: Space.gutter,
              bottom: Space.x4,
              child: _buildActions(),
            ),
          ],
        );
      },
    );
  }

  Widget _buildCard(int i, Rect slot, Offset origin, double w, double pulse) {
    final result = widget.ordered[i];
    final r = result.rarity;
    final entry = ((_now - i * _entryStagger) / _entryMs).clamp(0.0, 1.0);
    final e = Curves.easeOutCubic.transform(entry);
    final from = origin - Offset(w / 2, w * 0.7);
    final pos = Offset.lerp(from, slot.topLeft, e)!;
    final spin = (1 - e) * (i.isEven ? -0.6 : 0.6);
    final scale = 0.35 + 0.65 * e;

    double flip = 0;
    final at = _flipAt[i];
    if (at != null) {
      flip = Curves.easeInOutCubic.transform(
        ((_now - at) / _flipMs(r)).clamp(0.0, 1.0),
      );
    }
    final isFocusCard = _focusCard && i == _last;
    if (isFocusCard && _focusStart != null) {
      flip = _isFlipped(i) ? 1 : 0;
      // 포커스 중에는 슬롯 자리를 비워 둔다.
      if (_focusActive) return const SizedBox.shrink();
    }
    // 뒤집히는 순간 살짝 튀어 오른다.
    final pop = at == null
        ? 0.0
        : math.sin(
            ((_now - at) / (_flipMs(r) + 120)).clamp(0.0, 1.0) * math.pi,
          );
    final labels = [if (result.isPity) '천장', if (result.isBonus) '보너스'];

    return Positioned(
      left: pos.dx,
      top: pos.dy - pop * (r.rank >= 2 ? 10 : 5),
      width: w,
      height: w * 1.4,
      child: Opacity(
        opacity: entry <= 0 ? 0 : (entry * 3).clamp(0.0, 1.0),
        child: Transform.rotate(
          angle: spin,
          child: Transform.scale(
            scale: scale * (1 + pop * 0.06),
            child: GestureDetector(
              onTap: () => _tapCard(i),
              child: FlipCard(
                flip: flip,
                front: RevealCardFace(result: result, width: w, compact: true),
                back: RevealCardBack(
                  width: w,
                  radius: 9,
                  glow: RevealDeck.glowsBeforeFlip(r) ? r : null,
                  pulse: pulse + i * 0.13,
                  labels: labels,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildActions() {
    final focusTl = _focusTl;
    final inFocus = _focusActive;
    if (inFocus &&
        focusTl != null &&
        _now - _focusStart! < focusTl.totalMs + 300) {
      return const SizedBox(height: 52);
    }
    final all = _allRevealed;
    final anyLeft = !all;
    return Row(
      children: [
        if (inFocus) ...[
          Expanded(
            child: OutlinedButton(
              onPressed: () => setState(() => _focusDismissed = true),
              style: OutlinedButton.styleFrom(
                foregroundColor: Colors.white,
                side: BorderSide(color: Colors.white.withValues(alpha: 0.3)),
              ),
              child: const Text('카드 모두 보기'),
            ),
          ),
          const SizedBox(width: Space.x2),
        ],
        Expanded(
          child: FilledButton(
            onPressed: _now < _entryDone * 0.6
                ? null
                : anyLeft
                ? _flipAll
                : widget.onShowResult,
            child: Text(anyLeft ? '모두 뒤집기' : '결과 보기'),
          ),
        ),
      ],
    );
  }

  Widget _buildFocus(Size size, List<Rect> slots) {
    final tl = _focusTl!;
    final ms = _now - _focusStart!;
    final m = tl.at(ms);
    final r = tl.highest;
    final light = stageLight(r);
    final center = Offset(size.width / 2, size.height * 0.44);
    final slot = slots[_last];

    // 카드: 슬롯 → 가운데로 이동하며 커진다(차지 앞부분 350ms).
    final move = Curves.easeInOutCubic.transform((ms / 350).clamp(0.0, 1.0));
    const bigW = 210.0;
    final w = slot.width + (bigW - slot.width) * move;
    final cardCenter = Offset.lerp(slot.center, center, move)!;

    final climaxStart = tl.startOf(RevealPhase.climax).toDouble();
    final emergeStart = tl.startOf(RevealPhase.emerge).toDouble();
    final sinceClimax = ms - climaxStart;
    // 슬로모션: 카드가 뒤집히는 동안 파티클 시간이 0.32배로 흐른다.
    final virtualAge = sinceClimax <= 0
        ? 0.0
        : (math.min(ms, emergeStart) -
                  climaxStart +
                  math.max(0, ms - emergeStart) * 0.32) /
              1000;

    final charge = m.phase == RevealPhase.charge
        ? m.t
        : (m.phase == RevealPhase.tension ? 1.0 : 0.0);
    final dim = switch (m.phase) {
      RevealPhase.charge => 0.55 + 0.25 * move,
      RevealPhase.tension => 0.8 + 0.12 * m.t,
      _ => 0.85,
    };
    final shakeAmp = switch (m.phase) {
      RevealPhase.charge => RevealTimeline.shakeScale(r) * 0.5 * m.t * m.t,
      RevealPhase.tension => RevealTimeline.shakeScale(r) * 0.3,
      RevealPhase.climax =>
        RevealTimeline.shakeScale(r) * 2.4 * math.pow(1 - m.t, 2),
      _ => 0.0,
    };
    final shake =
        Offset(
          math.sin(ms * 0.091) + 0.6 * math.sin(ms * 0.137),
          math.cos(ms * 0.083) + 0.6 * math.cos(ms * 0.151),
        ) *
        shakeAmp.toDouble();

    double flip = 0;
    if (m.phase == RevealPhase.emerge) {
      flip = Curves.easeInOutCubic.transform(
        ((m.t - 0.1) / 0.8).clamp(0.0, 1.0),
      );
    } else if (m.phase == RevealPhase.stamp || ms >= tl.totalMs) {
      flip = 1;
    }
    final flash = sinceClimax >= 0 && sinceClimax < 260
        ? (1 - sinceClimax / 260) * (r == Rarity.ssr ? 0.95 : 0.8)
        : 0.0;
    final rays = ms < climaxStart
        ? 0.0
        : (r == Rarity.ssr ? 1.0 : 0.8) *
              (0.5 + 0.5 * ((ms - climaxStart) / 400).clamp(0.0, 1.0));
    final stampSeg = tl.segment(RevealPhase.stamp)!;
    final stampT = ((ms - stampSeg.startMs) / stampSeg.durationMs).clamp(
      0.0,
      1.0,
    );
    final done = ms >= tl.totalMs;
    final leafT = r == Rarity.ssr && sinceClimax > 0
        ? (virtualAge / 3.4).clamp(0.0, 1.0)
        : 0.0;
    final result = widget.ordered[_last];
    final sway = done
        ? Offset(math.sin(_now / 1300) * 0.3, math.cos(_now / 1700) * 0.2)
        : Offset.zero;

    return Stack(
      children: [
        Positioned.fill(
          child: GestureDetector(
            onTap: done ? () => setState(() => _focusDismissed = true) : null,
            child: ColoredBox(color: Colors.black.withValues(alpha: dim)),
          ),
        ),
        Positioned.fill(
          child: IgnorePointer(
            child: Transform.translate(
              offset: shake,
              child: Stack(
                children: [
                  Positioned.fill(
                    child: CustomPaint(
                      painter: LightRaysPainter(
                        rotation: _now / 4000,
                        intensity: rays,
                        color: light,
                        rays: r == Rarity.ssr ? 16 : 12,
                        origin: center,
                      ),
                    ),
                  ),
                  Positioned.fill(
                    child: CustomPaint(
                      painter: ConvergeParticlesPainter(
                        time: _now / 1000,
                        density: charge * 0.9,
                        color: light,
                        origin: cardCenter,
                        maxCount: 70,
                      ),
                    ),
                  ),
                  Positioned.fill(
                    child: CustomPaint(
                      painter: ShockwavePainter(
                        origin: center,
                        color: light,
                        rings: [
                          for (final (delay, w) in const [
                            (0.0, 1.4),
                            (130.0, 1.0),
                            (280.0, 0.7),
                          ])
                            ((sinceClimax - delay) / 900, w),
                        ],
                      ),
                    ),
                  ),
                  Positioned(
                    left: cardCenter.dx - w / 2,
                    top: cardCenter.dy - w * 0.7,
                    child: FlipCard(
                      flip: flip,
                      tilt: sway,
                      front: RevealCardFace(
                        result: result,
                        width: w,
                        tilt: sway,
                      ),
                      back: RevealCardBack(
                        width: w,
                        glow: r,
                        pulse: (_now / 900) % 1.0,
                        charge: charge,
                        radius: 9 + 7 * move,
                      ),
                    ),
                  ),
                  if (stampT > 0)
                    Positioned(
                      left: cardCenter.dx + w * 0.5 - 78,
                      top: cardCenter.dy - w * 0.7 - 46,
                      child: RarityStamp(rarity: r, t: stampT, size: 62),
                    ),
                  Positioned.fill(
                    child: CustomPaint(
                      painter: SparkBurstPainter(
                        age: virtualAge,
                        color: light,
                        count: RevealTimeline.sparkCount(r),
                        origin: center,
                      ),
                    ),
                  ),
                  if (leafT > 0)
                    Positioned.fill(
                      child: CustomPaint(
                        painter: GoldLeafPainter(
                          progress: leafT,
                          pieces: _leaves,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
        if (flash > 0)
          Positioned.fill(
            child: IgnorePointer(
              child: ColoredBox(
                color: Color.lerp(
                  Colors.white,
                  light,
                  0.2,
                )!.withValues(alpha: flash),
              ),
            ),
          ),
        if (done)
          Positioned(
            left: Space.gutter,
            right: Space.gutter,
            top: center.dy + bigW * 0.7 + 18,
            child: _FocusCaption(result: result),
          ),
      ],
    );
  }
}

class _FocusCaption extends StatelessWidget {
  final DrawResult result;
  const _FocusCaption({required this.result});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          result.name,
          textAlign: TextAlign.center,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: AppText.title1.copyWith(color: Colors.white),
        ),
        const SizedBox(height: 4),
        Text(
          '정가 ${formatWon(result.estimatedValue)}',
          style: AppText.num(
            AppText.callout,
          ).copyWith(color: result.rarity.light, fontWeight: FontWeight.w700),
        ),
      ],
    );
  }
}

/// 뒤집힌 카드 자리의 작은 충격파 + (SR 이상) 불꽃.
class _FlipBurstPainter extends CustomPainter {
  final double now;
  final List<double?> flipAt;
  final List<Rarity> rarities;
  final List<Rect> slots;
  final double Function(Rarity) flipMs;

  _FlipBurstPainter({
    required this.now,
    required this.flipAt,
    required this.rarities,
    required this.slots,
    required this.flipMs,
  });

  @override
  void paint(Canvas canvas, Size size) {
    for (var i = 0; i < flipAt.length; i++) {
      final at = flipAt[i];
      if (at == null) continue;
      final r = rarities[i];
      final since = now - at - flipMs(r);
      if (since < 0 || since > 900) continue;
      final light = stageLight(r);
      final p = since / (r.rank >= 2 ? 700 : 450);
      ShockwavePainter(
        rings: [(p, r.rank >= 2 ? 0.6 : 0.3)],
        color: light,
        origin: slots[i].center,
        maxRadius: slots[i].width * (r.rank >= 2 ? 1.5 : 0.9),
      ).paint(canvas, size);
      if (r.rank >= 2) {
        SparkBurstPainter(
          age: since / 1000,
          color: light,
          count: 26,
          origin: slots[i].center,
          power: 0.22,
        ).paint(canvas, size);
      }
    }
  }

  @override
  bool shouldRepaint(covariant _FlipBurstPainter old) => true;
}

/// 스프레드 화면 상단 요약: "N장 중 SR 이상 k장" 같은 사실만.
class SpreadSummary extends StatelessWidget {
  final List<DrawResult> results;
  const SpreadSummary({super.key, required this.results});

  @override
  Widget build(BuildContext context) {
    final foil = results.where((r) => r.rarity.isFoil).length;
    return Text(
      foil > 0 ? '빛나는 카드 $foil장 · 탭해서 뒤집기' : '카드를 탭해서 뒤집어 보세요',
      textAlign: TextAlign.center,
      style: AppText.callout.copyWith(
        color: foil > 0 ? AppColors.text : AppColors.textSecondary,
      ),
    );
  }
}
