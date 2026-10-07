import '../../../core/network/api_client.dart';
import 'payment_models.dart';

/// 결제 승인 결과.
sealed class ConfirmOutcome {
  const ConfirmOutcome();
}

/// 승인되고 GP가 들어왔다.
class ConfirmDone extends ConfirmOutcome {
  final PaymentReceipt receipt;
  const ConfirmDone(this.receipt);
}

/// 여러 번 물어봐도 결과가 아직 없다(10015·네트워크). 결제는 됐을 수도
/// 있으므로 실패라고 말하지 않는다. 같은 값으로 다시 확인할 수 있다.
class ConfirmPending extends ConfirmOutcome {
  final int attempts;
  const ConfirmPending(this.attempts);
}

/// 승인되지 않았다(10014 카드 거절 등). GP는 들어오지 않았다.
class ConfirmFailed extends ConfirmOutcome {
  final String message;
  final int? code;
  const ConfirmFailed(this.message, {this.code});
}

/// `POST /payments/confirm`을 같은 값으로 재시도한다.
///
/// - 성공 → [ConfirmDone]
/// - 10015 "확인 중"(errors에 toss:pending/toss:unavailable) 또는 서버에 닿지
///   못한 경우 → [backoff] 간격으로 다시 부른다. 서버는 같은 주문을 여러 번
///   승인해도 GP를 한 번만 주고 결과만 돌려준다.
/// - 다 써도 결과가 없으면 → [ConfirmPending]
/// - 10014 등 그 밖의 오류 → 바로 [ConfirmFailed]
class PaymentConfirmer {
  /// 같은 paymentKey·orderId·amount로 승인을 부르는 함수.
  final Future<PaymentReceipt> Function() confirm;

  /// 재시도 사이 대기. 길이 + 1이 최대 호출 수.
  final List<Duration> backoff;

  /// 테스트에서 시간을 건너뛰게 바꾼다.
  final Future<void> Function(Duration) sleep;

  /// 몇 번째 시도를 시작하는지 화면에 알린다(1부터).
  final void Function(int attempt, int maxAttempts)? onAttempt;

  PaymentConfirmer({
    required this.confirm,
    this.backoff = defaultBackoff,
    Future<void> Function(Duration)? sleep,
    this.onAttempt,
  }) : sleep = sleep ?? Future<void>.delayed;

  static const defaultBackoff = [
    Duration(seconds: 1),
    Duration(seconds: 2),
    Duration(seconds: 4),
    Duration(seconds: 8),
  ];

  int get maxAttempts => backoff.length + 1;

  Future<ConfirmOutcome> run() async {
    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      onAttempt?.call(attempt, maxAttempts);
      try {
        return ConfirmDone(await confirm());
      } on ApiException catch (e) {
        if (!isRetryable(e)) {
          return ConfirmFailed(e.displayMessage, code: e.statusCode);
        }
        if (attempt < maxAttempts) await sleep(backoff[attempt - 1]);
      }
    }
    return ConfirmPending(maxAttempts);
  }

  /// 결과를 아직 모르는 오류인지.
  ///
  /// 10015는 "결제 미설정"에도 쓰인다. 그때는 errors에 toss:*가 없어 바로
  /// 실패로 본다.
  static bool isRetryable(ApiException e) {
    if (e.isNetwork) return true;
    if (e.statusCode != ApiCode.paymentPending) return false;
    return e.errors.any((err) => err.startsWith('toss:'));
  }
}
