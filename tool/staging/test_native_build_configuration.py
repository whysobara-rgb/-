"""Regression checks for the actual Android/library and Runner/Pods failures."""
import unittest

from check_configuration import (
    NATIVE_BASELINE, check_android_debug_only, check_no_global_signing_overrides,
    check_runner_profile_scope, check_workflow_protection,
)
from native_validation import (
    IOS_ID, TEAM_ID, PROFILE_NAME, check_runner_signing_settings, check_pods_signing_settings,
)
from validate import ROOT


class NativeBuildConfigurationTests(unittest.TestCase):
    def test_android_exact_staging_normal_debug_and_release_ids(self):
        gradle = (ROOT / 'android/app/build.gradle.kts').read_text()
        self.assertEqual(check_android_debug_only(gradle), {
            'staging_debug': 'com.gachavault.gacha.staging',
            'debug': 'com.gachavault.gacha.debug', 'release': 'com.gachavault.gacha'})

    def test_android_original_profile_suffix_failure_still_rejected(self):
        gradle = (ROOT / 'android/app/build.gradle.kts').read_text()
        old_profile = '''
        buildTypes.getByName("profile").apply {
            applicationIdSuffix = ".staging"
            resValue("string", "app_name", "가치가차 Staging")
        }
        '''
        with self.assertRaisesRegex(ValueError, 'Only the app debug'):
            check_android_debug_only(gradle + old_profile)

    def test_android_profile_configuration_without_suffix_is_also_rejected(self):
        gradle = (ROOT / 'android/app/build.gradle.kts').read_text()
        for extra in ['buildTypes.getByName("profile").apply { }', 'profile { }']:
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                check_android_debug_only(gradle + extra)

    def test_android_nested_suffix_and_changed_original_ids_rejected(self):
        gradle = (ROOT / 'android/app/build.gradle.kts').read_text()
        mutations = [gradle.replace('".staging"', '".staging.debug"'),
                     gradle.replace('else ".debug"', 'else ".staging"'),
                     gradle.replace('applicationId = "com.gachavault.gacha"',
                                    'applicationId = "com.gachavault.gacha.staging"')]
        for mutation in mutations:
            with self.subTest(mutation=mutations.index(mutation)), self.assertRaises(ValueError):
                check_android_debug_only(mutation)

    def test_android_library_suffix_override_rejected(self):
        gradle = (ROOT / 'android/app/build.gradle.kts').read_text()
        with self.assertRaises(ValueError):
            check_android_debug_only(gradle + '\nsubprojects { applicationIdSuffix = ".staging" }')

    def test_ios_profile_exists_only_in_runner_profile_staging(self):
        check_runner_profile_scope((ROOT / 'ios/Runner.xcodeproj/project.pbxproj').read_text())

    def test_ios_missing_or_wrong_profile_rejected(self):
        project = (ROOT / 'ios/Runner.xcodeproj/project.pbxproj').read_text()
        for change in ['', 'Production Ad Hoc']:
            with self.subTest(profile=change), self.assertRaises(ValueError):
                check_runner_profile_scope(project.replace(PROFILE_NAME, change))

    def test_ios_profile_moved_to_project_or_tests_scope_rejected(self):
        project = (ROOT / 'ios/Runner.xcodeproj/project.pbxproj').read_text()
        specifier = f'\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = "{PROFILE_NAME}";\n'
        for target in ['C03EC9997C553639FBC5A16F', '728BEB4E18C2B20DC5C71400']:
            mutation = project.replace(specifier, '')
            start = mutation.index(target + ' /* Profile-staging */ = {')
            position = mutation.index('buildSettings = {\n', start) + len('buildSettings = {\n')
            mutation = mutation[:position] + specifier + mutation[position:]
            with self.subTest(target=target), self.assertRaises(ValueError):
                check_runner_profile_scope(mutation)

    def test_ios_profile_copied_to_other_configuration_rejected(self):
        project = (ROOT / 'ios/Runner.xcodeproj/project.pbxproj').read_text()
        with self.assertRaises(ValueError):
            check_runner_profile_scope(project + f'\nPROVISIONING_PROFILE_SPECIFIER = "{PROFILE_NAME}";')

    def test_ios_cli_has_no_global_signing_override(self):
        check_no_global_signing_overrides((ROOT / 'tool/staging/build_ios.py').read_text())

    def test_each_original_global_signing_override_rejected(self):
        for setting in ['CODE_SIGN_STYLE=Manual', 'CODE_SIGN_IDENTITY=Apple Distribution',
                        'PROVISIONING_PROFILE_SPECIFIER=' + PROFILE_NAME,
                        'DEVELOPMENT_TEAM=' + TEAM_ID]:
            with self.subTest(setting=setting), self.assertRaises(ValueError):
                check_no_global_signing_overrides('options = [' + repr(setting) + ']')

    def runner(self):
        return {'CONFIGURATION': 'Profile-staging', 'PROVISIONING_PROFILE_SPECIFIER': PROFILE_NAME,
                'CODE_SIGN_STYLE': 'Manual', 'CODE_SIGN_IDENTITY': 'Apple Distribution',
                'DEVELOPMENT_TEAM': TEAM_ID, 'PRODUCT_BUNDLE_IDENTIFIER': IOS_ID,
                'CODE_SIGN_ENTITLEMENTS': 'Runner/Staging.entitlements'}

    def test_runner_effective_signing_settings_preserved(self):
        check_runner_signing_settings(self.runner())
        for key in self.runner():
            with self.subTest(key=key), self.assertRaises(ValueError):
                check_runner_signing_settings({**self.runner(), key: 'wrong'})

    def pods(self):
        return [{'target': target, 'buildSettings': {'CONFIGURATION': 'Profile-staging',
                 'PROVISIONING_PROFILE_SPECIFIER': '', 'CODE_SIGN_STYLE': 'Automatic'}}
                for target in ['Pods-Runner', 'flutter_secure_storage', 'sqflite_darwin']]

    def test_pods_automatic_signing_without_profile_passes(self):
        check_pods_signing_settings(self.pods())
        check_pods_signing_settings([{'target': 'Pods-Runner', 'buildSettings': {
            'CONFIGURATION': 'Profile-staging'}}])

    def test_pods_profile_or_manual_override_fails(self):
        for key, value in [('PROVISIONING_PROFILE_SPECIFIER', PROFILE_NAME),
                           ('PROVISIONING_PROFILE', 'synthetic-uuid'), ('CODE_SIGN_STYLE', 'Manual'),
                           ('CONFIGURATION', 'Release')]:
            targets = self.pods()
            targets[-1]['buildSettings'][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                check_pods_signing_settings(targets)
        with self.assertRaises(ValueError):
            check_pods_signing_settings([])

    def test_native_baseline_protects_all_original_paths(self):
        check_workflow_protection((ROOT / '.github/workflows/staging.yml').read_text())

    def test_baseline_guard_removal_weakening_or_wrong_sha_rejected(self):
        workflow = (ROOT / '.github/workflows/staging.yml').read_text()
        mutations = [workflow.replace(' android ios ', ' '),
                     workflow.replace('git diff --exit-code', 'git diff'),
                     workflow.replace(NATIVE_BASELINE, '0' * 40),
                     workflow.replace('git merge-base --is-ancestor', 'echo'),
                     workflow.replace('pubspec.yaml pubspec.lock\n', 'pubspec.yaml pubspec.lock || true\n')]
        for index, mutation in enumerate(mutations):
            with self.subTest(index=index), self.assertRaises(ValueError):
                check_workflow_protection(mutation)


if __name__ == '__main__':
    unittest.main()
