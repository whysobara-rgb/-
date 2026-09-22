import 'package:flutter/material.dart';
import '../../../../shared/widgets/gachi_components.dart';
import '../../domain/capsule_box.dart';

/// Intrinsic text height preserves product names at large accessibility sizes.
class CapsuleBoxCard extends StatelessWidget {
  final CapsuleBox box;
  final VoidCallback onTap;
  const CapsuleBoxCard({super.key, required this.box, required this.onTap});
  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: const BoxDecoration(
      borderRadius: GachiShape.card,
      boxShadow: GachiShape.shadow,
    ),
    child: Material(
      color: GachiColors.surface,
      borderRadius: GachiShape.card,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            CatalogArtwork(box: box),
            Padding(
              padding: const EdgeInsets.all(GachiSpace.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (box.badgeLabel?.isNotEmpty == true) ...[
                    GachiBadge(label: box.badgeLabel!),
                    const SizedBox(height: GachiSpace.sm),
                  ],
                  Text(
                    box.name,
                    style: GachiType.product.copyWith(color: GachiColors.ink),
                  ),
                  const SizedBox(height: GachiSpace.md),
                  Text(
                    '1회 구매',
                    style: GachiType.meta.copyWith(
                      color: GachiColors.secondary,
                    ),
                  ),
                  const SizedBox(height: GachiSpace.xs),
                  Text(
                    box.formattedPrice,
                    style: GachiType.section.copyWith(color: GachiColors.ink),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

class CatalogArtwork extends StatelessWidget {
  final CapsuleBox box;
  const CatalogArtwork({super.key, required this.box});
  @override
  Widget build(BuildContext context) =>
      GachiProductImage(url: box.imageUrl, label: box.name);
}
