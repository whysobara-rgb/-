import 'package:flutter/material.dart';

/// 서버 `AuthProvider` enum 중 소셜 로그인 제공자.
enum SocialProvider {
  kakao('KAKAO', '카카오'),
  naver('NAVER', '네이버'),
  google('GOOGLE', '구글'),
  apple('APPLE', 'Apple');

  const SocialProvider(this.code, this.label);

  /// 서버로 보내는 값.
  final String code;

  /// 화면 표시명. 모두 받침이 없거나 ㄹ이라 "~로"가 붙는다.
  final String label;

  static SocialProvider? fromCode(Object? code) {
    final upper = code?.toString().toUpperCase();
    for (final p in values) {
      if (p.code == upper) return p;
    }
    return null;
  }
}

/// 서버의 가입 방식 코드(EMAIL 포함)를 화면 표시명으로.
String signInMethodLabel(String? code) {
  if (code == null || code.toUpperCase() == 'EMAIL') return '이메일';
  return SocialProvider.fromCode(code)?.label ?? code;
}

/// 제공자 SDK가 발급한 토큰. 서버가 제공자에게 직접 검증한다.
///
/// - KAKAO/NAVER: access token
/// - GOOGLE: ID token
/// - APPLE: identity token
class SocialCredential {
  final String token;

  /// 제공자 프로필 이름(있으면 최초 가입 닉네임 후보).
  final String? nickname;

  const SocialCredential({required this.token, this.nickname});
}

/// 사용자가 제공자 화면에서 그냥 닫았다. 아무 안내도 하지 않는다.
class SocialSignInCancelled implements Exception {
  const SocialSignInCancelled();
}

/// SDK 단계에서 실패했다(키 설정 오류, 네트워크 등).
class SocialSignInFailed implements Exception {
  final String message;
  const SocialSignInFailed(this.message);

  @override
  String toString() => message;
}

/// 제공자 SDK 하나를 감싼다. 화면과 로그인 흐름은 이 인터페이스만 안다.
///
/// 웹처럼 SDK가 로그인을 지원하지 않는 곳이나 키가 없는 빌드에서는
/// [isAvailable]이 false라 버튼이 나오지 않는다.
abstract class SocialAuthClient {
  SocialProvider get provider;

  /// 이 빌드·플랫폼에서 쓸 수 있는지(키가 있고 SDK가 지원하는지).
  bool get isAvailable;

  /// 제공자 로그인 화면을 띄우고 서버로 보낼 토큰을 돌려준다.
  ///
  /// 사용자가 닫으면 [SocialSignInCancelled], 그 밖의 실패는
  /// [SocialSignInFailed]를 던진다.
  Future<SocialCredential> signIn(BuildContext context);

  /// 제공자 쪽 세션을 정리한다(앱 로그아웃·탈퇴 때). 실패는 무시한다.
  Future<void> signOut();
}
