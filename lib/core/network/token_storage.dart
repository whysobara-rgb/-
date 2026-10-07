import 'package:shared_preferences/shared_preferences.dart';
import '../../demo/data/demo_storage.dart';
import '../../demo/demo_config.dart';

/// 가치가차 - JWT 액세스 토큰 로컬 저장소.
///
/// shared_preferences 기반으로 앱 재시작 후에도 로그인 상태를 유지하기 위해
/// 토큰을 저장/조회/삭제한다.
class TokenStorage {
  static const _accessTokenKey = 'gacha_vault_access_token';

  const TokenStorage();

  Future<void> saveToken(String token) async {
    // 체험판: 저장소가 막힌 샌드박스에서도 동작하도록 메모리 대체가 있는 저장소.
    if (DemoConfig.enabled) {
      return PrefsDemoStorage.instance.write(_accessTokenKey, token);
    }
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_accessTokenKey, token);
  }

  Future<String?> readToken() async {
    if (DemoConfig.enabled) {
      return PrefsDemoStorage.instance.read(_accessTokenKey);
    }
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_accessTokenKey);
  }

  Future<void> clearToken() async {
    if (DemoConfig.enabled) {
      return PrefsDemoStorage.instance.remove(_accessTokenKey);
    }
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_accessTokenKey);
  }
}
