"""Package an already-built review web target; does not build/deploy anything."""
import argparse
import json
import shutil
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--flutter-sdk", required=True, type=Path)
parser.add_argument("--output", required=True, type=Path)
args = parser.parse_args()
repo = Path(__file__).resolve().parents[2]
target = args.output.resolve()
if target.exists():
    raise SystemExit("Output already exists; preserve the earlier package")
shutil.copytree(repo / "tool/r2/browser_runtime", target,
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
shutil.copytree(repo / "build/r2-browser-preview", target / "web")
photos = target / "web/review-photos"
photos.mkdir(exist_ok=True)
for photo in (repo / "tool/r2/photos").glob("*.jpg"):
    shutil.copy2(photo, photos / photo.name)
# CanvasKit otherwise requests its implicit Roboto fallback from Google CDN,
# even when the application's actual typography is bundled Pretendard.
# Register the exact SDK font locally in this review output only.
fonts = args.flutter_sdk / "bin/cache/artifacts/material_fonts"
shutil.copy2(fonts / "Roboto-Regular.ttf", target / "web/assets/fonts/Roboto-Regular.ttf")
shutil.copy2(fonts / "Roboto_LICENSE.txt", target / "Roboto-LICENSE.txt")
manifest = target / "web/assets/FontManifest.json"
data = json.loads(manifest.read_text())
if not any(font["family"] == "Roboto" for font in data):
    data.append({"family": "Roboto", "fonts": [{"asset": "fonts/Roboto-Regular.ttf"}]})
manifest.write_text(json.dumps(data))
audit = (repo / "docs/r2/R2-A-AUDIT.md").read_text()
rights = audit.split("## 사진/폰트 권리와 한계", 1)[1].split("- 기존 Pretendard", 1)[0]
rights += "\n컴파일된 Flutter 화면의 Pretendard 폰트는 Pretendard-OFL.txt, 로컬 CanvasKit fallback Roboto는 Roboto-LICENSE.txt를 함께 제공합니다. 실제 상품 사진 매칭은 미완료입니다.\n"
(target / "PHOTO-RIGHTS.md").write_text("# 검토용 사진 출처\n" + rights)
for name in ("Start-Preview.cmd", "Start-Preview.ps1"):
    file = target / name
    file.write_bytes(file.read_text().replace("\r\n", "\n").replace("\n", "\r\n").encode())
index = target / "web/index.html"
index.write_text(index.read_text().replace("<title>gacha_vault</title>", "<title>GachiGacha R2-A1 Review</title>"))
print(target)
