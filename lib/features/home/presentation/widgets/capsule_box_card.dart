import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../domain/capsule_box.dart';

/// 가치가차 - 홈 "인기 랜덤박스" 그리드에 사용되는 캡슐 카드.
///
/// 화이트 앱 셸 위에서도 카드 자체는 다크(AppColors.darkSurface) 배경의
/// 프로모션 카드 스타일을 유지한다. 카드 전체 높이는 부모(GridView)의
/// mainAxisExtent(고정 높이)로 결정되며, 내부는 상단 75% 썸네일
/// (그라데이션+아이콘+뱃지) / 하단 25% 정보(이름/가격)로 고정 비율
/// 분할되어, 화면 폭과 무관하게 정보 영역이 항상 보이도록 구성.
class CapsuleBoxCard extends StatelessWidget {
  final CapsuleBox box;
  final VoidCallback onTap;

  const CapsuleBoxCard({super.key, required this.box, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.darkSurface,
      borderRadius: BorderRadius.circular(12),
      elevation: 3,
      shadowColor: Colors.black.withValues(alpha: 0.25),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: LayoutBuilder(
          builder: (context, constraints) {
            final cardHeight = constraints.maxHeight;
            final thumbnailHeight = cardHeight * 0.75;
            final infoHeight = cardHeight * 0.25;

            return Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // ── 상단 75% 썸네일 ──
                SizedBox(
                  height: thumbnailHeight,
                  child: ClipRRect(
                    borderRadius: const BorderRadius.vertical(
                      top: Radius.circular(12),
                    ),
                    child: Stack(
                      children: [
                        Positioned.fill(
                          child: Container(
                            decoration: BoxDecoration(
                              gradient: LinearGradient(
                                colors: [
                                  box.accentColor.withValues(alpha: 0.9),
                                  AppColors.darkSurface,
                                ],
                                begin: Alignment.topLeft,
                                end: Alignment.bottomRight,
                              ),
                            ),
                          ),
                        ),
                        Positioned.fill(
                          child: Center(
                            child: Icon(
                              box.icon,
                              size: 56,
                              color: Colors.white,
                            ),
                          ),
                        ),
                        if (box.badgeLabel != null)
                          Positioned(
                            left: 8,
                            top: 8,
                            child: Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 8,
                                vertical: 4,
                              ),
                              decoration: BoxDecoration(
                                color: box.badgeLabel == 'NEW'
                                    ? AppColors.badgeNew
                                    : AppColors.badgeSpecial,
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: Text(
                                box.badgeLabel!,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 10,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
                // ── 하단 25% 정보 (박스명/가격) ──
                SizedBox(
                  height: infoHeight,
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(10, 4, 10, 4),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          box.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          box.formattedPrice,
                          style: const TextStyle(
                            color: AppColors.goldPrimary,
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}
