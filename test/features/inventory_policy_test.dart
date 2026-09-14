import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/features/inventory/domain/inventory_item.dart';

void main() {
  InventoryItem item(String? status, {bool locked = false}) =>
      InventoryItem.fromJson({
        'inventoryItemId': 1,
        'status': status,
        'isLocked': locked,
      });
  test('lock blocks conversion but preserves shipping eligibility', () {
    expect(item('STORED', locked: true).canShip, isTrue);
    expect(item('STORED', locked: true).canConvert, isFalse);
    expect(item('STORED').canConvert, isTrue);
  });
  test('unknown and completed states cannot be treated as stored items', () {
    for (final status in [
      null,
      'CONVERTED',
      'SHIPPING_REQUESTED',
      'SHIPPING',
      'DELIVERED',
    ]) {
      expect(item(status).canShip, isFalse);
      expect(item(status).canConvert, isFalse);
    }
  });
}
