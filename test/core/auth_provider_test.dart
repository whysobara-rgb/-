import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/core/network/token_storage.dart';
import 'package:gacha_vault/shared/providers/auth_provider.dart';

class MemoryStorage extends TokenStorage {
  String? token = 'saved';
  bool failRead = false;
  @override
  Future<String?> readToken() async {
    if (failRead) throw StateError('storage unavailable');
    return token;
  }

  @override
  Future<void> clearToken() async {
    token = null;
  }
}

class FailingApi extends ApiClient {
  final int httpStatus;
  const FailingApi(this.httpStatus);
  @override
  Future<dynamic> get(String path, {bool withAuth = true}) async {
    throw ApiException(
      statusCode: 40001,
      httpStatusCode: httpStatus,
      message: 'failed',
    );
  }
}

void main() {
  test(
    'transient service failure preserves credentials; unauthorized clears them',
    () async {
      for (final status in [503, 401]) {
        final storage = MemoryStorage();
        final auth = AuthProvider(
          apiClient: FailingApi(status),
          tokenStorage: storage,
        );
        await auth.tryAutoLogin();
        expect(auth.isInitializing, isFalse);
        expect(auth.isLoggedIn, isFalse);
        expect(storage.token, status == 401 ? isNull : 'saved');
        auth.dispose();
      }
    },
  );
  test('storage failure exits the splash screen', () async {
    final auth = AuthProvider(tokenStorage: MemoryStorage()..failRead = true);
    await auth.tryAutoLogin();
    expect(auth.isInitializing, isFalse);
    expect(auth.errorMessage, isNotNull);
    auth.dispose();
  });
}
