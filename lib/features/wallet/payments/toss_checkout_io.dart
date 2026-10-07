import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:tosspayments_widget_sdk_flutter/model/payment_info.dart';
import 'package:tosspayments_widget_sdk_flutter/model/payment_widget_options.dart';
import 'package:tosspayments_widget_sdk_flutter/payment_widget.dart';
import 'package:tosspayments_widget_sdk_flutter/widgets/agreement.dart';
import 'package:tosspayments_widget_sdk_flutter/widgets/payment_method.dart';
import '../../../core/config/app_config.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/format.dart';
import '../../../shared/widgets/ui.dart';
import '../domain/payment_models.dart';
import 'payment_checkout.dart';

/// Android·iOS: 토스페이먼츠 결제위젯(웹뷰).
PaymentCheckout? createTossCheckout() {
  if (defaultTargetPlatform != TargetPlatform.android &&
      defaultTargetPlatform != TargetPlatform.iOS) {
    return null;
  }
  return const TossWidgetCheckout();
}

class TossWidgetCheckout implements PaymentCheckout {
  const TossWidgetCheckout();

  @override
  bool get isSandbox => false;

  @override
  Future<CheckoutResult> pay(BuildContext context, PaymentOrder order) async {
    if (order.clientKey == null || order.customerKey == null) {
      return const CheckoutFailed('CONFIG', '결제 설정을 불러오지 못했어요');
    }
    final result = await Navigator.of(context).push<CheckoutResult>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => TossCheckoutPage(order: order),
      ),
    );
    return result ?? const CheckoutCancelled();
  }
}

/// 결제수단·약관 위젯과 결제 버튼. 결과를 [CheckoutResult]로 돌려주며 닫힌다.
class TossCheckoutPage extends StatefulWidget {
  final PaymentOrder order;
  const TossCheckoutPage({super.key, required this.order});

  @override
  State<TossCheckoutPage> createState() => _TossCheckoutPageState();
}

class _TossCheckoutPageState extends State<TossCheckoutPage> {
  static const _methodsSelector = 'methods';
  static const _agreementSelector = 'agreement';

  late final PaymentWidget _widget = PaymentWidget(
    clientKey: widget.order.clientKey!,
    customerKey: widget.order.customerKey!,
  );
  AgreementWidgetControl? _agreement;
  bool _ready = false;
  bool _paying = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _widget
        .renderPaymentMethods(
          selector: _methodsSelector,
          amount: Amount(
            value: widget.order.amount,
            currency: Currency.KRW,
            country: 'KR',
          ),
        )
        .then((_) {
          if (mounted) setState(() => _ready = true);
        })
        .catchError((Object _) {
          if (mounted) setState(() => _error = '결제수단을 불러오지 못했어요');
        });
    _widget
        .renderAgreement(selector: _agreementSelector)
        .then<void>(
          (control) => _agreement = control,
          // 약관 위젯이 없어도 결제수단 위젯으로 결제는 진행된다.
          onError: (Object _) {},
        );
  }

  Future<void> _pay() async {
    if (_paying) return;
    final status = await _agreement?.getAgreementStatus();
    if (status != null && !status.agreedRequiredTerms) {
      if (mounted) showToast(context, '결제 약관에 동의해 주세요');
      return;
    }
    setState(() => _paying = true);
    try {
      final result = await _widget.requestPayment(
        paymentInfo: PaymentInfo(
          orderId: widget.order.orderId,
          orderName: widget.order.orderName,
          appScheme: '${AppConfig.appScheme}://',
        ),
      );
      if (!mounted) return;
      final success = result.success;
      final pending = result.pending;
      final fail = result.fail;
      final CheckoutResult outcome;
      if (success != null) {
        outcome = CheckoutSuccess(
          paymentKey: success.paymentKey,
          orderId: success.orderId,
          amount: success.amount.toInt(),
        );
      } else if (pending != null) {
        // 승인 대기 결제(해외 간편결제 등). 서버 확인에서 "확인 중"으로 나온다.
        outcome = CheckoutSuccess(
          paymentKey: pending.paymentKey,
          orderId: pending.orderId,
          amount: pending.amount.toInt(),
        );
      } else if (fail != null) {
        outcome = fail.errorCode == 'PAY_PROCESS_CANCELED'
            ? const CheckoutCancelled()
            : CheckoutFailed(fail.errorCode, fail.errorMessage);
      } else {
        outcome = const CheckoutCancelled();
      }
      Navigator.of(context).pop(outcome);
    } catch (_) {
      if (mounted) {
        setState(() => _paying = false);
        showToast(context, '결제창을 열지 못했어요. 다시 시도해 주세요');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final order = widget.order;
    return Scaffold(
      appBar: AppBar(titleSpacing: 0, title: const Text('결제')),
      body: ListView(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              Space.gutter,
              Space.x2,
              Space.gutter,
              Space.x4,
            ),
            child: SheetPanel(
              child: Column(
                children: [
                  InfoRow(label: '상품', value: order.orderName),
                  InfoRow(label: '받는 GP', value: formatGp(order.totalGp)),
                  InfoRow(
                    label: '결제 금액',
                    value: formatWon(order.amount),
                    valueStyle: AppText.num(
                      AppText.headline,
                    ).copyWith(color: AppColors.brand),
                  ),
                ],
              ),
            ),
          ),
          if (_error != null)
            ErrorView(
              message: _error!,
              onRetry: () => Navigator.of(context).pop(),
              height: 160,
            ),
          // 토스 위젯(웹뷰)은 자기 바탕색으로 그린다.
          PaymentMethodWidget(
            paymentWidget: _widget,
            selector: _methodsSelector,
          ),
          AgreementWidget(paymentWidget: _widget, selector: _agreementSelector),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            Space.gutter,
            Space.x2,
            Space.gutter,
            Space.x3,
          ),
          child: PrimaryButton(
            label: '${formatWon(order.amount)} 결제하기',
            loading: _paying,
            onPressed: _ready ? _pay : null,
          ),
        ),
      ),
    );
  }
}
