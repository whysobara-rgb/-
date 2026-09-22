"""Synthetic inspections only: no native commands, signing assets or network access."""
import contextlib
import datetime
import hashlib
import io
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import native_validation as native


STAGES = [
    ('codesign_verify', 'codesign', 0),
    ('entitlements_extract', 'codesign', 0),
    ('app_identity_check', 'python_contract', None),
    ('profile_decode', 'security_cms', 0),
    ('profile_contract_check', 'python_contract', None),
    ('certificate_requirement_check', 'codesign', 0),
    ('compiled_origin_check', 'python_binary', None),
    ('profile_engine_binary_exists', 'python_file', None),
    ('profile_engine_uuid_check', 'dwarfdump', 0),
]
SENSITIVE = 'SYNTHETIC_PRIVATE_DIAGNOSTICS_DO_NOT_PRINT'
APPROVED_LEAF = '27383C642AF5A956690DC3EF17D19CAE2530AD80'
APPROVED_IDENTIFIER = 'com.gachavault.gachaVault.staging'


class IOSInspectionDiagnosticsTests(unittest.TestCase):
    def inspect(self, failure=None, *, malformed=None, unavailable=False, archive_exists=True,
                signer_leaf=APPROVED_LEAF, signer_identifier=APPROVED_IDENTIFIER,
                profile_certificate=None):
        with tempfile.TemporaryDirectory() as directory, contextlib.ExitStack() as stack:
            root = Path(directory)
            archive = root / 'Staging.xcarchive'
            if archive_exists:
                archive.mkdir()
            app = root / 'Runner.app'
            app.mkdir()
            (app / 'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':
                'wrong' if failure == 'app_identity_check' else native.IOS_ID}))
            binary = app / 'Frameworks/App.framework/App'
            binary.parent.mkdir(parents=True)
            binary.write_text('wrong' if failure == 'compiled_origin_check' else native.ORIGIN)
            engine = app / 'Frameworks/Flutter.framework/Flutter'
            engine.parent.mkdir(parents=True)
            engine.write_bytes(b'synthetic engine')
            sdk = root / 'sdk'
            sdk_engine = sdk / 'bin/cache/artifacts/engine/ios-profile/Flutter.xcframework/ios-arm64/Flutter.framework/Flutter'
            if failure != 'profile_engine_binary_exists':
                sdk_engine.parent.mkdir(parents=True)
                sdk_engine.write_bytes(b'synthetic engine')
            entitlement = {'application-identifier': native.TEAM_ID + '.' + native.IOS_ID,
                           'com.apple.developer.team-identifier': native.TEAM_ID,
                           'keychain-access-groups': [native.TEAM_ID + '.' + native.IOS_ID],
                           'get-task-allow': False, 'synthetic-private-value': SENSITIVE}
            cert = b'synthetic certificate ' + SENSITIVE.encode()
            devices = ['synthetic-a', 'synthetic-b', 'synthetic-c']
            profile = {'Name': 'wrong' if failure == 'profile_contract_check' else native.PROFILE_NAME,
                       'UUID': native.PROFILE_UUID, 'TeamIdentifier': [native.TEAM_ID],
                       'Entitlements': entitlement, 'ProvisionedDevices': devices,
                       'DeveloperCertificates': [cert if profile_certificate is None else profile_certificate],
                       'ExpirationDate': datetime.datetime(2027, 9, 22)}
            stack.enter_context(patch.object(native, 'CERT_SHA256', hashlib.sha256(cert).hexdigest()))
            stack.enter_context(patch.object(native, 'DEVICE_DIGEST', hashlib.sha256(b'synthetic-a\nsynthetic-b\nsynthetic-c').hexdigest()))
            stack.enter_context(patch.dict(os.environ, {'API_BASE_URL': native.ORIGIN, 'FLUTTER_ROOT': str(sdk)}))
            commands = []

            def command(args, **kwargs):
                self.assertEqual(kwargs, {'capture_output': True})
                if args[0] == 'dwarfdump':
                    label = 'profile_engine_uuid_check'
                    payload = b'UUID: SYNTHETIC-UUID (arm64) synthetic\n'
                elif args[0] == 'security':
                    label, payload = 'profile_decode', plistlib.dumps(profile)
                elif '-R' in args:
                    label, payload = 'certificate_requirement_check', b''
                    self.assertEqual(args, ['codesign', '--verify', '--strict', '-R',
                        f'=certificate leaf = H"{APPROVED_LEAF}" and identifier "{APPROVED_IDENTIFIER}"', str(app)])
                    # Model codesign's response to the captured requirement; this is
                    # command/exit-code coverage, not a macOS cryptographic test.
                    requirement = re.fullmatch(r'=certificate leaf = H"([0-9A-F]{40})" and identifier "([^"]+)"', args[4])
                    self.assertIsNotNone(requirement)
                    if (signer_leaf, signer_identifier) != requirement.groups():
                        commands.append(label)
                        return subprocess.CompletedProcess(args, 1, SENSITIVE.encode(), SENSITIVE.encode())
                elif '--verify' in args:
                    label, payload = 'codesign_verify', b''
                    self.assertEqual(args, ['codesign', '--verify', '--deep', '--strict', str(app)])
                elif '--entitlements' in args:
                    label, payload = 'entitlements_extract', plistlib.dumps(entitlement)
                else:
                    self.fail('Unexpected native command category')
                commands.append(label)
                if failure == label:
                    if unavailable:
                        raise OSError(SENSITIVE)
                    return subprocess.CompletedProcess(args, 37, SENSITIVE.encode(), SENSITIVE.encode())
                if malformed == label:
                    payload = SENSITIVE.encode()
                return subprocess.CompletedProcess(args, 0, payload, SENSITIVE.encode())

            stack.enter_context(patch.object(native.subprocess, 'run', side_effect=command))
            output = io.StringIO()
            evidence = root / 'evidence/inspection-failure.json'
            error = None
            result = None
            with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                try:
                    result = native.check_signed_app(app, root, failure_evidence=evidence, archive=archive)
                except ValueError as exception:
                    error = str(exception)
            text = output.getvalue()
            self.assertNotIn(SENSITIVE, text + (error or ''))
            self.assertNotIn(str(root), text)
            records = [json.loads(line) for line in text.splitlines()]
            self.assertTrue(all(set(row) == {'stage', 'status', 'command_category', 'return_code'} for row in records))
            saved = json.loads(evidence.read_text()) if evidence.exists() else None
            if saved:
                self.assertEqual(set(saved), {'failed_stage', 'archive_exists'})
                self.assertNotIn(SENSITIVE, evidence.read_text())
                self.assertEqual([p.name for p in evidence.parent.iterdir()], ['inspection-failure.json'])
            return records, saved, error, result, commands

    def test_all_success_stages_are_labeled_and_do_not_expose_outputs(self):
        records, saved, error, result, _ = self.inspect()
        self.assertEqual(records, [dict(stage=label, status='PASS', command_category=category, return_code=code)
                                   for label, category, code in STAGES])
        self.assertIsNone(saved)
        self.assertIsNone(error)
        self.assertTrue(result['signature_verified'])
        self.assertEqual(result['device_count'], 3)

    def test_each_failed_stage_is_identified_and_stops_inspection(self):
        for index, (label, category, code) in enumerate(STAGES):
            with self.subTest(stage=label):
                records, saved, error, result, commands = self.inspect(label)
                self.assertEqual([r['stage'] for r in records], [s[0] for s in STAGES[:index + 1]])
                self.assertTrue(all(r['status'] == 'PASS' for r in records[:-1]))
                self.assertEqual(records[-1], dict(stage=label, status='FAIL', command_category=category,
                                                  return_code=37 if code == 0 else None))
                self.assertEqual(saved, {'failed_stage': label, 'archive_exists': True})
                self.assertIsNotNone(error)
                self.assertIsNone(result)
                self.assertTrue(set(commands).issubset({s[0] for s in STAGES[:index + 1]}))

    def test_process_success_with_invalid_payload_is_still_failure(self):
        for label in ['entitlements_extract', 'profile_decode', 'profile_engine_uuid_check']:
            with self.subTest(stage=label):
                records, saved, error, result, _ = self.inspect(malformed=label)
                self.assertEqual((records[-1]['stage'], records[-1]['status'], records[-1]['return_code']),
                                 (label, 'FAIL', 0))
                self.assertEqual(saved['failed_stage'], label)
                self.assertIsNotNone(error)
                self.assertIsNone(result)

    def test_missing_command_has_no_invented_exit_code_or_raw_exception(self):
        records, saved, _, _, _ = self.inspect('codesign_verify', unavailable=True)
        self.assertEqual(records[-1]['return_code'], None)
        self.assertEqual(saved['failed_stage'], 'codesign_verify')

    def test_evidence_reports_absent_archive_honestly(self):
        _, saved, _, _, _ = self.inspect('codesign_verify', archive_exists=False)
        self.assertEqual(saved, {'failed_stage': 'codesign_verify', 'archive_exists': False})

    def test_approved_leaf_and_identifier_pass_top_level_requirement(self):
        records, saved, error, result, commands = self.inspect()
        record = next(r for r in records if r['stage'] == 'certificate_requirement_check')
        self.assertEqual((record['status'], record['return_code']), ('PASS', 0))
        self.assertEqual(commands.count('certificate_requirement_check'), 1)
        self.assertIsNone(error)
        self.assertIsNone(saved)
        self.assertTrue(result['signature_verified'])

    def test_other_signer_leaf_fails_even_when_embedded_profile_is_approved(self):
        self.assert_requirement_rejected(signer_leaf='0' * 40)

    def test_other_signed_identifier_fails_even_when_info_and_entitlements_match(self):
        self.assert_requirement_rejected(signer_identifier='com.gachavault.gachaVault')

    def assert_requirement_rejected(self, **changes):
        records, saved, error, result, _ = self.inspect(**changes)
        self.assertTrue(all(r['status'] == 'PASS' for r in records[:-1]))
        self.assertEqual(records[-1], {'stage': 'certificate_requirement_check', 'status': 'FAIL',
                                     'command_category': 'codesign', 'return_code': 1})
        self.assertEqual(saved, {'failed_stage': 'certificate_requirement_check', 'archive_exists': True})
        self.assertIsNotNone(error)
        self.assertIsNone(result)

    def test_other_profile_certificate_still_fails_before_signer_requirement(self):
        records, saved, error, result, commands = self.inspect(profile_certificate=b'wrong-profile-cert')
        self.assertEqual((records[-1]['stage'], records[-1]['status']), ('profile_contract_check', 'FAIL'))
        self.assertEqual(saved['failed_stage'], 'profile_contract_check')
        self.assertNotIn('certificate_requirement_check', commands)
        self.assertIsNotNone(error)
        self.assertIsNone(result)

    def test_failure_upload_is_ios_only_and_whitelists_one_sanitized_json(self):
        from validate import ROOT
        workflow = (ROOT / '.github/workflows/staging.yml').read_text()
        before_ios, ios = workflow.split('\n  ios:\n', 1)
        name = '      - name: Retain sanitized iOS inspection failure only\n'
        self.assertNotIn(name, before_ios)
        self.assertEqual(ios.count(name), 1)
        step = ios.split(name, 1)[1].split('\n      - ', 1)[0]
        lines = [line.strip() for line in step.splitlines()]
        self.assertIn('if: failure()', lines)
        self.assertIn('uses: actions/upload-artifact@v4', lines)
        self.assertEqual([line for line in lines if line.startswith('path:')],
                         ['path: build/staging-ios/inspection-failure.json'])
        self.assertIn('if-no-files-found: ignore', lines)
        success = ios.split('      - name: Retain only IPA and sanitized validation evidence\n', 1)[1]
        success = success.split('\n      - ', 1)[0]
        self.assertFalse(any(line.strip().startswith('if:') for line in success.splitlines()),
                         'IPA upload must retain the default success-only condition')


if __name__ == '__main__':
    unittest.main()
