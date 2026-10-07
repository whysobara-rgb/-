#!/usr/bin/env python3
"""체험판(DEMO_MODE) 웹 빌드: 정적 파일로 아무 경로에나 올릴 수 있게 만든다.

    python3 tool/demo/build_demo_web.py [출력 폴더]

하는 일
1. flutter build web --release --no-web-resources-cdn --dart-define=DEMO_MODE=true
   (CanvasKit을 gstatic CDN이 아니라 빌드 결과물에서 읽는다)
2. 결과물 손질 (web/index.html은 그대로 두고 빌드 결과만 고친다)
   - <base href="/"> 제거: 모든 경로(main.dart.js, assets/, canvaskit/)가
     페이지 주소 기준 상대 경로가 되어 /a/b/demo/ 같은 하위 경로에서도 열린다.
   - 서비스 워커를 쓰지 않는다: flutter_bootstrap.js의 serviceWorkerSettings를
     빼고 flutter_service_worker.js를 지운다.
   - 구글 로그인 SDK(accounts.google.com) 스크립트를 붙이지 않는다(소셜 로그인 없음).
   - 제목·홈 화면 이름을 "가치가차 체험판"으로.
   - dart2js + CanvasKit 빌드가 쓰지 않는 파일(skwasm·wimp·webparagraph
     렌더러, 디버그 심볼 .symbols)을 지운다.
3. 출력 폴더로 복사하고 파일 수·크기를 확인한다(255개·60MB 미만, 파일당 15MB 이하).
"""

import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FLUTTER = os.environ.get("FLUTTER", "flutter")
BUILD = os.path.join(ROOT, "build", "web-demo")
TITLE = "가치가차 체험판"

MAX_FILES = 255
MAX_TOTAL = 60 * 1024 * 1024
MAX_FILE = 15 * 1024 * 1024


def run_build():
    help_text = subprocess.run(
        [FLUTTER, "build", "web", "-h"], cwd=ROOT, capture_output=True, text=True
    ).stdout
    cmd = [
        FLUTTER,
        "build",
        "web",
        "--release",
        "--no-web-resources-cdn",
        "--dart-define=DEMO_MODE=true",
        "--no-source-maps",
        "--output",
        BUILD,
    ]
    # 이 플래그는 Flutter 버전에 따라 없다(3.47에는 없음). 있으면 쓴다.
    if "--pwa-strategy" in help_text:
        cmd.append("--pwa-strategy=none")
    if "wasm-dry-run" in help_text:
        cmd.append("--no-wasm-dry-run")
    print("$", " ".join(cmd), flush=True)
    subprocess.run(cmd, cwd=ROOT, check=True)


def patch_index():
    path = os.path.join(BUILD, "index.html")
    html = open(path, encoding="utf-8").read()
    # 주석 블록과 <base> 태그를 함께 지운다.
    html, n = re.subn(r"\s*<!--(?:(?!-->).)*?base href(?:(?!-->).)*?-->", "", html, flags=re.S)
    html, n_base = re.subn(r"\s*<base href=\"[^\"]*\">", "", html)
    assert n_base == 1, "expected exactly one <base> tag"
    html, n_title = re.subn(r"<title>.*?</title>", f"<title>{TITLE}</title>", html)
    assert n_title == 1
    html = re.sub(
        r'(<meta name="apple-mobile-web-app-title" content=")[^"]*(")', rf"\g<1>{TITLE}\2", html
    )
    html = re.sub(
        r'(<meta name="description" content=")[^"]*(")',
        r"\g<1>가치가차 체험판 - 가상 GP로 체험하는 데모(결제·배송은 실제로 일어나지 않아요)\2",
        html,
    )
    open(path, "w", encoding="utf-8").write(html)


def patch_bootstrap():
    path = os.path.join(BUILD, "flutter_bootstrap.js")
    js = open(path, encoding="utf-8").read()
    # 생성된 마지막 호출: _flutter.loader.load({ serviceWorkerSettings: {...} });
    js, n = re.subn(
        r"_flutter\.loader\.load\(\{\s*serviceWorkerSettings:\s*\{.*?\}\s*\}\);",
        "_flutter.loader.load();",
        js,
        flags=re.S,
    )
    assert n == 1 or "serviceWorkerSettings" not in js.split("_flutter.buildConfig")[-1], (
        "could not remove serviceWorkerSettings from flutter_bootstrap.js"
    )
    tail = js.split("_flutter.buildConfig")[-1]
    assert "serviceWorker" not in tail, "service worker still referenced"
    # google_sign_in_web 플러그인은 등록되자마자(앱 시작 전) 구글 로그인 SDK
    # 스크립트를 <head>에 붙인다. 체험판은 소셜 로그인을 쓰지 않으므로 그
    # 스크립트 하나만 붙이지 않는다(외부 요청 없음). 다른 노드는 그대로 둔다.
    guard = (
        "// 체험판: 소셜 로그인을 쓰지 않으므로 구글 로그인 SDK를 받지 않는다.\n"
        "(function () {\n"
        "  var append = Node.prototype.appendChild;\n"
        "  Node.prototype.appendChild = function (node) {\n"
        "    if (node && node.tagName === 'SCRIPT' &&\n"
        "        String(node.src).indexOf('https://accounts.google.com/') === 0) {\n"
        "      return node;\n"
        "    }\n"
        "    return append.call(this, node);\n"
        "  };\n"
        "})();\n"
    )
    js = guard + js
    open(path, "w", encoding="utf-8").write(js)


def patch_manifest():
    path = os.path.join(BUILD, "manifest.json")
    if not os.path.exists(path):
        return
    text = open(path, encoding="utf-8").read()
    text = re.sub(r'("name":\s*")[^"]*(")', rf"\g<1>{TITLE}\2", text)
    text = re.sub(r'("short_name":\s*")[^"]*(")', r"\g<1>가치가차 체험\2", text)
    open(path, "w", encoding="utf-8").write(text)


def prune():
    removed = []
    for junk in [".last_build_id"]:
        p = os.path.join(BUILD, junk)
        if os.path.exists(p):
            os.remove(p)
            removed.append(junk)
    sw = os.path.join(BUILD, "flutter_service_worker.js")
    if os.path.exists(sw):
        os.remove(sw)
        removed.append("flutter_service_worker.js")
    ck = os.path.join(BUILD, "canvaskit")
    for name in sorted(os.listdir(ck)):
        full = os.path.join(ck, name)
        if name.startswith(("skwasm", "wimp")) or name == "webparagraph":
            shutil.rmtree(full) if os.path.isdir(full) else os.remove(full)
            removed.append(f"canvaskit/{name}")
    for dirpath, _, files in os.walk(BUILD):
        for f in files:
            if f.endswith(".symbols"):
                os.remove(os.path.join(dirpath, f))
                removed.append(os.path.relpath(os.path.join(dirpath, f), BUILD))
    # 남아야 하는 CanvasKit(일반 + 크로미움 변형).
    for need in ["canvaskit.js", "canvaskit.wasm", "chromium/canvaskit.js", "chromium/canvaskit.wasm"]:
        assert os.path.exists(os.path.join(ck, need)), f"missing canvaskit/{need}"
    return removed


def stats(folder):
    files = []
    for dirpath, _, names in os.walk(folder):
        for n in names:
            p = os.path.join(dirpath, n)
            files.append((os.path.relpath(p, folder), os.path.getsize(p)))
    return files


def main():
    out = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else None
    run_build()
    patch_index()
    patch_bootstrap()
    patch_manifest()
    removed = prune()
    print("removed:", ", ".join(removed))

    files = stats(BUILD)
    total = sum(s for _, s in files)
    biggest = max(files, key=lambda f: f[1])
    print(f"files: {len(files)}  total: {total / 1024 / 1024:.2f} MB  largest: {biggest[0]} {biggest[1] / 1024 / 1024:.2f} MB")
    assert len(files) < MAX_FILES, "too many files"
    assert total < MAX_TOTAL, "too large"
    assert biggest[1] <= MAX_FILE, "a file is over 15MB"

    if out:
        if os.path.exists(out):
            shutil.rmtree(out)
        shutil.copytree(BUILD, out)
        print("copied to", out)


if __name__ == "__main__":
    main()
