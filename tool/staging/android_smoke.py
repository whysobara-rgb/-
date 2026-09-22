"""Install only on the disposable CI emulator. No credentials or transactions."""
import json
import os
from pathlib import Path
import subprocess
import time
from validate import ANDROID_ID, require

require(os.environ.get('GITHUB_ACTIONS') == 'true', 'CI emulator required')
SERIAL = 'emulator-5554'
OUT = Path('build/staging-android-evidence')
OUT.mkdir(parents=True, exist_ok=True)


def adb(*args, check=True):
    return subprocess.run(['adb', '-s', SERIAL, *args], capture_output=True,
                          check=check, timeout=45).stdout


require(adb('shell', 'getprop', 'ro.kernel.qemu').strip() == b'1', 'Physical device forbidden')
adb('install', '-r', 'build/app/outputs/flutter-apk/app-debug.apk')
adb('shell', 'am', 'start', '-W', '-n', ANDROID_ID + '/com.gachavault.gacha.MainActivity')
deadline = time.monotonic() + 90
while time.monotonic() < deadline:
    adb('shell', 'uiautomator', 'dump', '/sdcard/staging-window.xml', check=False)
    hierarchy = adb('shell', 'cat', '/sdcard/staging-window.xml', check=False).decode(errors='replace')
    if '이메일로 로그인' in hierarchy:
        (OUT / 'login.png').write_bytes(adb('exec-out', 'screencap', '-p'))
        (OUT / 'validation.json').write_text(json.dumps({
            'flutter_sha': os.environ['GITHUB_SHA'], 'package_id': ANDROID_ID,
            'emulator': SERIAL, 'install': 'PASS', 'launch': 'PASS', 'login_screen': 'PASS',
            'authenticated_home_shop_my': 'NOT TESTED: CI test account credentials not supplied',
            'app_to_api_runtime': 'NOT TESTED: no authenticated request made',
            'purchase_open': 'NOT EXECUTED', 'physical_device': False}, indent=2))
        print('PASS: staging APK installed/launched on CI emulator; login screen rendered')
        break
    time.sleep(2)
else:
    raise ValueError('Staging login screen did not appear')
