import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/core/network/token_storage.dart';
import 'package:gacha_vault/features/account_security/account_security_repository.dart';
import 'package:gacha_vault/shared/providers/auth_provider.dart';

class MemoryToken extends TokenStorage {
  String? value = 'synthetic-token-a';
  Completer<String?>? readBarrier;
  int reads = 0;
  @override
  Future<String?> readToken() async {
    reads++;
    return readBarrier == null ? value : readBarrier!.future;
  }
  @override
  Future<void> saveToken(String token) async { value = token; }
  @override
  Future<void> clearToken() async { value = null; }
}

http.Response ok(dynamic data) => http.Response(
    jsonEncode({'statusCode': 10000, 'message': 'success', 'data': data}), 200,
    headers: {'content-type': 'application/json; charset=utf-8'});
const caps = {'contract': 'ACCOUNT_SUPPORT_V1', 'enabled': true,
    'closureMode': 'REQUEST_ONLY'};

void main() {
  test('queries the fixed contract using the authenticated session', () async {
    final storage = MemoryToken();
    final client = MockClient((r) async {
      expect(r.method, 'GET');
      expect(r.url.path, '/account/capabilities');
      expect(r.headers['Authorization'], storage.value == null ? null : 'Bearer ${storage.value}');
      expect(r.followRedirects, isFalse);
      return ok(caps);
    });
    final repo = AccountSecurityRepository(api: ApiClient(client: client, tokenStorage: storage));
    expect((await repo.capabilities(() => true)).enabled, isTrue);
    client.close();
  });
  test('does not read credentials or dispatch when the lease is already invalid', () async {
    final storage = MemoryToken(); var calls = 0;
    final client = MockClient((_) async { calls++; return ok(caps); });
    final api = ApiClient(client: client, tokenStorage: storage);
    await expectLater(api.getForSession('/account/capabilities', sessionIsCurrent: () => false),
        throwsA(isA<ApiSessionChangedException>()));
    expect(storage.reads, 0); expect(calls, 0); client.close();
  });
  test('rechecks the lease after an asynchronous credential read', () async {
    final storage = MemoryToken()..readBarrier = Completer<String?>();
    var current = true; var calls = 0;
    final client = MockClient((_) async { calls++; return ok({'changed': true, 'reauthenticate': true}); });
    final api = ApiClient(client: client, tokenStorage: storage);
    final pending = api.postForSession('/account/password', body: {'currentPassword': 'synthetic-old'}, sessionIsCurrent: () => current);
    final expectation = expectLater(pending, throwsA(isA<ApiSessionChangedException>()));
    current = false; storage.readBarrier!.complete('synthetic-token-b');
    await expectation; expect(calls, 0); client.close();
  });
  test('rejects missing authentication instead of sending an anonymous operation', () async {
    final storage = MemoryToken()..value = null; var calls = 0;
    final client = MockClient((_) async { calls++; return ok(caps); });
    await expectLater(ApiClient(client: client, tokenStorage: storage)
        .getForSession('/account/capabilities', sessionIsCurrent: () => true),
        throwsA(isA<ApiSessionChangedException>()));
    expect(calls, 0); client.close();
  });
  test('discards a late response after a session switch', () async {
    final barrier = Completer<http.Response>(); var current = true;
    final client = MockClient((_) => barrier.future);
    final repo = AccountSecurityRepository(api: ApiClient(client: client, tokenStorage: MemoryToken()));
    final pending = repo.capabilities(() => current);
    final expectation = expectLater(pending, throwsA(isA<ApiSessionChangedException>()));
    await pumpEventQueue(); current = false; barrier.complete(ok(caps));
    await expectation; client.close();
  });
  test('does not follow a redirect or retry a password mutation', () async {
    var calls = 0;
    final client = MockClient((r) async {
      calls++; expect(r.followRedirects, isFalse);
      return http.Response('', 307, headers: {'location':'https://other.example.invalid/'});
    });
    final repo = AccountSecurityRepository(api: ApiClient(client: client, tokenStorage: MemoryToken()));
    await expectLater(repo.changePassword('oldTest123!', 'nextTest456!', () => true), throwsA(isA<ApiException>()));
    expect(calls, 1); client.close();
  });
  test('keeps submitted passwords exact and sends only the accepted fields', () async {
    final client = MockClient((r) async {
      expect(r.url.path, '/account/password');
      expect(jsonDecode(r.body), {'currentPassword':' oldTest123! ', 'newPassword':' nextTest456! '});
      return ok({'changed':true, 'reauthenticate':true});
    });
    await AccountSecurityRepository(api: ApiClient(client: client, tokenStorage: MemoryToken()))
        .changePassword(' oldTest123! ', ' nextTest456! ', () => true);
    client.close();
  });
  test('validates new password byte length, controls and required character groups', () {
    expect(newPasswordError('goodTest123!'), isNull);
    for (final value in ['short1A', 'abcdefgh', '12345678', 'abcdefgh1\n', '${'한' * 24}A1']) {
      expect(newPasswordError(value), isNotNull);
    }
    expect(currentPasswordError('12345678'), isNull);
  });
  test('refuses invalid passwords and unchanged passwords before dispatch', () async {
    var calls = 0;
    final client = MockClient((_) async { calls++; return ok(null); });
    final repo = AccountSecurityRepository(api: ApiClient(client: client, tokenStorage: MemoryToken()));
    await expectLater(repo.changePassword('oldTest123!', 'bad', () => true), throwsFormatException);
    await expectLater(repo.changePassword('oldTest123!', 'oldTest123!', () => true), throwsFormatException);
    expect(calls, 0); client.close();
  });
  test('only confirms exact security result flags', () async {
    for (final value in [null, {'changed':true}, {'changed':'true','reauthenticate':true}, {'changed':true,'reauthenticate':false}]) {
      final client = MockClient((_) async => ok(value));
      final repo = AccountSecurityRepository(api: ApiClient(client: client, tokenStorage: MemoryToken()));
      await expectLater(repo.changePassword('oldTest123!', 'nextTest456!', () => true), throwsFormatException);
      client.close();
    }
  });
  test('refuses malformed or different capability contracts', () {
    for (final value in [null, {}, {...caps,'contract':'OTHER'}, {...caps,'enabled':1}, {...caps,'closureMode':'AUTO_DELETE'}]) {
      expect(() => AccountSecurityCapabilities.parse(value), throwsFormatException);
    }
  });
  test('revokes sessions without sending a replacement password', () async {
    final client = MockClient((r) async {
      expect(r.url.path, '/account/revoke-sessions');
      expect(jsonDecode(r.body), {'currentPassword':'oldTest123!'});
      return ok({'revoked':true,'reauthenticate':true});
    });
    await AccountSecurityRepository(api: ApiClient(client: client, tokenStorage: MemoryToken()))
        .revokeSessions('oldTest123!', () => true);
    client.close();
  });
  test('ambiguous network errors never automatically repeat account mutations', () async {
    var calls = 0;
    final client = MockClient((_) async { calls++; throw http.ClientException('synthetic network failure'); });
    await expectLater(AccountSecurityRepository(api: ApiClient(client: client, tokenStorage: MemoryToken()))
        .revokeSessions('oldTest123!', () => true), throwsA(isA<ApiException>()));
    expect(calls, 1); client.close();
  });
  test('conditional logout cannot affect a different or same-user newer login', () async {
    final storage = MemoryToken(); var loginNumber = 0; var userId = 1;
    final client = MockClient((r) async => r.url.path == '/auth/login'
        ? ok({'accessToken':'synthetic-${++loginNumber}'})
        : ok({'id':userId,'email':'u@example.invalid','nickname':'synthetic','coinBalance':100}));
    final api = ApiClient(client: client, tokenStorage: storage);
    final auth = AuthProvider(apiClient: api, tokenStorage: storage);
    await auth.tryAutoLogin(); final first = auth.sessionGeneration;
    await auth.logout(); userId = 2;
    await auth.login(email:'u@example.invalid', password:'not-real');
    expect(await auth.logoutIfSession(first), isFalse);
    expect(auth.currentUser!.id, 2);
    final second = auth.sessionGeneration;
    await auth.logout(); await auth.login(email:'u@example.invalid', password:'not-real');
    expect(await auth.logoutIfSession(second), isFalse);
    expect(auth.currentUser!.id, 2);
    expect(await auth.logoutIfSession(auth.sessionGeneration), isTrue);
    expect(storage.value, isNull); auth.dispose(); client.close();
  });
}
