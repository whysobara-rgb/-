import 'package:flutter/material.dart';
import '../../../shared/widgets/gachi_components.dart';
import '../../home/domain/capsule_box.dart';
import '../../home/domain/gacha_detail.dart';
import '../../orders/order_models.dart';

/// Presentation only. Quantities, validation and purchase remain in GachaDetailPage.
class ProductDetailView extends StatelessWidget {
  final CapsuleBox box;
  final GachaDetail detail;
  final Odds? odds;
  final int quantity, maxQuantity;
  final String totalPriceLabel;
  final VoidCallback onDecrement, onIncrement, onPurchase;
  const ProductDetailView({
    super.key,
    required this.box,
    required this.detail,
    required this.odds,
    required this.quantity,
    required this.maxQuantity,
    required this.totalPriceLabel,
    required this.onDecrement,
    required this.onIncrement,
    required this.onPurchase,
  });

  @override
  Widget build(BuildContext context) {
    final remaining = (detail.totalStock - detail.soldStock).clamp(
      0,
      detail.totalStock < 0 ? 0 : detail.totalStock,
    );
    final soldOut = remaining == 0;
    final dock = _PurchaseDock(
      quantity: quantity,
      maxQuantity: maxQuantity,
      soldOut: soldOut,
      totalPriceLabel: totalPriceLabel,
      onDecrement: onDecrement,
      onIncrement: onIncrement,
      onPurchase: onPurchase,
    );
    return GachiTheme(
      child: ColoredBox(
        color: GachiColors.ivory,
        child: LayoutBuilder(
          builder: (context, constraints) {
            final scrollDock =
                constraints.maxHeight < 520 ||
                MediaQuery.textScalerOf(context).scale(15) > 21;
            final content = ListView(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
              children: [
                GachiProductImage(
                  url: detail.imageUrl ?? box.imageUrl,
                  label: detail.title,
                  aspectRatio: 1.35,
                ),
                const SizedBox(height: GachiSpace.xl),
                Wrap(
                  spacing: GachiSpace.sm,
                  runSpacing: GachiSpace.sm,
                  children: [
                    const GachiBadge(label: 'GP BOX'),
                    if (detail.badgeLabel?.isNotEmpty == true)
                      GachiBadge(label: detail.badgeLabel!),
                    if (soldOut) const GachiBadge(label: '품절'),
                  ],
                ),
                const SizedBox(height: GachiSpace.md),
                Semantics(
                  header: true,
                  child: Text(detail.title, style: GachiType.pageTitle),
                ),
                const SizedBox(height: GachiSpace.md),
                Wrap(
                  crossAxisAlignment: WrapCrossAlignment.center,
                  spacing: GachiSpace.sm,
                  children: [
                    Text(detail.formattedPrice, style: GachiType.display),
                    Text(
                      '/ 1회',
                      style: GachiType.meta.copyWith(
                        color: GachiColors.secondary,
                      ),
                    ),
                  ],
                ),
                if (detail.description.isNotEmpty) ...[
                  const SizedBox(height: GachiSpace.md),
                  Text(
                    detail.description,
                    style: GachiType.body.copyWith(
                      color: GachiColors.secondary,
                    ),
                  ),
                ],
                const SizedBox(height: GachiSpace.xl),
                GachiInfoCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Wrap(
                        spacing: GachiSpace.sm,
                        children: [
                          Text(
                            '남은 수량',
                            style: GachiType.meta.copyWith(
                              color: GachiColors.secondary,
                            ),
                          ),
                          Text('$remaining개', style: GachiType.product),
                        ],
                      ),
                      const SizedBox(height: GachiSpace.md),
                      ClipRRect(
                        borderRadius: GachiShape.small,
                        child: LinearProgressIndicator(
                          value: detail.totalStock > 0
                              ? remaining / detail.totalStock
                              : 0,
                          minHeight: 6,
                          color: GachiColors.navy,
                          backgroundColor: GachiColors.divider,
                          semanticsLabel: '남은 수량',
                          semanticsValue: '$remaining개',
                        ),
                      ),
                      const SizedBox(height: GachiSpace.sm),
                      Text(
                        '전체 ${detail.totalStock}개 중 ${detail.soldStock}개 판매',
                        style: GachiType.meta.copyWith(
                          color: GachiColors.secondary,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: GachiSpace.section),
                const GachiSectionHeader(title: '어떤 상품을 만날까요?'),
                const SizedBox(height: GachiSpace.sm),
                Text(
                  '구성 상품과 공개 확률을 확인하세요.',
                  style: GachiType.meta.copyWith(color: GachiColors.secondary),
                ),
                const SizedBox(height: GachiSpace.lg),
                if (odds == null)
                  const GachiInfoCard(
                    child: Text(
                      '공개 확률을 불러오지 못했어요. 구매 전 확인 단계에서 다시 확인해주세요.',
                      style: GachiType.body,
                    ),
                  )
                else
                  ...odds!.prizes.map(
                    (prize) => Padding(
                      padding: const EdgeInsets.only(bottom: GachiSpace.md),
                      child: GachiInfoCard(
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            SizedBox(
                              width: 56,
                              child: GachiProductImage(
                                url: prize.imageUrl,
                                label: prize.name,
                                compact: true,
                                aspectRatio: 1,
                              ),
                            ),
                            const SizedBox(width: GachiSpace.md),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(prize.name, style: GachiType.product),
                                  const SizedBox(height: GachiSpace.xs),
                                  Text(
                                    '${prize.displayGrade} · ${prize.premium ? '프리미엄' : '일반'}',
                                    style: GachiType.meta.copyWith(
                                      color: GachiColors.secondary,
                                    ),
                                  ),
                                  const SizedBox(height: GachiSpace.sm),
                                  Text(
                                    prize.probability,
                                    style: GachiType.section,
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                const SizedBox(height: GachiSpace.lg),
                Text(
                  '구매 후 미개봉 캡슐이 보관됩니다. 개봉 시 상품이 결정되며, 개봉에는 GP가 추가로 차감되지 않습니다.',
                  style: GachiType.meta.copyWith(color: GachiColors.secondary),
                ),
                if (scrollDock) ...[
                  const SizedBox(height: GachiSpace.xl),
                  dock,
                ],
              ],
            );
            return scrollDock
                ? content
                : Column(
                    children: [
                      Expanded(child: content),
                      dock,
                    ],
                  );
          },
        ),
      ),
    );
  }
}

class _PurchaseDock extends StatelessWidget {
  final int quantity, maxQuantity;
  final bool soldOut;
  final String totalPriceLabel;
  final VoidCallback onDecrement, onIncrement, onPurchase;
  const _PurchaseDock({
    required this.quantity,
    required this.maxQuantity,
    required this.soldOut,
    required this.totalPriceLabel,
    required this.onDecrement,
    required this.onIncrement,
    required this.onPurchase,
  });
  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: const BoxDecoration(
      color: GachiColors.surface,
      border: Border(top: BorderSide(color: GachiColors.divider)),
    ),
    child: SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Wrap(
              alignment: WrapAlignment.spaceBetween,
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: GachiSpace.md,
              children: [
                const Text('구매 수량', style: GachiType.product),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    IconButton(
                      tooltip: '수량 줄이기',
                      onPressed: quantity > 1 && !soldOut ? onDecrement : null,
                      icon: const Icon(Icons.remove_rounded),
                    ),
                    Semantics(
                      liveRegion: true,
                      label: '구매 수량 $quantity개',
                      excludeSemantics: true,
                      child: Text('$quantity', style: GachiType.section),
                    ),
                    IconButton(
                      tooltip: '수량 늘리기',
                      onPressed: quantity < maxQuantity && !soldOut
                          ? onIncrement
                          : null,
                      icon: const Icon(Icons.add_rounded),
                    ),
                  ],
                ),
              ],
            ),
            const SizedBox(height: GachiSpace.sm),
            SizedBox(
              width: double.infinity,
              child: GachiPrimaryButton(
                label: soldOut ? '품절된 박스예요' : '$totalPriceLabel · 구매 전 확인',
                onPressed: soldOut ? null : onPurchase,
              ),
            ),
          ],
        ),
      ),
    ),
  );
}
