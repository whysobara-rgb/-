import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';

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
    this.fallbackIcon = Icons.inventory_2_outlined,
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
        final size = side.isFinite ? (side * 0.28).clamp(16.0, 48.0) : 24.0;
        return ColoredBox(
          color: background,
          child: Center(
            child: Icon(icon, size: size, color: AppColors.inkDisabled),
          ),
        );
      },
    );
  }
}
