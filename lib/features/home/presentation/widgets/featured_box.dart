import 'package:flutter/material.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/utils/format.dart';
import '../../../../shared/widgets/product_image.dart';
import '../../../gacha/domain/gacha_models.dart';

/// 홈 최상단 대표 박스. 큰 사진 + 아래 텍스트(사진 위에 글씨를 얹지 않는다).
class FeaturedBox extends StatelessWidget {
  final GachaSummary box;
  final VoidCallback onTap;

  const FeaturedBox({super.key, required this.box, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final meta = [
      '1회 ${formatGp(box.price)}',
      if (box.pityThreshold != null) '천장 ${formatNumber(box.pityThreshold!)}회',
    ].join(' · ');

    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          Space.gutter,
          Space.x2,
          Space.gutter,
          Space.x6,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            AspectRatio(
              aspectRatio: 4 / 3,
              child: ProductImage(url: box.imageUrl, borderRadius: Radii.card),
            ),
            const SizedBox(height: Space.x4),
            Text('이번 주 추천', style: AppText.caption),
            const SizedBox(height: 2),
            Text(box.title, style: AppText.title1),
            if (box.description.isNotEmpty) ...[
              const SizedBox(height: Space.x1),
              Text(
                keepAll(box.description),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: AppText.callout,
              ),
            ],
            const SizedBox(height: Space.x2),
            Text(meta, style: AppText.num(AppText.bodyStrong)),
          ],
        ),
      ),
    );
  }
}
