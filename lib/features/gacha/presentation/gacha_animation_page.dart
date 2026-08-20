import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/providers/auth_provider.dart';
import '../../home/domain/capsule_box.dart';
import '../domain/draw_result.dart';
import '../domain/gacha_logic.dart';
import 'gacha_result_page.dart';

/// 가치가차 - 캡슐 뽑기 진행 중 보여지는 전체 화면 애니메이션.
///
/// 앱 전체는 화이트+골드 테마이지만, 이 화면만은 몰입감을 위해
/// darkSurface(#111111) 배경을 유지한다. 중앙 박스 아이콘이 좌우로
/// 흔들리는 애니메이션을 재생하면서 동시에 백엔드 `POST /draws`를
/// 호출하고, 애니메이션 완료(또는 SKIP) + API 응답 수신이 모두
/// 끝나면 [GachaResultPage]로 화면을 교체(replace)한다.
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

  // API 호출 상태
  bool _animationDone = false;
  bool _apiDone = false;
  Object? _apiError;
  List<DrawResult>? _apiResults;

  @override
  void initState() {
    super.initState();

    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1800),
    );

    // -0.12 ~ 0.12 라디안 범위로 좌우 흔들림을 재생한다.
    _shakeAnimation = Tween<double>(
      begin: -0.12,
      end: 0.12,
    ).animate(CurvedAnimation(parent: _controller, curve: Curves.elasticIn));

    _controller.addStatusListener(_onStatusChanged);
    _controller.forward();

    _startDraw();
  }

  Future<void> _startDraw() async {
    try {
      final results = await drawGacha(widget.box.id, widget.count);
      if (!mounted) return;
      _apiResults = results;
    } catch (e) {
      if (!mounted) return;
      _apiError = e;
    } finally {
      _apiDone = true;
      _tryNavigate();
    }
  }

  void _onStatusChanged(AnimationStatus status) {
    if (status == AnimationStatus.completed) {
      _animationDone = true;
      _tryNavigate();
    }
  }

  /// SKIP 버튼: 애니메이션 완료를 기다리지 않고 즉시 완료로 표시.
  void _skip() {
    _animationDone = true;
    _tryNavigate();
  }

  void _tryNavigate() {
    if (_navigated || !mounted) return;
    // 애니메이션과 API 응답이 모두 끝나야 다음 화면으로 이동한다.
    if (!_animationDone || !_apiDone) return;
    _navigated = true;

    if (_apiError != null) {
      final message = _apiError is ApiException
          ? (_apiError as ApiException).message
          : '뽑기 중 오류가 발생했습니다';
      Navigator.of(context).pop();
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(message)));
      return;
    }

    // 뽑기 성공 → 잔액이 바뀌었으므로 프로필 새로고침 후 결과 화면으로 이동.
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
                onPressed: _skip,
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
