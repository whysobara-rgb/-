import 'package:flutter/material.dart';
import '../domain/inventory_item.dart';

class CollectionDetailPage extends StatefulWidget {
  final InventoryItem item;
  const CollectionDetailPage({super.key, required this.item});

  @override
  State<CollectionDetailPage> createState() => _CollectionDetailPageState();
}

class _CollectionDetailPageState extends State<CollectionDetailPage> {
  final _transform = TransformationController();
  InventoryItem get item => widget.item;

  @override
  void dispose() {
    _transform.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('컬렉션 상세')),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        Container(
          height: 340,
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(28),
            gradient: const LinearGradient(
              colors: [Color(0xFF29203E), Color(0xFF101018)])),
          child: InteractiveViewer(
            transformationController: _transform,
            minScale: 1, maxScale: 3,
            child: Center(child: item.imageUrl == null || item.imageUrl!.isEmpty
              ? Icon(item.icon, size: 120, color: const Color(0xFFB9A4FF))
              : Image.network(item.imageUrl!, fit: BoxFit.contain,
                  errorBuilder: (_, error, stack) => Icon(
                    item.icon, size: 120, color: const Color(0xFFB9A4FF))))),
        ),
        const SizedBox(height: 12),
        Wrap(alignment: WrapAlignment.center, spacing: 8, children: [
          OutlinedButton.icon(
            onPressed: () => _transform.value = Matrix4.diagonal3Values(2, 2, 1),
            icon: const Icon(Icons.zoom_in), label: const Text('2배 확대')),
          TextButton.icon(
            onPressed: () => _transform.value = Matrix4.identity(),
            icon: const Icon(Icons.restart_alt), label: const Text('원래 크기')),
        ]),
        const Text('두 손가락으로 확대하거나 이미지를 움직일 수 있어요',
          textAlign: TextAlign.center),
        const SizedBox(height: 24),
        Text(item.name, style: const TextStyle(
          fontSize: 26, fontWeight: FontWeight.w800)),
        const SizedBox(height: 16),
        Wrap(spacing: 8, runSpacing: 8, children: [
          Chip(label: Text('등급 ${item.grade}')),
          Chip(label: Text(item.status.label)),
          if (item.isLocked) const Chip(label: Text('전환 잠금')),
        ]),
        const SizedBox(height: 16),
        ListTile(contentPadding: EdgeInsets.zero,
          title: const Text('추정 가치'), subtitle: Text(item.formattedPrice)),
        ListTile(contentPadding: EdgeInsets.zero,
          title: const Text('획득일'),
          subtitle: Text(item.acquiredAt.toLocal().toIso8601String().split('T').first)),
        const SizedBox(height: 16),
        const Text('잠금과 배송할 상품 선택은 컬렉션 목록에서 관리할 수 있어요.'),
      ]),
    );
  }
}
