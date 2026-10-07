import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/shared/models/app_user.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('PATCH·DELETE는 data만 돌려주고 본문을 JSON으로 보낸다', () async {
    final seen = <String>[];
    final api = ApiClient(
      httpClient: MockClient((req) async {
        seen.add('${req.method} ${req.url.path} ${req.body}');
        return http.Response(
          jsonEncode({
            'statusCode': 10000,
            'message': 'success',
            'data': {'ok': true},
          }),
          200,
        );
      }),
    );
    expect(await api.patch('/users/me', body: {'agreeMarketing': true}), {
      'ok': true,
    });
    expect(await api.delete('/users/me'), {'ok': true});
    expect(seen, [
      'PATCH /users/me {"agreeMarketing":true}',
      'DELETE /users/me ',
    ]);
  });

  test('errors[]의 key:value를 읽는다', () async {
    final api = ApiClient(
      httpClient: MockClient(
        (_) async => http.Response(
          jsonEncode({
            'statusCode': 10011,
            'message':
                'This email is already registered with another sign-in method',
            'errors': ['provider:KAKAO'],
          }),
          409,
        ),
      ),
    );
    try {
      await api.post('/auth/social-login');
      fail('should throw');
    } on ApiException catch (e) {
      expect(e.statusCode, ApiCode.emailAlreadyRegistered);
      expect(e.errorValue('provider'), 'KAKAO');
      expect(e.errorInt('missing'), isNull);
      expect(e.displayMessage, '이미 다른 방법으로 가입된 이메일이에요');
    }
  });

  test('연결 실패는 network 코드로 바뀐다', () async {
    final api = ApiClient(
      httpClient: MockClient((_) async => throw http.ClientException('down')),
    );
    await expectLater(
      api.get('/x'),
      throwsA(isA<ApiException>().having((e) => e.isNetwork, 'isNetwork', true)),
    );
  });

  test('판매량보다 적은 수량 오류를 우리말로 바꾼다', () {
    final e = ApiException(
      statusCode: 10001,
      message: 'totalStock cannot be below the 1234 already sold',
    );
    expect(e.displayMessage, '이미 판매된 1,234개보다 적게 정할 수 없어요');
  });

  test('AppUser는 role·provider·marketingAgreed를 읽고 없으면 기본값', () {
    final admin = AppUser.fromJson({
      'id': 2,
      'email': 'admin@gachivault.com',
      'nickname': '운영자',
      'coinBalance': '1000',
      'provider': 'EMAIL',
      'role': 'ADMIN',
      'marketingAgreed': true,
    });
    expect(admin.isAdmin, isTrue);
    expect(admin.coinBalance, 1000);
    expect(admin.marketingAgreed, isTrue);

    final old = AppUser.fromJson({'id': 1, 'email': 'a@b.c'});
    expect(old.isAdmin, isFalse);
    expect(old.provider, 'EMAIL');
    expect(old.marketingAgreed, isFalse);

    final kakao = AppUser.fromJson({
      'id': 3,
      'email': 'kakao_123@users.gachivault.invalid',
      'provider': 'KAKAO',
    });
    expect(kakao.maskedEmail, '');
  });
}
