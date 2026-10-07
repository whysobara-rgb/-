import '../../../core/network/api_client.dart';
import '../../../core/utils/format.dart';
import '../domain/point_history.dart';
import '../domain/topup_limit.dart';

/// `/wallet/*`: GP 내역과 월 충전 한도.
///
/// 충전은 [PaymentRepository](토스페이먼츠)만 쓴다. 데모 충전
/// `POST /wallet/topup`은 앱에서 부르지 않는다.
class WalletRepository {
  final ApiClient _api;
  const WalletRepository({ApiClient apiClient = const ApiClient()})
    : _api = apiClient;

  Future<List<PointHistoryEntry>> history({
    PointHistoryType? type,
    int limit = 100,
  }) async {
    final query = [
      'page=1',
      'limit=$limit',
      if (type != null) 'type=${type.code}',
    ];
    final data = asMap(
      await _api.get('/wallet/point-history?${query.join('&')}'),
    );
    return asMapList(data['items']).map(PointHistoryEntry.fromJson).toList();
  }

  Future<TopupLimit> limit() async =>
      TopupLimit.fromJson(asMap(await _api.get('/wallet/limit')));

  /// null이면 한도 해제. 낮추면 즉시, 올리거나 해제하면 7일 뒤 적용.
  Future<TopupLimit> setLimit(int? monthlyLimit) async => TopupLimit.fromJson(
    asMap(
      await _api.put('/wallet/limit', body: {'monthlyLimit': monthlyLimit}),
    ),
  );
}
