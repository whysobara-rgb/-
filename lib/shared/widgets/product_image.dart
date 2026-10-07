import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import '../../core/domain/product_category.dart';
import '../../core/domain/rarity.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import 'pack_art.dart';
import 'product_art.dart';

/// 상품 사진 칸.
///
/// 커머스 앱의 상품 사진처럼 밝은 우물(well) 위에 사진을 [fit]으로 앉힌다
/// (기본 contain + 여백: 흰 배경 상품 사진이 잘리지 않고 떠 보이게).
/// 사진이 없거나 실패하면 [ProductArt](분류별 상품 일러스트, 상품권은
/// 사용처·금액을 읽은 카드)를 그린다. 분류는 [name]에서 추정하고,
/// 못 맞추면 [category]를 쓴다.
class ProductImage extends StatelessWidget {
  final String? url;
  final BorderRadius borderRadius;
  final BoxFit fit;

  /// 일러스트 포인트 색과 우물 색을 정하는 레어도(없으면 N).
  final Rarity? rarity;

  /// 분류 추정·상품권 문구용 상품명.
  final String? name;

  /// 상품명으로 분류를 못 맞출 때(또는 이름이 없을 때) 쓸 분류.
  final ProductCategory category;

  const ProductImage({
    super.key,
    required this.url,
    this.borderRadius = Radii.thumb,
    this.fit = BoxFit.contain,
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
    final art = ProductArt(
      category: resolved,
      rarity: rarity ?? Rarity.n,
      name: name,
    );
    return ClipRRect(
      borderRadius: borderRadius,
      child: src == null || src.isEmpty
          ? art
          : ColoredBox(
              color: AppColors.well,
              child: LayoutBuilder(
                builder: (context, c) => Padding(
                  // contain일 때만 사진 둘레에 숨 쉴 여백을 둔다.
                  padding: EdgeInsets.all(
                    fit == BoxFit.contain ? c.biggest.shortestSide * 0.06 : 0,
                  ),
                  child: CachedNetworkImage(
                    imageUrl: src,
                    fit: fit,
                    width: double.infinity,
                    height: double.infinity,
                    fadeInDuration: Motion.normal,
                    placeholder: (_, _) =>
                        const ColoredBox(color: AppColors.well),
                    errorWidget: (_, _, _) => art,
                  ),
                ),
              ),
            ),
    );
  }
}

/// 박스 대표 이미지. 사진이 없거나 실패하면 박스 고유 패키지([PackScene]).
class BoxImage extends StatelessWidget {
  final String? url;
  final Color tone;
  final ProductCategory category;
  final BorderRadius borderRadius;

  /// 패키지 정면 폭(짧은 변 대비). 2차 값(0.34~0.6)도 그대로 받는다.
  final double artScale;
  final double artCenterY;

  /// 패키지 워드마크용 배지(OPEN 기념 등).
  final String? badge;

  /// 패키지 뒤 선버스트.
  final bool rays;

  const BoxImage({
    super.key,
    required this.url,
    required this.tone,
    required this.category,
    this.borderRadius = Radii.card,
    this.artScale = 0.36,
    this.artCenterY = 0.52,
    this.badge,
    this.rays = false,
  });

  @override
  Widget build(BuildContext context) {
    final art = PackScene(
      style: PackStyle.of(category: category, accent: tone, badge: badge),
      scale: packScaleFor(artScale),
      centerY: artCenterY,
      rays: rays,
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

/// 2차 금고 상자 크기(꼭짓점 반경 기준)를 패키지 정면 폭으로 옮긴다.
double packScaleFor(double legacyScale) =>
    (legacyScale * 1.55).clamp(0.3, 0.92);
