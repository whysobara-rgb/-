# V33 Flutter Stage 2

Baseline: `681a904d14f4ed815eb1a832c58a63240f8fb433` on PR #1 (`codex/launch-foundation`).
Local and remote HEAD matched before changes; PR open/draft. Flutter 3.35.4 / Dart 3.9.2.

## Contract differences recorded before implementation

- V33 midnight opening/result, ivory collection/profile are presentation references from the existing unmodified Sites `dist/brand-refinement.css` (published SHA 01dfcf1aebfea7a6fb97394a796950e3d54b5107).
- Flutter single (`OrderFlowPage`) and batch (`BatchOpeningPage`) processing remain separate. Only visual components are shared. Existing batch confirmation and explicit stop/resume controls remain; no pre-opening video/skip choice.
- Batch model has confirmed `results`, optional `inFlight`, and remaining capsule IDs. Presentation labels these as completed / checking / unopened. While the existing async advance is running, one remaining capsule is conservatively shown as checking; this does not persist or change transaction state. After settling, only persisted `inFlight` is checking. Zero confirmed results never uses partial-recovery wording.
- Skip changes only a presentation controller. It cannot call a repository, cancel or repeat a request. Background/resume pauses/resumes visual motion only; existing batch pause and user-directed recovery remain.
- Inventory and unopened capsules use different existing models/endpoints. Keep the unopened entry instead of inventing inventory states. Existing canShip/canConvert/isLocked and release gates determine action descriptions.
- Existing inventory estimated value is explicitly KRW in its model; GP remains a separate value. No reinterpretation of catalog priceWon.
- Profile retains all existing menu callbacks; detailed commerce/account pages are out of scope. Ranking remains at the Stage 1 Home shortcut.
- Native screenshots use labelled synthetic fixtures in a separate debug-only entrypoint. Actual app startup and native secure storage checks are separate; no live transaction claim.

## Protected scope
No repository/service, DTO/domain, API endpoint/config, release flag, backend or existing transaction test edits. Stage 1 production files remain unchanged unless a specific shared presentation correction is documented. No Sites edit, production deployment or store submission.

## Implementation and bounded shared changes

- GachiOpeningTheme/Heading/Experience/Breakdown and BatchResultView use V33 midnight tokens; PrizeReveal keeps its existing standalone Skip/reduced-motion API and supports externally owned presentation timing, avoiding two animations in the actual flow.
- Result cards use confirmed images/name/grade/quantity and a collection entry. All-retained batches go directly to truthful unopened status without a confirmed-prize animation.
- CollectionCard becomes a photo/status/date list row, with responsive stacking. Existing lock/select/detail/zoom and shipping/conversion callbacks remain. InventoryPage accepts an optional read adapter for synthetic inspection; production default is unchanged.
- ProfilePage preserves every route and logout confirmation. No detailed commerce/account destination restyled.
- Stage 1 production change: GachiProductImage gains optional ImageProvider and placeholderIcon inputs to reuse existing decoded NetworkImage handling and legacy result fallback without duplicating loading/error/aspect-ratio behavior. Defaults, Stage 1 screens, navigation and tokens are unchanged.
- Stage 1 verification files: Android/iOS workflows and simulator capture script append Stage 2 probes; quality workflow adds release-constant gate verification. Existing actual-main, Stage 1 screenshots, storage checks, API origins and feature defines remain unchanged.
- Single/batch request and recovery methods, and inventory loading/select/lock/shipping/conversion methods were byte-compared against the baseline and remain unchanged. Existing transaction tests are unmodified.

## Validation scope

64 new Stage 2 widget/state cases plus 1 release-constant case. Matrix includes six presentations at four widths and two text scales; single/multi opening, repeat Skip, delayed/lost response, pending+unopened, all retained, late response after disposal, lifecycle pause/resume, account switch, reduced motion, failed image, vault loading/error/retry, empty/100-item vault, My callbacks and 200% landscape.

Final-SHA CI supplies analyze/full tests, explicit gate-on navigation, release constants with every enable define supplied, Android main build/install/launch and storage recovery, iOS simulator main build/install/launch and Keychain recovery. Both platforms capture five Stage 2 screens using labelled synthetic data. This is not live server, physical device, VoiceOver/TalkBack, production payment, or final 3D/audio verification.

## Remaining differences and follow-up

- Open: native finite brand motion replaces the Canvas/3D look. Existing stop/resume and purchase confirmation are retained for safety.
- Result: native icons/typography and grouped result layout; no final 3D/audio. Missing photos remain honest placeholders.
- Collection: native selection/lock and server-specific status controls remain alongside the V33 list hierarchy. Unopened lives in the existing separate capsule flow.
- My: existing menu descriptions remain for discoverability; detailed destinations retain their prior designs. No fabricated counts/status totals.
- No server/API changes needed for this scope. Capsule list currently lacks a verified box photo/title; generic unopened labels remain. A future enriched capsule display would require an explicitly separate API contract, never invented client data.
- Stage 3 (commerce/account details) has not started. No deployment or store submission.

## Native capture correction

Android evidence exposed insufficient contrast from inherited light Material onSurfaceVariant on the midnight opening cards. The scoped GachiOpeningTheme now explicitly supplies high-contrast secondary/outline colors; a regression check reads the effective subtitle style and checkbox scheme. Stage 1 theme and transaction methods remain untouched. All final-SHA checks and native captures are run again after this correction.
