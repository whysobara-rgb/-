# 가치가차 (gacha_vault)

실물 상품 랜덤박스 앱의 Flutter 클라이언트.

## 실행

백엔드 주소는 빌드할 때 넣는다(기본값 `http://localhost:3000`).

```sh
flutter pub get
flutter run --dart-define=API_BASE_URL=http://localhost:3000
flutter build web --release --no-web-resources-cdn --dart-define=API_BASE_URL=https://api.example.com
```

### 빌드 설정(dart-define)

- 소셜 로그인 키와 전체 dart-define 목록: [`docs/SOCIAL_LOGIN_SETUP.md`](docs/SOCIAL_LOGIN_SETUP.md)
- 디버그 전용 테스트 플래그(release 빌드에서는 컴파일 단계에서 빠진다)
  - `PAYMENT_SANDBOX=true`: 토스 결제창 대신 테스트 paymentKey(`pk_ok_`/`pk_decline_`/`pk_slow_`)로 서버 승인 흐름을 탄다
  - `SOCIAL_SANDBOX=true`: 제공자 SDK 대신 가짜 토큰을 보내는 소셜 버튼을 보여준다

### 체험판(`DEMO_MODE=true`)

서버 없이 브라우저 안에서만 도는 체험판. 결제·배송은 실제로 일어나지 않는다.

- 박스·확률·배너·충전 패키지: 실제 서버에서 찍은 스냅샷 `assets/demo/catalog.json`
  (갱신: 로컬 서버를 띄우고 `python3 tool/demo/snapshot_catalog.py`)
- 뽑기·천장·10+1·재고·포인트 전환·출석·월 충전 한도·첫 충전 보너스: 서버 규칙을 옮긴
  `lib/demo/`(`engine/rules.dart`, `backend/`)가 같은 응답 모양·응답 코드로 처리한다.
  기록은 이 기기의 localStorage에만 남는다.
- 체험 계정 `demo@gachigacha.app` / `demo1234`(200,000 체험 GP)가 로그인 화면에 채워져 있다.
- 웹 빌드(하위 경로·샌드박스 iframe에 올릴 정적 파일, 서비스 워커·CDN 없음):
  `python3 tool/demo/build_demo_web.py <출력 폴더>`
- 플래그 없는 빌드에는 체험판 코드가 들어가지 않는다(`DemoConfig.enabled`가 상수 false).

### 결제(토스페이먼츠)

- 충전은 `/payments/*`만 쓴다. 서버가 `enabled: false`면 충전을 막는다(데모 충전 `POST /wallet/topup`은 부르지 않는다).
- 토스 clientKey·customerKey는 서버(`GET /payments/config`)가 준다. 앱에 넣을 키는 없다.
- 결제위젯은 Android·iOS에서만 열린다. 웹은 "결제는 앱에서 가능해요"로 안내한다.
- 앱 스킴 `gachigacha://`(카드사 앱에서 돌아오기)는 AndroidManifest·Info.plist에 등록돼 있다.
- 출시 전 할 일: 카드사·간편결제 앱 호출용 목록을 [토스페이먼츠 문서](https://docs.tosspayments.com)대로 추가한다.
  - Android 11+: `<queries>`
  - iOS: `LSApplicationQueriesSchemes`

## 디자인 시스템

- 토큰: `lib/core/theme/` — 색(`app_colors.dart`), 타입 스케일(`app_typography.dart`),
  간격·모서리·모션(`app_spacing.dart`), 테마(`app_theme.dart`)
- 공용 위젯: `lib/shared/widgets/` (레어도 배지, 상품 이미지, 섹션·시트·상태 뷰)
- 숫자·금액·확률 포맷: `lib/core/utils/format.dart`
