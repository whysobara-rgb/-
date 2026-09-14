import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/features/inventory/domain/inventory_item.dart';

class PagedInventoryApi extends ApiClient {
  final List<Map<String, dynamic>> pages;
  final paths = <String>[];
  PagedInventoryApi(this.pages);
  @override
  Future<dynamic> get(String path) async {
    paths.add(path);
    return pages[paths.length - 1];
  }
}
Map<String, dynamic> page(int number, List<int> ids, int total) => {
  'page': number, 'limit': 2, 'totalCount': total,
  'items': ids.map((id) => {'inventoryItemId': id, 'status': 'STORED'}).toList(),
};
void main() {
  test('loads all pages and preserves status filter', () async {
    final api = PagedInventoryApi([page(1, [1, 2], 3), page(2, [3], 3)]);
    final items = await InventoryRepository(apiClient: api)
        .getAll(status: InventoryStatus.stored);
    expect(items.map((i) => i.id), ['1', '2', '3']);
    expect(api.paths.last, '/inventory?page=2&limit=100&status=STORED');
  });
  test('rejects duplicate pages instead of returning incomplete inventory', () async {
    final api = PagedInventoryApi([page(1, [1, 2], 3), page(2, [2], 3)]);
    await expectLater(InventoryRepository(apiClient: api).getAll(),
        throwsA(isA<ApiException>()));
  });
  test('rejects truncated intermediate pages', () async {
    final api = PagedInventoryApi([page(1, [1], 3)]);
    await expectLater(InventoryRepository(apiClient: api).getAll(),
        throwsA(isA<ApiException>()));
  });
}
