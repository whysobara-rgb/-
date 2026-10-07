import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/utils/format.dart';
import '../../../../shared/widgets/product_image.dart';
import '../../../../shared/widgets/rarity_tag.dart';
import '../../../gacha/domain/gacha_models.dart';

/// 홈 그리드의 박스 카드. 그림자 없이 사진·이름·가격만.
class BoxCard extends StatelessWidget {
  final GachaSummary box;
  final VoidCallback onTap;

  const BoxCard({super.key, required this.box, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: Radii.thumb,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AspectRatio(
            aspectRatio: 1,
            child: Stack(
              fit: StackFit.expand,
              children: [
                ProductImage(url: box.imageUrl),
                if (box.badgeLabel != null)
                  Positioned(
                    left: 8,
                    top: 8,
                    child: QuietLabel(badgeLabelText(box.badgeLabel!)),
                  ),
              ],
            ),
          ),
          const SizedBox(height: Space.x2 + 2),
          Text(
            box.title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppText.body.copyWith(height: 1.35),
          ),
          const SizedBox(height: 2),
          Text(
            formatGp(box.price),
            style: AppText.num(
              AppText.headline,
            ).copyWith(fontWeight: FontWeight.w700),
          ),
          if (box.pityThreshold != null) ...[
            const SizedBox(height: 2),
            Text(
              '천장 ${formatNumber(box.pityThreshold!)}회',
              style: AppText.num(
                AppText.caption,
              ).copyWith(color: AppColors.inkTertiary),
            ),
          ],
        ],
      ),
    );
  }
}
