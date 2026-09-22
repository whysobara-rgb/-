#!/usr/bin/env python3
"""Offline source checks; these do not substitute for Xcode/Gradle artifact checks."""

from pathlib import Path
import plistlib
import re
import sys
import xml.etree.ElementTree as ET

from validate import ANDROID_ID, IOS_ID, ROOT, TEAM_ID, require


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

    scheme = ET.parse(root / "ios/Runner.xcodeproj/xcshareddata/xcschemes/staging.xcscheme").getroot()
    for action, configuration in {
        "LaunchAction": "Debug-staging", "TestAction": "Debug-staging",
        "AnalyzeAction": "Debug-staging", "ProfileAction": "Profile-staging",
        "ArchiveAction": "Profile-staging",
    }.items():
        require(scheme.find(action).get("buildConfiguration") == configuration,
                "Staging scheme action uses the wrong configuration")
    podfile = (root / "ios/Podfile").read_text()
    for mode in ("Debug", "Profile", "Release"):
        require(f"'{mode}-staging' => :{'debug' if mode == 'Debug' else 'release'}" in podfile,
                "Podfile is missing a staging configuration")
        config = (root / f"ios/Flutter/{mode}-staging.xcconfig").read_text()
        require('"Generated.xcconfig"' in config and f"FLUTTER_BUILD_MODE = {mode.lower()}" in config,
                "Staging Flutter build mode is not explicit")
        require(config.index("FLUTTER_BUILD_MODE") > config.index("Generated.xcconfig"),
                "Cached Flutter build mode can override staging mode")
        require("API_BASE_URL" not in config, "Do not put an origin fallback in xcconfig")
    with (root / "ios/Runner/Staging.entitlements").open("rb") as file:
        require(plistlib.load(file) == {"keychain-access-groups": [f"$(AppIdentifierPrefix){IOS_ID}"]},
                "Staging Keychain must contain only its own group")
    require(project.index("/* Validate Staging Configuration */,") < project.index("/* Run Script */,"),
            "Staging guard must run before Flutter compilation")

    gradle = (root / "android/app/build.gradle.kts").read_text()
    require('applicationId = "com.gachavault.gacha"' in gradle, "Original Android application ID changed")
    require('applicationIdSuffix = if (gachiStaging) ".staging" else ".debug"' in gradle,
            "Android staging/debug IDs are not isolated")
    require('getByName("profile")' in gradle and 'applicationIdSuffix = ".staging"' in gradle,
            "Android profile staging ID is missing")
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
