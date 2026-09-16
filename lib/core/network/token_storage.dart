import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// 가치가차 - JWT 액세스 토큰 로컬 저장소.
///
/// Android Keystore / iOS Keychain 기반 저장. 이전 평문 토큰은 신뢰하지
/// 않고 제거해 재로그인을 요구한다. 운영 웹 인증은 별도 검토 대상이다.
class TokenStorage {
  static const _accessTokenKey = 'gacha_vault_access_token';
  final FlutterSecureStorage _storage;

  const TokenStorage({
    FlutterSecureStorage storage = const FlutterSecureStorage(
      aOptions: AndroidOptions(encryptedSharedPreferences: true),
    ),
  }) : _storage = storage;

  Future<void> _removeLegacyToken() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_accessTokenKey);
  }

  Future<void> saveToken(String token) async {
    await _removeLegacyToken();
    await _storage.write(key: _accessTokenKey, value: token);
  }

  Future<String?> readToken() async {
    await _removeLegacyToken();
    return _storage.read(key: _accessTokenKey);
  }

  Future<void> clearToken() async {
    await _removeLegacyToken();
    await _storage.delete(key: _accessTokenKey);
  }
}
