import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';

/// 상품 사진. 사진이 없거나 로드에 실패하면 중립 회색 바탕 위에
/// 얇은 아이콘만 둔다(대체 일러스트를 넣지 않는다).
class ProductImage extends StatelessWidget {
  final String? url;
  final BorderRadius borderRadius;
  final BoxFit fit;
  final IconData fallbackIcon;
  final Color background;

  const ProductImage({
    super.key,
    required this.url,
    this.borderRadius = Radii.thumb,
    this.fit = BoxFit.cover,
    this.fallbackIcon = Icons.image_outlined,
    this.background = AppColors.bgSubtle,
  });

  @override
  Widget build(BuildContext context) {
    final src = url;
    final placeholder = _Placeholder(
      icon: fallbackIcon,
      background: background,
    );
    return ClipRRect(
      borderRadius: borderRadius,
      child: ColoredBox(
        color: background,
        child: src == null || src.isEmpty
            ? placeholder
            : CachedNetworkImage(
                imageUrl: src,
                fit: fit,
                width: double.infinity,
                height: double.infinity,
                fadeInDuration: Motion.normal,
                placeholder: (_, _) => ColoredBox(color: background),
                errorWidget: (_, _, _) => placeholder,
              ),
      ),
    );
  }
}

class _Placeholder extends StatelessWidget {
  final IconData icon;
  final Color background;

  const _Placeholder({required this.icon, required this.background});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, c) {
        final side = c.biggest.shortestSide;
        final finite = side.isFinite;
        // 큰 타일은 쇼핑 앱처럼 흐린 워드마크, 작은 썸네일은 얇은 아이콘.
        final large = finite && side >= 120;
        return ColoredBox(
          color: background,
          child: Center(
            child: large
                ? Text(
                    '가치가차',
                    style: AppText.title2.copyWith(
                      fontSize: (side * 0.085).clamp(13.0, 22.0),
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.6,
                      color: AppColors.inkDisabled.withValues(alpha: 0.7),
                    ),
                  )
                : Icon(
                    icon,
                    size: finite ? (side * 0.34).clamp(14.0, 24.0) : 20,
                    color: AppColors.inkDisabled,
                  ),
          ),
        );
      },
    );
  }
}
