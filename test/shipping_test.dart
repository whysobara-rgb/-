import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/core/domain/rarity.dart';
import 'package:gacha_vault/core/theme/app_theme.dart';
import 'package:gacha_vault/features/shipping/domain/shipment.dart';
import 'package:gacha_vault/features/shipping/presentation/shipments_page.dart';

const shipped = {
  'shippingRequestId': 12,
  'recipientName': '홍길동',
  'phone': '010-1234-5678',
  'address': '서울시 중구 세종대로 1',
  'notes': null,
  'status': 'SHIPPING',
  'trackingCompany': 'CJ대한통운',
  'trackingNumber': '123456789012',
  'shippedAt': '2026-10-08T01:00:00.000Z',
  'deliveredAt': null,
  'items': [
    {'inventoryItemId': 3, 'itemId': 7, 'name': '에어팟 프로 2', 'rarity': 'SR'},
    {'inventoryItemId': 4, 'itemId': 8, 'name': '스타벅스 아메리카노', 'rarity': 'N'},
  ],
  'createdAt': '2026-10-07T01:00:00.000Z',
};

void main() {
  test('배송 신청을 읽고 송장·요약·전화번호 가림을 만든다', () {
    final s = Shipment.fromJson(shipped);
    expect(s.id, 12);
    expect(s.status, ShipmentStatus.shipping);
    expect(s.status.step, 1);
    expect(s.hasTracking, isTrue);
    expect(s.itemSummary, '에어팟 프로 2 외 1개');
    expect(s.items.first.rarity, Rarity.sr);
    expect(s.maskedPhone, '010-****-5678');
    expect(s.isActive, isTrue);

    final old = Shipment.fromJson({'id': 1, 'status': 'weird'});
    expect(old.status, ShipmentStatus.requested);
    expect(old.hasTracking, isFalse);
    expect(old.itemSummary, '상품 정보 없음');
  });

  testWidgets('카드는 단계와 송장번호를 보여주고 복사할 수 있다', (tester) async {
    String? copied;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'Clipboard.setData') {
          copied = (call.arguments as Map)['text'] as String;
        }
        return null;
      },
    );
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.vault,
        home: Scaffold(
          body: SingleChildScrollView(
            child: ShipmentCard(shipment: Shipment.fromJson(shipped)),
          ),
        ),
      ),
    );
    expect(find.text('배송 중'), findsOneWidget);
    expect(find.text('CJ대한통운'), findsOneWidget);
    expect(find.text('123456789012'), findsOneWidget);
    expect(find.text('배송 신청'), findsOneWidget);
    expect(find.text('배송 완료'), findsOneWidget);
    await tester.tap(find.text('복사'));
    await tester.pump();
    expect(copied, '123456789012');
    expect(find.text('송장번호를 복사했어요'), findsOneWidget);
  });
}
