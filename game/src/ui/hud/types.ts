/**
 * HUD view-model contracts. Game flow builds one HudModel per frame (cheap plain data; arrays
 * may be reused between frames) and calls `hud.update(model)`. The HUD diffs against the
 * previous frame and touches the DOM only on change.
 *
 * Screen-space coordinates (labels, arrows, popups) are CSS pixels relative to the UiRoot
 * box, i.e. exactly what GameView.project() returns.
 */
import type { EntityId, HatId, LootKind, PingKind, SafeKind, TeamId } from '../../sim/types';
import type { TextRef } from '../i18n';
import type { PromptAction } from '../core/prompts';

export interface HudBank {
  id: EntityId;
  recovered: boolean;
  recoveredBy: TeamId | null;
  /** Team currently dragging the (unrecovered) bank, if any. */
  carriedBy?: TeamId | null;
}

/** What the local player (or their held object) carries: the '운반 중' estimate. */
export interface HudCarry {
  kind: LootKind;
  /** Points if recovered right now (bank: 500 + loaded safes). */
  value: number;
  /** Bank only: breakdown. */
  building?: number;
  safes?: number;
  /** 0..1 recovery dwell progress while fully inside our zone; null/undefined otherwise. */
  recovering?: number | null;
}

/** What the grab button would do right now (doc §4 highlight + prompt). */
export interface HudGrab {
  action: 'grab' | 'release';
  /** 'bankWall' = grabbing the bank through its outer wall. */
  target: LootKind | 'bankWall';
  /** Recovery value of the target (bank: current estimate). */
  value: number;
  /** Still anchored: needs pulling to uproot. */
  anchored?: boolean;
  /** Seconds of pulling needed (1 / 2 / 3). */
  unanchorSec?: number;
  /** 0..1 while straining. */
  unanchorProgress?: number | null;
}

export interface MinimapBank {
  id: EntityId;
  x: number;
  y: number;
  angle: number;
  recovered: boolean;
  carriedBy?: TeamId | null;
}

export interface MinimapSafe {
  id: EntityId;
  kind: SafeKind;
  x: number;
  y: number;
  angle: number;
  recovered: boolean;
  /** Loaded inside a bank (drawn with the bank). */
  loaded?: boolean;
  heldBy?: TeamId | null;
}

export interface MinimapCharacter {
  id: EntityId;
  team: TeamId;
  x: number;
  y: number;
  facing: number;
  isMe?: boolean;
  /**
   * Opponents are drawn only when true (in sight). Own team is always drawn (doc §4: public
   * info only).
   */
  visible: boolean;
}

export interface MinimapPing {
  id: number;
  team: TeamId;
  x: number;
  y: number;
  kind: PingKind;
}

/** A police officer on the minimap (police are public info: always drawn). */
export interface MinimapOfficer {
  id: EntityId;
  x: number;
  y: number;
  /** Chasing / lunging (drawn with an alert ring). */
  hunting?: boolean;
  /** Knocked over by a dash. */
  stunned?: boolean;
}

/** A police car on (or at the edge of) the arena. */
export interface MinimapPoliceCar {
  id: number;
  x: number;
  y: number;
  angle: number;
  siren?: boolean;
}

export interface MinimapModel {
  banks: readonly MinimapBank[];
  /** Police officers and cars (empty arrays / omitted when the police event is off). */
  police?: readonly MinimapOfficer[];
  policeCars?: readonly MinimapPoliceCar[];
  safes: readonly MinimapSafe[];
  characters: readonly MinimapCharacter[];
  /** Only the local team's pings should be passed. */
  pings?: readonly MinimapPing[];
  /** Fence ids broken so far (static layer is redrawn when this changes). */
  brokenFences?: readonly string[];
}

interface LabelBase {
  /** Stable id (entity id, ping id...). Combined with kind for pooling. */
  id: string | number;
  /** Screen position (CSS px, UiRoot box) of the label anchor (bottom-center). */
  x: number;
  y: number;
}

/** Value tag over a safe: shape icon + 100 / 300. */
export interface ValueLabel extends LabelBase {
  kind: 'value';
  loot: SafeKind;
  value: number;
  /** Loaded inside a bank (shows a small 'loaded' marker). */
  loaded?: boolean;
  /** Emphasize (grab candidate / pinged). */
  focus?: boolean;
}

/** Bank estimate: '예상 1,000' + optional '건물 500 + 금고 500' line. */
export interface BankLabel extends LabelBase {
  kind: 'bank';
  value: number;
  building?: number;
  safes?: number;
  showBreakdown?: boolean;
  carriedBy?: TeamId | null;
  focus?: boolean;
}

/** Recovery progress ring over an item in a zone. */
export interface RecoveryLabel extends LabelBase {
  kind: 'recovery';
  progress: number;
  team: TeamId;
}

/** Ping marker: '같이 잡자' / '이쪽으로'. */
export interface PingLabel extends LabelBase {
  kind: 'ping';
  ping: PingKind;
  team: TeamId;
}

/**
 * Name tag over a character (2:2 clarity). `text` follows the language: a dictionary key
 * ('rival.hodadak.name', 'name.ally', 'name.you'), `{ key, params }`, or `{ text }` for a
 * literal name. A plain string that is not a key is shown literally (see trName).
 */
export interface NameLabel extends LabelBase {
  kind: 'name';
  text: TextRef;
  team: TeamId;
  isMe?: boolean;
}

export type WorldLabelModel = ValueLabel | BankLabel | RecoveryLabel | PingLabel | NameLabel;

/** Something to point at when it is off-screen (doc §4: carried or pinged targets). */
export interface OffscreenTarget {
  id: string | number;
  /** Projected screen position (may be outside the viewport). */
  x: number;
  y: number;
  /** True if the point is behind the camera (direction flipped by the projector). */
  behind?: boolean;
  kind: 'carry' | 'ping' | 'zone' | 'bank' | 'safe';
  team?: TeamId;
  value?: number;
}

/** Police status for the HUD chip (owner addition beyond doc v0.5). */
export interface HudPolice {
  /** Seconds until the next police car arrives (an alarm is pending), else null. */
  dispatchInSec: number | null;
  /** Officers on the field. */
  officers: number;
  /** Banks whose alarm is ringing. */
  alarms: number;
}

export interface HudModel {
  mode: 'match' | 'practice';
  myTeam: TeamId;
  /** Confirmed scores by team (practice: scores[myTeam] is the practice score). */
  scores: readonly [number, number];
  /** Remaining seconds (single clock), or null for no limit (practice). */
  timeLeftSec: number | null;
  /** Both banks recovered: siren styling ("30초 뒤 출발!"). */
  finalCountdown: boolean;
  banks: readonly HudBank[];
  /** Last bank is being recovered: "회수하면 도주 준비 시작" (shown to both sides). */
  lastBankWarning: boolean;
  carry: HudCarry | null;
  grab: HudGrab | null;
  /** 0 = dash ready .. 1 = just used. */
  dashCooldown: number;
  minimap?: MinimapModel | null;
  /** Police chip (null / omitted = no police activity to show). */
  police?: HudPolice | null;
  labels?: readonly WorldLabelModel[];
  arrows?: readonly OffscreenTarget[];
}

export interface ScorePopupOptions {
  team: TeamId;
  kind: LootKind;
  value: number;
  /** Bank breakdown. */
  building?: number;
  safes?: number;
  /** Screen position (CSS px). Omit to show under the scoreboard. */
  x?: number;
  y?: number;
}

export type BannerKind = 'escape' | 'timeUp' | 'decided' | 'allRecovered' | 'practiceDone' | 'go' | 'policeDispatched' | 'policeArrived';

/** Stamp callouts for big moments, driven from real events. */
export type HudStampKind = 'uproot' | 'steal' | 'bankWhole' | 'dodge' | 'police';

export interface HudStampOptions {
  /** Team that made the play (colours the stamp; never the only cue — the text says it). */
  team?: TeamId | null;
  /** Screen anchor (CSS px). Omitted: under the scoreboard. */
  x?: number;
  y?: number;
  params?: Readonly<Record<string, string | number>>;
  /** How long it stays (ms); default ~1.6 s (2 s for the whole bank). */
  durationMs?: number;
}

/** Portrait spec for a scoreboard face (the team's lead character). */
export interface HudFace {
  hat?: HatId;
  rival?: 'hodadak' | 'tongkeun' | 'nunchi' | null;
}

export interface TutorialPromptModel {
  text: TextRef;
  sub?: TextRef | null;
  /** Action glyphs shown in the card (e.g. ['grab']). */
  actions?: readonly PromptAction[];
  step?: number;
  total?: number;
  /** Glyph + '연습 건너뛰기' hint. */
  skipAction?: PromptAction | null;
  /** Celebrate state (green check). */
  done?: boolean;
}

export interface CaptionOptions {
  params?: Readonly<Record<string, string | number>>;
  /** Direction the sound came from relative to the player. */
  side?: 'left' | 'right' | null;
  durationMs?: number;
}
