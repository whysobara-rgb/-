import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../domain/capsule_box.dart';

/// 가치가차 - 홈 상품 그리드에 사용되는 캡슐(랜덤박스) 카드.
///
/// Claymorphism & Pastel 3D 스타일 - 깨끗한 화이트 라운드 카드
/// (border-radius 20px) 위에 실제 상품 이미지를 얹고, 우측 상단에
/// 대각선 리본 뱃지(HOT=주황, NEW=민트)를 배치한다. 상품명은 블랙 볼드,
/// 가격은 바이올렛 포인트 컬러로 강조한다.
class CapsuleBoxCard extends StatelessWidget {
  final CapsuleBox box;
  final VoidCallback onTap;

  const CapsuleBoxCard({super.key, required this.box, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surfaceElevated,
      borderRadius: BorderRadius.circular(20),
      elevation: 0,
      clipBehavior: Clip.antiAlias,
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(20),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.06),
              blurRadius: 16,
              offset: const Offset(0, 6),
            ),
          ],
        ),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(20),
          child: LayoutBuilder(
            builder: (context, constraints) {
              final cardHeight = constraints.maxHeight;
              final thumbnailHeight = cardHeight * 0.66;
              final infoHeight = cardHeight * 0.34;

              return Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // ── 상단 썸네일: 실제 상품 이미지 ──
                  SizedBox(
                    height: thumbnailHeight,
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        ClipRRect(
                          borderRadius: const BorderRadius.vertical(
                            top: Radius.circular(20),
                          ),
                          child: _Thumbnail(box: box),
                        ),
                        if (box.badgeLabel != null)
                          Positioned(
                            top: 0,
                            right: 0,
                            child: _RibbonBadge(
                              isNew: box.badgeLabel == 'NEW',
                            ),
                          ),
                      ],
                    ),
                  ),
                  // ── 하단 정보 (박스명/가격) ──
                  Container(
                    height: infoHeight,
                    padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.center,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          box.name,
                          maxLines: 1,
                          textAlign: TextAlign.center,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 13,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          box.formattedPrice,
                          style: const TextStyle(
                            color: AppColors.accentViolet,
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
      ),
    );
  }
}

/// 카드 우측 상단에 걸쳐지는 대각선 3D 리본 뱃지.
/// HOT = 주황 리본, NEW = 민트 리본.
class _RibbonBadge extends StatelessWidget {
  final bool isNew;

  const _RibbonBadge({required this.isNew});

  @override
  Widget build(BuildContext context) {
    final gradient = isNew ? AppColors.ribbonNew : AppColors.ribbonHot;
    final shadowColor = isNew
        ? const Color(0xFF12A37E)
        : const Color(0xFFFF6B3D);

    return SizedBox(
      width: 64,
      height: 64,
      child: Transform.rotate(
        angle: 0.7854, // 45도
        child: Container(
          width: 90,
          margin: const EdgeInsets.only(top: 14),
          padding: const EdgeInsets.symmetric(vertical: 4),
          decoration: BoxDecoration(
            gradient: gradient,
            boxShadow: [
              BoxShadow(
                color: shadowColor.withValues(alpha: 0.5),
                blurRadius: 4,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          child: Text(
            isNew ? 'NEW' : 'HOT',
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 10,
              fontWeight: FontWeight.w900,
              letterSpacing: 0.5,
            ),
          ),
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
              color: AppColors.accentViolet,
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
