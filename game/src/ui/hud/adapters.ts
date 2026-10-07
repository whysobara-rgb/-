/**
 * OPTIONAL helpers that map live sim state to HUD view-models. Pure functions over the
 * contracts in src/sim/types.ts (structural `SimView`, no import of the Simulation class), so
 * game flow can build a HudModel in a few lines:
 *
 *   const model = hudModelFromSim(sim, { meId, myTeam, project: (p, h) => view.project(p, h),
 *                                        isOpponentVisible: (c) => perception.sees(c) });
 *   hud.update(model);
 *
 * Presentation rules implemented here (doc §4 / §10):
 * - Not every safe number at once: value tags only for safes near me, my grab candidate,
 *   pinged / held / loaded-in-carried-bank safes. Banks always show their estimate.
 * - Bank breakdown line when it is near, carried or targeted.
 * - Recovery rings for any item dwelling in a zone; own-team ping markers.
 * - Off-screen arrows only for carried and pinged targets (+ our zone while I carry).
 */
import type {
  CharacterState,
  EntityId,
  GrabCandidate,
  LayoutDef,
  LootState,
  RuleConfig,
  SimState,
  TeamId,
  Vec2,
} from '../../sim/types';
import { BANK_MODEL, BREAKABLE_SPECS, COINS, DASH, ITEMS, ITEM_FOREVER, PROP_SPECS, SAFE_SPECS, SCORE, TICK_RATE, UNANCHOR_TICKS } from '../../sim/config';
import { hasKey, type TextRef } from '../i18n';
import { matchPointInfo, type MatchPointInfo } from '../../sim/queries';
import { hudMatchPoint, hudSwing } from './tension';
import type {
  HudBank,
  HudCarry,
  HudGrab,
  HudModel,
  HudPolice,
  MinimapModel,
  MinimapOfficer,
  MinimapPoliceCar,
  OffscreenTarget,
  WorldLabelModel,
} from './types';
// [C8] Content 2.0 view-models
import type { ContentLabelModel, HudBag, HudContentModel, HudDepositRing, HudItemSlot, MinimapItem, MinimapItemPad } from './contentTypes';

/** The subset of Simulation the adapters need (matches docs/ARCHITECTURE.md). */
export interface SimView {
  readonly state: SimState;
  readonly rules: RuleConfig;
  readonly layout: LayoutDef;
  getGrabCandidate(charId: EntityId): GrabCandidate | null;
  getLoot(id: EntityId): LootState | undefined;
}

export type Projector = (p: Vec2, height: number) => { x: number; y: number; onScreen: boolean };

export interface HudAdapterOptions {
  meId: EntityId;
  myTeam: TeamId;
  mode?: HudModel['mode'];
  /** Screen projection (GameView.project). Without it, labels and arrows are omitted. */
  project?: Projector;
  /** Opponent visibility for the minimap (default: never — public info only). */
  isOpponentVisible?: (c: CharacterState) => boolean;
  /** Meters within which safe value tags are shown (default 7). */
  nearRadius?: number;
  /** Show name tags over characters (default: only in 2:2, i.e. more than 2 characters). */
  nameTags?: boolean;
  /**
   * [F4] Match point to show (e.g. `MomentTracker.snapshot().matchPoint`). Omitted: computed with
   * `matchPointInfo(state, { earlyDecision: rules.earlyDecision })` (the same answer).
   */
  matchPoint?: MatchPointInfo | null;
}

const dist2 = (a: Vec2, b: Vec2): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/**
 * Language-following name for a character's world tag:
 * me -> 'name.you'; a roster name that is a dictionary key -> that key; a rival bot ->
 * 'rival.<id>.name'; a teammate bot -> 'name.ally'; anything else -> the literal name.
 */
export function characterNameRef(c: CharacterState, meId: EntityId | null, myTeam: TeamId): TextRef {
  if (c.id === meId) return 'name.you';
  if (c.name && hasKey(c.name)) return c.name;
  if (c.look.rival) return `rival.${c.look.rival}.name`;
  if (c.isBot && c.team === myTeam) return 'name.ally';
  return { text: c.name };
}

export function hudBanksFromState(state: SimState): HudBank[] {
  const out: HudBank[] = [];
  for (const l of state.loot) {
    if (l.kind !== 'bank') continue;
    out.push({ id: l.id, recovered: l.recovered, recoveredBy: l.recoveredBy, carriedBy: carrierTeam(state, l) });
  }
  return out;
}

/** Team of the characters holding this loot (first holder), or null. */
export function carrierTeam(state: SimState, l: LootState): TeamId | null {
  if (!l.grabbedBy.length) return null;
  const c = state.characters.find((ch) => ch.id === l.grabbedBy[0]);
  return c ? c.team : null;
}

export function minimapFromState(state: SimState, myTeam: TeamId, meId: EntityId | null, isOpponentVisible?: (c: CharacterState) => boolean): MinimapModel {
  return {
    banks: state.loot
      .filter((l) => l.kind === 'bank')
      .map((l) => ({ id: l.id, x: l.pos.x, y: l.pos.y, angle: l.angle, recovered: l.recovered, carriedBy: carrierTeam(state, l) })),
    safes: state.loot
      .filter((l) => l.kind !== 'bank' && !l.recovered && !l.dormant)
      .map((l) => ({
        id: l.id,
        kind: l.kind as 'smallSafe' | 'largeSafe',
        x: l.pos.x,
        y: l.pos.y,
        angle: l.angle,
        recovered: l.recovered,
        loaded: l.loadedIn !== null,
        heldBy: carrierTeam(state, l),
        variant: l.variant ?? null,
      })),
    characters: state.characters.map((c) => ({
      id: c.id,
      team: c.team,
      x: c.pos.x,
      y: c.pos.y,
      facing: c.facing,
      isMe: c.id === meId,
      visible: c.team === myTeam || (isOpponentVisible ? isOpponentVisible(c) : false),
    })),
    pings: state.pings.filter((p) => p.team === myTeam).map((p) => ({ id: p.id, team: p.team, x: p.pos.x, y: p.pos.y, kind: p.kind })),
    brokenFences: state.fences.filter((f) => f.broken).map((f) => f.id),
    // Police are public information (they are on everyone's screen): always drawn.
    police: policeMarkers(state),
    policeCars: policeCarMarkers(state),
    // [C8] field items + coin piles (public information; empty in classic). Pads: hudModelFromSim.
    items: fieldItemMarkers(state),
    coins: state.coins,
  };
}

export function policeMarkers(state: SimState): MinimapOfficer[] {
  const list = state.police ?? [];
  const out: MinimapOfficer[] = [];
  for (const o of list) {
    if (o.phase === 'gone') continue;
    out.push({ id: o.id, x: o.pos.x, y: o.pos.y, hunting: o.phase === 'chase' || o.phase === 'tackle', stunned: o.phase === 'stunned' });
  }
  return out;
}

export function policeCarMarkers(state: SimState): MinimapPoliceCar[] {
  const list = state.policeCars ?? [];
  const out: MinimapPoliceCar[] = [];
  for (const c of list) {
    if (c.phase === 'gone') continue;
    out.push({ id: c.id, x: c.pos.x, y: c.pos.y, angle: c.angle, siren: c.sirenOn });
  }
  return out;
}

/** Police chip data: a pending dispatch countdown, officers on the field, ringing alarms. */
export function policeFromState(state: SimState): HudPolice | null {
  const alarm = state.alarm;
  const pending = alarm && alarm.dispatchTick !== null && alarm.dispatchTick !== undefined ? Math.max(0, alarm.dispatchTick - state.tick) / TICK_RATE : null;
  let officers = 0;
  for (const o of state.police ?? []) if (o.phase !== 'gone') officers++;
  const alarms = alarm?.ringing?.length ?? 0;
  if (pending === null && officers === 0 && alarms === 0) return null;
  return { dispatchInSec: pending, officers, alarms };
}

export function carryFromState(sim: SimView, me: CharacterState): HudCarry | null {
  if (!me.grab) return null;
  const l = sim.getLoot(me.grab.targetId);
  if (!l || l.recovered) return null;
  const recovering = l.recovery && l.recovery.team === me.team ? l.recovery.ticks / sim.rules.recoveryTicks : null;
  if (l.kind === 'bank') {
    return { kind: 'bank', value: l.estimatedValue, building: SCORE.bankBuilding, safes: l.estimatedValue - SCORE.bankBuilding, recovering };
  }
  return { kind: l.kind, value: l.estimatedValue, recovering, variant: l.variant ?? null };
}

export function grabFromState(sim: SimView, me: CharacterState): HudGrab | null {
  if (me.grab) {
    const l = sim.getLoot(me.grab.targetId);
    if (!l) return null;
    return {
      action: 'release',
      target: me.grab.part === 'bankWall' ? 'bankWall' : l.kind,
      value: l.estimatedValue,
      anchored: l.anchored,
      unanchorSec: uprootSec(l),
      unanchorProgress: l.anchored && me.straining ? l.unanchorProgress : null,
      variant: l.variant ?? null,
    };
  }
  const cand = sim.getGrabCandidate(me.id);
  if (!cand) return null;
  const l = sim.getLoot(cand.targetId);
  if (!l) return null;
  return {
    action: 'grab',
    target: cand.part === 'bankWall' ? 'bankWall' : l.kind,
    value: l.estimatedValue,
    anchored: l.anchored,
    unanchorSec: uprootSec(l),
    unanchorProgress: null,
    variant: l.variant ?? null,
  };
}

/** [C8] Seconds of pulling to uproot (props use their own PROP_SPECS uproot time). */
function uprootSec(l: LootState): number {
  if (l.variant) return Math.round((PROP_SPECS[l.variant].uprootTicks / TICK_RATE) * 10) / 10;
  return UNANCHOR_TICKS[l.kind] / TICK_RATE;
}

/** World labels + arrows for the current frame (requires a projector). */
export function labelsFromSim(
  sim: SimView,
  me: CharacterState,
  project: Projector,
  o: { nearRadius?: number; nameTags?: boolean } = {},
): { labels: WorldLabelModel[]; arrows: OffscreenTarget[] } {
  const st = sim.state;
  const labels: WorldLabelModel[] = [];
  const arrows: OffscreenTarget[] = [];
  const near2 = (o.nearRadius ?? 7) ** 2;
  const cand = me.grab ? null : sim.getGrabCandidate(me.id);
  const heldId = me.grab?.targetId ?? null;
  const heldLoot = heldId !== null ? sim.getLoot(heldId) : undefined;
  const pinged = new Set<EntityId>();
  for (const p of st.pings) if (p.team === me.team && p.targetId !== null) pinged.add(p.targetId);

  for (const l of st.loot) {
    if (l.recovered || l.dormant) continue;
    const isBank = l.kind === 'bank';
    const focus = l.id === cand?.targetId || l.id === heldId || pinged.has(l.id);
    const inCarriedBank = heldLoot?.kind === 'bank' && l.loadedIn === heldLoot.id;
    if (isBank) {
      const p = project(l.pos, BANK_MODEL.roofHeight + 1.2);
      const carried = carrierTeam(st, l);
      if (p.onScreen) {
        labels.push({
          kind: 'bank',
          id: l.id,
          x: p.x,
          y: p.y,
          value: l.estimatedValue,
          building: SCORE.bankBuilding,
          safes: l.estimatedValue - SCORE.bankBuilding,
          showBreakdown: focus || carried !== null || dist2(l.pos, me.pos) < near2 * 2,
          carriedBy: carried,
          focus,
        });
      }
    } else if (l.kind !== 'bank' && !l.variant && (focus || inCarriedBank || dist2(l.pos, me.pos) < near2)) {
      // [C8] props (variant) are tagged by contentFromSim ("ATM 200 · 동전 8"), not as a safe
      const p = project(l.pos, SAFE_SPECS[l.kind].height + 0.6);
      if (p.onScreen) labels.push({ kind: 'value', id: l.id, x: p.x, y: p.y, loot: l.kind, value: l.baseValue, loaded: l.loadedIn !== null, focus });
    }
    if (l.recovery) {
      const p = project(l.pos, isBank ? BANK_MODEL.roofHeight + 3.4 : (l.variant ? PROP_SPECS[l.variant].height : SAFE_SPECS[l.kind as 'smallSafe'].height) + 1.8);
      if (p.onScreen) labels.push({ kind: 'recovery', id: l.id, x: p.x, y: p.y, progress: l.recovery.ticks / sim.rules.recoveryTicks, team: l.recovery.team });
    }
    // Arrows: things carried by my team, or pinged by my team.
    const holderTeam = carrierTeam(st, l);
    if (holderTeam === me.team && l.id !== heldId) {
      const p = project(l.pos, 1);
      arrows.push({ id: `carry:${l.id}`, x: p.x, y: p.y, behind: false, kind: isBank ? 'bank' : 'carry', team: me.team, value: l.estimatedValue });
    } else if (pinged.has(l.id)) {
      const p = project(l.pos, 1);
      arrows.push({ id: `ping:${l.id}`, x: p.x, y: p.y, kind: isBank ? 'bank' : 'safe', team: me.team, value: l.estimatedValue });
    }
  }
  // Our zone while I'm carrying something.
  if (heldLoot) {
    const z = sim.layout.zones.find((zz) => zz.team === me.team);
    if (z) {
      const p = project(z.center, 0.5);
      arrows.push({ id: 'zone', x: p.x, y: p.y, kind: 'zone', team: me.team });
    }
  }
  for (const ping of st.pings) {
    if (ping.team !== me.team) continue;
    const p = project(ping.pos, ping.targetId !== null ? 2.6 : 0.2);
    if (p.onScreen) labels.push({ kind: 'ping', id: ping.id, x: p.x, y: p.y, ping: ping.kind, team: ping.team });
    else if (ping.targetId === null) arrows.push({ id: `pingpos:${ping.id}`, x: p.x, y: p.y, kind: 'ping', team: ping.team });
  }
  if (o.nameTags ?? st.characters.length > 2) {
    for (const c of st.characters) {
      const p = project(c.pos, 2.3);
      if (p.onScreen) labels.push({ kind: 'name', id: c.id, x: p.x, y: p.y, text: characterNameRef(c, me.id, me.team), team: c.team, isMe: c.id === me.id });
    }
  }
  return { labels, arrows };
}

/** Full HudModel for the local player. */
export function hudModelFromSim(sim: SimView, o: HudAdapterOptions): HudModel {
  const st = sim.state;
  const me = st.characters.find((c) => c.id === o.meId);
  const banks = hudBanksFromState(st);
  const remainingBank = banks.find((b) => !b.recovered);
  const remainingLoot = remainingBank ? sim.getLoot(remainingBank.id) : undefined;
  const timeLeftSec = Number.isFinite(st.endTick) ? Math.max(0, st.endTick - st.tick) / TICK_RATE : null;
  const lw = me && o.project ? labelsFromSim(sim, me, o.project, { nearRadius: o.nearRadius, nameTags: o.nameTags }) : null;
  const mode = o.mode ?? (sim.rules.timeLimit ? 'match' : 'practice');
  const tension = mode === 'match' ? tensionFromSim(sim, o.myTeam, o.matchPoint) : { matchPoint: null, swing: null };
  return {
    mode,
    myTeam: o.myTeam,
    scores: st.scores,
    timeLeftSec,
    finalCountdown: st.finalCountdown,
    banks,
    // doc §8: "마지막 은행을 회수하려는 순간 ... 양쪽에 보여준다"
    lastBankWarning: st.banksRecovered === 1 && !!remainingLoot?.recovery,
    carry: me ? carryFromState(sim, me) : null,
    grab: me ? grabFromState(sim, me) : null,
    dashCooldown: me ? Math.min(1, me.dashCooldown / DASH.cooldownTicks) : 0,
    minimap: { ...minimapFromState(st, o.myTeam, o.meId, o.isOpponentVisible), itemPads: itemPadMarkers(sim) },
    police: policeFromState(st),
    labels: lw?.labels,
    arrows: lw?.arrows,
    matchPoint: tension.matchPoint,
    swing: tension.swing,
    content: me ? contentFromSim(sim, me, o.project, { nearRadius: o.nearRadius }) : null,
  };
}

/**
 * [F4] Tension fields of the HudModel: the decisive-load prompt (match point, coin bags included)
 * and the swing readout (counts coins). Pure; never claims a win for a 'tie' load.
 */
export function tensionFromSim(sim: SimView, myTeam: TeamId, mp?: MatchPointInfo | null): Pick<HudModel, 'matchPoint' | 'swing'> {
  const st = sim.state;
  if (st.over) return { matchPoint: null, swing: null };
  const info = mp === undefined ? matchPointInfo(st, { earlyDecision: sim.rules.earlyDecision }) : mp;
  return { matchPoint: hudMatchPoint(info, st, myTeam), swing: hudSwing(st, myTeam) };
}

// ---------------------------------------------------------------------------------------------
// [C8] Content 2.0 (content-plan §6 C8 wave 1): item slot, bag chip, deposit ring, world tags,
// minimap layers. Pure; null / empty in classic (no `bag` / `item` fields on characters).
// ---------------------------------------------------------------------------------------------

/** Tag height above the ground per prop (m). */
const PROP_TAG_LIFT = 0.7;

/** Items on the field for the minimap (incoming crates and ground pickups). */
export function fieldItemMarkers(state: SimState): MinimapItem[] {
  const out: MinimapItem[] = [];
  for (const it of state.items ?? []) out.push({ id: it.id, kind: it.kind, x: it.pos.x, y: it.pos.y, incoming: it.phase === 'incoming' });
  return out;
}

const NO_PADS: readonly MinimapItemPad[] = [];
const padCache = new WeakMap<LayoutDef, readonly MinimapItemPad[]>();

/** Supply pads of a v2 match with items on (static per layout, cached; empty otherwise). */
export function itemPadMarkers(sim: SimView): readonly MinimapItemPad[] {
  if (sim.rules.content !== 'v2' || sim.rules.items === 'off') return NO_PADS;
  let pads = padCache.get(sim.layout);
  if (!pads) {
    pads = (sim.layout.v2?.itemPads ?? []).map((p) => ({ id: p.id, x: p.pos.x, y: p.pos.y, twin: p.twin }));
    padCache.set(sim.layout, pads);
  }
  return pads;
}

/** The item in `me`'s pocket for the dash-ring slot. */
export function itemSlotFromState(state: SimState, me: CharacterState): HudItemSlot | null {
  const it = me.item;
  if (!it) return null;
  const spec = ITEMS.specs[it.kind];
  const unlimitedUses = it.uses >= ITEM_FOREVER || spec.uses >= ITEM_FOREVER;
  const forever = it.expiresTick >= ITEM_FOREVER || spec.lifetimeTicks >= ITEM_FOREVER;
  const leftTicks = Math.max(0, it.expiresTick - state.tick);
  return {
    kind: it.kind,
    uses: unlimitedUses ? null : Math.max(0, it.uses),
    maxUses: unlimitedUses ? null : Math.max(spec.uses, it.uses),
    life: forever ? null : Math.min(1, leftTicks / Math.max(1, spec.lifetimeTicks)),
    lifeSec: forever ? null : leftTicks / TICK_RATE,
    cooldown: spec.cooldownTicks > 0 ? Math.min(1, Math.max(0, it.cooldown) / spec.cooldownTicks) : 0,
    armed: !me.grab,
    phase: it.phase,
  };
}

/** My bag (null while empty or in classic). Deposit progress only while the timer runs. */
export function bagFromState(me: CharacterState): HudBag | null {
  const bag = me.bag ?? 0;
  if (bag <= 0) return null;
  const d = me.depositTicks ?? 0;
  return { value: bag, cap: COINS.bagCap, deposit: d > 0 ? Math.min(1, d / COINS.depositTicks) : null };
}

/** Ring under my feet while the deposit timer runs (needs a projector). */
export function depositRingFromState(me: CharacterState, project: Projector | undefined): HudDepositRing | null {
  const bag = me.bag ?? 0;
  const d = me.depositTicks ?? 0;
  if (!project || bag <= 0 || d <= 0 || me.knockdownTicks > 0) return null;
  const p = project(me.pos, 0.05);
  if (!p.onScreen) return null;
  return { x: p.x, y: p.y, progress: Math.min(1, d / COINS.depositTicks), value: bag, team: me.team };
}

/**
 * World tags: props near me (or my grab candidate / held prop): "ATM 200 · 동전 8"; breakables
 * near me: "나무 상자 · 동전 2"; every item on screen (the HUD shows a name tag only on the first
 * sightings of its kind). Proximity only (doc §4: not every number at once).
 */
export function contentLabelsFromSim(sim: SimView, me: CharacterState, project: Projector, o: { nearRadius?: number } = {}): ContentLabelModel[] {
  const st = sim.state;
  const out: ContentLabelModel[] = [];
  const near2 = (o.nearRadius ?? 7) ** 2;
  const cand = me.grab ? null : sim.getGrabCandidate(me.id);
  const heldId = me.grab?.targetId ?? null;
  for (const l of st.loot) {
    if (!l.variant || l.recovered || l.dormant || l.airborne) continue;
    const focus = l.id === cand?.targetId || l.id === heldId;
    if (!focus && dist2(l.pos, me.pos) >= near2) continue;
    const p = project(l.pos, PROP_SPECS[l.variant].height + PROP_TAG_LIFT);
    if (!p.onScreen) continue;
    const inner = Math.max(0, l.innerValue ?? 0);
    out.push({
      kind: 'prop',
      id: l.id,
      x: p.x,
      y: p.y,
      variant: l.variant,
      value: l.estimatedValue,
      coins: l.variant === 'atm' ? Math.floor(inner / COINS.coin) : 0,
      bills: l.variant === 'moneyTree' ? Math.floor(inner / COINS.bill) : 0,
      cracks: l.variant === 'piggy' ? Math.max(0, Math.min(3, l.cracks ?? 0)) : null,
      focus,
    });
  }
  for (const b of st.breakables ?? []) {
    if (b.broken || dist2(b.center, me.pos) >= near2) continue;
    const spec = BREAKABLE_SPECS[b.kind];
    const p = project(b.center, spec.height + 0.5);
    if (!p.onScreen) continue;
    out.push({ kind: 'breakable', id: b.id, x: p.x, y: p.y, breakable: b.kind, coins: Math.floor(Math.max(0, b.innerValue) / COINS.coin), hp: Math.max(0, b.hp), maxHp: spec.hp });
  }
  for (const it of st.items ?? []) {
    const incoming = it.phase === 'incoming';
    const p = project(it.pos, incoming ? 2.4 : 1.4);
    if (!p.onScreen) continue;
    out.push({ kind: 'item', id: it.id, x: p.x, y: p.y, item: it.kind, incoming, landSec: incoming ? Math.max(0, it.landTick - st.tick) / TICK_RATE : null });
  }
  return out;
}

/** HudModel.content for the local player; null in classic. */
export function contentFromSim(sim: SimView, me: CharacterState, project: Projector | undefined, o: { nearRadius?: number } = {}): HudContentModel | null {
  if (sim.rules.content !== 'v2') return null;
  return {
    item: itemSlotFromState(sim.state, me),
    bag: bagFromState(me),
    deposit: depositRingFromState(me, project),
    labels: project ? contentLabelsFromSim(sim, me, project, o) : [],
  };
}
