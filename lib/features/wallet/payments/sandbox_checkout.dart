import 'dart:math';
import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/format.dart';
import '../../../shared/widgets/ui.dart';
import '../domain/payment_models.dart';
import 'payment_checkout.dart';

/// 디버그 전용 테스트 결제(`PAYMENT_SANDBOX=true`, release에서는 빠진다).
///
/// 토스 결제창 대신 테스트용 paymentKey를 만들어 서버 승인 흐름을 그대로
/// 탄다. 로컬 가짜 토스 서버는 접두사로 결과를 정한다.
/// `pk_ok_` 승인 · `pk_decline_` 거절 · `pk_slow_` 응답 지연(확인 중 → 재시도).
/// 실제 토스 키로 붙은 서버는 이 키를 승인하지 않는다.
class SandboxCheckout implements PaymentCheckout {
  const SandboxCheckout();

  @override
  bool get isSandbox => true;

  @override
  Future<CheckoutResult> pay(BuildContext context, PaymentOrder order) async {
    final prefix = await showAppSheet<String>(
      context: context,
      title: '테스트 결제',
      builder: (sheet) => _SandboxSheet(order: order),
    );
    if (prefix == null) return const CheckoutCancelled();
    final suffix = List.generate(
      2,
      (_) => Random().nextInt(0x7fffffff).toRadixString(16).padLeft(8, '0'),
    ).join();
    return CheckoutSuccess(
      paymentKey: '$prefix$suffix',
      orderId: order.orderId,
      amount: order.amount,
    );
  }
}

class _SandboxSheet extends StatelessWidget {
  final PaymentOrder order;
  const _SandboxSheet({required this.order});

  @override
  Widget build(BuildContext context) {
    Widget choice(
      String prefix,
      String label,
      String hint, {
      bool primary = false,
    }) {
      final style = primary
          ? FilledButton.styleFrom(minimumSize: const Size(0, 48))
          : null;
      final child = Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label),
          Text(
            hint,
            style: AppText.micro.copyWith(
              color: primary ? AppColors.onBrand.withValues(alpha: 0.7) : null,
            ),
          ),
        ],
      );
      return Padding(
        padding: const EdgeInsets.only(bottom: Space.x2),
        child: SizedBox(
          height: 56,
          child: primary
              ? FilledButton(
                  onPressed: () => Navigator.of(context).pop(prefix),
                  style: style,
                  child: child,
                )
              : OutlinedButton(
                  onPressed: () => Navigator.of(context).pop(prefix),
                  child: child,
                ),
        ),
      );
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(
        Space.gutter,
        0,
        Space.gutter,
        Space.x4,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.all(Space.x3),
            decoration: BoxDecoration(
              color: AppColors.danger.withValues(alpha: 0.08),
              borderRadius: Radii.button,
              border: Border.all(
                color: AppColors.danger.withValues(alpha: 0.4),
              ),
            ),
            child: Text(
              'PAYMENT_SANDBOX 디버그 빌드에서만 보이는 화면이에요. 실제 결제 없이 '
              '테스트 paymentKey로 서버 승인을 확인해요.',
              style: AppText.caption.copyWith(color: AppColors.text),
            ),
          ),
          const SizedBox(height: Space.x4),
          SheetPanel(
            child: Column(
              children: [
                InfoRow(label: '주문', value: order.orderName),
                InfoRow(label: '결제 금액', value: formatWon(order.amount)),
              ],
            ),
          ),
          const SizedBox(height: Space.x4),
          choice('pk_ok_', '승인', 'pk_ok_…', primary: true),
          choice('pk_decline_', '카드 거절', 'pk_decline_…'),
          choice('pk_slow_', '응답 지연', 'pk_slow_… · 확인 중 → 재시도'),
        ],
      ),
    );
  }
}
