# 가치가차 (GACHI GACHA)

Flutter 기반 랜덤박스 앱. **현재 출시 준비 단계이며 운영 결제·소셜 인증·서버 검증이 완료된 앱이 아닙니다.**

- [출시 설계·구성도·단계별 가이드](docs/LAUNCH_BLUEPRINT.ko.md)
- [목표 거래 API 계약](docs/TRANSACTION_API.ko.md)
- [변경 및 검증 기록](docs/VALIDATION.ko.md)

## 개발 실행

Flutter 3.35.4 / Dart 3.9.2 기준. 운영 비밀키를 앱이나 Git에 넣지 않습니다.

```sh
flutter pub get --enforce-lockfile
flutter analyze
flutter test
flutter run --dart-define=API_BASE_URL=https://YOUR_STAGING_API
```

`API_BASE_URL`은 유효한 HTTPS 주소가 필수입니다. 임시 서버 주소를 기본값으로 사용하지 않습니다. 토큰은 보안 저장소에 저장하며 이전 평문 세션은 재로그인이 필요합니다.

기존 `/draws`와 `/shipping-requests`는 미검증 거래 경로여서 기본 비활성입니다. 격리된 테스트 서버에 한해서 debug/profile 실행 시 `--dart-define=ENABLE_LEGACY_TRANSACTIONS=true`로 확인할 수 있습니다. release에서는 이 값으로 활성화할 수 없습니다. GP 충전과 모의 소셜 인증은 제거했습니다. 서버에서도 해당 취약 경로를 폐쇄해야 합니다.

## 출시 빌드 전

백엔드·다날·OAuth·연령·배송 정책·운영 QA와 문서의 출시 게이트를 먼저 완료합니다. 그 후 Android 업로드 서명 정보를 로컬 `android/key.properties`에 설정하고 기존 Play 버전보다 큰 build number로 빌드합니다. 기존 앱의 패키지명과 서명키를 임의 변경하지 않습니다. iOS는 macOS/Xcode와 별도 서명·Keychain 검증이 필요합니다.

```sh
flutter build appbundle --release --dart-define=API_BASE_URL=https://YOUR_PRODUCTION_API
```

현재 이 명령으로 만드는 파일도 거래 차단 상태의 출시 준비 빌드입니다. 운영 완료 버전으로 배포하지 않습니다. 첨부 AAB와 저장소 소스의 일치 여부는 확인되지 않았습니다.
