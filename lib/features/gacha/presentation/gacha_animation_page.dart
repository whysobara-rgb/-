import 'dart:math' as math;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../../../core/network/api_client.dart';
import '../../../shared/providers/auth_provider.dart';
import '../../home/domain/capsule_box.dart';
import '../domain/draw_result.dart';
import '../domain/gacha_grade.dart';
import '../domain/gacha_logic.dart';
import 'gacha_result_page.dart';
import 'widgets/gacha_fx_painters.dart';

/// 가치가차 - CLOVE(일본 오리파 1위 플랫폼) 스타일 4등급(B/A/S/SSS)
/// 가챠 오픈 애니메이션 엔진.
///
/// 외부 3D 엔진 없이 순수 Flutter `AnimationController` + `CustomPainter`
/// (dart:ui Canvas) + `Transform`(3D 회전)만으로 CLOVE식 5단계 연출
/// 파이프라인을 구현한다:
///   Stage 0(구체 소환) → Stage 1(크랙/등급 승급) → Stage 2(컷인, S/SSS 전용)
///   → Stage 3(폭발+카드 3D 회전 등장) → Stage 4(결과 화면, [GachaResultPage]).
///
/// count > 1인 경우, 결과 중 최고 등급 1개를 이 엔진으로 연출하고 나머지는
/// 결과 화면 하단 그리드에 노출한다(기존 정책 유지).
class GachaAnimationPage extends StatefulWidget {
  final CapsuleBox box;
  final int count;

  const GachaAnimationPage({super.key, required this.box, required this.count});

  @override
  State<GachaAnimationPage> createState() => _GachaAnimationPageState();
}

class _GachaAnimationPageState extends State<GachaAnimationPage>
    with TickerProviderStateMixin {
  // ── 지속 회전/맥동용 idle 컨트롤러 (전체 수명 동안 계속 반복) ──
  late final AnimationController _rotationController;

  // ── Stage 0: 구체 소환(성장) 컨트롤러. 1회 재생 후 값 1.0 유지 ──
  late final AnimationController _orbSummonController;

  // ── Stage 1~3: 등급이 확정된 뒤에만 생성되는 메인 시퀀스 컨트롤러 ──
  AnimationController? _sequenceController;

  bool _navigated = false;
  bool _skipRequested = false;

  // API 상태
  bool _apiDone = false;
  Object? _apiError;
  List<DrawResult>? _apiResults;

  // 등급/하이라이트 결과 (API 완료 또는 디버그 프리뷰로 확정됨)
  GachaGrade? _grade;
  DrawResult? _highlight;

  // 애니메이션 최종 완료 여부
  bool _animationDone = false;

  // 디버그 프리뷰 모드 (kDebugMode에서만 노출되는 등급 테스트 버튼용)
  bool _isPreview = false;

  // 스테이지별 haptic 중복 방지 플래그
  double _lastCrackHapticT = -1;
  bool _burstHapticFired = false;

  static const List<Color> _idleAscension = [Colors.white, Color(0xFFE3E7EF)];

  List<AbsorbParticle>? _absorbSeeds;
  List<BurstShard>? _shardSeeds;
  List<ConfettiPiece3D>? _confettiSeeds;

  @override
  void initState() {
    super.initState();

    _rotationController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 6),
    )..repeat();

    _orbSummonController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 800),
    );
    _orbSummonController.addStatusListener((status) {
      if (status == AnimationStatus.completed) {
        _tryStartSequence();
      }
    });
    _orbSummonController.forward();

    _startDraw();
  }

  Future<void> _startDraw() async {
    try {
      final results = await drawGacha(widget.box.id, widget.count);
      if (!mounted) return;
      if (_isPreview) return; // 프리뷰 모드로 전환된 경우 실제 API 결과는 무시.
      _apiResults = results;
      final sorted = [...results]
        ..sort((a, b) => b.gradeEnum.rank.compareTo(a.gradeEnum.rank));
      _highlight = sorted.isNotEmpty ? sorted.first : null;
      _grade = _highlight?.gradeEnum ?? GachaGrade.b;
    } catch (e) {
      if (!mounted) return;
      _apiError = e;
    } finally {
      if (!_isPreview) {
        _apiDone = true;
        _tryStartSequence();
        _tryNavigate();
      }
    }
  }

  /// 구체 소환(Stage0)이 끝났고 && 등급이 확정되었으면 본 시퀀스(Stage1~3) 시작.
  void _tryStartSequence() {
    if (_sequenceController != null) return; // 이미 시작됨
    if (!mounted) return;
    if (_grade == null) return; // 등급 미확정
    if (!_isPreview && !_orbSummonController.isCompleted) return;

    if (_skipRequested) {
      // SKIP: 시퀀스를 아예 재생하지 않고 즉시 결과로 이동.
      _animationDone = true;
      _tryNavigate();
      return;
    }

    final grade = _grade!;
    final durations = grade.stageDurationsMs; // [orb, crack, cutin, burst]
    final crackMs = durations[1];
    final cutinMs = durations[2];
    final burstMs = durations[3];
    final totalMs = crackMs + cutinMs + burstMs;

    final controller = AnimationController(
      vsync: this,
      duration: Duration(milliseconds: totalMs),
    );
    _sequenceController = controller;

    controller.addListener(() {
      if (!mounted) return;
      setState(() {}); // 스테이지 계산은 build()에서 수행
      _maybeFireHaptics();
    });
    controller.addStatusListener((status) {
      if (status == AnimationStatus.completed) {
        _animationDone = true;
        _tryNavigate();
      }
    });

    HapticFeedback.lightImpact();
    controller.forward();
    if (mounted) setState(() {});
  }

  // 현재 시퀀스 진행 상황을 [_StageInfo]로 계산.
  _StageInfo _computeStage() {
    final grade = _grade;
    final controller = _sequenceController;
    if (grade == null || controller == null) {
      return _StageInfo(stage: _Stage.orb, localT: 1.0, grade: grade ?? GachaGrade.b);
    }
    final durations = grade.stageDurationsMs;
    final crackMs = durations[1].toDouble();
    final cutinMs = durations[2].toDouble();
    final burstMs = durations[3].toDouble();
    final totalMs = crackMs + cutinMs + burstMs;
    final elapsed = controller.value * totalMs;

    if (elapsed < crackMs) {
      return _StageInfo(stage: _Stage.crack, localT: (elapsed / crackMs).clamp(0.0, 1.0), grade: grade);
    }
    final afterCrack = elapsed - crackMs;
    if (cutinMs > 0 && afterCrack < cutinMs) {
      return _StageInfo(stage: _Stage.cutin, localT: (afterCrack / cutinMs).clamp(0.0, 1.0), grade: grade);
    }
    final afterCutin = afterCrack - cutinMs;
    return _StageInfo(stage: _Stage.burst, localT: (afterCutin / burstMs).clamp(0.0, 1.0), grade: grade);
  }

  void _maybeFireHaptics() {
    final info = _computeStage();
    if (info.stage == _Stage.crack) {
      // 크랙 3단계 임계값(0.33/0.66/1.0)마다 짧은 진동.
      const thresholds = [0.33, 0.66, 1.0];
      for (final th in thresholds) {
        if (info.localT >= th && _lastCrackHapticT < th) {
          HapticFeedback.vibrate();
          SystemSound.play(SystemSoundType.click);
        }
      }
      _lastCrackHapticT = info.localT;
    } else if (info.stage == _Stage.burst) {
      if (!_burstHapticFired && info.localT < 0.05) {
        _burstHapticFired = true;
        HapticFeedback.heavyImpact();
        SystemSound.play(SystemSoundType.alert);
      }
    }
  }

  /// 우측 상단 SKIP 버튼: 모든 연출을 건너뛰고 즉시 결과 화면으로 이동.
  void _skip() {
    _skipRequested = true;
    if (_sequenceController != null) {
      // 이미 시퀀스가 재생 중이면 즉시 끝으로 점프.
      _sequenceController!.value = 1.0;
    } else {
      // 아직 API/등급 확정 전이면, 확정되는 즉시 재생 없이 바로 이동.
      _animationDone = true;
      _tryNavigate();
    }
  }

  void _tryNavigate() {
    if (_navigated || !mounted) return;
    if (!_animationDone || !_apiDone) return;
    if (_isPreview) return; // 프리뷰 모드는 페이지 이동하지 않음(그 자리에서 반복 테스트).
    _navigated = true;

    if (_apiError != null) {
      final message = _apiError is ApiException
          ? (_apiError as ApiException).message
          : '뽑기 중 오류가 발생했습니다';
      Navigator.of(context).pop();
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
      return;
    }

    context.read<AuthProvider>().refreshProfile();

    Navigator.of(context).pushReplacement(
      MaterialPageRoute(
        builder: (context) => GachaResultPage(
          box: widget.box,
          count: widget.count,
          results: _apiResults ?? const [],
        ),
      ),
    );
  }

  /// 디버그 전용: 강제로 특정 등급을 즉시 재생해보는 프리뷰 모드 진입.
  void _debugPreview(GachaGrade grade) {
    setState(() {
      _isPreview = true;
      _navigated = true; // 실제 페이지 이동은 막는다.
      _apiDone = true;
      _apiError = null;
      _animationDone = false;
      _skipRequested = false;
      _lastCrackHapticT = -1;
      _burstHapticFired = false;
      _grade = grade;
      _highlight = DrawResult(
        id: 'preview_${grade.code}',
        name: '${grade.label} 프리뷰 아이템',
        grade: grade.code,
        price: 50000 * (grade.rank + 1),
      );
      _apiResults = [_highlight!];

      _sequenceController?.dispose();
      _sequenceController = null;
      _orbSummonController.reset();
    });
    _orbSummonController.forward();
  }

  void _closePreview() {
    setState(() {
      _isPreview = false;
      _navigated = false;
      _animationDone = false;
      _apiDone = false;
      _grade = null;
      _sequenceController?.dispose();
      _sequenceController = null;
      _orbSummonController.reset();
    });
    _orbSummonController.forward();
    _startDraw();
  }

  @override
  void dispose() {
    _rotationController.dispose();
    _orbSummonController.dispose();
    _sequenceController?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final info = _computeStage();
    final grade = _grade;
    final color = grade == null
        ? Colors.white
        : _colorForStage(grade, info);
    final rainbowActive = grade != null && _isRainbowActive(grade, info);

    return Scaffold(
      backgroundColor: const Color(0xFF0B0710),
      body: DecoratedBox(
        decoration: BoxDecoration(
          gradient: RadialGradient(
            colors: [
              const Color(0xFF231433).withValues(alpha: 0.92),
              const Color(0xFF0B0710).withValues(alpha: 0.98),
            ],
            radius: 1.1,
          ),
        ),
        child: SafeArea(
          child: Stack(
            children: [
              // ── 배경 딥다크 블러 오버레이(rgba(0,0,0,0.92) 상당) ──
              Positioned.fill(
                child: Container(color: Colors.black.withValues(alpha: 0.35)),
              ),

              Center(
                child: SizedBox(
                  width: 300,
                  height: 300,
                  child: AnimatedBuilder(
                    animation: Listenable.merge([
                      _rotationController,
                      _orbSummonController,
                      if (_sequenceController != null) _sequenceController!,
                    ]),
                    builder: (context, _) {
                      return _buildStageVisual(info, grade, color, rainbowActive);
                    },
                  ),
                ),
              ),

              // ── Stage2: 등급 엠블럼 컷인(S/SSS 전용) ──
              if (grade != null &&
                  grade.hasCutinStage &&
                  info.stage == _Stage.cutin)
                Positioned.fill(
                  child: IgnorePointer(
                    child: _CutinOverlay(grade: grade, localT: info.localT),
                  ),
                ),

              // ── Stage3: 순백 섬광 flash-whiteout ──
              if (info.stage == _Stage.burst && info.localT < 0.15)
                Positioned.fill(
                  child: IgnorePointer(
                    child: Container(
                      color: Colors.white.withValues(
                        alpha: (1 - info.localT / 0.15).clamp(0.0, 1.0),
                      ),
                    ),
                  ),
                ),

              // ── 안내 텍스트 ──
              Positioned(
                left: 0,
                right: 0,
                bottom: 96,
                child: Center(
                  child: Text(
                    _statusLabel(info),
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.92),
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 0.5,
                    ),
                  ),
                ),
              ),

              // ── 하단 진행률 표시 ──
              Positioned(
                left: 24,
                right: 24,
                bottom: 56,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: LinearProgressIndicator(
                    value: _sequenceController?.value ?? _orbSummonController.value * 0.15,
                    minHeight: 5,
                    backgroundColor: Colors.white.withValues(alpha: 0.16),
                    valueColor: AlwaysStoppedAnimation<Color>(
                      grade?.primaryColor ?? Colors.white,
                    ),
                  ),
                ),
              ),

              // ── 우측 상단 SKIP 버튼 ──
              Positioned(
                right: 16,
                top: 8,
                child: TextButton.icon(
                  onPressed: _skip,
                  icon: const Icon(Icons.fast_forward_rounded, color: Colors.white70, size: 18),
                  label: Text(
                    'SKIP',
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.85),
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 1,
                    ),
                  ),
                ),
              ),

              // ── 디버그 전용: 등급 테스트 컨트롤러 패널 ──
              if (kDebugMode)
                Positioned(
                  left: 12,
                  top: 8,
                  child: _DebugGradePanel(
                    onSelect: _debugPreview,
                    isPreview: _isPreview,
                    onClose: _closePreview,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  bool _isRainbowActive(GachaGrade grade, _StageInfo info) {
    if (!grade.isRainbow) return false;
    if (info.stage == _Stage.cutin || info.stage == _Stage.burst) return true;
    if (info.stage == _Stage.crack) {
      final colors = grade.ascensionColors;
      final segCount = colors.length - 1;
      final segIndex = (info.localT * segCount).floor().clamp(0, segCount - 1);
      final segT = (info.localT * segCount - segIndex).clamp(0.0, 1.0);
      return segIndex == segCount - 1 && segT > 0.5;
    }
    return false;
  }

  Color _colorForStage(GachaGrade grade, _StageInfo info) {
    if (info.stage == _Stage.orb) return _idleAscension.first;
    final colors = grade.ascensionColors;
    if (info.stage != _Stage.crack) return colors.last;
    final segCount = colors.length - 1;
    if (segCount <= 0) return colors.first;
    final scaled = info.localT * segCount;
    final segIndex = scaled.floor().clamp(0, segCount - 1);
    final segT = (scaled - segIndex).clamp(0.0, 1.0);
    return Color.lerp(colors[segIndex], colors[segIndex + 1], segT) ?? colors.first;
  }

  String _statusLabel(_StageInfo info) {
    switch (info.stage) {
      case _Stage.orb:
        return '캡슐 에너지를 모으는 중...';
      case _Stage.crack:
        return '균열이 퍼지는 중...';
      case _Stage.cutin:
        return '텐션 MAX!';
      case _Stage.burst:
        return '캡슐이 열리고 있습니다!';
    }
  }

  Widget _buildStageVisual(_StageInfo info, GachaGrade? grade, Color color, bool rainbow) {
    final rotationAngle = _rotationController.value * 2 * math.pi * 3;
    final orbGrowth = _orbSummonController.value;
    final magicAppear = _orbSummonController.value;

    double pulseScale = 1.0;
    double crackProgress = 0.0;
    double burstProgress = 0.0;

    if (info.stage == _Stage.crack) {
      final t = info.localT;
      crackProgress = t;
      if (t < 0.33) {
        pulseScale = 1.0 + 0.15 * (t / 0.33);
      } else if (t < 0.66) {
        pulseScale = 1.15 + 0.15 * ((t - 0.33) / 0.33);
      } else {
        pulseScale = 1.3;
      }
    } else if (info.stage == _Stage.cutin) {
      crackProgress = 1.0;
      pulseScale = 1.3 + 0.08 * math.sin(info.localT * 4 * math.pi);
    } else if (info.stage == _Stage.burst) {
      crackProgress = 1.0;
      burstProgress = info.localT;
      pulseScale = (1.3 * (1 - (burstProgress / 0.25).clamp(0.0, 1.0)));
    } else {
      // idle/orb 소환 단계: 은은한 숨쉬기 펄스
      pulseScale = 1.0 + 0.03 * math.sin(_rotationController.value * 2 * math.pi);
    }

    final showOrb = info.stage != _Stage.burst || burstProgress < 0.45;
    final showCard = info.stage == _Stage.burst && burstProgress > 0.15;

    final shardSeeds = _shardSeeds ??=
        BurstShardsPainter.generate(22, grade?.primaryColor ?? Colors.white);
    final confettiSeeds = _confettiSeeds ??= RainbowConfettiPainter.generate(48);

    return Stack(
      alignment: Alignment.center,
      children: [
        // ── 마법진 링 ──
        if (info.stage == _Stage.orb || info.stage == _Stage.crack)
          CustomPaint(
            size: const Size(300, 300),
            painter: MagicCirclePainter(
              rotation: rotationAngle,
              appear: magicAppear,
              color: color,
            ),
          ),

        // ── 흡수 파티클 ──
        if (info.stage == _Stage.orb)
          CustomPaint(
            size: const Size(300, 300),
            painter: AbsorbParticlesPainter(
              progress: orbGrowth,
              color: color,
              particles: _absorbSeeds ??= AbsorbParticlesPainter.generate(28, color),
            ),
          ),

        // ── 에너지 구체 ──
        if (showOrb)
          CustomPaint(
            size: const Size(300, 300),
            painter: EnergyOrbPainter(
              growth: orbGrowth,
              crackProgress: crackProgress,
              color: color,
              pulseScale: pulseScale,
              rainbow: rainbow,
              rainbowShift: _rotationController.value,
            ),
          ),

        // ── 폭발 파편 ──
        if (info.stage == _Stage.burst)
          CustomPaint(
            size: const Size(300, 300),
            painter: BurstShardsPainter(
              progress: burstProgress,
              shards: shardSeeds,
            ),
          ),

        // ── SSS 무지개 컨페티 ──
        if (info.stage == _Stage.burst && (grade?.hasRainbowConfetti ?? false))
          Positioned.fill(
            child: CustomPaint(
              painter: RainbowConfettiPainter(
                progress: burstProgress,
                pieces: confettiSeeds,
              ),
            ),
          ),

        // ── 카드 3D 회전 등장 ──
        if (showCard)
          _buildEnteringCard(grade, burstProgress),
      ],
    );
  }

  Widget _buildEnteringCard(GachaGrade? grade, double burstProgress) {
    final cardT = ((burstProgress - 0.15) / 0.7).clamp(0.0, 1.0);
    final curved = Curves.easeOutBack.transform(cardT);
    final scale = 0.2 + 0.8 * curved.clamp(0.0, 1.2);
    final rotateY = math.pi * (1 - curved.clamp(0.0, 1.0));

    return Transform(
      alignment: Alignment.center,
      transform: Matrix4.identity()
        ..setEntry(3, 2, 0.0012)
        ..rotateY(rotateY)
        ..scaleByDouble(scale, scale, scale, 1.0),
      child: Container(
        width: 168,
        height: 208,
        decoration: BoxDecoration(
          gradient: grade?.gradient,
          borderRadius: BorderRadius.circular(24),
          boxShadow: [
            BoxShadow(
              color: (grade?.glowColor ?? Colors.white).withValues(alpha: 0.55),
              blurRadius: 30,
              spreadRadius: 2,
            ),
          ],
        ),
        child: Center(
          child: Icon(
            Icons.card_giftcard_rounded,
            size: 72,
            color: Colors.white.withValues(alpha: 0.95),
          ),
        ),
      ),
    );
  }
}

enum _Stage { orb, crack, cutin, burst }

class _StageInfo {
  final _Stage stage;
  final double localT;
  final GachaGrade grade;
  const _StageInfo({required this.stage, required this.localT, required this.grade});
}

/// Stage2 컷인 오버레이: 대각선 번개 섬광 + 등급 엠블럼 슬라이드 + 심장박동 줌.
class _CutinOverlay extends StatelessWidget {
  final GachaGrade grade;
  final double localT;

  const _CutinOverlay({required this.grade, required this.localT});

  @override
  Widget build(BuildContext context) {
    final heartbeat = 1.0 + 0.06 * math.sin(localT * 4 * math.pi);
    final slideProgress = (localT * 2.4).clamp(0.0, 1.0);
    final slideX = (1 - Curves.easeOutCubic.transform(slideProgress)) * 260;

    return Stack(
      children: [
        Container(color: Colors.black.withValues(alpha: 0.55 * (1 - (localT - 0.7).clamp(0.0, 0.3) / 0.3))),
        CustomPaint(
          size: Size.infinite,
          painter: LightningCutinPainter(progress: localT, color: grade.primaryColor),
        ),
        Center(
          child: Transform.scale(
            scale: heartbeat,
            child: Transform.translate(
              offset: Offset(slideX, 0),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 14),
                decoration: BoxDecoration(
                  gradient: grade.gradient,
                  borderRadius: BorderRadius.circular(20),
                  boxShadow: [
                    BoxShadow(color: grade.glowColor.withValues(alpha: 0.6), blurRadius: 24, spreadRadius: 2),
                  ],
                ),
                child: Text(
                  grade.code,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 40,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 2,
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// 디버그 전용 등급 테스트 컨트롤러 패널 (kDebugMode에서만 렌더링됨).
class _DebugGradePanel extends StatelessWidget {
  final ValueChanged<GachaGrade> onSelect;
  final bool isPreview;
  final VoidCallback onClose;

  const _DebugGradePanel({
    required this.onSelect,
    required this.isPreview,
    required this.onClose,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(6),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.45),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            mainAxisSize: MainAxisSize.min,
            children: GachaGrade.values.map((g) {
              return Padding(
                padding: const EdgeInsets.symmetric(horizontal: 2),
                child: InkWell(
                  onTap: () => onSelect(g),
                  borderRadius: BorderRadius.circular(8),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                    decoration: BoxDecoration(
                      gradient: g.gradient,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      g.code,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ),
              );
            }).toList(),
          ),
          if (isPreview)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: TextButton(
                onPressed: onClose,
                style: TextButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  minimumSize: const Size(0, 24),
                ),
                child: const Text(
                  '프리뷰 종료',
                  style: TextStyle(color: Colors.white70, fontSize: 10),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

