# R2-A1 — 국소 보완 검증

## 기준과 변경

- 시작: `b1745d03f5313b007915ee97c9990e6b4a4848fe`, clean, 동일 원격 branch.
- 실제 검사 대상: `4a86538b417471c4940187ce143a6f2050b42c0e` / tree `2eedd9c950974343fd24fcf5cf1c83df79afdf32`.
- 후속 commit은 이 문서, checkpoint, 재현 README만 변경한다. 테스트 대상 코드·tree와 문서 포함 최종 SHA는 외부 manifest에서 구분한다.
- 앱 소스 변경은 `lib/features/home/presentation/catalog_views.dart` 하나뿐이다. 공통 theme/ProductImage/HomePage/API/DTO/거래/서명/native/CI/gate는 무변경.
- 테스트: `test/features/r2_a1_test.dart` 신규; `r2_catalog_test.dart` route 성공/실패 분리; `r2_capture_test.dart` compact missing 계약 및 100/200% 사진 교체 증거 보완.

## A1-01: 정렬 칩

Flutter 3.35.4 실제 AppTheme.lightTheme → BoxShopScreen → CatalogFilterPanel에서 먼저 재현했다.
수정 전 6경우 모두 선택 배경·문자·체크 `#081C32`, 대비 1:1. 기준 ≥4.5 검사 실패 로그와 PNG/JSON을 보존했다.
수정 후 필터 정렬 칩의 selected/background/label/checkmark를 명시했다. 전역 테마 변경 없음.

| 상태 | 실제 렌더 배경 | 문자/체크 | 대비 |
|---|---|---|---|
| 선택 | #081C32 | #FFFDF9 | 16.9082:1 |
| 비선택 | #FFFDF9 | #10253D | 15.2654:1 |

측정은 RawChip 내부 실제 Ink ShapeDecoration, RenderParagraph의 해석된 TextStyle, checkmark painter가 사용하는 렌더 theme를 읽었다. SDK 내부 렌더 접근을 쓰므로 Flutter 업그레이드 시 테스트도 검토해야 한다. ChoiceChip 생성자 값만 검사한 것이 아니다. 선택 체크 및 Semantics selected도 검사했다.
세 정렬 옵션×100/200% 캡처. 적용/닫기X/system back/modal barrier, reset draft→cancel→기존 리빙/높은 가격순 유지 및 다시 apply 동작 통과. 기존 320/360/390/430×100/200% 필터·키보드 검사 유지.

## A1-02/03: 정직한 홈 상태

- 0개: 실제 빈 목록, 로딩 또는 오류/재시도. 비어 있는 추천 제목/action 없음.
- 고유1개/중복ID만 있는 목록: Hero만, 다른 박스 섹션 없음.
- 고유2개 이상 정상: 첫 항목 Hero + 다른 고유 박스 최대2개, 전체 보기.
- stale 목록이 남은 loading/error: 추천/상품 CTA를 정상인 것처럼 표시하지 않음. 기존 정책 유지.
- GP/소식/랭킹 행동 및 하단 navigation 유지.
- 사진 URL이 처음부터 없으면 기존 브랜드 표현 안의 compact 정보 카드: 기본 글자 Hero 274px, 200% 514px(390px 화면, 콘텐츠 폭350px). 큰 빈 이미지 영역 없음.
- 실제 URL 로딩→오류의 이미지 프레임은 약233.33px(350/1.5) 유지. 다른 상품 fallback 없음. 이름/GP/CTA 접근 유지.
- 문구는 “어떤 상품을 만날지, 구성과 확률부터.” + “특정 상품의 획득은 보장되지 않아요.”로 확률·미보장 의미를 유지하고 사진의 존재를 전제하지 않음.
- 정상 사진은 기존 contain/1.5 비율 유지. 사운드·세로 식기·커피 샘플 모두 캡처. 세로 사진의 좌우 여백은 왜곡/과도한 자르기를 피하기 위한 의도된 여백이다. 동일 제품 크기나 실제 상품 매칭을 보장했다는 뜻은 아니다.
- 공통 ProductImage와 R1 결과 이미지는 수정하지 않음.

## A1-04: route 성공/실패의 별도 근거

실제 AppTheme root / Provider / HomePage → 대표 CTA → GachaDetailPage. 네트워크만 MockClient.
정상 fixture ID9901, 단가1000GP, 확률900000/100000ppm(90%/10%), 합1,000,000. 상세 DTO와 표시 이름·가격·확률 비교, GET만 발생.
실패 fixture는 상세200, odds404 명시. 상세의 odds=null, 확률 실패 안내, 임의90%/10% 표시 없음.
기존 계약상 상세에서 구매 확인 진입은 가능하지만 그 화면이 odds를 독립 재조회한다. preview flag를 켠 전용 검사에서 실패 안내/다시 불러오기만 남고 동의·구매 실행 CTA는 없음을 확인했다. 재시도는 odds GET1회 추가, POST0. 상세에서 별도 확률 재시도 버튼을 새로 만든 것은 아니다.
성공/실패 경로에 사용한 fixture는 합성이고 실서버 검사가 아니다.

## 동일 fixture 길이 재측정

Flutter3.35.4/Dart3.9.2, flutter_tester, AppTheme, 실제 Home/Shop widget, 화면390×844 논리px, DPR1, SafeArea44/34, 하단 navigation, Pretendard/MaterialIcons 실제 로드. 동일3박스/동일사진/GP93800, campaign없음/unopened안내없음. 모든 scroll viewport를 순서대로 생성한 뒤 최종 maxScrollExtent를 측정했다(lazy 초기 추정치 아님).

| 화면 | R2-A 검토값 | A1 콘텐츠 높이 | viewport | 최종 scroll |
|---|---:|---:|---:|---:|
| Home100% | 983.226 | 983.226 | 692 | 291.226 |
| Home200% | 2046.333 | 2046.333 | 671 | 1375.333 |
| Shop100% | 859.786 | 859.786 | 692 | 167.786 |
| Shop200% | 2011.500 | 2011.500 | 671 | 1340.500 |

구조를 재설계하지 않아 정상 사진/다수 목록 길이는 그대로이다. 기본 홈 첫 화면에 박스명·GP·CTA 유지. 200%는 확대를 유지하고 스크롤로 접근한다. full 이미지란 실제 viewport들의 기록된 offset에 따른 합성 연결이며 별도 레이아웃/물리 기기 screenshot이 아니다.

## 검사 결과와 재현

모두 위 구현 commit을 checkout한 clean tree에서 새 실행. source hash/명령/exit code는 evidence `logs/validation.json`.

| 검사 | 결과 |
|---|---|
| flutter analyze --no-pub | PASS / issues0 |
| 전체 flutter test --no-pub | 622 pass / 3 conditional skip |
| R1 전용 flags 검사 | 30 pass |
| R2 catalog/route 전용 flags 검사 | 18 pass |
| A1 신규 회귀/렌더 | 33 pass |
| refund fixture | 25 pass |
| release gate | 1 pass |
| staging configuration | PASS |
| staging Python guards | 62 pass |
| photo/길이 capture opt-in | 14 pass |

전체 skip3 = 기존R1 실제 상세→구매 route1(preview/API조건) + R2 실제HomePage route2(API조건). R1/R2 전용 명시 flag 실행에서 모두 실행·통과했다. 전용/캡처 검사 대부분 전체 검사와 중복되므로 숫자를 합산하지 않는다. opt-in photo capture는 기본 전체 실행에서는 등록하지 않는다.

```sh
flutter analyze --no-pub
flutter test --no-pub --reporter expanded
flutter test --no-pub --dart-define=ENABLE_GP_ORDER_PREVIEW=true --dart-define=API_BASE_URL=https://r2.invalid test/features/r2_catalog_test.dart
flutter test --no-pub --dart-define=ENABLE_GP_ORDER_PREVIEW=true --dart-define=API_BASE_URL=https://stage2.invalid test/features/ux_r1_scope_recovery_test.dart
flutter test --no-pub test/features/orders/refund_contract_compatibility_test.dart
flutter test --no-pub --dart-define=dart.vm.product=true --dart-define=ENABLE_GP_ORDER_PREVIEW=true --dart-define=ENABLE_GP_CONVERSION_PREVIEW=true --dart-define=ENABLE_SHIPPING_PREVIEW=true --dart-define=ENABLE_ORDER_REFUND_PREVIEW=true --dart-define=ENABLE_LEGACY_TRANSACTIONS=true test/core/v33_release_gate_test.dart
python3 tool/staging/check_configuration.py
python3 -m unittest discover -s tool/staging -p 'test_*.py' -v
flutter test --no-pub --dart-define=R2_A1_CAPTURE=true test/features/r2_a1_test.dart
flutter test --no-pub --dart-define=R2_CAPTURE=true --dart-define=R2_CAPTURE_PHASE=a1 test/features/r2_capture_test.dart
```

`.invalid`는 MockClient 전용 합성 테스트 주소이며 실제 앱 설정/API origin은 바꾸지 않았다.

## 인수/미검증

구현·자동검증·코드 저장 완료. 실제 Flutter widget 캡처 제공, 별도 소비자 시안으로 대체하지 않음. R2-A 시각 만족도·최종 사용자 인수는 검토 대기. 기존 샘플 사진은 R2-A에서 출처/Unsplash License를 기록한 비거래 검토 이미지이며 새 사진/운영 상품 매칭 없음.
물리 기기, native build, Firebase 배포, 공개 Sites 통일, 관리자→앱 연결, 서버 데이터 변경 및 실제 거래는 이번 범위에서 미실행. R1 기술보완 종결 유지, Build3 보존. R2-B/C/D 시작하지 않음.
