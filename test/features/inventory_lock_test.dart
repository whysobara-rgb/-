import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/features/inventory/domain/inventory_item.dart';

class LockApi extends ApiClient {
  Map<String, dynamic>? sentBody;
  String? sentPath;
  dynamic response;
  @override
  Future<dynamic> put(String path, {required Map<String, dynamic> body}) async {
    sentPath = path;
    sentBody = body;
    return response;
  }
}

void main() {
  final item = InventoryItem.fromJson({
    'inventoryItemId': 7,
    'status': 'STORED',
  });
  test('sends a desired state and verifies the returned item', () async {
    final api = LockApi()..response = {'inventoryItemId': 7, 'isLocked': true};
    await InventoryRepository(apiClient: api).setLock(item, locked: true);
    expect(api.sentPath, '/inventory/7/lock');
    expect(api.sentBody, {'locked': true});
  });
  test(
    'does not report success when the backend returns another item or state',
    () async {
      final api = LockApi()
        ..response = {'inventoryItemId': 8, 'isLocked': true};
      await expectLater(
        InventoryRepository(apiClient: api).setLock(item, locked: true),
        throwsA(isA<ApiException>()),
      );
    },
  );
}
