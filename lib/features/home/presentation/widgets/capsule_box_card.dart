import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../domain/capsule_box.dart';

/// 가치가차 - 홈 "인기 랜덤박스" 그리드에 사용되는 캡슐 카드.
///
/// TIF 스타일 실제 상품 사진 카드: 상단 정사각형에 가까운 영역에
/// [box.imageUrl] 실제 상품 사진을 채우고, 그 위에 그라데이션 오버레이로
/// 하단 텍스트 가독성을 확보한다. 이미지 로딩 실패/미제공 시에는
/// 기존 아이콘+그라데이션 폴백으로 자연스럽게 전환된다.
class CapsuleBoxCard extends StatelessWidget {
  final CapsuleBox box;
  final VoidCallback onTap;

  const CapsuleBoxCard({super.key, required this.box, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surfaceElevated,
      borderRadius: BorderRadius.circular(16),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: LayoutBuilder(
          builder: (context, constraints) {
            final cardHeight = constraints.maxHeight;
            final thumbnailHeight = cardHeight * 0.68;
            final infoHeight = cardHeight * 0.32;

            return Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // ── 상단 썸네일: 실제 상품 이미지 + 오버레이 ──
                SizedBox(
                  height: thumbnailHeight,
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      _Thumbnail(box: box),
                      // 하단 그라데이션 오버레이 (텍스트 가독성 확보용, 이미지 위)
                      const Positioned.fill(
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              begin: Alignment.topCenter,
                              end: Alignment.bottomCenter,
                              colors: [
                                Colors.transparent,
                                Colors.transparent,
                                Color(0x33000000),
                              ],
                              stops: [0.0, 0.55, 1.0],
                            ),
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
                                letterSpacing: 0.2,
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                // ── 하단 정보 (박스명/가격) ──
                Container(
                  height: infoHeight,
                  padding: const EdgeInsets.fromLTRB(10, 6, 10, 8),
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
                          color: AppColors.textPrimary,
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        box.formattedPrice,
                        style: const TextStyle(
                          color: AppColors.neonPrimary,
                          fontSize: 14,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
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

/// 카드 썸네일: [imageUrl]이 있으면 실제 사진, 없거나 로딩 실패 시
/// 그라데이션 + 아이콘으로 폴백.
class _Thumbnail extends StatelessWidget {
  final CapsuleBox box;

  const _Thumbnail({required this.box});

  @override
  Widget build(BuildContext context) {
    final url = box.imageUrl;
    if (url == null || url.isEmpty) {
      return _IconFallback(box: box);
    }
    return CachedNetworkImage(
      imageUrl: url,
      fit: BoxFit.cover,
      fadeInDuration: const Duration(milliseconds: 200),
      placeholder: (context, url) => Container(
        color: AppColors.surfaceElevated2,
        child: const Center(
          child: SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: AppColors.neonPrimary,
            ),
          ),
        ),
      ),
      errorWidget: (context, url, error) => _IconFallback(box: box),
    );
  }
}

class _IconFallback extends StatelessWidget {
  final CapsuleBox box;

  const _IconFallback({required this.box});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            box.accentColor.withValues(alpha: 0.85),
            AppColors.surfaceElevated2,
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: Center(child: Icon(box.icon, size: 48, color: Colors.white)),
    );
  }
}
