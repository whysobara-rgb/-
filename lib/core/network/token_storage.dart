import 'package:shared_preferences/shared_preferences.dart';

/// 가치가차 - JWT 액세스 토큰 로컬 저장소.
///
/// shared_preferences 기반으로 앱 재시작 후에도 로그인 상태를 유지하기 위해
/// 토큰을 저장/조회/삭제한다.
class TokenStorage {
  static const _accessTokenKey = 'gacha_vault_access_token';

  const TokenStorage();

  Future<void> saveToken(String token) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_accessTokenKey, token);
  }

  Future<String?> readToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_accessTokenKey);
  }

  Future<void> clearToken() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_accessTokenKey);
  }
}
