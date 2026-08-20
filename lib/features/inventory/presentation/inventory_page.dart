import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../../core/constants/rank_colors.dart';
import '../../../core/theme/app_colors.dart';
import '../domain/inventory_item.dart';
import 'delivery_request_page.dart';

/// 가치가차 - 하단 탭 "박스"(보관함) 화면.
///
/// "화이트 앱 셸 + 다크 포인트" 컨셉으로, 전체 배경은 화이트이며
/// 골드 컬러가 선택/강조 요소에 사용된다.
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

  String _formatGp(int value) {
    final str = value.toString();
    final buffer = StringBuffer();
    for (int i = 0; i < str.length; i++) {
      final posFromEnd = str.length - i;
      buffer.write(str[i]);
      if (posFromEnd > 1 && posFromEnd % 3 == 1) buffer.write(',');
    }
    return '${buffer.toString()} GP';
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
          ..addAll(_filteredItems.map((item) => item.id));
      } else {
        _selectedIds.clear();
      }
    });
  }

  void _toggleItemSelected(String id) {
    setState(() {
      if (_selectedIds.contains(id)) {
        _selectedIds.remove(id);
      } else {
        _selectedIds.add(id);
      }
      _selectAll =
          _filteredItems.isNotEmpty &&
          _filteredItems.every((item) => _selectedIds.contains(item.id));
    });
  }

  // 잠금(lock) 토글은 현재 백엔드에 대응 API가 없어(원 5개 요구사항 범위 밖),
  // 클라이언트 로컬 상태만 변경하는 데모용 동작으로 유지한다.
  void _toggleLock(String id) {
    bool nowLocked = false;
    setState(() {
      _items = _items.map((item) {
        if (item.id != id) return item;
        nowLocked = !item.isLocked;
        return InventoryItem(
          id: item.id,
          name: item.name,
          grade: item.grade,
          price: item.price,
          icon: item.icon,
          status: item.status,
          acquiredAt: item.acquiredAt,
          isLocked: nowLocked,
        );
      }).toList();
    });
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(nowLocked ? '잠금되었습니다' : '잠금 해제되었습니다')),
    );
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
    if (!_hasSelection) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('배송 요청할 상품을 선택해주세요')));
      return;
    }

    final selected = _selectedItems;
    final hasLocked = selected.any((item) => item.isLocked);
    if (hasLocked) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('잠금된 상품은 배송 신청이 불가합니다')));
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

  // ── 액션 2: 포인트전환 (백엔드 미지원 - 데모 UI로 유지) ────────────
  void _onConvertToPoints() {
    if (!_hasSelection) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('포인트로 전환할 상품을 선택해주세요')));
      return;
    }

    final selected = _selectedItems;
    final hasLocked = selected.any((item) => item.isLocked);
    if (hasLocked) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('잠금된 상품은 포인트 전환이 불가합니다')));
      return;
    }

    final hasPremium = selected.any((item) => item.grade == 'S');

    showDialog<void>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          title: const Text(
            '포인트 전환',
            style: TextStyle(fontWeight: FontWeight.w700),
          ),
          content: const Text('일반 상품은 소비자가의 10%로 전환됩니다. 계속하시겠습니까?'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text(
                '취소',
                style: TextStyle(color: AppColors.textSecondary),
              ),
            ),
            TextButton(
              onPressed: () {
                Navigator.of(dialogContext).pop();
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text(
                      hasPremium
                          ? '포인트 전환 완료 (프리미엄 등급 상품은 100% 환급 및 배송)'
                          : '포인트 전환 완료',
                    ),
                  ),
                );
                _clearSelection();
              },
              child: const Text(
                '확인',
                style: TextStyle(
                  color: AppColors.goldSecondary,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        );
      },
    );
  }

  // ── 액션 3: 장바구니 (백엔드 미지원 - 데모 UI로 유지, 선택 상품 잠금 처리) ──
  void _onAddToCart() {
    if (!_hasSelection) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('장바구니에 담을 상품을 선택해주세요')));
      return;
    }

    final selectedIds = {..._selectedIds};
    setState(() {
      _items = _items.map((item) {
        if (!selectedIds.contains(item.id)) return item;
        return InventoryItem(
          id: item.id,
          name: item.name,
          grade: item.grade,
          price: item.price,
          icon: item.icon,
          status: item.status,
          acquiredAt: item.acquiredAt,
          isLocked: true,
        );
      }).toList();
    });
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(const SnackBar(content: Text('선택한 상품을 장바구니(잠금) 처리했습니다')));
    _clearSelection();
  }

  void _openSortSheet() {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.white,
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
    final filteredItems = _filteredItems;

    return Scaffold(
      backgroundColor: AppColors.scaffoldBg,
      appBar: AppBar(
        backgroundColor: AppColors.scaffoldBg,
        elevation: 0,
        automaticallyImplyLeading: false,
        title: const Text(
          '내 박스',
          style: TextStyle(
            color: AppColors.textPrimary,
            fontSize: 18,
            fontWeight: FontWeight.w700,
          ),
        ),
        actions: [
          IconButton(
            onPressed: _openSortSheet,
            icon: const Icon(
              Icons.filter_list_rounded,
              color: AppColors.textPrimary,
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: _isLoading
            ? const Center(
                child: CircularProgressIndicator(color: AppColors.goldPrimary),
              )
            : _error != null
            ? Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      _error!,
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: AppColors.textSecondary),
                    ),
                    const SizedBox(height: 12),
                    TextButton(
                      onPressed: _loadItems,
                      child: const Text('다시 시도'),
                    ),
                  ],
                ),
              )
            : RefreshIndicator(
                onRefresh: _loadItems,
                child: Column(
                  children: [
                    // ── 상단 요약 카드 ──
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
                      child: Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(18),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(16),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.06),
                              blurRadius: 12,
                              offset: const Offset(0, 4),
                            ),
                          ],
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    '보관 상품 ${_items.length}개',
                                    style: const TextStyle(
                                      color: AppColors.textPrimary,
                                      fontSize: 20,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    '총 예상 가치 ${_formatGp(_totalValue)}',
                                    style: const TextStyle(
                                      color: AppColors.goldPrimary,
                                      fontSize: 14,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            Text(
                              '정렬: ${_sortOption.label}',
                              style: const TextStyle(
                                color: AppColors.textSecondary,
                                fontSize: 11,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),

                    // ── 상태 필터 탭 (가로 스크롤) ──
                    SizedBox(
                      height: 40,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        itemCount: _StatusFilter.values.length,
                        separatorBuilder: (context, index) =>
                            const SizedBox(width: 8),
                        itemBuilder: (context, index) {
                          final filter = _StatusFilter.values[index];
                          final selected = filter == _selectedFilter;
                          return _FilterPill(
                            label: filter.label,
                            selected: selected,
                            onTap: () => _onFilterSelected(filter),
                          );
                        },
                      ),
                    ),
                    const SizedBox(height: 12),

                    // ── 전체선택 + 액션 버튼 3종 ──
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          GestureDetector(
                            onTap: () => _toggleSelectAll(!_selectAll),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                SizedBox(
                                  width: 22,
                                  height: 22,
                                  child: Checkbox(
                                    value: _selectAll,
                                    onChanged: _toggleSelectAll,
                                    activeColor: AppColors.goldPrimary,
                                    shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(4),
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 6),
                                const Text(
                                  '전체선택',
                                  style: TextStyle(
                                    color: AppColors.textPrimary,
                                    fontSize: 13,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(height: 8),
                          Row(
                            children: [
                              Expanded(
                                child: OutlinedButton(
                                  onPressed: _onConvertToPoints,
                                  style: OutlinedButton.styleFrom(
                                    foregroundColor: AppColors.goldSecondary,
                                    side: const BorderSide(
                                      color: AppColors.goldSecondary,
                                    ),
                                    shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(10),
                                    ),
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 6,
                                    ),
                                    minimumSize: const Size(0, 34),
                                  ),
                                  child: const Text(
                                    '포인트전환',
                                    style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ),
                              ),
                              const SizedBox(width: 6),
                              Expanded(
                                child: ElevatedButton(
                                  onPressed: _onRequestShipping,
                                  style: ElevatedButton.styleFrom(
                                    backgroundColor: AppColors.goldPrimary,
                                    foregroundColor: Colors.white,
                                    elevation: 0,
                                    shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(10),
                                    ),
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 6,
                                    ),
                                    minimumSize: const Size(0, 34),
                                  ),
                                  child: const Text(
                                    '배송요청',
                                    style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ),
                              ),
                              const SizedBox(width: 6),
                              Expanded(
                                child: OutlinedButton(
                                  onPressed: _onAddToCart,
                                  style: OutlinedButton.styleFrom(
                                    foregroundColor: AppColors.textSecondary,
                                    side: const BorderSide(
                                      color: AppColors.surfaceBorder,
                                    ),
                                    shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(10),
                                    ),
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 6,
                                    ),
                                    minimumSize: const Size(0, 34),
                                  ),
                                  child: const Text(
                                    '장바구니',
                                    style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 8),

                    // ── 상품 리스트 ──
                    Expanded(
                      child: filteredItems.isEmpty
                          ? ListView(
                              children: const [
                                SizedBox(height: 100),
                                Center(
                                  child: Column(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Icon(
                                        Icons.inventory_2_outlined,
                                        size: 48,
                                        color: AppColors.textSecondary,
                                      ),
                                      SizedBox(height: 12),
                                      Text(
                                        '보관 중인 상품이 없습니다',
                                        style: TextStyle(
                                          color: AppColors.textSecondary,
                                          fontSize: 13,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            )
                          : ListView.separated(
                              padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
                              itemCount: filteredItems.length,
                              separatorBuilder: (context, index) =>
                                  const SizedBox(height: 10),
                              itemBuilder: (context, index) {
                                final item = filteredItems[index];
                                return _InventoryItemCard(
                                  item: item,
                                  selected: _selectedIds.contains(item.id),
                                  onSelectToggle: () =>
                                      _toggleItemSelected(item.id),
                                  onLockToggle: () => _toggleLock(item.id),
                                );
                              },
                            ),
                    ),
                  ],
                ),
              ),
      ),
    );
  }
}

/// 상태 필터 탭에 사용되는 pill 버튼.
class _FilterPill extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _FilterPill({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? AppColors.goldPrimary : Colors.white,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
              color: selected ? Colors.transparent : AppColors.surfaceBorder,
            ),
          ),
          alignment: Alignment.center,
          child: Text(
            label,
            style: TextStyle(
              color: selected ? Colors.white : AppColors.textSecondary,
              fontSize: 13,
              fontWeight: selected ? FontWeight.w700 : FontWeight.w600,
            ),
          ),
        ),
      ),
    );
  }
}

/// 보관함 상품 리스트 카드.
class _InventoryItemCard extends StatelessWidget {
  final InventoryItem item;
  final bool selected;
  final VoidCallback onSelectToggle;
  final VoidCallback onLockToggle;

  const _InventoryItemCard({
    required this.item,
    required this.selected,
    required this.onSelectToggle,
    required this.onLockToggle,
  });

  @override
  Widget build(BuildContext context) {
    final color = RankColors.of(item.grade);

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 8,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          // ── 좌측 체크박스 ──
          Checkbox(
            value: selected,
            onChanged: (_) => onSelectToggle(),
            activeColor: AppColors.goldPrimary,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(4),
            ),
          ),
          // ── 상품명 / 소비자가 / 상태 ──
          Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 3,
                        ),
                        decoration: BoxDecoration(
                          color: color,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text(
                          item.grade,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 10,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          item.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    '소비자가 ${item.formattedPrice}',
                    style: const TextStyle(
                      color: AppColors.goldPrimary,
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    item.status.label,
                    style: const TextStyle(
                      color: AppColors.textSecondary,
                      fontSize: 11,
                    ),
                  ),
                ],
              ),
            ),
          ),
          // ── 우측 자물쇠 토글 ──
          IconButton(
            onPressed: onLockToggle,
            icon: Icon(
              item.isLocked ? Icons.lock_rounded : Icons.lock_open_rounded,
              color: item.isLocked
                  ? AppColors.goldPrimary
                  : AppColors.textSecondary,
              size: 20,
            ),
          ),
        ],
      ),
    );
  }
}
