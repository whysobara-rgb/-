import '../../core/utils/format.dart';

/// 가치가차 - 로그인된 사용자 정보 모델.
///
/// 백엔드 `GET /users/me` 응답
/// (`{id,email,nickname,coinBalance,provider,role,marketingAgreed,createdAt}`)을
/// 기반으로 한다. 구버전 서버처럼 필드가 빠져도 기본값으로 떨어진다.
class AppUser {
  final int id;
  final String email;
  final String nickname;
  final int coinBalance;

  /// 가입 방식: EMAIL / KAKAO / NAVER / GOOGLE / APPLE.
  final String provider;

  /// USER / ADMIN.
  final String role;

  /// 마케팅 정보 수신 동의 여부.
  final bool marketingAgreed;
  final DateTime? createdAt;

  const AppUser({
    required this.id,
    required this.email,
    required this.nickname,
    required this.coinBalance,
    this.provider = 'EMAIL',
    this.role = 'USER',
    this.marketingAgreed = false,
    this.createdAt,
  });

  factory AppUser.fromJson(Map<String, dynamic> json) {
    return AppUser(
      id: asInt(json['id']),
      email: asStringOrNull(json['email']) ?? '',
      nickname: asStringOrNull(json['nickname']) ?? '',
      coinBalance: asInt(json['coinBalance']),
      provider: (asStringOrNull(json['provider']) ?? 'EMAIL').toUpperCase(),
      role: (asStringOrNull(json['role']) ?? 'USER').toUpperCase(),
      marketingAgreed: asBool(json['marketingAgreed']),
      createdAt: asDateOrNull(json['createdAt']),
    );
  }

  /// 운영자 모드 진입 가능 여부. 서버도 매 요청마다 권한을 다시 확인한다.
  bool get isAdmin => role == 'ADMIN';

  bool get isEmailAccount => provider == 'EMAIL';

  /// 소셜 가입자 중 제공자가 이메일을 주지 않은 경우 서버가 만든 주소.
  bool get hasPlaceholderEmail => email.endsWith('.invalid');

  /// 화면 표시용 이메일 마스킹 (예: "sohn****@gachigacha.com")
  String get maskedEmail {
    if (hasPlaceholderEmail) return '';
    final atIndex = email.indexOf('@');
    if (atIndex <= 0) return email;
    final localPart = email.substring(0, atIndex);
    final domainPart = email.substring(atIndex);
    if (localPart.length <= 4) {
      return '$localPart****$domainPart';
    }
    return '${localPart.substring(0, 4)}****$domainPart';
  }

  AppUser copyWith({
    int? coinBalance,
    String? nickname,
    bool? marketingAgreed,
  }) {
    return AppUser(
      id: id,
      email: email,
      nickname: nickname ?? this.nickname,
      coinBalance: coinBalance ?? this.coinBalance,
      provider: provider,
      role: role,
      marketingAgreed: marketingAgreed ?? this.marketingAgreed,
      createdAt: createdAt,
    );
  }
}
