/**
 * MomentTracker (fun round contract, docs/ARCHITECTURE.md "Fun round contracts"; owner WP5 / F5).
 *
 *   const tracker = new MomentTracker({ localTeam: 0, localCharId: meId });
 *   const events = sim.step(cmds);
 *   const moments = tracker.observe(sim.state, events, botIntents);   // once per tick, after step
 *   const snap = tracker.snapshot();                                  // continuous state
 *
 * Per-tick wiring in match.ts (MatchController.stepOnce, see docs/ARCHITECTURE.md):
 *   `funObserve` (WP5): observe -> feel (glance / slow-mo / hit-stop), view.onMoments,
 *   view.setDecisiveLoad / setStealChance / setRunHeat / setBotWindup / showBark from the
 *   snapshot and intents, director.setTension + director.onMoments — all BEFORE
 *   director.onEvents of the same tick, so the coin climb already sees this tick's run.
 *   `funHud` (WP4): the same moments + snapshot -> HUD stamps, match-point prompt, crown, banners.
 *
 * Pure and deterministic: the same (state, events, intents) sequence always yields the same
 * moments; no wall clock, no Math.random, no DOM. Match point itself comes from
 * `matchPointInfo` (src/sim/queries.ts) — the tracker turns its on/off edges into moments.
 *
 * Moments are EDGES (something happened this tick). Things that are shown WHILE they last
 * (decisive-load glow, steal marker, scoring-run heat, heartbeat, crown) come from `snapshot()`,
 * so no consumer has to work out on its own when such a state ends (a run expiring after a
 * 25 s gap, a steal chance closing, ...).
 *
 * Rules (fun-plan WP5 + content-plan §4.5; every number is in MOMENT_RULES):
 * - leadTaken: the strict leader after this tick's settlements differs from the last strict
 *   leader (a flip, possibly through a level score: exactly the scorecard's "lead changes").
 *   equalized: the scores become level (> 0) from not level. Read from `state.scores`, so loot
 *   recoveries and coin deposits count alike (same-tick batch, doc §8).
 * - matchPointOn / matchPointStopped: one episode per team. A team's match point (from
 *   `matchPointInfo`; for the team it does not name, `matchPointInfo` over that team's holders /
 *   zone only) held for >= `mpOnTicks` starts its episode; it ends silently when the match ends
 *   or the load is recovered, and as `matchPointStopped` when it stays gone for `mpStopTicks`
 *   while the match goes on.
 * - Scoring runs ("unanswered"): a recovery, or a deposit >= `runDepositMin`, extends the scoring
 *   team's run and answers (ends) the other team's; a run lapses silently `runGapTicks` after its
 *   latest recovery. Tier 1 at `runTier1Recoveries` (4) recoveries, or `runTier1Share` x
 *   totalValue points over >= `runTier1MinRecoveries` (3); tier 2 at `runTier2Share` x totalValue
 *   points over >= `runTier2MinRecoveries` (2) (classic 3200: 800 / 1000; v2 4000: 1000 / 1240).
 *   One loaded bank alone is a big recovery, not a run. Tuned on the P block (n = 180) to the
 *   fun-plan target of tier 1 in 30-40 % / tier 2 in 15-25 % of matches (the plan's "three in a
 *   row or 800 / 1000" measured 69 % / 34 %). `streakTier` on every tier rise, `streakBroken`
 *   when a run with a tier is answered.
 * - bigPlay (rating >= `bigPlayMin`, at most `bigPlayMax` per match, `bigPlayCooldownTicks`
 *   apart; the best candidate of the tick wins):
 *     steal from a moving bank            v/100 + 2   (also carried by that safe, see below)
 *     KO on a carrier (dash or hammer)     v/100 + 1.5, or v/100 + 3 on a bank hauler
 *       + hammer KO on a bank hauler 4, + home run 3           (v = victim's held value + bag)
 *     piggy / truck jackpot                v/100 + 3
 *     crane cat stunned mid-swing          v/100 + 4   (v = the bank's value)
 *     recovery                             v/200 + what the load carries (its steal rating; a
 *       bank: +4 per fence it broke) + bank taken over from the rival's haul 3 + lead-flipping 3
 *       + <= 15 s left 4   (v/200: a routine loaded-bank recovery is not a big play by itself,
 *       a stolen large safe brought home is; P block: 1 human-involved big play per match)
 * - stealChance (local human only): an opponent hauls a bank that still holds safes and one of
 *   its doors is open (outside point free, no opponent body-blocking it) and <= 20 m from the
 *   human or on screen (`onScreen` option). The single best door = nearest, then larger value.
 *   The moment fires when a chance opens for a bank (again after `stealReopenTicks` closed).
 * - tauntPunished: `emoteCancel` cause 'hit' with `hitBy` an opposing character.
 * - dodged: a bot wind-up targeting the human (`BotIntent.phase === 'windup'`) is cancelled or
 *   its dash misses, while the human moved >= 1 m sideways of the wind-up line.
 * - counterDash: a head-on dash clash (dashHit pair A->B and B->A, no knockdown) or a hammer
 *   clash (`itemClash`) involving the human.
 * - Content 2.0: coinSplash (spill >= 60 caused by an opposing character), jackpot (piggy
 *   smashed / truck opened, with an actor), hammerBonk (hammer KO on a carrier or a bag >= 100),
 *   homeRun (`itemHit.homeRun`), goldHammer (picked up), tossScore (catapult- / tube-flown loot
 *   recovered <= 6 s after landing), craneDrop (crane cat stunned while a bank hangs),
 *   eventHaul (a team recovered >= 200 of the loot event's value: gold safe, rain / truck coins
 *   deposited from the bag).
 */
import type { BotIntent } from '../ai/types';
import { BANK_MODEL, DASH, TICK_RATE } from '../sim/config';
import { matchPointInfo, type MatchPointInfo } from '../sim/queries';
import type { CharacterState, EntityId, LootKind, LootState, SimEvent, SimState, TeamId, Vec2 } from '../sim/types';
import { MOMENT_KINDS, type Moment, type MomentKind, type StreakTier } from '../shared/moments';

export type { Moment, MomentKind, StreakTier } from '../shared/moments';
export { MOMENT_KINDS } from '../shared/moments';

/** One bot's intent this tick (from `BotController.intent()`), keyed by its character id. */
export interface BotIntentSample {
  charId: EntityId;
  intent: BotIntent;
}

export interface MomentTrackerOptions {
  /** Team of the local human (stealChance, dodged and counterDash are about the human). */
  localTeam: TeamId;
  /** Character id of the local human (null = spectating / bot-only harness). */
  localCharId: EntityId | null;
  /** Mirror of RuleConfig.earlyDecision for matchPointInfo (default true). */
  earlyDecision?: boolean;
  /**
   * (add-only, F5) Is this ground point free for a raccoon (e.g. `p => sim.isFree(p, 0.45)`)?
   * Used to tell an open bank door from one pressed against a wall. Absent = every door open.
   */
  isFree?: (p: Vec2) => boolean;
  /**
   * (add-only, F5) Is this ground point on screen (e.g. `GameView.project(p).onScreen`)? A steal
   * chance farther than 20 m still shows when its door is on screen. Absent = distance only.
   */
  onScreen?: (p: Vec2) => boolean;
}

/** The current unanswered scoring run (only one team can be on a run at a time). */
export interface ScoringRun {
  team: TeamId;
  /** Recoveries in the run so far (>= 1); drives the coin pitch climb (WP8). */
  recoveries: number;
  /** Points scored in the run so far. */
  points: number;
  /** 0 = no tier yet; 1 / 2 as in `streakTier` (drives the van heat rim, WP3). */
  tier: 0 | StreakTier;
  /** Tick of the run's latest recovery (the run lapses 25 s after it). */
  lastTick: number;
}

/** The single best steal opportunity for the local human (marker "빼내기 +{value}"). */
export interface StealChanceInfo {
  /** Opposing bank being hauled that still holds safes. */
  bankId: EntityId;
  /** World position of the chosen open door. */
  doorPos: Vec2;
  /** Points that can be pulled out (the best safe through that door). */
  value: number;
}

/** Continuous tracker state after the latest observe() (read-only; replaced each tick). */
export interface MomentSnapshot {
  /** Tick of the latest observe() (-1 before the first). */
  tick: number;
  /** `matchPointInfo(state, { earlyDecision })` as of that tick. */
  matchPoint: MatchPointInfo | null;
  /** Team strictly ahead on confirmed score (null = level). Crown (WP4). */
  leader: TeamId | null;
  run: ScoringRun | null;
  stealChance: StealChanceInfo | null;
  /** Kind of the decisive load (convenience for labels / stings; null without match point). */
  matchPointKind: LootKind | null;
}

/** Snapshot before the first observe() / after reset(), and the stub's constant answer. */
export const EMPTY_MOMENT_SNAPSHOT: Readonly<MomentSnapshot> = Object.freeze({
  tick: -1,
  matchPoint: null,
  leader: null,
  run: null,
  stealChance: null,
  matchPointKind: null,
});

const s2t = (s: number): number => Math.round(s * TICK_RATE);

/** Every tunable of the tracker (presentation only: none of them touches the sim or scoring). */
export const MOMENT_RULES = {
  /** matchPointInfo must hold this long before `matchPointOn` (filters one-tick touches). */
  mpOnTicks: s2t(1 / 6),
  /**
   * ... and stay gone this long before `matchPointStopped`: a knocked-down hauler (0.7 s) who
   * grabs again within it continues the same episode, so "막았다!" is only claimed for real stops.
   */
  mpStopTicks: s2t(2),
  runGapTicks: s2t(25),
  runTier1Recoveries: 4,
  runTier1Share: 0.25,
  runTier1MinRecoveries: 3,
  runTier2Share: 0.31,
  runTier2MinRecoveries: 2,
  /** A coin deposit this big counts as a recovery for runs (content-plan §4.5). */
  runDepositMin: 50,
  bigPlayMin: 6,
  bigPlayMax: 4,
  bigPlayCooldownTicks: s2t(10),
  bigPlay: { recoveryPerPoint: 1 / 200, steal: 2, koCarrier: 1.5, koBank: 3, hammerBank: 4, homeRun: 3, jackpot: 3, craneDrop: 4, fenceBust: 4, bankTakenOver: 3, leadFlip: 3, late: 4 },
  /** "recovery with <= 15 s left". */
  lateTicks: s2t(15),
  stealRadius: 20,
  stealReopenTicks: s2t(3),
  /** A chance that briefly fails the door test (a body passing) stays shown this long. */
  stealHoldTicks: s2t(0.2),
  /** Door "outside" point distance from the door line, and the body-block radius around it. */
  doorOut: 0.9,
  doorBlockRadius: 1.0,
  dodgeSideways: 1,
  /** A wind-up record without any news for this long is dropped. */
  windupStaleTicks: s2t(3),
  coinSplashMin: 60,
  hammerBonkBagMin: 100,
  tossScoreTicks: s2t(6),
  eventHaulMin: 200,
} as const;

const KIND_ORDER = new Map<MomentKind, number>(MOMENT_KINDS.map((k, i) => [k, i]));

const other = (t: TeamId): TeamId => (t === 0 ? 1 : 0);

interface HeldInfo {
  lootId: EntityId | null;
  lootKind: LootKind | null;
  /** Held loot estimate + bag. */
  value: number;
  bag: number;
}

/** A bigPlay candidate of one tick (exposed for tools / tuning via `lastCandidates`; not a contract). */
export interface BigPlayCand {
  rating: number;
  /** What kind of play and the knocked-down character, if any (tools / tuning only). */
  what?: string;
  victim?: EntityId;
  team: TeamId;
  pos: Vec2;
  value: number;
  ids: EntityId[];
  lootKind?: LootKind;
}

interface MpEpisode {
  team: TeamId;
  value: number;
  lootIds: EntityId[];
  lootKind: LootKind | null;
}

interface MpTeamState {
  ep: MpEpisode | null;
  /** Tick the team's match point started showing (on-debounce), null = not pending. */
  since: number | null;
  /** Ticks without it while an episode runs (stop grace). */
  nullTicks: number;
}

const newMpTeam = (): MpTeamState => ({ ep: null, since: null, nullTicks: 0 });

interface WindupRec {
  botId: EntityId;
  startTick: number;
  lastSeen: number;
  humanStart: Vec2;
  botStart: Vec2;
  /** 'winding' while the intent says windup; 'dashing' once it fired, until `until`. */
  phase: 'winding' | 'dashing';
  until: number;
  hit: boolean;
}

interface Scoring {
  team: TeamId;
  value: number;
  /** Counts as a recovery for runs / answers the other team's run. */
  counts: boolean;
  lootId: EntityId | null;
  lootKind: LootKind | null;
  pos: Vec2;
  holders: EntityId[];
}

export class MomentTracker {
  readonly options: Readonly<MomentTrackerOptions>;

  private snap: MomentSnapshot = { ...EMPTY_MOMENT_SNAPSHOT };
  private prevScores: [number, number] = [0, 0];
  private lastStrict: TeamId | null = null;
  private mpTeam: [MpTeamState, MpTeamState] = [newMpTeam(), newMpTeam()];
  private run: ScoringRun | null = null;
  private bigPlays = 0;
  private lastBigPlay = -Infinity;
  /** bigPlay rating a loot item carries into its recovery (steals, fence busts). */
  private ledger = new Map<EntityId, number>();
  /** Teams that have hauled a bank (bit 1 = team 0, bit 2 = team 1). */
  private haulers = new Map<EntityId, number>();
  private prevHeld = new Map<EntityId, HeldInfo>();
  private steal: StealChanceInfo | null = null;
  private stealHold = 0;
  private stealLastBank: EntityId | null = null;
  private stealClosedTick = -Infinity;
  private windups = new Map<EntityId, WindupRec>();
  /** Loot flown by catapult / tube: landing tick. */
  private landed = new Map<EntityId, number>();
  private craneLoad = new Map<string, EntityId[]>();
  private lastHitOnGimmick = new Map<string, { charId: EntityId; tick: number }>();
  private lastTruckHitter: EntityId | null = null;
  private truckOpened = new Set<number>();
  private eventCoins = new Set<EntityId>();
  private eventInBag = new Map<EntityId, number>();
  private eventRecovered: [number, number] = [0, 0];
  private eventHaulDone: [boolean, boolean] = [false, false];
  /** This tick's bigPlay candidates incl. rating-0 recoveries (tools / tuning; not a contract). */
  lastCandidates: BigPlayCand[] = [];

  constructor(options: MomentTrackerOptions) {
    this.options = { ...options };
  }

  /**
   * Feed one sim tick (call after `sim.step`, with that step's events and the bots' intents read
   * for the same tick). Returns the moments that happened on this tick, in MOMENT_KINDS order;
   * [] when nothing did. Never mutates its inputs.
   */
  observe(state: Readonly<SimState>, events: readonly SimEvent[], botIntents: readonly BotIntentSample[]): Moment[] {
    const tick = state.tick;
    const out: Moment[] = [];
    const R = MOMENT_RULES;
    const me = this.options.localCharId;
    const charOf = (id: EntityId | null | undefined): CharacterState | undefined => {
      if (id === null || id === undefined) return undefined;
      const c = state.characters[id - 1];
      return c && c.id === id ? c : undefined;
    };
    const lootById = new Map<EntityId, LootState>();
    for (const l of state.loot) lootById.set(l.id, l);
    const push = (m: Omit<Moment, 'tick'>): void => {
      out.push({ tick, ...m });
    };
    const cands: BigPlayCand[] = [];
    this.lastCandidates = [];
    const scorings: Scoring[] = [];
    const dashPairs: { a: EntityId; v: EntityId }[] = [];
    const dashed = new Set<EntityId>();
    const hitsOnMe = new Set<EntityId>();
    const truckCoins = { total: 0, by: null as EntityId | null };
    const smashTotals = new Map<EntityId, number>();

    // ---------------------------------------------------------------------------------------
    // 1. events
    // ---------------------------------------------------------------------------------------
    for (const e of events) {
      if (e.type === 'coinSpawn') {
        if (e.source === 'rain' || e.source === 'truck') for (const id of e.ids) this.eventCoins.add(id);
        if (e.source === 'truck') {
          truckCoins.total += e.total;
          if (e.byCharId !== null) truckCoins.by = e.byCharId;
        }
        if (e.source === 'smash' && typeof e.sourceId === 'number') smashTotals.set(e.sourceId, (smashTotals.get(e.sourceId) ?? 0) + e.total);
      }
    }
    for (const e of events) {
      switch (e.type) {
        case 'recovered': {
          const l = lootById.get(e.lootId);
          scorings.push({ team: e.team, value: e.value, counts: true, lootId: e.lootId, lootKind: e.kind, pos: l ? { ...l.pos } : { x: 0, y: 0 }, holders: e.holders });
          if (e.variant === 'goldSafe') this.eventRecovered[e.team] += e.value;
          break;
        }
        case 'coinsBanked': {
          const c = charOf(e.charId);
          scorings.push({ team: e.team, value: e.value, counts: e.value >= R.runDepositMin, lootId: null, lootKind: null, pos: c ? { ...c.pos } : { x: 0, y: 0 }, holders: [e.charId] });
          const ev = Math.min(this.eventInBag.get(e.charId) ?? 0, e.value);
          if (ev > 0) {
            this.eventRecovered[e.team] += ev;
            this.eventInBag.set(e.charId, (this.eventInBag.get(e.charId) ?? 0) - ev);
          }
          break;
        }
        case 'coinPickup':
          if (this.eventCoins.delete(e.coinId)) this.eventInBag.set(e.charId, (this.eventInBag.get(e.charId) ?? 0) + e.value);
          break;
        case 'safeUnloaded': {
          if (e.byCharId === null || e.bankCarrierTeam === null) break;
          const thief = charOf(e.byCharId);
          if (!thief || thief.team === e.bankCarrierTeam) break;
          const safe = lootById.get(e.safeId);
          const v = safe ? safe.baseValue : 0;
          const rating = v / 100 + R.bigPlay.steal;
          this.ledger.set(e.safeId, Math.max(this.ledger.get(e.safeId) ?? 0, rating));
          cands.push({ rating, what: 'steal', team: thief.team, pos: safe ? { ...safe.pos } : { ...thief.pos }, value: v, ids: [thief.id, e.safeId], lootKind: safe?.kind });
          break;
        }
        case 'dashHit': {
          if (e.victimId === me) hitsOnMe.add(e.attackerId);
          if (!e.knockdown) {
            dashPairs.push({ a: e.attackerId, v: e.victimId });
            break;
          }
          const att = charOf(e.attackerId);
          const vic = charOf(e.victimId);
          if (!att || !vic || att.team === vic.team) break;
          const held = this.prevHeld.get(e.victimId);
          if (held && held.lootId !== null) {
            const bank = held.lootKind === 'bank';
            cands.push({ rating: held.value / 100 + (bank ? R.bigPlay.koBank : R.bigPlay.koCarrier), what: 'ko', victim: vic.id, team: att.team, pos: { ...vic.pos }, value: held.value, ids: [att.id, held.lootId], lootKind: held.lootKind ?? undefined });
          }
          break;
        }
        case 'dash':
          dashed.add(e.charId);
          break;
        case 'itemHit': {
          if (e.target === 'event') this.lastTruckHitter = e.charId;
          if (e.target === 'gimmick' && typeof e.targetId === 'string') this.lastHitOnGimmick.set(e.targetId, { charId: e.charId, tick });
          if (e.target !== 'char' || (e.kind !== 'hammer' && e.kind !== 'goldHammer') || typeof e.targetId !== 'number') break;
          if (e.targetId === me) hitsOnMe.add(e.charId);
          const att = charOf(e.charId);
          const vic = charOf(e.targetId);
          if (!att || !vic || att.team === vic.team) break;
          const held = this.prevHeld.get(vic.id) ?? { lootId: null, lootKind: null, value: 0, bag: 0 };
          const carrier = held.lootId !== null;
          const bank = held.lootKind === 'bank';
          if (e.knockdown && (carrier || held.bag >= R.hammerBonkBagMin)) {
            push({ kind: 'hammerBonk', team: att.team, pos: { ...vic.pos }, value: held.value, ids: [att.id, vic.id] });
          }
          if (e.homeRun) push({ kind: 'homeRun', team: att.team, pos: { ...vic.pos }, value: held.value, ids: [att.id, vic.id] });
          if (e.knockdown && carrier) {
            let rating = held.value / 100 + (bank ? R.bigPlay.koBank + R.bigPlay.hammerBank : R.bigPlay.koCarrier);
            if (e.homeRun) rating += R.bigPlay.homeRun;
            cands.push({ rating, what: 'hammerKo', victim: vic.id, team: att.team, pos: { ...vic.pos }, value: held.value, ids: [att.id, held.lootId!], lootKind: held.lootKind ?? undefined });
          } else if (e.homeRun) {
            cands.push({ rating: held.value / 100 + R.bigPlay.homeRun, what: 'homeRun', victim: vic.id, team: att.team, pos: { ...vic.pos }, value: held.value, ids: [att.id] });
          }
          break;
        }
        case 'itemClash':
          if (me !== null && (e.aId === me || e.bId === me)) {
            const c = charOf(me);
            push({ kind: 'counterDash', team: this.options.localTeam, pos: c ? { ...c.pos } : undefined, ids: [me, e.aId === me ? e.bId : e.aId] });
          }
          break;
        case 'fenceBroken':
          if (e.bankId >= 0) this.ledger.set(e.bankId, (this.ledger.get(e.bankId) ?? 0) + R.bigPlay.fenceBust);
          break;
        case 'emoteCancel': {
          if (e.cause !== 'hit' || e.hitBy === null || e.hitBy === undefined) break;
          const dasher = charOf(e.hitBy);
          const taunter = charOf(e.charId);
          if (!dasher || !taunter || dasher.team === taunter.team) break;
          push({ kind: 'tauntPunished', team: dasher.team, pos: { ...taunter.pos }, ids: [dasher.id, taunter.id] });
          break;
        }
        case 'bagSpilled': {
          if (e.value < R.coinSplashMin) break;
          const by = charOf(e.byId);
          const vic = charOf(e.charId);
          if (!by || !vic || by.team === vic.team) break;
          push({ kind: 'coinSplash', team: by.team, pos: { ...vic.pos }, value: e.value, ids: [by.id, vic.id] });
          break;
        }
        case 'piggyCrack': {
          if (!e.smashed) break;
          const by = charOf(e.byCharId);
          if (!by) break;
          const l = lootById.get(e.lootId);
          const v = smashTotals.get(e.lootId) ?? 300;
          push({ kind: 'jackpot', team: by.team, pos: l ? { ...l.pos } : { ...by.pos }, value: v, ids: [by.id, e.lootId] });
          cands.push({ rating: v / 100 + R.bigPlay.jackpot, what: 'jackpot', team: by.team, pos: l ? { ...l.pos } : { ...by.pos }, value: v, ids: [by.id, e.lootId], lootKind: l?.kind });
          break;
        }
        case 'matchEvent': {
          if (e.kind !== 'cashTruck' || e.phase !== 'open' || this.truckOpened.has(e.tick)) break;
          this.truckOpened.add(e.tick);
          const by = charOf(truckCoins.by ?? this.lastTruckHitter);
          if (!by) break;
          const v = truckCoins.total > 0 ? truckCoins.total : 400;
          const pos = e.pos ? { ...e.pos } : { ...by.pos };
          push({ kind: 'jackpot', team: by.team, pos, value: v, ids: [by.id] });
          cands.push({ rating: v / 100 + R.bigPlay.jackpot, what: 'jackpot', team: by.team, pos, value: v, ids: [by.id] });
          break;
        }
        case 'itemPickup':
          if (e.kind === 'goldHammer') {
            const c = charOf(e.charId);
            if (c) push({ kind: 'goldHammer', team: c.team, pos: { ...c.pos }, ids: [c.id] });
          }
          break;
        case 'gimmick': {
          if (e.what !== 'catStunned' && e.what !== 'craneDrop') break;
          const ids = e.ids ?? [];
          let stunner = charOf(ids.find((id) => charOf(id) !== undefined));
          if (!stunner) {
            const h = this.lastHitOnGimmick.get(e.id);
            if (h && tick - h.tick <= 3) stunner = charOf(h.charId);
          }
          const bankId = ids.find((id) => lootById.get(id)?.kind === 'bank') ?? (this.craneLoad.get(e.id) ?? []).find((id) => lootById.get(id)?.kind === 'bank');
          const bank = bankId !== undefined ? lootById.get(bankId) : undefined;
          if (!stunner || !bank) break;
          const pos = { ...bank.pos };
          push({ kind: 'craneDrop', team: stunner.team, pos, value: bank.estimatedValue, ids: [stunner.id, bank.id] });
          cands.push({ rating: bank.estimatedValue / 100 + R.bigPlay.craneDrop, what: 'craneDrop', team: stunner.team, pos, value: bank.estimatedValue, ids: [stunner.id, bank.id], lootKind: 'bank' });
          break;
        }
        default:
          break;
      }
    }

    // counterDash: a symmetric dash clash (both hit each other this tick without a knockdown)
    if (me !== null) {
      for (const p of dashPairs) {
        if (p.a !== me) continue;
        if (dashPairs.some((q) => q.a === p.v && q.v === me)) {
          const c = charOf(me);
          push({ kind: 'counterDash', team: this.options.localTeam, pos: c ? { ...c.pos } : undefined, ids: [me, p.v] });
          break;
        }
      }
    }

    // ---------------------------------------------------------------------------------------
    // 2. lead (from the settled scores: recoveries and deposits alike)
    // ---------------------------------------------------------------------------------------
    const [s0, s1] = state.scores;
    const before = this.prevScores;
    const leadAfter: TeamId | null = s0 > s1 ? 0 : s1 > s0 ? 1 : null;
    let flipTeam: TeamId | null = null;
    if (s0 !== before[0] || s1 !== before[1]) {
      const levelBefore = before[0] === before[1];
      const biggest = (team: TeamId): Scoring | undefined => {
        let b: Scoring | undefined;
        for (const s of scorings) if (s.team === team && (!b || s.value > b.value || (s.value === b.value && b.lootId === null && s.lootId !== null))) b = s;
        return b;
      };
      if (leadAfter !== null && this.lastStrict !== null && leadAfter !== this.lastStrict) {
        flipTeam = leadAfter;
        const s = biggest(leadAfter);
        push({ kind: 'leadTaken', team: leadAfter, pos: s?.pos, value: s?.value, ids: s?.lootId !== null && s?.lootId !== undefined ? [s.lootId] : [], lootKind: s?.lootKind ?? undefined });
      } else if (leadAfter === null && !levelBefore && s0 > 0) {
        // the team that drew level is the one that was behind
        const team: TeamId = before[0] < before[1] ? 0 : 1;
        const s = biggest(team);
        push({ kind: 'equalized', team, pos: s?.pos, value: s?.value, ids: s?.lootId !== null && s?.lootId !== undefined ? [s.lootId] : [], lootKind: s?.lootKind ?? undefined });
      }
      if (leadAfter !== null) this.lastStrict = leadAfter;
    }
    this.prevScores = [s0, s1];

    // ---------------------------------------------------------------------------------------
    // 3. scoring runs
    // ---------------------------------------------------------------------------------------
    if (this.run && tick - this.run.lastTick > R.runGapTicks) this.run = null;
    if (scorings.length) {
      const per: { n: number; pts: number; last: Scoring | null }[] = [
        { n: 0, pts: 0, last: null },
        { n: 0, pts: 0, last: null },
      ];
      for (const s of scorings) {
        const p = per[s.team]!;
        p.pts += s.value;
        if (s.counts) {
          p.n++;
          if (!p.last || s.value >= p.last.value) p.last = s;
        }
      }
      const answered = [per[0]!.n > 0, per[1]!.n > 0];
      const total = Math.max(1, state.totalValue);
      const tierOf = (r: ScoringRun): 0 | StreakTier =>
        r.points >= R.runTier2Share * total && r.recoveries >= R.runTier2MinRecoveries
          ? 2
          : r.recoveries >= R.runTier1Recoveries || (r.points >= R.runTier1Share * total && r.recoveries >= R.runTier1MinRecoveries)
            ? 1
            : 0;
      const breakRun = (by: Scoring | null): void => {
        const r = this.run;
        if (!r) return;
        if (r.tier > 0) push({ kind: 'streakBroken', team: r.team, pos: by?.pos, value: r.points, ids: by?.lootId !== null && by?.lootId !== undefined ? [by.lootId] : [], lootKind: by?.lootKind ?? undefined });
        this.run = null;
      };
      if (answered[0] && answered[1]) {
        breakRun(per[0]!.last);
      } else {
        for (const team of [0, 1] as TeamId[]) {
          const p = per[team]!;
          if (!p.n && !p.pts) continue;
          if (this.run && this.run.team !== team) {
            if (!p.n) continue; // a small deposit neither counts nor answers
            breakRun(p.last);
          }
          if (!this.run) {
            if (!p.n) continue;
            this.run = { team, recoveries: 0, points: 0, tier: 0, lastTick: tick };
          }
          const r = this.run;
          r.recoveries += p.n;
          r.points += p.pts;
          if (p.n) r.lastTick = tick;
          const t = tierOf(r);
          if (t !== 0 && t > r.tier) {
            r.tier = t;
            const s = p.last;
            push({ kind: 'streakTier', team, tier: t, pos: s?.pos, value: r.points, ids: s?.lootId !== null && s?.lootId !== undefined ? [s.lootId] : [], lootKind: s?.lootKind ?? undefined });
          }
        }
      }
    }

    // ---------------------------------------------------------------------------------------
    // 4. recoveries: bigPlay ratings, tossScore, eventHaul
    // ---------------------------------------------------------------------------------------
    const ticksLeft = Number.isFinite(state.endTick) ? state.endTick - tick : Infinity;
    for (const s of scorings) {
      if (s.lootId === null) continue;
      const l = lootById.get(s.lootId);
      let rating = s.value * R.bigPlay.recoveryPerPoint + (this.ledger.get(s.lootId) ?? 0);
      if (s.lootKind === 'bank') {
        const bits = this.haulers.get(s.lootId) ?? 0;
        if (bits & (1 << other(s.team))) rating += R.bigPlay.bankTakenOver;
      }
      if (flipTeam === s.team) rating += R.bigPlay.leadFlip;
      if (ticksLeft <= R.lateTicks) rating += R.bigPlay.late;
      const actor = s.holders.find((id) => charOf(id)?.team === s.team) ?? (l?.lastHolder !== null && l?.lastHolder !== undefined && charOf(l.lastHolder)?.team === s.team ? l.lastHolder : null);
      cands.push({ rating, what: 'recovery', team: s.team, pos: s.pos, value: s.value, ids: actor !== null ? [actor, s.lootId] : [s.lootId], lootKind: s.lootKind ?? undefined });
      const landedAt = this.landed.get(s.lootId);
      if (landedAt !== undefined && tick - landedAt <= R.tossScoreTicks) push({ kind: 'tossScore', team: s.team, pos: s.pos, value: s.value, ids: [s.lootId], lootKind: s.lootKind ?? undefined });
      this.landed.delete(s.lootId);
      this.ledger.delete(s.lootId);
    }
    for (const team of [0, 1] as TeamId[]) {
      if (this.eventHaulDone[team] || this.eventRecovered[team] < R.eventHaulMin) continue;
      this.eventHaulDone[team] = true;
      const gold = scorings.find((s) => s.team === team && s.lootId !== null && lootById.get(s.lootId)?.variant === 'goldSafe');
      const anyS = scorings.find((s) => s.team === team);
      push({ kind: 'eventHaul', team, pos: (gold ?? anyS)?.pos, value: this.eventRecovered[team], ids: gold ? [gold.lootId!] : [] });
    }

    // bigPlay: the best candidate of the tick
    for (const c of cands) this.lastCandidates.push(c);
    if (cands.length && this.bigPlays < R.bigPlayMax && tick - this.lastBigPlay >= R.bigPlayCooldownTicks) {
      let best: BigPlayCand | null = null;
      for (const c of cands) if (!best || c.rating > best.rating) best = c;
      if (best && best.rating >= R.bigPlayMin) {
        this.bigPlays++;
        this.lastBigPlay = tick;
        push({ kind: 'bigPlay', team: best.team, pos: best.pos, score: Math.round(best.rating * 10) / 10, value: best.value, ids: best.ids, lootKind: best.lootKind });
      }
    }

    // ---------------------------------------------------------------------------------------
    // 5. match point episodes
    // ---------------------------------------------------------------------------------------
    const early = this.options.earlyDecision ?? true;
    const info = matchPointInfo(state, { earlyDecision: early });
    const loadKind = (i: MatchPointInfo | null): LootKind | null => (i ? lootById.get(i.lootIds[0]!)?.kind ?? null : null);
    // One episode per team: a load both teams pull on (or a team pulling the other's zone load)
    // can be decisive for both at once, and matchPointInfo names only the larger one.
    for (const team of [0, 1] as TeamId[]) {
      const T = this.mpTeam[team];
      const ti = state.over || !info ? null : info.team === team ? info : this.teamMatchPoint(state, team, early);
      const stop = (): void => {
        const ep = T.ep;
        T.ep = null;
        if (!ep) return;
        const l = lootById.get(ep.lootIds[0]!);
        if (state.over || !l || l.recovered) return;
        push({ kind: 'matchPointStopped', team, pos: { ...l.pos }, value: ep.value, ids: [...ep.lootIds], lootKind: ep.lootKind ?? undefined });
      };
      if (state.over) {
        T.ep = null;
        T.since = null;
      } else if (ti) {
        T.nullTicks = 0;
        if (T.ep) {
          T.ep.value = ti.value;
          T.ep.lootIds = [...ti.lootIds];
          T.ep.lootKind = loadKind(ti);
        } else {
          T.since ??= tick;
          if (tick - T.since + 1 >= R.mpOnTicks) {
            const l = lootById.get(ti.lootIds[0]!);
            T.ep = { team, value: ti.value, lootIds: [...ti.lootIds], lootKind: loadKind(ti) };
            T.since = null;
            push({ kind: 'matchPointOn', team, pos: l ? { ...l.pos } : undefined, value: ti.value, ids: [...ti.lootIds], lootKind: T.ep.lootKind ?? undefined });
          }
        }
      } else {
        T.since = null;
        if (T.ep) {
          const l = lootById.get(T.ep.lootIds[0]!);
          if (!l || l.recovered) T.ep = null;
          else if (++T.nullTicks >= R.mpStopTicks) stop();
        }
      }
    }

    // ---------------------------------------------------------------------------------------
    // 6. steal chance (local human)
    // ---------------------------------------------------------------------------------------
    const prevSteal = this.steal;
    const found = this.findSteal(state, charOf(me));
    let steal: StealChanceInfo | null = found;
    if (!found && prevSteal && this.stealHold < R.stealHoldTicks) {
      const b = lootById.get(prevSteal.bankId);
      if (b && !b.recovered && !b.anchored && b.loadedSafes.length > 0 && b.grabbedBy.some((id) => charOf(id) && charOf(id)!.team !== this.options.localTeam)) {
        steal = prevSteal;
        this.stealHold++;
      }
    }
    if (found) this.stealHold = 0;
    if (!steal && prevSteal) this.stealClosedTick = tick;
    if (steal && (!prevSteal || prevSteal.bankId !== steal.bankId) && (steal.bankId !== this.stealLastBank || tick - this.stealClosedTick > R.stealReopenTicks)) {
      push({ kind: 'stealChance', team: this.options.localTeam, pos: { ...steal.doorPos }, value: steal.value, ids: [steal.bankId], lootKind: 'bank' });
    }
    if (steal) this.stealLastBank = steal.bankId;
    this.steal = steal;

    // ---------------------------------------------------------------------------------------
    // 7. dodged (bot wind-ups aimed at the human)
    // ---------------------------------------------------------------------------------------
    const human = charOf(me);
    if (human) {
      const seen = new Set<EntityId>();
      for (const s of botIntents) {
        const rec = this.windups.get(s.charId);
        const winding = s.intent.phase === 'windup' && s.intent.windupTargetId === human.id;
        seen.add(s.charId);
        if (winding) {
          if (!rec || rec.phase === 'dashing') {
            const bot = charOf(s.charId);
            if (!bot) continue;
            this.windups.set(s.charId, { botId: s.charId, startTick: tick, lastSeen: tick, humanStart: { ...human.pos }, botStart: { ...bot.pos }, phase: 'winding', until: 0, hit: false });
          } else rec.lastSeen = tick;
          continue;
        }
        if (rec && rec.phase === 'winding') {
          const bot = charOf(s.charId);
          if (dashed.has(s.charId) || (bot && bot.dashTicks > 0)) {
            rec.phase = 'dashing';
            rec.until = tick + DASH.durationTicks + 2;
            rec.lastSeen = tick;
          } else {
            this.windups.delete(s.charId);
            this.evalDodge(rec, human, push);
          }
        }
      }
      for (const [id, rec] of this.windups) {
        if (hitsOnMe.has(id)) rec.hit = true;
        if (rec.phase === 'dashing') {
          if (rec.hit) this.windups.delete(id);
          else if (tick >= rec.until) {
            this.windups.delete(id);
            this.evalDodge(rec, human, push);
          }
        } else if (!seen.has(id) && tick - rec.lastSeen > R.windupStaleTicks) this.windups.delete(id);
      }
    } else this.windups.clear();

    // ---------------------------------------------------------------------------------------
    // 8. carry-over state for the next tick
    // ---------------------------------------------------------------------------------------
    this.prevHeld.clear();
    for (const c of state.characters) {
      const bag = c.bag ?? 0;
      let lootId: EntityId | null = null;
      let kind: LootKind | null = null;
      let v = bag;
      if (c.grab) {
        const l = lootById.get(c.grab.targetId);
        if (l && !l.recovered) {
          lootId = l.id;
          kind = l.kind;
          v += l.estimatedValue;
        }
      }
      this.prevHeld.set(c.id, { lootId, lootKind: kind, value: v, bag });
      const inBag = this.eventInBag.get(c.id);
      if (inBag !== undefined && inBag > bag) this.eventInBag.set(c.id, bag);
    }
    for (const l of state.loot) {
      if (l.recovered) continue;
      if (l.kind === 'bank' && !l.anchored && l.grabbedBy.length) {
        let bits = this.haulers.get(l.id) ?? 0;
        for (const id of l.grabbedBy) {
          const c = charOf(id);
          if (c) bits |= 1 << c.team;
        }
        this.haulers.set(l.id, bits);
      }
      const air = l.airborne;
      if (air && (air.via === 'catapult' || air.via === 'tube')) this.landed.set(l.id, air.toTick);
    }
    for (const g of state.gimmicks) {
      if (g.kind !== 'crane') continue;
      const load = g.busyWith.filter((id) => lootById.get(id)?.kind === 'bank');
      if (load.length) this.craneLoad.set(g.id, load);
      else this.craneLoad.delete(g.id);
    }

    this.snap = {
      tick,
      matchPoint: info,
      leader: leadAfter,
      run: this.run ? { ...this.run } : null,
      stealChance: steal ? { bankId: steal.bankId, doorPos: { ...steal.doorPos }, value: steal.value } : null,
      matchPointKind: loadKind(info),
    };

    if (out.length > 1) out.sort((a, b) => KIND_ORDER.get(a.kind)! - KIND_ORDER.get(b.kind)!);
    return out;
  }

  /** `team`'s own match point (its holders and its zone only), when matchPointInfo names the other team. */
  private teamMatchPoint(state: Readonly<SimState>, team: TeamId, earlyDecision: boolean): MatchPointInfo | null {
    const r = matchPointInfo(
      {
        over: state.over,
        scores: state.scores,
        remainingValue: state.remainingValue,
        characters: state.characters.filter((c) => c.team === team),
        loot: state.loot.map((l) => (l.recovery && l.recovery.team !== team ? { ...l, recovery: null } : l)),
      },
      { earlyDecision },
    );
    return r && r.team === team ? r : null;
  }

  private evalDodge(rec: WindupRec, human: Readonly<CharacterState>, push: (m: Omit<Moment, 'tick'>) => void): void {
    if (rec.hit || human.knockdownTicks > 0) return;
    const dx = rec.humanStart.x - rec.botStart.x;
    const dy = rec.humanStart.y - rec.botStart.y;
    const d = Math.hypot(dx, dy);
    const mx = human.pos.x - rec.humanStart.x;
    const my = human.pos.y - rec.humanStart.y;
    const side = d > 1e-6 ? Math.abs((dx * my - dy * mx) / d) : Math.hypot(mx, my);
    if (side >= MOMENT_RULES.dodgeSideways) push({ kind: 'dodged', team: human.team, pos: { ...human.pos }, ids: [human.id, rec.botId] });
  }

  /** The best open door of an opposing bank haul that still holds safes (or null). */
  private findSteal(state: Readonly<SimState>, human: Readonly<CharacterState> | undefined): StealChanceInfo | null {
    if (!human) return null;
    const R = MOMENT_RULES;
    const team = this.options.localTeam;
    let holdingBank = false;
    if (human.grab) {
      const id = human.grab.targetId;
      holdingBank = state.loot.some((l) => l.id === id && l.kind === 'bank');
    }
    if (holdingBank) return null;
    let best: { info: StealChanceInfo; d: number } | null = null;
    for (const bank of state.loot) {
      if (bank.kind !== 'bank' || bank.recovered || bank.anchored || bank.loadedSafes.length === 0) continue;
      let hauled = false;
      for (const id of bank.grabbedBy) {
        const c = state.characters[id - 1];
        if (c && c.team !== team) hauled = true;
      }
      if (!hauled) continue;
      let value = 0;
      for (const sid of bank.loadedSafes) {
        const s = state.loot.find((l) => l.id === sid);
        if (s && s.baseValue > value) value = s.baseValue;
      }
      if (value <= 0) continue;
      const c = Math.cos(bank.angle);
      const s = Math.sin(bank.angle);
      for (const door of BANK_MODEL.doors) {
        const lx = door.center.x;
        const ly = door.center.y;
        const doorPos = { x: bank.pos.x + lx * c - ly * s, y: bank.pos.y + lx * s + ly * c };
        const nx = door.normal.x * c - door.normal.y * s;
        const ny = door.normal.x * s + door.normal.y * c;
        const outPos = { x: doorPos.x + nx * R.doorOut, y: doorPos.y + ny * R.doorOut };
        if (this.options.isFree && !this.options.isFree(outPos)) continue;
        let blocked = false;
        for (const o of state.characters) {
          if (o.team === team || o.knockdownTicks > 0) continue;
          if (Math.hypot(o.pos.x - outPos.x, o.pos.y - outPos.y) < R.doorBlockRadius) blocked = true;
        }
        if (blocked) continue;
        const d = Math.hypot(doorPos.x - human.pos.x, doorPos.y - human.pos.y);
        if (d > R.stealRadius && !(this.options.onScreen?.(doorPos) ?? false)) continue;
        if (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) <= 1e-9 && value > best.info.value)) best = { info: { bankId: bank.id, doorPos, value }, d };
      }
    }
    return best ? best.info : null;
  }

  /**
   * Continuous state as of the latest observe() (see MomentSnapshot). Cheap; safe to call any
   * number of times per tick and from any consumer.
   */
  snapshot(): Readonly<MomentSnapshot> {
    return this.snap;
  }

  /** Forget all history (new match / rematch on the same tracker). */
  reset(): void {
    this.snap = { ...EMPTY_MOMENT_SNAPSHOT };
    this.prevScores = [0, 0];
    this.lastStrict = null;
    this.mpTeam = [newMpTeam(), newMpTeam()];
    this.run = null;
    this.bigPlays = 0;
    this.lastBigPlay = -Infinity;
    this.ledger.clear();
    this.haulers.clear();
    this.prevHeld.clear();
    this.steal = null;
    this.stealHold = 0;
    this.stealLastBank = null;
    this.stealClosedTick = -Infinity;
    this.windups.clear();
    this.landed.clear();
    this.craneLoad.clear();
    this.lastHitOnGimmick.clear();
    this.lastTruckHitter = null;
    this.truckOpened.clear();
    this.eventCoins.clear();
    this.eventInBag.clear();
    this.eventRecovered = [0, 0];
    this.eventHaulDone = [false, false];
  }
}

/** Is the local human part of this moment (actor, victim, dodger, ...)? Consumers' helper. */
export function momentInvolves(m: Readonly<Moment>, charId: EntityId | null): boolean {
  return charId !== null && !!m.ids && m.ids.includes(charId);
}

// ---------------------------------------------------------------------------------------------
// Kickoff cue (fun-plan WP5 §3, content-plan F5 delta). Pure; match.ts pulses the target for the
// first `KICKOFF_CUE_TICKS` of a match (and shows one short arrow to players with fewer than
// `KICKOFF_ARROW_MATCHES` finished matches).
// ---------------------------------------------------------------------------------------------

export const KICKOFF_CUE_TICKS = 5 * TICK_RATE;
export const KICKOFF_ARROW_MATCHES = 10;

export interface KickoffTarget {
  /** Loot id (numeric: pulsed by the view's ping highlight) or breakable id (string). */
  id: EntityId | string;
  kind: 'smallSafe' | 'atm' | 'crate';
  pos: Vec2;
}

/**
 * The first thing to go for: classic — the nearest outdoor small safe still anchored; v2 — the
 * nearest unbroken crate or ATM (never a safe). `lootOnly` restricts the v2 choice to the ATM
 * (the view's pulse highlights loot ids only). Ties: lower id / layout order (deterministic).
 */
export function kickoffTarget(state: Readonly<SimState>, charId: EntityId, opts: { lootOnly?: boolean } = {}): KickoffTarget | null {
  const me = state.characters[charId - 1];
  if (!me || me.id !== charId) return null;
  const d2 = (p: Vec2): number => (p.x - me.pos.x) ** 2 + (p.y - me.pos.y) ** 2;
  const v2 = state.loot.some((l) => l.variant) || state.breakables.length > 0;
  let best: KickoffTarget | null = null;
  let bestD = Infinity;
  for (const l of state.loot) {
    if (l.recovered || l.dormant || l.airborne) continue;
    const ok = v2 ? l.variant === 'atm' : l.kind === 'smallSafe' && !l.variant && l.homeBank === null && l.anchored;
    if (!ok) continue;
    const d = d2(l.pos);
    if (d < bestD) {
      bestD = d;
      best = { id: l.id, kind: v2 ? 'atm' : 'smallSafe', pos: { ...l.pos } };
    }
  }
  if (v2 && !opts.lootOnly) {
    for (const b of state.breakables) {
      if (b.broken || b.kind !== 'crate') continue;
      const d = d2(b.center);
      if (d < bestD) {
        bestD = d;
        best = { id: b.id, kind: 'crate', pos: { ...b.center } };
      }
    }
  }
  return best;
}
