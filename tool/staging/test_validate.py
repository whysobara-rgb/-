"""Staging misconfiguration tests. No servers, credentials or signing tools used."""

import base64
import contextlib
import io
import os
from pathlib import Path
import subprocess
import sys
import unittest

from check_configuration import check
from validate import (
    IOS_ID, ROOT, TEAM_ID, validate_android_badging, validate_defines,
    validate_ios_identity, validate_ios_prebuild, validate_origin,
)

ORIGIN = "https://staging.example.test"  # Non-routable fixture, never a build default.


def defines(*items):
    return ",".join(base64.b64encode(item.encode()).decode() for item in items)


class StagingValidationTest(unittest.TestCase):
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
