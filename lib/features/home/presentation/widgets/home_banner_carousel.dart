import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';

/// 가치가차 - 홈 화면 메인 럭키 PICK 배너.
///
/// Claymorphism & Pastel 3D 컨셉 - 코랄 오렌지 → 바이올렛 → 스카이블루로
/// 이어지는 오가닉 멀티스톱 그라데이션 배경 위에, 두껍고 귀여운 3D 스타일
/// 화이트 볼드 타이포와 별/반짝이 이펙트, 그리고 날개 달린 3D 렌더링
/// 선물상자 캐릭터 이미지와 컨페티 그래픽을 배치한다.
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

            // ── 3D 럭키 선물상자 캐릭터 (실사 3D 렌더링 이미지) ──
            Positioned(
              right: 12,
              bottom: 4,
              child: Image.asset(
                'assets/images/banner_gift_character.png',
                width: 116,
                height: 116,
                fit: BoxFit.contain,
                errorBuilder: (context, error, stackTrace) =>
                    const SizedBox.shrink(),
              ),
            ),
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
