# V33 Flutter Stage 3 — Commerce / Account presentation

Baseline: `6e7ca1c4c735a256e12cb58911830f9864e07913`.
Repository `whysobara-rgb/-`, existing `codex/launch-foundation`, PR #1 Draft/Open.
Published V33 and the approved Stage 1/2 tokens are the visual baseline. Sites remains unchanged.

## Existing screens covered

- Orders: OrderHistoryPage / OrderRefundPage, order and refund history, server currency/amount/status/date, capsule eligibility, quote/consent, request and recovery.
- Shipping: DeliveryRequestPage / ShippingHistoryPage / ShippingDetailPage, quote, address form, request, recovery, status and cancellation.
- GP: ConversionPage quote/history/receipt/restore and existing WalletPage / PointHistoryPage.
- Account: AccountSecurityPage password/session actions, RecoveryPage email verification and password reset, AccountClosurePage check/request/status/cancel/recovery, existing LoginPage / SignupPage.
- Support: CustomerUpdatesPage (existing five tabs), SupportComposePage / SupportThreadPage. No invented API or separate new customer routes.

## Presentation architecture

`gachi_flow.dart` reuses GachiTheme, colors, type, spacing, shapes and buttons. It adds scoped commerce/account cards and fields, SafeArea/max-width scaffold, section heading, amount/state summary, secondary copyable support references, themed scrollable dialogs and mounted form controls. No global token change.

State/amount/action comes before explanatory/reference information. Existing IDs remain available as subdued support references where required; shipping inventory IDs are removed from the main product rows. No new order numbers, dates, statuses, images or calculated policy amounts. Existing domain state-label maps and actual server fields are used. Missing data is not synthesized.

All Stage 1/2 screen files, shared tokens, GachiProductImage, navigation and Open state/transaction files remain unchanged. `ActivityFeed` only changes visual color references to the approved tokens; its pagination, failure and retry implementation is unchanged. Its production consumers are Stage 3 support, shipping and point history.

`DeliveryRequestPage` and `SupportComposePage` accept optional repository inputs for isolated UI tests. Their production default constructor expressions remain identical. Repositories, services, DTOs, endpoints, config, gates, secure storage, account leases, recovery and all pre-existing test assertions remain unchanged. Dialog substitutions wrap the existing title/body/actions; they do not alter confirmation decisions or callbacks.

## Local validation / final-head CI contract

- Flutter 3.35.4 / Dart 3.9.2.
- Analyze: no issues. Whole existing+new test suite: 476 passing at implementation review.
- 163 new Stage 3 widget/state tests: 18 presentations × 4 widths (320/360/390/430) × 100/200% = 144; 8 landscape/keyboard cases; 5 empty-list cases; 6 state/gate/security cases.
- Existing Stage 1/2, auth/session, order/open/recovery, conversion, refund, shipping, email/password and closure safety tests are retained and rerun.
- Existing release-constant gate test and gate-enabled navigation check remain; a dedicated synthetic shipping form check is added with its debug define. Build/API flags themselves are unchanged.
- No forced text scale. Long names/addresses, scrollable forms, multiple actions, keyboard insets, SafeArea and 200% are checked. Password/link fields remain obscured and existing background secret clearing is tested.
- Final PR head triggers new Flutter quality, Android and iOS workflows. Final results and exact SHA are recorded in the delivered review report, not inferred from historical Stage 1/2 runs.

## Native evidence

The existing actual-main debug build/install/launch and native secure storage/Keychain restart probes remain. Separate debug-only Stage 3 `ui_probe.dart` captures Orders, Refund, Shipping, Security, Closure and GP Conversion on both platforms. `MockClient` and memory stores serve clearly labelled synthetic data. These are actual Flutter widgets running on emulator/simulator, not production-server transactions. Native storage probes use real platform storage with mocked HTTP.

## Remaining differences / limits

- Native Material fields/dialogs/scrolling and V33 tokenized cards replace web HTML layouts. Account/commerce explanations and safety confirmations retain native API constraints.
- Existing combined pages remain combined (order detail/refund; security/password/session; closure request/status/cancel). No web-only feature is fabricated.
- Order and shipping projections do not carry a usable product-image field; no unrelated product photo is invented. Future image enrichment would require a separately reviewed API addition preserving historical order snapshots. No API work is required for this UI stage.
- The existing closure contract remains REQUEST_ONLY. Final deletion, retention policy execution and processing dates are outside this stage.
- Real-server E2E, physical Android/iPhone, real VoiceOver/TalkBack, real PG, production release, final 3D/audio and product image infrastructure are not verified or implemented here.
- Stage 3 stops after report. No server/DB/PG/physical-device stage starts automatically.
