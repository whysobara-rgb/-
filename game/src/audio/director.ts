/**
 * MatchAudioDirector: turns simulation events and state into sound, so game flow only needs
 *
 *   const dir = new MatchAudioDirector(getAudioEngine(), { localTeam: 0, listenerCharId: 1 });
 *   const events = sim.step(cmds);  dir.onEvents(events, sim);      // every tick
 *   dir.update(sim, frameDt);                                       // every rendered frame
 *   dir.stop();                                                      // leaving / pausing
 *
 * Event sounds are positional (listener = the local raccoon). Continuous loops follow state:
 * scraping safes, grinding banks, the uproot build-up, the final-countdown siren, police car
 * sirens and ringing bank alarms. Music intensity rises with moving banks, recoveries in progress,
 * close scores and little time left; a chase layer swells in while police are on the field.
 * Consecutive recoveries by the local team climb the pentatonic scale (ART_DIRECTION §1).
 *
 * Presentation sync (src/render/uproot.ts, src/render/view.ts callouts):
 *   - strain loop: pitch = object size, the build-up follows unanchorProgress (stages 0-40-80 %);
 *   - 'unanchored': the POP (+ root tearing) now, the landing thud when the view's hop comes down
 *     (LAND_DELAY, plus the view's hit-stop for near banks / large safes), and a callout stinger:
 *     "뽑았다!" (safes) / "은행째!" (banks) — the rival flavor when the other team did it;
 *   - "가로채기!" on a steal (a safe pulled out of a bank the other team was hauling),
 *     "태클 피했다!" when a police lunge at the listener misses.
 *
 * Police (owner addition): a cute two-tone siren per car while its siren is on (doppler bend
 * while it drives in, settling once parked), drift stop + door slams on arrival, whistle + "멈춰!"
 * when an officer starts a new pursuit that concerns the listener (the sim's targets flap, so
 * re-acquisitions stay silent; one shared whistle budget of ~12/min), sparse chase tweets near the
 * listener, lunge whoosh, comic thump / swish on the tackle, boing + birdies when a raccoon knocks
 * an officer over, the car revving off and a cheeky "phew" when the last one leaves. Every
 * uprooted, unrecovered bank rings its alarm bell (positional, settling after the first seconds,
 * ducked with distance). Scoring sounds duck the police ambience (sirens, bells, whistles, barks,
 * car noises: mixer ambience bus); the music ducks under the bank uproot, the bank recovery and a
 * tackle on the listener.
 *
 * Taunts (owner addition): an 'emote' event plays that taunt's sound at the raccoon (TAUNT_SFX,
 * tagged per character) and 'emoteCancel' cuts it. `tauntFilter` hides other raccoons' taunts
 * (the "show others' taunts" setting); the listener's own taunt always sounds.
 */
import type { CharacterState, EmoteId, EntityId, LootKind, LootState, PolicePhase, SimEvent, SimState, TeamId, Vec2 } from '../sim/types';
import { TICK_RATE } from '../sim/config';
import type { AudioEngine } from './audio';
import type { LoopId, SfxId } from './ids';
import { LAND_DELAY } from './sfxStage';

/** The subset of `Simulation` the director reads (structural, so tests can fake it). */
export interface AudioSimView {
  readonly state: SimState;
  getLoot(id: EntityId): LootState | undefined;
  getCharacter(id: EntityId): CharacterState | undefined;
}

export interface DirectorOptions {
  /** Team of the local human (own scores sound brighter and climb in combo; team pings). */
  localTeam: TeamId;
  /** Character whose position is the listener (default: first human of localTeam, else slot 0). */
  listenerCharId?: EntityId | null;
  /** Switch tracks and drive setMusicIntensity from match state (default true). */
  driveMusic?: boolean;
  /** Play the victory / defeat / draw stinger after the end horn (default true). */
  resultJingle?: boolean;
  /** Footsteps on/off (default true). */
  footsteps?: boolean;
  /**
   * Whether the view's hit-stops are on (they hold the uproot landing back, see HITSTOP). A function
   * is asked at every uproot. Default: on unless the game's reduced-motion setting is active, read
   * from the `uh-reduced-motion` class the UI root keeps on <html> (src/ui/core/root.ts); the view
   * skips its hit-stops in that mode.
   */
  hitstop?: boolean | (() => boolean);
  /**
   * Taunts of which characters are heard (default: everyone). The listener's own taunt always
   * plays. Game flow passes the "show others' taunts" setting here.
   */
  tauntFilter?: ((charId: EntityId) => boolean) | null;
}

/** Sound per taunt emote (./sfxTaunt.ts). */
export const TAUNT_SFX: Readonly<Record<EmoteId, SfxId>> = {
  wiggle: 'tauntWiggle',
  bleh: 'tauntBleh',
  fanCash: 'tauntCash',
  squatBounce: 'tauntSquat',
  hodadakZoom: 'tauntZoom',
  tongkeunFlex: 'tauntFlex',
  nunchiShrug: 'tauntShrug',
};

/** Voice tag of a character's taunt sound (so a cancel cuts exactly that one). */
export const tauntTag = (charId: EntityId): string => `taunt:${charId}`;

/** Default for DirectorOptions.hitstop: the game's reduced-motion setting turns hit-stops off. */
function viewHitstopOn(): boolean {
  if (typeof document === 'undefined') return true;
  return !document.documentElement?.classList?.contains('uh-reduced-motion');
}

/** Seconds within which another recovery continues the combo climb. */
const COMBO_WINDOW = 8;
const COMBO_MAX = 6;
/** Bump impulse (N*s) mapped to full volume; the sim only reports approaches > 2.5 m/s. */
const BUMP_FULL_IMPULSE = 400;
const FINAL_COUNTDOWN_SECONDS = 30;
/** Music intensity at kick-off (before anything happens). */
const START_INTENSITY = 0.4;
/** The siren loop takes over this long after the one-shot siren of the final countdown. */
const SIREN_LOOP_DELAY = 2;

const s2t = (s: number): number => Math.round(s * TICK_RATE);

/**
 * Police / presentation tuning (ticks at 60 Hz unless named in seconds). Exported for tests.
 */
export const POLICE_AUDIO = {
  /**
   * Spotting whistle. The sim re-emits 'policeSpotted' whenever an officer's target changes, and
   * targets flap between carriers, so only a NEW (officer, target) pair whistles: one that has not
   * been that officer's target for `respotTicks`...
   */
  respotTicks: s2t(8),
  /** ...aimed at the local team, or by an officer within this distance (m) of the listener... */
  spotEarshot: 24,
  /** ...at a target nobody whistled at this recently. */
  targetWhistleTicks: s2t(3),
  /**
   * Global whistle budget (spotting whistles + chase tweets): a bucket of `whistleBurst` tokens
   * refilled one per `whistleRefillTicks` (12 per minute sustained); any two whistles are at least
   * `whistleGapTicks` apart.
   */
  whistleBurst: 3,
  whistleRefillTicks: s2t(5),
  whistleGapTicks: s2t(0.25),
  /**
   * "멈춰!": once per (officer, target) pair, any two >= 9 s apart, and only when aimed at the local
   * team or shouted within `barkRadius` m of the listener.
   */
  barkGapTicks: s2t(9),
  barkRadius: 18,
  /** Chase tweets only for officers chasing within this distance (m) of the listener... */
  chaseRadius: 14,
  /**
   * ...each officer every 2.6 s + up to 1.2 s (per-officer jitter), any two >= 1.2 s apart, and only
   * while the whistle budget keeps a token in reserve for the next spotting whistle.
   */
  chaseTicks: s2t(2.6),
  chaseJitterTicks: s2t(1.2),
  chaseGapTicks: s2t(1.2),
  /** A tackle hit without a lunge whoosh this recently gets one layered in. */
  whooshFreshTicks: s2t(0.4),
  /** Siren: full while driving in, then settles to this level over this many seconds parked. */
  sirenParkedLevel: 0.3,
  sirenSettleSeconds: 2.5,
  /** Siren level factor while the getaway wail (final countdown) is also sounding. */
  sirenFinalFactor: 0.7,
  /** Cartoon doppler: pitch = 1 + scale * v_toward / 343, clamped to +-maxBend. */
  dopplerScale: 3,
  dopplerMaxBend: 0.08,
  /** Alarm bell: silent until the bank's hop has landed, full for a few seconds, then settles. */
  alarmDelaySeconds: 0.75,
  alarmFullSeconds: 5,
  alarmSettleSeconds: 6,
  alarmSettledLevel: 0.55,
  /** Extra distance duck on top of the spatial roll-off: 1 within near m, farLevel beyond far m. */
  alarmNear: 8,
  alarmFar: 30,
  alarmFarLevel: 0.45,
  /** Tackle on the listener: music duck (dB, s). */
  tackleDuckDb: -8,
  tackleDuckHold: 0.8,
  /** Chase music: tension levels and smoothing time constants (s). */
  tensionChasingUs: 1,
  tensionOnField: 0.6,
  tensionArriving: 0.35,
  tensionRise: 1,
  tensionFall: 2.5,
  /** Music intensity bump while officers are on the field. */
  intensityBump: 0.1,
  /** Rival safe uproots further than this (m) get no callout stinger. */
  rivalCalloutRadius: 20,
} as const;

/** Strain loop pitch per object (the uproot build-up of a bank is deep, a small safe's is high). */
export const STRAIN_PITCH: Readonly<Record<LootKind, number>> = { smallSafe: 1.15, largeSafe: 0.88, bank: 0.62 };
/** Landing thud pitch / level per safe size. */
const LAND_PITCH = { smallSafe: 1.15, largeSafe: 0.85 } as const;
const LAND_VOLUME = { smallSafe: 0.8, largeSafe: 1 } as const;
/**
 * The view's hit-stops hold the landing back when they fire (src/render/view.ts 'unanchored':
 * banks freeze 0.12 s when nearFactor(pos, 26) > 0.3, large safes 0.05 s when nearFactor(pos, 10)
 * > 0.4; nearFactor = 1 - d / radius). They are off with reduced motion (view.takeHitstop()).
 * Mirrored here because the audio module cannot import the view; a unit test cross-checks the
 * render source.
 */
export const HITSTOP = { bank: { s: 0.12, within: 26 * (1 - 0.3) }, largeSafe: { s: 0.05, within: 10 * (1 - 0.4) } } as const;
/** Callout stingers start just after the pop transient (with the banner's pop-in). */
const CALLOUT_DELAY = { safe: 0.06, bank: 0.1 } as const;
const SPEED_OF_SOUND = 343;

const len = (v: Vec2): number => Math.hypot(v.x, v.y);
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
/** Small deterministic hash -> [0, 1) (per-officer whistle jitter; no Math.random in the director). */
const hash01 = (a: number, b: number): number => {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
};

interface CarAudio {
  lastTick: number;
  lastPos: Vec2;
  /** Speed toward the listener (m/s, smoothed; positive = approaching). */
  vToward: number;
  /** Tick the car was first seen parked (siren settles from here). */
  parkedTick: number | null;
  officers: number;
}

interface OfficerAudio {
  phase: PolicePhase | null;
  lastWhoosh: number;
  /** Earliest tick of the next chase tweet. */
  nextChase: number;
  chaseCount: number;
  /** Target char id -> last tick this officer had it as its target (spot events + state). */
  targets: Map<EntityId, number>;
  /** Targets this officer already shouted "멈춰!" at. */
  barked: Set<EntityId>;
}

export class MatchAudioDirector {
  private readonly engine: AudioEngine;
  private readonly opts: Required<Omit<DirectorOptions, 'listenerCharId' | 'hitstop' | 'tauntFilter'>> & { listenerCharId: EntityId | null };
  private tauntFilter: ((charId: EntityId) => boolean) | null;
  private hitstopOn: () => boolean;
  /** Distance walked since the last footstep, per character. */
  private readonly stride = new Map<EntityId, number>();
  private activeLoops = new Set<string>();
  private combo = 0;
  private lastOwnScoreTick = -Infinity;
  private intensity = START_INTENSITY;
  private tension = 0;
  /** Last tension value sent to the engine. */
  private sentTension = 0;
  /** Last music intensity sent to the engine (smoothing steps are tiny; send on real change). */
  private sentIntensity = START_INTENSITY;
  private ended = false;
  // --- police / alarm state ---
  private readonly cars = new Map<number, CarAudio>();
  private readonly officers = new Map<EntityId, OfficerAudio>();
  private readonly alarmStart = new Map<EntityId, number>();
  private lastAnyWhistle = -Infinity;
  private lastAnyBark = -Infinity;
  private lastChaseTweet = -Infinity;
  /** Whistle budget (POLICE_AUDIO.whistleBurst tokens, refilled over time). */
  private whistleTokens: number = POLICE_AUDIO.whistleBurst;
  private whistleRefillTick = -Infinity;
  /** Target char id -> last tick any officer whistled at it. */
  private readonly targetWhistle = new Map<EntityId, number>();

  constructor(engine: AudioEngine, opts: DirectorOptions) {
    this.engine = engine;
    this.opts = {
      localTeam: opts.localTeam,
      listenerCharId: opts.listenerCharId ?? null,
      driveMusic: opts.driveMusic ?? true,
      resultJingle: opts.resultJingle ?? true,
      footsteps: opts.footsteps ?? true,
    };
    this.hitstopOn = MatchAudioDirector.hitstopFn(opts.hitstop);
    this.tauntFilter = opts.tauntFilter ?? null;
  }

  /** Which characters' taunts are heard (null = everyone's). The listener's own always plays. */
  setTauntFilter(fn: ((charId: EntityId) => boolean) | null): void {
    this.tauntFilter = fn;
  }

  private static hitstopFn(x: DirectorOptions['hitstop']): () => boolean {
    if (typeof x === 'function') return x;
    if (typeof x === 'boolean') return () => x;
    return viewHitstopOn;
  }

  /** Change which character the listener follows (e.g. spectating after a series). */
  setListenerChar(id: EntityId | null): void {
    this.opts.listenerCharId = id;
  }

  /** Whether the view's hit-stops are on (false with reduced motion). See DirectorOptions.hitstop. */
  setHitstop(on: boolean | (() => boolean) | undefined): void {
    this.hitstopOn = MatchAudioDirector.hitstopFn(on);
  }

  /**
   * Forget everything about the previous match (combo climb, footstep strides, music intensity,
   * police and alarm bookkeeping, running loops). Called on 'matchStart', so one director can
   * serve a whole series / rematches.
   */
  reset(): void {
    this.silenceLoops(new Set());
    this.stride.clear();
    this.combo = 0;
    this.lastOwnScoreTick = -Infinity;
    this.intensity = START_INTENSITY;
    this.ended = false;
    this.cars.clear();
    this.officers.clear();
    this.alarmStart.clear();
    this.lastAnyWhistle = -Infinity;
    this.lastAnyBark = -Infinity;
    this.lastChaseTweet = -Infinity;
    this.whistleTokens = POLICE_AUDIO.whistleBurst;
    this.whistleRefillTick = -Infinity;
    this.targetWhistle.clear();
    this.setTension(0);
  }

  /** Pre-match "3, 2, 1, GO": call with 3, 2, 1, 0. */
  countdown(remaining: number): void {
    this.engine.play('countdownBeep', { pitch: remaining > 0 ? 1 : 2 });
  }

  // -------------------------------------------------------------------------------------------

  onEvents(events: readonly SimEvent[], sim: AudioSimView): void {
    for (const e of events) this.onEvent(e, sim);
  }

  private charPos(sim: AudioSimView, id: EntityId): Vec2 | undefined {
    return sim.getCharacter(id)?.pos;
  }

  private entityPos(sim: AudioSimView, id: EntityId): Vec2 | undefined {
    return sim.getCharacter(id)?.pos ?? sim.getLoot(id)?.pos;
  }

  private officerPos(sim: AudioSimView, id: EntityId): Vec2 | undefined {
    return (sim.state.police ?? []).find((o) => o.id === id)?.pos;
  }

  private officer(id: EntityId): OfficerAudio {
    let o = this.officers.get(id);
    if (!o) {
      o = { phase: null, lastWhoosh: -Infinity, nextChase: -Infinity, chaseCount: 0, targets: new Map(), barked: new Set() };
      this.officers.set(id, o);
    }
    return o;
  }

  /**
   * Take one whistle from the global budget (POLICE_AUDIO.whistleBurst / whistleRefillTicks), keeping
   * `reserve` tokens back (chase tweets leave one for the next spotting whistle).
   */
  private takeWhistle(tick: number, reserve: number): boolean {
    const P = POLICE_AUDIO;
    if (tick < this.whistleRefillTick) this.whistleRefillTick = tick; // tick counter restarted
    if (Number.isFinite(this.whistleRefillTick)) {
      this.whistleTokens = Math.min(P.whistleBurst, this.whistleTokens + (tick - this.whistleRefillTick) / P.whistleRefillTicks);
    }
    this.whistleRefillTick = tick;
    if (tick - this.lastAnyWhistle < P.whistleGapTicks && tick >= this.lastAnyWhistle) return false;
    if (this.whistleTokens < 1 + reserve) return false;
    this.whistleTokens -= 1;
    this.lastAnyWhistle = tick;
    return true;
  }

  private onEvent(e: SimEvent, sim: AudioSimView): void {
    const a = this.engine;
    switch (e.type) {
      case 'emote': {
        const id = TAUNT_SFX[e.emoteId];
        if (!id) break;
        const own = e.charId === this.opts.listenerCharId;
        if (!own && this.tauntFilter && !this.tauntFilter(e.charId)) break;
        a.stop(id, tauntTag(e.charId));
        a.play(id, { pos: this.charPos(sim, e.charId), tag: tauntTag(e.charId), volume: own ? 1 : 0.85 });
        break;
      }
      case 'emoteCancel': {
        const id = TAUNT_SFX[e.emoteId];
        if (id) a.stop(id, tauntTag(e.charId));
        break;
      }
      case 'matchStart':
        this.reset();
        a.play('whistleStart');
        if (this.opts.driveMusic) {
          a.setMusicIntensity(this.intensity);
          this.sentIntensity = this.intensity;
          a.playMusic('match');
        }
        break;
      case 'grab':
        a.play('grab', { pos: this.charPos(sim, e.charId), volume: e.part === 'bankWall' ? 1 : 0.9 });
        break;
      case 'release':
        // Forced releases come with a dash hit / tackle, which already makes the noise.
        if (!e.forced) a.play('release', { pos: this.charPos(sim, e.charId), volume: 0.85 });
        break;
      case 'unanchored':
        this.uproot(e.lootId, e.kind, e.byTeam, sim);
        break;
      case 'dash':
        a.play('dash', { pos: this.charPos(sim, e.charId), pitch: e.carrying ? 0.8 : 1 });
        break;
      case 'dashHit': {
        const pos = this.charPos(sim, e.victimId);
        a.play('dashHit', { pos, volume: e.knockdown ? 1 : 0.85 });
        if (e.knockdown) a.play('knockdown', { pos, delay: 0.04 });
        break;
      }
      case 'bump': {
        const pa = this.entityPos(sim, e.aId);
        const pb = e.bId ? this.entityPos(sim, e.bId) : undefined;
        const pos = pa && pb ? { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 } : pa ?? pb;
        const heavy = !e.bId || !!sim.getLoot(e.bId) || !!sim.getLoot(e.aId);
        a.play('bump', { pos, volume: 0.25 + 0.75 * clamp01(e.impulse / BUMP_FULL_IMPULSE), pitch: heavy ? 0.8 : 1 });
        break;
      }
      case 'fenceBroken':
        a.play('fenceBreak', { pos: e.pos });
        break;
      case 'safeLoaded':
        a.play('safeLoad', { pos: sim.getLoot(e.bankId)?.pos ?? sim.getLoot(e.safeId)?.pos });
        break;
      case 'safeUnloaded': {
        a.play('safeUnload', { pos: sim.getLoot(e.safeId)?.pos });
        // "가로채기!": pulled out of a bank the other team was hauling.
        if (e.byCharId === null || e.bankCarrierTeam === null) break;
        const thief = sim.getCharacter(e.byCharId)?.team;
        if (thief === undefined || thief === e.bankCarrierTeam || sim.getLoot(e.safeId)?.kind === 'bank') break;
        if (thief === this.opts.localTeam) a.play('calloutSteal', { step: 0, delay: 0.05 });
        else if (e.bankCarrierTeam === this.opts.localTeam) a.play('calloutSteal', { step: -1, delay: 0.05, volume: 0.85 });
        break;
      }
      case 'recoveryStart': {
        const own = e.team === this.opts.localTeam;
        a.play('recoverStart', { pos: sim.getLoot(e.lootId)?.pos, tag: e.lootId, volume: own ? 0.9 : 0.65, step: own ? 0 : -2 });
        break;
      }
      case 'recoveryCancel':
        a.stop('recoverStart', e.lootId);
        a.play('recoverCancel', { pos: sim.getLoot(e.lootId)?.pos, volume: e.team === this.opts.localTeam ? 1 : 0.7 });
        break;
      case 'recovered': {
        a.stop('recoverStart', e.lootId);
        const own = e.team === this.opts.localTeam;
        let step = -2;
        if (own) {
          // A negative gap means the tick counter restarted (new match without reset): no combo.
          const gap = e.tick - this.lastOwnScoreTick;
          this.combo = gap >= 0 && gap <= COMBO_WINDOW * TICK_RATE ? Math.min(COMBO_MAX, this.combo + 1) : 0;
          this.lastOwnScoreTick = e.tick;
          step = this.combo;
        }
        const id = e.kind === 'bank' ? 'scoreBank' : e.kind === 'largeSafe' ? 'scoreLarge' : 'scoreSmall';
        a.play(id, { volume: own ? 1 : 0.7, step });
        break;
      }
      case 'finalCountdown':
        a.play('siren');
        if (this.opts.driveMusic) a.playMusic('final');
        break;
      case 'ejected':
        a.play('eject', { pos: e.pos });
        break;
      case 'unstuck':
        a.play('eject', { pos: e.pos, volume: 0.5, pitch: 1.2 });
        break;
      case 'ping':
        // Pings are team call-outs: opponents never hear them.
        if (e.team === this.opts.localTeam) a.play('ping', { variant: e.kind === 'grabTogether' ? 0 : 1 });
        break;
      case 'matchEnd': {
        this.ended = true;
        this.stop();
        a.play('hornEnd');
        if (this.opts.driveMusic) a.playMusic('none');
        if (this.opts.resultJingle) {
          const w = e.result.winner;
          a.play(w === null ? 'draw' : w === this.opts.localTeam ? 'victory' : 'defeat', { delay: 1.4 });
        }
        break;
      }
      case 'bankBodyRecovered':
        break;
      // --- police ---------------------------------------------------------------------------
      case 'alarm':
        if (!this.alarmStart.has(e.bankId)) this.alarmStart.set(e.bankId, e.tick);
        break;
      case 'policeDispatched':
        this.cars.set(e.carId, { lastTick: -1, lastPos: { x: 0, y: 0 }, vToward: 0, parkedTick: null, officers: Math.max(1, e.officerIds.length) });
        break;
      case 'policeArrived': {
        // Drift stop at the curb, then one door per officer hopping out.
        a.play('policeSkid', { pos: e.pos });
        const n = Math.min(4, this.cars.get(e.carId)?.officers ?? 2);
        for (let k = 0; k < n; k++) a.play('carDoor', { pos: e.pos, delay: 0.34 + k * 0.16, pitch: 1 + (k % 2 ? -0.06 : 0.04) });
        break;
      }
      case 'policeSpotted':
        this.spotted(e.officerId, e.charId, e.tick, sim);
        break;
      case 'policeTackle':
        this.tackle(e.officerId, e.victimId, e.hit, e.tick, sim);
        break;
      case 'policeStunned':
        a.play('policeStun', { pos: this.officerPos(sim, e.officerId) });
        break;
      case 'policeLeaving': {
        const car = (sim.state.policeCars ?? []).find((c) => c.id === e.carId);
        a.play('carVroom', { pos: car?.pos, delay: 0.15 });
        const others = (sim.state.policeCars ?? []).some((c) => c.id !== e.carId && (c.phase === 'arriving' || c.phase === 'parked'));
        if (!others) a.play('policePhew', { delay: 0.9 });
        break;
      }
      case 'policeGone':
        this.cars.delete(e.carId);
        break;
    }
  }

  /** The uproot moment: POP now, landing when the hop comes down, callout stinger. */
  private uproot(lootId: EntityId, kind: LootKind, byTeam: TeamId | null, sim: AudioSimView): void {
    const a = this.engine;
    const pos = sim.getLoot(lootId)?.pos;
    const listener = this.listenerChar(sim.state)?.pos;
    const d = pos && listener ? dist(pos, listener) : Infinity;
    const own = byTeam === this.opts.localTeam;
    const hitstops = this.hitstopOn();
    if (kind === 'bank') {
      a.play('unanchorBank', { pos });
      a.play('bankLand', { pos, delay: LAND_DELAY.bank + (hitstops && d < HITSTOP.bank.within ? HITSTOP.bank.s : 0) });
      // "은행째!" — the HUD stamps it on the bank uproot (src/game/match.ts handleCallouts).
      a.play('calloutBank', { step: own || byTeam === null ? 0 : -1, delay: CALLOUT_DELAY.bank, volume: own ? 1 : 0.8 });
      return;
    }
    a.play('unanchorSafe', { pos, pitch: kind === 'largeSafe' ? 0.85 : 1 });
    const hitstop = hitstops && kind === 'largeSafe' && d < HITSTOP.largeSafe.within ? HITSTOP.largeSafe.s : 0;
    a.play('uprootLand', { pos, delay: LAND_DELAY[kind] + hitstop, pitch: LAND_PITCH[kind], volume: LAND_VOLUME[kind] });
    if (own) a.play('calloutUproot', { step: 0, delay: CALLOUT_DELAY.safe });
    else if (byTeam !== null && d < POLICE_AUDIO.rivalCalloutRadius) a.play('calloutUproot', { step: -1, delay: CALLOUT_DELAY.safe, volume: 0.6 });
  }

  /**
   * An officer acquired a target: a whistle (+ "멈춰!") only for a genuinely new pursuit that
   * concerns the listener, within the global whistle budget (see POLICE_AUDIO).
   */
  private spotted(officerId: EntityId, charId: EntityId, tick: number, sim: AudioSimView): void {
    const P = POLICE_AUDIO;
    const o = this.officer(officerId);
    const since = tick - (o.targets.get(charId) ?? -Infinity);
    o.targets.set(charId, tick);
    // Re-acquiring a carrier it was chasing moments ago (target flapping, after a lunge): silent.
    if (since >= 0 && since < P.respotTicks) return;
    const pos = this.officerPos(sim, officerId);
    const me = this.listenerChar(sim.state);
    const onMe = charId === me?.id;
    const ours = onMe || sim.getCharacter(charId)?.team === this.opts.localTeam;
    const d = pos && me ? dist(pos, me.pos) : Infinity;
    if (!ours && !(d <= P.spotEarshot)) return;
    const pitch = this.officerPitch(officerId);
    const lastAtTarget = this.targetWhistle.get(charId) ?? -Infinity;
    if (!(tick - lastAtTarget >= 0 && tick - lastAtTarget < P.targetWhistleTicks) && this.takeWhistle(tick, 0)) {
      this.engine.play('policeWhistle', { pos, volume: onMe ? 1 : 0.85, pitch });
      this.targetWhistle.set(charId, tick);
      o.nextChase = tick + P.chaseTicks;
    }
    if (!o.barked.has(charId) && (ours || d <= P.barkRadius) && !(tick - this.lastAnyBark >= 0 && tick - this.lastAnyBark < P.barkGapTicks)) {
      this.engine.play('policeBark', { pos, delay: 0.2, volume: onMe ? 1 : 0.85, pitch });
      o.barked.add(charId);
      this.lastAnyBark = tick;
    }
  }

  private tackle(officerId: EntityId, victimId: EntityId, hit: boolean, tick: number, sim: AudioSimView): void {
    const a = this.engine;
    const o = this.officer(officerId);
    const opos = this.officerPos(sim, officerId);
    const vpos = this.charPos(sim, victimId) ?? opos;
    const onMe = victimId === this.listenerChar(sim.state)?.id;
    if (hit) {
      // The lunge started and landed within one frame batch: layer the whoosh in.
      if (tick - o.lastWhoosh > POLICE_AUDIO.whooshFreshTicks) a.play('tackleWhoosh', { pos: opos, volume: 0.6 });
      a.play('tackleHit', { pos: vpos, volume: onMe ? 1 : 0.9 });
      // The knockdown "boing" after the slam body (its thud stacked on the slam ate the headroom).
      a.play('knockdown', { pos: vpos, delay: 0.14, volume: 0.7 });
      if (onMe) a.duckMusic(POLICE_AUDIO.tackleDuckDb, POLICE_AUDIO.tackleDuckHold);
    } else {
      a.play('tackleMiss', { pos: opos });
      // "태클 피했다!"
      if (onMe) a.play('calloutDodge', { delay: 0.12 });
    }
  }

  private officerPitch(id: EntityId): number {
    return 1 + ((id % 3) - 1) * 0.035;
  }

  // -------------------------------------------------------------------------------------------

  /** Per rendered frame: listener, loops, footsteps, police and music. */
  update(sim: AudioSimView, dt: number, listenerPos?: Vec2): void {
    const st = sim.state;
    // Clamp long frame gaps (tab switches) so smoothing and footsteps never jump.
    const step = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
    const listener = listenerPos ?? this.listenerChar(st)?.pos;
    if (listener) this.engine.setListener(listener);
    if (st.over || this.ended) {
      this.silenceLoops(new Set());
      return;
    }

    const live = new Set<string>();
    const loop = (id: LoopId, i: number, pos: Vec2 | undefined, key: EntityId | string, pitch = 1): void => {
      if (i <= 0) return;
      this.engine.setLoop(id, i, pos, key, pitch);
      live.add(`${id}|${key}`);
    };

    let bankMoving = false;
    let recovering = false;
    for (const l of st.loot) {
      if (l.recovered) continue;
      if (l.recovery) recovering = true;
      if (l.anchored) {
        if (l.grabbedBy.some((id) => sim.getCharacter(id)?.straining)) loop('strain', 0.15 + 0.85 * clamp01(l.unanchorProgress), l.pos, l.id, STRAIN_PITCH[l.kind]);
        continue;
      }
      const speed = len(l.vel);
      if (l.kind === 'bank') {
        const s = speed + Math.abs(l.angVel) * 3;
        if (s > 0.06) {
          loop('bankRumble', clamp01(s / 1.4), l.pos, l.id);
          if (s > 0.3) bankMoving = true;
        }
      } else if (l.grabbedBy.length > 0 && l.floorOf === null && speed > 0.15) {
        loop('drag', clamp01(speed / 3.5), l.pos, l.id);
      }
    }

    if (st.finalCountdown && st.finalCountdownTick !== null) {
      const since = (st.tick - st.finalCountdownTick) / TICK_RATE;
      if (since > SIREN_LOOP_DELAY) {
        // Urgency 0.25 -> 1 over the last 30 s: the distant wails come nearer, and only in the
        // last seconds do they fill the gaps between phrases (see loops.ts sirenLoop).
        const left = Number.isFinite(st.endTick) ? (st.endTick - st.tick) / TICK_RATE : FINAL_COUNTDOWN_SECONDS;
        loop('sirenLoop', 0.25 + 0.75 * clamp01(1 - left / FINAL_COUNTDOWN_SECONDS), undefined, 'final');
      }
    }

    this.policeSirens(st, listener, loop);
    this.alarmBells(sim, listener, loop);
    this.silenceLoops(live);

    const policeOnField = this.policeUpdate(st, listener);
    if (this.opts.footsteps) this.footsteps(st, step);
    if (this.opts.driveMusic) {
      if (!st.finalCountdown) this.driveMusic(st, step, bankMoving, recovering, policeOnField > 0);
      this.driveTension(step, policeOnField);
    }
  }

  /** Silence every loop this director started and drop the chase layer (pause menu, leaving). */
  stop(): void {
    this.silenceLoops(new Set());
    this.setTension(0);
  }

  private silenceLoops(live: Set<string>): void {
    for (const k of this.activeLoops) {
      if (live.has(k)) continue;
      const sep = k.indexOf('|');
      this.engine.setLoop(k.slice(0, sep) as LoopId, 0, undefined, k.slice(sep + 1));
    }
    this.activeLoops = live;
  }

  private listenerChar(st: SimState): CharacterState | undefined {
    const id = this.opts.listenerCharId;
    if (id !== null) return st.characters.find((c) => c.id === id);
    return st.characters.find((c) => !c.isBot && c.team === this.opts.localTeam) ?? st.characters[0];
  }

  /** One siren per car with its siren on: doppler bend while moving, settling once parked. */
  private policeSirens(st: SimState, listener: Vec2 | undefined, loop: (id: LoopId, i: number, pos: Vec2 | undefined, key: string, pitch?: number) => void): void {
    const P = POLICE_AUDIO;
    const seen = new Set<number>();
    for (const c of st.policeCars ?? []) {
      seen.add(c.id);
      let ca = this.cars.get(c.id);
      if (!ca) {
        ca = { lastTick: -1, lastPos: { x: c.pos.x, y: c.pos.y }, vToward: 0, parkedTick: null, officers: 2 };
        this.cars.set(c.id, ca);
      }
      // Speed toward the listener from the car's own motion (the player running around must not
      // wobble the siren's pitch).
      if (ca.lastTick >= 0 && st.tick > ca.lastTick && listener) {
        const ddt = (st.tick - ca.lastTick) / TICK_RATE;
        const vx = (c.pos.x - ca.lastPos.x) / ddt;
        const vy = (c.pos.y - ca.lastPos.y) / ddt;
        const d = dist(c.pos, listener);
        const toward = d > 1e-3 ? (vx * (listener.x - c.pos.x) + vy * (listener.y - c.pos.y)) / d : 0;
        ca.vToward += (toward - ca.vToward) * 0.5;
      } else if (st.tick < ca.lastTick) {
        ca.vToward = 0;
      }
      if (st.tick !== ca.lastTick) {
        ca.lastTick = st.tick;
        ca.lastPos = { x: c.pos.x, y: c.pos.y };
      }
      if (c.phase === 'parked' && ca.parkedTick === null) ca.parkedTick = st.tick;
      if (!c.sirenOn || c.phase === 'gone') continue;
      let level = 1;
      if (c.phase === 'parked' && ca.parkedTick !== null) {
        const k = clamp01((st.tick - ca.parkedTick) / TICK_RATE / P.sirenSettleSeconds);
        level = 1 + (P.sirenParkedLevel - 1) * smoothstep(0, 1, k);
      }
      if (st.finalCountdown) level *= P.sirenFinalFactor;
      const bend = Math.max(-P.dopplerMaxBend, Math.min(P.dopplerMaxBend, (P.dopplerScale * ca.vToward) / SPEED_OF_SOUND));
      loop('policeSiren', level, c.pos, `car${c.id}`, 1 + bend);
    }
    for (const id of [...this.cars.keys()]) if (!seen.has(id) && this.cars.get(id)!.lastTick >= 0) this.cars.delete(id);
  }

  /** Alarm bell intensity for a bank that started ringing `seconds` ago, `d` m from the listener. */
  static alarmLevel(seconds: number, d: number): number {
    const P = POLICE_AUDIO;
    const t = seconds - P.alarmDelaySeconds;
    if (t <= 0) return 0;
    const attack = clamp01(t / 0.15);
    const settle = smoothstep(P.alarmFullSeconds, P.alarmFullSeconds + P.alarmSettleSeconds, t);
    const env = attack * (1 + (P.alarmSettledLevel - 1) * settle);
    const far = Number.isFinite(d) ? smoothstep(P.alarmNear, P.alarmFar, d) : 1;
    return env * (1 + (P.alarmFarLevel - 1) * far);
  }

  private alarmBells(sim: AudioSimView, listener: Vec2 | undefined, loop: (id: LoopId, i: number, pos: Vec2 | undefined, key: string) => void): void {
    const st = sim.state;
    const ringing = st.alarm?.ringing ?? [];
    for (const id of ringing) {
      const bank = sim.getLoot(id);
      if (!bank || bank.recovered) continue;
      let start = this.alarmStart.get(id);
      if (start === undefined || start > st.tick) {
        start = st.tick;
        this.alarmStart.set(id, start);
      }
      const d = listener ? dist(bank.pos, listener) : Infinity;
      loop('alarmBell', MatchAudioDirector.alarmLevel((st.tick - start) / TICK_RATE, d), bank.pos, `bank${id}`);
    }
    for (const id of [...this.alarmStart.keys()]) if (!ringing.includes(id)) this.alarmStart.delete(id);
  }

  /**
   * Officer bookkeeping: lunge whooshes (phase -> 'tackle') and rate-limited chase tweets near the
   * listener. Returns the chase tension target (0 = no police on the field).
   */
  private policeUpdate(st: SimState, listener: Vec2 | undefined): number {
    const P = POLICE_AUDIO;
    const police = st.police ?? [];
    const seen = new Set<EntityId>();
    let onField = 0;
    let chasingUs = false;
    const localIds = new Set(st.characters.filter((c) => c.team === this.opts.localTeam).map((c) => c.id));
    for (const o of police) {
      seen.add(o.id);
      const oa = this.officer(o.id);
      if (o.phase === 'tackle' && oa.phase !== 'tackle' && oa.phase !== null) {
        this.engine.play('tackleWhoosh', { pos: o.pos });
        oa.lastWhoosh = st.tick;
      }
      oa.phase = o.phase;
      // Remember the pursuit, so a re-acquisition of the same carrier stays silent (spotted()).
      if (o.targetCharId !== null) oa.targets.set(o.targetCharId, st.tick);
      if (o.phase !== 'leaving' && o.phase !== 'gone') onField++;
      if ((o.phase === 'chase' || o.phase === 'tackle') && o.targetCharId !== null && localIds.has(o.targetCharId)) chasingUs = true;
      if (o.phase === 'chase' && listener && dist(o.pos, listener) < P.chaseRadius) {
        if (st.tick < this.lastChaseTweet) this.lastChaseTweet = -Infinity; // tick counter restarted
        if (st.tick >= oa.nextChase && st.tick - this.lastChaseTweet >= P.chaseGapTicks && this.takeWhistle(st.tick, 1)) {
          this.engine.play('policeWhistle', { pos: o.pos, volume: 0.75, pitch: this.officerPitch(o.id) });
          if (o.targetCharId !== null) this.targetWhistle.set(o.targetCharId, st.tick);
          this.lastChaseTweet = st.tick;
          oa.chaseCount++;
          oa.nextChase = st.tick + P.chaseTicks + Math.floor(hash01(o.id, oa.chaseCount) * P.chaseJitterTicks);
        }
      }
    }
    for (const id of [...this.officers.keys()]) if (!seen.has(id)) this.officers.delete(id);
    if (chasingUs) return P.tensionChasingUs;
    if (onField > 0) return P.tensionOnField;
    if ((st.policeCars ?? []).some((c) => c.phase === 'arriving')) return P.tensionArriving;
    return 0;
  }

  private setTension(x: number): void {
    this.tension = x;
    this.sentTension = x;
    this.engine.setMusicTension(x);
  }

  private driveTension(dt: number, target: number): void {
    const P = POLICE_AUDIO;
    const tau = target > this.tension ? P.tensionRise : P.tensionFall;
    const next = this.tension + (target - this.tension) * (1 - Math.exp(-dt / tau));
    const snapped = next < 0.005 && target === 0 ? 0 : next;
    this.tension = snapped;
    if (Math.abs(snapped - this.sentTension) > 0.004 || (snapped === 0 && this.sentTension !== 0)) {
      this.engine.setMusicTension(snapped);
      this.sentTension = snapped;
    }
  }

  private footsteps(st: SimState, dt: number): void {
    const listenerId = this.listenerChar(st)?.id;
    for (const c of st.characters) {
      const intent = len(c.moveIntent);
      const speed = len(c.vel);
      if (c.knockdownTicks > 0 || intent < 0.2 || speed < 0.6 || c.dashTicks > 0) {
        this.stride.set(c.id, Math.min(this.stride.get(c.id) ?? 0, 0.3));
        continue;
      }
      // Short raccoon legs: stride grows a little with speed.
      const strideLen = 0.42 + 0.06 * speed;
      const d = (this.stride.get(c.id) ?? 0) + speed * dt;
      if (d >= strideLen) {
        this.stride.set(c.id, d - strideLen);
        const own = c.id === listenerId;
        this.engine.play('footstep', {
          pos: c.pos,
          volume: (own ? 0.55 : 0.7) * (0.6 + 0.4 * clamp01(speed / 5)),
          pitch: 1 + ((c.slot % 4) - 1.5) * 0.04,
        });
      } else {
        this.stride.set(c.id, d);
      }
    }
  }

  private driveMusic(st: SimState, dt: number, bankMoving: boolean, recovering: boolean, police: boolean): void {
    const diff = Math.abs(st.scores[0] - st.scores[1]);
    const close = 1 - clamp01(diff / 1000);
    const secondsLeft = Number.isFinite(st.endTick) ? (st.endTick - st.tick) / TICK_RATE : Infinity;
    let target = 0.42;
    if (bankMoving) target += 0.2;
    if (recovering) target += 0.15;
    if (st.scores[0] + st.scores[1] > 0) target += 0.15 * close;
    if (secondsLeft < 60) target += 0.15;
    if (police) target += POLICE_AUDIO.intensityBump;
    target = Math.max(0.3, Math.min(1, target));
    // Slow exponential smoothing (~3 s) so layers don't flicker with every event.
    const k = 1 - Math.exp(-dt / 3);
    const next = this.intensity + (target - this.intensity) * k;
    this.intensity = next;
    if (Math.abs(next - this.sentIntensity) > 0.002) {
      this.engine.setMusicIntensity(next);
      this.sentIntensity = next;
    }
  }
}
