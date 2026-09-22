"""Staging misconfiguration tests. No servers, credentials or signing tools used."""

import base64
import contextlib
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from check_configuration import check
from validate import (
    IOS_ID, ROOT, TEAM_ID, validate_android_badging, validate_defines,
    validate_ios_identity, validate_ios_prebuild, validate_origin, validate_workflow,
)

ORIGIN = "https://staging.example.test"  # Non-routable fixture, never a build default.


def defines(*items):
    return ",".join(base64.b64encode(item.encode()).decode() for item in items)


class StagingValidationTest(unittest.TestCase):
    def tag_environment(self, **changes):
        return dict(GITHUB_EVENT_NAME="push", GITHUB_REF_TYPE="tag",
                    GITHUB_REF="refs/tags/staging-build-approved-sha",
                    STAGING_TAG_DELETED="false", STAGING_API_BASE_URL=ORIGIN) | changes

    def test_tag_uses_only_explicit_staging_variable(self):
        self.assertEqual(validate_workflow(self.tag_environment(
            DISPATCH_API_BASE_URL="ignored", API_BASE_URL="ignored")), ORIGIN)

    def test_dispatch_uses_only_required_input(self):
        self.assertEqual(validate_workflow(dict(
            GITHUB_EVENT_NAME="workflow_dispatch", DISPATCH_API_BASE_URL=ORIGIN,
            STAGING_API_BASE_URL="ignored", API_BASE_URL="ignored")), ORIGIN)

    def test_missing_tag_url_does_not_fall_back_to_dispatch_or_environment(self):
        with self.assertRaises(ValueError):
            validate_workflow(self.tag_environment(
                STAGING_API_BASE_URL="", DISPATCH_API_BASE_URL=ORIGIN, API_BASE_URL=ORIGIN))

    def test_missing_dispatch_input_does_not_fall_back_to_staging_variable(self):
        with self.assertRaises(ValueError):
            validate_workflow(dict(GITHUB_EVENT_NAME="workflow_dispatch",
                                   STAGING_API_BASE_URL=ORIGIN, API_BASE_URL=ORIGIN))

    def test_branch_push_unrelated_nested_empty_and_deleted_tags_are_rejected(self):
        for change in (
            {"GITHUB_REF_TYPE": "branch", "GITHUB_REF": "refs/heads/codex/launch-foundation"},
            {"GITHUB_REF_TYPE": "branch", "GITHUB_REF": "refs/heads/staging-build-approved-sha"},
            {"GITHUB_REF": "refs/tags/v1"}, {"GITHUB_REF": "refs/tags/staging-build-"},
            {"GITHUB_REF": "refs/tags/staging-build-nested/tag"},
            {"GITHUB_REF": "refs/tags/staging-build-line\nbreak"},
            {"STAGING_TAG_DELETED": "true"},
        ):
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_workflow(self.tag_environment(**change))

    def test_unapproved_events_are_rejected(self):
        for event in ("", "pull_request", "pull_request_target", "repository_dispatch", "schedule"):
            with self.subTest(event=event), self.assertRaises(ValueError):
                validate_workflow(self.tag_environment(GITHUB_EVENT_NAME=event))

    def test_invalid_workflow_origin_produces_no_output_or_credential_log(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "output"
            for origin in ("", "https://user:DO_NOT_LOG@example.test",
                           "https://staging.example.test\nINJECTED=value",
                           "https://gacha-vault-backend.onrender.com"):
                with self.subTest(origin=origin):
                    result = subprocess.run(
                        [sys.executable, str(ROOT / "tool/staging/validate.py"), "workflow"],
                        env=self.tag_environment(STAGING_API_BASE_URL=origin, GITHUB_OUTPUT=str(output)),
                        capture_output=True, text=True)
                    self.assertEqual(result.returncode, 1)
                    self.assertFalse(output.exists())
                    self.assertNotIn("DO_NOT_LOG", result.stdout + result.stderr)

    def test_valid_explicit_https_origin(self):
        self.assertEqual(validate_origin(ORIGIN), ORIGIN)

    def test_missing_invalid_or_sensitive_origins_are_rejected(self):
        for value in ("", " ", " https://example.test", "http://example.test", "https://",
                      "https://user:password@example.test", "https://example.test?token=secret",
                      "https://example.test#fragment", "https://example.test/api", "https://example.test:80",
                      "https://example.test\\@elsewhere.test", "https://example.\ntest"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_origin(value)

    def test_existing_origin_and_loopback_are_rejected(self):
        for host in ("gacha-vault-backend.onrender.com", "GACHA-VAULT-BACKEND.ONRENDER.COM.",
                     "localhost", "127.0.0.1"):
            with self.subTest(host=host), self.assertRaises(ValueError):
                validate_origin("https://" + host)

    def test_explicit_define_matches_fresh_environment(self):
        validate_defines(defines("API_BASE_URL=" + ORIGIN), ORIGIN)

    def test_missing_environment_does_not_reuse_cached_define(self):
        with self.assertRaises(ValueError):
            validate_defines(defines("API_BASE_URL=" + ORIGIN), "")

    def test_missing_mismatched_duplicate_or_malformed_defines_fail(self):
        for value in ("", "%%%", defines("API_BASE_URL=https://other.example.test"),
                      defines("API_BASE_URL=" + ORIGIN, "API_BASE_URL=" + ORIGIN),
                      defines("API_BASE_URL=" + ORIGIN, "MISSING_EQUALS")):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_defines(value, ORIGIN)

    def test_runtime_mode_override_is_rejected(self):
        for key in ("dart.vm.product", "dart.vm.profile"):
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate_defines(defines("API_BASE_URL=" + ORIGIN, key + "=false"), ORIGIN)

    def test_ios_prebuild_checks_effective_build_settings(self):
        env = dict(CONFIGURATION="Profile-staging", PRODUCT_BUNDLE_IDENTIFIER=IOS_ID,
                   DEVELOPMENT_TEAM=TEAM_ID, CODE_SIGN_ENTITLEMENTS="Runner/Staging.entitlements",
                   FLUTTER_BUILD_MODE="profile", API_BASE_URL=ORIGIN,
                   DART_DEFINES=defines("API_BASE_URL=" + ORIGIN))
        validate_ios_prebuild(env)
        for key, wrong in {
            "API_BASE_URL": "", "DART_DEFINES": "", "FLUTTER_BUILD_MODE": "release",
            "CONFIGURATION": "Profile", "PRODUCT_BUNDLE_IDENTIFIER": "com.gachavault.gachaVault",
            "DEVELOPMENT_TEAM": "OTHERTEAM", "CODE_SIGN_ENTITLEMENTS": "Runner/Shared.entitlements",
        }.items():
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate_ios_prebuild({**env, key: wrong})

    def test_android_artifact_identifier(self):
        validate_android_badging("package: name='com.gachavault.gacha.staging' versionCode='1'")
        for value in ("", "com.gachavault.gacha", "com.gachavault.gacha.debug", "com.gachavault.gacha.staging.debug"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_android_badging(f"package: name='{value}'")

    def test_ios_artifact_identifier_is_case_sensitive(self):
        validate_ios_identity({"CFBundleIdentifier": IOS_ID})
        for value in (IOS_ID.lower(), "com.gachavault.gachaVault", None):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_ios_identity({"CFBundleIdentifier": value})

    def test_signed_keychain_group_is_exclusively_staging(self):
        app_id = TEAM_ID + "." + IOS_ID
        correct = {"application-identifier": app_id,
                   "com.apple.developer.team-identifier": TEAM_ID,
                   "keychain-access-groups": [app_id]}
        validate_ios_identity({"CFBundleIdentifier": IOS_ID}, correct)
        for change in ({"keychain-access-groups": []},
                       {"keychain-access-groups": [app_id, TEAM_ID + ".com.gachavault.gachaVault"]},
                       {"keychain-access-groups": [TEAM_ID + ".*"]},
                       {"application-identifier": TEAM_ID + ".*"},
                       {"com.apple.developer.team-identifier": "OTHERTEAM"},
                       {"com.apple.security.application-groups": ["group.shared"]}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_ios_identity({"CFBundleIdentifier": IOS_ID}, {**correct, **change})

    def test_cli_fails_without_url_before_any_build_tool(self):
        env = dict(os.environ)
        env.pop("API_BASE_URL", None)
        result = subprocess.run([sys.executable, str(ROOT / "tool/staging/validate.py"), "origin"],
                                env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn("API_BASE_URL is required", result.stderr)

    def test_rejected_credentials_are_not_logged(self):
        result = subprocess.run([sys.executable, str(ROOT / "tool/staging/validate.py"), "origin"],
                                env={**os.environ, "API_BASE_URL": "https://user:DO_NOT_LOG@example.test"},
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertNotIn("DO_NOT_LOG", result.stdout + result.stderr)

    def test_native_configuration_sources(self):
        with contextlib.redirect_stdout(io.StringIO()):
            check()


if __name__ == "__main__":
    unittest.main()
