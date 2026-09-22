"""Build the existing staging Profile scheme with the verified CI identity only."""
import base64
import hashlib
import json
import os
from pathlib import Path
import plistlib
import secrets
import shlex
import shutil
import subprocess
import sys
import tempfile
import zipfile

from native_validation import (CERT_SHA1, IOS_ID, P12_SHA256, PROFILE_NAME, PROFILE_UUID,
                               TEAM_ID, backend_guard, check_profile, check_signed_app, run)
from validate import require, validate_ios_prebuild


def build():
    require(sys.platform == 'darwin' and os.environ.get('GITHUB_ACTIONS') == 'true',
            'GitHub macOS runner required')
    os.umask(0o077)
    values = {name: os.environ.pop(name, '') for name in
              ('STAGING_P12', 'STAGING_P12_PASSWORD', 'STAGING_PROFILE')}
    require(all(values.values()), 'Staging signing secret missing')
    backend_guard()
    with tempfile.TemporaryDirectory(prefix='staging-native-', dir=os.environ['RUNNER_TEMP']) as directory:
        temp = Path(directory)
        keychain = temp / 'signing.keychain-db'
        p12 = temp / 'identity.p12'
        profile_file = temp / 'staging.mobileprovision'
        installed = None
        created = False
        previous = shlex.split(run(['security', 'list-keychains', '-d', 'user']).decode())
        try:
            p12.write_bytes(base64.b64decode(values.pop('STAGING_P12'), validate=True))
            profile_file.write_bytes(base64.b64decode(values.pop('STAGING_PROFILE'), validate=True))
            password = values.pop('STAGING_P12_PASSWORD')
            require(hashlib.sha256(p12.read_bytes()).hexdigest() == P12_SHA256, 'P12 integrity mismatch')
            check_profile(plistlib.loads(run(['security', 'cms', '-D', '-i', str(profile_file)])))
            keychain_password = secrets.token_urlsafe(48)
            run(['security', 'create-keychain', '-p', keychain_password, str(keychain)])
            created = True
            run(['security', 'set-keychain-settings', '-lut', '7200', str(keychain)])
            run(['security', 'unlock-keychain', '-p', keychain_password, str(keychain)])
            run(['security', 'import', str(p12), '-k', str(keychain), '-P', password,
                 '-T', '/usr/bin/codesign', '-T', '/usr/bin/security'])
            password = None
            p12.unlink()
            run(['security', 'set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:',
                 '-s', '-k', keychain_password, str(keychain)])
            run(['security', 'list-keychains', '-d', 'user', '-s', str(keychain), *previous])
            require(CERT_SHA1 in run(['security', 'find-identity', '-v', '-p', 'codesigning', str(keychain)]).decode(),
                    'Verified Apple Distribution identity unavailable')
            destination = Path.home() / 'Library/MobileDevice/Provisioning Profiles'
            destination.mkdir(parents=True, exist_ok=True)
            installed = destination / (PROFILE_UUID + '.mobileprovision')
            with installed.open('xb') as file:
                file.write(profile_file.read_bytes())
            print('PASS: existing P12 imported; exact identity/profile/two devices verified', flush=True)
            # Generates Flutter settings and installs Pods, but does not create an unsigned app.
            subprocess.run(['flutter', 'build', 'ios', '--profile', '--flavor', 'staging',
                            '--config-only', '--no-codesign',
                            '--dart-define=API_BASE_URL=' + os.environ['API_BASE_URL']], check=True)
            options = ['-workspace', 'ios/Runner.xcworkspace', '-scheme', 'staging',
                       '-configuration', 'Profile-staging', '-sdk', 'iphoneos',
                       '-destination', 'generic/platform=iOS']
            settings = json.loads(run(['xcodebuild', *options, '-showBuildSettings', '-json']))
            runner = next(s['buildSettings'] for s in settings if s['target'] == 'Runner')
            validate_ios_prebuild({**runner, 'API_BASE_URL': os.environ['API_BASE_URL']})
            require(runner['CONFIGURATION'] == 'Profile-staging', 'Profile configuration required')
            print('PASS: effective Xcode Profile-staging configuration and actual Dart defines', flush=True)
            archive = Path('build/ios/archive/Staging.xcarchive')
            # Capture build output without ever uploading raw signing diagnostics.
            result = subprocess.run(['xcodebuild', *options, '-archivePath', str(archive), 'archive'],
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            if result.returncode:
                lines = result.stdout.decode(errors='replace').splitlines()
                for line in lines:
                    if 'error:' in line or '** ARCHIVE FAILED **' in line:
                        print(line[:1500], flush=True)
                raise ValueError('Profile archive failed')
            print('PASS: Profile archive created', flush=True)
            archived_app = archive / 'Products/Applications/Runner.app'
            evidence = check_signed_app(archived_app, temp)
            export_options = temp / 'ExportOptions.plist'
            export_options.write_bytes(plistlib.dumps({
                'method': 'ad-hoc', 'destination': 'export', 'signingStyle': 'manual',
                'teamID': TEAM_ID, 'signingCertificate': CERT_SHA1,
                'provisioningProfiles': {IOS_ID: PROFILE_UUID},
                'stripSwiftSymbols': True, 'manageAppVersionAndBuildNumber': False,
            }))
            output = Path('build/staging-ios')
            output.mkdir(parents=True, exist_ok=True)
            run(['xcodebuild', '-exportArchive', '-archivePath', str(archive),
                 '-exportPath', str(output), '-exportOptionsPlist', str(export_options)])
            ipas = list(output.glob('*.ipa'))
            require(len(ipas) == 1, 'Expected exactly one exported IPA')
            unpacked = temp / 'ipa'
            with zipfile.ZipFile(ipas[0]) as zipped:
                require(not any(n.endswith(('.p12', '.pem', '.key')) for n in zipped.namelist()),
                        'Private signing file in IPA')
                zipped.extractall(unpacked)
            apps = list((unpacked / 'Payload').glob('*.app'))
            require(len(apps) == 1, 'Expected one IPA app')
            require(check_signed_app(apps[0], temp) == evidence, 'Export altered app contract')
            evidence.update({'flutter_sha': os.environ['GITHUB_SHA'], 'backend_sha': os.environ['EXPECTED_BACKEND_SHA'],
                             'ipa_sha256': hashlib.sha256(ipas[0].read_bytes()).hexdigest(),
                             'configuration': 'Profile-staging', 'runtime_mode_override': False,
                             'physical_device_tested': False, 'firebase_uploaded': False})
            (output / 'validation.json').write_text(json.dumps(evidence, indent=2) + '\n')
            print('PASS: exported Ad Hoc IPA signature, bundle, Keychain, Profile engine and staging origin', flush=True)
        finally:
            if installed is not None:
                installed.unlink(missing_ok=True)
            if created:
                run(['security', 'list-keychains', '-d', 'user', '-s', *previous])
                run(['security', 'delete-keychain', str(keychain)])
            print('Temporary signing identity/profile removed from runner', flush=True)


if __name__ == '__main__':
    try:
        build()
    except Exception as error:
        print('FAIL: ' + (str(error) if type(error) is ValueError else 'Native build failed; sensitive diagnostics withheld'), file=sys.stderr)
        sys.exit(1)
