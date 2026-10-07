import '../../../core/network/api_client.dart';
import '../../../core/utils/format.dart';
import '../../shipping/domain/shipment.dart';
import '../domain/admin_forms.dart';
import '../domain/admin_models.dart';

/// `/admin/*` (ADMIN 권한). 서버가 매 요청마다 권한을 다시 확인한다(10003).
class AdminRepository {
  final ApiClient _api;

  const AdminRepository({ApiClient apiClient = const ApiClient()})
    : _api = apiClient;

  Future<AdminStats> stats() async =>
      AdminStats.fromJson(asMap(await _api.get('/admin/stats')));

  Future<AdminList<Shipment>> shipping({
    ShipmentStatus? status,
    int page = 1,
    int limit = 50,
  }) async {
    final q = [
      'page=$page',
      'limit=$limit',
      if (status != null) 'status=${status.code}',
    ].join('&');
    final data = asMap(await _api.get('/admin/shipping-requests?$q'));
    return AdminList(
      asMapList(data['items']).map(Shipment.fromJson).toList(),
      asInt(data['totalCount']),
    );
  }

  /// 발송 처리(송장 등록·수정).
  Future<void> ship(int id, ShipForm form) =>
      _api.patch('/admin/shipping-requests/$id', body: form.toJson());

  /// 배송 완료.
  Future<void> markDelivered(int id) =>
      _api.patch('/admin/shipping-requests/$id', body: {'status': 'DELIVERED'});

  Future<List<AdminGacha>> gachas() async {
    final data = asMap(await _api.get('/admin/gachas'));
    return asMapList(data['items']).map(AdminGacha.fromJson).toList();
  }

  Future<void> updateGacha(int id, {bool? active, int? totalStock}) =>
      _api.patch(
        '/admin/gachas/$id',
        body: {'active': ?active, 'totalStock': ?totalStock},
      );

  Future<List<AdminBanner>> banners() async {
    final data = asMap(await _api.get('/admin/banners'));
    return asMapList(data['items']).map(AdminBanner.fromJson).toList();
  }

  /// 생성·수정 응답에는 active·priority가 없어 목록을 다시 읽는다.
  Future<void> createBanner(BannerForm form) =>
      _api.post('/admin/banners', body: form.toJson());

  Future<void> updateBanner(int id, Map<String, dynamic> body) =>
      _api.patch('/admin/banners/$id', body: body);

  Future<AdminList<AdminPayment>> payments({
    String? status,
    int page = 1,
    int limit = 50,
  }) async {
    final q = [
      'page=$page',
      'limit=$limit',
      if (status != null) 'status=$status',
    ].join('&');
    final data = asMap(await _api.get('/admin/payments?$q'));
    return AdminList(
      asMapList(data['items']).map(AdminPayment.fromJson).toList(),
      asInt(data['totalCount']),
    );
  }
}
