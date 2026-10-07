import 'dart:math';

import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/utils/format.dart';
import '../../features/wallet/domain/payment_models.dart';
import '../../features/wallet/payments/payment_checkout.dart';
import '../../shared/widgets/ui.dart';

/// 체험판 결제창. 토스 결제위젯 대신 "실제로 결제되지 않아요" 확인 시트를
/// 띄우고, 확인하면 체험용 paymentKey로 승인(`/payments/confirm`)을 탄다.
/// 승인·보너스 계산은 DemoBackend가 서버 규칙대로 한다.
class DemoCheckout implements PaymentCheckout {
  const DemoCheckout();

  /// 테스트 결제(샌드박스)와는 다르다. 화면 문구는 DemoConfig로 고른다.
  @override
  bool get isSandbox => false;

  @override
  Future<CheckoutResult> pay(BuildContext context, PaymentOrder order) async {
    final ok = await showAppSheet<bool>(
      context: context,
      title: '체험판 결제',
      builder: (_) => _DemoPaySheet(order: order),
    );
    if (ok != true) return const CheckoutCancelled();
    final rng = Random.secure();
    final suffix = List.generate(
      12,
      (_) => rng.nextInt(256).toRadixString(16).padLeft(2, '0'),
    ).join();
    return CheckoutSuccess(
      paymentKey: 'demo_$suffix',
      orderId: order.orderId,
      amount: order.amount,
    );
  }
}

class _DemoPaySheet extends StatelessWidget {
  final PaymentOrder order;
  const _DemoPaySheet({required this.order});

  @override
  Widget build(BuildContext context) {
    const amber = Color(0xFFFFC53D);
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
            padding: const EdgeInsets.all(Space.x4),
            decoration: BoxDecoration(
              color: amber.withValues(alpha: 0.12),
              borderRadius: Radii.button,
              border: Border.all(color: amber.withValues(alpha: 0.7)),
            ),
            child: Row(
              children: [
                const Icon(Icons.science_outlined, color: amber, size: 26),
                const SizedBox(width: Space.x3),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '체험판 결제 · 실제로 결제되지 않아요',
                        style: AppText.bodyStrong.copyWith(
                          color: AppColors.text,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        keepAll(
                          '카드·계좌 정보를 받지 않고 돈도 나가지 않아요. '
                          '체험 GP만 들어와요.',
                        ),
                        style: AppText.caption,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: Space.x4),
          SheetPanel(
            child: Column(
              children: [
                InfoRow(label: '주문', value: order.orderName),
                InfoRow(
                  label: '결제 금액',
                  value: '${formatWon(order.amount)} (청구 안 됨)',
                ),
                InfoRow(label: '충전 GP', value: formatGp(order.gp)),
                if (order.bonusGp > 0)
                  InfoRow(
                    label: '대량 보너스',
                    value: '+${formatGp(order.bonusGp)}',
                  ),
                if (order.firstTopupBonusGp > 0)
                  InfoRow(
                    label: '첫 충전 보너스',
                    value: '+${formatGp(order.firstTopupBonusGp)}',
                  ),
                InfoRow(
                  label: '받는 GP',
                  value: formatGp(order.totalGp),
                  valueStyle: AppText.num(
                    AppText.bodyStrong,
                  ).copyWith(color: AppColors.brand),
                ),
              ],
            ),
          ),
          const SizedBox(height: Space.x4),
          PrimaryButton(
            label: '체험 결제하기 (0원)',
            onPressed: () => Navigator.of(context).pop(true),
          ),
          const SizedBox(height: Space.x2),
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('취소'),
          ),
        ],
      ),
    );
  }
}
