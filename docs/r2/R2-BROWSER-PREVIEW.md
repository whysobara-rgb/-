# R2-A1 interactive Flutter review

Application source: `f58a075c18c77c644efd2c2b14a6d1c39a65b2a9`. Review-only tooling; no app code edits.

## Reproduce

Use Flutter 3.35.4/Dart 3.9.2. From repository root, on the saved review commit:

```sh
flutter analyze --no-pub
flutter test --no-pub test/features/r2_browser_preview_test.dart
flutter build web --debug --no-pub --no-web-resources-cdn --no-wasm-dry-run --pwa-strategy=none -t tool/r2/browser_preview.dart -o build/r2-browser-preview --dart-define=REVIEW_TOOL_SHA=$(git rev-parse HEAD)
python3 tool/r2/package_browser.py --flutter-sdk /path/to/flutter --output /new/output/path
```

Do NOT pass API_BASE_URL or transaction flags. The entrypoint rejects them. Run `serve.py` from the output folder or `Start-Preview.cmd` on Windows. URL is loopback-only on the same PC. No public hosting has been created. Do not open index.html via file://.

## Actual behavior and limits

Actual app widgets and AppTheme root, nested Navigator keeps the small review toolbar outside the consumer app screen. Read-only mocks reuse existing synthetic result/inventory fixtures. Home/detail/purchase refer to the same selected synthetic box/price/odds. Photos are editorial placeholders, not mappings to live prizes. Result/collection samples are independent presets, not the outcome of a simulated purchase. Purchase execution is explicitly rejected. Unwired features show their scope in the outer toolbar.

Home/Shop: R2-A1. Other screens: existing implementation, not new R2-B work. Ranking/wallet/news/account, real fulfillment/refund/recovery are not connected. No real auth, credentials, transport, transaction, or persistent customer data.

Package contains the existing fonts/licenses and review photos locally. A local Roboto fallback copied from the Flutter SDK avoids CanvasKit's implicit Google Fonts request; no theme, pubspec or app font change. Local server CSP denies external connections and accepts no mutations. Source files are not a static HTML imitation: main.dart.js is the debug Flutter web compilation.

## Verification

- analyze: PASS.
- New browser fixture/widget tests: 7 PASS (fail-closed, all write methods/unknown reads reject, purchase cannot succeed/persist pending, actual routes, filter actions, presets/large text).
- Existing R2 catalog + A1: 49 PASS / 2 route tests conditionally skipped without API/preview defines. Separate catalog run with mock-only defines: 18 PASS, including those routes. Counts overlap; do not sum.
- Chrome Headless Shell154: real browser interactions and screenshots, external/API requests0, browser errors0. Python loopback server GET200 and POST rejection. Packaged final SHA gets a separate manifest and browser validation JSON.
- Windows launcher has not been executed on a physical Windows PC. Python3 server was exercised in this environment. No physical device/browser satisfaction acceptance claimed.

Existing R1/R2-A1 lib code, previous captures/builds, native workflows and production configuration remain untouched. No native build/tag/Firebase/Sites/server changes. Stop after delivering this preview.
