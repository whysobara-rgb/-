import '../../../core/network/api_client.dart';
import '../../../core/utils/format.dart';
import '../domain/shipment.dart';

/// 내 배송 신청 (`GET /shipping-requests`).
class ShippingRepository {
  final ApiClient _api;

  const ShippingRepository({ApiClient apiClient = const ApiClient()})
    : _api = apiClient;

  Future<List<Shipment>> list({int page = 1, int limit = 50}) async {
    final data = asMap(
      await _api.get('/shipping-requests?page=$page&limit=$limit'),
    );
    return asMapList(data['items']).map(Shipment.fromJson).toList();
  }
}
