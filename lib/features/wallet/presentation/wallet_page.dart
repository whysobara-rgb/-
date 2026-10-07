import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/format.dart';
import '../../../navigation/tab_navigator.dart';
import '../../../shared/providers/auth_provider.dart';
import '../../../shared/providers/gp_provider.dart';
import '../../../shared/widgets/ui.dart';
import '../data/wallet_repository.dart';
import '../domain/point_history.dart';
import '../domain/topup_limit.dart';
import 'point_history_page.dart';
import 'widgets/history_row.dart';
import 'widgets/limit_sheet.dart';
import 'widgets/topup_sheet.dart';

/// 충전 탭: 보유 GP, 충전, 월 충전 한도, 최근 내역.
class WalletPage extends StatefulWidget {
  const WalletPage({super.key});

  @override
  State<WalletPage> createState() => _WalletPageState();
}

class _WalletPageState extends State<WalletPage> {
  static const _repository = WalletRepository();

  List<PointHistoryEntry> _recent = const [];
  TopupLimit? _limit;
  bool _loadingHistory = true;
  bool _toppingUp = false;
  int _seenRevision = -1;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    await Future.wait([_loadHistory(), _loadLimit()]);
  }

  Future<void> _loadHistory() async {
    try {
      final items = await _repository.history(limit: 5);
      if (!mounted) return;
      setState(() {
        _recent = items;
        _loadingHistory = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loadingHistory = false);
    }
  }

  Future<void> _loadLimit() async {
    try {
      final limit = await _repository.limit();
      if (mounted) setState(() => _limit = limit);
    } catch (_) {
      // 구버전 서버: 한도 영역만 숨긴다.
    }
  }

  Future<void> _topup() async {
    final balance = context.read<GpProvider>().balance;
    final amount = await showTopupSheet(
      context,
      balance: balance,
      limit: _limit,
    );
    if (amount == null || !mounted) return;

    setState(() => _toppingUp = true);
    try {
      final after = await _repository.topup(amount);
      if (!mounted) return;
      final auth = context.read<AuthProvider>();
      if (after != null) {
        auth.applyBalance(after);
      } else {
        await auth.refreshProfile();
      }
      if (!mounted) return;
      showToast(context, '${formatGp(amount)}를 충전했어요');
    } on ApiException catch (e) {
      if (mounted) showToast(context, e.displayMessage);
    } finally {
      if (mounted) setState(() => _toppingUp = false);
      _refresh();
    }
  }

  Future<void> _editLimit() async {
    final current = _limit;
    if (current == null) return;
    final updated = await showLimitSheet(context, current);
    if (updated == null || !mounted) return;
    setState(() => _limit = updated);
    final pending = updated.pending;
    showToast(
      context,
      pending?.effectiveAt != null
          ? '${formatMonthDay(pending!.effectiveAt!)}부터 적용돼요'
          : '한도를 바꿨어요',
    );
  }

  @override
  Widget build(BuildContext context) {
    final balance = context.watch<GpProvider>().balance;
    // 탭에 다시 들어오면 내역을 새로 고친다.
    final revision = context.select<TabNavigator, int>(
      (t) => t.revisionOf(AppTab.wallet),
    );
    if (revision != _seenRevision) {
      final first = _seenRevision == -1;
      _seenRevision = revision;
      if (!first) {
        WidgetsBinding.instance.addPostFrameCallback((_) => _refresh());
      }
    }

    return Scaffold(
      appBar: AppBar(title: const Text('충전')),
      body: RefreshIndicator(
        color: AppColors.ink,
        onRefresh: _refresh,
        child: ListView(
          padding: const EdgeInsets.only(bottom: Space.x10),
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                Space.gutter,
                Space.x2,
                Space.gutter,
                Space.x6,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('보유 GP', style: AppText.callout),
                  const SizedBox(height: Space.x1),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.baseline,
                    textBaseline: TextBaseline.alphabetic,
                    children: [
                      Text(
                        formatNumber(balance),
                        style: AppText.num(AppText.display),
                      ),
                      const SizedBox(width: 4),
                      Text(
                        'GP',
                        style: AppText.title2.copyWith(
                          color: AppColors.inkSecondary,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: Space.x5),
                  PrimaryButton(
                    label: '충전하기',
                    loading: _toppingUp,
                    onPressed: _topup,
                  ),
                ],
              ),
            ),
            if (_limit != null) ...[
              const SectionBand(),
              _LimitSection(limit: _limit!, onEdit: _editLimit),
            ],
            const SectionBand(),
            SectionHeader(
              title: '최근 내역',
              actionLabel: '전체 보기',
              onAction: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => const PointHistoryPage(),
                ),
              ),
            ),
            if (_loadingHistory)
              const LoadingView(height: 160)
            else if (_recent.isEmpty)
              const EmptyView(
                icon: Icons.receipt_long_outlined,
                title: '아직 내역이 없어요',
                height: 160,
              )
            else
              for (var i = 0; i < _recent.length; i++) ...[
                if (i > 0) const Hairline(inset: Space.gutter),
                HistoryRow(entry: _recent[i]),
              ],
          ],
        ),
      ),
    );
  }
}

class _LimitSection extends StatelessWidget {
  final TopupLimit limit;
  final VoidCallback onEdit;

  const _LimitSection({required this.limit, required this.onEdit});

  @override
  Widget build(BuildContext context) {
    final pending = limit.pending;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        Space.gutter,
        Space.x6,
        Space.gutter,
        Space.x6,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(child: Text('월 충전 한도', style: AppText.title2)),
              OutlinedButton(
                onPressed: onEdit,
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(0, 32),
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  textStyle: AppText.callout.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
                child: Text(limit.hasLimit ? '변경' : '설정'),
              ),
            ],
          ),
          const SizedBox(height: Space.x3),
          if (limit.hasLimit) ...[
            Row(
              crossAxisAlignment: CrossAxisAlignment.baseline,
              textBaseline: TextBaseline.alphabetic,
              children: [
                Text(
                  formatWon(limit.usedThisMonth),
                  style: AppText.num(AppText.headline),
                ),
                Text(
                  ' / ${formatWon(limit.monthlyLimit!)}',
                  style: AppText.num(AppText.callout),
                ),
                const Spacer(),
                Text(
                  '남은 한도 ${formatWon(limit.remainingThisMonth ?? 0)}',
                  style: AppText.num(
                    AppText.callout,
                  ).copyWith(color: AppColors.ink, fontWeight: FontWeight.w600),
                ),
              ],
            ),
            const SizedBox(height: Space.x2),
            ClipRRect(
              borderRadius: const BorderRadius.all(Radius.circular(2)),
              child: LinearProgressIndicator(
                value: limit.usedRatio,
                minHeight: 6,
                color: limit.usedRatio >= 1
                    ? AppColors.negative
                    : AppColors.ink,
                backgroundColor: AppColors.bgMuted,
              ),
            ),
            const SizedBox(height: Space.x2),
            Text('이번 달 충전한 금액이에요. 매월 1일에 다시 시작해요.', style: AppText.caption),
          ] else ...[
            Text(
              '설정 안 함 · 이번 달 ${formatWon(limit.usedThisMonth)} 충전',
              style: AppText.num(AppText.body),
            ),
            const SizedBox(height: Space.x1),
            Text('한 달에 충전할 수 있는 금액에 상한을 정해 둘 수 있어요.', style: AppText.caption),
          ],
          if (pending != null) ...[
            const SizedBox(height: Space.x3),
            Container(
              padding: const EdgeInsets.symmetric(
                horizontal: Space.x3,
                vertical: 10,
              ),
              decoration: const BoxDecoration(
                color: AppColors.bgSubtle,
                borderRadius: Radii.button,
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.schedule,
                    size: 16,
                    color: AppColors.inkSecondary,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      _pendingText(pending),
                      style: AppText.num(
                        AppText.caption,
                      ).copyWith(color: AppColors.ink),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  static String _pendingText(PendingLimit p) {
    final when = p.effectiveAt != null
        ? '${formatMonthDay(p.effectiveAt!)}부터'
        : '7일 뒤부터';
    return p.monthlyLimit == null
        ? '$when 한도가 해제돼요'
        : '$when ${formatWon(p.monthlyLimit!)}으로 바뀌어요';
  }
}
