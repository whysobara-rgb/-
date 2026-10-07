import 'package:flutter/widgets.dart';
import '../../../core/config/app_config.dart';
import '../domain/payment_models.dart';
import 'sandbox_checkout.dart';
import 'toss_checkout_stub.dart'
    if (dart.library.io) 'toss_checkout_io.dart'
    as toss;

/// 결제창 결과.
sealed class CheckoutResult {
  const CheckoutResult();
}

/// 결제창이 승인 요청을 마쳤다. 서버 승인(`/payments/confirm`) 전이다.
class CheckoutSuccess extends CheckoutResult {
  final String paymentKey;
  final String orderId;
  final int amount;
  const CheckoutSuccess({
    required this.paymentKey,
    required this.orderId,
    required this.amount,
  });
}

/// 결제창에서 실패했다(카드사 거절 등). 서버로 가지 않았다.
class CheckoutFailed extends CheckoutResult {
  final String code;
  final String message;
  const CheckoutFailed(this.code, this.message);
}

class CheckoutCancelled extends CheckoutResult {
  const CheckoutCancelled();
}

/// 결제창 하나. 모바일은 토스 결제위젯, 디버그 샌드박스는 테스트 결제.
abstract class PaymentCheckout {
  /// 테스트 결제인지(화면에 표시한다).
  bool get isSandbox;

  Future<CheckoutResult> pay(BuildContext context, PaymentOrder order);
}

/// 이 빌드에서 쓸 결제창. 없으면 null(웹 등) → "결제는 앱에서 가능해요".
///
/// [AppConfig.paymentSandbox]는 release에서 상수 false라 샌드박스 코드는
/// 릴리스 번들에 들어가지 않는다.
PaymentCheckout? resolveCheckout() {
  if (AppConfig.paymentSandbox) return const SandboxCheckout();
  return toss.createTossCheckout();
}
