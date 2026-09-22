#!/usr/bin/env python3
"""Offline source checks; these do not substitute for Xcode/Gradle artifact checks."""

import ast
from pathlib import Path
import plistlib
import re
import sys
import xml.etree.ElementTree as ET

from validate import ANDROID_ID, IOS_ID, ROOT, TEAM_ID, require
from native_validation import PROFILE_NAME

NATIVE_BASELINE = "524bc6837baa2a8406cd395091b43c31d5cfec9c"


def check_android_debug_only(gradle):
    # Reject extra assignments, even outside the expected debug block: those can
    # leak to Flutter's copied library build types during Gradle configuration.
    source = re.sub(r"(?m)^\s*//.*$", "", gradle)
    debug = re.search(r'\bdebug\s*\{([^{}]*)\}', source)
    require(debug is not None, "Android debug build type missing")
    require('applicationId = "com.gachavault.gacha"' in source,
            "Original Android application ID changed")
    require(len(re.findall(r'\bapplicationId\s*=', source)) == 1,
            "Unexpected Android application ID override")
    require('applicationIdSuffix = if (gachiStaging) ".staging" else ".debug"' in debug[1],
            "Android debug must select .staging or the original .debug suffix")
    require(len(re.findall(r'\bapplicationIdSuffix\b', source)) == 1,
            "Only the app debug build type may set applicationIdSuffix")
    require(not re.search(r'\bprofile\s*\{|(?:getByName|create|named)\s*\(\s*"profile"', source),
            "Do not configure the Android profile build type for staging")
    return {"staging_debug": "com.gachavault.gacha.staging",
            "debug": "com.gachavault.gacha.debug", "release": "com.gachavault.gacha"}


def check_runner_profile_scope(project):
    configurations = dict(re.findall(
        r'\t\t([A-F0-9]{24}) /\* [^\n]+ \*/ = \{\n'
        r'(\t\t\tisa = XCBuildConfiguration;.*?\n\t\t)\};', project, re.S))
    runner_list = re.search(
        r'/\* Build configuration list for PBXNativeTarget "Runner" \*/ = \{.*?'
        r'buildConfigurations = \((.*?)\);', project, re.S)
    require(runner_list is not None, "Runner configuration list missing")
    runner_profile = re.findall(r'([A-F0-9]{24}) /\* Profile-staging \*/', runner_list[1])
    require(len(runner_profile) == 1, "Expected one Runner Profile-staging configuration")
    block = configurations.get(runner_profile[0], "")
    require('name = "Profile-staging";' in block, "Wrong Runner configuration name")
    require(f'PROVISIONING_PROFILE_SPECIFIER = "{PROFILE_NAME}";' in block,
            "Runner Profile-staging must select the existing Ad Hoc profile")
    require('"CODE_SIGN_IDENTITY[sdk=iphoneos*]" = "Apple Distribution";' in block,
            "Runner Profile-staging requires Apple Distribution")
    require(project.count("PROVISIONING_PROFILE") == 1,
            "Provisioning profile must be scoped only to Runner Profile-staging")


def check_no_global_signing_overrides(source):
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            require(not re.match(r'^(CODE_SIGN_STYLE|CODE_SIGN_IDENTITY|'
                                 r'PROVISIONING_PROFILE(?:_SPECIFIER)?|DEVELOPMENT_TEAM)\s*=',
                                 node.value), "Global xcodebuild signing override forbidden")
            require(node.value != "-xcconfig", "Global Xcode xcconfig override forbidden")


def check_workflow_protection(workflow):
    expected = [
        f"git merge-base --is-ancestor {NATIVE_BASELINE} HEAD",
        f"git diff --exit-code {NATIVE_BASELINE} HEAD -- lib test android ios pubspec.yaml pubspec.lock",
    ]
    commands = [line.strip() for line in workflow.splitlines()]
    require(all(command in commands for command in expected),
            "Protected native baseline and all protected paths must remain enforced")



def check_physical_transaction_preview_scope(workflow, ios_builder):
    android_build = next(
        (line.strip() for line in workflow.splitlines()
         if line.strip().startswith('run: flutter build apk --debug ')),
        None,
    )
    require(android_build is not None, "Android staging build command missing")
    require('--dart-define=ENABLE_GP_ORDER_PREVIEW=true' in android_build,
            "Android physical staging build must enable GP order preview")
    for forbidden in ("ENABLE_GP_CONVERSION_PREVIEW", "ENABLE_SHIPPING_PREVIEW",
                      "ENABLE_ORDER_REFUND_PREVIEW", "ENABLE_LEGACY_TRANSACTIONS"):
        require(f'--dart-define={forbidden}=true' not in android_build,
                f"Android physical staging build must not enable {forbidden}")

    require("'--dart-define=ENABLE_GP_ORDER_PREVIEW=true'" in ios_builder,
            "iOS physical staging build must enable GP order preview")
    for forbidden in ("ENABLE_GP_CONVERSION_PREVIEW", "ENABLE_SHIPPING_PREVIEW",
                      "ENABLE_ORDER_REFUND_PREVIEW", "ENABLE_LEGACY_TRANSACTIONS"):
        require(f"'--dart-define={forbidden}=true'" not in ios_builder,
                f"iOS physical staging build must not enable {forbidden}")

def check(root=ROOT):
    project = (root / "ios/Runner.xcodeproj/project.pbxproj").read_text()
    configurations = re.findall(
        r'\t\t([A-F0-9]{24}) /\* ([^\n]+) \*/ = \{\n'
        r'\t\t\tisa = XCBuildConfiguration;.*?\n\t\t\};', project, re.S)
    require(len(configurations) == 18, "Expected nine original and nine staging configurations")
    for identifier, name in configurations:
        block = re.search(r'\t\t' + identifier + r' /\*.*?\n\t\t\};', project, re.S)[0]
        require(f'{identifier} /* {name} */,' in project, "Configuration missing from build list")
        if name.endswith("-staging") and "PRODUCT_BUNDLE_IDENTIFIER" in block:
            is_test = "RunnerTests" in block
            expected = IOS_ID + (".RunnerTests" if is_test else "")
            require(f"PRODUCT_BUNDLE_IDENTIFIER = {expected};" in block,
                    "Wrong staging target identifier")
            require(f"DEVELOPMENT_TEAM = {TEAM_ID};" in block, "Wrong staging team")
            require("CODE_SIGN_STYLE = Manual;" in block, "Automatic staging signing is not approved")
            if not is_test:
                require("CODE_SIGN_ENTITLEMENTS = Runner/Staging.entitlements;" in block,
                        "Missing staging Keychain entitlements")
                require(f"/* {name}.xcconfig */;" in block, "Wrong staging base configuration")
        elif not name.endswith("-staging") and "PRODUCT_BUNDLE_IDENTIFIER" in block:
            expected = "com.gachavault.gachaVault" + (".RunnerTests" if "RunnerTests" in block else "")
            require(f"PRODUCT_BUNDLE_IDENTIFIER = {expected};" in block,
                    "Original iOS identifier changed")
            require("Staging.entitlements" not in block, "Staging entitlements leaked to original target")
    check_runner_profile_scope(project)
    ios_builder = (root / "tool/staging/build_ios.py").read_text()
    workflow = (root / ".github/workflows/staging.yml").read_text()
    check_no_global_signing_overrides(ios_builder)
    check_workflow_protection(workflow)
    check_physical_transaction_preview_scope(workflow, ios_builder)

    scheme = ET.parse(root / "ios/Runner.xcodeproj/xcshareddata/xcschemes/staging.xcscheme").getroot()
    for action, configuration in {
        "LaunchAction": "Debug-staging", "TestAction": "Debug-staging",
        "AnalyzeAction": "Debug-staging", "ProfileAction": "Profile-staging",
        "ArchiveAction": "Profile-staging",
    }.items():
        require(scheme.find(action).get("buildConfiguration") == configuration,
                "Staging scheme action uses the wrong configuration")
    podfile = (root / "ios/Podfile").read_text()
    require(not re.search(r'PROVISIONING_PROFILE|CODE_SIGN_STYLE|CODE_SIGNING_ALLOWED', podfile),
            "Podfile must not force profiles/manual signing or disable signing as a workaround")
    for mode in ("Debug", "Profile", "Release"):
        require(f"'{mode}-staging' => :{'debug' if mode == 'Debug' else 'release'}" in podfile,
                "Podfile is missing a staging configuration")
        config = (root / f"ios/Flutter/{mode}-staging.xcconfig").read_text()
        require('"Generated.xcconfig"' in config and f"FLUTTER_BUILD_MODE = {mode.lower()}" in config,
                "Staging Flutter build mode is not explicit")
        require(config.index("FLUTTER_BUILD_MODE") > config.index("Generated.xcconfig"),
                "Cached Flutter build mode can override staging mode")
        require("API_BASE_URL" not in config, "Do not put an origin fallback in xcconfig")
        require("PROVISIONING_PROFILE" not in config,
                "Profile must be target-scoped, not shared through xcconfig")
    with (root / "ios/Runner/Staging.entitlements").open("rb") as file:
        require(plistlib.load(file) == {"keychain-access-groups": [f"$(AppIdentifierPrefix){IOS_ID}"]},
                "Staging Keychain must contain only its own group")
    require(project.index("/* Validate Staging Configuration */,") < project.index("/* Run Script */,"),
            "Staging guard must run before Flutter compilation")

    gradle = (root / "android/app/build.gradle.kts").read_text()
    check_android_debug_only(gradle)
    require('"../tool/staging/validate.py"' in gradle and '"dart-defines"' in gradle,
            "Gradle must validate actual Dart defines")
    require('if (gachiStaging) variant.enable = false' in gradle,
            "Staging release must not consume production signing")
    print(f"Source configuration checks passed: {ANDROID_ID}, {IOS_ID}")
    print("Native artifact/signing verification is a separate check.")


if __name__ == "__main__":
    try:
        check()
    except (ValueError, OSError, ET.ParseError) as error:
        print(f"Configuration check FAILED: {error}", file=sys.stderr)
        sys.exit(1)
