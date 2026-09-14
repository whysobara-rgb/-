import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../domain/capsule_box.dart';
import '../../../orders/capsule_shell.dart';

/// A product card with intrinsic text height, also used in the catalog preview.
class CapsuleBoxCard extends StatelessWidget {
  final CapsuleBox box;
  final VoidCallback onTap;
  const CapsuleBoxCard({super.key, required this.box, required this.onTap});

  @override
  Widget build(BuildContext context) => Material(
    color: AppColors.surfaceElevated,
    borderRadius: BorderRadius.circular(22),
    clipBehavior: Clip.antiAlias,
    child: InkWell(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AspectRatio(
            aspectRatio: 1.12,
            child: Stack(
              fit: StackFit.expand,
              children: [
                CatalogArtwork(box: box),
                if (box.badgeLabel?.isNotEmpty == true)
                  Positioned(
                    top: 12,
                    left: 12,
                    child: Container(
                      constraints: const BoxConstraints(maxWidth: 110),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 9,
                        vertical: 5,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        box.badgeLabel!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w800,
                          color: AppColors.textPrimary,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  box.name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    height: 1.35,
                  ),
                ),
                const SizedBox(height: 12),
                const Text(
                  '1회 구매',
                  style: TextStyle(
                    fontSize: 11,
                    color: AppColors.textSecondary,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  box.formattedPrice,
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.5,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
}

/// Missing catalog images use branded capsule artwork. Product photos remain server supplied.
class CatalogArtwork extends StatelessWidget {
  final CapsuleBox box;
  const CatalogArtwork({super.key, required this.box});
  @override
  Widget build(BuildContext context) {
    Widget fallback() => DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            box.accentColor.withValues(alpha: .08),
            box.accentColor.withValues(alpha: .22),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) => Center(
          child: Transform.rotate(
            angle: -.18,
            child: CustomPaint(
              size: Size(constraints.maxWidth, constraints.maxHeight),
              painter: CapsuleShellPainter(opening: 0, accent: box.accentColor),
            ),
          ),
        ),
      ),
    );
    if (box.imageUrl?.isNotEmpty != true) return fallback();
    return ColoredBox(
      color: AppColors.surfaceElevated2,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: CachedNetworkImage(
          imageUrl: box.imageUrl!,
          fit: BoxFit.contain,
          placeholder: (_, url) => fallback(),
          errorWidget: (_, url, error) => fallback(),
        ),
      ),
    );
  }
}
