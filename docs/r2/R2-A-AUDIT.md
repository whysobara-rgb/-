# R2-A 기준 / 경로 / 참고 및 자산 확인

확인일: 2026-09-29. 구현 범위는 Home / Box Shop만. R1 세 보완은 종결 상태를 유지한다.

## 기준

- 입력 지시문: `GachiGacha-R2-Master-Work-Prompt(1).md`의 R2-A.
- 시작 Flutter SHA: `5924d68fb41366875c536439ca3d0520938f3446`.
- 로컬과 origin `codex/unified-ux-refinement`의 SHA 일치, 시작 working tree clean.
- 새 worktree: `flutter-r2-a`; 새 브랜치: `codex/r2-consumer-experience`.
- 기존 GitHub run `36535525565`: 같은 SHA, completed / success를 이번에 읽기 재확인.
- PR #1: Open / Draft 유지. 해당 PR의 launch-foundation head는 `39e8fcdde7029947440ad3e157b36aa95bfd890a`로 R1 UX 브랜치와 다름. 병합/변경하지 않음.
- 기존 Firebase `1.0.0 (3)`은 사용자가 승인한 R1 배포 기준. 이번에는 Firebase를 재조회/변경하지 않음. R2 배포본으로 취급하지 않음.

## 화면·모달·예외 범위

| 경로/상태 | 판정 | 실제 경로 및 이번 처리 |
|---|---|---|
| 로그인/세션 복구 | 기존 유지 | LoginPage / AuthProvider. 실제 인증/secure storage 변경 없음 |
| 홈 | 이번 개선 | HomePage → HomeScreen. shared catalog owner, GP/refresh/error 유지. 대표 카탈로그 + 다른 박스 두 개 |
| 박스샵 | 이번 개선 | 같은 HomePage state → BoxShopScreen. 검색 유지, category/GP sort를 적용/취소 가능한 패널로 이동, lazy rows |
| 상품 상세/확률 | 기존 유지 | 기존 GachaDetailPage / ProductDetailView. hero와 카드가 원본 box를 전달. 재고/확률은 기존 상세 조회가 담당 |
| 구매 확인/동의/확률 모달/완료 | 기존 유지 | OrderFlowPage / PurchaseCompletionView. R1 테마 수정 및 테스트 그대로 |
| 이번 구매/전체 미개봉/선택 확인 | 기존 유지 | OrderFlowPage. R1 scope reset, 취소, exact capsule IDs 테스트 그대로 |
| 홈 미개봉 안내 | 이번 개선 | 기존 OrderRepository.capsules(1)의 totalCount만 읽음. orderPreview gate + 로그인 세대/소유자/요청 번호 검사. null/0에는 안내 없음. 조회 실패를 0으로 표시하지 않음 |
| 개봉 연출/Skip/lifecycle | 기존 유지 | OrderFlowPage / BatchOpeningPage / opening components. 상태/연출/요청 미수정 |
| 단일/다중/부분 결과 | 기존 유지 | SingleOpeningView / BatchResultView. 서버 확정 상태 미수정 |
| 직접 단일 복구/늦은 응답 | 기존 유지 | R1 GET-only recovery 경로/acknowledgement 검사 그대로. 홈 count만 별도의 세대 검사 추가 |
| 보관함/상품 상세 | 기존 유지 | InventoryPage → CollectionDetailPage. 배송/전환 진입 그대로 |
| 마이/지갑/랭킹 | 기존 유지 | ProfilePage / WalletPage. 홈 GP와 랭킹 진입 유지, 하단 5개 메뉴 그대로 |
| 주문/환불/배송/전환/계정 | 기존 유지 | 해당 repository / DTO / state / gate 변경 없음, 기존 전체 테스트 실행 |
| 뉴스/운영 배너 | 이번 개선 | 실제 published campaign 첫 제목을 낮은 우선순위의 정적 링크로 표시. 전체 소식 경로 유지. 자동 회전 hero를 홈/샵에서 제거 |
| 관리자 저장 → 고객 발행값 | 미확인 | R2-C 범위. 관리자/서버 데이터에 접근하거나 write하지 않음. 읽기용 CustomerContentRepository 연결 보존 |
| 판매 가능/품절 표시를 목록 카드에 추가 | 서버 계약 필요 | CapsuleBox catalog DTO에는 판매 상태/재고가 없음. 임의 ACTIVE/재고/희소성 표시하지 않음. 상세의 실제 재고검사 유지. 필요한 경우 R2-C에서 계약 검토 |
| 대표 박스 우선순위 | 기존 유지 | 현재 API 목록 순서의 첫 항목. 인기/개인화/운영 큐레이션으로 주장하지 않음. 대표 선정 필드는 새로 만들지 않음 |
| 사진·가격·상품 연계 | 미확인 | sample은 비거래 fixture. 실제 staging 상품의 사진 권리/매칭은 미검증 |
| 빈 목록/실패/로딩/검색 결과 없음 | 이번 개선 | 기존 상태 컴포넌트, retry/refresh 유지. 사진 상태가 이름/금액/상세 액션을 가리지 않음 |

## 비교물 구분

| 비교물 | 기준/데이터 | 이번 상태 |
|---|---|---|
| 공개 Sites | 기존 V33 공개 기준 / 웹 데이터 | 수정·재게시 안 함. R2와 전체 일치 주장 안 함 |
| 미게시 웹 검토본 | 기존 R1 HTML 및 이번 R2-A 검토 HTML | 정적 검토 문서. 거래 가능한 실제 앱이 아님 |
| Flutter 위젯 카탈로그 | `tool/r2/catalog.dart`, AppTheme.lightTheme → 실제 HomeScreen/BoxShopScreen, 동일 navigation/theme | debug 전용 / 명시적 사진 샘플 / 서버 호출 없음(사진 HTTP만). 필터·화면 전환은 로컬, 거래 버튼은 검토 액션 표시만. 기능 테스트 대체 아님 |
| 자동 캡처 | `flutter_tester`, 실제 widget/render tree, 390×844, SafeArea 44/34, 100/200%, 고정 local photo bytes | before/after 동일 이름·GP·사진·순서. emulator/simulator/물리기기 아님 |
| Firebase 배포 앱 | 기존 Build 3 / SHA 5924d68… | 보존. R2 코드가 배포된 것이 아님 |

## 공식 공개 자료에서 채택/제외한 것

2026-09-29에 공식 페이지/공식 게시 스크린샷을 조회했다. 설치·구매 흐름을 직접 실행한 것은 아니다. 경쟁사 이미지나 브랜드는 앱 자산으로 복제하지 않는다.

| 공식 자료 | 확인 범위 | 가치가차 적용 | 가져오지 않는 것 |
|---|---|---|---|
| [KREAM 공식 App Store](https://apps.apple.com/kr/app/kream-%ED%81%AC%EB%A6%BC/id1490580239) | 게시 iPhone 스크린샷: 이미지 중심 추천 공간·상품 썸네일·탐색 진입 | 텍스트 슬로건을 실제 대표 이미지 + 명확한 GP/상세 CTA로 교체 | 다수 상단 탭, 20개 배너/퀵 메뉴 누적, 근거 없는 인기/거래량 |
| [GOAT 공식 App Store](https://apps.apple.com/kr/app/goat-sneakers-apparel/id966758561) | 게시 목록 스크린샷: 사진·이름·가격으로 상품 비교, 검색/필터 역할 | 2열 사진 카드와 분리된 필터 패널, 확대 시 1열 | 과다한 chip/세부 메뉴와 희소성·할인 주장 |
| [Pokémon TCG Pocket 공식](https://tcgpocket.pokemon.com/en-gb/) | 공식 collecting 홍보 화면: 팩/카드 자체를 주인공으로 배치, 공개 collecting 링크 | hero의 박스/상품 대상이 먼저 보이도록 배치; 개봉 관련 적용은 R2-B 검토로 남김 | 캐릭터/팩 디자인 복제, 실제 연출을 확인했다는 주장, 타이머/재구매 유도 |
| [POP NOW 공식 이용 가이드](https://www.popmart.com/GB/pop-now/how-it-works) | 공개 가이드: 상품 선택→박스 선택→개봉→보관 | 무엇을 보고 어떤 행동으로 넘어가는지 분리. R2-A는 구성 확인까지만 | 힌트/시한/추가 선택 단계/과소비 유도. 문서 확인이며 실제 개봉 영상 인수 아님 |

## 사진/폰트 권리와 한계

사진은 아래 개별 페이지가 Free to use under Unsplash License로 명시한 파일을 사용했다. [Unsplash License](https://unsplash.com/license)는 사진 이용 허가이고, 등장 제품의 상표·상품 판매 관계나 실제 prize 매칭을 보증하지 않는다. 아래 파일은 `tool/r2/photos`의 **비거래 검토 fixture 전용**이며 pubspec assets에 추가하지 않았다. lib의 실서버 카탈로그에 주입/대체하지 않는다. 브랜드/모델명은 임의 생성하지 않았다.

| 파일 | 촬영자 / 원본 | 용도 |
|---|---|---|
| sound-review.jpg | C D-X / [PDX_a_82obo](https://unsplash.com/photos/flatlay-photography-of-wireless-headphones-PDX_a_82obo) | 합성 사운드 박스 사진 예시. 실제 지급 상품 아님 |
| table-review.jpg | 360floralflaves / [FHUXMDlNbyU](https://unsplash.com/photos/a-couple-of-plates-that-are-sitting-on-a-table-FHUXMDlNbyU) | 합성 테이블 박스 사진 예시 |
| coffee-review.jpg | Matt Hoffman / [ZUUsGnG5zwc](https://unsplash.com/photos/coffee-in-teacup-on-saucer-ZUUsGnG5zwc) | 합성 커피 박스 사진 예시 |

- 기존 Pretendard 폰트를 유지. [공식 SIL OFL 1.1](https://github.com/orioncactus/pretendard/blob/main/LICENSE) 확인. 보고서에 폰트 원본을 재배포하지 않음.
- 기존 Material token/box 아이콘과 Navy/Ivory/Gold tokens 재사용. 고가 상품을 fallback으로 쓰지 않음. 누락/실패는 정직한 아이콘·문구.
- 사진 URL/내용이 없는 실서버 상태에서는 새 홈도 placeholder를 사용한다. **실제 상품 사진을 포함한 홈 시각 인수는 아직 완료가 아니다.**
- Snapshot/capsule/result/image product matching, 실제 사용자 이해도·만족도, 실기기 성능/VoiceOver는 자동 위젯 검사로 인증하지 않는다.
