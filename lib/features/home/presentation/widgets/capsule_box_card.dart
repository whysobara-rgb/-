import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/product_image_mapper.dart';
import '../../domain/capsule_box.dart';

/// 가치가차 - 홈 상품 그리드에 사용되는 캡슐(랜덤박스) 카드.
///
/// Claymorphism & Pastel 3D 스타일 - 순백색 라운드 카드
/// (border-radius 24px, box-shadow 0 12px 24px rgba(0,0,0,0.06))
/// + 연한 파스텔 소프트 섀도우 위에 3D
/// 클레이 렌더링 상품 이미지를 얹고, 우측 상단 모서리에 걸쳐지는
/// 로제트(원형+리본 꼬리) 뱃지(HOT=주황, NEW=민트)를 배치한다.
/// 상품명은 블랙 볼드, 가격은 바이올렛 포인트 컬러로 강조한다.
class CapsuleBoxCard extends StatelessWidget {
  final CapsuleBox box;
  final VoidCallback onTap;

  const CapsuleBoxCard({super.key, required this.box, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 24,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(24),
          child: LayoutBuilder(
            builder: (context, constraints) {
              final cardHeight = constraints.maxHeight;
              final thumbnailHeight = cardHeight * 0.66;
              final infoHeight = cardHeight * 0.34;

              return Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // ── 상단 썸네일: 순백 배경 + 3D 클레이 상품 이미지 ──
                  SizedBox(
                    height: thumbnailHeight,
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        ColoredBox(
                          color: Colors.white,
                          child: _Thumbnail(box: box),
                        ),
                        if (box.badgeLabel != null)
                          Positioned(
                            top: -2,
                            right: -2,
                            child: _RosetteBadge(
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

/// 카드 우측 상단 모서리에 걸쳐지는 로제트(원형+리본 꼬리) 뱃지.
/// HOT = 주황 리본, NEW = 민트 리본. 텍스트는 원형 중앙에 정렬된다.
class _RosetteBadge extends StatelessWidget {
  final bool isNew;

  const _RosetteBadge({required this.isNew});

  @override
  Widget build(BuildContext context) {
    final gradient = isNew ? AppColors.ribbonNew : AppColors.ribbonHot;
    final shadowColor = isNew
        ? const Color(0xFF12A37E)
        : const Color(0xFFFF6B3D);

    return SizedBox(
      width: 52,
      height: 60,
      child: Stack(
        alignment: Alignment.topCenter,
        clipBehavior: Clip.none,
        children: [
          // 리본 꼬리 (원형 배지 하단, V자 노치)
          Positioned(
            top: 26,
            child: ClipPath(
              clipper: _RibbonTailClipper(),
              child: Container(
                width: 34,
                height: 18,
                decoration: BoxDecoration(
                  gradient: gradient,
                  boxShadow: [
                    BoxShadow(
                      color: shadowColor.withValues(alpha: 0.35),
                      blurRadius: 3,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
              ),
            ),
          ),
          // 원형 로제트 배지 본체
          Positioned(
            top: 6,
            child: Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                gradient: gradient,
                shape: BoxShape.circle,
                border: Border.all(color: Colors.white, width: 2),
                boxShadow: [
                  BoxShadow(
                    color: shadowColor.withValues(alpha: 0.45),
                    blurRadius: 8,
                    offset: const Offset(0, 3),
                  ),
                ],
              ),
              alignment: Alignment.center,
              child: Text(
                isNew ? 'NEW' : 'HOT',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 9.5,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 0.2,
                  height: 1,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 리본 꼬리 하단에 V자(제비꼬리) 노치를 만드는 클리퍼.
class _RibbonTailClipper extends CustomClipper<Path> {
  @override
  Path getClip(Size size) {
    final path = Path();
    path.moveTo(0, 0);
    path.lineTo(size.width, 0);
    path.lineTo(size.width, size.height);
    path.lineTo(size.width / 2, size.height - 6);
    path.lineTo(0, size.height);
    path.close();
    return path;
  }

  @override
  bool shouldReclip(covariant CustomClipper<Path> oldClipper) => false;
}

/// 카드 썸네일: [imageUrl]이 있으면 실제 사진, 없거나 로딩 실패 시
/// 로컬 3D 클레이 렌더링 상품 이미지로 폴백한다 (2D 픽토그램 아이콘은
/// 상단 톤앤매너와 이질감이 있어 더 이상 사용하지 않는다).
class _Thumbnail extends StatelessWidget {
  final CapsuleBox box;

  const _Thumbnail({required this.box});

  @override
  Widget build(BuildContext context) {
    final url = box.imageUrl;
    if (url == null || url.isEmpty) {
      return _ClayProductImage(box: box);
    }
    return CachedNetworkImage(
      imageUrl: url,
      fit: BoxFit.cover,
      fadeInDuration: const Duration(milliseconds: 200),
      placeholder: (context, url) => _ClayProductImage(box: box),
      errorWidget: (context, url, error) => _ClayProductImage(box: box),
    );
  }
}

/// 상품 카테고리에 맞는 로컬 3D 클레이 렌더링 이미지를 파스텔
/// 배경 위에 여백을 두고 배치하는 위젯.
class _ClayProductImage extends StatelessWidget {
  final CapsuleBox box;

  const _ClayProductImage({required this.box});

  @override
  Widget build(BuildContext context) {
    return Container(
      color: box.accentColor.withValues(alpha: 0.08),
      padding: const EdgeInsets.all(18),
      child: Image.asset(
        ProductImageMapper.resolve(box.iconName),
        fit: BoxFit.contain,
        errorBuilder: (context, error, stackTrace) =>
            Center(child: Icon(box.icon, size: 48, color: box.accentColor)),
      ),
    );
  }
}
