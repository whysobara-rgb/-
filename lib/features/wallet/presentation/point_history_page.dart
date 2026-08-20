import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/providers/gp_provider.dart';
import '../domain/point_history.dart';

/// 가치가차 - 포인트(GP) 내역 전체 페이지.
///
/// 충전 탭(WalletPage)의 "전체보기"와 마이페이지의 "포인트내역" 메뉴가
/// 공통으로 이동하는 화면. (중복 화면 생성 방지를 위해 단일 페이지로 공유)
class PointHistoryPage extends StatefulWidget {
  const PointHistoryPage({super.key});

  @override
  State<PointHistoryPage> createState() => _PointHistoryPageState();
}

/// 필터 탭 (전체 포함).
enum _HistoryFilter { all, earn, use, expire }

extension on _HistoryFilter {
  String get label {
    switch (this) {
      case _HistoryFilter.all:
        return '전체';
      case _HistoryFilter.earn:
        return '지급';
      case _HistoryFilter.use:
        return '사용';
      case _HistoryFilter.expire:
        return '소멸';
    }
  }

  PointHistoryType? get type {
    switch (this) {
      case _HistoryFilter.all:
        return null;
      case _HistoryFilter.earn:
        return PointHistoryType.earn;
      case _HistoryFilter.use:
        return PointHistoryType.use;
      case _HistoryFilter.expire:
        return PointHistoryType.expire;
    }
  }
}

class _PointHistoryPageState extends State<PointHistoryPage> {
  final _repository = const PointHistoryRepository();
  List<PointHistoryEntry> _allHistory = [];
  bool _isLoading = true;
  String? _error;

  _HistoryFilter _selectedFilter = _HistoryFilter.all;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadHistory());
  }

  Future<void> _loadHistory() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final history = await _repository.getAll();
      if (!mounted) return;
      setState(() {
        _allHistory = history;
        _isLoading = false;
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
        _error = '포인트 내역을 불러오지 못했습니다';
        _isLoading = false;
      });
    }
  }

  List<PointHistoryEntry> get _filteredHistory {
    final filterType = _selectedFilter.type;
    if (filterType == null) return _allHistory;
    return _allHistory.where((entry) => entry.type == filterType).toList();
  }

  @override
  Widget build(BuildContext context) {
    final gp = context.watch<GpProvider>();
    final filtered = _filteredHistory;

    return Scaffold(
      backgroundColor: AppColors.scaffoldBg,
      appBar: AppBar(
        backgroundColor: AppColors.scaffoldBg,
        elevation: 0,
        centerTitle: true,
        title: const Text(
          '포인트 내역',
          style: TextStyle(
            color: AppColors.textPrimary,
            fontSize: 18,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
      body: SafeArea(
        child: Column(
          children: [
            // ── 상단 GP 잔액 카드 ──
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: AppColors.surfaceElevated,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: AppColors.surfaceBorder),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      '보유 GP',
                      style: TextStyle(
                        color: AppColors.textOnDarkSecondary,
                        fontSize: 14,
                      ),
                    ),
                    Text(
                      '${gp.formattedBalance} GP',
                      style: const TextStyle(
                        color: AppColors.goldPrimary,
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
              ),
            ),

            // ── 필터탭 ──
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(
                children: [
                  for (final filter in _HistoryFilter.values) ...[
                    _FilterPill(
                      label: filter.label,
                      selected: filter == _selectedFilter,
                      onTap: () => setState(() => _selectedFilter = filter),
                    ),
                    const SizedBox(width: 8),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 12),

            // ── 내역 리스트 ──
            Expanded(
              child: _isLoading
                  ? const Center(
                      child: CircularProgressIndicator(
                        color: AppColors.goldPrimary,
                      ),
                    )
                  : _error != null
                  ? Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            _error!,
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              color: AppColors.textSecondary,
                            ),
                          ),
                          const SizedBox(height: 12),
                          TextButton(
                            onPressed: _loadHistory,
                            child: const Text('다시 시도'),
                          ),
                        ],
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _loadHistory,
                      child: filtered.isEmpty
                          ? ListView(
                              children: const [
                                SizedBox(height: 100),
                                Center(
                                  child: Text(
                                    '내역이 없습니다',
                                    style: TextStyle(
                                      color: AppColors.textSecondary,
                                      fontSize: 13,
                                    ),
                                  ),
                                ),
                              ],
                            )
                          : ListView.separated(
                              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                              itemCount: filtered.length,
                              separatorBuilder: (context, index) =>
                                  const Divider(
                                    height: 1,
                                    color: AppColors.surfaceBorder,
                                  ),
                              itemBuilder: (context, index) {
                                final entry = filtered[index];
                                return _HistoryTile(entry: entry);
                              },
                            ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

/// 필터탭에 사용되는 pill 버튼.
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
      color: selected ? AppColors.goldPrimary : AppColors.surfaceElevated,
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
          child: Text(
            label,
            style: TextStyle(
              color: selected
                  ? const Color(0xFF16161A)
                  : AppColors.textSecondary,
              fontSize: 13,
              fontWeight: selected ? FontWeight.w700 : FontWeight.w600,
            ),
          ),
        ),
      ),
    );
  }
}

/// 포인트 내역 리스트 항목 (날짜 + 내역명 + 금액).
class _HistoryTile extends StatelessWidget {
  final PointHistoryEntry entry;

  const _HistoryTile({required this.entry});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Row(
        children: [
          SizedBox(
            width: 44,
            child: Text(
              entry.formattedDate,
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 12,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              entry.description,
              style: const TextStyle(
                color: AppColors.textPrimary,
                fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          Text(
            entry.formattedAmount,
            style: TextStyle(
              color: entry.type.amountColor,
              fontSize: 14,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}
