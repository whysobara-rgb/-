# V33 Flutter Stage 1

## Fixed baseline and scope

- App baseline: `a4e9338c1ea79d64ab5b3a37012029b41b2e22da`; PR #1, `codex/launch-foundation`.
- Visual baseline: published Sites V33, `01dfcf1aebfea7a6fb97394a796950e3d54b5107`.
- Deployment: `appgdep_6ab1d02ec7c48191886bf7fa260f31a8`.
- Source design baseline: `8e427c6dc9f9f51383b2b27837a70ecaa834e20c`.
- Flutter 3.35.4 / Dart 3.9.2, existing Pretendard font assets and dependencies.
- Stage 1 only: shared presentation, Home, Box Shop, Product Detail and navigation.

## Existing app / web differences and implementation decisions

| Existing contract | V33 UI response |
|---|---|
| One home fetch owns search/category/GP price ordering | HomePage remains the single request owner; BoxShopScreen is a separate presentation. Home/shop switching retains filters and does not fetch again. |
| Server does not expose catalog wishlist, available quantity or sale state | No inferred wishlist, stock, sale status or BEST/HOT/NEW/LIMITED labels. Only server badgeLabel is shown. Detail keeps its existing totalStock/soldStock calculation. |
| `priceWon` maps to API price in GP | All cards, ordering and detail continue using GP. No currency conversion. |
| Published campaign API supplies home content | Home uses published campaign title/body/date/photo; absent campaigns use the first actual catalog box. No manufactured recommendation ranking or campaign. |
| Main tabs previously included ranking/wallet | Ranking is reachable from Home quick menu; wallet from Home/shop GP header and existing My callback. Existing page classes remain. Existing app has no named/deep-link route table to rename. |
| Unopened route is gated by orderPreviewEnabled | Center action opens the existing OrderFlowPage only under the same gate as InventoryPage. Gate off retains the existing service-preparation message. No opening UI or transaction changes. |
| Transactions reside in repositories and detail callbacks | Only the detail build method and extracted ProductDetailView change. Fetch, odds, quantity bounds, stock checks, confirmation, session checks and purchase guards remain intact. |
| Other screens still use AppColors/AppTheme | Existing references remain; GachiTheme is scoped to Stage 1 and the shared bottom bar. No deferred-screen restyle. |
| Web CSS assumes a narrow viewport | Native SafeArea and intrinsic text height; one-column cards at narrow/large text sizes. Detail CTA scrolls with content at large text/short landscape heights. No TextScaler clamp. |

## Shared presentation

GachiColors, GachiType, GachiSpace, GachiShape, GachiSize, scoped GachiTheme;
GachiScaffold, GachiHeader, GachiBottomNavigation, primary/secondary buttons,
GachiProductImage, GachiBadge, GachiSectionHeader, GachiInfoCard,
loading/error/empty states, category tabs, catalog grid and CapsuleBoxCard.
Images are server photos or explicit missing/failed placeholders. Layout has a stable aspect ratio.
Campaign rotation stops for reduced motion, accessible navigation, background and inactive tabs.

## Verification scope

- Widget matrix: Home/shop/detail at 320/360/390/430 logical width and 100%/200% text.
- Additional states: loading, empty, failure/retry, long names, keyboard, SafeArea,
  landscape, purchase quantity limits, sold out, shared query ownership and nav semantics.
- Existing full test suite remains required; no percentage derived from test counts.
- Quality, Android and iOS workflows check out the exact PR head.
- Existing actual main-entry builds and native secure storage restart probes remain.
- Separate debug-only `tool/v33/ui_probe.dart` captures the actual presentation widgets
  with a visible synthetic-data label. It does not instantiate repositories or execute transactions.
- Native screenshots are emulator/simulator evidence. They do not verify a signed-in
  production API session, physical devices, VoiceOver/TalkBack or actual purchases.
- API origins, build feature flags, DTOs, repositories, backend and dependencies are unchanged.

## Remaining work outside this approval

Open, Result, Collection, My and account/commerce design migration remain unstarted.
No API/migration is required by this stage; unsupported web metadata is omitted.
Final 3D/audio, live API end-to-end integration, physical-device and screen-reader testing
remain separate. Native icons use existing Material glyphs, so their geometry differs
from the web's stroke icons. Content and images reflect available server data.
