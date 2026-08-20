import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/providers/auth_provider.dart';
import '../../../shared/providers/gp_provider.dart';
import '../domain/point_history.dart';
import 'point_history_page.dart';

/// 가치가차 - 하단 탭 "충전" 화면.
///
/// GP 현황 확인 + 실제 충전(데모 결제 시뮬레이션, POST /wallet/topup) +
/// 이용 내역 확인 + 랜덤박스 구매 유도 역할을 한다.
/// 박스 상세화면에서 잔액 부족으로 이 탭으로 이동해온 경우, 상단 충전 버튼을
/// 통해 결제를 마친 뒤에만 다시 박스를 열 수 있는 흐름을 유도한다.
/// 최근 포인트 내역은 백엔드 GET /wallet/point-history에서 실시간으로 가져온다.
class WalletPage extends StatefulWidget {
  /// "랜덤박스 구매하러 가기" 탭 시 하단 네비게이션을 홈(0번) 탭으로
  /// 전환하기 위한 콜백. [MainNavigation]에서 전달된다.
  final VoidCallback onGoToHome;

  const WalletPage({super.key, required this.onGoToHome});

  @override
  State<WalletPage> createState() => _WalletPageState();
}

class _WalletPageState extends State<WalletPage> {
  final _repository = const PointHistoryRepository();
  List<PointHistoryEntry> _recentHistory = [];
  bool _isLoading = true;
  bool _isTopupInProgress = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadRecentHistory());
  }

  Future<void> _loadRecentHistory() async {
    setState(() => _isLoading = true);
    try {
      final history = await _repository.getAll(limit: 5);
      if (!mounted) return;
      setState(() {
        _recentHistory = history;
        _isLoading = false;
      });
    } on ApiException catch (_) {
      if (!mounted) return;
      setState(() => _isLoading = false);
    } catch (_) {
      if (!mounted) return;
      setState(() => _isLoading = false);
    }
  }

  void _openHistory(BuildContext context) {
    Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (context) => const PointHistoryPage()));
  }

  /// 충전 금액 선택 밋텀시트를 열고, 선택된 금액으로 결제 시뮬레이션을
  /// 진행한다. 결제 성공 시 실제 백엔드 POST /wallet/topup을 호출하고,
  /// 성공하면 AuthProvider.refreshProfile()로 잔액을 갱신한다.
  Future<void> _openTopupSheet() async {
    final amount = await showModalBottomSheet<int>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (sheetContext) => const _TopupAmountSheet(),
    );
    if (amount == null || !mounted) return;

    // 결제 시뮬레이션 다이얼로그 (실제 PG 연동 전까지의 데모).
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text(
          '결제 확인',
          style: TextStyle(fontWeight: FontWeight.w700),
        ),
        content: Text('$amount GP를 충전하시겠습니까?\n(데모 결제로 즉시 반영됩니다)'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text(
              '취소',
              style: TextStyle(color: AppColors.textSecondary),
            ),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text(
              '결제하기',
              style: TextStyle(
                color: AppColors.goldPrimary,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _isTopupInProgress = true);
    try {
      await const ApiClient().post('/wallet/topup', body: {'amount': amount});
      if (!mounted) return;
      await context.read<AuthProvider>().refreshProfile();
      if (!mounted) return;
      await _loadRecentHistory();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('$amount GP가 충전되었습니다')),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('충전 중 오류가 발생했습니다')));
    } finally {
      if (mounted) setState(() => _isTopupInProgress = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final gp = context.watch<GpProvider>();
    final nickname = context.watch<AuthProvider>().currentUser?.nickname ?? '';
    final recentHistory = _recentHistory;

    return Scaffold(
      backgroundColor: AppColors.scaffoldBg,
      appBar: AppBar(
        backgroundColor: AppColors.scaffoldBg,
        elevation: 0,
        automaticallyImplyLeading: false,
        title: const Text(
          '충전',
          style: TextStyle(
            color: AppColors.textPrimary,
            fontSize: 18,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _loadRecentHistory,
          child: ListView(
            padding: EdgeInsets.zero,
            children: [
              // ── 상단 GP 카드 (darkSurface 그라데이션, 마진 20) ──
              Container(
                margin: const EdgeInsets.all(20),
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [
                      AppColors.darkSurface,
                      AppColors.darkSurface.withValues(alpha: 0.85),
                    ],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '$nickname님의 보유 포인트',
                      style: const TextStyle(color: Colors.white, fontSize: 14),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      '${gp.formattedBalance} GP',
                      style: const TextStyle(
                        color: AppColors.goldPrimary,
                        fontSize: 32,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 16),
                    // ── 충전하기 버튼 ──
                    SizedBox(
                      width: double.infinity,
                      height: 48,
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: AppColors.goldGradient,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Material(
                          type: MaterialType.transparency,
                          child: InkWell(
                            borderRadius: BorderRadius.circular(12),
                            onTap: _isTopupInProgress ? null : _openTopupSheet,
                            child: Center(
                              child: _isTopupInProgress
                                  ? const SizedBox(
                                      width: 20,
                                      height: 20,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2.2,
                                        color: Colors.white,
                                      ),
                                    )
                                  : const Text(
                                      '포인트 충전하기',
                                      style: TextStyle(
                                        color: Colors.white,
                                        fontSize: 15,
                                        fontWeight: FontWeight.w800,
                                      ),
                                    ),
                            ),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    Align(
                      alignment: Alignment.centerRight,
                      child: TextButton(
                        onPressed: widget.onGoToHome,
                        style: TextButton.styleFrom(
                          padding: EdgeInsets.zero,
                          minimumSize: Size.zero,
                          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        ),
                        child: const Text(
                          '랜덤박스 구매하러 가기 →',
                          style: TextStyle(
                            color: AppColors.goldPrimary,
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),

              // ── 최근 포인트 내역 (화이트) ──
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text(
                          '최근 포인트 내역',
                          style: TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        GestureDetector(
                          onTap: () => _openHistory(context),
                          child: const Text(
                            '전체보기 >',
                            style: TextStyle(
                              color: AppColors.textSecondary,
                              fontSize: 13,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),

                    Container(
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(16),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.05),
                            blurRadius: 10,
                            offset: const Offset(0, 3),
                          ),
                        ],
                      ),
                      child: _isLoading
                          ? const Padding(
                              padding: EdgeInsets.symmetric(vertical: 32),
                              child: Center(
                                child: CircularProgressIndicator(
                                  color: AppColors.goldPrimary,
                                ),
                              ),
                            )
                          : recentHistory.isEmpty
                          ? const Padding(
                              padding: EdgeInsets.symmetric(vertical: 32),
                              child: Center(
                                child: Text(
                                  '내역이 없습니다',
                                  style: TextStyle(
                                    color: AppColors.textSecondary,
                                    fontSize: 13,
                                  ),
                                ),
                              ),
                            )
                          : ListView.builder(
                              shrinkWrap: true,
                              physics: const NeverScrollableScrollPhysics(),
                              padding: EdgeInsets.zero,
                              itemCount: recentHistory.length,
                              itemBuilder: (context, index) {
                                final entry = recentHistory[index];
                                return Column(
                                  children: [
                                    _HistoryPreviewTile(entry: entry),
                                    if (index != recentHistory.length - 1)
                                      const Divider(
                                        height: 1,
                                        indent: 16,
                                        endIndent: 16,
                                        color: AppColors.surfaceBorder,
                                      ),
                                  ],
                                );
                              },
                            ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// 포인트 내역 미리보기에 사용되는 리스트 항목.
/// 아이콘(획득=골드원형+, 사용=회색원형-) / 내용 / 날짜 / 금액.
class _HistoryPreviewTile extends StatelessWidget {
  final PointHistoryEntry entry;

  const _HistoryPreviewTile({required this.entry});

  @override
  Widget build(BuildContext context) {
    final isEarn = entry.type == PointHistoryType.earn;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        children: [
          Container(
            width: 32,
            height: 32,
            decoration: BoxDecoration(
              color: isEarn
                  ? AppColors.goldPrimary.withValues(alpha: 0.15)
                  : AppColors.surfaceElevated,
              shape: BoxShape.circle,
            ),
            alignment: Alignment.center,
            child: Text(
              isEarn ? '+' : '-',
              style: TextStyle(
                color: isEarn ? AppColors.goldPrimary : AppColors.textSecondary,
                fontSize: 16,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  entry.description,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  entry.formattedDate,
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          Text(
            entry.formattedAmount,
            style: TextStyle(
              color: entry.type.amountColor,
              fontSize: 13,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

/// GP 충전 금액을 선택하는 바텀시트.
///
/// 프리셋 금액(10,000/30,000/50,000/100,000 GP) 또는 직접 입력을 통해
/// 충전할 금액을 선택하고, "충전하기"를 누르면 선택된 금액을 pop한다.
class _TopupAmountSheet extends StatefulWidget {
  const _TopupAmountSheet();

  @override
  State<_TopupAmountSheet> createState() => _TopupAmountSheetState();
}

class _TopupAmountSheetState extends State<_TopupAmountSheet> {
  static const List<int> _presets = [10000, 30000, 50000, 100000];

  int? _selected;
  final _customController = TextEditingController();

  @override
  void dispose() {
    _customController.dispose();
    super.dispose();
  }

  void _selectPreset(int amount) {
    setState(() {
      _selected = amount;
      _customController.clear();
    });
  }

  int? get _effectiveAmount {
    final custom = int.tryParse(_customController.text.trim());
    if (custom != null && custom > 0) return custom;
    return _selected;
  }

  void _confirm() {
    final amount = _effectiveAmount;
    if (amount == null || amount < 100 || amount > 1000000) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('충전 금액은 100 ~ 1,000,000 GP 사이여야 합니다')),
      );
      return;
    }
    Navigator.of(context).pop(amount);
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 24,
        right: 24,
        top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.surfaceBorder,
                borderRadius: BorderRadius.circular(4),
              ),
            ),
          ),
          const SizedBox(height: 20),
          const Text(
            '포인트 충전',
            style: TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            '충전할 GP 금액을 선택해주세요 (데모 결제)',
            style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
          ),
          const SizedBox(height: 20),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: _presets.map((amount) {
              final isSelected =
                  _selected == amount && _customController.text.isEmpty;
              return GestureDetector(
                onTap: () => _selectPreset(amount),
                child: Container(
                  width: (MediaQuery.of(context).size.width - 48 - 10) / 2,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  decoration: BoxDecoration(
                    color: isSelected
                        ? AppColors.goldPrimary.withValues(alpha: 0.12)
                        : const Color(0xFFF5F5F5),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: isSelected
                          ? AppColors.goldPrimary
                          : Colors.transparent,
                      width: 1.5,
                    ),
                  ),
                  child: Text(
                    '${_formatAmount(amount)} GP',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: isSelected
                          ? AppColors.goldSecondary
                          : AppColors.textPrimary,
                    ),
                  ),
                ),
              );
            }).toList(),
          ),
          const SizedBox(height: 16),
          const Text(
            '직접 입력',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: AppColors.textSecondary,
            ),
          ),
          const SizedBox(height: 6),
          TextField(
            controller: _customController,
            keyboardType: TextInputType.number,
            style: const TextStyle(fontSize: 14),
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              hintText: '충전할 GP 금액 입력',
              filled: true,
              fillColor: const Color(0xFFF5F5F5),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: BorderSide.none,
              ),
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 14,
                vertical: 12,
              ),
            ),
          ),
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            height: 52,
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: AppColors.goldGradient,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Material(
                type: MaterialType.transparency,
                child: InkWell(
                  borderRadius: BorderRadius.circular(12),
                  onTap: _confirm,
                  child: const Center(
                    child: Text(
                      '충전하기',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 15,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _formatAmount(int amount) {
    final str = amount.toString();
    final buffer = StringBuffer();
    for (int i = 0; i < str.length; i++) {
      final posFromEnd = str.length - i;
      buffer.write(str[i]);
      if (posFromEnd > 1 && posFromEnd % 3 == 1) buffer.write(',');
    }
    return buffer.toString();
  }
}
