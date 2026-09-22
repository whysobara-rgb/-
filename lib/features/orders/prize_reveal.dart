import 'package:flutter/material.dart';
import '../../shared/widgets/gachi_components.dart';
import '../../shared/widgets/gachi_opening.dart';
import 'order_models.dart';

/// Receives only a confirmed prize. Motion is owned by the surrounding view.
class PrizeReveal extends StatelessWidget {
  final Prize prize;
  final int quantity;
  final bool animate;
  const PrizeReveal({
    super.key,
    required this.prize,
    this.quantity = 1,
    this.animate = true,
  });
  @override
  Widget build(BuildContext context) => animate
      ? GachiOpeningExperience(waiting: false, result: _card(context))
      : _card(context);

  Widget _card(BuildContext context) => Container(
    padding: const EdgeInsets.all(GachiSpace.lg),
    margin: const EdgeInsets.symmetric(vertical: GachiSpace.sm),
    decoration: BoxDecoration(
      color: GachiOpeningColors.panel,
      borderRadius: GachiShape.card,
      border: Border.all(color: GachiOpeningColors.border),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        GachiProductImage(
          url: prize.imageUrl,
          placeholderIcon: Icons.card_giftcard_rounded,
          imageProvider: prize.imageUrl == null || prize.imageUrl!.isEmpty
              ? null
              : NetworkImage(prize.imageUrl!),
          label: prize.name,
          aspectRatio: prize.imageUrl == null || prize.imageUrl!.isEmpty
              ? 2.1
              : 1.45,
        ),
        const SizedBox(height: GachiSpace.lg),
        Text(
          prize.name,
          style: GachiType.section.copyWith(color: GachiColors.ivory),
        ),
        const SizedBox(height: GachiSpace.sm),
        Wrap(
          spacing: GachiSpace.sm,
          runSpacing: GachiSpace.sm,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: const BoxDecoration(
                color: GachiOpeningColors.grade,
                borderRadius: GachiShape.small,
              ),
              child: Text(
                prize.displayGrade,
                style: GachiType.meta.copyWith(color: GachiColors.gold),
              ),
            ),
            Text(
              '× $quantity',
              style: GachiType.product.copyWith(color: GachiColors.ivory),
            ),
            Text(
              '내 보관함에 저장 완료',
              style: GachiType.meta.copyWith(
                color: GachiOpeningColors.secondary,
              ),
            ),
          ],
        ),
        const SizedBox(height: GachiSpace.sm),
        Text(
          '전환 시 ${prize.conversionGP.toString().replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+(?!\d))'), (m) => '${m[1]},')} GP',
          style: GachiType.meta.copyWith(color: GachiOpeningColors.secondary),
        ),
      ],
    ),
  );
}
