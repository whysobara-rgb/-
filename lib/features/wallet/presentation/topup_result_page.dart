import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/format.dart';
import '../../../shared/providers/auth_provider.dart';
import 'widgets/gp_celebration.dart';
import '../../../shared/widgets/ui.dart';
import '../data/payment_repository.dart';
import '../domain/payment_confirmer.dart';
import '../domain/payment_models.dart';
import '../payments/payment_checkout.dart';
import 'payment_history_page.dart';

/// 결제창이 끝난 뒤: 서버 승인을 기다렸다가(재시도 포함) 결과를 보여준다.
///
/// 결과는 `true`(GP가 들어옴)로 닫힌다. 보여주는 숫자는 모두 서버 응답이다.
class TopupResultPage extends StatefulWidget {
  final CheckoutSuccess payment;
  final PaymentOrder order;
  final PaymentRepository repository;

  /// 테스트용 재시도 간격.
  final List<Duration> backoff;

  const TopupResultPage({
    super.key,
    required this.payment,
    required this.order,
    this.repository = const PaymentRepository(),
    this.backoff = PaymentConfirmer.defaultBackoff,
  });

  @override
  State<TopupResultPage> createState() => _TopupResultPageState();
}

class _TopupResultPageState extends State<TopupResultPage> {
  ConfirmOutcome? _outcome;
  int _attempt = 0;
  int _maxAttempts = 1;

  @override
  void initState() {
    super.initState();
    _confirm();
  }

  Future<void> _confirm() async {
    setState(() {
      _outcome = null;
      _attempt = 0;
    });
    final confirmer = PaymentConfirmer(
      confirm: () => widget.repository.confirm(
        paymentKey: widget.payment.paymentKey,
        orderId: widget.payment.orderId,
        amount: widget.payment.amount,
      ),
      backoff: widget.backoff,
      onAttempt: (attempt, max) {
        if (mounted) {
          setState(() {
            _attempt = attempt;
            _maxAttempts = max;
          });
        }
      },
    );
    final outcome = await confirmer.run();
    if (!mounted) return;
    if (outcome is ConfirmDone) {
      final auth = context.read<AuthProvider>();
      final after = outcome.receipt.balanceAfter;
      if (after != null) {
        auth.applyBalance(after);
      } else {
        await auth.refreshProfile();
      }
    }
    if (mounted) setState(() => _outcome = outcome);
  }

  @override
  Widget build(BuildContext context) {
    final outcome = _outcome;
    final done = outcome is ConfirmDone;
    return PopScope(
      canPop: outcome != null,
      child: Scaffold(
        appBar: AppBar(
          automaticallyImplyLeading: false,
          title: const Text('충전'),
          actions: [
            if (outcome != null)
              IconButton(
                tooltip: '닫기',
                onPressed: () => Navigator.of(context).pop(done),
                icon: const Icon(Icons.close),
              ),
          ],
        ),
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              Space.gutter,
              0,
              Space.gutter,
              Space.x4,
            ),
            child: switch (outcome) {
              null => _Confirming(attempt: _attempt, maxAttempts: _maxAttempts),
              ConfirmDone(:final receipt) => _Done(receipt: receipt),
              ConfirmPending() => _Pending(
                onRetry: _confirm,
                onHistory: () => Navigator.of(context).pushReplacement(
                  MaterialPageRoute<void>(
                    builder: (_) => const PaymentHistoryPage(),
                  ),
                ),
              ),
              ConfirmFailed(:final message) => _Failed(
                message: message,
                onClose: () => Navigator.of(context).pop(false),
              ),
            },
          ),
        ),
      ),
    );
  }
}

class _Confirming extends StatelessWidget {
  final int attempt;
  final int maxAttempts;
  const _Confirming({required this.attempt, required this.maxAttempts});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(
            width: 28,
            height: 28,
            child: CircularProgressIndicator(
              strokeWidth: 2.4,
              color: AppColors.brand,
            ),
          ),
          const SizedBox(height: Space.x5),
          Text('결제를 확인하고 있어요', style: AppText.title2),
          const SizedBox(height: Space.x2),
          Text(
            attempt > 1
                ? '토스 응답을 기다리는 중이에요 · 다시 확인 $attempt/$maxAttempts'
                : '화면을 닫지 말고 잠시만 기다려 주세요',
            style: AppText.num(AppText.callout),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

class _Done extends StatelessWidget {
  final PaymentReceipt receipt;
  const _Done({required this.receipt});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Spacer(),
        GpCelebration(
          amount: receipt.totalGp,
          eyebrow: 'TOP-UP COMPLETE',
          title: '충전했어요',
        ),
        const SizedBox(height: Space.x6),
        SheetPanel(
          child: Column(
            children: [
              InfoRow(label: '충전 GP', value: formatGp(receipt.gp)),
              if (receipt.bonusGp > 0)
                InfoRow(
                  label: '대량 충전 보너스',
                  value: '+${formatGp(receipt.bonusGp)}',
                ),
              if (receipt.firstTopupBonusGp > 0)
                InfoRow(
                  label: '첫 충전 보너스',
                  value: '+${formatGp(receipt.firstTopupBonusGp)}',
                  valueStyle: AppText.num(
                    AppText.bodyStrong,
                  ).copyWith(color: AppColors.brand),
                ),
              const Hairline(),
              InfoRow(
                label: '받은 GP',
                value: formatGp(receipt.totalGp),
                valueStyle: AppText.num(
                  AppText.headline,
                ).copyWith(color: AppColors.brand),
              ),
              InfoRow(label: '결제 금액', value: formatWon(receipt.amount)),
              if (receipt.balanceAfter != null)
                InfoRow(
                  label: '충전 후 보유',
                  value: formatGp(receipt.balanceAfter!),
                ),
            ],
          ),
        ),
        const Spacer(),
        PrimaryButton(
          label: '확인',
          onPressed: () => Navigator.of(context).pop(true),
        ),
      ],
    );
  }
}

class _Pending extends StatelessWidget {
  final VoidCallback onRetry;
  final VoidCallback onHistory;
  const _Pending({required this.onRetry, required this.onHistory});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Spacer(),
        const _StateIcon(icon: Icons.hourglass_top, color: AppColors.text),
        const SizedBox(height: Space.x5),
        Text(
          '결제 승인을 기다리고 있어요',
          style: AppText.title2,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: Space.x2),
        Text(
          '토스에서 아직 승인 결과가 오지 않았어요. 승인되면 GP가 들어오고, '
          '승인되지 않으면 결제되지 않아요. 잠시 후 다시 확인해 주세요.',
          style: AppText.callout,
          textAlign: TextAlign.center,
        ),
        const Spacer(),
        PrimaryButton(label: '다시 확인', onPressed: onRetry),
        const SizedBox(height: Space.x2),
        OutlinedButton(onPressed: onHistory, child: const Text('결제 내역 보기')),
      ],
    );
  }
}

class _Failed extends StatelessWidget {
  final String message;
  final VoidCallback onClose;
  const _Failed({required this.message, required this.onClose});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Spacer(),
        const _StateIcon(icon: Icons.close_rounded, color: AppColors.danger),
        const SizedBox(height: Space.x5),
        Text('결제하지 못했어요', style: AppText.title2, textAlign: TextAlign.center),
        const SizedBox(height: Space.x2),
        Text(
          message,
          style: AppText.body.copyWith(color: AppColors.text),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: Space.x1),
        Text(
          'GP는 들어오지 않았어요. 결제 내역에서 상태를 확인할 수 있어요.',
          style: AppText.callout,
          textAlign: TextAlign.center,
        ),
        const Spacer(),
        PrimaryButton(label: '확인', onPressed: onClose),
      ],
    );
  }
}

class _StateIcon extends StatelessWidget {
  final IconData icon;
  final Color color;
  const _StateIcon({required this.icon, required this.color});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        width: 72,
        height: 72,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: color.withValues(alpha: 0.08),
          border: Border.all(color: color.withValues(alpha: 0.4)),
        ),
        child: Icon(icon, size: 32, color: color),
      ),
    );
  }
}
