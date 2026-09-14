import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/features/inventory/domain/inventory_item.dart';

void main() {
  InventoryItem item(String? status, {bool locked = false}) =>
      InventoryItem.fromJson({
        'inventoryItemId': 1,
        'status': status,
        'isLocked': locked,
      });
  test(
    'reference value stays in won and conversion uses only server snapshot',
    () {
      final value = InventoryItem.fromJson({
        'inventoryItemId': 1,
        'status': 'STORED',
        'estimatedValue': 10000,
        'conversionGP': 1000,
        'isPremium': false,
      });
      expect(value.formattedPrice, '10,000원');
      expect(value.conversionGP, 1000);
      expect(value.isPremium, isFalse);
      final missing = InventoryItem.fromJson({
        'inventoryItemId': 2,
        'status': 'STORED',
        'estimatedValue': 10000,
      });
      expect(missing.conversionGP, isNull);
      expect(missing.isPremium, isNull);
    },
  );
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
