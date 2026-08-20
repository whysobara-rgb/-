import 'dart:math';
import 'package:flutter/material.dart';
import '../../../core/constants/rank_colors.dart';
import '../../../core/theme/app_colors.dart';
import '../../home/domain/capsule_box.dart';
import '../domain/draw_result.dart';

/// 가치가차 - 뽑기 결과 화면.
///
/// 전체 배경은 화이트이며, 최고 등급 결과 카드만 다크로 대비를 준다.
/// 결과 중 가장 높은 등급 1개를 상단에 크게 강조하고, count > 1이면
/// 나머지 결과를 화이트 배경 2열 그리드로 하단에 나열한다.
/// S등급 당첨 시 화면 상단에서 골드 색종이(dot) 낙하 효과를 재생한다.
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
  bool get _hasSGrade => widget.results.any((r) => r.grade == 'S');

  // 등급 우선순위: S > A > B > C (숫자가 작을수록 높은 등급)
  static const Map<String, int> _gradeRank = {'S': 0, 'A': 1, 'B': 2, 'C': 3};

  int get _totalValue => widget.results.fold(0, (sum, r) => sum + r.price);

  int get _totalSpent => widget.count * widget.box.priceWon;

  @override
  void initState() {
    super.initState();

    final sorted = [...widget.results]
      ..sort((a, b) => _gradeRank[a.grade]!.compareTo(_gradeRank[b.grade]!));
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
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(const SnackBar(content: Text('보관함에 저장되었습니다')));
    // 홈 화면(MainNavigation)까지 push된 화면들을 모두 pop.
    Navigator.of(context).popUntil((route) => route.isFirst);
  }

  void _drawAgain() {
    // 애니메이션 화면은 pushReplacement로 대체되었으므로, 뒤로가기 한 번이면
    // 캡슐 상세 화면으로 복귀한다.
    Navigator.of(context).pop();
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
                        // ── 최고 등급 강조 카드 ──
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
                            color: Colors.white,
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

                // ── 하단 버튼 2개 (1:1 비율) ──
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                  child: Row(
                    children: [
                      Expanded(
                        child: SizedBox(
                          height: 52,
                          child: ElevatedButton(
                            onPressed: _saveToInventory,
                            style: ElevatedButton.styleFrom(
                              backgroundColor: AppColors.darkSurface,
                              foregroundColor: Colors.white,
                              elevation: 0,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(14),
                              ),
                            ),
                            child: const Text(
                              '보관함에 저장',
                              style: TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: SizedBox(
                          height: 52,
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              gradient: AppColors.goldGradient,
                              borderRadius: BorderRadius.circular(14),
                            ),
                            child: Material(
                              type: MaterialType.transparency,
                              child: InkWell(
                                borderRadius: BorderRadius.circular(14),
                                onTap: _drawAgain,
                                child: const Center(
                                  child: Text(
                                    '한 번 더 뽑기',
                                    style: TextStyle(
                                      color: AppColors.textPrimary,
                                      fontSize: 14,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          // ── S등급 당첨 시 골드 색종이(dot) 낙하 효과 ──
          if (_hasSGrade)
            const Positioned.fill(
              child: IgnorePointer(child: _ConfettiOverlay()),
            ),
        ],
      ),
    );
  }
}

/// 최고 등급 1개를 강조하는 카드. 등급 컬러 BoxShadow로 빛나는 효과를 낸다.
class _HighlightCard extends StatelessWidget {
  final DrawResult result;

  const _HighlightCard({required this.result});

  @override
  Widget build(BuildContext context) {
    final color = RankColors.of(result.grade);

    return Container(
      width: double.infinity,
      height: 200,
      padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 16),
      decoration: BoxDecoration(
        color: AppColors.darkSurface,
        borderRadius: BorderRadius.circular(20),
        boxShadow: [
          BoxShadow(
            color: color.withValues(alpha: 0.55),
            blurRadius: 32,
            spreadRadius: 4,
          ),
        ],
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            decoration: BoxDecoration(
              color: color,
              borderRadius: BorderRadius.circular(20),
            ),
            child: Text(
              '${result.grade} 등급',
              style: const TextStyle(
                color: Colors.white,
                fontSize: 13,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          const SizedBox(height: 12),
          Icon(Icons.card_giftcard_rounded, size: 72, color: color),
          const SizedBox(height: 12),
          Text(
            result.name,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 18,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            result.formattedPrice,
            style: const TextStyle(
              color: AppColors.goldPrimary,
              fontSize: 15,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
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
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
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

/// 간단한 골드 색종이(Confetti) 낙하 효과.
///
/// 외부 패키지 없이 AnimationController + 20개의 작은 원(dot)으로
/// 화면 상단에서 아래로 떨어지는 낙하 애니메이션을 직접 구현한다.
class _ConfettiOverlay extends StatefulWidget {
  const _ConfettiOverlay();

  @override
  State<_ConfettiOverlay> createState() => _ConfettiOverlayState();
}

class _ConfettiOverlayState extends State<_ConfettiOverlay>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  final Random _random = Random();
  late final List<_ConfettiDot> _dots;

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
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
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
