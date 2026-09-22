#!/usr/bin/env python3
"""Offline staging build guards. Python standard library only; never calls an API."""

import argparse
import base64
import binascii
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys
from urllib.parse import urlsplit

ANDROID_ID = "com.gachavault.gacha.staging"
IOS_ID = "com.gachavault.gachaVault.staging"
TEAM_ID = "27Y574N7TW"
ROOT = Path(__file__).resolve().parents[2]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate_origin(value):
    # Never echo rejected inputs: a mistaken value could contain credentials.
    require(bool(value) and value == value.strip(), "API_BASE_URL is required")
    require(not any(c.isspace() or ord(c) < 32 for c in value), "Invalid API_BASE_URL")
    require("\\" not in value, "Invalid API_BASE_URL")
    try:
        url = urlsplit(value)
        port = url.port
    except ValueError:
        raise ValueError("Invalid API_BASE_URL") from None
    require(
        url.scheme == "https" and bool(url.hostname)
        and url.username is None and url.password is None
        and not url.query and not url.fragment and url.path in ("", "/")
        and port in (None, 443),
        "API_BASE_URL must be an explicit HTTPS origin without credentials",
    )
    host = url.hostname.lower().rstrip(".")
    require(bool(re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", host)),
            "Invalid API_BASE_URL hostname")
    require(host not in {"localhost", "127.0.0.1", "gacha-vault-backend.onrender.com"},
            "The existing/default backend or loopback origin is forbidden for staging")
    return value


def validate_defines(encoded, expected_origin):
    validate_origin(expected_origin)
    values = {}
    try:
        for item in encoded.split(",") if encoded else []:
            decoded = base64.b64decode(item, validate=True).decode("utf-8")
            key, separator, value = decoded.partition("=")
            require(bool(key) and bool(separator) and key not in values,
                    "Malformed or duplicate DART_DEFINES")
            values[key] = value
    except (binascii.Error, UnicodeDecodeError):
        raise ValueError("Malformed DART_DEFINES") from None
    require(values.get("API_BASE_URL") == expected_origin,
            "DART_DEFINES must explicitly match API_BASE_URL; cached/default origin rejected")
    require(not {"dart.vm.product", "dart.vm.profile"}.intersection(values),
            "Do not override Flutter runtime mode defines")


def validate_workflow(env):
    """Select one explicit source; missing dispatch/tag inputs never fall back."""
    event = env.get("GITHUB_EVENT_NAME")
    if event == "push":
        require(env.get("GITHUB_REF_TYPE") == "tag"
                and re.fullmatch(r"refs/tags/staging-build-[^/\s]+", env.get("GITHUB_REF", ""))
                and env.get("STAGING_TAG_DELETED") != "true",
                "Only an existing staging-build-* tag may start a staging push build")
        origin = env.get("STAGING_API_BASE_URL", "")
    elif event == "workflow_dispatch":
        origin = env.get("DISPATCH_API_BASE_URL", "")
    else:
        raise ValueError("Unsupported staging workflow event")
    return validate_origin(origin)


def validate_ios_prebuild(env):
    configuration = env.get("CONFIGURATION", "")
    expected_mode = {
        "Debug-staging": "debug", "Profile-staging": "profile",
        "Release-staging": "release",
    }.get(configuration)
    require(expected_mode is not None, "Unknown staging configuration")
    require(env.get("PRODUCT_BUNDLE_IDENTIFIER") == IOS_ID, "Wrong staging bundle ID")
    require(env.get("DEVELOPMENT_TEAM") == TEAM_ID, "Wrong staging Apple team")
    require(env.get("CODE_SIGN_ENTITLEMENTS") == "Runner/Staging.entitlements",
            "Staging entitlements are required")
    require(env.get("FLUTTER_BUILD_MODE") == expected_mode,
            "Flutter build mode must match the staging configuration")
    validate_defines(env.get("DART_DEFINES", ""), env.get("API_BASE_URL", ""))
    with (ROOT / "ios/Runner/Staging.entitlements").open("rb") as file:
        entitlements = plistlib.load(file)
    require(entitlements == {"keychain-access-groups": [f"$(AppIdentifierPrefix){IOS_ID}"]},
            "Staging must use only its own Keychain access group")


def validate_ios_identity(info, entitlements=None):
    require(info.get("CFBundleIdentifier") == IOS_ID, "Built app has the wrong bundle ID")
    if entitlements is not None:
        app_id = f"{TEAM_ID}.{IOS_ID}"
        require(entitlements.get("application-identifier") == app_id,
                "Signed application identifier must match the staging App ID")
        require(entitlements.get("com.apple.developer.team-identifier") == TEAM_ID,
                "Signed app has the wrong Apple team")
        require(entitlements.get("keychain-access-groups") == [app_id],
                "Signed app Keychain group is not isolated")
        require(not entitlements.get("com.apple.security.application-groups"),
                "Shared app groups are not approved for staging")


def validate_android_badging(output):
    match = re.search(r"^package: name='([^']+)'", output, re.MULTILINE)
    require(match is not None and match[1] == ANDROID_ID,
            "Built APK must use the exact Android staging package")


def checked_output(command):
    try:
        return subprocess.run(command, check=True, capture_output=True).stdout
    except (OSError, subprocess.CalledProcessError):
        # Do not propagate arbitrary tool output, paths, signing data or inputs.
        raise ValueError("Required artifact inspection tool is unavailable or failed") from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("origin")
    sub.add_parser("workflow")
    sub.add_parser("defines")
    sub.add_parser("ios-prebuild")
    ios = sub.add_parser("ios-app")
    ios.add_argument("app", type=Path)
    ios.add_argument("--signed-device", action="store_true",
                     help="Inspect existing device signature; never signs or imports keys")
    android = sub.add_parser("android-apk")
    android.add_argument("apk", type=Path)
    android.add_argument("--aapt", required=True)
    android.add_argument("--apksigner", required=True)
    args = parser.parse_args()
    try:
        if args.command == "origin":
            validate_origin(os.environ.get("API_BASE_URL", ""))
        elif args.command == "workflow":
            origin = validate_workflow(os.environ)
            require(bool(os.environ.get("GITHUB_OUTPUT")), "GitHub workflow output is required")
            # validate_origin forbids newlines/credentials before writing a job output.
            with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
                output.write(f"api_base_url={origin}\n")
        elif args.command == "defines":
            validate_defines(os.environ.get("DART_DEFINES", ""),
                             os.environ.get("API_BASE_URL", ""))
        elif args.command == "ios-prebuild":
            validate_ios_prebuild(os.environ)
        elif args.command == "ios-app":
            with (args.app / "Info.plist").open("rb") as file:
                info = plistlib.load(file)
            entitlements = None
            if args.signed_device:
                require((args.app / "embedded.mobileprovision").is_file(),
                        "Device provisioning profile missing: signed device verification BLOCKED")
                checked_output(["codesign", "--verify", "--deep", "--strict", str(args.app)])
                entitlements = plistlib.loads(checked_output(
                    ["codesign", "-d", "--entitlements", ":-", str(args.app)]))
            validate_ios_identity(info, entitlements)
        elif args.command == "android-apk":
            validate_android_badging(checked_output(
                [args.aapt, "dump", "badging", str(args.apk)]).decode("utf-8"))
            checked_output([args.apksigner, "verify", str(args.apk)])
    except (ValueError, OSError, plistlib.InvalidFileException) as error:
        # OSError text can contain a private path; only our ValueError messages are safe.
        message = str(error) if type(error) is ValueError else "Artifact/configuration could not be read"
        print(f"Staging validation FAILED: {message}", file=sys.stderr)
        return 1
    print(f"Staging validation passed: {args.command} (no network requests)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
