/**
 * [F8] Tension audio (fun-plan WP8 + content-plan §6 F8 delta): the cue recipes (./sfxTension.ts),
 * their captions and voice limits, and the director's "[F8]" section — heartbeat (only while
 * matchPointInfo is non-null, checked on a recorded match), stings from moments, the run-driven
 * coin climb (deposits >= 50 count), tier layers, the final 10 s, the getaway drive-off, accents,
 * bark blips, the event-warning duck and the golden-hammer landing sting.
 */
import { describe, expect, it } from 'vitest';
import { AudioEngine, MatchAudioDirector, type AudioSimView, type PlayOptions, type SfxId } from '../../src/audio';
import { CAPTION_FALLBACK, CAPTION_REPEAT_MS, SFX_CAPTION_KEYS, TENSION_CAPTION_KEYS } from '../../src/audio/captions';
import { TENSION_AUDIO, type TensionState } from '../../src/audio/director';
import { mockContext } from '../../src/audio/dev/mockAudioContext';
import { SFX_IDS, type LoopId, type MusicId } from '../../src/audio/ids';
import { SFX_RECIPES } from '../../src/audio/sfx';
import { BARK_VARIANT, LEAD_BANK_VARIANT, TENSION_RECIPES } from '../../src/audio/sfxTension';
import { createMatch } from '../../src/ai/harness';
import { MomentTracker } from '../../src/game/moments';
import type { Moment } from '../../src/shared/moments';
import { TICK_RATE } from '../../src/sim/config';
import { matchPointInfo } from '../../src/sim/queries';
import type { CharacterState, LayoutId, SimEvent, SimState, TeamId, Vec2 } from '../../src/sim/types';
import { en } from '../../src/ui/strings/en';
import { ko } from '../../src/ui/strings/ko';

const TENSION_IDS = Object.keys(TENSION_RECIPES) as SfxId[];

// ---------------------------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------------------------

interface Call {
  fn: string;
  id?: string;
  o?: PlayOptions;
  x?: number;
  tick?: number;
}

class RecordingEngine {
  calls: Call[] = [];
  tick = 0;
  play(id: SfxId, o: PlayOptions = {}): void {
    this.calls.push({ fn: 'play', id, o, tick: this.tick });
  }
  stop(): void {}
  setLoop(_id: LoopId): void {}
  playMusic(_id: MusicId): void {}
  setMusicIntensity(x: number): void {
    this.calls.push({ fn: 'intensity', x });
  }
  setMusicTension(): void {}
  duckMusic(db: number): void {
    this.calls.push({ fn: 'duck', x: db, tick: this.tick });
  }
  setListener(): void {}
  played(id: string): Call[] {
    return this.calls.filter((c) => c.fn === 'play' && c.id === id);
  }
  plays(): string[] {
    return this.calls.filter((c) => c.fn === 'play').map((c) => c.id!);
  }
  clear(): void {
    this.calls = [];
  }
}

function char(id: number, team: 0 | 1, pos: Vec2): CharacterState {
  return {
    id, slot: id - 1, team, name: `c${id}`, isBot: id !== 1, look: { hat: 'none' }, pos, vel: { x: 0, y: 0 }, facing: 0,
    moveIntent: { x: 0, y: 0 }, grab: null, straining: false, dashTicks: 0, dashCooldown: 0, boostTicks: 0,
    knockdownTicks: 0, protectTicks: 0, floorOf: null,
  };
}

function view(chars: CharacterState[]): AudioSimView {
  const state = {
    layoutId: 'plaza', tick: 600, endTick: 14400, over: false, result: null, scores: [0, 0], characters: chars, loot: [],
    fences: [], banksRecovered: 0, finalCountdown: false, finalCountdownTick: null, remainingValue: 4000, totalValue: 4000, pings: [],
    police: [], policeCars: [], alarm: { ringing: [], dispatchTick: null, waves: 0 },
    coins: [], breakables: [], items: [], hazards: [], projectiles: [], gimmicks: [], matchEvents: [], eventPlan: null,
  } as unknown as SimState;
  return { state, getLoot: () => undefined, getCharacter: (id) => chars.find((c) => c.id === id) };
}

const ME = char(1, 0, { x: 10, y: 10 });
const RIVAL = char(2, 1, { x: 14, y: 10 });

function setup(o: { tauntFilter?: (id: number) => boolean; driveMusic?: boolean } = {}): { eng: RecordingEngine; dir: MatchAudioDirector; sim: AudioSimView } {
  const eng = new RecordingEngine();
  const dir = new MatchAudioDirector(eng as unknown as AudioEngine, { localTeam: 0, listenerCharId: 1, footsteps: false, driveMusic: o.driveMusic ?? false, tauntFilter: o.tauntFilter ?? null });
  return { eng, dir, sim: view([{ ...ME }, { ...RIVAL }]) };
}

const calm: TensionState = { matchPoint: null, secondsLeft: 120, run: null };
/** Feed `n` ticks of tension state (one setTension per tick, like match.ts funObserve). */
function feed(eng: RecordingEngine, dir: MatchAudioDirector, n: number, t: Partial<TensionState> | ((i: number) => Partial<TensionState>)): void {
  for (let i = 0; i < n; i++) {
    eng.tick++;
    dir.setTension({ ...calm, ...(typeof t === 'function' ? t(i) : t) });
  }
}

const mom = (kind: Moment['kind'], team: TeamId, extra: Partial<Moment> = {}): Moment => ({ kind, team, tick: 1000, ...extra });

// ---------------------------------------------------------------------------------------------
// Recipes, captions, limits
// ---------------------------------------------------------------------------------------------

describe('tension recipes', () => {
  it('every tension cue is a registered SfxId with a recipe, 2-4 variations and at most 2 voices', () => {
    expect(TENSION_IDS.length).toBe(15);
    for (const id of TENSION_IDS) {
      expect(SFX_IDS, id).toContain(id);
      const r = SFX_RECIPES[id];
      expect(r, id).toBe(TENSION_RECIPES[id as keyof typeof TENSION_RECIPES]);
      expect(r.bus, id).toBe('sfx');
      expect(r.variants, id).toBeGreaterThanOrEqual(2);
      expect(r.variants, id).toBeLessThanOrEqual(4);
      // fun-plan WP8: no cue overlaps itself more than 2 voices deep.
      expect(r.maxVoices, id).toBeLessThanOrEqual(2);
    }
    expect(SFX_RECIPES.stingLead.variants).toBeGreaterThan(LEAD_BANK_VARIANT);
    expect(SFX_RECIPES.barkBlip.variants).toBe(Object.keys(BARK_VARIANT).length);
  });

  it('every tension cue has a caption in ko and en, also in the UI tables', () => {
    expect(TENSION_CAPTION_KEYS.length).toBe(TENSION_IDS.length);
    const ui = { ko: ko as Record<string, string>, en: en as Record<string, string> };
    for (const id of TENSION_IDS) {
      const key = SFX_CAPTION_KEYS[id];
      expect(key, id).toBe(`caption.${id}`);
      expect(TENSION_CAPTION_KEYS).toContain(key);
      const k = CAPTION_FALLBACK.ko[key!];
      const e = CAPTION_FALLBACK.en[key!];
      expect(k, `${id} ko`).toMatch(/^\[.+\]$/);
      expect(e, `${id} en`).toMatch(/^\[.+\]$/);
      expect(/[가-힣]/.test(k!), `${id} ko is Korean`).toBe(true);
      expect(/[가-힣]/.test(e!), `${id} en has no Hangul`).toBe(false);
      expect(ui.ko[key!], `${id} ui ko`).toBe(k);
      expect(ui.en[key!], `${id} ui en`).toBe(e);
    }
    // The heartbeat beats every ~0.7 s: its caption is throttled to one line per several seconds.
    expect(CAPTION_REPEAT_MS['caption.tensionHeartbeat']).toBeGreaterThanOrEqual(5000);
  });

  it('the engine never stacks a tension cue deeper than 2', async () => {
    const ctx = mockContext();
    const engine = new AudioEngine({ createContext: () => ctx, autoPump: false, seed: 3 });
    await engine.unlock();
    const live = (id: string): number =>
      (engine as unknown as { voices: { id: string; end: number; priority: number }[] }).voices.filter((v) => v.id === id && v.priority >= 0 && v.end > ctx.currentTime).length;
    for (const id of TENSION_IDS) {
      let maxLive = 0;
      for (let i = 0; i < 14; i++) {
        engine.play(id, { volume: 1, step: i % 2 ? -1 : 0 });
        maxLive = Math.max(maxLive, live(id));
        ctx.currentTime += 0.11;
      }
      expect(maxLive, id).toBeLessThanOrEqual(2);
      expect(maxLive, id).toBeGreaterThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------------------------

describe('director [F8]: match point heartbeat', () => {
  it('beats only while a match point lasts: warm for ours, faster and tense for theirs, music ducked 3 dB', () => {
    const { eng, dir } = setup();
    feed(eng, dir, 120, {});
    expect(eng.played('tensionHeartbeat')).toHaveLength(0);
    // ours for 4 s: a beat at once, then every heartbeatTicks.ours
    feed(eng, dir, 240, { matchPoint: 'ours' });
    let beats = eng.played('tensionHeartbeat');
    expect(beats.length).toBe(Math.ceil(240 / TENSION_AUDIO.heartbeatTicks.ours));
    expect(beats.every((b) => (b.o?.step ?? 0) === 0)).toBe(true);
    expect(beats[1]!.tick! - beats[0]!.tick!).toBe(TENSION_AUDIO.heartbeatTicks.ours);
    const ducks = eng.calls.filter((c) => c.fn === 'duck');
    expect(ducks.length).toBe(beats.length);
    expect(ducks.every((d) => d.x === TENSION_AUDIO.heartbeatDuckDb && d.x === -3)).toBe(true);
    // switch to theirs: beats at once, faster, rival flavor
    eng.clear();
    feed(eng, dir, 240, { matchPoint: 'theirs' });
    beats = eng.played('tensionHeartbeat');
    expect(beats[0]!.tick).toBe(eng.tick - 239);
    expect(beats.length).toBe(Math.ceil(240 / TENSION_AUDIO.heartbeatTicks.theirs));
    expect(beats.every((b) => (b.o?.step ?? 0) < 0)).toBe(true);
    // gone: silence
    eng.clear();
    feed(eng, dir, 300, {});
    expect(eng.played('tensionHeartbeat')).toHaveLength(0);
  });

  it('rushes in the last 10 s, and an event warning ducks it (no music duck) until the event fires', () => {
    const { eng, dir, sim } = setup();
    feed(eng, dir, 1170, (i) => ({ matchPoint: 'ours', secondsLeft: 20 - i / TICK_RATE }));
    const beats = eng.played('tensionHeartbeat').map((b) => b.tick!);
    const gaps = beats.slice(1).map((t, i) => t - beats[i]!);
    expect(gaps[0]).toBe(TENSION_AUDIO.heartbeatTicks.ours);
    expect(gaps.at(-1)!).toBeLessThan(TENSION_AUDIO.heartbeatTicks.ours * 0.8);
    // event warning
    const { eng: e2, dir: d2 } = setup();
    feed(e2, d2, 10, { matchPoint: 'ours' });
    d2.onEvents([{ type: 'matchEvent', tick: 10, kind: 'moneyRain', phase: 'warn', pos: { x: 0, y: 0 } }], sim);
    e2.clear();
    feed(e2, d2, 200, { matchPoint: 'ours' });
    const warned = e2.played('tensionHeartbeat');
    expect(warned.length).toBeGreaterThan(2);
    expect(warned.every((b) => (b.o?.volume ?? 1) <= TENSION_AUDIO.heartbeatVolume.ours * TENSION_AUDIO.warnHeartbeatScale + 1e-9)).toBe(true);
    expect(e2.calls.filter((c) => c.fn === 'duck')).toHaveLength(0);
    d2.onEvents([{ type: 'matchEvent', tick: 210, kind: 'moneyRain', phase: 'start', pos: { x: 0, y: 0 } }], sim);
    e2.clear();
    feed(e2, d2, 100, { matchPoint: 'ours' });
    expect(e2.played('tensionHeartbeat').every((b) => b.o?.volume === TENSION_AUDIO.heartbeatVolume.ours)).toBe(true);
  });

  it('stops for good at the end of the match', () => {
    const { eng, dir, sim } = setup();
    feed(eng, dir, 60, { matchPoint: 'ours' });
    dir.onEvents([{ type: 'matchEnd', tick: 60, result: { reason: 'decided', winner: 0, scores: [2100, 1000], endTick: 60 } }], sim);
    eng.clear();
    feed(eng, dir, 300, { matchPoint: 'ours' });
    expect(eng.played('tensionHeartbeat')).toHaveLength(0);
  });

  // fun-plan WP8 acceptance: "Heartbeat is active only while matchPointInfo is non-null (unit test
  // with the director on a recorded event log)". A real police-on match (seeded, deterministic) is
  // recorded and fed exactly like match.ts funObserve: tracker.observe -> setTension -> onMoments
  // -> onEvents, every tick.
  it('on a recorded match: every heartbeat falls on a tick where matchPointInfo is non-null, and every match point of 1 s or more beats', () => {
    const cases: { layout: LayoutId; seed: number; rival: 'hodadak' | 'tongkeun' | 'nunchi'; aTeam: TeamId }[] = [
      { layout: 'counter', seed: 1017, rival: 'hodadak', aTeam: 0 },
      { layout: 'counter', seed: 1017, rival: 'hodadak', aTeam: 1 },
      { layout: 'counter', seed: 1017, rival: 'tongkeun', aTeam: 0 },
    ];
    let checked = 0;
    for (const c of cases) {
      const proxy = { personality: 'hodadak' as const, difficulty: 'normal' as const, humanProxy: true };
      const bot = { personality: c.rival, difficulty: 'normal' as const };
      const { sim, bots } = createMatch({ layout: c.layout, team0: c.aTeam === 0 ? [proxy] : [bot], team1: c.aTeam === 0 ? [bot] : [proxy], seed: c.seed, rules: { police: true, content: 'v2' } });
      const me = sim.characterBySlot(c.aTeam === 0 ? 0 : 1);
      const eng = new RecordingEngine();
      const dir = new MatchAudioDirector(eng as unknown as AudioEngine, { localTeam: c.aTeam, listenerCharId: me.id, footsteps: false });
      const tracker = new MomentTracker({ localTeam: c.aTeam, localCharId: me.id, earlyDecision: sim.rules.earlyDecision, isFree: (p) => sim.isFree(p, 0.45) });
      const mpTicks = new Set<number>();
      const episodes: { from: number; to: number }[] = [];
      while (!sim.state.over && sim.state.tick < 300 * TICK_RATE) {
        const ev: SimEvent[] = sim.step(bots.map((b) => b.update(sim)));
        const moments = tracker.observe(sim.state, ev, []);
        const snap = tracker.snapshot();
        const mp = snap.matchPoint;
        // the snapshot IS matchPointInfo for this tick
        expect(!!mp).toBe(!!matchPointInfo(sim.state, { earlyDecision: sim.rules.earlyDecision }));
        eng.tick = sim.state.tick;
        if (mp) {
          mpTicks.add(sim.state.tick);
          const last = episodes.at(-1);
          if (last && last.to === sim.state.tick - 1) last.to = sim.state.tick;
          else episodes.push({ from: sim.state.tick, to: sim.state.tick });
        }
        const left = sim.ticksLeft();
        dir.setTension({
          matchPoint: mp ? (mp.team === c.aTeam ? 'ours' : 'theirs') : null,
          secondsLeft: Number.isFinite(left) ? Math.max(0, left) / TICK_RATE : Infinity,
          run: snap.run ? { side: snap.run.team === c.aTeam ? 'ours' : 'theirs', recoveries: snap.run.recoveries, tier: snap.run.tier } : null,
        });
        dir.onMoments(moments);
        if (ev.length) dir.onEvents(ev, sim);
      }
      const beats = eng.played('tensionHeartbeat');
      for (const b of beats) expect(mpTicks.has(b.tick!), `beat at tick ${b.tick}`).toBe(true);
      const long = episodes.filter((e) => e.to - e.from + 1 >= TICK_RATE);
      for (const e of long) {
        const inside = beats.filter((b) => b.tick! >= e.from && b.tick! <= e.to).length;
        expect(inside, `episode ${e.from}-${e.to}`).toBeGreaterThanOrEqual(Math.floor((e.to - e.from + 1) / TENSION_AUDIO.heartbeatTicks.ours));
        expect(inside).toBeGreaterThanOrEqual(1);
      }
      if (long.length) checked++;
      // every match ends with the getaway: a drive-off for a winner, revs for a draw
      const res = sim.state.result;
      if (res) expect(eng.played(res.winner === null ? 'vanRev' : 'vanDriveOff').length).toBeGreaterThan(0);
    }
    expect(checked, 'at least one recorded match had a match point').toBeGreaterThan(0);
  }, 240_000);
});

// ---------------------------------------------------------------------------------------------
// Stings, accents, climb
// ---------------------------------------------------------------------------------------------

describe('director [F8]: stings and accents from moments', () => {
  it('lead change: rising for us, falling for them; a bank recovery that flips the lead gets one tag after its fanfare', () => {
    const { eng, dir } = setup();
    dir.onMoments([mom('leadTaken', 0, { tick: 100 })]);
    dir.onMoments([mom('leadTaken', 1, { tick: 200 })]);
    dir.onMoments([mom('leadTaken', 0, { tick: 300, lootKind: 'bank' })]);
    const s = eng.played('stingLead');
    expect(s.map((c) => c.o?.step)).toEqual([0, -1, 0]);
    expect(s[0]!.o?.variant).not.toBe(s[1]!.o?.variant);
    expect(s[2]!.o?.variant).toBe(LEAD_BANK_VARIANT);
    expect(s[2]!.o?.delay).toBeGreaterThan(0.8);
  });

  it('one sting per tick: "막았다" beats a lead change; the step says who stopped whom', () => {
    const { eng, dir } = setup();
    dir.onMoments([mom('leadTaken', 0, { tick: 100 }), mom('matchPointStopped', 1, { tick: 100 })]);
    expect(eng.plays()).toEqual(['stingBlocked']);
    expect(eng.played('stingBlocked')[0]!.o?.step).toBe(0); // their match point stopped: we blocked it
    dir.onMoments([mom('matchPointStopped', 0, { tick: 101 })]); // ours stopped: deflate (never gap-limited)
    expect(eng.played('stingBlocked')[1]!.o?.step).toBe(-1);
  });

  it('level, run tiers and broken runs; lower-priority stings keep a short gap', () => {
    const { eng, dir } = setup();
    dir.onMoments([mom('equalized', 1, { tick: 100 })]);
    dir.onMoments([mom('streakTier', 0, { tick: 105, tier: 1 })]); // within the gap: skipped
    dir.onMoments([mom('streakTier', 0, { tick: 200, tier: 2 })]);
    dir.onMoments([mom('streakTier', 1, { tick: 300, tier: 1 })]);
    dir.onMoments([mom('streakBroken', 1, { tick: 400 })]);
    expect(eng.played('stingEqual')[0]!.o?.step).toBe(-1);
    const fills = eng.played('streakFill');
    expect(fills.map((f) => [f.o?.variant, f.o?.step])).toEqual([
      [1, 0],
      [0, -1],
    ]);
    expect(eng.played('streakScratch')).toHaveLength(1);
  });

  it('taunt punished, dodge and clash accents play at the moment, besides any sting', () => {
    const { eng, dir } = setup();
    const at = { x: 3, y: 4 };
    dir.onMoments([mom('tauntPunished', 1, { pos: at }), mom('dodged', 0, { pos: at }), mom('counterDash', 0, { pos: at }), mom('leadTaken', 0)]);
    expect(eng.plays().sort()).toEqual(['clashAccent', 'dodgeWhoosh', 'stingLead', 'tauntPunish']);
    expect(eng.played('tauntPunish')[0]!.o?.pos).toEqual(at);
  });

  it('content moments with their own sounds (jackpot, hammer bonk, ...) add no sting here', () => {
    const { eng, dir } = setup();
    dir.onMoments([mom('jackpot', 0), mom('hammerBonk', 0), mom('goldHammer', 1), mom('coinSplash', 0), mom('bigPlay', 0, { score: 7 }), mom('stealChance', 0)]);
    expect(eng.plays()).toEqual([]);
  });
});

describe('director [F8]: coin climb on unanswered runs', () => {
  const rec = (tick: number, team: TeamId, lootId = 50): SimEvent => ({ type: 'recovered', tick, lootId, kind: 'smallSafe', team, value: 100 } as SimEvent);

  it('a recovery climbs with the run (gaps up to 25 s), not the 8 s window', () => {
    const { eng, dir, sim } = setup();
    // three recoveries 20 s apart, all one run: steps 0, 1, 2 (the old 8 s window would give 0, 0, 0)
    [1, 2, 3].forEach((n, i) => {
      dir.setTension({ ...calm, run: { side: 'ours', recoveries: n, tier: 0 } });
      dir.onEvents([rec(1000 + i * 1200, 0, 50 + i)], sim);
    });
    expect(eng.played('scoreSmall').map((c) => c.o?.step)).toEqual([0, 1, 2]);
    // their recovery broke it: our next one starts again
    dir.setTension({ ...calm, run: { side: 'ours', recoveries: 1, tier: 0 } });
    dir.onEvents([rec(5000, 0, 60)], sim);
    expect(eng.played('scoreSmall').at(-1)!.o?.step).toBe(0);
    // capped
    dir.setTension({ ...calm, run: { side: 'ours', recoveries: 12, tier: 2 } });
    dir.onEvents([rec(5600, 0, 61)], sim);
    expect(eng.played('scoreSmall').at(-1)!.o?.step).toBe(TENSION_AUDIO.climbMax);
  });

  it('without the fun-round wiring the old 8 s combo still applies', () => {
    const { eng, dir, sim } = setup();
    [0, 300, 600].forEach((t, i) => dir.onEvents([rec(1000 + t, 0, 70 + i)], sim));
    expect(eng.played('scoreSmall').map((c) => c.o?.step)).toEqual([0, 1, 2]);
  });

  it('a deposit >= 50 that continues our run chimes on the run step; small, rival or run-opening deposits do not', () => {
    const { eng, dir, sim } = setup();
    const banked = (value: number, team: TeamId): SimEvent => ({ type: 'coinsBanked', tick: 900, charId: team === 0 ? 1 : 2, team, value } as SimEvent);
    dir.setTension({ ...calm, run: { side: 'ours', recoveries: 1, tier: 0 } });
    dir.onEvents([banked(60, 0)], sim); // opens the run: nothing to climb yet
    dir.setTension({ ...calm, run: { side: 'ours', recoveries: 3, tier: 0 } });
    dir.onEvents([banked(40, 0)], sim); // too small to count
    dir.onEvents([banked(120, 1)], sim); // rival
    dir.onEvents([banked(80, 0)], sim);
    const c = eng.played('runClimb');
    expect(c).toHaveLength(1);
    expect(c[0]!.o?.step).toBe(2);
    expect(c[0]!.o?.delay).toBeGreaterThan(0);
  });

  it('a tier-2 run (either side) raises the music into its extra percussion layer', () => {
    const { eng, dir, sim } = setup({ driveMusic: true });
    const music = (): number => eng.calls.filter((c) => c.fn === 'intensity').at(-1)?.x ?? 0;
    for (let i = 0; i < 300; i++) {
      dir.setTension({ ...calm, run: { side: 'theirs', recoveries: 3, tier: 2 } });
      dir.update(sim, 1 / 30);
    }
    expect(music()).toBeGreaterThan(0.85);
    for (let i = 0; i < 600; i++) {
      dir.setTension({ ...calm, run: null });
      dir.update(sim, 1 / 30);
    }
    expect(music()).toBeLessThan(0.7);
  });
});

describe('director [F8]: final seconds, getaway, barks, golden hammer', () => {
  it('van revs at 10 s and 5 s (bigger), then one tick at 3, 2 and 1 s', () => {
    const { eng, dir } = setup();
    feed(eng, dir, 13 * TICK_RATE, (i) => ({ secondsLeft: 12 - i / TICK_RATE }));
    expect(eng.played('vanRev').map((c) => c.o?.step)).toEqual([0, 1]);
    expect(eng.played('finalTick').map((c) => c.o?.step)).toEqual([3, 2, 1]);
    const at = (id: string): number[] => eng.played(id).map((c) => c.tick!);
    expect(at('finalTick')).toEqual([9, 10, 11].map((s) => s * TICK_RATE + 1));
  });

  it('no clock (time limit off): no ticks, no revs', () => {
    const { eng, dir } = setup();
    feed(eng, dir, 600, { secondsLeft: Infinity });
    expect(eng.played('finalTick')).toHaveLength(0);
    expect(eng.played('vanRev')).toHaveLength(0);
  });

  it('every ending gets the getaway: the winners drive off as the van rolls; a draw revs both vans', () => {
    const { eng, dir, sim } = setup();
    feed(eng, dir, 10, {});
    dir.onEvents([{ type: 'matchEnd', tick: 10, result: { reason: 'time', winner: 1, scores: [100, 300], endTick: 10 } }], sim);
    const d = eng.played('vanDriveOff');
    expect(d).toHaveLength(1);
    expect(d[0]!.o?.delay).toBeCloseTo(TENSION_AUDIO.getaway.revFor, 1);
    expect(eng.plays().indexOf('hornEnd')).toBeLessThan(eng.plays().indexOf('vanDriveOff'));
    const { eng: e2, dir: d2, sim: s2 } = setup();
    feed(e2, d2, 10, {});
    d2.onEvents([{ type: 'matchEnd', tick: 10, result: { reason: 'time', winner: null, scores: [300, 300], endTick: 10 } }], s2);
    expect(e2.played('vanRev').map((c) => c.o?.delay)).toEqual([...TENSION_AUDIO.getaway.drawRevs]);
    expect(e2.played('vanDriveOff')).toHaveLength(0);
  });

  it('rival barks: a blip per rival timbre at the raccoon, hidden with the others-taunts filter', () => {
    const { eng, dir, sim } = setup();
    dir.onBark(2, 'tongkeun.myBank', sim);
    dir.onBark(2, 'nunchi.ohMy', sim);
    dir.onBark(2, 'hodadak.zoom', sim);
    dir.onBark(2, 'nobody.x', sim);
    expect(eng.played('barkBlip').map((c) => c.o?.variant)).toEqual([BARK_VARIANT.tongkeun, BARK_VARIANT.nunchi, BARK_VARIANT.hodadak]);
    expect(eng.played('barkBlip')[0]!.o?.pos).toEqual(RIVAL.pos);
    const hidden = setup({ tauntFilter: () => false });
    hidden.dir.onBark(2, 'tongkeun.myBank', hidden.sim);
    expect(hidden.eng.played('barkBlip')).toHaveLength(0);
  });

  it('the golden hammer touching down gets its sting (the C9 announcement stays at itemIncoming)', () => {
    const { eng, dir, sim } = setup();
    dir.onEvents([{ type: 'itemSpawn', tick: 5, itemId: 2001, kind: 'hammer', pos: { x: 1, y: 1 } }], sim);
    expect(eng.played('stingGoldHammer')).toHaveLength(0);
    dir.onEvents([{ type: 'itemSpawn', tick: 6, itemId: 2002, kind: 'goldHammer', pos: { x: 1, y: 1 } }], sim);
    expect(eng.played('stingGoldHammer')).toHaveLength(1);
  });
});
