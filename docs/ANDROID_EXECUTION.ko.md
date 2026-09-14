# Android 실행 검증과 테스트 APK

## 자동 실행

`Android execution` 워크플로가 Flutter 3.35.4와 Java 17로 앱의 실제 `lib/main.dart`를 debug APK로 빌드한다. 테스트 패키지 ID는 `com.gachavault.gacha.debug`, 표시 이름은 `가치가차 테스트`이며 운영 패키지와 분리된다.

CI의 `android-debug-app` 아티팩트에 APK, SHA-256, 빌드 범위 설명이 포함된다. 기본 API 주소는 비어 있으므로 별도 주소를 설정하지 않은 APK는 설치·로그인 화면 기동 확인용이다. 이 APK로 서비스 로그인·구매가 가능하다고 안내하지 않는다. 운영 서명 AAB를 만들거나 스토어에 배포하지 않는다.

## 에뮬레이터 검사

Android API 35 x86_64의 새 에뮬레이터에서 다음을 실행한다.

1. 실제 앱 APK를 설치하고 로그인 화면의 접근성 트리에 `로그인`이 나타나는지 확인한다. 화면 PNG와 접근성 XML을 증거로 저장한다.
2. 별도 CI 전용 진입점 `tool/android/storage_probe.dart`를 빌드·설치한다. 이 검사용 APK는 사용자 배포 아티팩트에 포함하지 않는다.
3. 실제 Flutter secure storage 플러그인을 통해 테스트 구매 키/본문과 개봉 ID를 저장한다. HTTP 응답 유실은 모의 전송 계층에서 발생시킨다.
4. adb로 앱 프로세스를 강제 종료하고 새 프로세스로 실행한다. 메모리 저장소를 사용하지 않고 이전 기록을 읽는지 확인한다.
5. 원래 키/본문으로 구매를 재요청하고 개봉 결과는 GET으로 복구한다. 확인 후 저장 기록이 삭제되는지 검사한다.

로그의 WRITTEN/VERIFIED 표식, 프로세스 교체, UI 트리를 검사해 성공을 판정한다. 에뮬레이터 스크립트는 GITHUB_ACTIONS 환경과 emulator-5554만 대상으로 하며, 데이터 초기화도 이 임시 에뮬레이터의 debug 패키지에 한정한다.

## 검증의 경계

실제 Android 플러그인/Keystore 연계 및 프로세스 종료 후 영속성을 검증한다. 실제 API 서버의 결제/상품 지급, 이동통신 전환, 실물 Android 기기 제조사별 차이, 재설치/기기 이전, iOS Keychain, 다날·환불 검증은 포함하지 않는다. HTTP 모의 결과는 실제 서버 거래 성공으로 간주하지 않는다.

자동 검사와 산출물의 최종 결과는 PR의 `Android execution` 실행에서 확인한다. 참고 구성: [Android Emulator Runner 공식 저장소](https://github.com/ReactiveCircus/android-emulator-runner).

## 실제 테스트 서버 연결

사용 가능한 HTTPS 테스트 API 주소와 최신 마이그레이션/GP·확률 fixture가 필요하다. GitHub 저장소 변수 `GACHA_TEST_API_URL` 또는 워크플로 수동 실행 입력 `api_base_url`로 주소를 지정한다. 사용자 비밀번호, JWT, PG 키를 코드나 workflow 입력에 넣지 않는다. 테스트 계정은 앱 로그인 화면에서 사용한다.

```sh
flutter build apk --debug \
  --dart-define=API_BASE_URL=https://YOUR_TEST_API \
  --dart-define=ENABLE_GP_ORDER_PREVIEW=true
```

release에서는 기존 정책대로 거래 preview가 차단된다. 테스트 서버에서 구매 직후 Wi-Fi 끄기, 앱 강제 종료, 재로그인, 같은 키 복구, 개봉 결과 복구를 진행하고 서버 원장/캡슐/상품 수량을 대조해야 실제 거래 인수 검증이 완료된다.
