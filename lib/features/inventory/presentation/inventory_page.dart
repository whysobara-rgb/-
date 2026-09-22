import 'package:provider/provider.dart';
import '../../../shared/providers/auth_provider.dart';
import '../../orders/order_flow_page.dart';
import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../../core/config/app_config.dart';
import 'collection_card.dart';
import '../../../shared/widgets/gachi_components.dart';
import '../domain/inventory_item.dart';
import 'delivery_request_page.dart';
import '../../conversions/conversion_page.dart';

/// Existing inventory controller, with V33 presentation and optional read adapter.
class InventoryPage extends StatefulWidget {
  final InventoryRepository repository;
  const InventoryPage({
    super.key,
    this.repository = const InventoryRepository(),
  });

  @override
  State<InventoryPage> createState() => _InventoryPageState();
}

/// 상태 필터 (전체 포함).
enum _StatusFilter { all, stored, shippingRequested, shipping, delivered }

extension on _StatusFilter {
  String get label {
    switch (this) {
      case _StatusFilter.all:
        return '전체';
      case _StatusFilter.stored:
        return '보관중';
      case _StatusFilter.shippingRequested:
        return '배송요청';
      case _StatusFilter.shipping:
        return '배송중';
      case _StatusFilter.delivered:
        return '배송완료';
    }
  }

  InventoryStatus? get status {
    switch (this) {
      case _StatusFilter.all:
        return null;
      case _StatusFilter.stored:
        return InventoryStatus.stored;
      case _StatusFilter.shippingRequested:
        return InventoryStatus.shippingRequested;
      case _StatusFilter.shipping:
        return InventoryStatus.shipping;
      case _StatusFilter.delivered:
        return InventoryStatus.delivered;
    }
  }
}

class _InventoryPageState extends State<InventoryPage> {
  InventoryRepository get _repository => widget.repository;

  List<InventoryItem> _items = [];
  bool _isLoading = true;
  String? _error;

  _StatusFilter _selectedFilter = _StatusFilter.all;
  InventorySortOption _sortOption = InventorySortOption.recentFirst;

  final Set<String> _selectedIds = {};
  bool _selectAll = false;
  final Set<String> _pendingLocks = {};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadItems());
  }

  Future<void> _loadItems() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final items = await _repository.getAll();
      if (!mounted) return;
      setState(() {
        _items = items;
        _isLoading = false;
        _selectedIds.clear();
        _selectAll = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _isLoading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = '보관함 목록을 불러오지 못했습니다';
        _isLoading = false;
      });
    }
  }

  List<InventoryItem> get _filteredItems {
    final filterStatus = _selectedFilter.status;
    final list = filterStatus == null
        ? [..._items]
        : _items.where((item) => item.status == filterStatus).toList();

    switch (_sortOption) {
      case InventorySortOption.recentFirst:
        list.sort((a, b) => b.acquiredAt.compareTo(a.acquiredAt));
        break;
      case InventorySortOption.valueHighToLow:
        list.sort((a, b) => b.price.compareTo(a.price));
        break;
      case InventorySortOption.valueLowToHigh:
        list.sort((a, b) => a.price.compareTo(b.price));
        break;
    }
    return list;
  }

  int get _totalValue => _items.fold(0, (sum, item) => sum + item.price);

  String _formatWon(int value) {
    final str = value.toString();
    final buffer = StringBuffer();
    for (int i = 0; i < str.length; i++) {
      final posFromEnd = str.length - i;
      buffer.write(str[i]);
      if (posFromEnd > 1 && posFromEnd % 3 == 1) buffer.write(',');
    }
    return '${buffer.toString()}원';
  }

  void _onFilterSelected(_StatusFilter filter) {
    setState(() {
      _selectedFilter = filter;
      _selectAll = false;
      _selectedIds.clear();
    });
  }

  void _toggleSelectAll(bool? value) {
    setState(() {
      _selectAll = value ?? false;
      if (_selectAll) {
        _selectedIds
          ..clear()
          ..addAll(
            _filteredItems
                .where((item) => item.canSelect)
                .map((item) => item.id),
          );
      } else {
        _selectedIds.clear();
      }
    });
  }

  void _toggleItemSelected(String id) {
    if (!_items.any((item) => item.id == id && item.canSelect)) return;
    setState(() {
      if (_selectedIds.contains(id)) {
        _selectedIds.remove(id);
      } else {
        _selectedIds.add(id);
      }
      _selectAll =
          _filteredItems.any((item) => item.canSelect) &&
          _filteredItems
              .where((item) => item.canSelect)
              .every((item) => _selectedIds.contains(item.id));
    });
  }

  Future<void> _toggleLock(String id) async {
    if (_isLoading || _pendingLocks.contains(id)) return;
    final index = _items.indexWhere((item) => item.id == id);
    if (index < 0 || !_items[index].canSelect) return;
    final item = _items[index];
    _pendingLocks.add(id);
    try {
      await _repository.setLock(item, locked: !item.isLocked);
      if (!mounted) return;
      await _loadItems();
    } catch (error) {
      if (!mounted) return;
      final message = error is ApiException ? error.message : '잠금 변경에 실패했습니다';
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(message)));
    } finally {
      _pendingLocks.remove(id);
    }
  }

  List<InventoryItem> get _selectedItems =>
      _items.where((item) => _selectedIds.contains(item.id)).toList();

  bool get _hasSelection => _selectedIds.isNotEmpty;

  void _clearSelection() {
    setState(() {
      _selectedIds.clear();
      _selectAll = false;
    });
  }

  // ── 액션 1: 배송요청 ──────────────────────────────────────────────
  Future<void> _onRequestShipping() async {
    if (!AppConfig.shippingPreviewEnabled) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('현재 배송 서비스를 준비하고 있습니다')));
      return;
    }
    if (!_hasSelection) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('배송 요청할 상품을 선택해주세요')));
      return;
    }

    final selected = _selectedItems;
    final hasUnavailable = selected.any((item) => !item.canShip);
    if (hasUnavailable) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('보관중인 상품만 배송 신청할 수 있습니다')));
      return;
    }

    final result = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (context) => DeliveryRequestPage(items: selected),
      ),
    );

    if (result == true && mounted) {
      // 배송 신청이 백엔드에서 처리되어 아이템 상태가 실제로 바뀌었으므로
      // 로컬 목록을 새로 조회해 최신 상태를 반영한다.
      _clearSelection();
      await _loadItems();
    }
  }

  Future<void> _openConversions({bool selected = false}) async {
    final user = context.read<AuthProvider>().currentUser;
    if (user == null || _isLoading || _pendingLocks.isNotEmpty) return;
    final items = _selectedItems;
    if (selected &&
        (items.isEmpty ||
            items.length > 100 ||
            items.any((i) => !i.canConvert))) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('잠금 해제된 보관 상품을 1~100개 선택해주세요')),
      );
      return;
    }
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ConversionPage(
          userId: user.id,
          inventoryIds: selected
              ? items.map((i) => i.numericId).toList()
              : null,
        ),
      ),
    );
    if (mounted && context.read<AuthProvider>().currentUser?.id == user.id) {
      await _loadItems();
    }
  }

  void _openSortSheet() {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: GachiColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (sheetContext) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const SizedBox(height: 12),
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: GachiColors.divider,
                  borderRadius: BorderRadius.circular(4),
                ),
              ),
              const SizedBox(height: 16),
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 20),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    '정렬',
                    style: TextStyle(
                      color: GachiColors.ink,
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 8),
              for (final option in InventorySortOption.values)
                ListTile(
                  title: Text(
                    option.label,
                    style: TextStyle(
                      color: option == _sortOption
                          ? GachiColors.ink
                          : GachiColors.ink,
                      fontWeight: option == _sortOption
                          ? FontWeight.w700
                          : FontWeight.w500,
                      fontSize: 14,
                    ),
                  ),
                  trailing: option == _sortOption
                      ? const Icon(Icons.check_rounded, color: GachiColors.ink)
                      : null,
                  onTap: () {
                    setState(() => _sortOption = option);
                    Navigator.of(sheetContext).pop();
                  },
                ),
              const SizedBox(height: 8),
            ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final items = _filteredItems;
    return GachiTheme(
      child: Scaffold(
        appBar: AppBar(
          title: const Text('보관함'),
          actions: [
            IconButton(
              tooltip: 'GP 전환 내역과 상품 복구',
              onPressed: () => _openConversions(),
              icon: const Icon(Icons.swap_horiz),
            ),
            IconButton(
              tooltip: '상품 정렬',
              onPressed: _openSortSheet,
              icon: const Icon(Icons.sort_rounded),
            ),
          ],
        ),
        bottomNavigationBar: _hasSelection
            ? SafeArea(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      FilledButton.icon(
                        onPressed: _isLoading || _pendingLocks.isNotEmpty
                            ? null
                            : () => _openConversions(selected: true),
                        icon: const Icon(Icons.swap_horiz),
                        label: Text('${_selectedIds.length}개 GP 전환 확인'),
                      ),
                      const SizedBox(height: 8),
                      OutlinedButton.icon(
                        onPressed:
                            AppConfig.shippingPreviewEnabled && !_isLoading
                            ? _onRequestShipping
                            : null,
                        icon: const Icon(Icons.local_shipping_outlined),
                        label: Text(
                          AppConfig.shippingPreviewEnabled
                              ? '${_selectedIds.length}개 배송 요청'
                              : '배송 서비스 준비 중',
                        ),
                      ),
                    ],
                  ),
                ),
              )
            : null,
        body: SafeArea(
          top: false,
          child: _isLoading
              ? const Center(child: CircularProgressIndicator())
              : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(_error!, textAlign: TextAlign.center),
                        TextButton(
                          onPressed: _loadItems,
                          child: const Text('다시 시도'),
                        ),
                      ],
                    ),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _loadItems,
                  child: LayoutBuilder(
                    builder: (context, constraints) {
                      return ListView(
                        physics: const AlwaysScrollableScrollPhysics(),
                        padding: const EdgeInsets.all(16),
                        children: [
                          const GachiSectionHeader(title: '나의 보관함'),
                          const SizedBox(height: GachiSpace.sm),
                          Text(
                            '조회된 상품 ${_items.length}개 · 추정 가치 ${_formatWon(_totalValue)}',
                            style: GachiType.meta.copyWith(
                              color: GachiColors.secondary,
                            ),
                          ),
                          if (AppConfig.orderPreviewEnabled)
                            TextButton(
                              onPressed: () async {
                                final user = context
                                    .read<AuthProvider>()
                                    .currentUser;
                                if (user == null) return;
                                await Navigator.of(context).push(
                                  MaterialPageRoute(
                                    builder: (_) =>
                                        OrderFlowPage(userId: user.id),
                                  ),
                                );
                                if (mounted) await _loadItems();
                              },
                              child: const Text('미개봉 캡슐'),
                            ),
                          const SizedBox(height: GachiSpace.md),
                          const SizedBox(height: 20),
                          Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: [
                              for (final filter in _StatusFilter.values)
                                ChoiceChip(
                                  label: Text(
                                    filter.label,
                                    style: TextStyle(
                                      color: filter == _selectedFilter
                                          ? GachiColors.ivory
                                          : GachiColors.ink,
                                    ),
                                  ),
                                  selected: filter == _selectedFilter,
                                  onSelected: (_) => _onFilterSelected(filter),
                                ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          Text(
                            _sortOption.label,
                            style: const TextStyle(
                              color: GachiColors.secondary,
                            ),
                          ),
                          CheckboxListTile(
                            contentPadding: EdgeInsets.zero,
                            controlAffinity: ListTileControlAffinity.leading,
                            title: Text(
                              '보관중 상품 전체선택 · ${_selectedIds.length}개 선택',
                            ),
                            value: _selectAll,
                            onChanged: items.any((item) => item.canSelect)
                                ? _toggleSelectAll
                                : null,
                          ),
                          if (items.isEmpty)
                            const Padding(
                              padding: EdgeInsets.symmetric(vertical: 48),
                              child: Column(
                                children: [
                                  Icon(
                                    Icons.collections_bookmark_outlined,
                                    size: 56,
                                  ),
                                  SizedBox(height: 16),
                                  Text('이 상태에 해당하는 상품이 없어요'),
                                  SizedBox(height: 8),
                                  Text(
                                    '다른 상태를 선택하거나 캡슐을 개봉해보세요.',
                                    textAlign: TextAlign.center,
                                  ),
                                ],
                              ),
                            )
                          else
                            ...items.map(
                              (item) => CollectionCard(
                                item: item,
                                selected: _selectedIds.contains(item.id),
                                onSelect: () => _toggleItemSelected(item.id),
                                onLock: () => _toggleLock(item.id),
                              ),
                            ),
                        ],
                      );
                    },
                  ),
                ),
        ),
      ),
    );
  }
}
