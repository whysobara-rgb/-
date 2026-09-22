"""Capture actual Flutter widgets with labelled fixtures on the disposable CI emulator."""
import json
import os
import pathlib
import subprocess
import time

if os.environ.get('GITHUB_ACTIONS') != 'true':
    raise SystemExit('Requires the isolated GitHub Actions emulator')
out = pathlib.Path('build/android-evidence')
out.mkdir(parents=True, exist_ok=True)
package = 'com.gachavault.gacha.debug'

def adb(*args, check=True):
    return subprocess.run(['adb', '-s', 'emulator-5554', *args], text=True,
                          capture_output=True, check=check, timeout=60).stdout

adb('shell', 'am', 'force-stop', package)
adb('install', '-r', 'build/deliverables/v33-stage2-probe-debug.apk')
adb('logcat', '-c')
adb('shell', 'am', 'start', '-W', '-n', package + '/com.gachavault.gacha.MainActivity')
pending = {'OPEN', 'RESULT', 'PARTIAL', 'COLLECTION', 'MY'}
try:
    deadline = time.monotonic() + 90
    while pending and time.monotonic() < deadline:
        logs = adb('logcat', '-d', '-s', 'flutter:I', '*:S')
        if 'V33_STAGE2_FAILED' in logs:
            raise RuntimeError('Flutter UI error; see v33-stage2-ui.log')
        for screen in tuple(pending):
            if 'V33_STAGE2_' + screen + '_READY' in logs:
                with (out / ('v33-stage2-' + screen.lower() + '.png')).open('wb') as stream:
                    subprocess.run(['adb', '-s', 'emulator-5554', 'exec-out', 'screencap', '-p'],
                                   stdout=stream, check=True, timeout=30)
                pending.remove(screen)
                print('PASS: V33', screen, 'rendered with labelled synthetic data')
        time.sleep(0.25)
    if pending:
        raise RuntimeError('Missing UI frames: ' + ', '.join(sorted(pending)))
    (out / 'v33-stage2-result.json').write_text(json.dumps({
        'result': 'PASS', 'screens': ['Open', 'Open Result', 'Partial Result', 'Collection', 'My'],
        'source_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
        'device': 'Android API 35 x86_64 emulator', 'data': 'synthetic UI fixtures',
        'live_transactions': False,
    }, indent=2))
finally:
    (out / 'v33-stage2-ui.log').write_text(adb('logcat', '-d', '-s', 'flutter:I', '*:S', check=False))
    adb('shell', 'am', 'force-stop', package)
