# 작업 인수인계 (Handoff)

> 새 세션에서 이어서 개발할 때 이 문서부터 읽으세요. 마지막 갱신: 2026-10-07.
> 오너에게는 한국어로 보고합니다. 개발 브랜치: `claude/steam-game-development-prp0yo`.

## 1. 지금 게임 상태 한눈에

- 웹(Vite + three.js + TypeScript) + Electron 데스크톱 빌드. 결정적 60 Hz 2D 시뮬레이션(`src/sim`)을 3D로 렌더링(`src/render`).
- 규칙 원본: `docs/design-v0.5.md`(+ §22 오너 추가 사항), 구조: `docs/ARCHITECTURE.md`, 아트/문체: `docs/ART_DIRECTION.md`.
- 콘텐츠 2.0(동전·뿅망치·아이템·ATM/돼지저금통/돈나무·나무 상자·맵 v2)은 구현돼 있지만 기본값은 꺼짐: `src/sim/config.ts`의 `CONTENT_V2_BY_DEFAULT = false`.
  체험판 빌드에서만 `src/game/setup.ts`에서 v2를 강제로 켭니다(아래 5장).
- 사람은 1명(슬롯 0)만 조작하고 나머지는 봇입니다. **로컬/온라인 멀티플레이는 아직 없음** → 다음 최우선 과제(3장).

## 2. 끝난 일 (커밋됨)

- 핵심 규칙·맵 3종+튜토리얼·봇 3성격·경찰 이벤트·3D 메뉴·연출·사운드·도발 이모트(실행은 아래 버그 수정에서 연결).
- 콘텐츠 2.0 1차(동전 경제·소품 물리·아이템·뿅망치·맵 v2 배치, 모델/효과음/HUD).
- 재미 강화 1차(F9 저장 v2, F5 모먼트·킥오프 안내·명령 기록, F4 긴장감 HUD, F3 연출 비트, F8 긴장감 음악). 요약: `docs/dev-plans/fun-wave1-digest.md`.
- 메인 화면 담백화(로고 + '게임 시작' 하나, 조용한 목록, 차분한 옥상 배경).
- 스팀 에셋: `steam/store/`(캡슐·스크린샷·아이콘), `tools/steam-assets/`(재현 도구), 크레딧·라이선스 화면, `docs/PLAYER_README.md`.
- 조작 버그 수정(오너 리포트): 잡은 물건과 몸이 닿을 때 운동량이 생기던 물리 버그, 손잡이 회전, 밀기/끌기 뒤집힘, 대시 중 잡기. 테스트 `test/sim/control-bugs.test.ts`.

## 3. 다음 최우선 과제: 함께하기(로컬 멀티플레이 → Remote Play Together)

오너 승인 완료(2026-10-07). 이유: 파티 물리 장르는 "친구랑 하는 맛"으로 팔리는데 지금은 1인 대 봇만 가능 → 매출 기대치를 가장 크게 올리는 작업.

- 한 화면 2~4인: 키보드 2인 분할(WASD/방향키) + 게임패드 최대 4개, 참가 화면(버튼 눌러 참가, 팀 선택), 빈 슬롯은 봇.
- `src/game/setup.ts`의 `humanSlot: 0`을 여러 사람 슬롯으로, `src/platform/input.ts`에서 장치별 입력 분리, `src/game/match.ts`에서 슬롯별 명령 생성.
- 공유 카메라(모든 사람 플레이어가 화면에 들어오게 줌/이동), HUD는 팀 단위 + 플레이어별 작은 표시(색·번호), 도발 휠은 장치별.
- Steam Remote Play Together는 로컬 멀티가 되면 Steam이 스트리밍으로 처리 → 상점 페이지 기능 태그만 켜면 됨(`docs/STEAM_RELEASE.md`에 기록).
- 온라인 대전은 그다음(시뮬레이션이 명령 기반·결정적이라 롤백/락스텝 붙이기 쉬움).

## 4. 진행 중이던 작업 (세션이 끊겼다면 상태 확인 후 마무리)

백그라운드 워크플로로 돌던 수정들. 대부분 변경은 이미 WIP 커밋으로 저장돼 있음.

| 작업 | 상태(마지막 확인) | 확인 방법 |
|---|---|---|
| 도발 실행 + 도발 휠 마우스 조준 | 수정 완료, 코드 검증 통과, 실기 검증 중 | `src/sim/emotes.ts`, `test/e2e/taunts.spec.ts` |
| 끌고 올 때 글자 떨림 | 수정·재검증 통과(사소한 3차 다듬기 중) | `src/ui/core/declutter.ts` 히스테리시스 |
| 임팩트 글자·말풍선 기울어짐 | 수정 완료, 검증 중 | 정책: 글자·말풍선은 멈춰 있을 때 항상 0°, 회전 대신 스케일로 손맛 |
| 끌 때 소리 거침 | 부드러운 '두구두구'로 교체, 무거운 물건이 작은 스피커에서 묻히는 문제 보완 중 | `src/audio/loops.ts` drag/bankRumble, `dsp.ts` rollBuffer |
| 은행 **밀기** 방향 | 밀면서 스틱을 꺾으면 은행이 늦게 돎 → 밀기 조향 모델 교체 중 | `src/sim/physics.ts` GrabJoint push 경로 |
| 봇이 콘텐츠 2.0 사용(C6) + 밸런스 측정(C11) | C6 수정 완료, C11 수정 중 | `src/ai/goals/*`, `tools/balance-report.ts --fun --content` |

마무리 순서: `npx tsc --noEmit` → `npm test` → `npm run build` → `npx playwright test`(무거움) → 커밋/푸시 → 체험판 재배포.

## 5. 통합 체크리스트 / 알려진 문제

`docs/dev-plans/integration-todo.md`에 정리. 주요 항목:
- 봇 말풍선 효과음 연결(`director.onBark`), 결과 화면 포즈 연결(`setResultsPoses`), 저장 v2 기록 함수 호출(`recordMatchOutcome`/`bumpFunnel`).
- 테스트: `test/ai/police.test.ts` "never freezes in fear"(seed 9에서 5/6) — 물리 수정 후 생김, 봇 쪽 조정 필요. 토너먼트 저장 e2e는 `cup: 'normal'` 필드 반영 필요. 부하 때문에 시간 초과 나는 테스트들은 단독 실행 시 통과.
- 체험판(브라우저)에서는 Ctrl+1~4를 크롬이 가져감 → 숫자키 1~4로 도발(데스크톱 빌드는 Ctrl+1~4 됨).
- 스토어 스크린샷은 글자 기울기 수정 후 다시 캡처(`tools/steam-assets/capture.mjs`).

## 6. 체험판(Artifact) 배포 방법

링크: https://claude.ai/artifact/J2Cva6ofoL3NvrBBQscRTt (같은 링크 유지)
1. `git archive HEAD game`을 임시 폴더에 풀고 `node_modules`는 심볼릭 링크.
2. 폰트 922개 파일 문제 → `@fontsource` import 4줄을 4개 woff2로 합친 서브셋 CSS로 교체(`src/ui/fonts.ts`, `src/render/models/textures.ts`). 서브셋은 fontTools+brotli로 생성.
3. `src/game/setup.ts`의 `rules = { police: ... }` 다음 줄에 `if (layout.v2) rules.content = 'v2'` (체험판 전용, 저장소에는 넣지 말 것).
4. `npx vite build --base ./` → `dist/index.html`을 doctype/CSP 없이 정리해 `uproot-play.html`로 → Artifact publish(`url` 지정, 바뀐 assets만 `files`로, 옛 해시 파일은 `null`).

## 7. 개발 계획 문서

- `docs/dev-plans/content-plan.md` — 콘텐츠 2.0 전체 계획(2차: 뚫어뻥·롤러스케이트·비누, 맵 기믹·이벤트, 뚝딱 공사장, 3차: 반짝 놀이공원).
- `docs/dev-plans/fun-plan.md` — 재미 강화 계획(남은 것: F2 봇 도발, F6 결과 화면, F7 대회/첫 1시간, F10 털이 수첩).
- `docs/dev-plans/workflows/` — 사용하던 워크플로 스크립트(경로 상수 `SCRATCH`를 새 세션 경로나 `docs/dev-plans`로 바꿔 사용).

## 8. 오너 요구 (항상 지킬 것)

- 한국어로 소통. "AI 쓴 티"가 나면 안 됨. 닌텐도 느낌의 귀엽고 쫀쫀한 손맛(저작권 회피). 화려하되 메인 화면은 담백하게.
- 무엇보다 "존나게 재밌고 중독성 있게" — 단, 확률형/에너지/FOMO 없는 윤리적 방식.
- 모델 이름은 커밋·코드·문서에 넣지 않기.
