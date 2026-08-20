import 'dart:math';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/rank_colors.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/providers/gp_provider.dart';
import '../../home/domain/capsule_box.dart';
import '../domain/draw_result.dart';
import '../domain/gacha_grade.dart';
import 'gacha_animation_page.dart';
import 'widgets/gacha_fx_painters.dart';

/// 가치가차 - 뽑기 결과 화면 (CLOVE 오리파 스타일 Stage5).
///
/// 전체 배경은 화이트이며, 최고 등급 결과 카드만 등급 컬러 아우라로 대비를
/// 준다. 결과 중 가장 높은 등급 1개를 상단에 크게 강조하고, count > 1이면
/// 나머지 결과를 화이트 배경 2열 그리드로 하단에 나열한다.
/// S/SSS 등급 당첨 시 화면 상단에서 색종이 낙하 효과를 재생한다.
///
/// 하단에는 CLOVE 오리파 핵심 기능인 3대 원클릭 액션 버튼을 제공한다:
///  - ⚡ 즉시 포인트로 환원: 결과 전체를 정가의 ~87% GP로 즉시 환급
///  - 📦 보관함에 담기: 서버에 이미 저장된 상태를 그대로 유지하고 확인만
///  - 🔄 한 번 더 뽑기: 동일 박스/수량으로 GP 차감 후 다음 뽑기 시퀀스 재실행
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

  bool _redeemed = false;
  bool _isRedeeming = false;
  bool _isRedrawing = false;

  GachaGrade get _highlightGrade => _highlightResult.gradeEnum;
  bool get _hasCelebration =>
      widget.results.any((r) => r.gradeEnum.hasCutinStage);
  bool get _hasRainbow =>
      widget.results.any((r) => r.gradeEnum.hasRainbowConfetti);

  int get _totalValue => widget.results.fold(0, (sum, r) => sum + r.price);
  int get _totalRefund =>
      widget.results.fold(0, (sum, r) => sum + r.refundPointGP);
  int get _totalSpent => widget.count * widget.box.priceWon;

  @override
  void initState() {
    super.initState();

    final sorted = [...widget.results]
      ..sort((a, b) => b.gradeEnum.rank.compareTo(a.gradeEnum.rank));
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

  /// ⚡ 즉시 포인트로 환원: 정가의 약 87%에 해당하는 GP를 즉시 지급하고
  /// 결과 화면을 닫는다. (서버에 이미 저장된 인벤토리 아이템은 실제
  /// "판매 처리" API가 없는 관계로, 낙관적 GP 지급 + 안내로 대체한다.)
  Future<void> _instantRefund() async {
    if (_redeemed || _isRedeeming) return;
    setState(() => _isRedeeming = true);
    HapticFeedback.mediumImpact();

    context.read<GpProvider>().add(_totalRefund);

    await Future<void>.delayed(const Duration(milliseconds: 420));
    if (!mounted) return;

    setState(() {
      _redeemed = true;
      _isRedeeming = false;
    });

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('${_formatWon(_totalRefund)} GP가 즉시 환원되었습니다'),
        backgroundColor: AppColors.accentViolet,
      ),
    );

    await Future<void>.delayed(const Duration(milliseconds: 500));
    if (!mounted) return;
    Navigator.of(context).popUntil((route) => route.isFirst);
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

  /// 🔄 한 번 더 뽑기: 현재 박스 가격만큼 GP를 낙관적으로 차감한 뒤,
  /// 동일한 박스/수량으로 뽑기 애니메이션을 즉시 재실행한다.
  Future<void> _drawAgain() async {
    if (_isRedrawing) return;
    final gp = context.read<GpProvider>();
    final cost = _totalSpent;

    if (gp.balance < cost) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('GP 잔액이 부족합니다')));
      return;
    }

    setState(() => _isRedrawing = true);
    HapticFeedback.mediumImpact();
    gp.spend(cost);

    if (!mounted) return;
    await Navigator.of(context).pushReplacement(
      MaterialPageRoute(
        builder: (context) =>
            GachaAnimationPage(box: widget.box, count: widget.count),
      ),
    );
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
                                      '지불 금액',
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

                // ── CLOVE 오리파 3대 원클릭 액션 버튼 ──
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                  child: Column(
                    children: [
                      // ⚡ 즉시 포인트로 환원 (전체 폭 강조 버튼)
                      SizedBox(
                        width: double.infinity,
                        height: 54,
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            gradient: _redeemed
                                ? null
                                : const LinearGradient(
                                    colors: [
                                      Color(0xFFFFC94A),
                                      AppColors.accentViolet,
                                    ],
                                    begin: Alignment.centerLeft,
                                    end: Alignment.centerRight,
                                  ),
                            color: _redeemed
                                ? AppColors.surfaceElevated2
                                : null,
                            borderRadius: BorderRadius.circular(16),
                          ),
                          child: Material(
                            type: MaterialType.transparency,
                            child: InkWell(
                              borderRadius: BorderRadius.circular(16),
                              onTap: _redeemed ? null : _instantRefund,
                              child: Center(
                                child: _isRedeeming
                                    ? const SizedBox(
                                        width: 20,
                                        height: 20,
                                        child: CircularProgressIndicator(
                                          strokeWidth: 2.4,
                                          valueColor:
                                              AlwaysStoppedAnimation<Color>(
                                                Colors.white,
                                              ),
                                        ),
                                      )
                                    : Text(
                                        _redeemed
                                            ? '환원 완료'
                                            : '⚡ 즉시 포인트로 환원 (+${_formatWon(_totalRefund)} GP)',
                                        style: TextStyle(
                                          color: _redeemed
                                              ? AppColors.textSecondary
                                              : Colors.white,
                                          fontSize: 14,
                                          fontWeight: FontWeight.w800,
                                        ),
                                      ),
                              ),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 10),
                      // 📦 보관함에 담기 / 🔄 한번더 뽑기 (1:1 비율)
                      Row(
                        children: [
                          Expanded(
                            child: SizedBox(
                              height: 50,
                              child: OutlinedButton(
                                onPressed: _saveToInventory,
                                style: OutlinedButton.styleFrom(
                                  foregroundColor: AppColors.textPrimary,
                                  side: const BorderSide(
                                    color: AppColors.surfaceBorder,
                                  ),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(14),
                                  ),
                                ),
                                child: const Text(
                                  '📦 보관함에 담기',
                                  style: TextStyle(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: SizedBox(
                              height: 50,
                              child: OutlinedButton(
                                onPressed: _isRedrawing ? null : _drawAgain,
                                style: OutlinedButton.styleFrom(
                                  foregroundColor: AppColors.primary,
                                  side: BorderSide(
                                    color: AppColors.primary.withValues(
                                      alpha: 0.5,
                                    ),
                                  ),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(14),
                                  ),
                                ),
                                child: _isRedrawing
                                    ? const SizedBox(
                                        width: 18,
                                        height: 18,
                                        child: CircularProgressIndicator(
                                          strokeWidth: 2.2,
                                        ),
                                      )
                                    : const Text(
                                        '🔄 한번더 뽑기',
                                        style: TextStyle(
                                          fontSize: 13,
                                          fontWeight: FontWeight.w800,
                                        ),
                                      ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
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
                      errorWidget: (context, url, error) =>
                          Icon(Icons.card_giftcard_rounded, size: 72, color: color),
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
                  '즉시환원가 ${widget.result.formattedRefundGP}',
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
                  if (_shimmerController.value <= 0) return const SizedBox.shrink();
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
                    child: Container(color: Colors.white.withValues(alpha: 0.001)),
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
