import 'package:flutter/material.dart';
import '../../../core/constants/rank_colors.dart';
import '../domain/inventory_item.dart';
import 'collection_detail_page.dart';

class CollectionCard extends StatelessWidget {
  final InventoryItem item;
  final bool selected;
  final VoidCallback onSelect, onLock;
  const CollectionCard({super.key, required this.item,
    required this.selected, required this.onSelect, required this.onLock});

  @override
  Widget build(BuildContext context) {
    final accent = RankColors.of(item.grade);
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: selected ? Theme.of(context).colorScheme.primary
              : const Color(0xFFE4E1EA),
          width: selected ? 2 : 1)),
      clipBehavior: Clip.antiAlias,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Container(
          height: 160, width: double.infinity,
          decoration: BoxDecoration(gradient: LinearGradient(
            begin: Alignment.topLeft, end: Alignment.bottomRight,
            colors: [accent.withValues(alpha: 0.28), const Color(0xFFF1EEF7)])),
          child: Stack(children: [
            Positioned.fill(child: Padding(
              padding: const EdgeInsets.all(28),
              child: item.imageUrl == null || item.imageUrl!.isEmpty
                ? Icon(item.icon, size: 64, color: const Color(0xFF554074))
                : Image.network(item.imageUrl!, fit: BoxFit.contain,
                    errorBuilder: (_, error, stack) =>
                        Icon(item.icon, size: 64, color: const Color(0xFF554074))))),
            Positioned(left: 8, top: 8, child: Chip(
              label: Text(item.grade),
              backgroundColor: accent)),
            Positioned(right: 0, top: 0, child: Checkbox(
              value: selected,
              onChanged: item.canShip ? (_) => onSelect() : null)),
          ]),
        ),
        TextButton.icon(
          onPressed: () => Navigator.of(context).push(MaterialPageRoute(
            builder: (_) => CollectionDetailPage(item: item))),
          icon: const Icon(Icons.zoom_in_rounded),
          label: const Text('크게 보기')),
        Padding(padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(item.name, style: const TextStyle(
              fontSize: 16, fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            Text('추정 가치 ${item.formattedPrice}',
              style: const TextStyle(fontSize: 12)),
            const SizedBox(height: 8),
            Row(children: [
              Expanded(child: Text(item.status.label)),
              IconButton(
                tooltip: item.isLocked ? '전환 잠금 해제' : '전환 잠금',
                onPressed: item.canShip ? onLock : null,
                icon: Icon(item.isLocked ? Icons.lock_rounded
                    : Icons.lock_open_rounded)),
            ]),
          ])),
      ]),
    );
  }
}
