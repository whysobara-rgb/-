# Stage 4A-3: staging build preparation

Baseline: `e8178441e242892116477513a4754cf3d3faab16` on
`codex/launch-foundation` (PR #1 remains Draft/Open).

## Registered resources

These identifiers are public configuration, not credentials.

| Resource | Value |
| --- | --- |
| Firebase display name | GachiGacha Staging |
| Firebase project | `gachigacha-staging` |
| Firebase project number | `394432828431` |
| Plan | Spark, no Billing account linked |
| Android Firebase App ID | `1:394432828431:android:eb5e0468db75505ea2ff7a` |
| Android package | `com.gachavault.gacha.staging` |
| iOS Firebase App ID | `1:394432828431:ios:68811cbb87b52e1ea2ff7a` |
| Apple explicit App ID / iOS bundle | `com.gachavault.gachaVault.staging` |
| Apple Team / App ID prefix | `27Y574N7TW` |

Apple registration completed before Firebase iOS registration, with identical
case. Analytics and Gemini were disabled during project creation. No Firebase
SDK, config download, Auth, database, Hosting, IAM/WIF, certificate, provisioning
profile or binary upload is included. The pre-existing Firebase project is not
used. Firebase's optional environment label remains unspecified; separation is
by the new project and exact staging application identifiers.

## Explicit build inputs

There is **no staging server URL yet**. Obtain an approved staging HTTPS origin
before running a connected build. `API_BASE_URL` must be exported explicitly and
also passed as a Dart define; the two must match. No URL is stored as a default.
The old backend origin is rejected without contacting it. The `.example.test`
URL in unit tests is an offline fixture only.

After providing the approved URL in the shell environment:

```sh
python3 tool/staging/validate.py origin
python3 tool/staging/check_configuration.py
python3 -m unittest discover -s tool/staging -p 'test_*.py' -v

# Android: opt-in property, not a new flavor dimension.
ORG_GRADLE_PROJECT_gachiStaging=true flutter build apk --debug \
  --dart-define="API_BASE_URL=$API_BASE_URL"

# macOS/Xcode: simulator build only, no device provisioning or installation.
flutter build ios --simulator --debug --flavor staging \
  --dart-define="API_BASE_URL=$API_BASE_URL"
```

Python 3 is a build-tool requirement on both hosts. Only its standard library is
used; no app dependency was added. Native Gradle/Xcode build hooks validate the
actual encoded Dart defines, so invoking the native build directly cannot fall
back to cached/default server settings. Do not pass `dart.vm.product` or
`dart.vm.profile` overrides.

Android ordinary default/release (`com.gachavault.gacha`) and debug
(`com.gachavault.gacha.debug`) IDs remain unchanged. Opt-in staging debug/profile
use `.staging`. Staging release is disabled to avoid consuming production
release signing material. Current staging debug APKs use normal debug signing;
a stable staging Android signing key/update strategy needs separate approval
before repeat tester distribution.

iOS adds the shared `staging` scheme and Debug/Profile/Release-staging
configurations. All original configurations and the Runner scheme are retained.
The staging Archive action selects **Profile-staging**. Explicit build modes
prevent a stale Generated.xcconfig from changing the chosen mode. Physical
staging signing is manual; no automatic provisioning is requested by this
workflow. Release-staging remains release and does not bypass release gates.

## Keychain and artifact checks

The staging target alone uses `Runner/Staging.entitlements`, containing only
`$(AppIdentifierPrefix)com.gachavault.gachaVault.staging`. Original targets have
no new access group. Existing secure-storage code and account/origin scoping are
unchanged. Source isolation does not prove signed-device Keychain behavior.

```sh
python3 tool/staging/validate.py android-apk path/to/staging.apk \
  --aapt path/to/aapt --apksigner path/to/apksigner
python3 tool/staging/validate.py ios-app path/to/Runner.app
```

The APK inspector checks the exact package and verifies its signature. The iOS
app inspector checks the actual Info.plist bundle ID, including case. After
signing is separately approved, `ios-app --signed-device` also requires an
embedded profile, verifies the existing code signature, and checks the signed
App ID, Team and exclusive Keychain group. It never signs or imports keys. It
does not certify profile expiry, the device list, Ad Hoc distribution or runtime
Keychain behavior; those remain separate signing/install checks.

## Workflow boundary

`.github/workflows/staging.yml` is `workflow_dispatch` only. The required
`api_base_url` input is validated before either build job and again in each job.
It builds a debug APK on Linux and a debug simulator app on macOS, verifies
identifiers, and stores **GitHub build artifacts only**. There is no Firebase
upload step, OIDC permission, private key import, IPA export, app launch or
installation. Preview/transaction flags are not enabled by this workflow.
Existing general CI is unchanged. A new dispatch workflow may need to exist on
the default branch before GitHub permits dispatch; PR #1 is not merged here.

No existing general Android/iOS CI is dispatched for this stage because it
uses the old backend origin. Any pushed preparation commit uses `[skip ci]` to
avoid triggering those jobs. Local analyze/tests are new runs, not previous CI
results. The new staging workflow is not dispatched without an approved URL.

## Still blocked before device distribution

- A real, approved staging API origin and separate transaction-test approval.
- Confirm a valid Apple Distribution certificate and corresponding private key
  availability; no keys are exported/imported in this stage.
- Confirm the target iPhone's registered UDID and create a staging Ad Hoc profile
  containing the exact App ID, certificate and device, after separate approval.
- Then validate Profile archive, Ad Hoc export, signed entitlements, profile
  validity/device eligibility and the actual runtime mode. Profile should have
  `kReleaseMode == false`; this stage does not claim runtime/device verification.
  Existing `!kReleaseMode` and individual preview/transaction gates are unchanged.
- Separately approve GitHub OIDC → Google WIF → a staging-only service account.
  Restrict federation to this repository, approved ref and staging workflow;
  grant App Distribution upload access only in `gachigacha-staging` and no
  production access. No long-lived token or service-account key is prepared.
  Recheck API/Billing prerequisites before enabling anything; stop if Billing
  is required under the current no-Billing authorization.
- Add and approve a separate distribution action only after the above checks.
  No Firebase upload or physical iPhone installation is authorized yet.

References: [Flutter iOS flavors](https://docs.flutter.dev/deployment/flavors-ios),
[Apple Ad Hoc profiles](https://developer.apple.com/help/account/provisioning-profiles/create-an-ad-hoc-provisioning-profile/),
[Firebase CLI distribution](https://firebase.google.com/docs/app-distribution/ios/distribute-cli).


---

# Staging native builds (Stage 4C-1)

The application source remains based on `39e8fcdde7029947440ad3e157b36aa95bfd890a`.
Only `.github/workflows/staging.yml` and `tool/staging/` change for native CI.

## Explicit execution

The `staging` GitHub Environment must provide `STAGING_API_BASE_URL` equal to
`https://gacha-vault-backend-staging.onrender.com`. A missing value fails closed.
The existing `staging-build-*` tag trigger and future `workflow_dispatch` remain.
Ordinary branch pushes do not execute this workflow. Do not merge PR #1 to run it.

Before compilation, the workflow verifies the protected application source,
configuration guards, health/readiness and exact Backend commit
`a224c07435f7ba17b65baf0c6d7ab2c5b9e629a7`. Regression tests run on the tagged SHA.

## Android

Build the actual `lib/main.dart` debug APK with `gachiStaging=true` and an explicit
API define. Validate aapt package metadata, APK signature and compiled Dart origin.
Install/launch only on the disposable CI emulator and capture the login screen.
Authenticated Home/Shop/My and app-to-API runtime requests remain unverified unless
test credentials are separately supplied through an approved secret mechanism.
No account credentials are placed in source or artifacts.

## iOS

Use only the three existing staging secrets: certificate P12, certificate password
and Ad Hoc profile. The legacy private-key secret is neither consumed nor changed.
`build_ios.py` imports them into a temporary keychain, validates the exact existing
certificate/profile and two approved device identities, then generates Flutter
Profile settings, archives `Profile-staging`, and exports Ad Hoc.

Final archive and IPA checks cover actual code signature, embedded profile, bundle,
team, isolated Keychain group, certificate fingerprint, two devices, expiry and
compiled staging origin. The actual Flutter engine UUID must match the SDK's
Profile engine. Effective Xcode settings and Dart defines must select Profile
without runtime-mode overrides. This is build evidence, not physical-device runtime
verification. Preview feature flags and `!kReleaseMode` are unchanged.

Only APK, IPA, sanitized JSON and emulator screenshot are retained. Raw P12,
private key, password and standalone mobileprovision are never artifacts. Temporary
identity/profile files are removed in a finally block; GitHub disposes the runner
after completion/cancellation. An IPA necessarily contains its signed embedded
provisioning profile; it is not uploaded separately.

No Firebase upload, physical device install, server deployment or transactions run.
