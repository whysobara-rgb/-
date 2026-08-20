import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';

/// 가치가차 - 홈 화면 메인 럭키 PICK 배너.
///
/// Claymorphism & Pastel 3D 컨셉 - 코랄 오렌지 → 바이올렛 → 스카이블루로
/// 이어지는 오가닉 멀티스톱 그라데이션 배경 위에, 두껍고 귀여운 3D 스타일
/// 화이트 볼드 타이포와 별/반짝이 이펙트, 그리고 리본 달린 선물 상자
/// 캐릭터(아이콘 레이어드 방식)와 컨페티 그래픽을 배치한다.
/// 페이지 인디케이터는 디자인 몰입감을 위해 제거되었다.
class HomeBannerCarousel extends StatelessWidget {
  const HomeBannerCarousel({super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Container(
        height: 168,
        width: double.infinity,
        decoration: BoxDecoration(
          gradient: AppColors.luckyBannerGradient,
          borderRadius: BorderRadius.circular(28),
          boxShadow: [
            BoxShadow(
              color: AppColors.accentViolet.withValues(alpha: 0.32),
              blurRadius: 24,
              offset: const Offset(0, 12),
            ),
          ],
        ),
        clipBehavior: Clip.antiAlias,
        child: Stack(
          children: [
            // ── 배경 컨페티 도트 ──
            const Positioned.fill(child: _ConfettiLayer()),

            // ── 텍스트 ──
            Positioned(
              left: 24,
              top: 30,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Text(
                        '오늘의',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 24,
                          fontWeight: FontWeight.w900,
                          height: 1.15,
                          shadows: [
                            Shadow(
                              color: Color(0x40000000),
                              offset: Offset(0, 2),
                              blurRadius: 4,
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 6),
                      Icon(
                        Icons.auto_awesome_rounded,
                        color: Colors.white.withValues(alpha: 0.95),
                        size: 20,
                      ),
                    ],
                  ),
                  const Text(
                    '럭키 PICK!',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 26,
                      fontWeight: FontWeight.w900,
                      height: 1.15,
                      shadows: [
                        Shadow(
                          color: Color(0x40000000),
                          offset: Offset(0, 2),
                          blurRadius: 4,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            // ── 3D 럭키 선물상자 캐릭터 (레이어드 아이콘 구성) ──
            const Positioned(right: 18, bottom: 12, child: _GiftBoxCharacter()),
          ],
        ),
      ),
    );
  }
}

/// 배경에 흩뿌려진 작은 별/반짝이 컨페티 점들.
class _ConfettiLayer extends StatelessWidget {
  const _ConfettiLayer();

  static const List<Offset> _positions = [
    Offset(0.12, 0.18),
    Offset(0.28, 0.62),
    Offset(0.45, 0.15),
    Offset(0.62, 0.75),
    Offset(0.78, 0.22),
    Offset(0.08, 0.78),
    Offset(0.52, 0.42),
  ];

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        return Stack(
          children: List.generate(_positions.length, (index) {
            final pos = _positions[index];
            final isStar = index.isEven;
            return Positioned(
              left: pos.dx * constraints.maxWidth,
              top: pos.dy * constraints.maxHeight,
              child: Icon(
                isStar ? Icons.star_rounded : Icons.circle,
                color: Colors.white.withValues(alpha: isStar ? 0.55 : 0.35),
                size: isStar ? 12 : 6,
              ),
            );
          }),
        );
      },
    );
  }
}

/// 날개 달린 귀여운 3D 럭키 선물상자 캐릭터를 레이어드 아이콘으로 표현.
/// (실제 3D 렌더링 이미지 에셋으로 교체 가능한 자리표시자 역할)
class _GiftBoxCharacter extends StatelessWidget {
  const _GiftBoxCharacter();

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 100,
      height: 100,
      child: Stack(
        alignment: Alignment.center,
        clipBehavior: Clip.none,
        children: [
          // 날개 (좌우)
          Positioned(
            left: -6,
            top: 24,
            child: Transform.rotate(
              angle: -0.35,
              child: Icon(
                Icons.flutter_dash_rounded,
                color: Colors.white.withValues(alpha: 0.9),
                size: 34,
              ),
            ),
          ),
          Positioned(
            right: -6,
            top: 24,
            child: Transform.rotate(
              angle: 0.35 + math.pi,
              child: Icon(
                Icons.flutter_dash_rounded,
                color: Colors.white.withValues(alpha: 0.9),
                size: 34,
              ),
            ),
          ),
          // 선물상자 본체
          Container(
            width: 68,
            height: 60,
            margin: const EdgeInsets.only(top: 18),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Colors.white, Color(0xFFFFE8E0)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(14),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x33000000),
                  blurRadius: 10,
                  offset: Offset(0, 6),
                ),
              ],
            ),
            child: Stack(
              alignment: Alignment.center,
              children: [
                // 리본 세로줄
                Container(width: 12, color: AppColors.primary.withValues(alpha: 0.85)),
                // 리본 가로줄
                Positioned(
                  top: 8,
                  child: Container(
                    width: 68,
                    height: 12,
                    color: AppColors.primary.withValues(alpha: 0.85),
                  ),
                ),
                // 표정 (웃는 눈+입)
                Positioned(
                  bottom: 10,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      _eye(),
                      const SizedBox(width: 10),
                      _eye(),
                    ],
                  ),
                ),
              ],
            ),
          ),
          // 리본 매듭 (상단)
          Positioned(
            top: 4,
            child: Icon(
              Icons.card_giftcard_rounded,
              color: AppColors.primaryDark,
              size: 18,
            ),
          ),
        ],
      ),
    );
  }

  Widget _eye() {
    return Container(
      width: 5,
      height: 5,
      decoration: const BoxDecoration(
        color: Color(0xFF2B2430),
        shape: BoxShape.circle,
      ),
    );
  }
}
