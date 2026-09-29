# R2-A 검증 기록

## 저장 기준

- 원본/R1 baseline: `5924d68fb41366875c536439ca3d0520938f3446`.
- GitHub 구현 SHA: `3ebf6003679d336d20544902565f25f4472eaccf`.
- 구현 tree: `3705bf4c93a9a759b22386b468751f0286afc0ee`.
- 동일 tree로 로컬 검사한 커밋: `7a2c36ad253d89aedaecd5aa0e886d1b123205d7`. GitHub 연결로 저장하면서 작성자/커밋 메타데이터가 바뀌었으며 `git diff --exit-code`로 전체 tree 동일함을 확인했다. 로컬 R2 브랜치는 GitHub 구현 SHA에 맞췄다. 기존 R1 checkout/branch/PR/tag는 보존했다.
- 이 기록/체크포인트 저장 커밋은 문서만 추가한다. 최종 GitHub SHA는 최종 보고와 evidence manifest에 기록한다.

## 검사 결과 (로컬 Flutter 3.35.4 / Dart 3.9.2)

| 검사 | 결과 | 범위/한계 |
|---|---|---|
| flutter analyze | PASS, No issues found | 앱·테스트·debug review entry 분석 |
| 전체 flutter test | PASS, 589 success / 2 conditional skip | 새 native/Actions run이 아님 |
| R2 전용 widget/state | PASS, 17 | explicit mock origin + 기존 order preview flag. 실제 HomePage→상세 GET, 필터/검색/정렬/초기화, 150개 지연 목록, 큰 글자 버튼, count gate/session/late reply/error |
| R1 전용 회귀 | PASS, 30 | 기존 파일/assert 무변경. 실제 상세→구매, 다른 주문 선택 범위, GET-only 단일 복구, 320/360/390/430×100/200% |
| 환불 compatibility fixture | PASS, 25 | 기존 REFUNDED/PARTIALLY_REFUNDED 계약 |
| release gate | PASS, 1 | product mode + 모든 preview/legacy flag에서 거래 gate 닫힘 |
| staging Python tests | PASS, 62 | origin fail-closed / trigger / signing scope / validation unit tests. 실제 signing/native 검사 아님 |
| staging source configuration | PASS | Android/iOS IDs·Runner-only signing·기존 guard 문자열 보존 |
| R2 캡처 + 이미지 상태 | PASS, 7 | 4 photo viewports(Home/Shop×100/200%) + 3 image exceptions. 실제 Flutter renderer, 기기 아님 |
| baseline 캡처 | PASS, 4 | 별도 detached baseline worktree에서 같은 비교 fixture/렌더러로 실행. 원본 checkout 변경 안 함 |
| diff whitespace / 보호 영역 | PASS | 거래 모델/서비스/API/DTO/개봉/환불/공통토큰/native/signing/CI/pubspec 무변경 |

전체 검사의 두 skip은 기본 설정에서 API origin/GP preview가 필요한 R1 실제 상세→구매와 R2 HomePage→상세 route이다. 각각 전용 실행(30 / 17)에 포함되어 PASS. 숫자는 중복 합산하지 않는다. capture-only suite는 `R2_CAPTURE=true`일 때만 활성화된다.

`tool/staging/check_configuration.py`의 static checks는 통과하지만 기존 native workflow의 **protected application baseline은 그대로**다. R2는 승인된 앱 소스 변경이므로 기존 `053a6e7…`와의 git diff guard가 이후 native run에서 차단하는 것이 정상이다. R2-D 승인 단계에서 diff/보존/회귀를 검토한 다음 baseline을 전진해야 한다. 이번에는 guard 제거/완화/기준 변경/태그/빌드/Actions dispatch를 하지 않았다.

## 화면 비교

모든 숫자는 같은 비거래 3박스 fixture, 같은 사진 bytes, GP 93,800, 390×844, SafeArea 44/34, 기존 bottom navigation을 포함한 실제 위젯 실행이다. 캠페인 없음, 미개봉 안내 없음 상태다. 실제 계정/사진/캠페인 수가 달라지면 길이는 달라진다.

| 화면 | R1 콘텐츠 높이 | R2 콘텐츠 높이 | R2 viewport 대비 |
|---|---:|---:|---:|
| Home 100% | 1,192px | 983px | 1.42 화면(스크롤 viewport 692px) |
| Home 200% | 2,496px | 2,046px | 3.05 화면(671px) |
| Shop 100% | 1,023px | 860px | 1.24 화면(692px) |
| Shop 200% | 2,246px | 2,011px | 3.00 화면(671px) |

초기 SliverList의 추정 scroll extent를 쓰지 않고 마지막 항목까지 스크롤한 **최종** extent를 기록했다. full 이미지는 실제 스크롤 viewport의 content 영역을 offset대로 붙인 것이다. first 이미지는 nav/SafeArea까지 포함한 변경 없는 캡처다. 큰 글자는 1열과 세로 스크롤을 허용하며 TextScaler를 낮추지 않았다.

- R1 첫 화면: 슬로건·category 선택이 먼저, 상품 이름/GP는 하단 아래.
- R2 첫 화면: 대표 사진·박스명·박스 1개 GP·`구성·확률 보기`·비확정 사진 안내가 함께 보임.
- 사진 누락/로딩/실패: 같은 350/1.5 프레임 유지. 이름·GP·실제 detail callback 동작 확인. 다른 상품 사진 fallback 없음.
- 320/360/390/430×100/200%는 기존 Stage1 + 새 filter panel 검사. 긴 이름/잔액/키보드/landscape는 해당 기존 검사와 새 320/200% hero action 검사 포함.
- 150개 샵 목록: 초기 생성 card <15, 마지막 원본 ID 150의 실제 callback 확인. debug/widget 실행 결과이며 FPS/메모리 실기기 성능 수치로 보고하지 않는다.

## 증거와 남은 인수

- `build/r2-evidence/{before,after}`: first / pageN / full PNG, metrics JSON, photo exceptions.
- `R2-A-Review.html`: standalone 전후·전체길이·큰 글자·사진 상태 검토 문서.
- `R2-A-Evidence.zip`: 캡처, metrics, 각 검사 log, SHA manifest, scope/rights 문서.
- `R2-A-First-Screens.png`: 실제 렌더 첫 화면 나란히 보기.

구현과 자동검사 PASS는 사용자 디자인 만족도 PASS가 아니다. 실제 상품 사진 권리/상품 매칭, live 관리자→앱 반영, 실제 iPhone SafeArea/VoiceOver/거래/재시작/성능은 미검증. 샘플 소비자 홈의 시각 인수는 제공된 실행 화면으로 사용자 검토 대기. 공개 Sites는 그대로이며 전체 미리보기/앱 동등성이나 프로젝트 완료를 주장하지 않는다.

다음 단계는 사용자 R2-A 화면 검토 후 R2-B 승인 시에만 상세/구매/개봉/결과를 진행한다. R2-C/D·새 native build·Firebase 배포·서버 변경은 이번에 미실행.
