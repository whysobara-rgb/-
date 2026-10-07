import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../../../core/domain/rarity.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/format.dart';
import '../../../shared/providers/auth_provider.dart';
import '../../../shared/widgets/product_image.dart';
import '../../../shared/widgets/rarity_tag.dart';
import '../data/gacha_repository.dart';
import '../domain/draw_result.dart';
import '../domain/gacha_grade.dart';
import '../domain/gacha_models.dart';
import 'gacha_result_page.dart';
import 'widgets/gacha_fx_painters.dart';

/// 뽑기 개봉 연출.
///
/// 순수 Flutter `AnimationController` + `CustomPainter`로 4단계를 재생한다.
///   ① 박스 등장 → ② 균열/승급 → ③ 컷인(SR·SSR) → ④ 개봉 + 카드 공개
/// 이후 결과 화면([GachaResultPage])으로 넘어간다.
///
/// 연출 강도와 빛 색은 서버 응답의 `highestRarity`(실제 결과 중 최고 등급)로
/// 정한다. 실제 결과보다 높은 등급의 빛을 보여주지 않는다.
/// 우측 상단 "건너뛰기"는 언제나 보이고, 누르면 즉시 결과로 간다.
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
  static const Duration _holdDuration = Duration(milliseconds: 1500);

  /// 링 회전·광택 등 계속 도는 값.
  late final AnimationController _idle;

  /// ① 박스 등장.
  late final AnimationController _summon;

  /// SSR 금박 낙하. 개봉 순간부터 결과로 넘어갈 때까지 계속 떨어진다.
  late final AnimationController _leaf = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 3400),
  );

  /// ②~④ 본 시퀀스. 등급이 정해진 뒤에 만든다.
  AnimationController? _sequence;

  bool _navigated = false;
  bool _skipRequested = false;
  bool _apiDone = false;
  bool _animationDone = false;
  bool _holding = false;
  bool _isPreview = false;
  Timer? _holdTimer;

  Object? _apiError;
  DrawOutcome? _outcome;
  GachaGrade? _grade;
  DrawResult? _highlight;

  double _lastCrackHapticT = -1;
  bool _burstHapticFired = false;

  final List<AbsorbParticle> _absorbSeeds = AbsorbParticlesPainter.generate(26);
  final List<BurstShard> _shardSeeds = BurstShardsPainter.generate(26);
  final List<GoldLeaf> _leafSeeds = GoldLeafPainter.generate(56);

  @override
  void initState() {
    super.initState();
    _idle = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 8),
    )..repeat();
    _summon =
        AnimationController(
            vsync: this,
            duration: const Duration(milliseconds: 800),
          )
          ..addStatusListener((status) {
            if (status == AnimationStatus.completed) _tryStartSequence();
          })
          ..forward();
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
      _highlight = outcome.best;
      _grade = GachaGrade.fromRarity(outcome.highestRarity);
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
        if (_apiError != null) {
          _animationDone = true;
          _tryNavigate();
        } else {
          _tryStartSequence();
          _tryNavigate();
        }
      }
    }
  }

  void _tryStartSequence() {
    if (_sequence != null || !mounted || _grade == null) return;
    if (!_isPreview && !_summon.isCompleted) return;

    if (_skipRequested) {
      _animationDone = true;
      _tryNavigate();
      return;
    }

    final d = _grade!.stageDurationsMs;
    final controller = AnimationController(
      vsync: this,
      duration: Duration(milliseconds: d[1] + d[2] + d[3]),
    );
    _sequence = controller;
    controller.addListener(() {
      if (!mounted) return;
      setState(() {});
      _maybeFireHaptics();
    });
    controller.addStatusListener((status) {
      if (status == AnimationStatus.completed) _beginHold();
    });
    HapticFeedback.lightImpact();
    controller.forward();
    setState(() {});
  }

  /// 카드가 공개된 뒤 잠깐 머문다. 화면을 누르면 바로 넘어간다.
  void _beginHold() {
    if (_skipRequested) {
      _animationDone = true;
      _tryNavigate();
      return;
    }
    setState(() => _holding = true);
    _holdTimer = Timer(_holdDuration, _finishHold);
  }

  void _finishHold() {
    _holdTimer?.cancel();
    if (!mounted || _animationDone) return;
    _animationDone = true;
    _tryNavigate();
  }

  _StageInfo _computeStage() {
    final grade = _grade;
    final controller = _sequence;
    if (grade == null || controller == null) {
      return const _StageInfo(stage: _Stage.summon, localT: 1);
    }
    final d = grade.stageDurationsMs;
    final crackMs = d[1].toDouble();
    final cutinMs = d[2].toDouble();
    final burstMs = d[3].toDouble();
    final elapsed = controller.value * (crackMs + cutinMs + burstMs);

    if (elapsed < crackMs) {
      return _StageInfo(
        stage: _Stage.crack,
        localT: (elapsed / crackMs).clamp(0.0, 1.0),
      );
    }
    final afterCrack = elapsed - crackMs;
    if (cutinMs > 0 && afterCrack < cutinMs) {
      return _StageInfo(
        stage: _Stage.cutin,
        localT: (afterCrack / cutinMs).clamp(0.0, 1.0),
      );
    }
    return _StageInfo(
      stage: _Stage.burst,
      localT: ((afterCrack - cutinMs) / burstMs).clamp(0.0, 1.0),
    );
  }

  void _maybeFireHaptics() {
    final info = _computeStage();
    if (info.stage == _Stage.crack) {
      for (final th in const [0.33, 0.66, 1.0]) {
        if (info.localT >= th && _lastCrackHapticT < th) {
          HapticFeedback.selectionClick();
        }
      }
      _lastCrackHapticT = info.localT;
    } else if (info.stage == _Stage.burst && !_burstHapticFired) {
      _burstHapticFired = true;
      if (_grade?.hasRainbowConfetti ?? false) _leaf.forward(from: 0);
      HapticFeedback.heavyImpact();
    }
  }

  void _skip() {
    _skipRequested = true;
    _holdTimer?.cancel();
    if (_holding) {
      _finishHold();
    } else if (_sequence != null) {
      _sequence!.value = 1.0;
      _animationDone = true;
      _tryNavigate();
    } else {
      _animationDone = true;
      _tryNavigate();
    }
  }

  void _tryNavigate() {
    if (_navigated || !mounted || _isPreview) return;
    if (!_animationDone || !_apiDone) return;
    _navigated = true;

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

  // ── 디버그 전용 등급 미리보기 (릴리스 빌드에는 나타나지 않음) ──
  void _debugPreview(GachaGrade grade) {
    _holdTimer?.cancel();
    setState(() {
      _isPreview = true;
      _navigated = true;
      _apiDone = true;
      _apiError = null;
      _animationDone = false;
      _holding = false;
      _skipRequested = false;
      _lastCrackHapticT = -1;
      _burstHapticFired = false;
      _grade = grade;
      _highlight = DrawResult(
        drawId: 0,
        itemId: 0,
        name: '${grade.code} 미리보기 상품',
        rarity: grade.rarity,
        estimatedValue: 50000 * (grade.rank + 1),
        exchangeValue: 40000 * (grade.rank + 1),
      );
      _sequence?.dispose();
      _sequence = null;
      _summon.reset();
      _leaf.reset();
    });
    _summon.forward();
  }

  @override
  void dispose() {
    _holdTimer?.cancel();
    _idle.dispose();
    _summon.dispose();
    _leaf.dispose();
    _sequence?.dispose();
    super.dispose();
  }

  // ── Build ────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final info = _computeStage();
    final grade = _grade;
    final color = grade == null
        ? const Color(0xFFF4F4F5)
        : _colorForStage(grade, info);
    final paidCount = widget.count;
    final bonus = paidCount ~/ 10;

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: AppColors.stage,
        body: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: _holding ? _finishHold : null,
          child: Stack(
            fit: StackFit.expand,
            children: [
              // 무대 비네팅: 중앙이 아주 약간 밝다.
              const DecoratedBox(
                decoration: BoxDecoration(
                  gradient: RadialGradient(
                    radius: 0.9,
                    colors: [Color(0xFF1A1A1E), AppColors.stage],
                  ),
                ),
              ),

              // 빛줄기 (SR/SSR, 컷인 이후).
              if (grade != null && grade.hasCutinStage)
                AnimatedBuilder(
                  animation: _idle,
                  builder: (context, _) => CustomPaint(
                    painter: LightRaysPainter(
                      rotation: _idle.value * 2 * math.pi,
                      intensity: _raysIntensity(info),
                      color: grade.primaryColor,
                      rays: grade == GachaGrade.sss ? 14 : 10,
                    ),
                  ),
                ),

              SafeArea(
                child: Stack(
                  children: [
                    Center(
                      child: SizedBox(
                        width: 320,
                        height: 360,
                        child: AnimatedBuilder(
                          animation: Listenable.merge([_idle, _summon]),
                          builder: (context, _) =>
                              _buildStageVisual(info, grade, color),
                        ),
                      ),
                    ),

                    // 공개 후 상품명.
                    if (_highlight != null &&
                        (info.stage == _Stage.burst || _holding))
                      Positioned(
                        left: Space.gutter,
                        right: Space.gutter,
                        bottom: 120,
                        child: _RevealCaption(
                          result: _highlight!,
                          extraCount: (_outcome?.results.length ?? 1) - 1,
                          visible: _holding || info.localT > 0.7,
                        ),
                      ),

                    // 상단: 박스명 · 횟수 / 건너뛰기.
                    Positioned(
                      left: Space.gutter,
                      right: Space.x2,
                      top: Space.x2,
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              bonus > 0
                                  ? '${widget.gacha.title} · $paidCount+$bonus회'
                                  : '${widget.gacha.title} · $paidCount회',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: AppText.caption.copyWith(
                                color: Colors.white.withValues(alpha: 0.6),
                              ),
                            ),
                          ),
                          TextButton(
                            onPressed: _skip,
                            style: TextButton.styleFrom(
                              foregroundColor: Colors.white,
                              minimumSize: const Size(0, 36),
                              padding: const EdgeInsets.symmetric(
                                horizontal: 12,
                              ),
                              side: BorderSide(
                                color: Colors.white.withValues(alpha: 0.24),
                              ),
                              shape: const RoundedRectangleBorder(
                                borderRadius: Radii.button,
                              ),
                            ),
                            child: Text(
                              _holding ? '결과 보기' : '건너뛰기',
                              style: AppText.bodyStrong.copyWith(
                                color: Colors.white,
                                fontSize: 13,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),

                    // 하단 상태 문구.
                    Positioned(
                      left: 0,
                      right: 0,
                      bottom: 56,
                      child: AnimatedOpacity(
                        duration: Motion.normal,
                        opacity: _statusLabel(info).isEmpty ? 0 : 1,
                        child: Text(
                          _statusLabel(info),
                          textAlign: TextAlign.center,
                          style: AppText.callout.copyWith(
                            color: Colors.white.withValues(alpha: 0.7),
                          ),
                        ),
                      ),
                    ),

                    if (kDebugMode)
                      Positioned(
                        left: Space.x3,
                        bottom: Space.x3,
                        child: _DebugGradePanel(onSelect: _debugPreview),
                      ),
                  ],
                ),
              ),

              // ③ 컷인.
              if (grade != null &&
                  grade.hasCutinStage &&
                  info.stage == _Stage.cutin)
                IgnorePointer(
                  child: _CutinOverlay(grade: grade, localT: info.localT),
                ),

              // ④ 개봉 순간 섬광.
              if (info.stage == _Stage.burst && info.localT < 0.18)
                IgnorePointer(
                  child: ColoredBox(
                    color: Color.lerp(Colors.white, color, 0.15)!.withValues(
                      alpha: (1 - info.localT / 0.18).clamp(0.0, 1.0),
                    ),
                  ),
                ),

              // SSR 금박.
              if (grade != null && grade.hasRainbowConfetti)
                IgnorePointer(
                  child: AnimatedBuilder(
                    animation: _leaf,
                    builder: (context, _) => _leaf.value == 0
                        ? const SizedBox.shrink()
                        : CustomPaint(
                            painter: GoldLeafPainter(
                              progress: _leaf.value,
                              pieces: _leafSeeds,
                            ),
                          ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  double _raysIntensity(_StageInfo info) {
    if (_holding) return 1;
    return switch (info.stage) {
      _Stage.summon || _Stage.crack => 0,
      _Stage.cutin => info.localT * 0.6,
      _Stage.burst => 0.6 + 0.4 * info.localT,
    };
  }

  Color _colorForStage(GachaGrade grade, _StageInfo info) {
    final colors = grade.ascensionColors;
    if (info.stage == _Stage.summon) return colors.first;
    if (info.stage != _Stage.crack) return colors.last;
    final segCount = colors.length - 1;
    final scaled = info.localT * segCount;
    final segIndex = scaled.floor().clamp(0, segCount - 1);
    final segT = (scaled - segIndex).clamp(0.0, 1.0);
    return Color.lerp(colors[segIndex], colors[segIndex + 1], segT) ??
        colors.last;
  }

  String _statusLabel(_StageInfo info) {
    if (_holding) return '화면을 누르면 결과로 넘어가요';
    final multi = widget.count > 1;
    return switch (info.stage) {
      _Stage.summon => _apiDone ? '' : '박스를 준비하고 있어요',
      _Stage.crack => multi ? '가장 높은 등급부터 공개해요' : '박스를 여는 중',
      _Stage.cutin => '',
      _Stage.burst => '',
    };
  }

  Widget _buildStageVisual(_StageInfo info, GachaGrade? grade, Color color) {
    final summon = _summon.value;
    double crack = 0;
    double pulse = 1;
    double lidOpen = 0;
    double burst = 0;
    Offset shake = Offset.zero;
    final intensity = 0.7 + 0.3 * (grade?.rank ?? 0);

    switch (info.stage) {
      case _Stage.summon:
        pulse = 1 + 0.015 * math.sin(_idle.value * 2 * math.pi * 4);
      case _Stage.crack:
        crack = info.localT;
        pulse = 1 + 0.06 * Curves.easeIn.transform(info.localT);
        // 균열 임계점마다 짧게 흔들린다(등급이 높을수록 크게).
        final phase = (info.localT * 3) % 1;
        final amp =
            (1 - phase) *
            (1.5 + 1.5 * (grade?.rank ?? 0)) *
            (phase < 0.35 ? 1 : 0);
        shake = Offset(
          math.sin(info.localT * 160) * amp,
          math.cos(info.localT * 130) * amp * 0.5,
        );
      case _Stage.cutin:
        crack = 1;
        pulse = 1.06 + 0.02 * math.sin(info.localT * 6 * math.pi);
      case _Stage.burst:
        crack = 1;
        burst = info.localT;
        lidOpen = (burst / 0.3).clamp(0.0, 1.0);
        pulse = 1.06;
    }
    if (_holding) {
      burst = 1;
      lidOpen = 1;
    }

    final boxOpacity = info.stage == _Stage.burst || _holding
        ? (1 - ((burst - 0.15) / 0.3)).clamp(0.0, 1.0)
        : 1.0;
    final showCard = (info.stage == _Stage.burst && burst > 0.15) || _holding;

    return Transform.translate(
      offset: shake,
      child: Stack(
        alignment: Alignment.center,
        children: [
          if (info.stage == _Stage.summon || info.stage == _Stage.crack)
            Positioned.fill(
              child: CustomPaint(
                painter: FloorRingPainter(
                  rotation: _idle.value * 2 * math.pi,
                  appear: summon,
                  color: color,
                ),
              ),
            ),
          if (info.stage == _Stage.summon)
            Positioned.fill(
              child: CustomPaint(
                painter: AbsorbParticlesPainter(
                  progress: summon,
                  color: color,
                  particles: _absorbSeeds,
                ),
              ),
            ),
          if (boxOpacity > 0)
            Positioned.fill(
              child: Opacity(
                opacity: boxOpacity,
                child: CustomPaint(
                  painter: VaultBoxPainter(
                    appear: summon,
                    crack: crack,
                    color: color,
                    pulse: pulse,
                    lidOpen: lidOpen,
                    sheen: _idle.value * 3 % 1,
                    metallic:
                        grade == GachaGrade.sss && info.stage != _Stage.summon,
                    intensity: intensity,
                  ),
                ),
              ),
            ),
          if (info.stage == _Stage.burst)
            Positioned.fill(
              child: CustomPaint(
                painter: BurstShardsPainter(
                  progress: burst,
                  color: color,
                  shards: _shardSeeds,
                ),
              ),
            ),
          if (showCard && _highlight != null && grade != null)
            _buildEnteringCard(grade, _holding ? 1 : burst),
        ],
      ),
    );
  }

  Widget _buildEnteringCard(GachaGrade grade, double burst) {
    final cardT = ((burst - 0.15) / 0.7).clamp(0.0, 1.0);
    final curved = Curves.easeOutBack.transform(cardT);
    final scale = 0.3 + 0.7 * curved;
    final rotateY = math.pi * (1 - curved.clamp(0.0, 1.0));
    final showFront = rotateY < math.pi / 2;

    return Transform(
      alignment: Alignment.center,
      transform: Matrix4.identity()
        ..setEntry(3, 2, 0.0012)
        ..rotateY(rotateY)
        ..scaleByDouble(scale, scale, scale, 1.0),
      child: showFront
          ? _RevealCard(result: _highlight!, grade: grade)
          : _CardBack(grade: grade),
    );
  }
}

enum _Stage { summon, crack, cutin, burst }

class _StageInfo {
  final _Stage stage;
  final double localT;
  const _StageInfo({required this.stage, required this.localT});
}

/// 공개되는 카드 앞면: 실제 상품 사진 + 등급.
class _RevealCard extends StatelessWidget {
  final DrawResult result;
  final GachaGrade grade;

  const _RevealCard({required this.result, required this.grade});

  @override
  Widget build(BuildContext context) {
    final isSsr = grade == GachaGrade.sss;
    return Container(
      width: 196,
      height: 248,
      padding: const EdgeInsets.all(1.5),
      decoration: BoxDecoration(
        borderRadius: Radii.card,
        gradient: isSsr ? grade.gradient : null,
        color: isSsr ? null : grade.primaryColor.withValues(alpha: 0.8),
        boxShadow: [
          BoxShadow(
            color: grade.glowColor.withValues(
              alpha: grade.rank >= 2 ? 0.55 : 0.3,
            ),
            blurRadius: 36,
            spreadRadius: grade.rank.toDouble(),
          ),
        ],
      ),
      child: Container(
        decoration: const BoxDecoration(
          color: AppColors.stageRaised,
          borderRadius: BorderRadius.all(Radius.circular(Radii.lg - 1.5)),
        ),
        padding: const EdgeInsets.all(Space.x3),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: ProductImage(
                url: result.imageUrl,
                background: const Color(0xFFF2F2F0),
              ),
            ),
            const SizedBox(height: Space.x3),
            RarityTag(result.rarity),
          ],
        ),
      ),
    );
  }
}

class _CardBack extends StatelessWidget {
  final GachaGrade grade;
  const _CardBack({required this.grade});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 196,
      height: 248,
      decoration: BoxDecoration(
        color: AppColors.stageRaised,
        borderRadius: Radii.card,
        border: Border.all(
          color: grade.primaryColor.withValues(alpha: 0.6),
          width: 1.5,
        ),
      ),
      alignment: Alignment.center,
      child: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          border: Border.all(color: grade.primaryColor.withValues(alpha: 0.6)),
          borderRadius: Radii.chip,
        ),
      ),
    );
  }
}

/// 카드 아래 상품명·정가.
class _RevealCaption extends StatelessWidget {
  final DrawResult result;
  final int extraCount;
  final bool visible;

  const _RevealCaption({
    required this.result,
    required this.extraCount,
    required this.visible,
  });

  @override
  Widget build(BuildContext context) {
    return AnimatedOpacity(
      duration: Motion.slow,
      opacity: visible ? 1 : 0,
      child: Column(
        children: [
          Text(
            result.name,
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: AppText.title2.copyWith(color: Colors.white),
          ),
          const SizedBox(height: Space.x1),
          Text(
            extraCount > 0
                ? '정가 ${formatWon(result.estimatedValue)} · 외 $extraCount개'
                : '정가 ${formatWon(result.estimatedValue)}',
            style: AppText.num(
              AppText.callout,
            ).copyWith(color: Colors.white.withValues(alpha: 0.6)),
          ),
        ],
      ),
    );
  }
}

/// ③ 컷인: 화면을 가로지르는 띠 위로 등급 코드가 밀려 들어온다.
class _CutinOverlay extends StatelessWidget {
  final GachaGrade grade;
  final double localT;

  const _CutinOverlay({required this.grade, required this.localT});

  @override
  Widget build(BuildContext context) {
    final slideIn = Curves.easeOutCubic.transform(
      (localT * 2.2).clamp(0.0, 1.0),
    );
    final fadeOut = (1 - ((localT - 0.8) / 0.2)).clamp(0.0, 1.0);
    final bandOpen = Curves.easeOutCubic.transform(
      (localT * 3).clamp(0.0, 1.0),
    );
    final heartbeat = 1 + 0.04 * math.sin(localT * 4 * math.pi);
    final isSsr = grade == GachaGrade.sss;

    return Opacity(
      opacity: fadeOut,
      child: Stack(
        fit: StackFit.expand,
        children: [
          ColoredBox(color: Colors.black.withValues(alpha: 0.5)),
          CustomPaint(
            painter: LightningCutinPainter(
              progress: localT,
              color: grade.primaryColor,
            ),
          ),
          Center(
            child: Container(
              height: 132 * bandOpen,
              width: double.infinity,
              decoration: BoxDecoration(
                color: Colors.black.withValues(alpha: 0.85),
                border: Border.symmetric(
                  horizontal: BorderSide(color: grade.primaryColor, width: 1),
                ),
              ),
              child: ClipRect(
                child: Transform.translate(
                  offset: Offset((1 - slideIn) * 280, 0),
                  child: Transform.scale(
                    scale: heartbeat,
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        ShaderMask(
                          shaderCallback: (rect) =>
                              (isSsr
                                      ? grade.gradient
                                      : LinearGradient(
                                          colors: [
                                            Colors.white,
                                            grade.secondaryColor,
                                          ],
                                        ))
                                  .createShader(rect),
                          child: Text(
                            grade.code,
                            style: AppText.display.copyWith(
                              color: Colors.white,
                              fontSize: 56,
                              height: 1,
                              letterSpacing: 6,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                        const SizedBox(height: Space.x2),
                        Text(
                          grade.rarity == Rarity.ssr ? '최상위 등급' : '슈퍼 레어 등급',
                          style: AppText.caption.copyWith(
                            color: Colors.white.withValues(alpha: 0.75),
                            letterSpacing: 2,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 디버그 빌드 전용 등급 미리보기.
class _DebugGradePanel extends StatelessWidget {
  final ValueChanged<GachaGrade> onSelect;

  const _DebugGradePanel({required this.onSelect});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: GachaGrade.values
          .map(
            (g) => Padding(
              padding: const EdgeInsets.only(right: 4),
              child: OutlinedButton(
                onPressed: () => onSelect(g),
                style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.white70,
                  minimumSize: const Size(0, 28),
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  side: const BorderSide(color: Colors.white24),
                  textStyle: AppText.micro,
                ),
                child: Text(g.code),
              ),
            ),
          )
          .toList(),
    );
  }
}
