import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../shared/widgets/ui.dart';
import '../data/wallet_repository.dart';
import '../domain/point_history.dart';
import 'widgets/history_row.dart';

/// GP 내역 전체.
class PointHistoryPage extends StatefulWidget {
  const PointHistoryPage({super.key});

  @override
  State<PointHistoryPage> createState() => _PointHistoryPageState();
}

class _PointHistoryPageState extends State<PointHistoryPage> {
  static const _repository = WalletRepository();

  PointHistoryType? _filter;
  List<PointHistoryEntry> _items = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final items = await _repository.history(type: _filter);
      if (!mounted) return;
      setState(() {
        _items = items;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.displayMessage;
        _loading = false;
      });
    }
  }

  void _select(PointHistoryType? type) {
    if (_filter == type) return;
    _filter = type;
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final filters = <(String, PointHistoryType?)>[
      ('전체', null),
      ('적립', PointHistoryType.earn),
      ('사용', PointHistoryType.use),
      ('소멸', PointHistoryType.expire),
    ];
    return Scaffold(
      appBar: AppBar(titleSpacing: 0, title: const Text('GP 내역')),
      body: Column(
        children: [
          Container(
            height: 44,
            decoration: const BoxDecoration(
              border: Border(bottom: BorderSide(color: AppColors.line)),
            ),
            padding: Space.page,
            child: Row(
              children: [
                for (final f in filters)
                  _Tab(
                    label: f.$1,
                    selected: _filter == f.$2,
                    onTap: () => _select(f.$2),
                  ),
              ],
            ),
          ),
          Expanded(
            child: _loading
                ? const LoadingView()
                : _error != null
                ? ErrorView(message: _error!, onRetry: _load)
                : _items.isEmpty
                ? const EmptyView(
                    icon: Icons.receipt_long_outlined,
                    title: '내역이 없어요',
                  )
                : RefreshIndicator(
                    color: AppColors.ink,
                    onRefresh: _load,
                    child: ListView.separated(
                      itemCount: _items.length,
                      separatorBuilder: (_, _) =>
                          const Hairline(inset: Space.gutter),
                      itemBuilder: (_, i) => HistoryRow(entry: _items[i]),
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

class _Tab extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  const _Tab({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(
              color: selected ? AppColors.ink : Colors.transparent,
              width: 2,
            ),
          ),
        ),
        child: Text(
          label,
          style: AppText.bodyStrong.copyWith(
            color: selected ? AppColors.ink : AppColors.inkTertiary,
          ),
        ),
      ),
    );
  }
}
