import '../social/social_auth_client.dart';

/// 소셜 로그인 한 번의 결과. 화면은 이 값만 보고 다음 행동을 정한다.
sealed class SocialLoginResult {
  const SocialLoginResult();
}

/// 로그인 완료(기존 회원이거나 방금 가입).
class SocialLoginSuccess extends SocialLoginResult {
  final bool isNewUser;
  const SocialLoginSuccess({required this.isNewUser});
}

/// 처음 온 사용자라 약관 동의가 필요하다(서버 10010). 토큰은 보관해 두었다가
/// 동의를 받으면 같은 토큰으로 다시 보낸다.
class SocialLoginNeedsConsent extends SocialLoginResult {
  final SocialProvider provider;
  final String? suggestedNickname;
  const SocialLoginNeedsConsent(this.provider, {this.suggestedNickname});
}

/// 같은 이메일이 다른 방법으로 가입돼 있다(서버 10011, errors에 provider:X).
class SocialLoginEmailTaken extends SocialLoginResult {
  final SocialProvider provider;

  /// 기존 가입 방식 코드(EMAIL/KAKAO/...). 서버가 주지 않으면 null.
  final String? existingProvider;
  const SocialLoginEmailTaken(this.provider, {this.existingProvider});

  String get existingLabel => signInMethodLabel(existingProvider);
}

/// 서버가 지금 이 제공자를 쓸 수 없다(10012).
class SocialLoginUnavailable extends SocialLoginResult {
  final SocialProvider provider;
  const SocialLoginUnavailable(this.provider);
}

/// 서버가 토큰을 받아주지 않았다(10002).
class SocialLoginInvalidToken extends SocialLoginResult {
  final SocialProvider provider;
  const SocialLoginInvalidToken(this.provider);
}

/// 사용자가 제공자 화면을 닫았다. 아무것도 안내하지 않는다.
class SocialLoginCancelled extends SocialLoginResult {
  const SocialLoginCancelled();
}

class SocialLoginFailed extends SocialLoginResult {
  final String message;
  const SocialLoginFailed(this.message);
}
