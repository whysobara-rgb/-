# GachiGacha R2 checkpoint — R2-A1 국소 보완

- 기준일: 2026-09-29.
- 현재 브랜치: `codex/r2-consumer-experience`.
- worktree: `/workspace/scratch/103c284f7fa0/flutter-r2-a`.
- 시작 SHA: `b1745d03f5313b007915ee97c9990e6b4a4848fe`; 시작 시 clean, 원격과 일치. reset/덮어쓰기 없음.
- R1 보존 기준: `5924d68fb41366875c536439ca3d0520938f3446` / Build 3.
- 이번 구현·검증 SHA: `4a86538b417471c4940187ce143a6f2050b42c0e`.
- 검증 source tree: `2eedd9c950974343fd24fcf5cf1c83df79afdf32`.
- 마지막 문서-only commit: `git log -1 --format=%H -- R2-CHECKPOINT.md`로 확인. 자기 SHA 순환을 피하며 외부 검토 보고서/manifest에는 전체 최종 SHA를 기록한다.
- 미커밋 변경: 문서 저장 후 없음. 다음 작업 시작 시 다시 확인.

## 완료 범위

1. 실제 AppTheme → Box Shop → modal filter에서 선택 색상 1:1 문제 재현. 필터의 정렬 칩만 국소 수정. 렌더러에서 해석된 선택 글자/체크 16.9082:1, 비선택 글자 15.2654:1. 세 옵션×100/200%, selected semantics 확인.
2. Home의 다른 박스 섹션/전체 보기 action을 실제 고유 박스 2개 이상인 정상 조회 상태에서만 함께 표시. 0/1/2/3개, duplicate-only, stale error/loading 회귀. GP/소식/랭킹/하단 탭 보존.
3. 사진 URL null/빈 문자열/공백은 큰 이미지 영역 대신 기존 Navy/Gold 브랜드·이름·GP·CTA 중심의 compact Hero. 정상 사진 구조·contain 비율 유지. 로딩/오류 프레임 고정. 공통 ProductImage 무변경. 사진을 전제하지 않는 획득 미보장 안내 유지.
4. 실제 HomePage → 상세 route를 detail+odds 정상/odds 실패로 분리. 원본 ID/가격/확률/표시값 대조. odds 실패는 상세 안내→기존 구매 확인 단계 재조회→실패 시 재시도만 제공, POST 없음.
5. 최종 구현 SHA에서 analyze PASS, 전체 622 pass / 3 conditional skip. R1 전용 30, R2 route/기존 catalog 18, 환불25, release1, staging62, A1 33, photo/길이 캡처14 PASS. 중복 검사 수를 합산하지 않음.

## 증거

- `docs/r2/R2-A1-VERIFICATION.md`: 변경/실행 명령/판정/한계.
- `build/r2-a1-evidence/before`: 수정 전 3옵션×2크기 실제 재현 PNG/색상 JSON.
- `build/r2-a1-evidence/after`: 수정 후 필터 및 0/1/다수/오류/로딩 홈.
- `build/r2-evidence/a1`: 같은 사진 fixture의 Home/Shop 전체 scroll viewport/길이 및 사진 상태·교체 캡처.
- `build/r2-a1-evidence/logs`: 정확한 구현 SHA에서 실행한 최종 검사 및 `validation.json`.
- 전달 파일: `R2-A1-Review.html`, `R2-A1-Evidence.zip`, `R2-A1-Manifest.json`.
- 비거래 샘플 이미지 출처·권리 기록: 기존 `docs/r2/R2-A-AUDIT.md`, `tool/r2/photos/SHA256SUMS`. 새 사진 도입/운영 업로드 없음.

## 다음 최소 작업 / 중단점

- 사용자에게 최종 실행 화면의 시각 만족도·국소 보완 결과 검토 요청. 자동검사를 디자인 만족도로 대체하지 않는다.
- R2-A 최종 인수 대기. R1 종결 PASS 유지. 전체 프로젝트 PARTIAL.
- 별도 승인 전 R2-B/C/D 시작하지 않는다.
- native build/tag/새 Actions run/Firebase/Sites 배포/실기기/서버 데이터 변경 미실행.
- 실제 상품 사진 매칭, 관리자→앱 연결, 공개 Sites 전체 동일성은 미완료·미검증.
- 대표 박스는 기존 API 목록의 첫 고유 항목이며 운영 대표 선정은 후속 범위.
- 기존 native protected baseline guard는 그대로이다. 이번 검사는 새로운 R2 native 배포 승인이 아니다.
- 거래/DTO/repository/가격/확률/GP/R1 구매·선택·복구/signing/ID/origin/release gate/기존 CI baseline 모두 무변경.
- 여기서 종료. 진행 중 background 작업 없음.


## 브라우저 직접 검토 체크포인트 — 2026-09-29

- 시작/실제 앱 기준 SHA: `f58a075c18c77c644efd2c2b14a6d1c39a65b2a9` (R2-A1 구현 `4a86538b417471c4940187ce143a6f2050b42c0e` + 문서). 시작 시 clean, 원격 동일. R2-A1 재실행/reset 없음.
- 브랜치: `codex/r2-consumer-experience`. 이번 저장은 `tool/r2/browser_*`, `tool/r2/package_browser.py`, 신규 검토 테스트와 문서만 변경. lib/native/DTO/repository/gate/origin/signing/CI 무변경.
- 실행형 진입점: `tool/r2/browser_preview.dart`. 실제 HomeScreen/BoxShopScreen/ProductDetailView/OrderFlowPage/SingleOpeningView/BatchResultView/InventoryPage 재사용. HTML 재구현 없음.
- 홈→상세→구매 확인→확률 안내, 검색/필터 적용·닫기, 고정 개봉 연출/단일·다중·부분 결과/보관함 진입. R2-B/C/D 기능 개발 아님.
- API_BASE_URL 미설정 + 모든 앱 preview gate OFF 필수. 주입된 MockClient는 합성 GET만, 모든 변경 요청 거절. 나머지 http.Client도 transport 없는 MockClient. 실제 로그인/토큰/서버/거래 없음.
- 모든 사진/폰트/CanvasKit을 로컬에 포함. loopback 전용 GET/HEAD 정적 서버, 외부 연결 CSP 차단. 공개 호스팅/URL 신규 생성 없음.
- 검토 표시줄에 앱 SHA/도구 SHA, 합성/무거래, 기존 화면/미완료 범위 구분. 결과는 거래 결과가 아니라 사전 정의 데이터.
- 검사: analyze PASS, 신규 검토 테스트7 PASS, R2 catalog+A1 49 PASS/2 조건부 skip; 동일2 route는 API/preview define을 명시한 별도18 PASS에서 실행. 중복 합산 금지.
- 브라우저: Chrome Headless Shell154, 1250×1050 브라우저 안 최대430×844 논리 앱 영역, 100%/200%. 실제 클릭·스크롤·검색·필터 적용/취소·구매확인·확률·샘플 결과/보관함 확인. 외부/API 요청0, JS/console error0. Python 정적 서버 GET200/POST거절 확인.
- Windows PowerShell launcher는 정적 검토. 실제 Windows PC 실행은 미검증이며 Python3 fallback 제공. 물리 기기 인수 아님.
- 실행물: `GachiGacha-R2-A1-Browser-Preview.zip`. 압축 해제 후 `Start-Preview.cmd`, 같은PC `http://127.0.0.1:8765`. 서버창 유지 필요. Python3 `serve.py` 대안.
- 증거/정확한 도구 SHA: ZIP의 `preview-manifest.json`, `evidence/browser-validation.json`, `evidence/*.png`. 본 문서 포함 저장 SHA는 `git log -1 --format=%H -- R2-CHECKPOINT.md`로 식별한다.
- 미커밋 변경: 저장 완료 후 없음. 다음 작업은 사용자 브라우저 검토. 별도 지시 전 R2-B/native/tag/Firebase/Sites/Backend/DB 작업 없음.
