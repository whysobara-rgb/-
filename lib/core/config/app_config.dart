import 'package:flutter/foundation.dart';

/// 빌드할 때 `--dart-define`으로 넣는 설정.
///
/// 키가 비어 있는 기능은 화면에 나오지 않는다(서버가 지원한다고 해도).
/// 값과 발급 방법은 `docs/SOCIAL_LOGIN_SETUP.md`에 정리돼 있다.
class AppConfig {
  AppConfig._();

  /// 백엔드 주소.
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:3000',
  );

  // ── 카카오 ──────────────────────────────────────────────
  /// 네이티브 앱 키. Android/iOS 로그인에 쓴다. URL 스킴은 `kakao{키}`.
  static const String kakaoNativeAppKey = String.fromEnvironment(
    'KAKAO_NATIVE_APP_KEY',
  );

  /// JavaScript 키. SDK 초기화에만 넘긴다. 카카오 Flutter SDK 2.x는
  /// 웹 로그인을 지원하지 않아 웹에서는 카카오 버튼을 숨긴다.
  static const String kakaoJsAppKey = String.fromEnvironment(
    'KAKAO_JS_APP_KEY',
  );

  // ── 네이버 ──────────────────────────────────────────────
  /// 네이버 키는 네이티브 설정(strings.xml / Info.plist)에서 읽힌다.
  /// 빌드 스크립트가 같은 dart-define에서 그 값을 채우고, 앱은 이 값이
  /// 있을 때만 네이버 버튼을 보여준다.
  static const String naverClientId = String.fromEnvironment(
    'NAVER_CLIENT_ID',
  );

  // ── 구글 ────────────────────────────────────────────────
  /// 서버가 ID 토큰의 aud로 확인하는 웹(서버) 클라이언트 ID.
  /// Android는 이 값만 있으면 된다.
  static const String googleServerClientId = String.fromEnvironment(
    'GOOGLE_SERVER_CLIENT_ID',
  );

  /// iOS 클라이언트 ID. iOS에서는 이 값이 있어야 구글 버튼이 나온다.
  static const String googleIosClientId = String.fromEnvironment(
    'GOOGLE_IOS_CLIENT_ID',
  );

  // ── 애플 ────────────────────────────────────────────────
  /// Android·웹에서 Sign in with Apple을 쓸 때의 Services ID.
  /// iOS는 네이티브라 필요 없다.
  static const String appleServiceId = String.fromEnvironment(
    'APPLE_SERVICE_ID',
  );

  /// Android·웹의 Apple 리디렉트 URI(https, Apple 콘솔에 등록한 주소).
  static const String appleRedirectUri = String.fromEnvironment(
    'APPLE_REDIRECT_URI',
  );

  // ── 결제 ────────────────────────────────────────────────
  /// 앱 스킴. 카드사 앱(ISP 등)에서 결제를 마치고 돌아올 때 쓴다.
  static const String appScheme = 'gachigacha';

  /// 테스트 결제(샌드박스). `--dart-define=PAYMENT_SANDBOX=true`로 켠다.
  ///
  /// release 빌드에서는 [kReleaseMode]가 상수 true라 이 값이 상수 false가
  /// 되고, 이 값으로 감싼 코드는 컴파일 단계에서 빠진다.
  static const bool paymentSandbox =
      !kReleaseMode && bool.fromEnvironment('PAYMENT_SANDBOX');
}
