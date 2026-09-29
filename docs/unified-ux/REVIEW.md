# 가치가차 통합 UX 검토 R1

## 기준과 범위

- Flutter source: `44e40082371681dcc890c9d36b244676adbcfc54`, 성공 tag `staging-build-4c2c-preview-fix1-20260927`, 성공 run `36314214080`.
- 분리 작업: `codex/unified-ux-refinement`. 기존 PR #1 Draft/Open, main과 기존 tag는 변경하지 않는다.
- Sites source/public V33: `01dfcf1aebfea7a6fb97394a796950e3d54b5107`. 이번 웹 변경은 미게시 저장용이다.
- Backend: `a224c07435f7ba17b65baf0c6d7ab2c5b9e629a7`, staging origin `https://gacha-vault-backend-staging.onrender.com`.
- Firebase 현재 설치/배포본: 콘솔 인증 연결이 502로 차단되어 이번 세션에서는 확인하지 못했다. 성공 GitHub run과 실제 설치본이 동일하다고 단정하지 않는다.
- 원격 PC DESKTOP-6RKC3U4 연결은 되지만 요청 경로에 저장소가 없다. 기존 PC/폴더는 변경하지 않고 분리 worktree에서 진행했다.
- 검토 앱 버전: 1.0.0 (2). applicationId, bundle ID, signing 자산/기기/Keychain, `!kReleaseMode`, GP preview 범위는 유지한다.

## 원인 및 화면별 대조

| 화면 | 기존 웹 / 실제 Flutter 소스 | 데이터·설정 출처 | 확인한 차이·근거 | 이번 대응 / 남은 확인 |
|---|---|---|---|---|
| 로그인 | app.js authPage / LoginPage·SignupPage | 기존 Backend 인증 | 독립 HTML과 Widget, 문구·여백·입력 UX 차이 | Flutter inline 필수 오류, 키보드/autofill, 간결한 heading; 기존 인증 정책 유지 |
| Home | retailHomePage / HomeScreen | 웹 Sandbox 모의 5박스 vs Flutter HomePage 실제 catalog/provider | 웹 concept 사진·퀵메뉴·반복목록, 앱에는 동일 사진 없음 | Hero 한 개, 같은 orb/문구, 최대4개, 중복메뉴 제거; 같은 fixture로 비교 |
| Shop | retailShopPage / BoxShopScreen | 같은 catalog를 Home/Shop이 공유; web local 관심 기능 | 웹만 가격범위·관심 저장·layout 기능, 실제 Flutter에는 근거 없음 | 검색/정렬 보존, 카테고리 Wrap. 플랫폼별 기존 기능 차이 명시; 서버 찜 신설 안 함 |
| Detail | retailDetailPage / ProductDetailView | gachas/:id + odds | 웹은 sandbox 참고가/카드 결제 체험까지 있음, Flutter는 GP 중심 | 사진 누락 영역 축소, 정보→구성/확률→수량/확인 순서. 통화·정책 변경 없음 |
| 구매 | buyPage/transact / OrderFlowPage | 서버 snapshot/가격/확률 버전 | 구현·환경 gate 차이. 과거 gate closed 화면을 현재 결함으로 판정하지 않음 | 구매 완료에 바로 개봉(미개봉 선택 이동)/나중에 개봉. 자동 open 없음 |
| 개봉 | Canvas opening-view / GachiOpeningExperience | capsule별 순차 API, 확정 결과 | 3D/음향 자산·렌더러 차이; 서버 bulk transaction 아님 | 같은 중립 orb. Skip/대기/복구/lifecycle/controller는 그대로 |
| 결과 | opening-results/batch-ui / BatchResultView·PrizeReveal | 서버 확정 prize/inventory | grade 표현·group disclosure 차이 | 최초3종+모두 보기, 수량 보존. 사진→상품→상태→보관함 CTA. 실제 사진 없으면 placeholder |
| 보관함 | retailCollectionPage / InventoryPage→CollectionDetailPage | inventory 서버 상태 | 웹 mock 옵션·가치 vs actual API 필드 차이 | 모델·선택·잠금·배송/전환 gate 유지, 공통 이미지 개선. 실기기 상태 동기화 미검증 |
| My | retailProfilePage / ProfilePage | users/me, GP provider | 길게 나열된 서로 다른 메뉴 | 주문/배송·고객지원 우선, 활동·계정보안 하위 그룹. 모든 기존 경로 보존 |
| Admin | admin.js / Flutter에는 관리자 없음 | Sandbox localStorage 또는 Remote API | **웹 Remote origin은 기존 gacha-vault-backend.onrender.com**, Flutter staging과 다름 | 연결 공백을 명시. 이번 작업에서 기존 origin·운영 API에 접근/변경하지 않음 |

주 원인은 별도 구현, 서로 다른 fixture/사진/계정 데이터, 서로 다른 origin이다. Firebase 배포 버전·설치 캐시·물리 기기 글꼴/OS 영향은 이번 실행에서 미확인이다. 서버에 없는 상품 사진을 UI가 만들어 채우지 않는다.

## 공통 디자인·문구·행동

- Navy #081C32 / Ink #10253D / Ivory #F7F3EA / Surface #FFFDF9 / Gold #CFAA61 / Divider #E7E3DA 유지.
- `GachiType` 공통 meta14/English12, text scaling 고정 없음. spacing/radius/button/SafeArea는 기존 공통 토큰 재사용.
- `GachiDiscoveryHero`: GACHI DISCOVERY / 일상을 여는 새로운 발견 / 박스 둘러보기.
- 기존 승인 `gachi-orb.webp`만 공유. 상품 사진이 아닌 중립 브랜드 오브젝트. 다른 서비스 그래픽 복제 없음.
- `GachiProductImage`: loading/error/absent 고정 비율·읽을 수 있는 최소 높이, 밝은 placeholder, 실제 상품명 접근 보존.
- categories 전체/테크/리빙/럭셔리/패션/푸드/기타. Wrap으로 가려진 가로 항목 제거.
- 서버 제공 badge만 Flutter가 표시. 웹의 무근거 BEST/HOT/NEW/LIMITED 강조 제거.
- 구매와 개봉은 별개. 바로 개봉은 선택 화면 이동이며 POST open을 자동 실행하지 않는다.
- 결과는 confirmed만 표시; pending과 unopened/retained/REFUNDED를 섞지 않는다. 환불 DTO·mapper 무변경.
- 기존 result/inventory 식별·snapshot·재요청·GP계산·ownership·AuthProvider·repositories·DTO 무변경.
- Review catalog: `flutter run -t tool/unified_ux/catalog.dart` (debug만). 실제 Widget, 합성 데이터, preview 본문 IgnorePointer. 앱 main에서 import하지 않는다.
- `tool/unified_ux/fixture.json`과 Sites `scripts/unified-ux-fixture.json`은 동일. Home/Shop/Detail 상품·GP·확률 parity. Result/Collection/My 추가 catalog는 기존 Stage2 synthetic fixture이며 실제 staging 데이터가 아니다.

## 고객 구성도

홈 → 박스샵(검색/분류/정렬) → 상세(구성/확률/수량) → 구매 확인 → 미개봉 선택 → 개봉 → 확정 결과 → 보관함 → 기존 배송/전환 상세.

하단: 홈 / 박스샵 / 개봉 / 보관함 / 마이. 랭킹은 Home footer, GP 지갑은 Header와 My 요약. My의 주문/환불·배송·고객지원은 직접 접근. 내 활동은 컬렉션/전환·복구/포인트 내역, 계정·보안은 보안/인증/탈퇴, 로그아웃은 기존 확인 유지. 기존 route는 삭제하지 않는다.

## 관리자 18메뉴 / 5그룹

| 그룹 | 기존 메뉴 |
|---|---|
| 오늘 | overview |
| 주문·고객 | orders / trace / finance / shipping / cases / support |
| 상품·공급 | catalog / warehouse / procurement |
| 콘텐츠 | campaigns / notices |
| 설정·기록 | economics / audit / control / diagnosis / coverage / guide |

`ux-navigation.js`의 18개 unique route 검증을 유지한다. Overview는 미처리 수량 있는 업무 우선. 상품/배너/공지 폼에는 저장 전 변경 필드 목록을 추가했다. 초안 저장과 공개/판매 적용은 기존 별도 동작이다. 브라우저 저장을 서버 성공으로 표현하지 않는다.

### 관리자 → 앱 연결표 (소스 검증, 서버 변경·운영 write 미실행)

| 항목 | 저장 위치/API | 앱 조회/화면 | 갱신 | 권한/이력 및 공백 |
|---|---|---|---|---|
| 박스명/설명/사진/가격/판매수량 | Sandbox operationsCatalog 또는 POST /ops/catalog/:id/draft → /publish | GET /gachas, /gachas/:id → title/description/imageUrl/price/totalStock/soldStock → Home/Shop/Detail | Home refresh, Detail 재조회 | ops capability/역할, expectedVersion/request key, 기존 audit; web origin≠staging, 실제 앱 반영 미검증 |
| 확률/구성 상품 | 동일 draft/publish | GET /gachas/:id/odds → snapshot.entries → Detail/구매확인 | odds 재조회, 서버 version 검증 | ppm/품질 검사·발행 이력 유지. UI에서 값 계산/정책 변경 없음 |
| 배너/홈 노출 | POST /owner/campaigns 또는 /:id/draft, /status | GET /campaigns → published/homeVisible/title/body/imageUrl → Home campaign | 기존 provider refresh | owner 권한/expectedVersion/이력; fallback Hero는 브랜드 자산, 가짜 캠페인 아님 |
| 카테고리 | catalog config category | CapsuleBox.category, 분류 chip | catalog refresh | 서버 코드 실제 enum에 한함. 새 분류 API 없음 |
| 공지 | 기존 notices 운영 API | CustomerUpdates/공지 목록 | 기존 read refresh | 기존 capability/gate 유지, 브라우저 연습 분리 |
| 이미지 | 기존 imageUrl 입력 | 공통 ProductImage | 기존 cache/새 URL | 업로드/CDN 인프라 없음. 사진 등록과 자산 권리는 후속 운영 작업 |
| 관심/추천 | 웹 관심은 localStorage; 실제 Flutter API 없음 | 웹 체험 only; Flutter에서 생성 안 함 | 해당 브라우저 | 서버 동기화 기능으로 표시하지 않음. 추천 순위/인기 데이터 신설 안 함 |
| 주문/배송/문의/환불 | 기존 read/ops/customer endpoints | 기존 commerce/account 화면 | 기존 recovery+refresh | 상태 변경 정책과 역할 유지, 이번 작업은 실제 거래 실행 안 함 |

권한·이력 코드는 읽기 대조했다. 실제 관리자 계정으로 저장한 뒤 앱에 반영되는 E2E는 원격 환경 불일치가 해소될 때 별도 검증한다.

## 레퍼런스

| 실제 확인한 출처 | 채택 | 제외/미확인 |
|---|---|---|
| KREAM 공식 App Store 공개 스크린샷: https://apps.apple.com/kr/app/kream-크림/id1490580239 | Hero→카테고리→상품 중심 계층 | 브랜드 그래픽/상품사진 복제 안 함. 로그인 이후 구매 흐름 미확인 |
| Pokémon TCG Pocket 공식 App Store 스크린샷: https://apps.apple.com/us/app/pokémon-tcg-pocket/id6479970832 | 확률 접근과 확인된 상품의 시각적 우선순위 | 카드/IP 복제 안 함. 실제 개봉 시간·세션 UX 미확인 |
| POP MART POP NOW 공식 how-it-works 및 step4 결과 화면: https://www.popmart.com/GB/pop-now/how-it-works | 결과 상품 강조, 자동 보관 후 다음 행동 | 타이머/힌트/세트 보장·고유 캐릭터 복제 제외. 로그인 거래 직접 실행 안 함 |

접근성 기준: Apple Design Tips 최소44pt, Android Accessibility48dp, Dynamic Type/200% 글자 확대 공식 지침. VoiceOver/TalkBack 물리기기 검증은 미실행.

## 검증 및 한계

- 320/360/390/430, 100/200% Flutter widget 화면 검사, landscape/keyboard/SafeArea/긴상품/empty/loading/error/refund/recovery 포함.
- 새14개 unified UX test: 동일 fixture, Home중복/4개상한, 모든카테고리접근,100종결과접기/불변, inline로그인오류,9실제Widget 캡처.
- 기존 테스트 assertion 유지. 새 문구·하위메뉴 진입으로 테스트 경로만 적응. 큰 글자 테스트에서 scroll로 실제로 보이는 위치까지 이동 후 확인/탭한다.
- 기존 Web verify-cinema/verify-owner/verify-pages는 V33 baseline에서도 dependency harness 오류로 실패. assertion을 삭제하거나 완화하지 않았다. 나머지 transaction/data 검사는 별도 실행하고 신규 unified rendering/18menus/draft 검사 추가.
- Widget PNG는 Linux headless Flutter test rendering이며 Android/iOS/물리 iPhone 캡처라고 부르지 않는다.
- 웹 비교는 실제 Chromium iframe 화면. 200%는 CSS computed-font stress, OS Safari Dynamic Type 검증과 다르다.
- 성능 목표: 60Hz 기기에서 build/raster p95≤16.7ms, 재진입 시 구독/애니메이션 누수 없음. headless 테스트 시간은 물리 성능 증거가 아니다. Profile 기기 frame/memory 측정은 미완료.
- 결과 접기는 최초3종만 생성; 펼치기는 모든 확정 결과 보존. 이미지 실패에도 이름/CTA 유지.

## 잔여 항목

- P0: 이번 수정의 거래/계정 모델 회귀는 자동검사로 확인. 실제 장치·서버 거래를 새 버전에서 실행한 증거는 아직 없음.
- P1: Firebase 로그인 접근, 최신 배포본 식별·검토 배포, iPhone 설치/재시작/session/실제 GP 거래 일치 확인 필요.
- P1: 웹 관리자 Remote origin과 staging origin 분리. 이 검토에서 원격 설정을 바꾸지 않았다.
- P2: 상품 사진/운영 배너 실제 데이터, 웹 추가필터/관심/카드체험과 Flutter GP경로 차이. 모든 화면 pixel parity를 주장하지 않음.
- P3: 최종3D/음향/진동·VoiceOver/TalkBack 전면검증·실기기 성능 측정.

최종 source SHA / run / artifact hash / Firebase release 매핑은 별도 완료 manifest에 실제 확인 결과만 기록한다.
