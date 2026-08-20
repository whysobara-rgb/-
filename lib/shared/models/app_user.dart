/// 가치가차 - 로그인된 사용자 정보 모델.
///
/// 백엔드 `GET /users/me` 응답(`{id,email,nickname,coinBalance,createdAt}`)을
/// 기반으로 한다.
class AppUser {
  final int id;
  final String email;
  final String nickname;
  final int coinBalance;

  const AppUser({
    required this.id,
    required this.email,
    required this.nickname,
    required this.coinBalance,
  });

  factory AppUser.fromJson(Map<String, dynamic> json) {
    return AppUser(
      id: json['id'] as int,
      email: json['email'] as String,
      nickname: json['nickname'] as String? ?? '',
      coinBalance: (json['coinBalance'] as num?)?.toInt() ?? 0,
    );
  }

  /// 화면 표시용 이메일 마스킹 (예: "sohn****@gachigacha.com")
  String get maskedEmail {
    final atIndex = email.indexOf('@');
    if (atIndex <= 0) return email;
    final localPart = email.substring(0, atIndex);
    final domainPart = email.substring(atIndex);
    if (localPart.length <= 4) {
      return '$localPart****$domainPart';
    }
    return '${localPart.substring(0, 4)}****$domainPart';
  }

  AppUser copyWith({int? coinBalance}) {
    return AppUser(
      id: id,
      email: email,
      nickname: nickname,
      coinBalance: coinBalance ?? this.coinBalance,
    );
  }
}
