import copy
import datetime
import hashlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import native_validation as native


class NativeValidationTests(unittest.TestCase):
    def health(self, ready=False):
        return {'statusCode': 10000, 'data': {
            'status': 'ready' if ready else 'ok', 'database': 'connected', 'schema': 'current',
            'release': {'contract': 'RELEASE_IDENTITY_V1', 'commit': native.BACKEND_SHA,
                        'source': 'render', 'consistent': True}}}

    def test_live_identity_contract(self):
        native.check_health_payload(self.health())
        native.check_health_payload(self.health(True), True)

    def test_wrong_sha_or_inconsistent_identity_rejected(self):
        for key, value in [('commit', '0' * 40), ('consistent', False), ('source', 'unknown')]:
            data = self.health()
            data['data']['release'][key] = value
            with self.assertRaises(ValueError):
                native.check_health_payload(data)

    def test_unready_db_or_schema_rejected(self):
        for key in ['database', 'schema', 'status']:
            data = self.health(True)
            data['data'][key] = 'unknown'
            with self.assertRaises(ValueError):
                native.check_health_payload(data, True)

    def test_missing_dummy_and_original_origins_rejected(self):
        for value in ['', 'https://example.com', 'https://gacha-vault-backend.onrender.com']:
            with patch.dict(os.environ, {'API_BASE_URL': value}), self.assertRaises(ValueError):
                native.exact_origin()
        with patch.dict(os.environ, {'API_BASE_URL': native.ORIGIN}):
            self.assertEqual(native.exact_origin(), native.ORIGIN)

    def profile(self):
        return {'Name': native.PROFILE_NAME, 'UUID': native.PROFILE_UUID,
                'TeamIdentifier': [native.TEAM_ID],
                'Entitlements': {'application-identifier': native.TEAM_ID + '.' + native.IOS_ID,
                                 'com.apple.developer.team-identifier': native.TEAM_ID,
                                 'get-task-allow': False},
                'ProvisionedDevices': ['synthetic-device-a', 'synthetic-device-b', 'synthetic-device-c'],
                'DeveloperCertificates': [b'synthetic-cert'],
                'ExpirationDate': datetime.datetime(2027, 9, 22, 0, 0)}

    def check_synthetic_profile(self, profile):
        with patch.object(native, 'DEVICE_DIGEST', hashlib.sha256(b'synthetic-device-a\nsynthetic-device-b\nsynthetic-device-c').hexdigest()), \
             patch.object(native, 'CERT_SHA256', hashlib.sha256(b'synthetic-cert').hexdigest()):
            native.check_profile(profile)

    def test_exact_adhoc_profile_contract(self):
        self.check_synthetic_profile(self.profile())

    def test_three_device_set_is_order_independent(self):
        profile = self.profile()
        profile['ProvisionedDevices'].reverse()
        self.check_synthetic_profile(profile)

    def test_legacy_missing_duplicate_extra_or_unapproved_devices_rejected(self):
        approved = self.profile()['ProvisionedDevices']
        for devices in [approved[:2], approved[1:], approved + ['unapproved'],
                        approved[:2] + [approved[0]], approved[:2] + ['unapproved']]:
            with self.subTest(devices=devices):
                profile = self.profile()
                profile['ProvisionedDevices'] = devices
                with self.assertRaises(ValueError):
                    self.check_synthetic_profile(profile)

    def test_wrong_profile_device_certificate_and_expiry_rejected(self):
        for key, value in [('Name', 'Production'), ('UUID', 'wrong'),
                           ('TeamIdentifier', ['OTHER']), ('ProvisionsAllDevices', True),
                           ('ProvisionedDevices', ['synthetic-device-a']),
                           ('ProvisionedDevices', ['synthetic-device-a', 'unapproved']),
                           ('DeveloperCertificates', [b'wrong-cert']),
                           ('ExpirationDate', datetime.datetime(2027, 9, 21))]:
            profile = self.profile()
            profile[key] = value
            with self.assertRaises(ValueError, msg=key):
                self.check_synthetic_profile(profile)

    def test_production_bundle_and_development_entitlement_rejected(self):
        for key, value in [('application-identifier', native.TEAM_ID + '.com.gachavault.gachaVault'),
                           ('get-task-allow', True)]:
            profile = self.profile()
            profile['Entitlements'][key] = value
            with self.assertRaises(ValueError):
                self.check_synthetic_profile(profile)

    def test_compiled_apk_origin_and_secret_file_guard(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'API_BASE_URL': native.ORIGIN}):
            for origin, forbidden, valid in [(native.ORIGIN, False, True),
                                             ('https://example.com', False, False),
                                             (native.ORIGIN, True, False)]:
                apk = Path(directory) / 'test.apk'
                with zipfile.ZipFile(apk, 'w') as zipped:
                    zipped.writestr('assets/flutter_assets/kernel_blob.bin', origin)
                    if forbidden:
                        zipped.writestr('identity.p12', 'synthetic forbidden container')
                if valid:
                    native.check_apk_origin(apk)
                else:
                    with self.assertRaises(ValueError):
                        native.check_apk_origin(apk)


if __name__ == '__main__':
    unittest.main()
