import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/format.dart';
import '../../../demo/demo_config.dart';
import '../../../navigation/tab_navigator.dart';
import '../../../shared/providers/gp_provider.dart';
import '../../../shared/widgets/gp_badge.dart';
import '../../../shared/widgets/ui.dart';
import '../../../shared/widgets/vault_art.dart';
import '../data/payment_repository.dart';
import '../data/wallet_repository.dart';
import '../domain/payment_models.dart';
import '../domain/point_history.dart';
import '../domain/topup_limit.dart';
import '../payments/payment_checkout.dart';
import 'payment_history_page.dart';
import 'point_history_page.dart';
import 'topup_result_page.dart';
import 'widgets/history_row.dart';
import 'widgets/limit_sheet.dart';
import 'widgets/topup_sheet.dart';

/// 충전 탭: 보유 GP, 충전(토스페이먼츠), 월 충전 한도, 최근 내역.
///
/// 충전은 `/payments/*`만 쓴다. 서버에 결제가 설정돼 있지 않으면(enabled
/// false) 충전을 막고, 데모 충전(`POST /wallet/topup`)으로 대신하지 않는다.
class WalletPage extends StatefulWidget {
  const WalletPage({super.key});

  @override
  State<WalletPage> createState() => _WalletPageState();
}

class _WalletPageState extends State<WalletPage> {
  static const _repository = WalletRepository();
  static const _payments = PaymentRepository();

  List<PointHistoryEntry> _recent = const [];
  TopupLimit? _limit;
  PaymentConfig? _config;
  String? _configError;
  bool _loadingHistory = true;
  bool _toppingUp = false;
  int _seenRevision = -1;

  /// 이 빌드의 결제창(웹이면 null).
  final PaymentCheckout? _checkout = resolveCheckout();

  CheckoutMode get _mode => DemoConfig.enabled
      ? CheckoutMode.demo
      : _checkout == null
      ? CheckoutMode.unavailable
      : _checkout.isSandbox
      ? CheckoutMode.sandbox
      : CheckoutMode.toss;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    await Future.wait([_loadHistory(), _loadLimit(), _loadConfig()]);
  }

  Future<PaymentConfig?> _loadConfig() async {
    try {
      final config = await _payments.config();
      if (mounted) {
        setState(() {
          _config = config;
          _configError = null;
        });
      }
      return config;
    } on ApiException catch (e) {
      if (mounted) setState(() => _configError = e.displayMessage);
      return null;
    }
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
    if (_toppingUp) return;
    setState(() => _toppingUp = true);
    try {
      await _runTopup();
    } finally {
      if (mounted) setState(() => _toppingUp = false);
      _refresh();
    }
  }

  Future<void> _runTopup() async {
    final config = _config ?? await _loadConfig();
    if (!mounted) return;
    if (config == null) {
      showToast(context, _configError ?? '충전 정보를 불러오지 못했어요');
      return;
    }
    if (!config.enabled) {
      showToast(context, '지금은 충전할 수 없어요');
      return;
    }
    final package = await showTopupSheet(
      context,
      config: config,
      balance: context.read<GpProvider>().balance,
      limit: _limit,
      mode: _mode,
    );
    final checkout = _checkout;
    if (package == null || checkout == null || !mounted) return;

    final PaymentOrder order;
    try {
      order = await _payments.createOrder(package.id);
    } on ApiException catch (e) {
      if (mounted) showToast(context, e.displayMessage);
      return;
    }
    if (!mounted) return;

    final result = await checkout.pay(context, order);
    if (!mounted) return;
    switch (result) {
      case CheckoutCancelled():
        showToast(context, '결제를 취소했어요');
      case CheckoutFailed(:final message):
        showToast(context, message);
      case CheckoutSuccess():
        await Navigator.of(context).push<bool>(
          MaterialPageRoute(
            fullscreenDialog: true,
            builder: (_) => TopupResultPage(payment: result, order: order),
          ),
        );
    }
  }

  Future<void> _editLimit() async {
    final current = _limit;
    if (current == null) return;
    final updated = await showLimitSheet(context, current);
    if (updated == null || !mounted) return;
    setState(() => _limit = updated);
    showToast(context, updated.savedMessage);
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
      // 홈 배너(TOPUP)에서 왔으면 기존 충전 흐름을 그대로 연다.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && context.read<TabNavigator>().consumeTopupRequest()) {
          _topup();
        }
      });
    }

    return Scaffold(
      appBar: AppBar(title: const Text('충전')),
      body: RefreshIndicator(
        color: AppColors.text,
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
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _BalanceCard(balance: balance),
                  const SizedBox(height: Space.x4),
                  PrimaryButton(
                    label: _config?.enabled == false ? '지금은 충전할 수 없어요' : '충전하기',
                    loading: _toppingUp,
                    onPressed: _config?.enabled == false ? null : _topup,
                  ),
                  _TopupHint(config: _config, mode: _mode),
                ],
              ),
            ),
            if (_limit != null) ...[
              const SectionBand(),
              _LimitSection(limit: _limit!, onEdit: _editLimit),
            ],
            const SectionBand(),
            MenuRow(
              icon: Icons.credit_card_outlined,
              label: '결제 내역',
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => const PaymentHistoryPage(),
                ),
              ),
            ),
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
                  style: AppText.num(AppText.callout).copyWith(
                    color: AppColors.text,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
            const SizedBox(height: Space.x2),
            ClipRRect(
              borderRadius: const BorderRadius.all(Radius.circular(2)),
              child: LinearProgressIndicator(
                value: limit.usedRatio,
                minHeight: 6,
                color: limit.usedRatio >= 1 ? AppColors.danger : AppColors.text,
                backgroundColor: AppColors.high,
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
                color: AppColors.surface,
                borderRadius: Radii.button,
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.schedule,
                    size: 16,
                    color: AppColors.textSecondary,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      _pendingText(pending),
                      style: AppText.num(
                        AppText.caption,
                      ).copyWith(color: AppColors.text),
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

/// 보유 GP 카드: 표면 그라데이션 + 기요셰 + 브랜드 빛.
class _BalanceCard extends StatelessWidget {
  final int balance;
  const _BalanceCard({required this.balance});

  @override
  Widget build(BuildContext context) {
    return AspectRatio(
      aspectRatio: 1.75,
      child: Container(
        decoration: BoxDecoration(
          borderRadius: Radii.hero,
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              AppColors.raised,
              AppColors.surface,
              Color.lerp(AppColors.surface, AppColors.brand, 0.08)!,
            ],
            stops: const [0, 0.55, 1],
          ),
          border: Border.all(color: AppColors.hairlineStrong),
          boxShadow: [
            BoxShadow(
              color: AppColors.brand.withValues(alpha: 0.12),
              blurRadius: 30,
              offset: const Offset(0, 10),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: Radii.hero,
          child: Stack(
            fit: StackFit.expand,
            children: [
              CustomPaint(
                painter: GuillochePainter(
                  color: AppColors.brand,
                  opacity: 0.07,
                  rings: 36,
                  center: const Offset(1.02, 0.1),
                  scale: 1.7,
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 18, 20, 18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const GpCoin(size: 22),
                        const SizedBox(width: 8),
                        Text(
                          '보유 GP',
                          style: AppText.callout.copyWith(
                            color: AppColors.text,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const Spacer(),
                        Text('1 GP = 1원', style: AppText.caption),
                      ],
                    ),
                    const Spacer(),
                    FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerLeft,
                      child: Text.rich(
                        TextSpan(
                          children: [
                            TextSpan(text: formatNumber(balance)),
                            const TextSpan(
                              text: ' GP',
                              style: TextStyle(
                                fontSize: 20,
                                color: AppColors.brand,
                              ),
                            ),
                          ],
                        ),
                        style: AppText.numeral.copyWith(fontSize: 42),
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '뽑기·배송비에 쓰고, 받은 상품을 전환하면 다시 쌓여요',
                      style: AppText.caption,
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

/// 충전 버튼 아래 한 줄: 결제 불가 사유, 웹 안내, 첫 충전 보너스.
class _TopupHint extends StatelessWidget {
  final PaymentConfig? config;
  final CheckoutMode mode;
  const _TopupHint({required this.config, required this.mode});

  @override
  Widget build(BuildContext context) {
    final c = config;
    final (IconData, String, Color)? hint;
    if (mode == CheckoutMode.demo) {
      hint = (
        Icons.science_outlined,
        c != null && c.firstTopupEligible
            ? '체험 결제 · 실제로 결제되지 않아요 · 첫 충전 +${c.firstTopupBonus!.percent}%'
            : '체험 결제 · 실제로 결제되지 않아요',
        AppColors.text,
      );
    } else if (c != null && !c.enabled) {
      hint = (
        Icons.block,
        '결제가 아직 준비되지 않았어요. 잠시 후 다시 확인해 주세요.',
        AppColors.textSecondary,
      );
    } else if (mode == CheckoutMode.unavailable) {
      hint = (
        Icons.phone_iphone,
        '결제는 앱에서 가능해요. 웹에서는 패키지만 볼 수 있어요.',
        AppColors.textSecondary,
      );
    } else if (c != null && c.firstTopupEligible) {
      final b = c.firstTopupBonus!;
      hint = (
        Icons.auto_awesome,
        '첫 충전 보너스 +${b.percent}% · 최대 ${formatGp(b.maxGp)}',
        AppColors.brand,
      );
    } else {
      hint = null;
    }
    if (hint == null) return const SizedBox.shrink();
    final (icon, text, color) = hint;
    return Padding(
      padding: const EdgeInsets.only(top: Space.x3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, size: 15, color: color),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              text,
              style: AppText.num(AppText.caption).copyWith(color: color),
            ),
          ),
        ],
      ),
    );
  }
}
