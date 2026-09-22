"""CI-only simulator launch and native keychain checks. No live transactions."""
import json
import pathlib
import plistlib
import subprocess
import sys
import time

EVIDENCE = pathlib.Path('build/ios-evidence')
EVIDENCE.mkdir(parents=True, exist_ok=True)


def run(*args, timeout=60):
    with (EVIDENCE / 'commands.log').open('a') as log:
        log.write(' '.join(args) + '\n')
        try:
            result = subprocess.check_output(args, text=True, timeout=timeout, stderr=subprocess.STDOUT)
            log.write(result + '\n')
            return result
        except subprocess.CalledProcessError as error:
            log.write(error.output or '')
            raise


def device():
    devices = json.loads(run('xcrun', 'simctl', 'list', 'devices', 'available', '--json'))['devices']
    phones = [d for runtime, items in devices.items() if '.iOS-' in runtime
              for d in items if d['isAvailable'] and d['name'].startswith('iPhone')]
    if not phones:
        raise RuntimeError('No available iPhone simulator runtime')
    phone = next((d for d in phones if d['state'] == 'Booted'), phones[0])
    if phone['state'] != 'Booted':
        run('xcrun', 'simctl', 'boot', phone['udid'])
    run('xcrun', 'simctl', 'bootstatus', phone['udid'], '-b', timeout=180)
    (EVIDENCE / 'selected-device.json').write_text(json.dumps(phone, indent=2))
    return phone['udid']


def launch_and_expect(udid, bundle, marker, name):
    targets = dict(marker) if isinstance(marker, dict) else {marker: name}
    output = EVIDENCE / (name + '.log')
    unified = EVIDENCE / (name + '-unified.log')
    with output.open('w') as stream, unified.open('w') as device_log:
        # Flutter's simulator log reader uses unified logging; stdout alone
        # does not contain Dart debugPrint output on modern iOS.
        log_process = subprocess.Popen(['xcrun', 'simctl', 'spawn', udid,
            'log', 'stream', '--style', 'json', '--predicate',
            'processImagePath ENDSWITH "/Runner"'], stdout=device_log, stderr=subprocess.STDOUT)
        process = subprocess.Popen(['xcrun', 'simctl', 'launch', '--console',
            '--terminate-running-process', udid, bundle, '--enable-checked-mode', '--verify-entry-points'], stdout=stream, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 90
            while time.monotonic() < deadline:
                logs = output.read_text() + unified.read_text()
                if 'GACHA_STORAGE_PROBE_FAILED' in logs:
                    raise RuntimeError('Native storage verification failed; inspect evidence')
                if 'V33_UI_PROBE_FAILED' in logs:
                    raise RuntimeError('Flutter V33 presentation error; inspect evidence')
                for expected, capture_name in list(targets.items()):
                    if expected in logs:
                        run('xcrun', 'simctl', 'io', udid, 'screenshot', str(EVIDENCE / (capture_name + '.png')))
                        print('PASS:', capture_name, expected)
                        del targets[expected]
                if not targets:
                    return
                if process.poll() is not None:
                    raise RuntimeError('Application terminated before verification marker')
                time.sleep(0.25)
            raise RuntimeError('Application verification timed out; inspect evidence')
        finally:
            # Keep visual evidence even when verification fails.
            subprocess.run(['xcrun', 'simctl', 'io', udid, 'screenshot',
                str(EVIDENCE / (name + '-final.png'))], capture_output=True, timeout=30)
            log_process.terminate()
            try:
                log_process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                log_process.kill()
                log_process.wait()
            subprocess.run(['xcrun', 'simctl', 'terminate', udid, bundle], capture_output=True, timeout=30)
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


mode = sys.argv[1]
udid = device()
if mode == 'prepare':
    print('Simulator ready for build and install')
    sys.exit(0)
app = pathlib.Path('build/ios-deliverables/Runner.app' if mode == 'app' else 'build/ios/iphonesimulator/Runner.app')
with (app / 'Info.plist').open('rb') as stream:
    bundle = plistlib.load(stream)['CFBundleIdentifier']
run('xcrun', 'simctl', 'install', udid, str(app), timeout=240)
if mode == 'app':
    launch_and_expect(udid, bundle, 'GACHA_APP_FRAME_READY', 'app-launch')
elif mode == 'storage':
    launch_and_expect(udid, bundle, 'GACHA_STORAGE_PROBE_WRITTEN', 'keychain-write')
    launch_and_expect(udid, bundle, 'GACHA_STORAGE_PROBE_VERIFIED', 'keychain-restart-recovery')
elif mode == 'v33':
    launch_and_expect(udid, bundle, {
        'V33_HOME_READY': 'v33-home', 'V33_SHOP_READY': 'v33-shop',
        'V33_DETAIL_READY': 'v33-detail',
    }, 'v33-ui')
    (EVIDENCE / 'v33-result.json').write_text(json.dumps({
        'result': 'PASS', 'screens': ['Home', 'Box Shop', 'Product Detail'],
        'source_commit': run('git', 'rev-parse', 'HEAD').strip(),
        'device': udid, 'data': 'synthetic UI fixtures', 'live_transactions': False,
    }, indent=2))
else:
    raise ValueError('Unknown verification mode')
