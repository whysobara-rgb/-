import '../../../shared/widgets/gachi_flow.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../shared/providers/gp_provider.dart';
import '../../../shared/widgets/activity_feed.dart';
import '../../../shared/widgets/balance_notice.dart';
import '../domain/point_history.dart';

class PointHistoryPage extends StatefulWidget {
  final PointHistoryRepository repository;
  const PointHistoryPage({
    super.key,
    this.repository = const PointHistoryRepository(),
  });
  @override
  State<PointHistoryPage> createState() => _PointHistoryPageState();
}

class _PointHistoryPageState extends State<PointHistoryPage> {
  PointHistoryType? _filter;
  @override
  Widget build(BuildContext context) {
    final gp = context.watch<GpProvider>();
    return GachiFlowScaffold(
      appBar: AppBar(title: const Text('포인트 내역')),
      body: SafeArea(
        child: ActivityFeed<PointHistoryEntry>(
          key: ValueKey(_filter),
          loadPage: (page) =>
              widget.repository.getPage(page: page, type: _filter),
          id: (entry) => entry.id,
          itemBuilder: (entry) => PointHistoryTile(entry: entry),
          emptyTitle: '아직 ${_filter?.label ?? 'GP'} 내역이 없어요',
          emptyDescription: '상품 전환으로 받은 GP와\n사용한 포인트를 여기서 확인할 수 있어요.',
          emptyIcon: Icons.receipt_long_rounded,
          header: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(24),
                decoration: GachiFlowStyle.hero,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('보유 GP', style: TextStyle(color: Colors.white)),
                    const SizedBox(height: 12),
                    Text(
                      '${gp.formattedBalance} GP',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 28,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
              ),
              const BalanceNotice(),
              const SizedBox(height: 20),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final filter in [null, ...PointHistoryType.values])
                    ChoiceChip(
                      label: Text(filter?.label ?? '전체'),
                      selected: filter == _filter,
                      onSelected: (_) => setState(() => _filter = filter),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class PointHistoryTile extends StatelessWidget {
  final PointHistoryEntry entry;
  const PointHistoryTile({super.key, required this.entry});
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 14),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '${entry.formattedDate} · ${entry.type.label}',
          style: const TextStyle(color: GachiColors.secondary, fontSize: 12),
        ),
        const SizedBox(height: 8),
        Text(
          entry.description,
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 8),
        Align(
          alignment: Alignment.centerRight,
          child: Text(
            entry.formattedAmount,
            style: TextStyle(
              color: switch (entry.type) {
                PointHistoryType.earn => GachiColors.navy,
                PointHistoryType.use => GachiColors.error,
                PointHistoryType.expire => GachiColors.secondary,
              },
              fontSize: 18,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
        const SizedBox(height: 14),
        const Divider(height: 1),
      ],
    ),
  );
}
