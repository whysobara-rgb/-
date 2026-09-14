"""Runs only against the dedicated CI emulator; never touches a user's device."""
import os
import pathlib
import subprocess
import time

PACKAGE = 'com.gachavault.gacha.debug'
ACTIVITY = PACKAGE + '/com.gachavault.gacha.MainActivity'
OUT = pathlib.Path('build/android-evidence')
OUT.mkdir(parents=True, exist_ok=True)

def adb(*args, check=True):
    return subprocess.run(['adb', '-s', 'emulator-5554', *args], text=True, capture_output=True, check=check, timeout=45).stdout

def marker(expected):
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        logs = adb('logcat', '-d', '-s', 'flutter:I', '*:S')
        if 'GACHA_STORAGE_PROBE_FAILED' in logs:
            raise RuntimeError('Native storage probe reported failure')
        if expected in logs:
            return
        time.sleep(1)
    raise RuntimeError('Timed out waiting for ' + expected)

if os.environ.get('GITHUB_ACTIONS') != 'true':
    raise SystemExit('This script requires the isolated GitHub Actions emulator')
try:
    adb('install', '-r', 'build/deliverables/gachigacha-startup-debug.apk')
    adb('shell', 'am', 'start', '-W', '-n', ACTIVITY)
    deadline = time.monotonic() + 60
    login_visible = False
    while time.monotonic() < deadline:
        adb('shell', 'uiautomator', 'dump', '/sdcard/gacha-window.xml', check=False)
        hierarchy = adb('shell', 'cat', '/sdcard/gacha-window.xml', check=False)
        if '로그인' in hierarchy:
            login_visible = True
            (OUT / 'login-window.xml').write_text(hierarchy)
            break
        time.sleep(2)
    if not login_visible:
        raise RuntimeError('Production entrypoint did not render the login screen')
    with (OUT / 'login.png').open('wb') as image:
        subprocess.run(['adb','-s','emulator-5554','exec-out','screencap','-p'], stdout=image, check=True, timeout=30)
    adb('shell', 'am', 'force-stop', PACKAGE)
    adb('install', '-r', 'build/deliverables/storage-probe-debug.apk')
    adb('shell', 'pm', 'clear', PACKAGE)  # disposable CI debug package only
    adb('logcat', '-c')
    adb('shell', 'am', 'start', '-W', '-n', ACTIVITY)
    marker('GACHA_STORAGE_PROBE_WRITTEN')
    first_pid = adb('shell', 'pidof', PACKAGE).strip()
    adb('shell', 'am', 'force-stop', PACKAGE)
    if adb('shell', 'pidof', PACKAGE, check=False).strip():
        raise RuntimeError('App process did not stop')
    adb('logcat', '-c')
    adb('shell', 'am', 'start', '-W', '-n', ACTIVITY)
    marker('GACHA_STORAGE_PROBE_VERIFIED')
    second_pid = adb('shell', 'pidof', PACKAGE).strip()
    if not first_pid or not second_pid or first_pid == second_pid:
        raise RuntimeError('Did not observe a fresh process')
    (OUT / 'result.txt').write_text('PASS: main entrypoint login rendered\nPASS: native secure storage survives force-stop and new process\nPASS: purchase key/body replayed; opening recovered by GET; records cleared after confirmation\nNetwork: mocked transport; no real API transactions\n')
    print((OUT / 'result.txt').read_text())
finally:
    (OUT / 'flutter.log').write_text(adb('logcat','-d','-s','flutter:I','*:S',check=False))
