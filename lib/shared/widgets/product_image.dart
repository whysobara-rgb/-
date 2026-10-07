import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import '../../core/domain/product_category.dart';
import '../../core/domain/rarity.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import 'vault_art.dart';

/// 상품 사진.
///
/// 사진이 없거나 로드에 실패하면 깨진 이미지 대신 [VaultEmblem]
/// (레어도 색 빛 + 기요셰 각인 + 분류 엠블럼)을 그린다. 분류는 [name]에서
/// 추정하고, 못 맞추면 [category]를 쓴다.
class ProductImage extends StatelessWidget {
  final String? url;
  final BorderRadius borderRadius;
  final BoxFit fit;

  /// 플레이스홀더 엠블럼 색을 정하는 레어도(없으면 스틸).
  final Rarity? rarity;

  /// 분류 추정용 상품명.
  final String? name;

  /// 상품명으로 분류를 못 맞출 때(또는 이름이 없을 때) 쓸 분류.
  final ProductCategory category;

  const ProductImage({
    super.key,
    required this.url,
    this.borderRadius = Radii.thumb,
    this.fit = BoxFit.cover,
    this.rarity,
    this.name,
    this.category = ProductCategory.jewel,
  });

  @override
  Widget build(BuildContext context) {
    final src = url;
    final resolved = name == null
        ? category
        : ProductCategory.fromName(name!, fallback: category);
    final placeholder = VaultEmblem(category: resolved, rarity: rarity);
    return ClipRRect(
      borderRadius: borderRadius,
      child: ColoredBox(
        color: AppColors.surface,
        child: src == null || src.isEmpty
            ? placeholder
            : CachedNetworkImage(
                imageUrl: src,
                fit: fit,
                width: double.infinity,
                height: double.infinity,
                fadeInDuration: Motion.normal,
                placeholder: (_, _) =>
                    const ColoredBox(color: AppColors.surface),
                errorWidget: (_, _, _) => placeholder,
              ),
      ),
    );
  }
}

/// 박스 대표 이미지. 사진이 없거나 실패하면 박스 색으로 빛나는 [BoxArt].
class BoxImage extends StatelessWidget {
  final String? url;
  final Color tone;
  final ProductCategory category;
  final BorderRadius borderRadius;
  final double artScale;
  final double artCenterY;

  const BoxImage({
    super.key,
    required this.url,
    required this.tone,
    required this.category,
    this.borderRadius = Radii.card,
    this.artScale = 0.36,
    this.artCenterY = 0.52,
  });

  @override
  Widget build(BuildContext context) {
    final art = BoxArt(
      tone: tone,
      category: category,
      scale: artScale,
      centerY: artCenterY,
    );
    final src = url;
    return ClipRRect(
      borderRadius: borderRadius,
      child: src == null || src.isEmpty
          ? art
          : CachedNetworkImage(
              imageUrl: src,
              fit: BoxFit.cover,
              width: double.infinity,
              height: double.infinity,
              fadeInDuration: Motion.normal,
              placeholder: (_, _) => art,
              errorWidget: (_, _, _) => art,
            ),
    );
  }
}
