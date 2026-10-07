import '../../../core/network/api_client.dart';
import '../../../core/utils/format.dart';
import '../domain/inventory_item.dart';

/// 보관함 API.
class InventoryRepository {
  final ApiClient _api;

  const InventoryRepository({ApiClient apiClient = const ApiClient()})
    : _api = apiClient;

  /// 기본 목록은 서버가 EXCHANGED를 제외하고 준다.
  Future<List<InventoryItem>> list({InventoryStatus? status}) async {
    final query = [
      'page=1',
      'limit=100',
      if (status != null) 'status=${status.code}',
    ];
    final data = asMap(await _api.get('/inventory?${query.join('&')}'));
    return asMapList(data['items'])
        .map(InventoryItem.fromJson)
        // 구버전 서버는 EXCHANGED를 거르지 않을 수 있으니 한 번 더 거른다.
        .where((i) => status != null || i.status != InventoryStatus.exchanged)
        .toList();
  }

  /// 선택한 보관 상품을 GP로 전환한다.
  Future<ExchangeResult> exchange(List<int> inventoryItemIds) async {
    final data = await _api.post(
      '/inventory/exchange',
      body: {'inventoryItemIds': inventoryItemIds},
    );
    return ExchangeResult.fromJson(asMap(data));
  }

  /// 배송 신청 (`POST /shipping-requests`). 배송비는 서버가 GP에서 차감한다.
  Future<void> requestShipping({
    required String recipientName,
    required String phone,
    required String address,
    String? notes,
    required List<int> inventoryItemIds,
  }) async {
    await _api.post(
      '/shipping-requests',
      body: {
        'recipientName': recipientName,
        'phone': phone,
        'address': address,
        if (notes != null && notes.isNotEmpty) 'notes': notes,
        'inventoryItemIds': inventoryItemIds,
      },
    );
  }
}
