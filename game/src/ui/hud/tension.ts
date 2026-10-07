/**
 * [F4] Tension HUD logic (fun-plan WP4 + content-plan F4 delta). Pure, DOM-free, unit-tested:
 *
 * - `hudMatchPoint(info, state, myTeam)`: the decisive-load prompt model ("이게 들어가면 끝!" /
 *   "막아야 해!", 'tie' loads say "무승부", never a win) from `matchPointInfo` (incl. coin bags).
 * - `PromptLatch`: keeps that prompt up while the announced load lies dropped (knockdown, re-grip)
 *   and nothing changed the arithmetic — presentation only, `matchPointInfo` is unchanged.
 * - `hudSwing(state, myTeam)`: the "역전까지 N · 남은 M" readout from `swingInfo` (counts coins),
 *   shown only after the first bank recovery or once M <= 31.25 % of the total (1000 of 3200).
 * - `momentStamps(moments, ctx)`: which moments become HUD stamps, with which text / tone, merged
 *   ("역전!" + "은행째!" sub-line), at most 2 per tick, priority-ordered. `MomentStamper` adds
 *   cooldowns and stamps "막았다!" only for a match point the prompt actually showed.
 * - `stampEviction`: the 2-stamp column policy (a small callout never pushes out a big stamp).
 * - `BannerQueue`: centre-plate scheduling. Priority final > climax > event > police > other;
 *   never two centre plates at once; the climax plate is compact and turns into a badge after
 *   0.8 s (so it stops being a centre plate); lower priorities wait (and go stale) instead of
 *   covering a higher one.
 *
 * Consumers never re-derive match point / swing / moments: this module only maps the frozen
 * queries (src/sim/queries.ts) and MomentTracker output to presentation.
 */
import { matchPointInfo, swingInfo, type MatchPointInfo } from '../../sim/queries';
import type { EntityId, LootKind, SimState, TeamId } from '../../sim/types';
import type { Moment, MomentKind } from '../../shared/moments';
import type { StampTone } from '../core/juice';
import type { IconName } from '../core/icons';

// ---------------------------------------------------------------------------------------------
// Decisive-load prompt
// ---------------------------------------------------------------------------------------------

/** Decisive-load prompt model (HudModel.matchPoint). */
export interface HudMatchPoint {
  /** Whose match point, from the local player's view. */
  side: 'ours' | 'theirs';
  /** 'win' ends the match with that side ahead; 'tie' ends it level (a draw) — never "승리". */
  kind: 'win' | 'tie';
  /** Points the load adds (bags included). */
  value: number;
  /** What it is: the load's kind, or 'bag' for a coin bag on its own. */
  what: LootKind | 'bag';
  /** Coin bag part of `value` (0 = none). */
  bag: number;
}

type MpState = Pick<SimState, 'loot' | 'characters'>;

/** Prompt model for `info` (null = no prompt). */
export function hudMatchPoint(info: Readonly<MatchPointInfo> | null, state: Readonly<MpState>, myTeam: TeamId): HudMatchPoint | null {
  if (!info) return null;
  let bag = 0;
  for (const id of info.bagCharIds ?? []) bag += state.characters.find((c) => c.id === id)?.bag ?? 0;
  const loadId = info.lootIds[0];
  const loot = loadId === undefined ? undefined : state.loot.find((l) => l.id === loadId);
  return {
    side: info.team === myTeam ? 'ours' : 'theirs',
    kind: info.kind,
    value: info.value,
    what: loot ? loot.kind : 'bag',
    bag: Math.min(bag, info.value),
  };
}

/** i18n keys of the prompt: title + sub-line (sub takes {value}). */
export function matchPointText(mp: Readonly<HudMatchPoint>): { title: string; sub: string } {
  const title = mp.kind === 'tie' ? (mp.side === 'ours' ? 'hud.mp.oursTie' : 'hud.mp.theirsTie') : mp.side === 'ours' ? 'hud.mp.ours' : 'hud.mp.theirs';
  const sub = mp.what === 'bag' ? 'hud.mp.subBag' : mp.bag > 0 ? 'hud.mp.subWithBag' : 'hud.mp.sub';
  return { title, sub };
}

/** Prompt model straight from a state (adapters use this; same arithmetic as checkEnd). */
export function hudMatchPointFromState(state: Readonly<SimState>, myTeam: TeamId, earlyDecision = true): HudMatchPoint | null {
  return hudMatchPoint(matchPointInfo(state, { earlyDecision }), state, myTeam);
}

/**
 * How long (ticks) the prompt stays on a decisive load that was dropped and lies loose: a hauler
 * knocked down (0.7 s), stunned or re-gripping a bank usually picks it up again within ~1-1.5 s
 * (P block: most prompt gaps before an ending were 0.75-1.25 s drops of the very load that then
 * decided it). While it lies there the prompt is still literally true — if that team gets it in,
 * the match is over — so it stays up instead of blinking off and on.
 */
export const LOOSE_HOLD_TICKS = 2 * 60;

/**
 * Keeps the decisive-load prompt on a dropped load (presentation only; `matchPointInfo` and every
 * consumer of it are unchanged). Fed every tick (or every frame) with that tick's
 * `matchPointInfo`; returns what the prompt shows. While the info is null, the last announced
 * loot load is held for up to LOOSE_HOLD_TICKS after it was last decisive, and only while nothing
 * changed the arithmetic: same scores, same remaining value, same load value, the load not
 * recovered / anchored / loaded into a bank / dormant, and nobody of the other team holding it or
 * recovering it. Loads with coin bags are never held (a bag that stops counting has spilled).
 */
export class PromptLatch {
  private held: { info: MatchPointInfo; tick: number; s0: number; s1: number; rem: number; value: number } | null = null;

  update(info: Readonly<MatchPointInfo> | null, state: Readonly<Pick<SimState, 'loot' | 'characters' | 'scores' | 'remainingValue' | 'tick' | 'over'>>): MatchPointInfo | null {
    if (state.over) {
      this.held = null;
      return null;
    }
    if (info) {
      const id = info.lootIds[0];
      const l = id === undefined ? undefined : state.loot.find((x) => x.id === id);
      this.held = l && !info.bagCharIds?.length ? { info: { ...info, carrierIds: [] }, tick: state.tick, s0: state.scores[0], s1: state.scores[1], rem: state.remainingValue, value: l.estimatedValue } : null;
      return info as MatchPointInfo;
    }
    const h = this.held;
    if (!h) return null;
    const l = state.loot.find((x) => x.id === h.info.lootIds[0]);
    const team = h.info.team;
    const ok =
      state.tick >= h.tick &&
      state.tick - h.tick <= LOOSE_HOLD_TICKS &&
      state.scores[0] === h.s0 &&
      state.scores[1] === h.s1 &&
      state.remainingValue === h.rem &&
      !!l &&
      !l.recovered &&
      !l.anchored &&
      l.loadedIn === null &&
      !l.dormant &&
      l.estimatedValue === h.value &&
      !(l.recovery && l.recovery.team !== team) &&
      !l.grabbedBy.some((cid) => {
        const c = state.characters.find((x) => x.id === cid);
        return c !== undefined && c.team !== team;
      });
    if (!ok) {
      this.held = null;
      return null;
    }
    return h.info;
  }

  reset(): void {
    this.held = null;
  }
}

// ---------------------------------------------------------------------------------------------
// Swing readout
// ---------------------------------------------------------------------------------------------

/** "역전까지 N · 남은 M" (HudModel.swing). */
export interface HudSwing {
  /** behind: N = points to take the lead; level: N = points to go ahead; ahead: N = lead. */
  mode: 'behind' | 'level' | 'ahead';
  n: number;
  /** Every point still on the field (loot, loose coins, bags, breakables, pending events). */
  remaining: number;
}

/** Remaining share of the total at which the readout appears without a bank recovered (1000 / 3200). */
export const SWING_SHOW_SHARE = 0.3125;

export function hudSwing(state: Readonly<SimState>, myTeam: TeamId): HudSwing | null {
  if (state.over) return null;
  const total = state.totalValue || 3200;
  if (state.banksRecovered < 1 && state.remainingValue > total * SWING_SHOW_SHARE) return null;
  const s = swingInfo(state, myTeam);
  const mine = state.scores[myTeam];
  const theirs = state.scores[myTeam === 0 ? 1 : 0];
  if (mine > theirs) return { mode: 'ahead', n: mine - theirs, remaining: s.remaining };
  if (mine === theirs) return { mode: 'level', n: s.toLead, remaining: s.remaining };
  return { mode: 'behind', n: s.toLead, remaining: s.remaining };
}

// ---------------------------------------------------------------------------------------------
// Moment stamps
// ---------------------------------------------------------------------------------------------

/** HUD stamp kinds driven by moments (HudStampKind members). */
export type MomentStampKind =
  | 'leadTaken'
  | 'equalized'
  | 'mpStopped'
  | 'streak'
  | 'streakBroken'
  | 'tauntPunished'
  | 'dodged'
  | 'counterDash'
  | 'coinSplash'
  | 'jackpot'
  | 'hammerBonk'
  | 'homeRun'
  | 'goldHammer'
  | 'tossScore'
  | 'craneDrop'
  | 'eventHaul';

export interface StampLook {
  /** Text key when the local team made the play. */
  key: string;
  /** Text key when the other team made it (default: `key`). */
  theirsKey?: string;
  icon: IconName;
  tone: StampTone;
}

export const MOMENT_STAMP_LOOK: Record<MomentStampKind, StampLook> = {
  leadTaken: { key: 'hud.moment.leadTaken', icon: 'swap', tone: 'tomato' },
  equalized: { key: 'hud.moment.equalized', icon: 'swap', tone: 'sky' },
  mpStopped: { key: 'hud.moment.mpStopped', theirsKey: 'hud.moment.mpStoppedTheirs', icon: 'shield', tone: 'mint' },
  streak: { key: 'hud.moment.streak', icon: 'coin', tone: 'sun' },
  streakBroken: { key: 'hud.moment.streakBroken', theirsKey: 'hud.moment.streakBrokenTheirs', icon: 'bolt', tone: 'grape' },
  tauntPunished: { key: 'hud.moment.tauntPunished', icon: 'megaphone', tone: 'tomato' },
  dodged: { key: 'hud.moment.dodged', icon: 'wave', tone: 'mint' },
  counterDash: { key: 'hud.moment.counterDash', icon: 'bolt', tone: 'sun' },
  coinSplash: { key: 'hud.moment.coinSplash', theirsKey: 'hud.moment.coinSplashTheirs', icon: 'coin', tone: 'sun' },
  jackpot: { key: 'hud.moment.jackpot', icon: 'coin', tone: 'sun' },
  hammerBonk: { key: 'hud.moment.hammerBonk', theirsKey: 'hud.moment.hammerBonkTheirs', icon: 'star', tone: 'grape' },
  homeRun: { key: 'hud.moment.homeRun', icon: 'star', tone: 'tomato' },
  goldHammer: { key: 'hud.moment.goldHammer', icon: 'sparkle', tone: 'sun' },
  tossScore: { key: 'hud.moment.tossScore', icon: 'arrow', tone: 'sky' },
  craneDrop: { key: 'hud.moment.craneDrop', icon: 'wrench', tone: 'mint' },
  eventHaul: { key: 'hud.moment.eventHaul', icon: 'gift', tone: 'grape' },
};

/** One stamp to show (Hud.stamp(kind, { team, params, sub })). */
export interface MomentStampSpec {
  kind: MomentStampKind;
  /** Team that made the play (stamp colour + emblem; the text says it too). */
  team: TeamId;
  /** Text key (ours / theirs variant already chosen). */
  key: string;
  params?: Record<string, string | number>;
  /** Optional sub-line text key (e.g. "은행째!" merged into "역전!"). */
  sub?: string;
  /** Higher shows first; ties keep MOMENT_KINDS order. */
  priority: number;
}

export interface MomentStampContext {
  myTeam: TeamId;
  /** Local human (null = spectating): "involved" stamps need the human's team on one side. */
  meId: EntityId | null;
}

/** At most this many moment stamps per tick (the stamp column itself keeps 2 on screen). */
export const MOMENT_STAMPS_PER_TICK = 2;

const other = (t: TeamId): TeamId => (t === 0 ? 1 : 0);

/**
 * Per moment kind: the stamp kind, the acting team (who made the play), whether it needs the
 * local team on one side ('involved') and its priority. Kinds absent here never stamp
 * (matchPointOn = the prompt; stealChance = the world marker; bigPlay = camera / feel).
 */
const RULES: Partial<Record<MomentKind, { stamp: MomentStampKind; actor: (m: Readonly<Moment>) => TeamId; involved?: boolean; priority: number }>> = {
  leadTaken: { stamp: 'leadTaken', actor: (m) => m.team, priority: 10 },
  equalized: { stamp: 'equalized', actor: (m) => m.team, priority: 9 },
  matchPointStopped: { stamp: 'mpStopped', actor: (m) => other(m.team), priority: 9 },
  jackpot: { stamp: 'jackpot', actor: (m) => m.team, priority: 8 },
  craneDrop: { stamp: 'craneDrop', actor: (m) => m.team, priority: 8 },
  goldHammer: { stamp: 'goldHammer', actor: (m) => m.team, priority: 7 },
  eventHaul: { stamp: 'eventHaul', actor: (m) => m.team, priority: 7 },
  homeRun: { stamp: 'homeRun', actor: (m) => m.team, involved: true, priority: 7 },
  streakTier: { stamp: 'streak', actor: (m) => m.team, priority: 6 },
  streakBroken: { stamp: 'streakBroken', actor: (m) => other(m.team), priority: 6 },
  hammerBonk: { stamp: 'hammerBonk', actor: (m) => m.team, involved: true, priority: 5 },
  tossScore: { stamp: 'tossScore', actor: (m) => m.team, priority: 5 },
  coinSplash: { stamp: 'coinSplash', actor: (m) => m.team, involved: true, priority: 4 },
  tauntPunished: { stamp: 'tauntPunished', actor: (m) => m.team, involved: true, priority: 4 },
  counterDash: { stamp: 'counterDash', actor: (m) => m.team, priority: 3 },
  dodged: { stamp: 'dodged', actor: (m) => m.team, priority: 3 },
};

/**
 * Moments of one tick -> the stamps to show (highest priority first, at most
 * MOMENT_STAMPS_PER_TICK). Merges: a lead change / equalizer on a bank recovery gets the
 * "은행째!" sub-line; a run broken by that same recovery is folded into it (one stamp, not two).
 * "Involved" kinds (hammer bonk, home run, coin splash, taunt punish) stamp only when the local
 * team is the actor or the victim (ids[1]) is on the local team.
 */
export function momentStamps(moments: readonly Readonly<Moment>[], ctx: MomentStampContext, teamOf?: (id: EntityId) => TeamId | undefined): MomentStampSpec[] {
  const out: MomentStampSpec[] = [];
  const flip = moments.find((m) => m.kind === 'leadTaken' || m.kind === 'equalized');
  for (const m of moments) {
    const r = RULES[m.kind];
    if (!r) continue;
    const actor = r.actor(m);
    if (r.involved && actor !== ctx.myTeam) {
      const victim = m.ids?.[1];
      const vt = victim === undefined ? undefined : teamOf?.(victim);
      if (vt !== ctx.myTeam) continue;
    }
    // folded into the lead change / equalizer of the same recovery
    if (m.kind === 'streakBroken' && flip && other(m.team) === flip.team) continue;
    const look = MOMENT_STAMP_LOOK[r.stamp];
    const mine = actor === ctx.myTeam;
    const spec: MomentStampSpec = { kind: r.stamp, team: actor, key: mine || !look.theirsKey ? look.key : look.theirsKey, priority: r.priority };
    if (m.value !== undefined) spec.params = { value: m.value };
    if ((m.kind === 'leadTaken' || m.kind === 'equalized') && m.lootKind === 'bank') spec.sub = 'hud.moment.sub.bankWhole';
    if (m.kind === 'streakTier' && m.tier === 2) spec.sub = 'hud.moment.sub.streak2';
    out.push(spec);
  }
  out.sort((a, b) => b.priority - a.priority);
  return out.slice(0, MOMENT_STAMPS_PER_TICK);
}

/**
 * Stamp column slot policy (cap 2 on screen). `liveBig[i]` = the i-th live stamp (oldest first)
 * is a big one (역전! / 동점! / 막았다! / 잭팟 / 크레인). A new stamp pushes out the oldest small
 * stamp; a big one is pushed out only by another big one (the oldest); a small stamp arriving
 * while every live stamp is big is dropped, so routine callouts never cut a lead change short.
 */
export function stampEviction(liveBig: readonly boolean[], incomingBig: boolean, cap = 2): { evict: number | null; drop: boolean } {
  if (liveBig.length < cap) return { evict: null, drop: false };
  const small = liveBig.indexOf(false);
  if (small >= 0) return { evict: small, drop: false };
  return incomingBig ? { evict: 0, drop: false } : { evict: null, drop: true };
}

/**
 * Per-(stamp, team) cooldowns in ticks: a tug-of-war over the last load can stop the same match
 * point again and again (P block: up to 20 "막았다!" in one match); after one stamp the next
 * stop of that team within the window stays silent (the prompt disappearing still says it).
 */
export const MOMENT_STAMP_COOLDOWN_TICKS: Partial<Record<MomentStampKind, number>> = {
  mpStopped: 20 * 60,
  // the golden hammer is dropped and picked up again (knockdowns): the same team re-taking it is
  // not news (v2 P block: up to 3 "황금 뿅망치" stamps a match); the other team taking it still is
  goldHammer: 20 * 60,
  coinSplash: 6 * 60,
  hammerBonk: 4 * 60,
  dodged: 6 * 60,
  counterDash: 6 * 60,
};

/**
 * "막았다!" / "막혔다!" only for a match point the HUD actually prompted: the prompt is the single
 * largest load (`matchPointInfo`), while MomentTracker also follows the other team's own match
 * point, so a stop of a load the player never saw announced would read as coming from nowhere.
 * The stopped team must have held the prompt for at least PROMPT_SEEN_TICKS in a row, ending no
 * more than STOP_AFTER_PROMPT_TICKS before the stop (the tracker confirms a stop 2 s after the
 * load stops being decisive, plus up to 1 s of cause window).
 */
export const PROMPT_SEEN_TICKS = 12;
export const STOP_AFTER_PROMPT_TICKS = 3 * 60;

/** Stateful wrapper of momentStamps with the cooldowns above (one per match; reset on rematch). */
export class MomentStamper {
  private readonly last = new Map<string, number>();
  /** Per team: last tick its prompt had been up for >= PROMPT_SEEN_TICKS in a row. */
  private readonly prompted: [number, number] = [-Infinity, -Infinity];
  private promptTeam: TeamId | null = null;
  private promptRun = 0;

  constructor(private readonly ctx: MomentStampContext) {}

  /**
   * Feed the team whose match point the HUD prompt shows this tick (`matchPointInfo(state).team`,
   * i.e. the MomentTracker snapshot's `matchPoint`), or null. Call every tick before `next`.
   */
  notePrompt(team: TeamId | null, tick: number): void {
    if (team === null) {
      this.promptTeam = null;
      this.promptRun = 0;
      return;
    }
    this.promptRun = team === this.promptTeam ? this.promptRun + 1 : 1;
    this.promptTeam = team;
    if (this.promptRun >= PROMPT_SEEN_TICKS) this.prompted[team] = tick;
  }

  next(moments: readonly Readonly<Moment>[], tick: number, teamOf?: (id: EntityId) => TeamId | undefined): MomentStampSpec[] {
    if (!moments.length) return [];
    const out: MomentStampSpec[] = [];
    const shown = moments.filter((m) => m.kind !== 'matchPointStopped' || tick - this.prompted[m.team] <= STOP_AFTER_PROMPT_TICKS);
    for (const sp of momentStamps(shown, this.ctx, teamOf)) {
      const cd = MOMENT_STAMP_COOLDOWN_TICKS[sp.kind];
      if (cd !== undefined) {
        const k = `${sp.kind}|${sp.team}`;
        const at = this.last.get(k);
        if (at !== undefined && tick - at < cd) continue;
        this.last.set(k, tick);
      }
      out.push(sp);
    }
    return out;
  }

  reset(): void {
    this.last.clear();
    this.prompted[0] = this.prompted[1] = -Infinity;
    this.promptTeam = null;
    this.promptRun = 0;
  }
}

// ---------------------------------------------------------------------------------------------
// Banner queue
// ---------------------------------------------------------------------------------------------

/** Centre-plate priority: final (match over) > climax (final countdown) > event > police > other. */
export type BannerPriority = 'final' | 'climax' | 'event' | 'police' | 'other';

export const BANNER_RANK: Record<BannerPriority, number> = { other: 0, police: 1, event: 2, climax: 3, final: 4 };

/** How long a climax plate stays a centre plate before it shrinks into a badge (ms). */
export const CLIMAX_PLATE_MS = 800;
/** A waiting banner older than this is stale and dropped (ms). */
export const BANNER_MAX_WAIT_MS = 2500;
/** A preempted banner with at least this much life left goes back into the queue (ms). */
export const BANNER_REQUEUE_MIN_MS = 900;

export interface QueuedBanner<T> {
  item: T;
  priority: BannerPriority;
  /** Plate life (ms); a climax plate is clipped to CLIMAX_PLATE_MS (its badge lives on elsewhere). */
  durationMs: number;
}

interface Live<T> extends QueuedBanner<T> {
  startedAt: number;
  endsAt: number;
}

interface Waiting<T> extends QueuedBanner<T> {
  queuedAt: number;
  seq: number;
}

/**
 * Centre-plate scheduler (time injected, so it is unit-testable). `push` / `update` return what
 * changed: `show` = put this plate up now (replacing whatever is up), `hide` = take the current
 * plate down with nothing to replace it. At most one plate is ever up.
 */
export class BannerQueue<T> {
  private live: Live<T> | null = null;
  private waiting: Waiting<T>[] = [];
  private seq = 0;

  get current(): Readonly<QueuedBanner<T>> | null {
    return this.live;
  }

  get pending(): number {
    return this.waiting.length;
  }

  /** Offer a banner at time `now` (ms). */
  push(b: QueuedBanner<T>, now: number): { show: QueuedBanner<T> | null } {
    this.expire(now);
    const rank = BANNER_RANK[b.priority];
    if (b.priority === 'final') this.waiting = [];
    const cur = this.live;
    if (!cur || rank >= BANNER_RANK[cur.priority]) {
      // a higher priority preempts; the same priority replaces (fresher news of the same kind)
      if (cur && rank > BANNER_RANK[cur.priority] && cur.endsAt - now >= BANNER_REQUEUE_MIN_MS && b.priority !== 'final') {
        this.waiting.push({ item: cur.item, priority: cur.priority, durationMs: cur.endsAt - now, queuedAt: now, seq: this.seq++ });
      }
      this.start(b, now);
      return { show: b };
    }
    this.waiting.push({ ...b, queuedAt: now, seq: this.seq++ });
    return { show: null };
  }

  /** Advance to `now`: the current plate may end and the best waiting one comes up. */
  update(now: number): { show: QueuedBanner<T> | null; hide: boolean } {
    if (!this.live || now < this.live.endsAt) return { show: null, hide: false };
    this.live = null;
    this.expire(now);
    if (!this.waiting.length) return { show: null, hide: true };
    this.waiting.sort((a, b) => BANNER_RANK[b.priority] - BANNER_RANK[a.priority] || a.seq - b.seq);
    const next = this.waiting.shift()!;
    const b: QueuedBanner<T> = { item: next.item, priority: next.priority, durationMs: next.durationMs };
    this.start(b, now);
    return { show: b, hide: false };
  }

  /** When the current plate ends (ms), or null. */
  get nextChange(): number | null {
    return this.live ? this.live.endsAt : null;
  }

  clear(): void {
    this.live = null;
    this.waiting = [];
  }

  private start(b: QueuedBanner<T>, now: number): void {
    const life = b.priority === 'climax' ? Math.min(b.durationMs, CLIMAX_PLATE_MS) : b.durationMs;
    this.live = { ...b, startedAt: now, endsAt: now + life };
  }

  private expire(now: number): void {
    this.waiting = this.waiting.filter((w) => now - w.queuedAt <= BANNER_MAX_WAIT_MS);
  }
}
