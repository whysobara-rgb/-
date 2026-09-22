import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/core/network/token_storage.dart';
import 'package:gacha_vault/shared/providers/auth_provider.dart';

Map<String, dynamic> profile(int id, int balance) => {
  'id': id,
  'email': 'account$id@example.invalid',
  'nickname': '계정$id',
  'coinBalance': balance,
};

class SessionStorage extends TokenStorage {
  String? token = 'initial';
  Completer<void>? saveBarrier;
  @override
  Future<String?> readToken() async => token;
  @override
  Future<void> saveToken(String value) async {
    await saveBarrier?.future;
    token = value;
  }

  @override
  Future<void> clearToken() async {
    token = null;
  }
}

class SessionApi extends ApiClient {
  final responses = <Future<dynamic>>[];
  @override
  Future<dynamic> get(String path, {bool withAuth = true}) =>
      responses.removeAt(0);
  @override
  Future<dynamic> post(
    String path, {
    Map<String, dynamic>? body,
    bool withAuth = true,
    String? idempotencyKey,
  }) async => {'accessToken': 'next-token'};
}

void main() {
  late SessionApi api;
  late SessionStorage storage;
  late AuthProvider auth;
  setUp(() async {
    api = SessionApi()..responses.add(Future.value(profile(1, 1000)));
    storage = SessionStorage();
    auth = AuthProvider(apiClient: api, tokenStorage: storage);
    await auth.tryAutoLogin();
  });
  tearDown(() => auth.dispose());
  test('a delayed profile cannot restore an account after logout', () async {
    final delayed = Completer<dynamic>();
    api.responses.add(delayed.future);
    final refresh = auth.refreshProfile();
    await auth.logout();
    delayed.complete(profile(1, 900));
    await refresh;
    expect(auth.currentUser, isNull);
    expect(storage.token, isNull);
  });
  test('old account response cannot overwrite the new account', () async {
    final delayed = Completer<dynamic>();
    api.responses.add(delayed.future);
    final refresh = auth.refreshProfile();
    await auth.logout();
    api.responses.add(Future.value(profile(2, 500)));
    expect(
      await auth.login(email: 'new@example.invalid', password: 'test'),
      isTrue,
    );
    delayed.complete(profile(1, 900));
    await refresh;
    expect(auth.currentUser!.id, 2);
    expect(auth.currentUser!.coinBalance, 500);
  });
  test('an older refresh cannot overwrite a newer balance', () async {
    final first = Completer<dynamic>();
    api.responses.addAll([first.future, Future.value(profile(1, 700))]);
    final older = auth.refreshProfile();
    await auth.refreshProfile();
    first.complete(profile(1, 900));
    await older;
    expect(auth.currentUser!.coinBalance, 700);
  });
  test(
    'failed refresh preserves balance and marks it stale until recovery',
    () async {
      api.responses.add(
        Future.error(ApiException(statusCode: 0, message: 'offline')),
      );
      await auth.refreshProfile();
      expect(auth.currentUser!.coinBalance, 1000);
      expect(auth.isBalanceStale, isTrue);
      api.responses.add(Future.value(profile(1, 900)));
      await auth.refreshProfile();
      expect(auth.isBalanceStale, isFalse);
      expect(auth.currentUser!.coinBalance, 900);
    },
  );
  test('401 refresh clears the session', () async {
    api.responses.add(
      Future.error(
        ApiException(statusCode: 0, httpStatusCode: 401, message: 'expired'),
      ),
    );
    await auth.refreshProfile();
    expect(auth.currentUser, isNull);
    expect(storage.token, isNull);
    expect(auth.errorMessage, contains('만료'));
  });
  test('logout waits for an earlier token save then clears it', () async {
    await auth.logout();
    storage.saveBarrier = Completer<void>();
    final login = auth.login(email: 'x@example.invalid', password: 'test');
    await pumpEventQueue();
    final logout = auth.logout();
    expect(auth.currentUser, isNull);
    storage.saveBarrier!.complete();
    await logout;
    expect(await login, isFalse);
    expect(storage.token, isNull);
  });
  test('a mismatched profile never replaces the current account', () async {
    api.responses.add(Future.value(profile(2, 900)));
    await auth.refreshProfile();
    expect(auth.currentUser!.id, 1);
    expect(auth.isBalanceStale, isTrue);
  });
}
