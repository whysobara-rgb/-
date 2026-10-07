/**
 * Fun / content scorecard: per-match collector (C11, content-plan §8; fun-plan WP1 step 0).
 *
 * Port of the fun-panel scratch tools (`fun/metrics/measure.ts`, `extra.py`, the match-point
 * tracker `fun/moment/exp/mp.py`) into the repo, extended with the Content 2.0 metrics. One
 * `FunCollector` observes one headless match through `runMatch({ onTick })` and returns a compact,
 * JSON-safe `FunRec`; `tools/fun/report.ts` aggregates records into the scorecard.
 *
 * Works for classic and v2 matches, 1v1 and 2v2. In block P the (single) human proxy is the
 * "player" whose experience is measured; in blocks without a proxy the per-character numbers are
 * averaged over every character.
 *
 * Definitions (content-plan §8):
 * - first action: the proxy's first coin pickup, breakable / prop hit, uproot-progress start
 *   (straining on anchored loot) or item pickup;
 * - first score: the proxy's first recovery (holder, or last holder of a holder-less recovery) or
 *   coin deposit;
 * - dead time (payoff): share of match time in stretches > 8 s without a payoff event involving
 *   the proxy (loot grab / coin or item pickup, hit given or received, uproot progress, deposit,
 *   recovery, item use, gimmick use); dead time (classic, fun plan): stretches > 8 s neither holding
 *   nor contested (an opponent or officer within 4 m) — reported alongside for continuity;
 * - drama events: coin bursts >= 20, item hits on characters / police, KOs (dash or item),
 *   steals, toss / tube / crane launches, recoveries >= 200, event opens and jackpots.
 */
import { TICK_RATE } from '../../src/sim/config';
import { matchPointInfo } from '../../src/sim/queries';
import type { Simulation } from '../../src/sim/sim';
import type { EntityId, SimEvent, TeamId } from '../../src/sim/types';
import type { MatchStats } from '../../src/ai/harness';

/** An opponent or an officer this close = contested (classic dead-time definition). */
const CONTEST_R = 4;
/** Dead stretch threshold (s). */
const DEAD_S = 8;
/** Drop contested: both teams within this distance of the pickup. */
const DROP_CONTEST_R = 6;
/** gimmick `what` values that launch something (toss / tube / crane). */
const LAUNCH_WHAT = new Set(['launch', 'toss', 'tubeIn', 'enter', 'lift', 'hoist', 'fling']);

/** Value source a point came from (points-by-source; content-plan §8 shares). */
export type Source = 'smallSafe' | 'largeSafe' | 'bank' | 'atm' | 'piggy' | 'moneyTree' | 'breakable' | 'event';
export const SOURCES: readonly Source[] = ['bank', 'largeSafe', 'smallSafe', 'atm', 'piggy', 'moneyTree', 'breakable', 'event'];

/** Verbs the proxy can use (content-plan §8 "distinct verbs"). */
export const VERBS = ['grab', 'carry', 'dashHit', 'smash', 'tugSpurt', 'kick', 'scoop', 'deposit', 'item', 'gimmick'] as const;
export type Verb = (typeof VERBS)[number];

export interface DeadStats {
  stretches: number;
  seconds: number;
  longest: number;
}

/** One scored event: [tick, team, value, source key, proxy involved 0/1, is coin deposit 0/1]. */
export type ScoreRow = [number, number, number, string, number, number];

export interface CharRec {
  id: EntityId;
  team: TeamId;
  isBot: boolean;
  label: string;
  /** Item pickups / of which used (>= 1 fire) before the item was lost (expired, dropped, match end). */
  itemPickups: number;
  itemPickupsUsed: number;
  /** Item uses (fire) and ticks holding an item. */
  itemUses: number;
  itemHeldTicks: number;
  /** Hammer / golden-hammer knockdowns dealt on characters: total / on the proxy / on bots. */
  hammerKos: number;
  hammerKosOnProxy: number;
  hammerKosOnBots: number;
  /** Gimmick uses (gimmick events listing this character). */
  gimmickUses: number;
  heldHammer: boolean;
  gotGoldHammer: boolean;
  dead: DeadStats;
  deadPayoff: DeadStats;
  firstActionTick: number | null;
  firstScoreTick: number | null;
  verbs: Verb[];
  sources: Source[];
  points: number;
}

export interface FunRec {
  id: number;
  block: string;
  group: string;
  variant: string;
  layout: string;
  seed: number;
  aTeam: number;
  content: 'classic' | 'v2';
  endTick: number;
  reason: string;
  winner: number | null;
  scores: [number, number];
  totalValue: number;
  rec: ScoreRow[];
  /** Points by source, both teams. */
  pointsBySource: Record<string, number>;
  /** Coin points (deposits), both teams; event-origin coin points. */
  coinPoints: number;
  ev: Record<string, number>;
  evProxy: Record<string, number>;
  chars: CharRec[];
  proxyId: EntityId | null;
  fcTick: number | null;
  /** remainingValue the tick the final countdown started (value on the field). */
  valueAtFc: number | null;
  firstBankTick: number | null;
  secondBankTick: number | null;
  /** Match-point intervals [team, startTick, endTick] (matchPointInfo, i.e. what the HUD shows). */
  mp: [number, number, number][];
  /** Team that made the first item pickup (null = none). */
  firstDropTeam: number | null;
  /** Sim step time median / p95 (ms). */
  stepMsMed: number;
  stepMsP95: number;
  invariantViolations: number;
  error?: string;
}

type Comp = Partial<Record<Source, number>>;

function addComp(into: Comp, c: Comp, scale: number): void {
  for (const k of Object.keys(c) as Source[]) into[k] = (into[k] ?? 0) + c[k]! * scale;
}
function compTotal(c: Comp): number {
  let s = 0;
  for (const k of Object.keys(c) as Source[]) s += c[k]!;
  return s;
}

export interface CollectorInfo {
  id: number;
  block: string;
  group: string;
  variant: string;
  layout: string;
  seed: number;
  aTeam: number;
}

/**
 * Per-match observer. Pass `onTick` to `runMatch`, then call `finish(stats)`.
 */
export class FunCollector {
  private sim: Simulation | null = null;
  private n = 0;
  private proxyId: EntityId | null = null;
  private readonly rec: ScoreRow[] = [];
  private readonly ev: Record<string, number> = {};
  private readonly evP: Record<string, number> = {};
  private chars: CharRec[] = [];
  private readonly deadRun: number[] = [];
  private readonly payRun: number[] = [];
  private readonly payoffThisTick = new Set<EntityId>();
  private readonly carryTicks: number[] = [];
  private readonly verbs: Set<Verb>[] = [];
  private readonly sources: Set<Source>[] = [];
  private readonly lastHolder = new Map<EntityId, EntityId>();
  /** Loot id -> source (props by variant). */
  private readonly lootSource = new Map<EntityId, Source>();
  /** Coin pile id -> value composition by origin. */
  private readonly pileComp = new Map<EntityId, Comp>();
  /** Coin pile id -> team whose bag spilled it (spill re-take metric). */
  private readonly spillTeam = new Map<EntityId, TeamId>();
  /** Character id -> bag composition by origin (value). */
  private readonly bagComp = new Map<EntityId, Comp>();
  /** Item pickup bookkeeping: char id -> used since pickup. */
  private readonly holding = new Map<EntityId, { used: boolean }>();
  private readonly pointsBySource: Record<string, number> = {};
  private coinPoints = 0;
  private fcTick: number | null = null;
  private valueAtFc: number | null = null;
  private firstBankTick: number | null = null;
  private secondBankTick: number | null = null;
  private readonly mpOn: [boolean, boolean] = [false, false];
  private readonly mpStart: [number, number] = [0, 0];
  private readonly mp: [number, number, number][] = [];
  private firstDropTeam: number | null = null;
  private readonly stepMs: number[] = [];
  private lastTick = 0;
  private content: 'classic' | 'v2' = 'classic';

  constructor(private readonly info: CollectorInfo) {}

  private inc(o: Record<string, number>, k: string, x = 1): void {
    o[k] = (o[k] ?? 0) + x;
  }

  private init(sim: Simulation): void {
    this.sim = sim;
    const st = sim.state;
    this.content = sim.rules.content === 'v2' ? 'v2' : 'classic';
    this.n = st.characters.length;
    const proxy = st.characters.filter((c) => !c.isBot);
    this.proxyId = proxy.length === 1 ? proxy[0]!.id : proxy.length > 1 ? proxy[0]!.id : null;
    this.chars = st.characters.map((c) => ({
      id: c.id,
      team: c.team,
      isBot: c.isBot,
      label: c.name,
      itemPickups: 0,
      itemPickupsUsed: 0,
      itemUses: 0,
      itemHeldTicks: 0,
      hammerKos: 0,
      hammerKosOnProxy: 0,
      hammerKosOnBots: 0,
      gimmickUses: 0,
      heldHammer: false,
      gotGoldHammer: false,
      dead: { stretches: 0, seconds: 0, longest: 0 },
      deadPayoff: { stretches: 0, seconds: 0, longest: 0 },
      firstActionTick: null,
      firstScoreTick: null,
      verbs: [],
      sources: [],
      points: 0,
    }));
    for (let i = 0; i < this.n; i++) {
      this.deadRun.push(0);
      this.payRun.push(0);
      this.carryTicks.push(0);
      this.verbs.push(new Set());
      this.sources.push(new Set());
    }
    for (const l of st.loot) this.lootSource.set(l.id, this.sourceOfLoot(l.kind, l.variant ?? null));
    // time sim.step from now on (tick 1 is already stepped; one sample short is fine)
    const step = sim.step.bind(sim);
    const now = typeof performance !== 'undefined' ? (): number => performance.now() : (): number => Date.now();
    (sim as { step: Simulation['step'] }).step = (cmds) => {
      const t0 = now();
      const r = step(cmds);
      this.stepMs.push(now() - t0);
      return r;
    };
  }

  private sourceOfLoot(kind: string, variant: string | null): Source {
    if (variant === 'atm' || variant === 'piggy' || variant === 'moneyTree') return variant;
    if (variant === 'goldSafe') return 'event';
    if (kind === 'bank') return 'bank';
    if (kind === 'largeSafe') return 'largeSafe';
    return 'smallSafe';
  }

  private slotOf(id: EntityId | null | undefined): number {
    return id !== null && id !== undefined && id >= 1 && id <= this.n ? id - 1 : -1;
  }

  private verb(id: EntityId | null | undefined, v: Verb): void {
    const s = this.slotOf(id);
    if (s >= 0) this.verbs[s]!.add(v);
  }

  private payoff(id: EntityId | null | undefined): void {
    if (id !== null && id !== undefined && this.slotOf(id) >= 0) this.payoffThisTick.add(id);
  }

  private firstAction(id: EntityId | null | undefined, tick: number): void {
    const s = this.slotOf(id);
    if (s >= 0 && this.chars[s]!.firstActionTick === null) this.chars[s]!.firstActionTick = tick;
  }

  private firstScore(id: EntityId, tick: number): void {
    const s = this.slotOf(id);
    if (s >= 0 && this.chars[s]!.firstScoreTick === null) this.chars[s]!.firstScoreTick = tick;
  }

  private isProxy(id: EntityId | null | undefined): boolean {
    return id !== null && id !== undefined && id === this.proxyId;
  }

  private teamOf(id: EntityId): TeamId | null {
    const s = this.slotOf(id);
    return s >= 0 ? this.chars[s]!.team : null;
  }

  /** runMatch onTick hook. */
  readonly onTick = (sim: Simulation, events: SimEvent[]): void => {
    if (!this.sim) this.init(sim);
    const st = sim.state;
    this.lastTick = st.tick;
    this.payoffThisTick.clear();
    const proxyTeam = this.proxyId !== null ? this.teamOf(this.proxyId) : null;
    for (const e of events) this.onEvent(sim, e, proxyTeam);
    // per-tick engagement
    for (let i = 0; i < this.n; i++) {
      const ch = st.characters[i]!;
      const c = this.chars[i]!;
      const holding = ch.grab !== null || ch.straining;
      let near = ch.knockdownTicks > 0;
      if (!near)
        for (const o of st.characters)
          if (o.team !== ch.team && Math.hypot(o.pos.x - ch.pos.x, o.pos.y - ch.pos.y) <= CONTEST_R) {
            near = true;
            break;
          }
      if (!near)
        for (const o of st.police)
          if (Math.hypot(o.pos.x - ch.pos.x, o.pos.y - ch.pos.y) <= CONTEST_R) {
            near = true;
            break;
          }
      if (holding || near) this.closeDead(c.dead, this.deadRun, i);
      else this.deadRun[i]!++;
      // uproot progress = straining on anchored loot
      if (ch.straining && ch.grab) {
        const l = sim.getLoot(ch.grab.targetId);
        if (l && l.anchored) {
          this.payoffThisTick.add(ch.id);
          this.firstAction(ch.id, st.tick);
        }
      }
      if (ch.grab) {
        const l = sim.getLoot(ch.grab.targetId);
        if (l && !l.anchored) {
          this.carryTicks[i]!++;
          if (this.carryTicks[i]! === TICK_RATE) this.verbs[i]!.add('carry');
        }
      }
      if (this.payoffThisTick.has(ch.id)) this.closeDead(c.deadPayoff, this.payRun, i);
      else this.payRun[i]!++;
      if (ch.item) {
        c.itemHeldTicks++;
        if (ch.item.kind === 'hammer' || ch.item.kind === 'goldHammer') c.heldHammer = true;
        if (ch.item.kind === 'goldHammer') c.gotGoldHammer = true;
      }
    }
    // match point (what the HUD shows: matchPointInfo, same arithmetic as checkEnd)
    const mpi = st.over ? null : matchPointInfo(st, { earlyDecision: sim.rules.earlyDecision });
    for (const t of [0, 1] as TeamId[]) {
      const on = mpi !== null && mpi.team === t;
      if (on && !this.mpOn[t]) {
        this.mpOn[t] = true;
        this.mpStart[t] = st.tick;
      } else if (!on && this.mpOn[t]) {
        this.mpOn[t] = false;
        this.mp.push([t, this.mpStart[t], st.tick]);
      }
    }
  };

  private closeDead(d: DeadStats, run: number[], i: number): void {
    const s = run[i]! / TICK_RATE;
    if (s > DEAD_S) {
      d.stretches++;
      d.seconds += s;
      d.longest = Math.max(d.longest, s);
    }
    run[i] = 0;
  }

  private onEvent(sim: Simulation, e: SimEvent, proxyTeam: TeamId | null): void {
    const st = sim.state;
    const P = this.proxyId;
    switch (e.type) {
      case 'grab': {
        this.lastHolder.set(e.targetId, e.charId);
        this.payoff(e.charId);
        this.verb(e.charId, 'grab');
        break;
      }
      case 'recovered': {
        let holders = e.holders.filter((h) => this.teamOf(h) === e.team);
        if (!holders.length) {
          const lh = this.lastHolder.get(e.lootId);
          if (lh !== undefined && this.teamOf(lh) === e.team) holders = [lh];
        }
        const src = e.variant ? this.sourceOfLoot(e.kind, e.variant) : (this.lootSource.get(e.lootId) ?? this.sourceOfLoot(e.kind, null));
        const pInv = P !== null && holders.includes(P) ? 1 : 0;
        this.rec.push([e.tick, e.team, e.value, src, pInv, 0]);
        this.inc(this.pointsBySource, src, e.value);
        for (const h of holders) {
          this.payoff(h);
          this.firstScore(h, e.tick);
          const s = this.slotOf(h);
          if (s >= 0) {
            this.sources[s]!.add(src);
            this.chars[s]!.points += e.value / holders.length;
          }
        }
        if (e.value >= 200) {
          this.inc(this.ev, 'rec200');
          if (pInv) this.inc(this.evP, 'rec200');
        }
        break;
      }
      case 'safeUnloaded':
        if (e.byCharId !== null) {
          const by = this.teamOf(e.byCharId);
          if (e.bankCarrierTeam !== null && e.bankCarrierTeam !== by) {
            this.inc(this.ev, 'steal');
            if (e.byCharId === P) this.inc(this.evP, 'steal');
            else if (e.bankCarrierTeam === proxyTeam) this.inc(this.evP, 'stolenFrom');
          } else {
            this.inc(this.ev, 'strip');
            if (e.byCharId === P) this.inc(this.evP, 'strip');
          }
          this.payoff(e.byCharId);
        }
        break;
      case 'policeTackle':
        if (e.hit) {
          this.inc(this.ev, 'tackle');
          if (e.victimId === P) this.inc(this.evP, 'tackled');
          this.payoff(e.victimId);
        }
        break;
      case 'policeStunned':
        this.inc(this.ev, 'stun');
        if (e.byCharId === P) this.inc(this.evP, 'stun');
        this.payoff(e.byCharId);
        this.verb(e.byCharId, 'dashHit');
        break;
      case 'dashHit':
        this.payoff(e.attackerId);
        this.payoff(e.victimId);
        this.verb(e.attackerId, 'dashHit');
        if (e.knockdown) {
          this.inc(this.ev, 'ko');
          this.inc(this.ev, 'koDash');
          if (e.attackerId === P) this.inc(this.evP, 'koDealt');
          if (e.victimId === P) this.inc(this.evP, 'koTaken');
        }
        break;
      case 'fenceBroken': {
        this.inc(this.ev, 'fence');
        const b = e.bankId >= 0 ? sim.getLoot(e.bankId) : undefined;
        if ((b && P !== null && b.grabbedBy.includes(P)) || (e.byCharId !== undefined && e.byCharId === P)) this.inc(this.evP, 'fence');
        break;
      }
      case 'recoveryCancel':
        this.inc(this.ev, 'recoveryCancel');
        break;
      case 'release':
        if (e.forced) {
          const l = sim.getLoot(e.targetId);
          if (l && l.kind === 'bank' && !l.anchored) {
            this.inc(this.ev, 'bankHaulBroken');
            if (e.charId === P) this.inc(this.evP, 'bankHaulBroken');
          }
        }
        break;
      case 'policeDispatched':
        this.inc(this.ev, 'wave');
        break;
      case 'bankBodyRecovered':
        if (e.count === 1) this.firstBankTick = e.tick;
        else if (e.count === 2) this.secondBankTick = e.tick;
        break;
      case 'finalCountdown':
        if (this.fcTick === null) {
          this.fcTick = e.tick;
          this.valueAtFc = st.remainingValue;
        }
        break;
      // --- Content 2.0 ---
      case 'coinSpawn': {
        // pile composition = origin mix per point of value (fractions summing to 1)
        let comp: Comp = { breakable: 1 };
        if (e.source === 'spill') {
          const victim = typeof e.sourceId === 'number' ? e.sourceId : null;
          const bc = victim !== null ? this.bagComp.get(victim) : undefined;
          const tot = bc ? compTotal(bc) : 0;
          if (bc && tot > 0) {
            // the spilled share of the victim's bag keeps its origin mix
            comp = {};
            addComp(comp, bc, 1 / tot);
            addComp(bc, bc, -Math.min(1, e.total / tot));
          }
          const vt = victim !== null ? this.teamOf(victim) : null;
          if (vt !== null) for (const id of e.ids) this.spillTeam.set(id, vt);
        } else {
          let src: Source = 'breakable';
          if (e.source === 'rain' || e.source === 'truck') src = 'event';
          else if (e.source === 'spurt' || e.source === 'bonk' || e.source === 'shed' || e.source === 'smash') {
            src = typeof e.sourceId === 'number' ? (this.lootSource.get(e.sourceId) ?? 'atm') : 'atm';
          }
          comp = { [src]: 1 } as Comp;
          if (e.source === 'spurt') this.verb(e.byCharId, 'tugSpurt');
        }
        for (const id of e.ids) this.pileComp.set(id, comp);
        if (e.total >= 20) {
          this.inc(this.ev, 'coinBurst');
          if (this.isProxy(e.byCharId) || (e.source === 'spill' && this.isProxy(e.sourceId as EntityId))) this.inc(this.evP, 'coinBurst');
        }
        if (e.source !== 'spill' && e.byCharId !== null) {
          this.payoff(e.byCharId);
          this.firstAction(e.byCharId, e.tick);
        }
        break;
      }
      case 'coinPickup': {
        this.payoff(e.charId);
        this.firstAction(e.charId, e.tick);
        this.verb(e.charId, 'scoop');
        const per = this.pileComp.get(e.coinId) ?? { breakable: 1 };
        this.pileComp.delete(e.coinId);
        const bc = this.bagComp.get(e.charId) ?? {};
        addComp(bc, per, e.value);
        this.bagComp.set(e.charId, bc);
        const vt = this.spillTeam.get(e.coinId);
        if (vt !== undefined) {
          const pt = this.teamOf(e.charId);
          if (pt !== null && pt !== vt) {
            this.inc(this.ev, 'spillRetaken', e.value);
            this.inc(this.ev, 'spillRetakenN');
            if (e.charId === P) this.inc(this.evP, 'spillRetaken', e.value);
          }
        }
        this.inc(this.ev, 'coinPickups');
        break;
      }
      case 'coinsBanked': {
        this.payoff(e.charId);
        this.firstScore(e.charId, e.tick);
        this.verb(e.charId, 'deposit');
        const s = this.slotOf(e.charId);
        if (s >= 0) this.chars[s]!.points += e.value;
        const bc = this.bagComp.get(e.charId) ?? {};
        const tot = compTotal(bc);
        const pInv = e.charId === P ? 1 : 0;
        this.coinPoints += e.value;
        // split the deposit by origin (proportional to the bag's mix)
        const k = tot > 0 ? e.value / tot : 0;
        let main: Source = 'breakable';
        let best = -1;
        for (const src of Object.keys(bc) as Source[]) {
          const v = bc[src]! * k;
          this.inc(this.pointsBySource, `coins:${src}`, v);
          if (bc[src]! > best) {
            best = bc[src]!;
            main = src;
          }
        }
        if (tot <= 0) this.inc(this.pointsBySource, 'coins:breakable', e.value);
        this.bagComp.set(e.charId, {});
        this.rec.push([e.tick, e.team, e.value, `coins:${main}`, pInv, 1]);
        if (s >= 0) this.sources[s]!.add(main);
        if (e.value >= 50) this.inc(this.ev, 'deposit50');
        this.inc(this.ev, 'deposits');
        break;
      }
      case 'bagSpilled':
        this.inc(this.ev, 'spill');
        this.inc(this.ev, 'spillValue', e.value);
        if (e.charId === P) this.inc(this.evP, 'spillTaken');
        if (e.byId === P) this.inc(this.evP, 'spillCaused');
        break;
      case 'breakableHit':
        this.payoff(e.byCharId);
        this.firstAction(e.byCharId, e.tick);
        if (e.byCharId !== null) {
          const ch = sim.getCharacter(e.byCharId);
          if (!ch?.item || ch.item.phase !== 'active') this.verb(e.byCharId, 'dashHit');
        }
        break;
      case 'breakableBroken':
        this.payoff(e.byCharId);
        this.verb(e.byCharId, 'smash');
        this.inc(this.ev, 'breakablesBroken');
        break;
      case 'propHit': {
        this.payoff(e.byCharId);
        if (e.how === 'dash' || e.how === 'hammer' || e.how === 'plunger') this.firstAction(e.byCharId, e.tick);
        const src = this.lootSource.get(e.lootId);
        if (e.how === 'dash') this.verb(e.byCharId, src === 'piggy' ? 'kick' : 'dashHit');
        break;
      }
      case 'piggyCrack':
        this.payoff(e.byCharId);
        if (e.smashed) {
          this.inc(this.ev, 'jackpot');
          this.verb(e.byCharId, 'smash');
          if (e.byCharId === P) this.inc(this.evP, 'jackpot');
        }
        break;
      case 'itemPickup': {
        this.payoff(e.charId);
        this.firstAction(e.charId, e.tick);
        const s = this.slotOf(e.charId);
        if (s >= 0) this.chars[s]!.itemPickups++;
        this.holding.set(e.charId, { used: false });
        this.inc(this.ev, 'itemPickups');
        if (this.firstDropTeam === null) this.firstDropTeam = this.teamOf(e.charId);
        // contested: both teams within 6 m of the pickup
        const me = sim.getCharacter(e.charId);
        if (me) {
          const opp = st.characters.some((o) => o.team !== me.team && Math.hypot(o.pos.x - me.pos.x, o.pos.y - me.pos.y) <= DROP_CONTEST_R);
          if (opp) this.inc(this.ev, 'dropsContested');
        }
        if (e.kind === 'goldHammer') this.inc(this.ev, 'goldHammerPickups');
        break;
      }
      case 'itemUse':
        if (e.phase === 'fire') {
          this.payoff(e.charId);
          this.verb(e.charId, 'item');
          const s = this.slotOf(e.charId);
          if (s >= 0) this.chars[s]!.itemUses++;
          const h = this.holding.get(e.charId);
          if (h) h.used = true;
          this.inc(this.ev, 'itemUses');
        }
        break;
      case 'itemDropped':
      case 'itemExpired':
        if (e.charId !== null) this.closeHolding(e.charId);
        break;
      case 'itemHit': {
        this.payoff(e.charId);
        if (e.target === 'char' || e.target === 'police') {
          this.inc(this.ev, 'itemHitChar');
          if (e.charId === P || e.targetId === P) this.inc(this.evP, 'itemHitChar');
        }
        if (e.target === 'char' && typeof e.targetId === 'number') {
          this.payoff(e.targetId);
          if (e.knockdown) {
            this.inc(this.ev, 'ko');
            if (e.kind === 'hammer' || e.kind === 'goldHammer') {
              this.inc(this.ev, 'hammerKo');
              const s = this.slotOf(e.charId);
              if (s >= 0) {
                const c = this.chars[s]!;
                c.hammerKos++;
                if (e.targetId === P) c.hammerKosOnProxy++;
                else if (this.chars[this.slotOf(e.targetId)]?.isBot) c.hammerKosOnBots++;
              }
            }
            if (e.charId === P) this.inc(this.evP, 'koDealt');
            if (e.targetId === P) this.inc(this.evP, 'koTaken');
          }
        }
        break;
      }
      case 'gimmick': {
        const ids = e.ids ?? [];
        for (const id of ids) {
          const s = this.slotOf(id);
          if (s >= 0) {
            this.chars[s]!.gimmickUses++;
            this.payoff(id);
            this.verb(id, 'gimmick');
          }
        }
        if (LAUNCH_WHAT.has(e.what)) {
          this.inc(this.ev, 'launch');
          if (P !== null && ids.includes(P)) this.inc(this.evP, 'launch');
        }
        this.inc(this.ev, `gimmick:${e.what}`);
        break;
      }
      case 'matchEvent':
        if (e.phase === 'open') {
          this.inc(this.ev, 'eventOpen');
        }
        if (e.phase === 'start') this.inc(this.ev, `event:${e.kind}`);
        break;
      default:
        break;
    }
  }

  private closeHolding(charId: EntityId): void {
    const h = this.holding.get(charId);
    if (!h) return;
    const s = this.slotOf(charId);
    if (s >= 0 && h.used) this.chars[s]!.itemPickupsUsed++;
    this.holding.delete(charId);
  }

  finish(stats: MatchStats): FunRec {
    for (let i = 0; i < this.n; i++) {
      const c = this.chars[i]!;
      this.closeDead(c.dead, this.deadRun, i);
      this.closeDead(c.deadPayoff, this.payRun, i);
      c.verbs = VERBS.filter((v) => this.verbs[i]!.has(v));
      c.sources = SOURCES.filter((s) => this.sources[i]!.has(s));
    }
    for (const id of [...this.holding.keys()]) this.closeHolding(id);
    for (const t of [0, 1] as TeamId[]) if (this.mpOn[t]) this.mp.push([t, this.mpStart[t], this.lastTick + 1]);
    const sm = [...this.stepMs].sort((a, b) => a - b);
    const q = (p: number): number => (sm.length ? sm[Math.min(sm.length - 1, Math.floor((sm.length - 1) * p))]! : 0);
    const st = this.sim?.state;
    const r = (x: number): number => Math.round(x * 100) / 100;
    for (const k of Object.keys(this.pointsBySource)) this.pointsBySource[k] = r(this.pointsBySource[k]!);
    for (const c of this.chars) {
      c.points = r(c.points);
      c.dead = { stretches: c.dead.stretches, seconds: r(c.dead.seconds), longest: r(c.dead.longest) };
      c.deadPayoff = { stretches: c.deadPayoff.stretches, seconds: r(c.deadPayoff.seconds), longest: r(c.deadPayoff.longest) };
    }
    return {
      ...this.info,
      content: this.content,
      endTick: stats.result.endTick ?? stats.ticks,
      reason: stats.result.reason,
      winner: stats.result.winner,
      scores: [stats.teamScores[0], stats.teamScores[1]],
      totalValue: st?.totalValue ?? 0,
      rec: this.rec,
      pointsBySource: this.pointsBySource,
      coinPoints: this.coinPoints,
      ev: this.ev,
      evProxy: this.evP,
      chars: this.chars,
      proxyId: this.proxyId,
      fcTick: this.fcTick,
      valueAtFc: this.valueAtFc,
      firstBankTick: this.firstBankTick,
      secondBankTick: this.secondBankTick,
      mp: this.mp,
      firstDropTeam: this.firstDropTeam,
      stepMsMed: r(q(0.5) * 1000) / 1000,
      stepMsP95: r(q(0.95) * 1000) / 1000,
      invariantViolations: stats.invariantViolations,
    };
  }
}
