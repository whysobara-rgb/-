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
  testWidgets('detail opens without selecting and supports zoom reset', (tester) async {
    tester.view.physicalSize = const Size(320, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    var selections = 0;
    await tester.pumpWidget(MaterialApp(home: Scaffold(body:
      SingleChildScrollView(child: CollectionCard(
        item: InventoryItem(id: '2', name: '확대할 상품', grade: 'A',
          price: 200, icon: Icons.card_giftcard, status: InventoryStatus.stored,
          acquiredAt: DateTime(2026, 9, 14)),
        selected: false, onSelect: () => selections++, onLock: () {},
      )))));
    await tester.tap(find.text('크게 보기'));
    await tester.pumpAndSettle();
    expect(find.text('컬렉션 상세'), findsOneWidget);
    expect(selections, 0);
    await tester.tap(find.text('2배 확대'));
    await tester.pump();
    final viewer = tester.widget<InteractiveViewer>(find.byType(InteractiveViewer));
    expect(viewer.transformationController!.value.getMaxScaleOnAxis(), 2);
    await tester.tap(find.text('원래 크기'));
    await tester.pump();
    expect(viewer.transformationController!.value.getMaxScaleOnAxis(), 1);
    expect(tester.takeException(), isNull);
  });
}
