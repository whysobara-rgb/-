import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/features/inventory/domain/inventory_item.dart';
import 'package:gacha_vault/features/inventory/presentation/collection_card.dart';

void main() {
  testWidgets('delivered collection cannot be selected or locked', (tester) async {
    var calls = 0;
    await tester.pumpWidget(MaterialApp(home: Scaffold(body:
      SingleChildScrollView(child: SizedBox(width: 180, child: CollectionCard(
        item: InventoryItem(id: '1', name: '긴 이름의 컬렉션 상품',
          grade: 'A', price: 100, icon: Icons.card_giftcard,
          status: InventoryStatus.delivered, acquiredAt: DateTime(2026)),
        selected: false, onSelect: () => calls++, onLock: () => calls++,
      ))))));
    expect(tester.widget<Checkbox>(find.byType(Checkbox)).onChanged, isNull);
    expect(tester.widget<IconButton>(find.byType(IconButton)).onPressed, isNull);
    expect(find.text('배송완료'), findsOneWidget);
    expect(calls, 0);
    expect(tester.takeException(), isNull);
  });
}
