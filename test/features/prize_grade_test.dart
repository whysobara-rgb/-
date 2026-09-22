import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/features/orders/order_models.dart';
import 'package:gacha_vault/features/inventory/domain/inventory_item.dart';

void main() {
  test('purchase and inventory use the same grades without changing raw rarity', () {
    for (final entry in {'N': 'B', 'R': 'A', 'SR': 'S', 'SSR': 'SSS'}.entries) {
      final prize = Prize({'itemId': 1, 'name': '상품', 'rarity': entry.key,
        'conversionGP': 0, 'probabilityPpm': 1000000, 'isPremium': false});
      final item = InventoryItem.fromJson({'inventoryItemId': 1,
        'rarity': entry.key, 'status': 'STORED'});
      expect(prize.displayGrade, entry.value);
      expect(prize.displayGrade, item.grade);
      expect(prize.rarity, entry.key);
    }
  });
}
