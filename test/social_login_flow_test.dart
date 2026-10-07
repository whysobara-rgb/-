import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/core/theme/app_theme.dart';
import 'package:gacha_vault/features/auth/domain/agreements.dart';
import 'package:gacha_vault/features/auth/domain/social_login_result.dart';
import 'package:gacha_vault/features/auth/presentation/login_page.dart';
import 'package:gacha_vault/features/auth/social/social_auth_client.dart';
import 'package:gacha_vault/features/auth/social/social_auth_clients.dart';
import 'package:gacha_vault/shared/providers/auth_provider.dart';
import 'package:gacha_vault/shared/providers/gp_provider.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// SDK 대신 정해진 토큰(또는 취소·실패)을 돌려주는 가짜 제공자.
class FakeSocialClient implements SocialAuthClient {
  @override
  final SocialProvider provider;
  @override
  final bool isAvailable;
  final String token;
  final String? nickname;
  final Object? error;
  int signInCalls = 0;
  int signOutCalls = 0;

  FakeSocialClient(
    this.provider, {
    this.isAvailable = true,
    this.token = 'provider-token-0001',
    this.nickname,
    this.error,
  });

  @override
  Future<SocialCredential> signIn(BuildContext context) async {
    signInCalls++;
    if (error != null) throw error!;
    return SocialCredential(token: token, nickname: nickname);
  }

  @override
  Future<void> signOut() async => signOutCalls++;
}

http.Response envelope(
  int code,
  Object? data, {
  String? message,
  List<String>? errors,
  int? status,
}) => http.Response(
  jsonEncode(
    code == 10000
        ? {'statusCode': code, 'message': 'success', 'data': data}
        : {
            'statusCode': code,
            'message': message ?? 'error',
            'errors': errors ?? [],
          },
  ),
  status ?? (code == 10000 ? 200 : 400),
  headers: {'content-type': 'application/json; charset=utf-8'},
);

const profile = {
  'id': 7,
  'email': 'social@ex.com',
  'nickname': '카카오유저',
  'coinBalance': 3000,
  'provider': 'KAKAO',
  'role': 'USER',
  'marketingAgreed': false,
};

/// /auth/social-login 응답을 순서대로 내주는 서버.
class FakeServer {
  final List<http.Response> socialResponses;
  final List<String> providers;
  final List<Map<String, dynamic>> socialBodies = [];
  FakeServer(this.socialResponses, {this.providers = const ['KAKAO']});

  late final client = MockClient((req) async {
    switch (req.url.path) {
      case '/auth/providers':
        return envelope(10000, {'providers': providers});
      case '/auth/social-login':
        socialBodies.add(jsonDecode(req.body) as Map<String, dynamic>);
        return socialResponses.removeAt(0);
      case '/users/me':
        return envelope(10000, profile);
    }
    return http.Response('{}', 404);
  });
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  late BuildContext ctx;
  Future<void> pumpContext(WidgetTester tester) async {
    await tester.pumpWidget(
      Builder(
        builder: (c) {
          ctx = c;
          return const SizedBox();
        },
      ),
    );
  }

  testWidgets('기존 회원은 토큰만 보내고 바로 로그인한다', (tester) async {
    await pumpContext(tester);
    final server = FakeServer([
      envelope(10000, {
        'accessToken': 'jwt-1',
        'expiresIn': 3600,
        'user': profile,
        'isNewUser': false,
      }),
    ]);
    final auth = AuthProvider(apiClient: ApiClient(httpClient: server.client));
    final kakao = FakeSocialClient(SocialProvider.kakao);

    final result = await auth.socialLogin(kakao, ctx);

    expect(result, isA<SocialLoginSuccess>());
    expect((result as SocialLoginSuccess).isNewUser, isFalse);
    expect(server.socialBodies.single, {
      'provider': 'KAKAO',
      'token': 'provider-token-0001',
    });
    expect(auth.isLoggedIn, isTrue);
    expect(auth.hasPendingWelcome, isFalse);
  });

  testWidgets('10010이면 동의를 받아 같은 토큰으로 다시 보낸다', (tester) async {
    await pumpContext(tester);
    final server = FakeServer([
      envelope(
        10010,
        null,
        message: 'Required agreements (terms, privacy, age 14+) are missing',
        errors: ['agreeTerms', 'agreePrivacy', 'agreeAge14'],
      ),
      envelope(10000, {
        'accessToken': 'jwt-new',
        'expiresIn': 3600,
        'user': profile,
        'isNewUser': true,
        'welcomeGp': 3000,
      }),
    ]);
    final auth = AuthProvider(apiClient: ApiClient(httpClient: server.client));
    final kakao = FakeSocialClient(
      SocialProvider.kakao,
      token: 'kakao-access-token-xyz',
      nickname: '카카오닉',
    );

    final first = await auth.socialLogin(kakao, ctx);
    expect(first, isA<SocialLoginNeedsConsent>());
    expect((first as SocialLoginNeedsConsent).suggestedNickname, '카카오닉');
    expect(auth.isLoggedIn, isFalse);

    final second = await auth.completeSocialSignup(
      const Agreements(terms: true, privacy: true, age14: true),
      nickname: '새닉네임',
    );

    expect(second, isA<SocialLoginSuccess>());
    expect(kakao.signInCalls, 1, reason: 'SDK를 다시 열지 않는다');
    expect(server.socialBodies[1], {
      'provider': 'KAKAO',
      'token': 'kakao-access-token-xyz',
      'nickname': '새닉네임',
      'agreeTerms': true,
      'agreePrivacy': true,
      'agreeAge14': true,
      'agreeMarketing': false,
    });
    expect(auth.takeWelcomeGp(), 3000);
  });

  testWidgets('동의 시트를 닫으면 보관한 토큰을 버린다', (tester) async {
    await pumpContext(tester);
    final server = FakeServer([envelope(10010, null)]);
    final auth = AuthProvider(apiClient: ApiClient(httpClient: server.client));
    await auth.socialLogin(FakeSocialClient(SocialProvider.naver), ctx);
    auth.cancelSocialSignup();
    final result = await auth.completeSocialSignup(const Agreements.all());
    expect(result, isA<SocialLoginFailed>());
    expect(server.socialBodies, hasLength(1));
  });

  testWidgets('10011·10012·10002를 각각의 결과로 바꾼다', (tester) async {
    await pumpContext(tester);
    final server = FakeServer([
      envelope(
        10011,
        null,
        message: 'This email is already registered with another sign-in method',
        errors: ['provider:EMAIL'],
        status: 409,
      ),
      envelope(
        10012,
        null,
        message: 'GOOGLE login is not available right now',
        status: 503,
      ),
      envelope(10002, null, message: 'Invalid social login token', status: 401),
    ]);
    final auth = AuthProvider(apiClient: ApiClient(httpClient: server.client));

    final taken = await auth.socialLogin(
      FakeSocialClient(SocialProvider.kakao),
      ctx,
    );
    expect(taken, isA<SocialLoginEmailTaken>());
    expect((taken as SocialLoginEmailTaken).existingProvider, 'EMAIL');
    expect(taken.existingLabel, '이메일');

    final down = await auth.socialLogin(
      FakeSocialClient(SocialProvider.google),
      ctx,
    );
    expect(down, isA<SocialLoginUnavailable>());

    final bad = await auth.socialLogin(
      FakeSocialClient(SocialProvider.apple),
      ctx,
    );
    expect(bad, isA<SocialLoginInvalidToken>());
    expect(auth.isLoggedIn, isFalse);
  });

  testWidgets('제공자 화면을 닫으면 서버를 부르지 않는다', (tester) async {
    await pumpContext(tester);
    final server = FakeServer([]);
    final auth = AuthProvider(apiClient: ApiClient(httpClient: server.client));
    final result = await auth.socialLogin(
      FakeSocialClient(
        SocialProvider.kakao,
        error: const SocialSignInCancelled(),
      ),
      ctx,
    );
    expect(result, isA<SocialLoginCancelled>());
    expect(server.socialBodies, isEmpty);

    final failed = await auth.socialLogin(
      FakeSocialClient(
        SocialProvider.kakao,
        error: const SocialSignInFailed('키 설정 오류'),
      ),
      ctx,
    );
    expect(failed, isA<SocialLoginFailed>());
    expect((failed as SocialLoginFailed).message, '키 설정 오류');
  });

  test('서버가 지원하고 키가 있는 제공자만 보인다', () {
    final clients = [
      FakeSocialClient(SocialProvider.kakao),
      FakeSocialClient(SocialProvider.naver),
      FakeSocialClient(SocialProvider.google, isAvailable: false),
      FakeSocialClient(SocialProvider.apple),
    ];
    expect(
      visibleSocialClients(clients, ['KAKAO', 'GOOGLE']).map((c) => c.provider),
      [SocialProvider.kakao],
    );
    expect(visibleSocialClients(clients, const []), isEmpty);
  });

  group('로그인 화면', () {
    Future<AuthProvider> pumpLogin(
      WidgetTester tester,
      FakeServer server,
      List<SocialAuthClient> clients,
    ) async {
      tester.view.physicalSize = const Size(1170, 2532);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      final auth = AuthProvider(
        apiClient: ApiClient(httpClient: server.client),
        socialClients: () => clients,
      );
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
            home: LoginPage(socialClients: clients),
          ),
        ),
      );
      await tester.pumpAndSettle();
      return auth;
    }

    testWidgets('서버가 제공자를 주지 않으면 이메일 로그인만 보인다', (tester) async {
      await pumpLogin(tester, FakeServer([], providers: const []), [
        FakeSocialClient(SocialProvider.kakao),
      ]);
      expect(find.text('카카오로 시작하기'), findsNothing);
      expect(find.text('또는 이메일로'), findsNothing);
      expect(find.text('로그인'), findsOneWidget);
    });

    testWidgets('신규 소셜 가입: 동의 시트 → 필수 동의 → 로그인', (tester) async {
      final server = FakeServer([
        envelope(10010, null),
        envelope(10000, {
          'accessToken': 'jwt-new',
          'expiresIn': 3600,
          'user': profile,
          'isNewUser': true,
          'welcomeGp': 3000,
        }),
      ]);
      final auth = await pumpLogin(tester, server, [
        FakeSocialClient(SocialProvider.kakao),
      ]);
      expect(find.text('또는 이메일로'), findsOneWidget);

      await tester.tap(find.text('카카오로 시작하기'));
      await tester.pumpAndSettle();
      expect(find.text('카카오로 가입하기'), findsOneWidget);

      FilledButton cta() => tester.widget(
        find.ancestor(
          of: find.text('동의하고 시작하기'),
          matching: find.byType(FilledButton),
        ),
      );
      expect(cta().onPressed, isNull);

      await tester.tap(find.bySemanticsLabel('전체 동의'));
      await tester.pump();
      expect(cta().onPressed, isNotNull);
      await tester.ensureVisible(find.text('동의하고 시작하기'));
      await tester.tap(find.text('동의하고 시작하기'));
      await tester.pumpAndSettle();

      expect(server.socialBodies[1]['agreeTerms'], isTrue);
      expect(server.socialBodies[1]['agreeMarketing'], isTrue);
      expect(auth.isLoggedIn, isTrue);
      // 신규 가입이면 서버가 준 축하 GP로 축하 화면이 뜬다.
      expect(find.text('가입을 축하해요'), findsOneWidget);
      expect(auth.hasPendingWelcome, isFalse);
    });

    testWidgets('다른 방법으로 가입된 이메일이면 안내 카드를 보여준다', (tester) async {
      final server = FakeServer(
        [
          envelope(10011, null, errors: ['provider:NAVER'], status: 409),
        ],
        providers: const ['KAKAO', 'NAVER'],
      );
      await pumpLogin(tester, server, [
        FakeSocialClient(SocialProvider.kakao),
        FakeSocialClient(SocialProvider.naver),
      ]);
      await tester.tap(find.text('카카오로 시작하기'));
      await tester.pumpAndSettle();
      expect(find.text('이미 네이버로 가입된 이메일이에요'), findsOneWidget);
      expect(find.text('처음 가입한 네이버 로그인으로 들어와 주세요.'), findsOneWidget);
    });
  });
}
