# 소셜 로그인 설정

카카오·네이버·구글·애플 로그인을 켜는 방법입니다. 앱 코드는 이미 들어 있고, 키와 콘솔 설정만 하면 됩니다.

## 동작 방식

1. 앱이 제공자 SDK로 로그인하고, SDK가 준 토큰만 서버로 보냅니다(`POST /auth/social-login`).
   - 카카오·네이버: access token
   - 구글: ID token
   - 애플: identity token
2. 서버가 제공자에게 토큰을 직접 검증합니다. 사용자 ID와 이메일은 이 검증 결과에서만 얻습니다.
3. 처음 온 사용자면 서버가 `10010`을 돌려줍니다. 앱은 약관 동의 시트를 띄우고, 동의를 받으면 같은 토큰으로 다시 보냅니다.
4. 같은 이메일이 다른 방법으로 가입돼 있으면 `10011`입니다. 앱은 "이미 ○○로 가입된 이메일이에요"라고 안내합니다. 계정을 이메일로 자동 연결하지 않습니다.

로그인 화면의 버튼은 아래 두 조건을 **모두** 만족할 때만 나옵니다.

- 서버 `GET /auth/providers`가 그 제공자를 돌려준다(서버 `.env`에 키가 있다).
- 앱 빌드에 그 제공자의 키(`--dart-define`)가 있고, 지금 플랫폼에서 SDK가 로그인을 지원한다.

둘 중 하나라도 없으면 버튼이 숨겨지고 이메일 로그인만 보입니다.

| 제공자 | Android | iOS | 웹 |
| --- | --- | --- | --- |
| 카카오 | O | O | X (카카오 Flutter SDK 2.x가 웹 로그인을 지원하지 않음) |
| 네이버 | O | O | X (플러그인이 Android·iOS 전용) |
| 구글 | O | O | X (google_sign_in 7.x 웹은 구글이 그린 버튼만 허용) |
| 애플 | △ 서버 콜백 필요(아래 참고) | O | △ Services ID 필요 |

코드 위치:

- `lib/features/auth/social/`: 제공자별 SDK를 감싼 `SocialAuthClient` 구현
- `lib/features/auth/social/social_auth_clients.dart`: 보이는 버튼 결정
- `lib/shared/providers/auth_provider.dart`: 로그인 흐름(`socialLogin`, `completeSocialSignup`)

## dart-define 목록

빌드할 때 넣습니다. 비워 두면 그 기능은 꺼집니다.

| 이름 | 쓰는 곳 | 설명 |
| --- | --- | --- |
| `API_BASE_URL` | 전체 | 백엔드 주소. 기본 `http://localhost:3000` |
| `KAKAO_NATIVE_APP_KEY` | Android·iOS | 카카오 네이티브 앱 키. URL 스킴 `kakao{키}`도 이 값으로 만듭니다 |
| `KAKAO_JS_APP_KEY` | 웹 | 카카오 JavaScript 키. SDK 초기화에만 넘깁니다(웹 로그인은 미지원) |
| `NAVER_CLIENT_ID` | Android·iOS | 네이버 Client ID. 이 값이 있어야 네이버 버튼이 나옵니다 |
| `NAVER_CLIENT_SECRET` | Android·iOS | 네이버 Client Secret |
| `NAVER_CLIENT_NAME` | Android·iOS | 네이버 로그인 화면에 보일 앱 이름 |
| `NAVER_URL_SCHEME` | iOS | 네이버 콘솔에 등록한 iOS URL 스킴 |
| `GOOGLE_SERVER_CLIENT_ID` | Android·iOS | 구글 **웹** 클라이언트 ID. ID 토큰의 aud가 됩니다. Android는 이 값만 있으면 됩니다 |
| `GOOGLE_IOS_CLIENT_ID` | iOS | 구글 iOS 클라이언트 ID. URL 스킴(역순 ID)은 빌드 스크립트가 계산합니다 |
| `APPLE_SERVICE_ID` | Android·웹 | Apple Services ID(웹 인증용) |
| `APPLE_REDIRECT_URI` | Android·웹 | Services ID에 등록한 https Return URL |
| `PAYMENT_SANDBOX` | 디버그 전용 | `true`면 테스트 결제 버튼을 보여줍니다. release 빌드에서는 컴파일 단계에서 빠집니다 |
| `SOCIAL_SANDBOX` | 디버그 전용 | `true`면 SDK 대신 가짜 토큰을 보내는 소셜 버튼을 보여줍니다. release 빌드에서는 빠집니다 |

키는 여러 개라 파일로 관리하는 편이 편합니다.

```sh
# social.prod.json (저장소에 올리지 마세요)
{
  "API_BASE_URL": "https://api.example.com",
  "KAKAO_NATIVE_APP_KEY": "...",
  "NAVER_CLIENT_ID": "...",
  "NAVER_CLIENT_SECRET": "...",
  "NAVER_CLIENT_NAME": "가치가차",
  "NAVER_URL_SCHEME": "gachigachanaver",
  "GOOGLE_SERVER_CLIENT_ID": "1234-web.apps.googleusercontent.com",
  "GOOGLE_IOS_CLIENT_ID": "1234-ios.apps.googleusercontent.com"
}

flutter build appbundle --release --dart-define-from-file=social.prod.json
flutter build ipa --release --dart-define-from-file=social.prod.json
```

### 네이티브 설정에 키가 들어가는 방식

SDK 일부는 Dart가 아니라 네이티브 설정(AndroidManifest, Info.plist)에서 키를 읽습니다. 같은 dart-define에서 자동으로 채웁니다.

- **Android:** `android/app/build.gradle.kts`가 Flutter의 `dart-defines` Gradle 속성을 풀어서 채웁니다.
  - `manifestPlaceholders["kakaoScheme"]`: 카카오 리디렉트 스킴
  - `resValue` `naver_client_id`, `naver_client_secret`, `naver_client_name`: 네이버 SDK가 읽는 값
- **iOS:** Xcode 스킴 `Runner`의 Build 사전 작업(Pre-action)이 `ios/scripts/dart_defines_to_xcconfig.sh`를 실행합니다.
  - 스크립트가 `ios/Flutter/DartDefines.xcconfig`를 만들고, `Debug.xcconfig`·`Release.xcconfig`가 이 파일을 `#include?` 합니다.
  - `Info.plist`의 `$(KAKAO_NATIVE_APP_KEY)`, `$(NAVER_*)`, `$(GOOGLE_*)`가 그 값으로 바뀝니다.
  - 생성 파일은 `.gitignore`에 들어 있습니다.
  - 확인: 빌드 후 `ios/Flutter/DartDefines.xcconfig`에 값이 들어 있어야 합니다.

## 서버 설정

백엔드 `.env`에 아래 값을 넣어야 `GET /auth/providers`에 제공자가 나옵니다(`gacha-vault-backend` README 참고).

| 서버 변수 | 넣을 값 |
| --- | --- |
| `KAKAO_APP_ID` | 카카오 앱 ID(숫자). 서버가 토큰의 `app_id`와 비교합니다 |
| `NAVER_CLIENT_ID` | 네이버 Client ID |
| `GOOGLE_CLIENT_IDS` | 쉼표로 구분. `GOOGLE_SERVER_CLIENT_ID`(웹 클라이언트 ID)와 `GOOGLE_IOS_CLIENT_ID`를 모두 넣으세요 |
| `APPLE_CLIENT_IDS` | 쉼표로 구분. iOS 번들 ID `com.gachavault.gacha`와, Android·웹을 쓰면 `APPLE_SERVICE_ID`도 넣으세요 |

## 카카오

1. [Kakao Developers](https://developers.kakao.com)에서 애플리케이션을 만듭니다.
2. **앱 키**에서 네이티브 앱 키를 `KAKAO_NATIVE_APP_KEY`로 씁니다. 앱 ID는 서버 `KAKAO_APP_ID`입니다.
3. **플랫폼**을 등록합니다.
   - Android: 패키지명 `com.gachavault.gacha`, 키 해시(디버그·릴리스·Play 앱 서명 키 모두).
     ```sh
     keytool -exportcert -alias <alias> -keystore <keystore> | openssl sha1 -binary | openssl base64
     ```
   - iOS: 번들 ID `com.gachavault.gacha`
4. **카카오 로그인**을 켜고, 동의 항목에서 닉네임·카카오계정(이메일)을 설정합니다.
   - 이메일이 없으면 서버가 내부용 주소로 계정을 만듭니다.
5. 앱 쪽은 이미 들어 있습니다.
   - Android: `AndroidManifest.xml`의 `AuthCodeHandlerActivity`(스킴 `kakao{키}`, host `oauth`)
   - iOS: `Info.plist`의 URL 스킴 `kakao$(KAKAO_NATIVE_APP_KEY)`, `LSApplicationQueriesSchemes`(kakaokompassauth, kakaolink, kakaoplus)
   - Dart: `main.dart`가 시작할 때 `KakaoSdk.init`(키가 있을 때만)

## 네이버

1. [네이버 개발자 센터](https://developers.naver.com)에서 애플리케이션을 등록합니다(사용 API: 네이버 로그인).
2. 제공 정보에서 이메일·별명을 선택합니다.
3. 환경 추가
   - Android: 패키지명 `com.gachavault.gacha`
   - iOS: 번들 ID와 URL 스킴(예: `gachigachanaver`). 이 스킴을 `NAVER_URL_SCHEME`으로 씁니다.
4. Client ID·Secret을 `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`으로, 앱 이름을 `NAVER_CLIENT_NAME`으로 씁니다.
5. 앱 쪽은 이미 들어 있습니다.
   - Android: `MainActivity`가 `FlutterFragmentActivity`를 상속, 매니페스트 meta-data `com.naver.sdk.*`
   - iOS: `Info.plist`의 `NidClientID` 등, `AppDelegate.swift`의 `NidOAuth.shared.handleURL`
6. 알아둘 점
   - 네이버 네이티브 SDK는 Client Secret을 앱에 넣는 방식입니다.
   - 서버는 네이버 토큰이 어느 앱에서 발급됐는지 확인할 수 없습니다. 백엔드 README "출시 전 체크리스트"의 네이버 항목을 보세요.

## 구글

1. [Google Cloud Console](https://console.cloud.google.com)에서 OAuth 동의 화면을 설정합니다.
2. OAuth 클라이언트 ID를 세 개 만듭니다.
   - **웹 애플리케이션:** 이 ID가 `GOOGLE_SERVER_CLIENT_ID`이자 서버 `GOOGLE_CLIENT_IDS`의 첫 값입니다.
   - **Android:** 패키지명과 SHA-1 인증서 지문(디버그·릴리스·Play 앱 서명 키). 앱에는 넣지 않습니다.
   - **iOS:** 번들 ID. 이 ID가 `GOOGLE_IOS_CLIENT_ID`입니다. 서버 `GOOGLE_CLIENT_IDS`에도 넣으세요.
3. 앱 쪽은 이미 들어 있습니다.
   - iOS: `Info.plist`의 `GIDClientID`·`GIDServerClientID`와 역순 클라이언트 ID URL 스킴(`$(GOOGLE_REVERSED_CLIENT_ID)`)

## 애플

### iOS

1. Apple Developer에서 App ID `com.gachavault.gacha`에 **Sign in with Apple**을 켭니다.
2. Xcode에서 Runner 타깃의 **Signing & Capabilities**에 **Sign in with Apple**을 추가합니다.
   - 이 작업이 `Runner.entitlements`를 만듭니다.
   - 저장소에는 넣지 않았습니다. 프로비저닝 프로필에 권한이 없으면 서명이 깨지기 때문입니다.
3. 서버 `APPLE_CLIENT_IDS`에 번들 ID를 넣습니다.
4. App Store 심사 지침 4.8에 따라, iOS에서 다른 소셜 로그인을 제공하면 애플 로그인도 제공해야 합니다.
   - 서버가 APPLE을 돌려주면 iOS에서는 키 없이 버튼이 나옵니다.

### Android·웹 (선택)

1. **Services ID**를 만들고 Sign in with Apple을 켭니다. 도메인과 Return URL(https)을 등록합니다.
2. `APPLE_SERVICE_ID`, `APPLE_REDIRECT_URI`를 넣고, 서버 `APPLE_CLIENT_IDS`에 Services ID를 추가합니다.
3. **Android는 서버 콜백이 필요합니다.**
   - Apple은 Return URL로 form POST를 보냅니다.
   - 그 엔드포인트가 받은 본문을 그대로 붙여 앱으로 되돌려야 합니다.
     ```
     intent://callback?<받은 본문(urlencoded)>#Intent;package=com.gachavault.gacha;scheme=signinwithapple;end
     ```
   - 현재 백엔드에는 이 엔드포인트가 없습니다. 만들기 전까지는 Android에서 `APPLE_*`를 비워 두세요(버튼이 숨겨집니다).
   - 앱 쪽 `SignInWithAppleCallback` 액티비티는 매니페스트에 들어 있습니다.

## 확인 방법

- **단위 테스트(키 없이):** `flutter test test/social_login_flow_test.dart`
  - 가짜 `SocialAuthClient`로 성공, 10010 → 동의 → 같은 토큰 재전송, 10011/10012/10002, 취소를 확인합니다.
- **화면 확인(키 없이):** 디버그 빌드에 `--dart-define=SOCIAL_SANDBOX=true`를 주면 모든 제공자 버튼이 "테스트 로그인"으로 나옵니다.
  - 가짜 토큰을 보내므로 실제 서버는 10012/10002로 거절합니다.
  - 동의 시트는 서버 응답을 가로채서 확인합니다.
- **실기기(키 필요):** 제공자마다 아래를 확인하세요.
  - [ ] 신규 가입: 동의 시트 → 가입 축하 GP 화면
  - [ ] 기존 회원 재로그인
  - [ ] 다른 방법으로 가입한 이메일 → 10011 안내
  - [ ] 로그아웃 후 다른 계정으로 로그인
  - [ ] 앱을 지웠다 다시 깔아도 같은 계정으로 로그인
