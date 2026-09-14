import 'package:provider/provider.dart';
import '../../../shared/providers/auth_provider.dart';
import '../../orders/order_flow_page.dart';
import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../../core/config/app_config.dart';
import 'collection_card.dart';
import '../../../core/theme/app_colors.dart';
import '../domain/inventory_item.dart';
import 'delivery_request_page.dart';

/// 가치가차 - 하단 탭 "박스"(보관함) 화면.
///
/// "Vivid Pastel Pop" 컨셉으로, 전체 배경은 크림 화이트이며
/// 코랄 액센트가 선택/강조 요소에 사용된다.
/// 보관함 목록은 백엔드 `GET /inventory`에서 실시간으로 가져온다.
class InventoryPage extends StatefulWidget {
  const InventoryPage({super.key});

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
  final _repository = const InventoryRepository();

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
            _filteredItems.where((item) => item.canShip).map((item) => item.id),
          );
      } else {
        _selectedIds.clear();
      }
    });
  }

  void _toggleItemSelected(String id) {
    if (!_items.any((item) => item.id == id && item.canShip)) return;
    setState(() {
      if (_selectedIds.contains(id)) {
        _selectedIds.remove(id);
      } else {
        _selectedIds.add(id);
      }
      _selectAll =
          _filteredItems.any((item) => item.canShip) &&
          _filteredItems
              .where((item) => item.canShip)
              .every((item) => _selectedIds.contains(item.id));
    });
  }

  Future<void> _toggleLock(String id) async {
    if (_isLoading || _pendingLocks.contains(id)) return;
    final index = _items.indexWhere((item) => item.id == id);
    if (index < 0 || !_items[index].canShip) return;
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
    if (!AppConfig.legacyTransactionsEnabled) {
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

  void _openSortSheet() {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.surfaceElevated,
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
                  color: AppColors.surfaceBorder,
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
                      color: AppColors.textPrimary,
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
                          ? AppColors.goldSecondary
                          : AppColors.textPrimary,
                      fontWeight: option == _sortOption
                          ? FontWeight.w700
                          : FontWeight.w500,
                      fontSize: 14,
                    ),
                  ),
                  trailing: option == _sortOption
                      ? const Icon(
                          Icons.check_rounded,
                          color: AppColors.goldSecondary,
                        )
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
    return Scaffold(
      appBar: AppBar(
        title: const Text('내 컬렉션'),
        actions: [
          if (AppConfig.orderPreviewEnabled)
            TextButton(
              onPressed: () async {
                final user = context.read<AuthProvider>().currentUser;
                if (user == null) return;
                await Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => OrderFlowPage(userId: user.id),
                  ),
                );
                if (mounted) await _loadItems();
              },
              child: const Text('미개봉 캡슐'),
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
                child: FilledButton.icon(
                  onPressed: AppConfig.legacyTransactionsEnabled && !_isLoading
                      ? _onRequestShipping
                      : null,
                  icon: const Icon(Icons.local_shipping_outlined),
                  label: Text(
                    AppConfig.legacyTransactionsEnabled
                        ? '${_selectedIds.length}개 배송 요청'
                        : '배송 서비스 준비 중',
                  ),
                ),
              ),
            )
          : null,
      body: _isLoading
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
                  final columns = constraints.maxWidth >= 600
                      ? 3
                      : constraints.maxWidth >= 360 &&
                            MediaQuery.textScalerOf(context).scale(14) <= 20
                      ? 2
                      : 1;
                  final width =
                      (constraints.maxWidth - 32 - (columns - 1) * 12) /
                      columns;
                  return ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.all(16),
                    children: [
                      Container(
                        padding: const EdgeInsets.all(24),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(24),
                          gradient: const LinearGradient(
                            colors: [Color(0xFF29203E), Color(0xFF101018)],
                          ),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'MY COLLECTION',
                              style: TextStyle(
                                color: Color(0xFFB9A4FF),
                                letterSpacing: 2,
                              ),
                            ),
                            const SizedBox(height: 12),
                            Text(
                              '나의 수집 기록 ${_items.length}개',
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 24,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Text(
                              '조회된 상품의 추정 가치 ${_formatWon(_totalValue)}',
                              style: const TextStyle(color: Color(0xFFD8D3E3)),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 20),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          for (final filter in _StatusFilter.values)
                            ChoiceChip(
                              label: Text(filter.label),
                              selected: filter == _selectedFilter,
                              onSelected: (_) => _onFilterSelected(filter),
                            ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Text(
                        _sortOption.label,
                        style: const TextStyle(color: AppColors.textSecondary),
                      ),
                      CheckboxListTile(
                        contentPadding: EdgeInsets.zero,
                        controlAffinity: ListTileControlAffinity.leading,
                        title: Text('보관중 상품 전체선택 · ${_selectedIds.length}개 선택'),
                        value: _selectAll,
                        onChanged: items.any((item) => item.canShip)
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
                        Wrap(
                          spacing: 12,
                          runSpacing: 12,
                          children: [
                            for (final item in items)
                              SizedBox(
                                width: width,
                                child: CollectionCard(
                                  item: item,
                                  selected: _selectedIds.contains(item.id),
                                  onSelect: () => _toggleItemSelected(item.id),
                                  onLock: () => _toggleLock(item.id),
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
}
