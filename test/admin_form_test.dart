import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/core/theme/app_theme.dart';
import 'package:gacha_vault/core/utils/format.dart';
import 'package:gacha_vault/features/admin/data/admin_repository.dart';
import 'package:gacha_vault/features/admin/domain/admin_forms.dart';
import 'package:gacha_vault/features/admin/domain/admin_models.dart';
import 'package:gacha_vault/features/admin/presentation/admin_shipping_tab.dart';
import 'package:gacha_vault/features/shipping/domain/shipment.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('ShipForm', () {
    test('택배사·송장번호가 없으면 막는다', () {
      final errors = const ShipForm(
        company: ' ',
        trackingNumber: '',
      ).validate();
      expect(errors.keys, containsAll(['company', 'trackingNumber']));
    });

    test('송장번호는 숫자·영문·하이픈만, 50자까지', () {
      expect(
        const ShipForm(
          company: 'CJ대한통운',
          trackingNumber: '1234 5678',
        ).validate().keys,
        ['trackingNumber'],
      );
      expect(
        ShipForm(company: 'CJ대한통운', trackingNumber: '1' * 51).validate().keys,
        ['trackingNumber'],
      );
      const ok = ShipForm(
        company: ' CJ대한통운 ',
        trackingNumber: '6012-3456-7890',
      );
      expect(ok.validate(), isEmpty);
      expect(ok.toJson(), {
        'status': 'SHIPPING',
        'trackingCompany': 'CJ대한통운',
        'trackingNumber': '6012-3456-7890',
      });
    });
  });

  test('회차 수량은 판매된 수보다 작을 수 없다', () {
    expect(validateTotalStock('', soldCount: 10), '수량을 입력해 주세요');
    expect(validateTotalStock('abc', soldCount: 10), '숫자만 입력해 주세요');
    expect(validateTotalStock('9', soldCount: 10), contains('10개보다 적게'));
    expect(validateTotalStock('10', soldCount: 10), isNull);
    expect(validateTotalStock('3000', soldCount: 10), isNull);
  });

  group('BannerForm', () {
    BannerForm valid() => BannerForm(
      title: '그랜드 오픈',
      accentColorHex: '#2fe0a2',
      linkType: AdminLinkType.gacha,
      linkTarget: '1',
      priority: '0',
    );

    test('올바른 입력은 통과하고, 비운 선택 항목은 null로 보낸다', () {
      final f = valid();
      expect(f.validate(boxIds: {1, 2}), isEmpty);
      final json = f.toJson();
      expect(json['title'], '그랜드 오픈');
      expect(json['subtitle'], isNull);
      expect(json['badge'], isNull);
      expect(json['accentColorHex'], '#2FE0A2');
      expect(json['linkType'], 'GACHA');
      expect(json['linkTarget'], '1');
      expect(json['priority'], 0);
      expect(json['startsAt'], isNull);
    });

    test('제목·색·우선순위 형식을 확인한다', () {
      final f = valid()
        ..title = '  '
        ..accentColorHex = 'green'
        ..priority = '1.5';
      expect(
        f.validate().keys,
        containsAll(['title', 'accentColorHex', 'priority']),
      );
      expect((valid()..badge = 'x' * 31).validate().keys, ['badge']);
      expect((valid()..accentColorHex = '#2FE0A2CC').validate(), isEmpty);
    });

    test('링크 종류마다 대상 규칙이 다르다', () {
      expect(
        (valid()..linkTarget = '').validate()['linkTarget'],
        '연결할 박스를 골라 주세요',
      );
      expect(
        (valid()..linkTarget = '99').validate(boxIds: {1, 2})['linkTarget'],
        '없는 박스예요',
      );
      expect(
        (valid()..linkTarget = 'abc').validate()['linkTarget'],
        '박스 번호(숫자)를 넣어 주세요',
      );
      final odds = valid()
        ..linkType = AdminLinkType.odds
        ..linkTarget = '';
      expect(odds.validate(), isEmpty, reason: '확률은 비우면 목록');
      final url = valid()
        ..linkType = AdminLinkType.url
        ..linkTarget = 'http://example.com';
      expect(url.validate()['linkTarget'], 'https://로 시작하는 주소를 넣어 주세요');
      url.linkTarget = 'https://example.com/event';
      expect(url.validate(), isEmpty);

      final none = valid()
        ..linkType = AdminLinkType.topup
        ..linkTarget = '3';
      expect(none.validate(), isEmpty);
      expect(none.toJson()['linkTarget'], isNull, reason: '대상이 없는 종류');
    });

    test('종료 시각은 시작 시각보다 뒤', () {
      final f = valid()
        ..startsAt = DateTime(2026, 10, 10)
        ..endsAt = DateTime(2026, 10, 9);
      expect(f.validate()['endsAt'], isNotNull);
      f.endsAt = DateTime(2026, 10, 11);
      expect(f.validate(), isEmpty);
      expect(f.toJson()['startsAt'], endsWith('Z'));
    });

    test('기존 배너에서 폼을 채운다', () {
      final b = AdminBanner.fromJson({
        'id': 3,
        'title': '애플 박스',
        'subtitle': null,
        'badge': 'NEW',
        'accentColorHex': '#1A1A1A',
        'link': {'type': 'ODDS', 'target': '6'},
        'priority': 2,
        'active': false,
      });
      final f = BannerForm.from(b);
      expect(f.linkType, AdminLinkType.odds);
      expect(f.linkTarget, '6');
      expect(f.priority, '2');
      expect(f.active, isFalse);
    });
  });

  test('색 코드를 ARGB로 바꾼다', () {
    expect(parseHexArgb('#2FE0A2'), 0xFF2FE0A2);
    expect(parseHexArgb('#2FE0A280'), 0x802FE0A2);
    expect(parseHexArgb('2FE0A2'), isNull);
  });

  test('대시보드 지표를 읽는다', () {
    final s = AdminStats.fromJson({
      'today': {'revenue': '10000', 'payingUsers': 1, 'draws': 4},
      'month': {'revenue': 30000},
      'total': {'gpOutstanding': 123456, 'users': 7},
      'actionRequired': {'shipmentsToSend': 2, 'paymentsToReview': 1},
    });
    expect(s.todayRevenue, 10000);
    expect(s.monthRevenue, 30000);
    expect(s.gpOutstanding, 123456);
    expect(s.shipmentsToSend, 2);
    expect(s.shipmentsInTransit, 0);
  });

  testWidgets('발송 시트: 입력 오류는 보내기 전에, 서버 오류는 시트 안에 보여준다', (tester) async {
    final bodies = <Map<String, dynamic>>[];
    final repo = AdminRepository(
      apiClient: ApiClient(
        httpClient: MockClient((req) async {
          bodies.add(jsonDecode(req.body) as Map<String, dynamic>);
          return http.Response(
            jsonEncode({
              'statusCode': 10005,
              'message': 'Cannot move a DELIVERED shipment to SHIPPING',
              'errors': [],
            }),
            409,
          );
        }),
      ),
    );
    final shipment = Shipment.fromJson({
      'shippingRequestId': 5,
      'status': 'REQUESTED',
      'recipientName': '홍길동',
      'phone': '01012345678',
      'address': '서울',
      'items': [
        {'inventoryItemId': 1, 'name': '에어팟', 'rarity': 'SR'},
      ],
    });
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.vault,
        home: Scaffold(
          body: ShipSheet(shipment: shipment, repository: repo),
        ),
      ),
    );

    await tester.tap(find.text('발송 처리'));
    await tester.pump();
    expect(find.text('택배사를 골라 주세요'), findsOneWidget);
    expect(find.text('송장번호를 입력해 주세요'), findsOneWidget);
    expect(bodies, isEmpty);

    await tester.tap(find.text('CJ대한통운'));
    await tester.enterText(find.byType(TextField), '123456789012');
    await tester.tap(find.text('발송 처리'));
    await tester.pumpAndSettle();
    expect(bodies.single, {
      'status': 'SHIPPING',
      'trackingCompany': 'CJ대한통운',
      'trackingNumber': '123456789012',
    });
    expect(
      find.text(keepAll('지금 상태(배송 완료)에서는 배송 중(으)로 바꿀 수 없어요')),
      findsOneWidget,
    );
  });
}
