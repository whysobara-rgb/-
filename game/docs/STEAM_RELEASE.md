# Steam 출시 체크리스트 — 뿌리째 털어라 (Uproot Heist)

이 문서는 빌드를 Steam에 올리고 출시하기까지의 실제 작업 순서다. 체크박스는 출시 담당자가
그대로 따라가며 표시한다. Steamworks 화면 이름은 파트너 사이트에 보이는 영어 그대로 적었다.
Valve 정책·화면은 바뀔 수 있으므로, 표시된 수치는 작업 시점에 Steamworks 문서로 다시 확인한다.

## 0. 저장소 구성 한눈에 보기

| 경로 | 내용 |
|---|---|
| `electron/main.cjs`, `preload.cjs` | 데스크톱 셸. 보안 설정, 저장 IPC, 전체 화면, Steam, 로그, `--selftest` |
| `electron/save-store.cjs` | 원자적 저장(tmp + fsync + rename), `save.bak`, 손상 파일 격리 |
| `electron/steam.cjs` | steamworks.js 초기화(App ID 결정), 업적, 오버레이 |
| `electron/icon.png` / `icon.svg` | 창·작업 표시줄·AppImage 아이콘(1024px, SVG 원본) |
| `src/platform/*` | 설정, 입력, 저장 데이터, 업적 규칙, Steam 브리지(게임 코드 쪽) |
| `steam/steam_appid.txt` | App ID 한 줄(현재 `480` = Valve 공개 테스트 앱 Spacewar) |
| `steam/app_build.vdf`, `depot_build_windows.vdf`, `depot_build_linux.vdf` | SteamPipe 스크립트 원본(현재 ID는 예시값) |
| `steam/achievements.json` | 업적 API 이름, 한/영 이름·설명, 숨김 여부, 아이콘 파일명, 해금 조건 |
| `tools/package-steam.mjs` | 빌드 → electron-builder → 디포 정리 → 실제 ID가 들어간 SteamPipe 스크립트 생성 |
| `package.json` `build` | electron-builder 설정(appId `com.uproot.heist`, 실행 파일 `UprootHeist`) |

명령 요약(모두 `game/`에서):

```bash
npm ci                                  # 깨끗한 의존성 설치
npm test                                # 단위 테스트 (sim, ai, ui, platform)
npm run electron:selftest               # 개발 실행 파일로 셸 자체 점검 (Linux 헤드리스: xvfb-run -a npx electron . --selftest --no-sandbox)
npm run dist:linux                      # release/linux-unpacked + AppImage
npm run dist:win                        # release/win-unpacked + zip (Linux에서도 가능, wine 불필요)
npm run dist:steam -- --appid=<ID> --depot-windows=<ID> --depot-linux=<ID> --selftest
```

---

## 1. Steamworks 앱 준비 (한 번만)

- [ ] **Steam Direct 등록비 결제 → App ID 발급.** 결제 후 출시까지 30일 대기 규정이 있으므로 일정에 반영한다.
- [ ] **App ID 반영:** `steam/steam_appid.txt`를 실제 ID로 교체한다(파일에는 숫자만 둔다 — 다른 글자가 있으면 Steam API 초기화가 실패한다).
      또는 패키징 때 `--appid=` / 환경 변수 `STEAM_APPID`로 넘긴다.
- [ ] **디포 만들기** (App Admin → SteamPipe → Depots)
  - Windows 디포: OS = Windows, 64-bit only, 언어 = 모든 언어
  - Linux 디포: OS = Linux + SteamOS, 64-bit only, 언어 = 모든 언어 (Steam Deck도 이 디포를 쓴다)
  - macOS: 첫 출시에서 제외(공증·서명 필요). `package.json`의 `mac` 설정은 서명 없는 dmg 내부 테스트용이다.
  - 디포 ID를 `steam/app_build.vdf`의 `"Depots"` 키(현재 예시 481/482)에 넣거나 `--depot-windows` / `--depot-linux`로 넘긴다.
- [ ] **실행 옵션** (App Admin → Installation → General Installation → Launch Options)

  | # | 실행 파일 | 인수 | OS | 설명(사용자에게 보임) |
  |---|---|---|---|---|
  | 1 | `UprootHeist.exe` | (없음) | Windows | 게임 시작 / Play |
  | 2 | `UprootHeist.exe` | `--safe-mode` | Windows | 안전 그래픽 모드 / Safe graphics mode |
  | 3 | `UprootHeist` | `--no-sandbox` | Linux + SteamOS | 게임 시작 / Play |
  | 4 | `UprootHeist` | `--no-sandbox --safe-mode` | Linux + SteamOS | 안전 그래픽 모드 / Safe graphics mode |

  - `--safe-mode`: 소프트웨어 WebGL(SwiftShader). GPU 드라이버 문제로 화면이 검게 나오는 사용자를 위한 탈출구. 느리지만 실행은 된다.
  - Linux의 `--no-sandbox`: Steam Linux Runtime 컨테이너 안에서는 Chromium 샌드박스(SUID 도우미·사용자 네임스페이스)를 쓸 수 없어 이 인수가 없으면 시작 직후 종료된다. 렌더러는 로컬 파일만 열고, Node 접근 없음(contextIsolation), 탐색·새 창·웹뷰 차단, 권한 요청 거부로 보호된다.
  - 그 밖의 인수: `--windowed`(이번 실행만 창 모드), `--no-steam`(Steamworks 건너뜀, 지원 문의 대응용).
- [ ] **Linux Runtime** (Installation → Linux Runtime): 최신 "Steam Linux Runtime" 컨테이너(현재 3.0 sniper)를 선택하고 Steam Deck 실기에서 확인한다.
- [ ] **지원 언어** (Edit Store Page → Basic Info → Languages): 한국어 — 인터페이스·자막 / English — interface, subtitles. 음성 없음.
- [ ] **Steam Cloud(자동 클라우드)** (App Admin → Steam Cloud)
  - 사용자당 용량 1 MB, 파일 수 4
  - Root `WinAppDataRoaming`, 하위 경로 `UprootHeist`, 패턴 `save.json` / `save.bak`, 하위 폴더 포함 안 함
  - Root Override: OS Linux → Root `LinuxHome`, 경로 `.config/UprootHeist` (Electron은 `$XDG_CONFIG_HOME`, 기본 `~/.config`에 저장)
  - `logs/`, `quarantine/`, `window.json`은 동기화하지 않는다.
- [ ] **Steam Input / 컨트롤러** (App Admin → Steam Input)
  - 게임은 브라우저 Gamepad API(표준 배치)로 Xbox·PlayStation·Switch Pro 패드를 직접 읽고, 버튼 표시도 패드 종류에 맞춘다.
  - PlayStation, Switch Pro: **Steam Input 옵트아웃**(게임이 직접 지원). 켜 두면 가상 Xbox 패드로 보여 ✕○□△ 대신 ABXY가 표시된다.
  - Steam Deck 내장 컨트롤과 Steam Controller: Steam Input 사용, 기본 템플릿 "Gamepad". Deck은 Xbox 배치(ABXY)로 보여 표시가 일치한다.
  - 상점 컨트롤러 설문(Edit Store Page → Basic Info → Controller support): **Full Controller Support**. 근거: 모든 메뉴·설정·키 재배치·경기가 패드만으로 가능하고(`pollMenu`), 화면 안내가 마지막에 쓴 장치의 버튼으로 바뀌며, 글자 입력이 필요한 화면이 없다.
- [ ] **업적** (App Admin → Stats & Achievements → Achievements) — 4절 참고.
- [ ] Steamworks 변경 후 **Publish** 탭에서 변경 사항 게시(게시하지 않으면 업적·클라우드·실행 옵션이 적용되지 않는다).

## 2. 빌드와 업로드

### 2.1 출시 빌드 만들기

- [ ] `main`의 확정 커밋에서 `npm ci && npm test`가 통과한다.
- [ ] `npm run dist:steam -- --appid=<ID> --depot-windows=<ID> --depot-linux=<ID> --selftest`
  1. `npm run build`(타입 검사 + Vite) → `dist/`
  2. electron-builder `dir` 대상 → `release/linux-unpacked`, `release/win-unpacked`
  3. `release/steam/content/{linux,windows}/`에 디포 내용과 `steam_appid.txt` 배치
  4. 디포 검사: 실행 파일, `resources/app.asar`, 압축 해제된 steamworks 네이티브(해당 OS 것만), 실행 권한
  5. 절대 경로·실제 ID가 들어간 `release/steam/scripts/app_build_<AppID>.vdf`, `depot_build_<DepotID>.vdf` 생성
  6. `--selftest`: Linux 디포 실행 파일을 xvfb에서 `--selftest`로 실행(저장 왕복, 보안 설정, steamworks 네이티브 로드 확인)
- [ ] 출력에 `dist/ is the packaging PLACEHOLDER` 경고가 **없어야** 한다(패키징 시험용 임시 빌드를 올리는 사고 방지).
- [ ] `steam_appid.txt` 포함 여부를 결정한다. 기본은 포함(Steam이 켜져 있으면 exe를 직접 실행해도 Steam API가 동작). Valve 권장대로 공개 빌드에서 빼려면 `--no-appid-file`. 어느 쪽이든 Steam에서 실행하면 클라이언트가 넘겨 주는 App ID를 먼저 쓰고, 패키지된 빌드는 ID가 없을 때 480으로 대체하지 않는다.
- [ ] Windows 실행 파일 메타데이터: Linux에서 만든 Windows 빌드는 exe 아이콘·버전 정보 편집을 건너뛴다(`signAndEditExecutable: false`, wine 없음). 정식 출시 빌드는 Windows 머신(또는 wine이 있는 CI)에서 `signAndEditExecutable`을 켜고 만들면 아이콘·제품명이 exe에 들어간다. 코드 서명 인증서가 있으면 같은 단계에서 서명한다.

### 2.2 steamcmd 업로드

- [ ] 빌드 업로드 권한만 가진 전용 Steamworks 계정을 쓴다(첫 로그인 때 Steam Guard 코드 입력).
- [ ] 먼저 미리보기: `--preview`로 스크립트를 만들거나 생성된 vdf의 `"Preview" "1"`로 실행 → `release/steam/output/` 로그에서 파일 목록·크기 확인.
- [ ] 업로드:
  ```bash
  steamcmd +login <build_account> +run_app_build "<절대경로>/release/steam/scripts/app_build_<AppID>.vdf" +quit
  ```
- [ ] Steamworks → SteamPipe → Builds에 빌드가 보이고, 설명이 `Uproot Heist v<버전> (<커밋>) <날짜>`인지 확인.

### 2.3 베타 브랜치

- [ ] SteamPipe → Builds에서 비밀번호가 있는 `beta` 브랜치를 만든다(`default`에는 바로 올리지 않는다).
- [ ] 업로드 때 `--branch=beta`를 주면 그 브랜치에 바로 적용된다(`default`는 도구가 거부한다).
- [ ] 테스트 PC의 Steam 클라이언트: 게임 속성 → Betas → 비밀번호 입력 → `beta` 선택 → 업데이트.
- [ ] 6절 점검표를 베타에서 통과한 빌드만 `default`로 올린다.

## 3. 상점 페이지 자산

상점 글은 `docs/STORE_PAGE.md` 초안을 쓴다. 스크린샷·영상은 실제 빌드에서 캡처한 장면만 쓰고(기획서 §14), 리뷰·수상·판매 수치를 지어내지 않는다.

| 자산 | 크기(px) | 비고 |
|---|---|---|
| Header capsule | 920 × 430 | 상점 상단·추천. 로고 필수, 다른 홍보 문구 없음 |
| Small capsule | 462 × 174 | 목록·검색. 작게 봐도 읽히는 로고 위주 |
| Main capsule | 1232 × 706 | 첫 화면 추천 영역 |
| Vertical capsule | 748 × 896 | 시즌 세일 등 세로 배치 |
| Library capsule | 600 × 900 | 라이브러리 격자 |
| Library hero | 3840 × 1240 | 라이브러리 상단 배경. 로고·글자 넣지 않음(로고는 따로) |
| Library logo | 1280 × 720 | 투명 PNG. 영문/한글 로고 중 결정(가로 1280 또는 세로 720에 맞춤) |
| Screenshots | 1920 × 1080 | 16:9, 최소 5장. `STORE_PAGE.md` 촬영 목록(통째 뽑기, 내용물 탈취, 펜스 돌파, 마지막 30초, 결과 화면, 라이벌 대응) |
| Community icon | 184 × 184 | JPG. `electron/icon.svg`에서 만든다 |
| Client icon | .ico (32 × 32 포함) | Steam 클라이언트 바로가기. `electron/icon.svg`에서 만든다 |
| Achievement icons | 64 × 64 | 업적마다 해금·잠김(흑백) 2장, `steam/achievements.json`의 파일명 사용 |

- [ ] 트레일러: 실제 플레이 8~15초 장면을 앞에 둔다(기획서 §14). 첫 화면에서 은행이 뽑히는 장면이 보이게.
- [ ] 모든 캡슐에 같은 로고·색(밤하늘 남보라 + 금색 은행)을 쓴다. 캡슐에 할인·리뷰 문구를 넣지 않는다.
- [ ] 한국어·영어 상점 글 모두 입력(짧은 설명 300자 이내).
- [ ] 시스템 요구 사항: `STORE_PAGE.md` 표 + Linux(SteamOS / 최신 배포판 64-bit, WebGL2 가능한 GPU). 실제 기기 측정 후 확정.
- [ ] 태그·장르: `STORE_PAGE.md` 후보에서 고른다.

## 4. 업적

`steam/achievements.json`이 원본이다. `test/unit/platform-steam.test.ts`가 API 이름(`src/platform/steam.ts`)과 한/영 문구(`src/ui/strings`)가 서로 맞는지 검사하므로, 문구를 바꾸면 세 곳을 함께 고친다.

- [ ] 12개 업적 입력: API Name = `apiName`, Display Name / Description을 english·koreana로 각각 입력, Hidden = `hidden`(현재 모두 공개).
  - 한국어 설명은 `achievements.json`의 문구("…하세요")를 그대로 쓴다. 게임 안 업적 토스트(`src/ui/strings/ko.ts`)는 달성 순간에만 보이므로 "…했어요"이지만, Steam은 **잠긴 업적의 설명도** 보여 주므로 지시형이어야 한다. 이름과 영어 설명은 게임 문자열과 같아야 하며 `test/unit/platform-steam.test.ts`가 검사한다.
- [ ] 아이콘 24장(64×64, 해금·잠김) 업로드.
- [ ] Publish 후, 실제 App ID 빌드로 해금 테스트:
  - 경기 업적(`FIRST_RECOVERY` 등)은 경기 이벤트 기록으로 판정한다(`src/platform/progress.ts`, 조건은 json의 `unlockRule`).
  - 해금은 저장 파일에 먼저 기록되고, Steam이 꺼져 있던 동안 얻은 업적은 다음 실행 때 `syncAchievementsToSteam()`이 다시 보낸다.
  - 테스트 후 초기화: Steam 콘솔(`steam://open/console`)에서 `achievement_clear <AppID> <API_NAME>` 또는 `reset_all_stats <AppID>`.

## 5. 콘텐츠 설문·가격·법적 항목

- [ ] **콘텐츠 설문**(Edit Store Page → Content Survey): 폭력 — 너구리끼리 밀치고 넘어지는 만화풍 몸싸움, 다치거나 피 나는 표현 없음. 주제 — 코믹한 금고·은행 "털이"(실제 범죄 묘사·무기 없음). 성적 표현·도박·확률형 아이템 없음. 사용자 간 채팅 없음(현재 오프라인 전용).
- [ ] **AI 사용 고지**(같은 설문): `docs/ART_DIRECTION.md` §7 기준으로 사실대로 답한다. 그래픽·사운드·음악은 코드로 만든 절차적 생성물이고, 코드와 텍스트 작성에 AI 도구를 사용했다 → "사전 생성(Pre-generated) 콘텐츠: 예"(개발 중 AI 도구 사용, 팀이 검토), "실시간 생성(Live-generated): 아니요"(게임 실행 중 AI 생성 없음).
- [ ] **가격**(App Admin → Pricing): 기준 USD 가격을 정하고 지역 가격은 Valve 권장값에서 출발해 KRW를 따로 확인한다. 가격과 출시 할인율은 제작 책임자가 정하고, 할인 규정(출시 할인 기간·최대율)은 그때의 Steamworks 할인 규정을 따른다.
- [ ] **한국 출시 등급**: 한국 사용자 판매 전 게임물 등급분류(게임물관리위원회 또는 자체등급분류사업자 경로) 요건을 확인한다.
- [ ] 개인정보: 게임은 네트워크로 아무것도 보내지 않는다(로그·저장은 사용자 PC에만). 상점의 개인정보 항목은 이에 맞게 작성.
- [ ] 서드파티 라이선스: Electron/Chromium 라이선스 파일(`LICENSE.electron.txt`, `LICENSES.chromium.html`)이 디포에 포함되는지 확인. three.js(MIT), steamworks.js(MIT), Jua·Noto Sans KR(OFL) 고지를 크레딧/라이선스 화면에 넣는다.

## 6. 출시 전 점검표 (베타 브랜치 빌드로)

**자동 점검**
- [ ] `npm test` 통과, `npm run typecheck` 오류 0
- [ ] `dist:steam --selftest` 통과(PASS, 종료 코드 0)
- [ ] Windows 디포를 Windows PC에서 `UprootHeist.exe --selftest` 실행 → PASS

**설치·실행**
- [ ] 깨끗한 Windows 10/11 PC에서 Steam으로 설치 → 실행 → 첫 화면까지 흰 화면 깜빡임 없음(배경 `#150F2B`)
- [ ] Linux 데스크톱과 Steam Deck(게임 모드)에서 실행
- [ ] 안전 그래픽 모드 실행 옵션 동작
- [ ] 게임을 두 번 실행하면 기존 창이 앞으로 오고 두 번째 프로세스는 바로 끝난다
- [ ] 첫 실행은 전체 화면, F11·Alt+Enter로 전환, 설정의 전체 화면 항목과 동기화, 다음 실행 때 마지막 상태 유지
- [ ] 창 모드 최소 크기 1024×576, 창 위치·크기 기억(모니터 분리 후에도 화면 밖에 열리지 않음)
- [ ] Shift+Tab Steam 오버레이가 경기 중에도 열리고 닫힌다
- [ ] 언어: Steam 언어가 한국어면 한국어, 영어면 영어로 첫 실행. 설정에서 바꾼 값이 유지

**입력**
- [ ] 키보드만 / 마우스+키보드 / 패드만으로 튜토리얼 → 빠른 대전 → 결과 → 재대결 완주
- [ ] Xbox, DualSense(옵트아웃 확인), Switch Pro, Steam Deck: 버튼 표시가 실제 패드와 일치
- [ ] 키 재배치(키보드·패드), 충돌 시 맞바꾸기, 기본값 복원, Esc/Start는 항상 일시 정지
- [ ] 잡기 토글/누르기 유지 모두 동작, 진동 끄기가 바로 적용
- [ ] 경기 중 패드 연결 해제 시 동작 확인(게임 흐름에서 일시 정지 권장)

**저장·업적**
- [ ] 설정·대회 진행·모자·통계가 재시작 후 유지
- [ ] Steam Cloud: PC A에서 진행 → PC B(또는 Deck)에서 이어짐
- [ ] 강제 종료(작업 관리자) 직후 재실행해도 저장이 깨지지 않음
- [ ] `save.json`을 일부러 망가뜨리면 `save.bak`으로 복구되고 `quarantine/`에 원본이 남음
- [ ] 업적 12개 해금 확인(4절)

**보안·로그**
- [ ] 로그(`main.log`)에 `[security] blocked`·`Electron Security Warning`이 정상 플레이 중 나오지 않음.
      게임 `index.html`에 아래 CSP를 넣으면 경고가 사라진다(Electron 44 + file://에서 모듈 스크립트·지연 로드 청크 동작 확인):
      `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'`
- [ ] 패키지된 빌드에서 개발자 도구가 열리지 않음(F12, Ctrl+Shift+I)
- [ ] 출시 직전 Electron 최신 보안 패치 버전으로 올려 다시 빌드

**Valve 검토와 출시**
- [ ] 상점 페이지 검토 요청 → 승인 → "Coming Soon" 상태로 최소 2주 공개
- [ ] 빌드 검토 요청(Valve가 실제로 실행해 본다) → 승인
- [ ] Steam Deck 호환성 검토 항목 자체 점검: 기본 컨트롤러 설정, 1280×800에서 글자 크기(UI 크기 설정), Deck 버튼 표시, 런처 없음, 외부 계정 요구 없음
- [ ] 출시 시각 결정 → beta에서 검증한 빌드를 `default`에 Set Live → Release App

## 7. 지원·문제 해결

| 항목 | Windows | Linux / Steam Deck |
|---|---|---|
| 저장 | `%APPDATA%\UprootHeist\save.json`, `save.bak` | `~/.config/UprootHeist/save.json`, `save.bak` |
| 격리된 손상·신버전 저장 | `%APPDATA%\UprootHeist\quarantine\` | `~/.config/UprootHeist/quarantine/` |
| 로그 | `%APPDATA%\UprootHeist\logs\main.log` | `~/.config/UprootHeist/logs/main.log` |

(macOS 내부 테스트 빌드: `~/Library/Application Support/UprootHeist/`)

- 화면이 검게 나옴 → 안전 그래픽 모드 실행 옵션. 로그의 `[gpu]` 줄 확인.
- 업적이 안 올라감 → 로그의 `[steam]` 줄: `not initialised`면 Steam 미실행 또는 App ID 문제. 업적은 저장 파일에 남아 있다가 다음 실행 때 자동으로 다시 보낸다.
- 셸 자체 점검: 설치 폴더에서 `UprootHeist(.exe) --selftest` (Linux는 `--no-sandbox` 함께) → 결과가 콘솔과 로그에 PASS/FAIL로 나온다. 임시 폴더를 쓰므로 사용자 저장에 영향 없음.
- 오래된 버전으로 되돌린 뒤(베타 → 기본) 저장이 초기화된 것처럼 보이면: 새 버전 저장은 `quarantine/save.newer-v*.json`에 보관되어 있다.
