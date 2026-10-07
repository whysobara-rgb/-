import '../../../core/network/api_client.dart';
import '../../../core/utils/format.dart';
import '../domain/agreements.dart';

/// 로그인·가입이 돌려준 세션.
class AuthSession {
  final String accessToken;

  /// 소셜 로그인으로 방금 계정이 만들어졌는지.
  final bool isNewUser;

  /// 가입 축하로 지급된 GP. 신규 가입일 때만 온다.
  final int? welcomeGp;

  const AuthSession({
    required this.accessToken,
    this.isNewUser = false,
    this.welcomeGp,
  });

  factory AuthSession.fromJson(Map<String, dynamic> json) {
    final token = asStringOrNull(json['accessToken']);
    if (token == null) {
      throw ApiException(statusCode: -2, message: '로그인 응답에 토큰이 없어요');
    }
    return AuthSession(
      accessToken: token,
      isNewUser: asBool(json['isNewUser']),
      welcomeGp: asIntOrNull(json['welcomeGp']),
    );
  }
}

/// `/auth/*` API.
class AuthRepository {
  final ApiClient _api;

  const AuthRepository({ApiClient apiClient = const ApiClient()})
    : _api = apiClient;

  Future<AuthSession> login({
    required String email,
    required String password,
  }) async {
    final data = await _api.post(
      '/auth/login',
      body: {'email': email, 'password': password},
      withAuth: false,
    );
    return AuthSession.fromJson(asMap(data));
  }

  /// 가입. 서버는 토큰 없이 계정만 만들고 `welcomeGp`를 돌려준다.
  /// 필수 동의가 없으면 10010.
  Future<int?> signup({
    required String email,
    required String password,
    required String nickname,
    required Agreements agreements,
  }) async {
    final data = await _api.post(
      '/auth/signup',
      body: {
        'email': email,
        'password': password,
        'nickname': nickname,
        ...agreements.toJson(),
      },
      withAuth: false,
    );
    return asIntOrNull(asMap(data)['welcomeGp']);
  }

  /// 서버가 토큰을 검증할 수 있는 소셜 제공자 코드 목록.
  Future<List<String>> providers() async {
    final data = asMap(await _api.get('/auth/providers', withAuth: false));
    final raw = data['providers'];
    return raw is List
        ? raw.map((e) => e.toString().toUpperCase()).toList()
        : const [];
  }

  /// 소셜 로그인. 처음 오는 사용자는 [agreements]가 있어야 가입된다(없으면 10010).
  Future<AuthSession> socialLogin({
    required String provider,
    required String token,
    String? nickname,
    Agreements? agreements,
  }) async {
    final data = await _api.post(
      '/auth/social-login',
      body: {
        'provider': provider,
        'token': token,
        if (nickname != null && nickname.trim().isNotEmpty)
          'nickname': nickname.trim(),
        ...?agreements?.toJson(),
      },
      withAuth: false,
    );
    return AuthSession.fromJson(asMap(data));
  }
}
