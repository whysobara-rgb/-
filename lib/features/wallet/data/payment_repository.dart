import '../../../core/network/api_client.dart';
import '../../../core/utils/format.dart';
import '../domain/payment_models.dart';

/// `/payments/*` (토스페이먼츠 GP 충전).
class PaymentRepository {
  final ApiClient _api;

  const PaymentRepository({ApiClient apiClient = const ApiClient()})
    : _api = apiClient;

  Future<PaymentConfig> config() async =>
      PaymentConfig.fromJson(asMap(await _api.get('/payments/config')));

  /// 패키지로 주문을 만든다. 월 한도를 넘으면 10007(errors에 remaining:N).
  Future<PaymentOrder> createOrder(String packageId) async =>
      PaymentOrder.fromJson(
        asMap(
          await _api.post('/payments/orders', body: {'packageId': packageId}),
        ),
      );

  /// 결제위젯 성공 뒤 승인. 10015면 같은 값으로 다시 부르면 된다.
  Future<PaymentReceipt> confirm({
    required String paymentKey,
    required String orderId,
    required int amount,
  }) async => PaymentReceipt.fromJson(
    asMap(
      await _api.post(
        '/payments/confirm',
        body: {'paymentKey': paymentKey, 'orderId': orderId, 'amount': amount},
      ),
    ),
  );

  /// 내 결제 내역(최근 50건, 결제 대기 제외).
  Future<List<PaymentReceipt>> orders() async {
    final data = asMap(await _api.get('/payments/orders'));
    return asMapList(data['items']).map(PaymentReceipt.fromJson).toList();
  }
}
