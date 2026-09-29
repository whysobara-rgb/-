# R2-A review & reproduction

Production UI is in `lib/features/home/presentation/`; this folder is debug-only,
non-transactional review data, not a production fallback or a new application.

- `catalog.dart`: optional existing-project Flutter debug entry point (`flutter run -d chrome -t tool/r2/catalog.dart`). Actual Home/Shop widgets, AppTheme root, 390×844 viewport, existing bottom navigation. Uses remote licensed photo samples. No Backend requests or real transaction actions. This web launch was not executed in R2-A; actual widget runtime is exercised below.
- `fixture.dart`: three synthetic records. IDs, names and GP are comparison data only. `review.invalid` is used solely as an image cache key in offline captures, never API_BASE_URL.
- `photos/`: licensed non-transactional sample photographs. Not listed as application bundle assets. See `docs/r2/R2-A-AUDIT.md` for sources/rights/limits.
- `test/features/r2_catalog_test.dart`: CTA IDs, filter drafts/apply/cancel/reset, search/sort, widths/text scales, lazy catalog, actual HomePage→GachaDetailPage GET route, gated/session-bound unopened summary.
- `test/features/r2_capture_test.dart`: opt-in actual Flutter renderer captures; local photo bytes are injected through the existing image cache, not through different UI. Standard full-test run does not run capture-only tests.

Commands (Flutter 3.35.4):

```sh
flutter analyze
flutter test
flutter test --dart-define=ENABLE_GP_ORDER_PREVIEW=true --dart-define=API_BASE_URL=https://r2.invalid test/features/r2_catalog_test.dart
flutter test --dart-define=R2_CAPTURE=true test/features/r2_capture_test.dart
```

The `r2.invalid` origin is used with MockClient only, not for a native artifact.
Before captures were executed at baseline 5924d68… before production source edits,
with the same visual fixture. To reproduce before, use an isolated checkout of that
baseline plus fixture/photos/capture harness; never reset the user's worktree.

Generated images/metrics live in `build/r2-evidence/{before,after}`. Full-height
comparison is a labelled stitch of real scroll viewports, not a different layout.
Native builds, Firebase, Sites publishing and server writes are outside R2-A.


## R2-A1 local corrections (2026-09-29)

- See `docs/r2/R2-A1-VERIFICATION.md` and `R2-CHECKPOINT.md` for the exact tested commit.
- `test/features/r2_a1_test.dart` exercises actual AppTheme → shop modal,
  resolved label/background/checkmark contrast and selected semantics, all
  dismissal paths and reset/cancel, home unique-count/stale states and compact
  missing-photo behavior. Optional captures are in `build/r2-a1-evidence/after`.
- The HomePage route test now separates valid detail + odds from explicit odds
  failure and the existing purchase-confirmation retry/blocking contract.
- Photo captures now include 100%/200%, missing/loading/error and alternate
  portrait/table/coffee images. Normal image frames retain contain fit; only
  known missing URLs omit the reserved photo area. Shared ProductImage is unchanged.

```sh
flutter test --no-pub --dart-define=R2_A1_CAPTURE=true test/features/r2_a1_test.dart
flutter test --no-pub --dart-define=R2_CAPTURE=true --dart-define=R2_CAPTURE_PHASE=a1 test/features/r2_capture_test.dart
```

A1 before/after filter images use the R2-A baseline `b1745d03…`, not the older
R1 baseline. The pre-fix contrast regression was intentionally observed failing
at 1:1 before local UI edits. Final tests require >=4.5 and do not disable that
assertion for baseline mode. Comparison measurements use the same three-box
photo fixture and complete scroll traversal. No native build or live API writes.
