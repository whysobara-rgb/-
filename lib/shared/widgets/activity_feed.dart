import 'package:flutter/material.dart';
import '../../core/network/api_client.dart';
import '../../core/design/gachi_tokens.dart';
import '../data/activity_page.dart';

/// Shared paginated activity UI. A changed filter must supply a new key.
class ActivityFeed<T> extends StatefulWidget {
  final Future<ActivityPage<T>> Function(int page) loadPage;
  final String Function(T) id;
  final Widget Function(T) itemBuilder;
  final Widget header;
  final String emptyTitle, emptyDescription;
  final IconData emptyIcon;
  const ActivityFeed({
    super.key,
    required this.loadPage,
    required this.id,
    required this.itemBuilder,
    required this.header,
    required this.emptyTitle,
    required this.emptyDescription,
    required this.emptyIcon,
  });
  @override
  State<ActivityFeed<T>> createState() => _ActivityFeedState<T>();
}

class _ActivityFeedState<T> extends State<ActivityFeed<T>> {
  final _items = <T>[];
  int _page = 0, _total = 0, _generation = 0;
  bool _loading = false, _hasMore = true;
  String? _error;
  @override
  void initState() {
    super.initState();
    _load(reset: true);
  }

  Future<void> _load({bool reset = false}) async {
    if (_loading && !reset) return;
    final generation = ++_generation;
    setState(() {
      _loading = true;
      _error = null;
      if (reset) {
        _page = 0;
        _items.clear();
        _hasMore = true;
      }
    });
    final nextPage = _page + 1;
    try {
      final result = await widget.loadPage(nextPage);
      if (!mounted || generation != _generation) return;
      // Offset pages can shift when another device creates activity. Never
      // silently deduplicate and present that partial list as complete.
      final knownIds = _items.map(widget.id).toSet();
      if (result.page != nextPage ||
          (!reset && result.total != _total) ||
          result.items.any((item) => knownIds.contains(widget.id(item)))) {
        invalidActivity();
      }
      setState(() {
        _items.addAll(result.items);
        _page = result.page;
        _total = result.total;
        _hasMore = result.hasMore;
      });
    } catch (e) {
      if (mounted && generation == _generation) {
        setState(
          () => _error = e is ApiException
              ? e.message
              : '내역을 불러오지 못했어요. 다시 시도해주세요.',
        );
      }
    } finally {
      if (mounted && generation == _generation) {
        setState(() => _loading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) => RefreshIndicator(
    onRefresh: () => _load(reset: true),
    child: CustomScrollView(
      physics: const AlwaysScrollableScrollPhysics(),
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
          sliver: SliverToBoxAdapter(child: widget.header),
        ),
        if (_page > 0)
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
            sliver: SliverToBoxAdapter(
              child: Text(
                '${_items.length} / $_total건',
                style: const TextStyle(color: GachiColors.secondary),
              ),
            ),
          ),
        SliverPadding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          sliver: SliverList.builder(
            itemCount: _items.length,
            itemBuilder: (_, index) => widget.itemBuilder(_items[index]),
          ),
        ),
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
          sliver: SliverToBoxAdapter(
            child: Column(
              children: [
                if (_loading)
                  const Padding(
                    padding: EdgeInsets.all(24),
                    child: CircularProgressIndicator(),
                  )
                else if (_error != null) ...[
                  const Icon(
                    Icons.cloud_off_rounded,
                    size: 32,
                    color: GachiColors.secondary,
                  ),
                  const SizedBox(height: 12),
                  Text(_error!, textAlign: TextAlign.center),
                  const SizedBox(height: 8),
                  OutlinedButton(
                    onPressed: () => _load(),
                    child: const Text('다시 시도'),
                  ),
                  if (_items.isNotEmpty)
                    TextButton(
                      onPressed: () => _load(reset: true),
                      child: const Text('처음부터 새로고침'),
                    ),
                ] else if (_items.isEmpty) ...[
                  const SizedBox(height: 36),
                  Icon(
                    widget.emptyIcon,
                    size: 56,
                    color: GachiColors.navy,
                  ),
                  const SizedBox(height: 20),
                  Text(
                    widget.emptyTitle,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    widget.emptyDescription,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: GachiColors.secondary,
                      height: 1.6,
                    ),
                  ),
                ] else if (_hasMore)
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: () => _load(),
                      icon: const Icon(Icons.expand_more),
                      label: const Text('이전 내역 더 보기'),
                    ),
                  )
                else
                  const Text(
                    '모든 내역을 확인했어요',
                    style: TextStyle(color: GachiColors.secondary),
                  ),
              ],
            ),
          ),
        ),
      ],
    ),
  );
}
