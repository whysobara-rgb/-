import 'package:flutter/foundation.dart';
import '../../core/network/api_client.dart';
import '../../core/network/token_storage.dart';
import '../models/app_user.dart';

/// 로그인/회원가입/자동로그인 상태를 관리하는 Provider.
///
/// 백엔드(NestJS) `/auth/login`, `/auth/signup`, `/users/me`와 실제로
/// 통신하며, JWT 토큰은 [TokenStorage](shared_preferences)에 저장되어
/// 앱을 재시작해도 로그인 상태가 유지된다.
class AuthProvider extends ChangeNotifier {
  final ApiClient _apiClient;
  final TokenStorage _tokenStorage;

  AuthProvider({
    ApiClient apiClient = const ApiClient(),
    TokenStorage tokenStorage = const TokenStorage(),
  }) : _apiClient = apiClient,
       _tokenStorage = tokenStorage;

  AppUser? _currentUser;
  bool _isLoading = false;
  bool _isInitializing = true;
  String? _errorMessage;

  AppUser? get currentUser => _currentUser;
  bool get isLoggedIn => _currentUser != null;
  bool get isLoading => _isLoading;

  /// 앱 시작 시 저장된 토큰으로 자동 로그인을 시도하는 동안 true.
  /// (스플래시/로딩 화면 표시에 사용)
  bool get isInitializing => _isInitializing;
  String? get errorMessage => _errorMessage;

  /// 앱 시작 시(main.dart)에서 1회 호출.
  /// 저장된 토큰이 있으면 `/users/me`로 유효성을 검증하고 자동 로그인한다.
  Future<void> tryAutoLogin() async {
    final token = await _tokenStorage.readToken();
    if (token == null || token.isEmpty) {
      _isInitializing = false;
      notifyListeners();
      return;
    }
    try {
      final data = await _apiClient.get('/users/me');
      _currentUser = AppUser.fromJson(data as Map<String, dynamic>);
    } catch (_) {
      // 토큰 만료/무효 → 로그아웃 상태로 진행
      await _tokenStorage.clearToken();
      _currentUser = null;
    }
    _isInitializing = false;
    notifyListeners();
  }

  /// 이메일/비밀번호 로그인. 성공 시 true, 실패 시 false를 반환하며
  /// [errorMessage]에 백엔드가 내려준 메시지를 저장한다.
  Future<bool> login({required String email, required String password}) async {
    _setLoading(true);
    _errorMessage = null;
    try {
      final data = await _apiClient.post(
        '/auth/login',
        body: {'email': email, 'password': password},
        withAuth: false,
      );
      final map = data as Map<String, dynamic>;
      final accessToken = map['accessToken'] as String;
      await _tokenStorage.saveToken(accessToken);

      // 로그인 응답의 user는 coinBalance가 없으므로 /users/me로 전체 프로필 조회.
      await _fetchProfile();
      return true;
    } on ApiException catch (e) {
      _errorMessage = e.message;
      return false;
    } catch (e) {
      _errorMessage = '로그인 중 오류가 발생했습니다';
      return false;
    } finally {
      _setLoading(false);
    }
  }

  /// 소셜 로그인(카카오/구글/네이버/Apple). 성공 시 true, 실패 시 false를 반환하며
  /// [errorMessage]에 백엔드가 내려준 메시지를 저장한다.
  ///
  /// [provider]는 백엔드 `AuthProvider` enum 값과 동일한 문자열
  /// ('KAKAO'/'GOOGLE'/'NAVER'/'APPLE')을 전달해야 한다.
  /// [providerId]는 제공자가 발급한 사용자 고유 ID, [email]/[nickname]은
  /// 제공자 프로필에서 얻은 값(최초 가입 시에만 사용됨)이다.
  Future<bool> socialLogin({
    required String provider,
    required String providerId,
    required String email,
    String? nickname,
  }) async {
    _setLoading(true);
    _errorMessage = null;
    try {
      final data = await _apiClient.post(
        '/auth/social-login',
        body: {
          'provider': provider,
          'providerId': providerId,
          'email': email,
          if (nickname != null && nickname.isNotEmpty) 'nickname': nickname,
        },
        withAuth: false,
      );
      final map = data as Map<String, dynamic>;
      final accessToken = map['accessToken'] as String;
      await _tokenStorage.saveToken(accessToken);

      await _fetchProfile();
      return true;
    } on ApiException catch (e) {
      _errorMessage = e.message;
      return false;
    } catch (e) {
      _errorMessage = '소셜 로그인 중 오류가 발생했습니다';
      return false;
    } finally {
      _setLoading(false);
    }
  }

  /// 회원가입 후 자동 로그인까지 수행. 성공 시 true.
  Future<bool> signup({
    required String email,
    required String password,
    required String nickname,
  }) async {
    _setLoading(true);
    _errorMessage = null;
    try {
      await _apiClient.post(
        '/auth/signup',
        body: {'email': email, 'password': password, 'nickname': nickname},
        withAuth: false,
      );
      // 회원가입 성공 후 곧바로 로그인 처리.
      return await login(email: email, password: password);
    } on ApiException catch (e) {
      _errorMessage = e.message;
      return false;
    } catch (e) {
      _errorMessage = '회원가입 중 오류가 발생했습니다';
      return false;
    } finally {
      _setLoading(false);
    }
  }

  /// 뽑기/충전/배송 등 잔액이 바뀌는 동작 이후 최신 프로필(잔액 포함)을
  /// 서버에서 다시 가져와 [currentUser]를 갱신한다.
  Future<void> refreshProfile() async {
    if (!isLoggedIn) return;
    try {
      await _fetchProfile();
    } catch (_) {
      // 네트워크 일시 오류 등은 조용히 무시(다음 새로고침에서 재시도).
    }
  }

  Future<void> _fetchProfile() async {
    final data = await _apiClient.get('/users/me');
    _currentUser = AppUser.fromJson(data as Map<String, dynamic>);
    notifyListeners();
  }

  Future<void> logout() async {
    await _tokenStorage.clearToken();
    _currentUser = null;
    notifyListeners();
  }

  void _setLoading(bool value) {
    _isLoading = value;
    notifyListeners();
  }
}
