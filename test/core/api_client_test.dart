import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/core/network/token_storage.dart';

class MemoryTokenStorage extends TokenStorage {
  String? token = 'test-token';
  @override
  Future<String?> readToken() async => token;
}

void main() {
  ApiClient api(
    http.Client client, {
    Duration timeout = const Duration(seconds: 1),
  }) => ApiClient(
    client: client,
    apiBaseUrl: 'https://api.example.test',
    tokenStorage: MemoryTokenStorage(),
    timeout: timeout,
  );

  test('authenticated UTF-8 envelope is unwrapped', () async {
    final client = api(
      MockClient((request) async {
        expect(request.headers['authorization'], 'Bearer test-token');
        return http.Response(
          '{"statusCode":10000,"data":{"name":"가치가차"}}',
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }),
    );
    expect(await client.get('/users/me'), {'name': '가치가차'});
  });

  test('public login never sends a saved bearer token', () async {
    final client = api(
      MockClient((request) async {
        expect(request.headers.containsKey('authorization'), isFalse);
        return http.Response('{"statusCode":10000,"data":{}}', 200);
      }),
    );
    await client.post('/auth/login', withAuth: false);
  });

  test(
    'preserves HTTP 401 when the server returns an application error code',
    () async {
      final client = api(
        MockClient(
          (_) async =>
              http.Response('{"statusCode":40001,"message":"expired"}', 401),
        ),
      );
      await expectLater(
        client.get('/users/me'),
        throwsA(
          isA<ApiException>()
              .having((e) => e.httpStatusCode, 'HTTP status', 401)
              .having((e) => e.statusCode, 'application status', 40001),
        ),
      );
    },
  );

  test('handles validation lists and malformed gateway responses', () async {
    for (final response in [
      http.Response('{"message":["email required","password required"]}', 400),
      http.Response('<html>gateway</html>', 502),
      http.Response('[]', 200),
    ]) {
      await expectLater(
        api(MockClient((_) async => response)).get('/users/me'),
        throwsA(isA<ApiException>()),
      );
    }
  });

  test('204 has no JSON body', () async {
    expect(
      await api(MockClient((_) async => http.Response('', 204))).get('/empty'),
      isNull,
    );
  });

  test('timeouts do not automatically retry a mutation', () async {
    var requests = 0;
    final client = api(
      MockClient((_) {
        requests++;
        return Completer<http.Response>().future;
      }),
      timeout: const Duration(milliseconds: 5),
    );
    await expectLater(
      client.post('/auth/login', withAuth: false),
      throwsA(isA<ApiException>().having((e) => e.statusCode, 'transport', 0)),
    );
    expect(requests, 1);
  });

  test(
    'GP topup and unverified legacy transactions never reach transport',
    () async {
      final client = api(
        MockClient((_) async => throw StateError('must not send')),
      );
      for (final path in ['/wallet/topup', '/draws', '/shipping-requests']) {
        await expectLater(client.post(path), throwsA(isA<ApiException>()));
      }
    },
  );

  test('invalid destinations fail before attaching a token', () async {
    final transport = MockClient(
      (_) async => throw StateError('must not send'),
    );
    for (final base in [
      '',
      'http://api.example.test',
      'https://user:pass@example.test',
    ]) {
      await expectLater(
        ApiClient(client: transport, apiBaseUrl: base).get('/users/me'),
        throwsA(isA<ApiException>()),
      );
    }
    for (final path in [
      '//other.example/users',
      'https://other.example/users',
      '/../users',
    ]) {
      await expectLater(api(transport).get(path), throwsA(isA<ApiException>()));
    }
  });
}
