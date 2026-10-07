import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/core/theme/app_theme.dart';
import 'package:gacha_vault/features/auth/domain/agreements.dart';
import 'package:gacha_vault/features/auth/presentation/signup_page.dart';
import 'package:gacha_vault/shared/providers/auth_provider.dart';
import 'package:gacha_vault/shared/providers/gp_provider.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

http.Response ok(Object data, [int status = 200]) => http.Response(
  jsonEncode({'statusCode': 10000, 'message': 'success', 'data': data}),
  status,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('Agreements', () {
    test('필수 세 항목이 모두 있어야 allRequired', () {
      var a = const Agreements();
      expect(a.allRequired, isFalse);
      a = a
          .set(AgreementItem.terms, true)
          .set(AgreementItem.privacy, true)
          .set(AgreementItem.age14, true);
      expect(a.allRequired, isTrue);
      expect(a.all, isFalse, reason: '마케팅(선택)은 아직');
      expect(a.toJson(), {
        'agreeTerms': true,
        'agreePrivacy': true,
        'agreeAge14': true,
        'agreeMarketing': false,
      });
    });

    test('전체 동의는 모두 켜고, 모두 켜진 상태에서는 모두 끈다', () {
      final on = const Agreements().set(AgreementItem.terms, true).toggleAll();
      expect(on, const Agreements.all());
      expect(on.toggleAll(), const Agreements());
    });

    test('필수/선택 구분은 서버 DTO와 같다', () {
      expect(AgreementItem.values.where((i) => i.required).toList(), [
        AgreementItem.terms,
        AgreementItem.privacy,
        AgreementItem.age14,
      ]);
      expect(AgreementItem.marketing.required, isFalse);
    });
  });

  group('이메일 가입', () {
    late List<http.Request> requests;
    late AuthProvider auth;

    setUp(() {
      requests = [];
      auth = AuthProvider(
        apiClient: ApiClient(
          httpClient: MockClient((req) async {
            requests.add(req);
            switch (req.url.path) {
              case '/auth/signup':
                return ok({
                  'id': 9,
                  'email': 'new@ex.com',
                  'nickname': '새유저',
                  'welcomeGp': 3000,
                }, 201);
              case '/auth/login':
                return ok({'accessToken': 'jwt-new', 'expiresIn': 3600});
              case '/users/me':
                return ok({
                  'id': 9,
                  'email': 'new@ex.com',
                  'nickname': '새유저',
                  'coinBalance': 3000,
                  'role': 'USER',
                  'provider': 'EMAIL',
                  'marketingAgreed': false,
                });
            }
            return http.Response('{}', 404);
          }),
        ),
      );
    });

    Future<void> pumpSignup(WidgetTester tester) async {
      tester.view.physicalSize = const Size(1170, 2532);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider.value(value: auth),
            ChangeNotifierProxyProvider<AuthProvider, GpProvider>(
              create: (_) => GpProvider(),
              update: (_, a, gp) => gp!..syncFromUser(a.currentUser),
            ),
          ],
          child: MaterialApp(
            theme: AppTheme.vault,
            home: const Scaffold(body: SizedBox()),
            routes: {'/signup': (_) => const SignupPage()},
            initialRoute: '/signup',
          ),
        ),
      );
      await tester.pumpAndSettle();
    }

    Future<void> tapLabel(WidgetTester tester, String label) async {
      final target = find.bySemanticsLabel(label);
      await tester.ensureVisible(target);
      await tester.pump();
      await tester.tap(target);
      await tester.pump();
    }

    FilledButton submitButton(WidgetTester tester) => tester.widget(
      find.ancestor(
        of: find.text('동의하고 가입하기'),
        matching: find.byType(FilledButton),
      ),
    );

    testWidgets('필수 약관에 동의하기 전에는 가입 버튼이 잠겨 있다', (tester) async {
      await pumpSignup(tester);
      expect(submitButton(tester).onPressed, isNull);
      expect(find.text('필수 항목에 모두 동의해야 가입할 수 있어요.'), findsOneWidget);

      // 필수 두 개만 → 여전히 잠김.
      await tapLabel(tester, '필수 이용약관 동의');
      await tapLabel(tester, '필수 개인정보 수집·이용 동의');
      expect(submitButton(tester).onPressed, isNull);

      // 만 14세까지 → 열림.
      await tapLabel(tester, '필수 만 14세 이상이에요');
      expect(submitButton(tester).onPressed, isNotNull);

      // 전체 동의를 두 번 누르면 모두 꺼져 다시 잠긴다.
      await tapLabel(tester, '전체 동의');
      await tapLabel(tester, '전체 동의');
      expect(submitButton(tester).onPressed, isNull);
    });

    testWidgets('동의 항목을 가입 요청에 담고, 축하 GP를 한 번 꺼낼 수 있다', (tester) async {
      await pumpSignup(tester);
      await tester.enterText(
        find.widgetWithText(TextFormField, 'name@example.com'),
        'new@ex.com',
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, '영문·숫자 포함 8자 이상'),
        'Password1',
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, '2~20자'),
        '새유저',
      );
      await tapLabel(tester, '전체 동의');
      await tester.ensureVisible(find.text('동의하고 가입하기'));
      await tester.tap(find.text('동의하고 가입하기'));
      await tester.pumpAndSettle();

      final signup = requests.firstWhere((r) => r.url.path == '/auth/signup');
      expect(jsonDecode(signup.body), {
        'email': 'new@ex.com',
        'password': 'Password1',
        'nickname': '새유저',
        'agreeTerms': true,
        'agreePrivacy': true,
        'agreeAge14': true,
        'agreeMarketing': true,
      });
      expect(auth.isLoggedIn, isTrue);
      // 가입 화면이 닫히고 서버가 준 축하 GP로 축하 화면이 한 번 뜬다.
      expect(find.byType(SignupPage), findsNothing);
      expect(find.text('가입을 축하해요'), findsOneWidget);
      expect(find.text('3,000 GP'), findsWidgets);
      expect(auth.hasPendingWelcome, isFalse);
      expect(auth.takeWelcomeGp(), isNull, reason: '축하 화면은 한 번만');
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('gacha_vault_access_token'), 'jwt-new');
    });
  });
}
