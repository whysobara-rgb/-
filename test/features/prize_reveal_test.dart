import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/features/orders/order_models.dart';
import 'package:gacha_vault/features/orders/prize_reveal.dart';

void main() {
  Prize fixture() => Prize({
    'itemId': 1, 'name': '테스트 컬렉션', 'rarity': 'A',
    'conversionGP': 100, 'probabilityPpm': 1000000,
    'isPremium': true,
  });

  testWidgets('skip finishes presentation and keeps the confirmed prize', (tester) async {
    await tester.pumpWidget(MaterialApp(home: Scaffold(
      body: SingleChildScrollView(child: PrizeReveal(prize: fixture())))));
    expect(find.text('연출 건너뛰기'), findsOneWidget);
    await tester.tap(find.text('연출 건너뛰기'));
    await tester.pump();
    expect(find.text('연출 건너뛰기'), findsNothing);
    expect(find.text('테스트 컬렉션'), findsOneWidget);
    expect(find.text('내 보관함에 저장 완료'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('reduced motion shows the result immediately on a narrow screen', (tester) async {
    tester.view.physicalSize = const Size(320, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(MaterialApp(home: MediaQuery(
      data: const MediaQueryData(disableAnimations: true,
        textScaler: TextScaler.linear(1.5)),
      child: Scaffold(body: SingleChildScrollView(
        child: PrizeReveal(prize: fixture()))))));
    expect(find.text('연출 건너뛰기'), findsNothing);
    expect(find.text('테스트 컬렉션'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  testWidgets('failed product image preserves confirmed result and fallback', (tester) async {
    final prize = Prize({'itemId': 1, 'name': '이미지 실패 상품', 'rarity': 'SSR',
      'conversionGP': 100, 'probabilityPpm': 1000000, 'isPremium': true,
      'imageUrl': 'https://example.invalid/product.png'});
    await tester.pumpWidget(MaterialApp(home: Scaffold(
      body: SingleChildScrollView(child: PrizeReveal(prize: prize)))));
    await tester.pumpAndSettle();
    expect(find.text('이미지 실패 상품'), findsOneWidget);
    expect(find.text('SSS'), findsOneWidget);
    expect(find.byIcon(Icons.card_giftcard_rounded), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
