import 'dart:math';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../core/constants/rank_colors.dart';
import '../../../core/theme/app_colors.dart';
import '../../home/domain/capsule_box.dart';
import '../domain/draw_result.dart';
import '../domain/gacha_grade.dart';
import 'widgets/gacha_fx_painters.dart';

/// 가치가차 - 뽑기 결과 화면 (CLOVE 오리파 스타일 Stage5).
///
/// 전체 배경은 화이트이며, 최고 등급 결과 카드만 등급 컬러 아우라로 대비를
/// 준다. 결과 중 가장 높은 등급 1개를 상단에 크게 강조하고, count > 1이면
/// 나머지 결과를 화이트 배경 2열 그리드로 하단에 나열한다.
/// S/SSS 등급 당첨 시 화면 상단에서 색종이 낙하 효과를 재생한다.
///
/// 결과는 서버 확정값만 표시한다. 전환은 별도 서버 견적·확정 흐름에서 처리한다.
class GachaResultPage extends StatefulWidget {
  final CapsuleBox box;
  final int count;
  final List<DrawResult> results;

  const GachaResultPage({
    super.key,
    required this.box,
    required this.count,
    required this.results,
  });

  @override
  State<GachaResultPage> createState() => _GachaResultPageState();
}

class _GachaResultPageState extends State<GachaResultPage>
    with SingleTickerProviderStateMixin {
  late final AnimationController _entranceController;
  late final Animation<Offset> _slideAnimation;
  late final Animation<double> _fadeAnimation;

  late final DrawResult _highlightResult;
  late final List<DrawResult> _remainingResults;

  GachaGrade get _highlightGrade => _highlightResult.gradeEnum;
  bool get _hasCelebration =>
      widget.results.any((r) => r.gradeEnum.hasCutinStage);
  bool get _hasRainbow =>
      widget.results.any((r) => r.gradeEnum.hasRainbowConfetti);

  int get _totalValue => widget.results.fold(0, (sum, r) => sum + r.price);
  int get _totalSpent => widget.count * widget.box.priceWon;

  @override
  void initState() {
    super.initState();

    final sorted = [...widget.results]..sort(DrawResult.compareForReveal);
    _highlightResult = sorted.first;
    _remainingResults = sorted.skip(1).toList();

    _entranceController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    );
    _slideAnimation =
        Tween<Offset>(begin: const Offset(0, 0.2), end: Offset.zero).animate(
          CurvedAnimation(
            parent: _entranceController,
            curve: Curves.easeOutCubic,
          ),
        );
    _fadeAnimation = CurvedAnimation(
      parent: _entranceController,
      curve: Curves.easeOut,
    );
    _entranceController.forward();

    if (_highlightGrade.hasCutinStage) {
      HapticFeedback.heavyImpact();
    }
  }

  @override
  void dispose() {
    _entranceController.dispose();
    super.dispose();
  }

  String _formatWon(int value) {
    final str = value.toString();
    final buffer = StringBuffer();
    for (int i = 0; i < str.length; i++) {
      final posFromEnd = str.length - i;
      buffer.write(str[i]);
      if (posFromEnd > 1 && posFromEnd % 3 == 1) buffer.write(',');
    }
    return buffer.toString();
  }

  void _saveToInventory() {
    // 뽑기 결과는 서버(POST /draws)에서 이미 인벤토리에 저장되었으므로
    // 여기서는 확인 메시지만 보여주고 홈으로 복귀한다.
    HapticFeedback.selectionClick();
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(const SnackBar(content: Text('보관함에 저장되었습니다')));
    Navigator.of(context).popUntil((route) => route.isFirst);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.scaffoldBg,
      appBar: AppBar(
        backgroundColor: AppColors.scaffoldBg,
        elevation: 0,
        automaticallyImplyLeading: false,
        centerTitle: true,
        title: const Text(
          '뽑기 결과',
          style: TextStyle(
            color: AppColors.textPrimary,
            fontSize: 18,
            fontWeight: FontWeight.w700,
          ),
        ),
        actions: [
          IconButton(
            onPressed: () =>
                Navigator.of(context).popUntil((route) => route.isFirst),
            icon: const Icon(Icons.close_rounded, color: AppColors.textPrimary),
          ),
        ],
      ),
      body: Stack(
        children: [
          SafeArea(
            child: Column(
              children: [
                Expanded(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        // ── 최고 등급 강조 카드 (홀로그램 shimmer 포함) ──
                        SlideTransition(
                          position: _slideAnimation,
                          child: FadeTransition(
                            opacity: _fadeAnimation,
                            child: _HighlightCard(result: _highlightResult),
                          ),
                        ),

                        // ── 나머지 결과 2열 그리드 ──
                        if (_remainingResults.isNotEmpty) ...[
                          const SizedBox(height: 24),
                          const Align(
                            alignment: Alignment.centerLeft,
                            child: Text(
                              '획득한 다른 상품',
                              style: TextStyle(
                                color: AppColors.textPrimary,
                                fontSize: 15,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          const SizedBox(height: 12),
                          GridView.builder(
                            shrinkWrap: true,
                            physics: const NeverScrollableScrollPhysics(),
                            gridDelegate:
                                const SliverGridDelegateWithFixedCrossAxisCount(
                                  crossAxisCount: 2,
                                  mainAxisSpacing: 12,
                                  crossAxisSpacing: 12,
                                  mainAxisExtent: 100,
                                ),
                            itemCount: _remainingResults.length,
                            itemBuilder: (context, index) {
                              return _ResultGridCard(
                                result: _remainingResults[index],
                              );
                            },
                          ),
                        ],

                        const SizedBox(height: 24),

                        // ── 결과 요약 Row ──
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 16,
                            vertical: 14,
                          ),
                          decoration: BoxDecoration(
                            color: AppColors.surfaceElevated,
                            borderRadius: BorderRadius.circular(16),
                            border: Border.all(color: AppColors.surfaceBorder),
                          ),
                          child: Row(
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    const Text(
                                      '총 획득 가치',
                                      style: TextStyle(
                                        color: AppColors.textSecondary,
                                        fontSize: 12,
                                      ),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      '${_formatWon(_totalValue)}원',
                                      style: const TextStyle(
                                        color: AppColors.goldPrimary,
                                        fontSize: 16,
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              Container(
                                width: 1,
                                height: 32,
                                color: AppColors.surfaceBorder,
                              ),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.end,
                                  children: [
                                    const Text(
                                      '캡슐 기준 금액',
                                      style: TextStyle(
                                        color: AppColors.textSecondary,
                                        fontSize: 12,
                                      ),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      '${_formatWon(_totalSpent)}원',
                                      style: const TextStyle(
                                        color: AppColors.textSecondary,
                                        fontSize: 15,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),

                Padding(
                  padding: const EdgeInsets.all(16),
                  child: SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: _saveToInventory,
                      child: const Text('결과 확인'),
                    ),
                  ),
                ),
              ],
            ),
          ),

          // ── S/SSS 등급 당첨 시 색종이 낙하 효과 ──
          if (_hasCelebration)
            Positioned.fill(
              child: IgnorePointer(
                child: _ConfettiOverlay(rainbow: _hasRainbow),
              ),
            ),
        ],
      ),
    );
  }
}

/// 최고 등급 1개를 강조하는 카드. 등급 컬러 BoxShadow로 빛나는 효과를 내며,
/// 터치 시 무지개빛 홀로그램 광택 셰이더(Holographic Shimmer)가 스윕된다.
class _HighlightCard extends StatefulWidget {
  final DrawResult result;

  const _HighlightCard({required this.result});

  @override
  State<_HighlightCard> createState() => _HighlightCardState();
}

class _HighlightCardState extends State<_HighlightCard>
    with SingleTickerProviderStateMixin {
  late final AnimationController _shimmerController;

  @override
  void initState() {
    super.initState();
    _shimmerController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    );
  }

  @override
  void dispose() {
    _shimmerController.dispose();
    super.dispose();
  }

  void _triggerShimmer() {
    if (_shimmerController.isAnimating) return;
    HapticFeedback.selectionClick();
    _shimmerController.forward(from: 0);
  }

  @override
  Widget build(BuildContext context) {
    final grade = widget.result.gradeEnum;
    final color = grade.primaryColor;

    return GestureDetector(
      onTap: _triggerShimmer,
      child: Container(
        width: double.infinity,
        height: 220,
        padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 16),
        decoration: BoxDecoration(
          color: AppColors.surfaceElevated,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: AppColors.surfaceBorder),
          boxShadow: [
            BoxShadow(
              color: color.withValues(alpha: 0.55),
              blurRadius: 32,
              spreadRadius: 4,
            ),
          ],
        ),
        clipBehavior: Clip.antiAlias,
        child: Stack(
          children: [
            Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    gradient: grade.gradient,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    '${grade.code} 등급 · ${grade.label}',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                if (widget.result.imageUrl != null)
                  ClipRRect(
                    borderRadius: BorderRadius.circular(16),
                    child: CachedNetworkImage(
                      imageUrl: widget.result.imageUrl!,
                      width: 88,
                      height: 88,
                      fit: BoxFit.cover,
                      errorWidget: (context, url, error) => Icon(
                        Icons.card_giftcard_rounded,
                        size: 72,
                        color: color,
                      ),
                    ),
                  )
                else
                  Icon(Icons.card_giftcard_rounded, size: 72, color: color),
                const SizedBox(height: 12),
                Text(
                  widget.result.name,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  widget.result.formattedPrice,
                  style: const TextStyle(
                    color: AppColors.goldPrimary,
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '전환 GP: ${widget.result.formattedConversionGp}',
                  style: TextStyle(
                    color: AppColors.textSecondary.withValues(alpha: 0.9),
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),

            // ── 홀로그램 광택 셰이더 오버레이 ──
            IgnorePointer(
              child: AnimatedBuilder(
                animation: _shimmerController,
                builder: (context, child) {
                  if (_shimmerController.value <= 0)
                    return const SizedBox.shrink();
                  return ShaderMask(
                    blendMode: BlendMode.srcATop,
                    shaderCallback: (rect) {
                      final t = _shimmerController.value;
                      return LinearGradient(
                        colors: const [
                          Colors.transparent,
                          Color(0x99FFFFFF),
                          Color(0x66FF9DE8),
                          Color(0x66FFD54A),
                          Colors.transparent,
                        ],
                        stops: const [0.0, 0.42, 0.5, 0.58, 1.0],
                        begin: Alignment(-1.6 + 3.2 * t, -1),
                        end: Alignment(-0.6 + 3.2 * t, 1),
                      ).createShader(rect);
                    },
                    child: Container(
                      color: Colors.white.withValues(alpha: 0.001),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// 나머지 결과 2열 그리드에 사용되는 화이트 카드 (상단 4px 등급 컬러 라인).
class _ResultGridCard extends StatelessWidget {
  final DrawResult result;

  const _ResultGridCard({required this.result});

  @override
  Widget build(BuildContext context) {
    final color = RankColors.of(result.grade);

    return Container(
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.surfaceBorder),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 8,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // ── 상단 4px 등급 컬러 라인 ──
          Container(height: 4, color: color),
          Padding(
            padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 6,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: color.withValues(alpha: 0.6)),
                  ),
                  child: Text(
                    result.grade,
                    style: TextStyle(
                      color: color,
                      fontSize: 10,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  result.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  result.formattedPrice,
                  style: const TextStyle(
                    color: AppColors.goldPrimary,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// 색종이(Confetti) 낙하 효과.
///
/// 일반 S등급은 골드 dot 낙하, SSS(rainbow=true)인 경우
/// [RainbowConfettiPainter]를 사용한 무지개 3D 컨페티 폭발로 대체된다.
class _ConfettiOverlay extends StatefulWidget {
  final bool rainbow;

  const _ConfettiOverlay({this.rainbow = false});

  @override
  State<_ConfettiOverlay> createState() => _ConfettiOverlayState();
}

class _ConfettiOverlayState extends State<_ConfettiOverlay>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  final Random _random = Random();
  late final List<_ConfettiDot> _dots;
  List<ConfettiPiece3D>? _rainbowPieces;

  static const List<Color> _confettiColors = [
    AppColors.goldPrimary,
    AppColors.goldSecondary,
    Color(0xFFFFE082),
  ];

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 3),
    )..forward();

    _dots = List.generate(20, (index) {
      return _ConfettiDot(
        startX: _random.nextDouble(),
        delay: _random.nextDouble() * 0.3,
        color: _confettiColors[_random.nextInt(_confettiColors.length)],
        size: 6 + _random.nextDouble() * 6,
      );
    });

    if (widget.rainbow) {
      _rainbowPieces = RainbowConfettiPainter.generate(60);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.rainbow) {
      return LayoutBuilder(
        builder: (context, constraints) {
          return AnimatedBuilder(
            animation: _controller,
            builder: (context, child) {
              return CustomPaint(
                size: Size(constraints.maxWidth, constraints.maxHeight),
                painter: RainbowConfettiPainter(
                  progress: _controller.value,
                  pieces: _rainbowPieces!,
                ),
              );
            },
          );
        },
      );
    }

    return LayoutBuilder(
      builder: (context, constraints) {
        return AnimatedBuilder(
          animation: _controller,
          builder: (context, child) {
            return Stack(
              children: _dots.map((dot) {
                final progress =
                    ((_controller.value - dot.delay) / (1 - dot.delay)).clamp(
                      0.0,
                      1.0,
                    );
                final dy = progress * (constraints.maxHeight + 40) - 20;
                final dx = dot.startX * constraints.maxWidth;

                return Positioned(
                  left: dx,
                  top: dy,
                  child: Container(
                    width: dot.size,
                    height: dot.size,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: dot.color.withValues(
                        alpha: (1 - progress * 0.3).clamp(0.0, 1.0),
                      ),
                    ),
                  ),
                );
              }).toList(),
            );
          },
        );
      },
    );
  }
}

class _ConfettiDot {
  final double startX;
  final double delay;
  final Color color;
  final double size;

  const _ConfettiDot({
    required this.startX,
    required this.delay,
    required this.color,
    required this.size,
  });
}
