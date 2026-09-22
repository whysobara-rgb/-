import 'package:flutter/foundation.dart';
import '../../core/network/api_client.dart';
import '../../core/network/token_storage.dart';
import '../models/app_user.dart';

/// Only responses from the current session may update the account or balance.
class AuthProvider extends ChangeNotifier {
  final ApiClient _apiClient;
  final TokenStorage _tokenStorage;
  AuthProvider({
    ApiClient apiClient = const ApiClient(),
    TokenStorage tokenStorage = const TokenStorage(),
  }) : _apiClient = apiClient,
       _tokenStorage = tokenStorage;

  AppUser? _currentUser;
  bool _isLoading = false, _isInitializing = true, _disposed = false;
  String? _errorMessage, _profileRefreshError;
  int _session = 0, _profileRequest = 0;
  Future<void> _credentialWrites = Future<void>.value();

  AppUser? get currentUser => _currentUser;
  bool get isLoggedIn => _currentUser != null;
  bool get isLoading => _isLoading;
  bool get isInitializing => _isInitializing;
  String? get errorMessage => _errorMessage;
  String? get profileRefreshError => _profileRefreshError;
  bool get isBalanceStale => _profileRefreshError != null;
  /// Non-secret identity of this login, including relogins to the same account.
  int get sessionGeneration => _session;
  bool isSessionCurrent(int generation) =>
      _current(generation) && _currentUser != null;

  /// A delayed security operation must never log a newer account/session out.
  Future<bool> logoutIfSession(int generation) async {
    if (!isSessionCurrent(generation)) return false;
    await logout();
    return !_disposed && _session == generation + 1 && _currentUser == null;
  }

  bool _current(int session) => !_disposed && session == _session;
  void _notify() {
    if (!_disposed) notifyListeners();
  }

  // Serialize storage writes: logout may overlap an in-flight login.
  Future<void> _writeToken(int session, String? token) {
    final write = _credentialWrites.catchError((Object _) {}).then((_) async {
      if (!_current(session)) return;
      if (token == null) {
        await _tokenStorage.clearToken();
      } else {
        await _tokenStorage.saveToken(token);
      }
    });
    _credentialWrites = write;
    return write;
  }

  Future<void> tryAutoLogin() async {
    if (!_isInitializing || _isLoading) return;
    final session = ++_session;
    try {
      final token = await _tokenStorage.readToken();
      if (!_current(session) || token == null || token.isEmpty) return;
      await _fetchProfile(session);
    } on ApiException catch (e) {
      if (!_current(session)) return;
      if (e.httpStatusCode == 401) {
        try {
          await _writeToken(session, null);
        } catch (_) {
          if (_current(session)) _errorMessage = '로그인 정보를 지우지 못했습니다';
        }
      } else {
        _errorMessage = e.message;
      }
    } catch (_) {
      if (_current(session)) {
        _errorMessage = '로그인 상태를 확인하지 못했습니다. 다시 로그인해주세요';
      }
    } finally {
      if (_current(session)) {
        _isInitializing = false;
        _notify();
      }
    }
  }

  Future<bool> login({required String email, required String password}) async {
    if (_isLoading) return false;
    final session = ++_session;
    _isLoading = true;
    _isInitializing = false;
    _errorMessage = null;
    _profileRefreshError = null;
    _currentUser = null;
    _notify();
    try {
      final data = await _apiClient.post(
        '/auth/login',
        body: {'email': email, 'password': password},
        withAuth: false,
      );
      if (!_current(session)) return false;
      final token = (data as Map<String, dynamic>)['accessToken'];
      if (token is! String || token.isEmpty) throw const FormatException();
      await _writeToken(session, token);
      if (!_current(session)) return false;
      await _fetchProfile(session);
      return _current(session) && isLoggedIn;
    } catch (e) {
      if (_current(session)) {
        _errorMessage = e is ApiException ? e.message : '로그인 중 오류가 발생했습니다';
        try {
          await _writeToken(session, null);
        } catch (_) {}
      }
      return false;
    } finally {
      if (_current(session)) {
        _isLoading = false;
        _notify();
      }
    }
  }

  Future<bool> signup({
    required String email,
    required String password,
    required String nickname,
  }) async {
    if (_isLoading) return false;
    final session = ++_session;
    _isInitializing = false;
    _isLoading = true;
    _errorMessage = null;
    _notify();
    try {
      await _apiClient.post(
        '/auth/signup',
        body: {'email': email, 'password': password, 'nickname': nickname},
        withAuth: false,
      );
      if (!_current(session)) return false;
      _isLoading = false;
      return await login(email: email, password: password);
    } catch (e) {
      if (_current(session)) {
        _errorMessage = e is ApiException ? e.message : '회원가입 중 오류가 발생했습니다';
      }
      return false;
    } finally {
      if (_current(session)) {
        _isLoading = false;
        _notify();
      }
    }
  }

  Future<void> refreshProfile() async {
    final user = _currentUser;
    if (user == null) return;
    final session = _session;
    final request = ++_profileRequest;
    try {
      await _fetchProfile(session, request: request, expectedId: user.id);
    } catch (e) {
      if (!_current(session) || request != _profileRequest) return;
      if (e is ApiException && e.httpStatusCode == 401) {
        await logout();
        if (!_disposed && _session == session + 1) {
          _errorMessage = '로그인이 만료되었습니다. 다시 로그인해주세요';
          _notify();
        }
      } else {
        _profileRefreshError = '잔액을 갱신하지 못했어요. 마지막 확인 금액입니다.';
        _notify();
      }
    }
  }

  Future<void> _fetchProfile(
    int session, {
    int? request,
    int? expectedId,
  }) async {
    final data = await _apiClient.get('/users/me');
    if (!_current(session) || (request != null && request != _profileRequest)) {
      return;
    }
    final user = AppUser.fromJson(data as Map<String, dynamic>);
    if (expectedId != null && user.id != expectedId) {
      throw const FormatException();
    }
    _currentUser = user;
    _profileRefreshError = null;
    _notify();
  }

  Future<void> logout() async {
    final session = ++_session;
    _currentUser = null;
    _isLoading = false;
    _isInitializing = false;
    _profileRefreshError = null;
    _errorMessage = null;
    _notify();
    try {
      await _writeToken(session, null);
    } catch (_) {
      if (_current(session)) {
        _errorMessage = '기기의 로그인 정보를 지우지 못했습니다. 다시 시도해주세요';
        _notify();
      }
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _session++;
    super.dispose();
  }
}
