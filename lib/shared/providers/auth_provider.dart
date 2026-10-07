import 'dart:async';
import 'package:flutter/widgets.dart';
import '../../core/network/api_client.dart';
import '../../core/network/token_storage.dart';
import '../../features/auth/data/auth_repository.dart';
import '../../features/auth/domain/agreements.dart';
import '../../features/auth/domain/social_login_result.dart';
import '../../features/auth/social/social_auth_client.dart';
import '../../features/auth/social/social_auth_clients.dart';
import '../models/app_user.dart';

/// 로그인/회원가입/자동로그인 상태를 관리하는 Provider.
///
/// 백엔드(NestJS) `/auth/*`, `/users/me`와 통신하며, JWT 토큰은
/// [TokenStorage](shared_preferences)에 저장되어 앱을 재시작해도 로그인
/// 상태가 유지된다.
class AuthProvider extends ChangeNotifier {
  final ApiClient _apiClient;
  final TokenStorage _tokenStorage;
  final AuthRepository _auth;
  final List<SocialAuthClient> Function() _socialClients;

  AuthProvider({
    ApiClient apiClient = const ApiClient(),
    TokenStorage tokenStorage = const TokenStorage(),
    List<SocialAuthClient> Function() socialClients = defaultSocialClients,
  }) : _apiClient = apiClient,
       _tokenStorage = tokenStorage,
       _auth = AuthRepository(apiClient: apiClient),
       _socialClients = socialClients;

  AppUser? _currentUser;
  bool _isLoading = false;
  bool _isInitializing = true;
  String? _errorMessage;
  int? _pendingWelcomeGp;

  /// 약관 동의를 기다리는 소셜 로그인(10010). 동의하면 같은 토큰으로 다시 보낸다.
  (SocialProvider, SocialCredential)? _pendingSocial;

  AppUser? get currentUser => _currentUser;
  bool get isLoggedIn => _currentUser != null;
  bool get isLoading => _isLoading;

  /// 앱 시작 시 저장된 토큰으로 자동 로그인을 시도하는 동안 true.
  /// (스플래시/로딩 화면 표시에 사용)
  bool get isInitializing => _isInitializing;
  String? get errorMessage => _errorMessage;

  /// 방금 가입해서 아직 축하 화면을 보여주지 않은 GP.
  bool get hasPendingWelcome => _pendingWelcomeGp != null;

  /// 가입 축하 GP를 한 번만 꺼낸다.
  int? takeWelcomeGp() {
    final gp = _pendingWelcomeGp;
    _pendingWelcomeGp = null;
    return gp;
  }

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
      final session = await _auth.login(email: email, password: password);
      await _startSession(session);
      return true;
    } on ApiException catch (e) {
      _errorMessage = e.displayMessage;
      return false;
    } catch (e) {
      _errorMessage = '로그인하지 못했어요. 잠시 후 다시 시도해 주세요';
      return false;
    } finally {
      _setLoading(false);
    }
  }

  /// 이메일 가입 후 자동 로그인까지 수행. 성공 시 true.
  ///
  /// 서버는 가입 응답에 토큰을 주지 않아 같은 자격으로 바로 로그인한다.
  /// 지급된 가입 축하 GP는 [takeWelcomeGp]로 한 번 보여준다.
  Future<bool> signup({
    required String email,
    required String password,
    required String nickname,
    required Agreements agreements,
  }) async {
    _setLoading(true);
    _errorMessage = null;
    try {
      final welcomeGp = await _auth.signup(
        email: email,
        password: password,
        nickname: nickname,
        agreements: agreements,
      );
      final AuthSession session;
      try {
        session = await _auth.login(email: email, password: password);
      } on ApiException {
        _errorMessage = '가입은 완료됐어요. 로그인 화면에서 다시 로그인해 주세요';
        return false;
      }
      _pendingWelcomeGp = (welcomeGp ?? 0) > 0 ? welcomeGp : null;
      await _startSession(session);
      return true;
    } on ApiException catch (e) {
      _errorMessage = e.displayMessage;
      return false;
    } catch (e) {
      _errorMessage = '가입하지 못했어요. 잠시 후 다시 시도해 주세요';
      return false;
    } finally {
      _setLoading(false);
    }
  }

  /// 서버가 검증할 수 있는 소셜 제공자 코드. 실패하면 빈 목록(이메일만).
  Future<List<String>> fetchSocialProviders() async {
    try {
      return await _auth.providers();
    } catch (_) {
      return const [];
    }
  }

  /// 소셜 로그인 1단계: 제공자 SDK로 토큰을 받아 서버에 보낸다.
  ///
  /// 처음 온 사용자면 [SocialLoginNeedsConsent]를 돌려주고 토큰을 보관한다.
  /// 화면은 동의를 받은 뒤 [completeSocialSignup]을 부른다.
  Future<SocialLoginResult> socialLogin(
    SocialAuthClient client,
    BuildContext context,
  ) async {
    _pendingSocial = null;
    _errorMessage = null;
    final SocialCredential credential;
    try {
      credential = await client.signIn(context);
    } on SocialSignInCancelled {
      return const SocialLoginCancelled();
    } on SocialSignInFailed catch (e) {
      return SocialLoginFailed(e.message);
    } catch (_) {
      return SocialLoginFailed('${client.provider.label} 로그인을 열지 못했어요');
    }
    return _submitSocial(client.provider, credential);
  }

  /// 소셜 로그인 2단계(신규 가입): 같은 토큰에 약관 동의를 붙여 다시 보낸다.
  Future<SocialLoginResult> completeSocialSignup(
    Agreements agreements, {
    String? nickname,
  }) async {
    final pending = _pendingSocial;
    if (pending == null) {
      return const SocialLoginFailed('로그인을 처음부터 다시 시도해 주세요');
    }
    return _submitSocial(
      pending.$1,
      pending.$2,
      agreements: agreements,
      nickname: nickname,
    );
  }

  /// 동의 시트를 닫았을 때. 보관한 토큰을 버린다.
  void cancelSocialSignup() => _pendingSocial = null;

  Future<SocialLoginResult> _submitSocial(
    SocialProvider provider,
    SocialCredential credential, {
    Agreements? agreements,
    String? nickname,
  }) async {
    _setLoading(true);
    try {
      final session = await _auth.socialLogin(
        provider: provider.code,
        token: credential.token,
        nickname: nickname,
        agreements: agreements,
      );
      _pendingSocial = null;
      final welcome = session.welcomeGp ?? 0;
      _pendingWelcomeGp = session.isNewUser && welcome > 0 ? welcome : null;
      await _startSession(session);
      return SocialLoginSuccess(isNewUser: session.isNewUser);
    } on ApiException catch (e) {
      switch (e.statusCode) {
        case ApiCode.termsRequired:
          _pendingSocial = (provider, credential);
          return SocialLoginNeedsConsent(
            provider,
            suggestedNickname: credential.nickname,
          );
        case ApiCode.emailAlreadyRegistered:
          _pendingSocial = null;
          return SocialLoginEmailTaken(
            provider,
            existingProvider: e.errorValue('provider'),
          );
        case ApiCode.socialProviderUnavailable:
          return SocialLoginUnavailable(provider);
        case ApiCode.unauthorized:
          _pendingSocial = null;
          return SocialLoginInvalidToken(provider);
        default:
          return SocialLoginFailed(e.displayMessage);
      }
    } catch (_) {
      return SocialLoginFailed('${provider.label} 로그인에 실패했어요');
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

  /// 뽑기·전환·출석·충전 응답의 `balanceAfter`를 즉시 반영한다.
  /// (GpProvider는 currentUser를 따라가므로 여기서 한 번만 바꾼다.)
  void applyBalance(int balance) {
    final user = _currentUser;
    if (user == null || user.coinBalance == balance) return;
    _currentUser = user.copyWith(coinBalance: balance);
    notifyListeners();
  }

  /// 로그인 응답의 user에는 잔액·권한이 없으므로 /users/me로 전체 프로필을 읽는다.
  Future<void> _startSession(AuthSession session) async {
    await _tokenStorage.saveToken(session.accessToken);
    try {
      await _fetchProfile();
    } catch (_) {
      await _tokenStorage.clearToken();
      _pendingWelcomeGp = null;
      rethrow;
    }
  }

  Future<void> _fetchProfile() async {
    final data = await _apiClient.get('/users/me');
    _currentUser = AppUser.fromJson(data as Map<String, dynamic>);
    notifyListeners();
  }

  Future<void> logout() async {
    // 소셜 가입자는 제공자 SDK 세션도 끊어, 다음 로그인 때 계정을 고를 수 있게 한다.
    final provider = SocialProvider.fromCode(_currentUser?.provider);
    if (provider != null) {
      for (final c in _socialClients()) {
        if (c.provider == provider) unawaited(c.signOut());
      }
    }
    await _tokenStorage.clearToken();
    _currentUser = null;
    _pendingWelcomeGp = null;
    _pendingSocial = null;
    notifyListeners();
  }

  void _setLoading(bool value) {
    _isLoading = value;
    notifyListeners();
  }
}
