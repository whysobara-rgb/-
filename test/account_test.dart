import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/core/theme/app_theme.dart';
import 'package:gacha_vault/features/inventory/data/inventory_repository.dart';
import 'package:gacha_vault/features/profile/presentation/delete_account_page.dart';
import 'package:gacha_vault/navigation/tab_navigator.dart';
import 'package:gacha_vault/shared/providers/auth_provider.dart';
import 'package:gacha_vault/shared/providers/gp_provider.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

http.Response ok(Object? data) => http.Response(
  jsonEncode({'statusCode': 10000, 'message': 'success', 'data': data}),
  200,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

Map<String, dynamic> me({bool marketing = false, String nickname = '탈퇴예정'}) => {
  'id': 21,
  'email': 'bye@ex.com',
  'nickname': nickname,
  'coinBalance': 4200,
  'provider': 'EMAIL',
  'role': 'USER',
  'marketingAgreed': marketing,
};

void main() {
  setUp(
    () => SharedPreferences.setMockInitialValues({
      'flutter.gacha_vault_access_token': 'jwt',
    }),
  );

  test('프로필 수정은 바꾼 값만 PATCH로 보내고 응답으로 사용자 정보를 바꾼다', () async {
    final bodies = <String>[];
    final auth = AuthProvider(
      apiClient: ApiClient(
        httpClient: MockClient((req) async {
          if (req.method == 'PATCH') {
            bodies.add(req.body);
            return ok(me(marketing: true, nickname: '새이름'));
          }
          return ok(me());
        }),
      ),
    );
    await auth.tryAutoLogin();
    expect(auth.currentUser!.marketingAgreed, isFalse);

    await auth.updateProfile(agreeMarketing: true);
    await auth.updateProfile(nickname: '  새이름 ');
    expect(bodies, ['{"agreeMarketing":true}', '{"nickname":"새이름"}']);
    expect(auth.currentUser!.marketingAgreed, isTrue);
    expect(auth.currentUser!.nickname, '새이름');
  });

  group('회원 탈퇴', () {
    late List<String> calls;
    late http.Response deleteResponse;
    late AuthProvider auth;
    late ApiClient api;

    setUp(() {
      calls = [];
      deleteResponse = ok({'deleted': true, 'forfeitedGp': 4200});
      auth = AuthProvider(
        apiClient: api = ApiClient(
          httpClient: MockClient((req) async {
            calls.add('${req.method} ${req.url.path}');
            if (req.method == 'DELETE') return deleteResponse;
            if (req.url.path == '/inventory') {
              return ok({
                'items': [
                  {
                    'inventoryItemId': 1,
                    'name': '에어팟 프로',
                    'rarity': 'SR',
                    'estimatedValue': 359000,
                    'status': 'STORED',
                    'acquiredAt': '2026-10-01T00:00:00Z',
                  },
                  {
                    'inventoryItemId': 2,
                    'name': '배송 중 상품',
                    'rarity': 'R',
                    'estimatedValue': 10000,
                    'status': 'SHIPPING',
                    'acquiredAt': '2026-10-01T00:00:00Z',
                  },
                ],
              });
            }
            return ok(me());
          }),
        ),
      );
    });

    Future<void> pumpPage(WidgetTester tester) async {
      tester.view.physicalSize = const Size(1170, 2532);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      await auth.tryAutoLogin();
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider.value(value: auth),
            ChangeNotifierProvider(create: (_) => TabNavigator()),
            ChangeNotifierProxyProvider<AuthProvider, GpProvider>(
              create: (_) => GpProvider(),
              update: (_, a, gp) => gp!..syncFromUser(a.currentUser),
            ),
          ],
          child: MaterialApp(
            theme: AppTheme.vault,
            home: const Scaffold(body: Text('home')),
            routes: {
              '/delete': (_) => DeleteAccountPage(
                inventory: InventoryRepository(apiClient: api),
              ),
            },
            initialRoute: '/delete',
          ),
        ),
      );
      await tester.pumpAndSettle();
    }

    FilledButton deleteButton(WidgetTester tester) => tester.widget(
      find.ancestor(of: find.text('탈퇴하기'), matching: find.byType(FilledButton)),
    );

    testWidgets('사라질 GP·상품을 보여주고, 확인과 한 번 더 묻기를 거쳐야 탈퇴한다', (tester) async {
      await pumpPage(tester);
      expect(find.text('4,200 GP'), findsOneWidget);
      expect(find.text('1개'), findsOneWidget, reason: '보관 중인 상품만 센다');
      expect(deleteButton(tester).onPressed, isNull);

      await tester.tap(find.bySemanticsLabel('위 내용을 확인했어요'));
      await tester.pump();
      expect(deleteButton(tester).onPressed, isNotNull);

      await tester.ensureVisible(find.text('탈퇴하기'));
      await tester.tap(find.text('탈퇴하기'));
      await tester.pumpAndSettle();
      expect(find.text('정말 탈퇴할까요?'), findsOneWidget);
      expect(calls.where((c) => c.startsWith('DELETE')), isEmpty);

      await tester.tap(find.text('탈퇴'));
      await tester.pumpAndSettle();
      expect(calls, contains('DELETE /users/me'));
      expect(find.text('탈퇴했어요'), findsOneWidget);
      expect(find.textContaining('4,200 GP가 소멸됐고'), findsOneWidget);

      await tester.tap(find.text('확인'));
      await tester.pumpAndSettle();
      expect(auth.isLoggedIn, isFalse);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('gacha_vault_access_token'), isNull);
    });

    testWidgets('배송 중이면(10013) 막고 건수를 알려준다', (tester) async {
      deleteResponse = http.Response(
        jsonEncode({
          'statusCode': 10013,
          'message': 'Account has shipments in progress',
          'errors': ['activeShipments:2'],
        }),
        409,
      );
      await pumpPage(tester);
      await tester.tap(find.bySemanticsLabel('위 내용을 확인했어요'));
      await tester.pump();
      await tester.ensureVisible(find.text('탈퇴하기'));
      await tester.tap(find.text('탈퇴하기'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('탈퇴'));
      await tester.pumpAndSettle();
      expect(find.text('배송 중인 신청 2건이 있어 지금은 탈퇴할 수 없어요'), findsOneWidget);
      expect(auth.isLoggedIn, isTrue);
    });
  });
}
