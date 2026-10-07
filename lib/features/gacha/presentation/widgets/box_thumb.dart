import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../shared/widgets/pack_art.dart';
import '../../../../shared/widgets/product_image.dart';
import '../../domain/gacha_models.dart';

/// 박스 요약에서 패키지 디자인을 고른다(분류·박스 색·배지).
extension BoxPack on GachaSummary {
  PackStyle get pack =>
      PackStyle.of(category: category, accent: accent, badge: badgeLabel);
}

/// 박스 대표 그림: 사진이 있으면 사진, 없으면 박스 고유 패키지.
class BoxThumb extends StatelessWidget {
  final GachaSummary box;

  /// 패키지 정면 폭(짧은 변 대비).
  final double scale;
  final double centerY;
  final BorderRadius borderRadius;
  final bool rays;

  const BoxThumb({
    super.key,
    required this.box,
    this.scale = 0.56,
    this.centerY = 0.54,
    this.borderRadius = BorderRadius.zero,
    this.rays = false,
  });

  @override
  Widget build(BuildContext context) {
    return BoxImage(
      url: box.imageUrl,
      tone: box.accent ?? AppColors.brand,
      category: box.category,
      badge: box.badgeLabel,
      borderRadius: borderRadius,
      artScale: scale / 1.55,
      artCenterY: centerY,
      rays: rays,
    );
  }
}
