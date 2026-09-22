import 'package:flutter/material.dart';
import '../../../core/config/app_config.dart';
import '../../../shared/widgets/gachi_components.dart';
import '../domain/inventory_item.dart';
import 'collection_detail_page.dart';

class CollectionCard extends StatelessWidget {
  final InventoryItem item;
  final bool selected;
  final VoidCallback onSelect, onLock;
  const CollectionCard({
    super.key,
    required this.item,
    required this.selected,
    required this.onSelect,
    required this.onLock,
  });

  @override
  Widget build(BuildContext context) => GachiTheme(
    child: Container(
      padding: const EdgeInsets.symmetric(vertical: GachiSpace.lg),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: GachiColors.divider)),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final stacked =
              constraints.maxWidth < 280 ||
              MediaQuery.textScalerOf(context).scale(15) > 21;
          final photo = SizedBox(
            width: stacked ? 136 : 88,
            child: GachiProductImage(
              url: item.imageUrl,
              imageProvider: item.imageUrl == null || item.imageUrl!.isEmpty
                  ? null
                  : NetworkImage(item.imageUrl!),
              label: item.name,
              aspectRatio: .88,
              compact: true,
            ),
          );
          final copy = Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(item.name, style: GachiType.product),
              const SizedBox(height: GachiSpace.sm),
              Wrap(
                spacing: GachiSpace.sm,
                runSpacing: GachiSpace.sm,
                children: [
                  GachiBadge(label: item.grade),
                  GachiBadge(label: item.status.label),
                ],
              ),
              const SizedBox(height: GachiSpace.sm),
              Text(
                '획득 ${item.acquiredAt.toLocal().toIso8601String().split('T').first}',
                style: GachiType.meta.copyWith(color: GachiColors.muted),
              ),
              Text('추정 가치 ${item.formattedPrice}', style: GachiType.meta),
              if (item.canShip)
                Text(
                  AppConfig.shippingPreviewEnabled ? '배송 신청 가능' : '배송 서비스 준비 중',
                  style: GachiType.meta,
                ),
              if (item.canConvert)
                Text(
                  AppConfig.conversionPreviewEnabled
                      ? 'GP 전환 확인 가능'
                      : 'GP 전환 서비스 준비 중',
                  style: GachiType.meta,
                ),
              if (item.isLocked) const Text('GP 전환 잠금', style: GachiType.meta),
            ],
          );
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (stacked) ...[
                Align(alignment: Alignment.centerLeft, child: photo),
                const SizedBox(height: GachiSpace.md),
                copy,
              ] else
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    photo,
                    const SizedBox(width: GachiSpace.lg),
                    Expanded(child: copy),
                  ],
                ),
              Wrap(
                crossAxisAlignment: WrapCrossAlignment.center,
                spacing: GachiSpace.sm,
                children: [
                  Semantics(
                    label: '${item.name} 선택',
                    child: Checkbox(
                      value: selected,
                      onChanged: item.canSelect ? (_) => onSelect() : null,
                    ),
                  ),
                  TextButton.icon(
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => CollectionDetailPage(item: item),
                      ),
                    ),
                    icon: const Icon(Icons.zoom_in_rounded),
                    label: const Text('크게 보기'),
                  ),
                  IconButton(
                    tooltip: item.isLocked ? '전환 잠금 해제' : '전환 잠금',
                    onPressed: item.canSelect ? onLock : null,
                    icon: Icon(
                      item.isLocked
                          ? Icons.lock_rounded
                          : Icons.lock_open_rounded,
                    ),
                  ),
                ],
              ),
            ],
          );
        },
      ),
    ),
  );
}
