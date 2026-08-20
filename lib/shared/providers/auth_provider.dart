import 'package:flutter/foundation.dart';

/// 로그인 상태를 관리하는 Provider.
///
/// 현재는 더미 인증 로직으로, 실제 소셜/이메일 로그인 연동 전까지
/// 화면 전환 흐름을 검증하기 위한 용도로 사용됩니다.
class AuthProvider extends ChangeNotifier {
  bool _isLoggedIn = false;

  bool get isLoggedIn => _isLoggedIn;

  /// 더미 로그인 처리. 실제 인증 로직은 추후 연동.
  void login() {
    if (_isLoggedIn) return;
    _isLoggedIn = true;
    notifyListeners();
  }

  void logout() {
    if (!_isLoggedIn) return;
    _isLoggedIn = false;
    notifyListeners();
  }
}
