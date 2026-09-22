"""Stage 4C checks. No mutation, credentials, or signing material in evidence."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import plistlib
import subprocess
import urllib.request
import zipfile

from validate import IOS_ID, TEAM_ID, require, validate_ios_identity, validate_origin

ORIGIN = 'https://gacha-vault-backend-staging.onrender.com'
BACKEND_SHA = 'a224c07435f7ba17b65baf0c6d7ab2c5b9e629a7'
CERT_SHA1 = '27383C642AF5A956690DC3EF17D19CAE2530AD80'
CERT_SHA256 = 'b9a8fc18bfd1f841eb5c5b5142f7ba53d1580d6a64a27e2bbe3b952be9012357'
P12_SHA256 = '466da63c230b5eb05d0bdb138fb1d25e55053117e54579cbdd40a24c17b154c3'
DEVICE_DIGEST = '09aa11538f89e50152c3880d89237035f9643eedc4ba41a7b472c9227887070c'
PROFILE_UUID = 'bb447feb-6d61-42ba-854c-a1265bbad26f'
PROFILE_NAME = 'GachiGacha Staging CI Ad Hoc 20260922'


def run(args, data=None):
    result = subprocess.run(args, input=data, capture_output=True)
    require(result.returncode == 0, 'Native inspection command failed (raw output withheld)')
    return result.stdout


def exact_origin():
    origin = validate_origin(os.environ.get('API_BASE_URL', ''))
    require(origin == ORIGIN, 'This validation authorizes only the approved staging origin')
    return origin


def check_health_payload(payload, ready=False):
    require(payload.get('statusCode') == 10000, 'Health envelope mismatch')
    data = payload['data']
    require(data.get('status') == ('ready' if ready else 'ok'), 'Backend not healthy/ready')
    release = data.get('release', {})
    require(release.get('commit') == BACKEND_SHA and release.get('consistent') is True
            and release.get('source') == 'render' and release.get('contract') == 'RELEASE_IDENTITY_V1',
            'Backend release identity mismatch')
    if ready:
        require(data.get('database') == 'connected' and data.get('schema') == 'current',
                'Backend database/schema not ready')


def backend_guard():
    origin = exact_origin()
    for path, ready in [('/health', False), ('/health/ready', True)]:
        with urllib.request.urlopen(origin + path, timeout=30) as response:
            require(response.status == 200 and response.url == origin + path,
                    'Backend health status or redirect mismatch')
            check_health_payload(json.load(response), ready)
    print('PASS: staging health/readiness HTTP 200; approved Backend SHA; DB/schema ready')


def check_profile(profile):
    ent = profile.get('Entitlements', {})
    app_id = TEAM_ID + '.' + IOS_ID
    require(profile.get('Name') == PROFILE_NAME and profile.get('UUID', '').lower() == PROFILE_UUID,
            'Wrong staging profile')
    require(profile.get('TeamIdentifier') == [TEAM_ID], 'Wrong profile team')
    require(ent.get('application-identifier') == app_id
            and ent.get('com.apple.developer.team-identifier') == TEAM_ID, 'Wrong profile App ID')
    require(ent.get('get-task-allow') is False and not profile.get('ProvisionsAllDevices', False),
            'Not an Ad Hoc distribution profile')
    devices = profile.get('ProvisionedDevices', [])
    require(len(devices) == len(set(devices)) == 2, 'Expected two approved devices')
    require(hashlib.sha256('\n'.join(sorted(devices)).encode()).hexdigest() == DEVICE_DIGEST,
            'Unexpected device set')
    certs = profile.get('DeveloperCertificates', [])
    require(len(certs) == 1 and hashlib.sha256(certs[0]).hexdigest() == CERT_SHA256,
            'Wrong profile certificate')
    expires = profile['ExpirationDate'].replace(tzinfo=datetime.timezone.utc)
    require(expires.date().isoformat() == '2027-09-22'
            and expires > datetime.datetime.now(datetime.timezone.utc), 'Profile expiration mismatch')


def check_signed_app(app, temp):
    run(['codesign', '--verify', '--deep', '--strict', str(app)])
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    ent = plistlib.loads(run(['codesign', '-d', '--entitlements', ':-', str(app)]))
    validate_ios_identity(info, ent)
    require(ent.get('get-task-allow') is False, 'App signed for development instead of Ad Hoc')
    profile = plistlib.loads(run(['security', 'cms', '-D', '-i', str(app / 'embedded.mobileprovision')]))
    check_profile(profile)
    prefix = str(temp / 'verified-cert-')
    run(['codesign', '-d', '--extract-certificates', prefix, str(app)])
    require(hashlib.sha256(Path(prefix + '0').read_bytes()).hexdigest() == CERT_SHA256,
            'Final signature does not use the approved Distribution certificate')
    binary = app / 'Frameworks/App.framework/App'
    require(exact_origin().encode() in binary.read_bytes(), 'Staging origin missing from compiled Dart AOT')
    engine = app / 'Frameworks/Flutter.framework/Flutter'
    sdk = Path(os.environ['FLUTTER_ROOT']) / 'bin/cache/artifacts/engine/ios-profile/Flutter.xcframework/ios-arm64/Flutter.framework/Flutter'
    require(sdk.is_file(), 'Profile SDK engine missing')
    def uuids(path):
        return {line.split()[1] for line in run(['dwarfdump', '--uuid', str(path)]).decode().splitlines()}
    require(uuids(engine) == uuids(sdk) and bool(uuids(engine)), 'Final app does not contain the Profile engine')
    return {'bundle_id': IOS_ID, 'profile_uuid': PROFILE_UUID, 'device_count': 2,
            'expires': '2027-09-22', 'certificate_sha256': CERT_SHA256,
            'keychain_groups': ent['keychain-access-groups'], 'api_origin': ORIGIN,
            'engine_mode': 'profile', 'signature_verified': True}


def check_apk_origin(apk):
    with zipfile.ZipFile(apk) as archive:
        require(not any(n.endswith(('.p12', '.pem', '.mobileprovision', 'key.properties'))
                        for n in archive.namelist()), 'Forbidden signing file in APK')
        kernel = archive.read('assets/flutter_assets/kernel_blob.bin')
        require(exact_origin().encode() in kernel, 'Staging origin missing from compiled Dart kernel')
    print('PASS: explicit staging origin found in APK Dart kernel; no signing secret files')


if __name__ == '__main__':
    import sys
    try:
        if sys.argv[1:] == ['backend']:
            backend_guard()
        elif len(sys.argv) == 3 and sys.argv[1] == 'apk':
            check_apk_origin(Path(sys.argv[2]))
        else:
            raise ValueError('Unknown native validation command')
    except Exception as error:
        print('FAIL: ' + (str(error) if type(error) is ValueError else 'Native check unavailable'), file=sys.stderr)
        sys.exit(1)
