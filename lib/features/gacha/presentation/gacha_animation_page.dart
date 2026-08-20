import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import '../../home/domain/capsule_box.dart';
import '../domain/gacha_logic.dart';
import 'gacha_result_page.dart';

/// 가치가차 - 캡슐 뽑기 진행 중 보여지는 전체 화면 애니메이션.
///
/// 앱 전체는 화이트+골드 테마이지만, 이 화면만은 몰입감을 위해
/// darkSurface(#111111) 배경을 유지한다. 중앙 박스 아이콘이 좌우로
/// 흔들리는 애니메이션을 재생하고, 완료 즉시(또는 SKIP 시) 더미 뽑기
/// 로직([drawGacha])으로 결과를 생성해 [GachaResultPage]로 화면을
/// 교체(replace)한다.
class GachaAnimationPage extends StatefulWidget {
  final CapsuleBox box;
  final int count;

  const GachaAnimationPage({super.key, required this.box, required this.count});

  @override
  State<GachaAnimationPage> createState() => _GachaAnimationPageState();
}

class _GachaAnimationPageState extends State<GachaAnimationPage>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _shakeAnimation;
  bool _navigated = false;

  @override
  void initState() {
    super.initState();

    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1800),
    );

    // -0.12 ~ 0.12 라디안 범위로 좌우 흔들림을 재생한다.
    // Curves.elasticIn을 적용해 튕기듯 감기는 느낌을 준다.
    _shakeAnimation = Tween<double>(
      begin: -0.12,
      end: 0.12,
    ).animate(CurvedAnimation(parent: _controller, curve: Curves.elasticIn));

    _controller.addStatusListener(_onStatusChanged);
    _controller.forward();
  }

  void _onStatusChanged(AnimationStatus status) {
    if (status == AnimationStatus.completed) {
      _goToResult();
    }
  }

  void _goToResult() {
    if (_navigated || !mounted) return;
    _navigated = true;
    final results = drawGacha(widget.count);
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(
        builder: (context) => GachaResultPage(
          box: widget.box,
          count: widget.count,
          results: results,
        ),
      ),
    );
  }

  @override
  void dispose() {
    _controller.removeStatusListener(_onStatusChanged);
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.darkSurface,
      body: SafeArea(
        child: Stack(
          children: [
            Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  AnimatedBuilder(
                    animation: _shakeAnimation,
                    builder: (context, child) {
                      return Transform.rotate(
                        angle: _shakeAnimation.value,
                        child: child,
                      );
                    },
                    child: ShaderMask(
                      shaderCallback: (bounds) =>
                          AppColors.goldGradient.createShader(
                            Rect.fromLTWH(0, 0, bounds.width, bounds.height),
                          ),
                      child: const Icon(
                        Icons.all_inbox_rounded,
                        size: 120,
                        color: Colors.white,
                      ),
                    ),
                  ),
                  const SizedBox(height: 32),
                  const Text(
                    '캡슐을 여는 중...',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),

            // ── 우하단 SKIP 버튼 ──
            Positioned(
              right: 16,
              bottom: 16,
              child: TextButton(
                onPressed: _goToResult,
                child: const Text(
                  'SKIP',
                  style: TextStyle(
                    color: AppColors.goldPrimary,
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 1,
                  ),
                ),
              ),
            ),

            // ── 하단 골드 진행률 표시 ──
            Positioned(
              left: 24,
              right: 24,
              bottom: 64,
              child: AnimatedBuilder(
                animation: _controller,
                builder: (context, child) {
                  return ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: LinearProgressIndicator(
                      value: _controller.value,
                      minHeight: 6,
                      backgroundColor: Colors.white.withValues(alpha: 0.15),
                      valueColor: const AlwaysStoppedAnimation<Color>(
                        AppColors.goldPrimary,
                      ),
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
