import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../../../core/domain/rarity.dart';
import '../../../core/feedback/haptics.dart';
import '../../../core/feedback/sfx.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/theme/rarity_style.dart';
import '../../../core/utils/format.dart';
import '../../../shared/providers/auth_provider.dart';
import '../../../shared/widgets/pack_art.dart';
import '../../../shared/widgets/rarity_tag.dart';
import '../data/gacha_repository.dart';
import '../domain/draw_result.dart';
import '../domain/gacha_models.dart';
import '../domain/reveal_timeline.dart';
import 'gacha_result_page.dart';
import 'widgets/box_thumb.dart';
import 'widgets/gacha_fx_painters.dart';
import 'widgets/reveal_card.dart';
import 'widgets/reveal_spread.dart';

/// 뽑기 개봉 연출.
///
/// 1회: 박스 등장 → 차지(빛 누출·입자 밀도 상승·카메라 푸시인·등급에 비례한
/// 흔들림) → 승급(N→R→SR→SSR, **실제 최고 등급까지만**) → [SR/SSR] 긴장 →
/// 클라이맥스(섬광·충격파·빛줄기·불꽃·SSR 금박) → 슬로모션 카드 등장 →
/// 등급 도장 → 결과.
///
/// 10+1: 박스 차지(흔들림만 실제 최고 등급에 비례) → 카드 11장이 펼쳐짐 →
/// 탭/모두 뒤집기 → 가장 좋은 카드가 SR 이상이면 마지막에 클라이맥스.
///
/// 연출의 길이·순서는 [RevealTimeline]/[RevealDeck]에서 정한다.
/// "건너뛰기"는 언제나 보이고 누르는 즉시 결과 화면으로 간다.
class GachaAnimationPage extends StatefulWidget {
  final GachaSummary gacha;

  /// 유료 뽑기 횟수 (1 또는 10).
  final int count;

  const GachaAnimationPage({
    super.key,
    required this.gacha,
    required this.count,
  });

  @override
  State<GachaAnimationPage> createState() => _GachaAnimationPageState();
}

class _GachaAnimationPageState extends State<GachaAnimationPage>
    with TickerProviderStateMixin {
  static const _repository = GachaRepository();

  /// 계속 흐르는 시간(빛줄기 회전, 입자, 숨쉬기).
  late final AnimationController _ambient = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 20),
  )..repeat();

  late final AnimationController _summon = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: RevealTimeline.summonMs),
  );

  /// 1회 본 시퀀스 / 10+1 박스 차지(결과를 받은 뒤 만든다).
  AnimationController? _seq;

  /// 공개 후 머무는 시간.
  AnimationController? _hold;

  final Haptics _haptics = Haptics();
  SfxPlayer get _sfx => SfxPlayer.instance;

  DrawOutcome? _outcome;
  RevealTimeline? _timeline;
  Object? _apiError;
  bool _apiDone = false;
  bool _navigated = false;
  bool _skipRequested = false;
  bool _spread = false;
  bool _isPreview = false;
  final Set<String> _fired = {};
  late final List<GoldLeaf> _leaves = GoldLeafPainter.generate(64);

  /// 카드 틸트(드래그) — SSR 홀로 반사광이 따라 움직인다.
  Offset _tilt = Offset.zero;
  bool _dragging = false;

  bool get _multi => widget.count > 1;

  /// 여는 박스의 패키지(박스 사진 대신 늘 패키지 그림을 연다).
  late final PackStyle _pack = widget.gacha.pack;

  /// 지금 무대에 밝혀진 등급(상단 글자색을 색면에 맞춘다).
  Rarity get _litRarity {
    if (_multi || _spread) return Rarity.n;
    final tl = _timeline;
    if (tl == null) return Rarity.n;
    if (_hold != null) return tl.highest;
    return tl.at(_seqMs).lit;
  }

  double get _time => _ambient.value * 20;

  @override
  void initState() {
    super.initState();
    _sfx.warmUp();
    _summon.forward();
    _summon.addStatusListener((s) {
      if (s == AnimationStatus.completed) _maybeStart();
    });
    _sfx.play(Sfx.summon, volume: 0.7);
    _startDraw();
  }

  Future<void> _startDraw() async {
    try {
      final outcome = await _repository.draw(
        gachaId: widget.gacha.id,
        count: widget.count,
      );
      if (!mounted || _isPreview) return;
      _outcome = outcome;
      final balance = outcome.balanceAfter;
      if (balance != null) {
        context.read<AuthProvider>().applyBalance(balance);
      } else {
        context.read<AuthProvider>().refreshProfile();
      }
    } catch (e) {
      if (!mounted) return;
      _apiError = e;
    } finally {
      if (mounted && !_isPreview) {
        _apiDone = true;
        if (_apiError != null || _skipRequested) {
          _navigate();
        } else {
          _maybeStart();
        }
      }
    }
  }

  // ── 시퀀스 ────────────────────────────────────────────────

  void _maybeStart() {
    final outcome = _outcome;
    if (!mounted || outcome == null || _seq != null) return;
    if (!_summon.isCompleted) return;
    if (_skipRequested) return _navigate();

    final highest = outcome.highestRarity;
    final int ms;
    if (_multi) {
      ms = _multiChargeMs(highest) + _multiBurstMs;
    } else {
      _timeline = RevealTimeline.single(highest);
      ms = _timeline!.totalMs;
    }
    final c = AnimationController(
      vsync: this,
      duration: Duration(milliseconds: ms),
    );
    _seq = c;
    c.addListener(_onTick);
    c.addStatusListener((s) {
      if (s != AnimationStatus.completed) return;
      if (_multi) {
        setState(() => _spread = true);
      } else {
        _beginHold();
      }
    });
    c.forward();
    setState(() {});
  }

  static int _multiChargeMs(Rarity r) => 760 + 140 * r.rank;
  static const int _multiBurstMs = 380;

  double get _seqMs =>
      (_seq?.value ?? 0) * (_seq?.duration?.inMilliseconds ?? 0).toDouble();

  void _cue(String key, bool when, VoidCallback fire) {
    if (when && _fired.add(key)) fire();
  }

  void _onTick() {
    final ms = _seqMs;
    if (_multi) {
      final r = _outcome!.highestRarity;
      _cue('charge', ms >= 0, () {
        _sfx.play(Sfx.charge, volume: 0.75);
        _haptics.play(HapticPattern.charge);
      });
      _cue('burst', ms >= _multiChargeMs(r), () {
        _sfx.stop(Sfx.charge);
        _sfx.play(Sfx.impact, volume: 0.6);
        _haptics.play(HapticPattern.reveal(Rarity.r));
      });
      return;
    }
    final tl = _timeline!;
    final r = tl.highest;
    _cue('charge', ms >= 0, () {
      _sfx.play(Sfx.charge, volume: 0.8);
      _haptics.play(HapticPattern.charge);
    });
    for (final s in tl.segments) {
      if (s.phase != RevealPhase.ascend) continue;
      final rr = s.rarity!;
      _cue('ascend_${rr.code}', ms >= s.startMs, () {
        _sfx.play(switch (rr) {
          Rarity.r => Sfx.step1,
          Rarity.sr => Sfx.step2,
          _ => Sfx.step3,
        });
        _haptics.play(HapticPattern.ascend(rr));
      });
    }
    final tension = tl.segment(RevealPhase.tension);
    if (tension != null) {
      _cue('tension', ms >= tension.startMs, () {
        _sfx.stop(Sfx.charge);
        _sfx.play(Sfx.tick, volume: 0.9);
        _haptics.play(const HapticPattern([(0, HapticKind.selection)]));
      });
    }
    final climax = tl.segment(RevealPhase.climax);
    if (climax != null) {
      _cue('climax', ms >= climax.startMs, () {
        _sfx.play(Sfx.impact);
        _haptics.play(HapticPattern.climax(r));
      });
    }
    final emerge = tl.segment(RevealPhase.emerge)!;
    _cue('emerge', ms >= emerge.startMs, () {
      _sfx.stop(Sfx.charge);
      _sfx.play(
        RevealTimeline.hasClimax(r) ? Sfx.flip : Sfx.pop,
        volume: RevealTimeline.hasClimax(r) ? 0.8 : 0.7,
      );
      if (!RevealTimeline.hasClimax(r)) {
        _haptics.play(HapticPattern.reveal(r));
      }
    });
    final stamp = tl.segment(RevealPhase.stamp)!;
    final impactAt =
        stamp.startMs +
        (r == Rarity.n ? 0 : (stamp.durationMs * RarityStamp.impactAt).round());
    _cue('stamp', ms >= impactAt, () {
      switch (r) {
        case Rarity.n:
          _sfx.play(Sfx.tick, volume: 0.5);
        case Rarity.r:
          _sfx.play(Sfx.stamp, volume: 0.7);
        case Rarity.sr:
          _sfx.play(Sfx.stamp);
          _sfx.play(Sfx.srSting);
          _haptics.play(HapticPattern.reveal(r));
        case Rarity.ssr:
          _sfx.play(Sfx.stamp);
          _sfx.play(Sfx.fanfare);
          _haptics.play(HapticPattern.reveal(r));
      }
    });
  }

  void _beginHold() {
    if (_skipRequested) return _navigate();
    final r = _timeline?.highest ?? Rarity.n;
    final c = AnimationController(
      vsync: this,
      duration: Duration(milliseconds: RevealTimeline.holdMs(r)),
    );
    _hold = c;
    c.addStatusListener((s) {
      if (s == AnimationStatus.completed && !_isPreview) _navigate();
    });
    c.forward();
    setState(() {});
  }

  void _skip() {
    _skipRequested = true;
    _sfx.stopAll();
    _haptics.cancelAll();
    if (_apiDone) _navigate();
  }

  void _navigate() {
    if (_navigated || !mounted || _isPreview) return;
    _navigated = true;
    _sfx.stop(Sfx.charge);
    _haptics.cancelAll();

    if (_apiError != null) {
      final message = _apiError is ApiException
          ? (_apiError as ApiException).displayMessage
          : '뽑기를 완료하지 못했어요. 잠시 후 다시 시도해 주세요';
      Navigator.of(context).pop(message);
      return;
    }
    final outcome = _outcome;
    if (outcome == null) {
      Navigator.of(context).pop('결과를 받지 못했어요. 보관함을 확인해 주세요');
      return;
    }
    Navigator.of(context).pushReplacement(
      PageRouteBuilder<void>(
        transitionDuration: Motion.slow,
        pageBuilder: (_, _, _) =>
            GachaResultPage(gacha: widget.gacha, outcome: outcome),
        transitionsBuilder: (_, animation, _, child) =>
            FadeTransition(opacity: animation, child: child),
      ),
    );
  }

  // ── 디버그 전용 미리보기 (릴리스 빌드에는 없음) ──
  void _debugPreview(Rarity rarity) {
    _sfx.stopAll();
    _haptics.cancelAll();
    _seq?.dispose();
    _hold?.dispose();
    setState(() {
      _isPreview = true;
      _navigated = true;
      _apiDone = true;
      _apiError = null;
      _spread = false;
      _seq = null;
      _hold = null;
      _timeline = null;
      _fired.clear();
      _outcome = DrawOutcome(
        gachaId: widget.gacha.id,
        count: 1,
        bonusCount: 0,
        spent: 0,
        balanceAfter: null,
        highestRarity: rarity,
        pity: null,
        results: [
          DrawResult(
            drawId: 0,
            itemId: 0,
            name: '${rarity.code} 미리보기 상품',
            rarity: rarity,
            estimatedValue: 50000 * (rarity.rank + 1),
            exchangeValue: 40000 * (rarity.rank + 1),
          ),
        ],
      );
    });
    _summon.forward(from: 0);
  }

  @override
  void dispose() {
    _sfx.stop(Sfx.charge);
    _haptics.cancelAll();
    _ambient.dispose();
    _summon.dispose();
    _seq?.dispose();
    _hold?.dispose();
    super.dispose();
  }

  // ── Build ────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final bonus = widget.count ~/ 10;
    final title = bonus > 0
        ? '${widget.gacha.title} · ${widget.count}+$bonus회'
        : '${widget.gacha.title} · ${widget.count}회';

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: PopScope(
        canPop: false,
        onPopInvokedWithResult: (didPop, _) {
          if (!didPop) _skip();
        },
        child: Scaffold(
          backgroundColor: AppColors.stage,
          body: AnimatedBuilder(
            animation: Listenable.merge([_ambient, _summon]),
            builder: (context, _) {
              return Stack(
                fit: StackFit.expand,
                children: [
                  if (_spread)
                    _buildSpreadStage()
                  else if (_multi)
                    _buildMultiIntro()
                  else
                    _buildSingleStage(),
                  Positioned(
                    left: 0,
                    right: 0,
                    top: 0,
                    child: SafeArea(bottom: false, child: _buildTopBar(title)),
                  ),
                  if (kDebugMode && !_multi)
                    Positioned(
                      left: Space.x3,
                      bottom: Space.x3,
                      child: SafeArea(
                        child: _DebugPanel(onSelect: _debugPreview),
                      ),
                    ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }

  Widget _buildTopBar(String title) {
    final ink = stageInk(_litRarity);
    return Padding(
      padding: const EdgeInsets.fromLTRB(Space.gutter, Space.x2, Space.x3, 0),
      child: Row(
        children: [
          Expanded(
            child: Text(
              title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppText.caption.copyWith(
                color: ink.withValues(alpha: 0.75),
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          ValueListenableBuilder<bool>(
            valueListenable: _sfx.muted,
            builder: (context, muted, _) => Padding(
              padding: const EdgeInsets.only(right: Space.x2),
              child: Material(
                color: Colors.white.withValues(alpha: 0.2),
                shape: const CircleBorder(),
                clipBehavior: Clip.antiAlias,
                child: InkWell(
                  onTap: () => _sfx.setMuted(!muted),
                  child: Tooltip(
                    message: muted ? '소리 켜기' : '소리 끄기',
                    child: SizedBox(
                      width: 36,
                      height: 36,
                      child: Icon(
                        muted
                            ? Icons.volume_off_rounded
                            : Icons.volume_up_rounded,
                        color: ink.withValues(alpha: muted ? 0.55 : 0.9),
                        size: 20,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
          // 건너뛰기: 어느 색면 위에서도 읽히는 흰 알약.
          Material(
            color: Colors.white,
            shape: const StadiumBorder(),
            elevation: 0,
            child: InkWell(
              onTap: _skip,
              customBorder: const StadiumBorder(),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 9,
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      '건너뛰기',
                      style: AppText.bodyStrong.copyWith(
                        color: AppColors.text,
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                        height: 1,
                      ),
                    ),
                    const SizedBox(width: 2),
                    const Icon(
                      Icons.fast_forward_rounded,
                      size: 15,
                      color: AppColors.text,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ── 1회 무대 ──────────────────────────────────────────────

  Widget _buildSingleStage() {
    return AnimatedBuilder(
      animation: Listenable.merge([?_seq, ?_hold]),
      builder: (context, _) {
        final tl = _timeline;
        final ms = _seqMs;
        final holdT = _hold?.value ?? 0;
        final holding = _hold != null;
        final moment = tl?.at(ms);
        final r = tl?.highest ?? Rarity.n;
        final light = moment == null
            ? stageLight(Rarity.n)
            : stageStep(moment.from, moment.to, moment.colorT);
        final field = moment == null
            ? Rarity.n.field
            : stageFieldStep(moment.from, moment.to, moment.colorT);

        final phase = moment?.phase;
        final climaxSeg = tl?.segment(RevealPhase.climax);
        final emergeSeg = tl?.segment(RevealPhase.emerge);
        final preEnd = (climaxSeg?.startMs ?? emergeSeg?.startMs ?? 1)
            .toDouble();

        // 차지 에너지: 박스가 열리기 전까지 0→1.
        // 차지 에너지: 차지 0.15→0.55, 승급 단계마다 계단식 상승, 긴장 1.0.
        final double energy;
        if (tl == null) {
          energy = 0.12 + 0.04 * math.sin(_time * 3);
        } else if (holding || ms >= preEnd) {
          energy = RevealTimeline.hasClimax(r) ? 1.0 : 0.7;
        } else {
          final steps0 = RevealTimeline.ascensionFor(r).length;
          energy = switch (moment!.phase) {
            RevealPhase.charge => 0.15 + 0.4 * math.pow(moment.t, 1.2),
            RevealPhase.ascend =>
              0.55 + 0.4 * ((moment.step - 1 + moment.t) / steps0),
            _ => 0.95,
          }.toDouble();
        }

        // 카메라 푸시인(차지 동안 다가가고, 열리면 되돌아온다).
        final pushMax = 0.05 + 0.025 * r.rank;
        double push;
        if (tl == null) {
          push = 0;
        } else if (ms < preEnd) {
          push = pushMax * Curves.easeInOut.transform(ms / preEnd);
        } else {
          final since = ms - preEnd;
          push = since < 120
              ? pushMax + 0.04 * (since / 120)
              : (pushMax + 0.04) * math.max(0, 1 - (since - 120) / 500);
        }

        // 흔들림.
        final scale = RevealTimeline.shakeScale(r);
        double amp = 0;
        if (moment != null && !holding) {
          amp = switch (moment.phase) {
            RevealPhase.charge => scale * 0.45 * moment.t * moment.t,
            RevealPhase.ascend =>
              scale * (0.45 + 0.55 * math.pow(1 - moment.t, 3)),
            RevealPhase.tension => scale * 0.35,
            RevealPhase.climax => scale * 2.4 * math.pow(1 - moment.t, 2),
            RevealPhase.emerge => 0,
            RevealPhase.stamp =>
              moment.t > RarityStamp.impactAt && r.rank >= 2
                  ? scale *
                        1.6 *
                        math.pow(
                          1 - (moment.t - RarityStamp.impactAt) / 0.55,
                          3,
                        )
                  : 0,
          }.toDouble();
        }
        final shake =
            Offset(
              math.sin(ms * 0.091) + 0.6 * math.sin(ms * 0.137),
              math.cos(ms * 0.083) + 0.6 * math.cos(ms * 0.151),
            ) *
            amp;

        // 박스 상태.
        final steps = tl == null ? 0 : RevealTimeline.ascensionFor(r).length;
        double crack = 0;
        double pulse = 1 + 0.012 * math.sin(_time * 4);
        double lidOpen = 0;
        double boxOpacity = 1;
        if (moment != null) {
          switch (moment.phase) {
            case RevealPhase.charge:
              crack = 0.3 * moment.t;
              // 심장 박동처럼 점점 빨라지는 맥동.
              pulse =
                  1 +
                  0.02 * moment.t +
                  0.022 *
                      moment.t *
                      math.pow(math.sin(moment.t * moment.t * 9 * math.pi), 2);
            case RevealPhase.ascend:
              crack = 0.15 + 0.8 * ((moment.step - 1 + moment.t) / steps);
              pulse = 1.03 + 0.04 * math.pow(1 - moment.t, 4);
            case RevealPhase.tension:
              crack = 1;
              pulse =
                  1.04 + 0.05 * math.pow(math.sin(moment.t * math.pi * 3), 2);
            case RevealPhase.climax:
              crack = 1;
              lidOpen = (moment.t / 0.25).clamp(0.0, 1.0);
              boxOpacity = (1 - moment.t / 0.35).clamp(0.0, 1.0);
            case RevealPhase.emerge:
              crack = 1;
              lidOpen = RevealTimeline.hasClimax(r)
                  ? 1
                  : (moment.t / 0.3).clamp(0.0, 1.0);
              boxOpacity = RevealTimeline.hasClimax(r)
                  ? 0
                  : (1 - (moment.t - 0.2) / 0.4).clamp(0.0, 1.0);
            case RevealPhase.stamp:
              boxOpacity = 0;
          }
        }
        if (holding) boxOpacity = 0;

        // 클라이맥스 시간(슬로모션 반영).
        final climaxStart = climaxSeg?.startMs.toDouble();
        final emergeStart = emergeSeg?.startMs.toDouble() ?? 0;
        final sinceClimax = climaxStart == null ? -1.0 : ms - climaxStart;
        final holdMs = holding ? holdT * RevealTimeline.holdMs(r) : 0.0;
        final virtualAge = sinceClimax <= 0
            ? 0.0
            : (math.min(ms, emergeStart) -
                      climaxStart! +
                      math.max(0, ms - emergeStart) * 0.32 +
                      holdMs) /
                  1000;
        final flash = sinceClimax >= 0 && sinceClimax < 280
            ? (1 - sinceClimax / 280) * (r == Rarity.ssr ? 0.95 : 0.8)
            : 0.0;
        // 승급 단계마다 약한 섬광.
        double stepFlash = 0;
        if (moment?.phase == RevealPhase.ascend && moment!.t < 0.2) {
          stepFlash = 0.28 * (1 - moment.t / 0.2);
        }
        final rays = climaxStart == null || sinceClimax < 0
            ? 0.0
            : (r == Rarity.ssr ? 1.0 : 0.8) *
                  (0.4 + 0.6 * (sinceClimax / 450).clamp(0.0, 1.0));
        final tensionDim = phase == RevealPhase.tension
            ? 0.62 * Curves.easeIn.transform(moment!.t)
            : 0.0;

        // 충격파: 승급 단계 + 클라이맥스.
        final rings = <(double, double)>[];
        if (tl != null) {
          for (final s in tl.segments) {
            if (s.phase != RevealPhase.ascend) continue;
            rings.add(((ms - s.startMs) / 650, 0.55 + 0.2 * s.rarity!.rank));
          }
          if (climaxStart != null) {
            for (final (d, w) in const [
              (0.0, 1.5),
              (130.0, 1.0),
              (280.0, 0.7),
            ]) {
              rings.add(((sinceClimax - d) / 950, w));
            }
          }
        }

        // 카드.
        double cardT = 0;
        double flip = 0;
        if (moment != null) {
          if (phase == RevealPhase.emerge) {
            cardT = moment.t;
          } else if (phase == RevealPhase.stamp) {
            cardT = 1;
          }
        }
        if (holding) cardT = 1;
        final slow = RevealTimeline.hasClimax(r);
        final cardE = slow
            ? Curves.easeOutCubic.transform(cardT)
            : Curves.easeOutBack.transform(cardT);
        flip = slow
            ? Curves.easeInOutCubic.transform(
                ((cardT - 0.12) / 0.75).clamp(0.0, 1.0),
              )
            : Curves.easeOutCubic.transform((cardT / 0.7).clamp(0.0, 1.0));
        final stampT = holding
            ? 1.0
            : phase == RevealPhase.stamp
            ? moment!.t
            : 0.0;
        final leafT = r == Rarity.ssr && sinceClimax > 0
            ? (virtualAge / 3.6).clamp(0.0, 1.0)
            : 0.0;
        final autoSway = holding && !_dragging
            ? Offset(math.sin(_time * 0.9) * 0.35, math.cos(_time * 0.7) * 0.2)
            : Offset.zero;
        final tilt = _dragging ? _tilt : autoSway;

        return LayoutBuilder(
          builder: (context, c) {
            final size = c.biggest;
            final center = Offset(size.width / 2, size.height * 0.45);
            final stageBox = Size(math.min(size.width, 380), 380);
            const cardW = 224.0;

            return GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: holding ? _navigate : null,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  CustomPaint(
                    painter: StageBackdropPainter(
                      field: field,
                      color: light,
                      energy: energy,
                      time: _time,
                    ),
                  ),
                  if (rays > 0)
                    CustomPaint(
                      painter: LightRaysPainter(
                        rotation: _time * 0.25,
                        intensity: rays,
                        color: light,
                        rays: r == Rarity.ssr ? 16 : 12,
                        origin: center,
                      ),
                    ),
                  CustomPaint(
                    painter: ShockwavePainter(
                      rings: rings,
                      color: light,
                      origin: center,
                    ),
                  ),
                  Transform.translate(
                    offset: shake,
                    child: Transform.scale(
                      scale: 1 + push,
                      origin: center - size.center(Offset.zero),
                      child: Stack(
                        fit: StackFit.expand,
                        children: [
                          Positioned(
                            left: center.dx - stageBox.width / 2,
                            top: center.dy - stageBox.height / 2,
                            width: stageBox.width,
                            height: stageBox.height,
                            child: Stack(
                              fit: StackFit.expand,
                              children: [
                                if (boxOpacity > 0)
                                  CustomPaint(
                                    painter: FloorRingPainter(
                                      rotation: _time * 0.5,
                                      appear: _summon.value * boxOpacity,
                                      color: light,
                                    ),
                                  ),
                                if (boxOpacity > 0)
                                  _StagePack(
                                    style: _pack,
                                    appear: _summon.value,
                                    opacity: boxOpacity,
                                    pulse: pulse,
                                    lift: lidOpen,
                                    seamGlow:
                                        crack * (0.75 + 0.25 * r.rank / 3),
                                    sealGlow: stepFlash > 0
                                        ? (stepFlash / 0.28).clamp(0.0, 1.0)
                                        : crack * 0.55,
                                    glow: light,
                                  ),
                              ],
                            ),
                          ),
                          CustomPaint(
                            painter: ConvergeParticlesPainter(
                              time: _time,
                              density: tl == null
                                  ? 0.12
                                  : ms >= preEnd
                                  ? 0
                                  : phase == RevealPhase.tension
                                  ? 0.25
                                  : 0.2 + 0.8 * energy,
                              color: light,
                              origin: center,
                              maxCount: 30 + 20 * r.rank,
                            ),
                          ),
                          if (cardT > 0)
                            Positioned(
                              left: center.dx - cardW / 2,
                              top: center.dy - cardW * 0.7,
                              width: cardW,
                              height: cardW * 1.4,
                              child: Transform.translate(
                                offset: Offset(
                                  0,
                                  (1 - cardE) * (slow ? 90 : 40),
                                ),
                                child: Transform.scale(
                                  scale:
                                      (slow ? 0.2 : 0.35) +
                                      (slow ? 0.8 : 0.65) * cardE,
                                  child: Stack(
                                    alignment: Alignment.center,
                                    children: [
                                      if (flip > 0.5)
                                        Opacity(
                                          opacity: ((flip - 0.5) * 2).clamp(
                                            0.0,
                                            1.0,
                                          ),
                                          child: CardGlow(
                                            rarity: r,
                                            width: cardW,
                                          ),
                                        ),
                                      GestureDetector(
                                        onPanStart: (_) =>
                                            setState(() => _dragging = true),
                                        onPanUpdate: (d) => setState(() {
                                          _tilt = Offset(
                                            (_tilt.dx + d.delta.dx / 90).clamp(
                                              -1,
                                              1,
                                            ),
                                            (_tilt.dy + d.delta.dy / 90).clamp(
                                              -1,
                                              1,
                                            ),
                                          );
                                        }),
                                        onPanEnd: (_) => setState(() {
                                          _dragging = false;
                                          _tilt = Offset.zero;
                                        }),
                                        child: FlipCard(
                                          flip: flip,
                                          tilt: tilt,
                                          front: RevealCardFace(
                                            result: _outcome!.best!,
                                            width: cardW,
                                            tilt: tilt,
                                            glow: 0,
                                          ),
                                          back: RevealCardBack(
                                            width: cardW,
                                            glow: r.rank >= 1 ? r : null,
                                            pulse: _time % 1,
                                            charge: 1 - flip,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                          if (stampT > 0)
                            Positioned(
                              left: center.dx + cardW / 2 - 84,
                              top: center.dy - cardW * 0.7 - 52,
                              child: IgnorePointer(
                                child: RarityStamp(
                                  rarity: r,
                                  t: stampT,
                                  size: 66,
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                  if (tl != null)
                    for (final s in tl.segments)
                      if (s.phase == RevealPhase.ascend &&
                          ms >= s.startMs &&
                          ms < s.startMs + 1100)
                        IgnorePointer(
                          child: CustomPaint(
                            painter: SparkBurstPainter(
                              age: (ms - s.startMs) / 1000,
                              color: stageLight(s.rarity!),
                              count: 14 + 10 * s.rarity!.rank,
                              origin: center,
                              power: 0.32 + 0.06 * s.rarity!.rank,
                            ),
                          ),
                        ),
                  if (virtualAge > 0)
                    IgnorePointer(
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
                    IgnorePointer(
                      child: CustomPaint(
                        painter: GoldLeafPainter(
                          progress: leafT,
                          pieces: _leaves,
                        ),
                      ),
                    ),
                  if (tensionDim > 0)
                    IgnorePointer(
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: RadialGradient(
                            radius: 0.8,
                            colors: [
                              field.edge.withValues(alpha: tensionDim * 0.2),
                              field.edge.withValues(alpha: tensionDim * 0.85),
                            ],
                          ),
                        ),
                      ),
                    ),
                  if (flash + stepFlash > 0)
                    IgnorePointer(
                      child: ColoredBox(
                        color: Color.lerp(Colors.white, light, 0.2)!.withValues(
                          alpha: (flash + stepFlash).clamp(0.0, 1.0),
                        ),
                      ),
                    ),
                  // 공개 후 상품명.
                  if (_outcome?.best != null && (holding || stampT > 0.6))
                    Positioned(
                      left: Space.gutter,
                      right: Space.gutter,
                      top: center.dy + cardW * 0.7 + 22,
                      child: _RevealCaption(
                        result: _outcome!.best!,
                        extraCount: (_outcome?.results.length ?? 1) - 1,
                        opacity: holding ? 1 : ((stampT - 0.6) / 0.4),
                      ),
                    ),
                  Positioned(
                    left: Space.gutter,
                    right: Space.gutter,
                    bottom: 0,
                    child: SafeArea(
                      top: false,
                      child: Padding(
                        padding: const EdgeInsets.only(bottom: Space.x5),
                        child: holding
                            ? _HoldBar(
                                progress: holdT,
                                rarity: r,
                                onTap: _navigate,
                              )
                            : _StatusLine(
                                text: tl == null
                                    ? (_apiDone ? '' : '박스를 준비하고 있어요')
                                    : '',
                              ),
                      ),
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  // ── 10+1: 박스 차지 → 카드 펼치기 ─────────────────────────

  Widget _buildMultiIntro() {
    return AnimatedBuilder(
      animation: Listenable.merge([?_seq]),
      builder: (context, _) {
        final outcome = _outcome;
        final r = outcome?.highestRarity ?? Rarity.n;
        final ms = _seqMs;
        final chargeMs = _multiChargeMs(r).toDouble();
        final started = _seq != null;
        final chargeT = started ? (ms / chargeMs).clamp(0.0, 1.0) : 0.0;
        final burstT = started
            ? ((ms - chargeMs) / _multiBurstMs).clamp(0.0, 1.0)
            : 0.0;
        // 10+1 차지는 중립 빛. 흔들림·입자 밀도만 실제 최고 등급에 비례한다.
        final light = stageLight(Rarity.n);
        final amp = RevealTimeline.shakeScale(r) * 0.55 * chargeT * chargeT;
        final shake =
            Offset(
              math.sin(ms * 0.091) + 0.6 * math.sin(ms * 0.137),
              math.cos(ms * 0.083) + 0.6 * math.cos(ms * 0.151),
            ) *
            amp;
        final energy = started
            ? Curves.easeIn.transform(chargeT) * 0.8
            : 0.12 + 0.04 * math.sin(_time * 3);
        final push = 0.07 * Curves.easeInOut.transform(chargeT) * (1 - burstT);

        return LayoutBuilder(
          builder: (context, c) {
            final size = c.biggest;
            final center = Offset(size.width / 2, size.height * 0.45);
            return Stack(
              fit: StackFit.expand,
              children: [
                CustomPaint(
                  painter: StageBackdropPainter(
                    field: Rarity.n.field,
                    color: light,
                    energy: energy,
                    time: _time,
                  ),
                ),
                CustomPaint(
                  painter: ShockwavePainter(
                    rings: [(burstT * 1.1, 1.2)],
                    color: light,
                    origin: center,
                  ),
                ),
                Transform.translate(
                  offset: shake,
                  child: Transform.scale(
                    scale: 1 + push,
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        Positioned(
                          left: center.dx - 190,
                          top: center.dy - 190,
                          width: 380,
                          height: 380,
                          child: Opacity(
                            opacity: (1 - burstT * 2).clamp(0.0, 1.0),
                            child: Stack(
                              fit: StackFit.expand,
                              children: [
                                CustomPaint(
                                  painter: FloorRingPainter(
                                    rotation: _time * 0.5,
                                    appear: _summon.value,
                                    color: light,
                                  ),
                                ),
                                _StagePack(
                                  style: _pack,
                                  appear: _summon.value,
                                  opacity: 1,
                                  pulse: 1 + 0.04 * chargeT,
                                  lift: burstT,
                                  seamGlow: 0.65 * chargeT,
                                  sealGlow: 0.4 * chargeT,
                                  glow: light,
                                ),
                              ],
                            ),
                          ),
                        ),
                        CustomPaint(
                          painter: ConvergeParticlesPainter(
                            time: _time,
                            density: started ? 0.15 + 0.85 * chargeT : 0.12,
                            color: light,
                            origin: center,
                            maxCount: 40 + 15 * r.rank,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                if (burstT > 0 && burstT < 0.5)
                  IgnorePointer(
                    child: ColoredBox(
                      color: Colors.white.withValues(
                        alpha: 0.5 * (1 - burstT / 0.5),
                      ),
                    ),
                  ),
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: 0,
                  child: SafeArea(
                    top: false,
                    child: Padding(
                      padding: const EdgeInsets.only(bottom: Space.x8),
                      child: _StatusLine(
                        text: started
                            ? '${outcome!.results.length}장을 펼치는 중'
                            : (_apiDone ? '' : '박스를 준비하고 있어요'),
                      ),
                    ),
                  ),
                ),
              ],
            );
          },
        );
      },
    );
  }

  Widget _buildSpreadStage() {
    final outcome = _outcome!;
    final ordered = RevealDeck.order(outcome.results);
    return Stack(
      fit: StackFit.expand,
      children: [
        CustomPaint(
          painter: StageBackdropPainter(
            field: Rarity.n.field,
            color: stageLight(Rarity.n),
            energy: 0.25,
            time: _time,
            focusY: 0.4,
          ),
        ),
        SafeArea(
          child: Column(
            children: [
              const SizedBox(height: 60),
              Expanded(
                child: RevealSpread(
                  ordered: ordered,
                  haptics: _haptics,
                  onShowResult: _navigate,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _RevealCaption extends StatelessWidget {
  final DrawResult result;
  final int extraCount;
  final double opacity;

  const _RevealCaption({
    required this.result,
    required this.extraCount,
    required this.opacity,
  });

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: opacity.clamp(0.0, 1.0),
      child: Column(
        children: [
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              RarityTag(result.rarity, holo: result.rarity == Rarity.ssr),
              if (result.isPity) ...[
                const SizedBox(width: 4),
                const QuietLabel('천장'),
              ],
              if (result.isBonus) ...[
                const SizedBox(width: 4),
                const QuietLabel('보너스'),
              ],
            ],
          ),
          const SizedBox(height: Space.x2),
          Text(
            result.name,
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: AppText.title1.copyWith(
              color: stageInk(result.rarity),
              fontSize: 24,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            extraCount > 0
                ? '정가 ${formatWon(result.estimatedValue)} · 외 $extraCount개'
                : '정가 ${formatWon(result.estimatedValue)}',
            style: AppText.num(AppText.callout).copyWith(
              color: stageInk(result.rarity).withValues(alpha: 0.85),
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusLine extends StatelessWidget {
  final String text;
  const _StatusLine({required this.text});

  @override
  Widget build(BuildContext context) {
    return AnimatedOpacity(
      duration: Motion.normal,
      opacity: text.isEmpty ? 0 : 1,
      child: Text(
        text,
        textAlign: TextAlign.center,
        style: AppText.callout.copyWith(
          color: Colors.white.withValues(alpha: 0.8),
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

/// 공개 후: 결과 보기 버튼(흰 알약) + 자동으로 넘어가기까지의 진행선.
class _HoldBar extends StatelessWidget {
  final double progress;
  final Rarity rarity;
  final VoidCallback onTap;
  const _HoldBar({
    required this.progress,
    required this.rarity,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final ink = stageInk(rarity);
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          width: double.infinity,
          child: FilledButton(
            onPressed: onTap,
            style: FilledButton.styleFrom(
              backgroundColor: Colors.white,
              foregroundColor: AppColors.text,
              shape: const StadiumBorder(),
            ),
            child: const Text('결과 보기'),
          ),
        ),
        const SizedBox(height: Space.x3),
        SizedBox(
          width: 120,
          height: 3,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(2),
            child: LinearProgressIndicator(
              value: progress,
              backgroundColor: ink.withValues(alpha: 0.18),
              color: ink.withValues(alpha: 0.7),
            ),
          ),
        ),
      ],
    );
  }
}

/// 연출 무대의 박스 패키지: 등장(작게→크게), 맥동, 뚜껑 열림, 이음새·봉인 빛.
class _StagePack extends StatelessWidget {
  final PackStyle style;
  final double appear;
  final double opacity;
  final double pulse;
  final double lift;
  final double seamGlow;
  final double sealGlow;
  final Color glow;

  const _StagePack({
    required this.style,
    required this.appear,
    required this.opacity,
    required this.pulse,
    required this.lift,
    required this.seamGlow,
    required this.sealGlow,
    required this.glow,
  });

  @override
  Widget build(BuildContext context) {
    final a = appear.clamp(0.0, 1.0);
    if (a <= 0 || opacity <= 0) return const SizedBox.shrink();
    return Opacity(
      opacity: (a * opacity).clamp(0.0, 1.0),
      child: Transform.scale(
        scale: (0.6 + 0.4 * Curves.easeOutBack.transform(a)) * pulse,
        child: PackArt(
          style: style,
          scale: 0.5,
          center: const Offset(0.5, 0.55),
          lift: lift,
          seamGlow: seamGlow,
          sealGlow: sealGlow,
          glow: glow,
        ),
      ),
    );
  }
}

/// 디버그 빌드 전용 등급 미리보기.
class _DebugPanel extends StatelessWidget {
  final ValueChanged<Rarity> onSelect;
  const _DebugPanel({required this.onSelect});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final r in Rarity.values)
          Padding(
            padding: const EdgeInsets.only(right: 4),
            child: OutlinedButton(
              onPressed: () => onSelect(r),
              style: OutlinedButton.styleFrom(
                foregroundColor: Colors.white70,
                minimumSize: const Size(0, 28),
                padding: const EdgeInsets.symmetric(horizontal: 8),
                side: const BorderSide(color: Colors.white24),
                textStyle: AppText.micro,
              ),
              child: Text(r.code),
            ),
          ),
      ],
    );
  }
}
