# GachiGacha R2 checkpoint — R2-A만 완료

- 기준일: 2026-09-29.
- 현재 브랜치: `codex/r2-consumer-experience` (origin에 별도 저장).
- 작업 worktree: `/workspace/scratch/103c284f7fa0/flutter-r2-a`.
- 시작/R1 기준 SHA: `5924d68fb41366875c536439ca3d0520938f3446`.
- 현재 구현 SHA: `3ebf6003679d336d20544902565f25f4472eaccf`.
- 검증 tree: `3705bf4c93a9a759b22386b468751f0286afc0ee`.
- 이 checkpoint 및 검증기록을 추가한 마지막 문서 commit은 `git log -1 --format=%H -- R2-CHECKPOINT.md`로 확인한다. 자기 자신의 commit hash를 파일 안에 넣는 순환을 피한다. 최종 보고/외부 evidence manifest에는 최종 전체 SHA를 기록한다.
- 미커밋 변경: 문서 저장 완료 시 없음. 이후 작업 시작 시 `git status --short`로 재확인.
- 기존 R1 checkout/브랜치/PR #1 Draft Open/Build 3/성공 tag 보존. reset/merge/force push 없음.

## 완료

1. Home: 실제 catalog 대표 박스 1개 + 다른 고유 박스 2개. 사진/정확한 GP/구성·확률 CTA. 홈 category/중복 탐색 제거, 정적 뉴스 링크, 랭킹·GP·하단5경로 보존.
2. 미개봉 안내: 기존 GET 계약 totalCount만 사용, feature gate/로그인 세대/owner/request guard, 실패는 unknown으로 숨김. 개봉/거래 로직 미수정.
3. Box Shop: 검색 유지, 취소/적용 가능한 category/GP sort panel, 요약값, lazy list, 작은화면/큰글자1열.
4. 사진 normal/missing/loading/error: 동일 frame, 이름/가격/detail 행동 유지. 비거래 photo samples 별도 `tool/r2`에만 보관. 앱 bundle/실서버 데이터에 미주입.
5. 분석 PASS, 전체 589 pass/2 conditional skip, explicit R1 30, R2 17, refund25, release1, staging62, capture7. 서로 중복되는 수를 합산하지 않음.
6. `docs/r2/R2-A-AUDIT.md`: 전 경로 분류, 공식 참고 사례 4개, 권리·샘플 한계.
7. `docs/r2/R2-A-VERIFICATION.md`: 검사/skip/길이 측정/보존 guard/미검증 상세.

## 증거 위치

- 실제 Flutter renderer 캡처: `build/r2-evidence/before`, `build/r2-evidence/after`.
- 재현 명령/fixture: `tool/r2/README.md`, `tool/r2/catalog.dart`, `test/features/r2_capture_test.dart`.
- 사용자 전달: `R2-A-Review.html`, `R2-A-Evidence.zip`, `R2-A-First-Screens.png`.
- 영구 코드 기록: 위 R2 origin branch. 보고서 및 캡처는 별도 저장된 결과물.

## 남은 것 / 다음 최소 작업

- R2-A 최종 홈의 시각 만족도: 사용자 화면 검토 대기. 실제 사진이 없는 live 상태는 placeholder이며 사진 인수 미완료.
- 먼저 읽을 자료: R2-A Review → AUDIT → VERIFICATION. R1 구매테마/선택범위/직접복구는 종결 유지.
- R2-B는 별도 진행 지시 후에만. R2-C 운영 저장/발행 연결, R2-D 최종 native/배포는 시작 안 함.
- 기존 native protected baseline guard를 유지했으므로 R2-D 승인 시 검토 후 전진 필요. 지금 tag/Actions/native run을 만들지 말 것.
- 신규 dependency/DTO/API/거래/서버/DB/Firebase/signing/버전/ID/gate 변경 없음.
- 물리기기·실서버 거래·공개 Sites 대응 미검증. 자동검사를 디자인/실기기 인수로 대체하지 말 것.
- 진행 중 background 작업 없음. R2-A 종료 후 계속 실행하지 않음.
