/**
 * [C9] Content 2.0 sounds (content-plan §6 C9, wave 1): the item / coin / prop / breakable recipes
 * (./sfxItems.ts, ./sfxProps.ts), their captions, the voice limits, the in-key tuning, and the
 * director's "[C9]" section mapping the new sim events to sounds — unit checks with a recording
 * engine, then a real v2 match (coins, crates, ATMs, hammers, the golden hammer) through a real
 * engine on the strict mock context.
 */
import { describe, expect, it } from 'vitest';
import { AudioEngine, MatchAudioDirector, type AudioSimView, type PlayOptions, type SfxId } from '../../src/audio';
import { CAPTION_FALLBACK, CAPTION_REPEAT_MS, CONTENT_CAPTION_KEYS, SFX_CAPTION_KEYS } from '../../src/audio/captions';
import { CONTENT_AUDIO } from '../../src/audio/director';
import { MockOscillator, mockContext, type MockAudioContext } from '../../src/audio/dev/mockAudioContext';
import { SFX_IDS, type LoopId, type MusicId } from '../../src/audio/ids';
import { createMixer } from '../../src/audio/mixer';
import { makeRng } from '../../src/audio/rng';
import { SFX_RECIPES } from '../../src/audio/sfx';
import { GOLD_STEP, ITEM_RECIPES } from '../../src/audio/sfxItems';
import { DEPOSIT_SECONDS, PROP_RECIPES } from '../../src/audio/sfxProps';
import { spatialMix } from '../../src/audio/spatial';
import { midiToHz, scaleNote } from '../../src/audio/theory';
import { spawnSfx } from '../../src/audio/voice';
import { createMatch } from '../../src/ai/harness';
import { COINS, TICK_RATE } from '../../src/sim/config';
import type { Simulation } from '../../src/sim/sim';
import type { BreakableState, CharacterState, Command, ItemPickupState, LootState, SimEvent, SimState, Vec2 } from '../../src/sim/types';

const CONTENT_IDS = [...Object.keys(ITEM_RECIPES), ...Object.keys(PROP_RECIPES)] as SfxId[];
/** Coin cues may stack 4 deep (a scoop, a burst); every other new cue at most 2 (content-plan §6 C9). */
const COIN_IDS = new Set<SfxId>(['coinPickup', 'billPickup', 'coinPop', 'coinSpill']);

// ---------------------------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------------------------

interface Call {
  fn: string;
  id?: string;
  o?: PlayOptions;
  key?: string | number;
}

class RecordingEngine {
  calls: Call[] = [];
  play(id: SfxId, o: PlayOptions = {}): void {
    this.calls.push({ fn: 'play', id, o });
  }
  stop(id: SfxId, tag?: string | number): void {
    this.calls.push({ fn: 'stop', id, key: tag });
  }
  setLoop(_id: LoopId): void {}
  playMusic(_id: MusicId): void {}
  setMusicIntensity(): void {}
  setMusicTension(): void {}
  duckMusic(): void {
    this.calls.push({ fn: 'duck' });
  }
  setListener(): void {}
  plays(): string[] {
    return this.calls.filter((c) => c.fn === 'play').map((c) => c.id!);
  }
  played(id: string): Call[] {
    return this.calls.filter((c) => c.fn === 'play' && c.id === id);
  }
  clear(): void {
    this.calls = [];
  }
}

function char(id: number, team: 0 | 1, pos: Vec2, extra: Partial<CharacterState> = {}): CharacterState {
  return {
    id, slot: id - 1, team, name: `c${id}`, isBot: id !== 1, look: { hat: 'none' }, pos, vel: { x: 0, y: 0 }, facing: 0,
    moveIntent: { x: 0, y: 0 }, grab: null, straining: false, dashTicks: 0, dashCooldown: 0, boostTicks: 0,
    knockdownTicks: 0, protectTicks: 0, floorOf: null, ...extra,
  };
}

function loot(id: number, pos: Vec2, extra: Partial<LootState> = {}): LootState {
  return {
    id, kind: 'largeSafe', baseValue: 100, pos, angle: 0, vel: { x: 0, y: 0 }, angVel: 0, half: { x: 0.5, y: 0.5 }, anchored: true,
    unanchorProgress: 0, recovered: false, recoveredBy: null, recoveredTick: null, grabbedBy: [], recovery: null, floorOf: null,
    loadedIn: null, homeBank: null, loadedSafes: [], estimatedValue: 100, lastHolder: null, ...extra,
  };
}

interface Fake extends AudioSimView {
  state: SimState;
}

function view(chars: CharacterState[], loots: LootState[], extra: Partial<SimState> = {}): Fake {
  const state = {
    layoutId: 'plaza', tick: 600, endTick: 14400, over: false, result: null, scores: [0, 0], characters: chars, loot: loots,
    fences: [{ id: 'f1', center: { x: 30, y: 10 }, half: { x: 2, y: 0.2 }, angle: 0, broken: false, brokenTick: null }],
    banksRecovered: 0, finalCountdown: false, finalCountdownTick: null, remainingValue: 4000, totalValue: 4000, pings: [],
    police: [], policeCars: [], alarm: { ringing: [], dispatchTick: null, waves: 0 },
    coins: [], breakables: [], items: [], hazards: [], projectiles: [], gimmicks: [], matchEvents: [], eventPlan: null,
    ...extra,
  } as SimState;
  return { state, getLoot: (id) => loots.find((l) => l.id === id), getCharacter: (id) => chars.find((c) => c.id === id) };
}

function setup(o: { contentSfx?: boolean } = {}): { eng: RecordingEngine; dir: MatchAudioDirector } {
  const eng = new RecordingEngine();
  const dir = new MatchAudioDirector(eng as unknown as AudioEngine, { localTeam: 0, listenerCharId: 1, footsteps: false, driveMusic: false, contentSfx: o.contentSfx });
  return { eng, dir };
}

const ME = char(1, 0, { x: 10, y: 10 });
const MATE = char(2, 0, { x: 12, y: 10 });
const RIVAL = char(3, 1, { x: 14, y: 10 });
const RIVAL2 = char(4, 1, { x: 16, y: 12 });
const chars = (): CharacterState[] => [{ ...ME }, { ...MATE }, { ...RIVAL }, { ...RIVAL2 }];

// ---------------------------------------------------------------------------------------------
// Recipes, captions, limits
// ---------------------------------------------------------------------------------------------

describe('content recipes', () => {
  it('every new cue is a registered SfxId with a recipe, 2-4 variations and a voice limit', () => {
    expect(CONTENT_IDS.length).toBe(26);
    for (const id of CONTENT_IDS) {
      expect(SFX_IDS, id).toContain(id);
      const r = SFX_RECIPES[id];
      expect(r, id).toBeDefined();
      expect(r.bus, id).toBe('sfx');
      expect(r.variants, id).toBeGreaterThanOrEqual(2);
      expect(r.variants, id).toBeLessThanOrEqual(4);
      // Voice limiter (content-plan §6 C9): <= 2 overlapping instances per cue, coins <= 4.
      expect(r.maxVoices, id).toBeLessThanOrEqual(COIN_IDS.has(id) ? 4 : 2);
    }
  });

  it('every new cue has a caption in ko and en (doc §13: never rely on sound alone)', () => {
    expect(CONTENT_CAPTION_KEYS.length).toBe(CONTENT_IDS.length);
    for (const id of CONTENT_IDS) {
      const key = SFX_CAPTION_KEYS[id];
      expect(key, id).toBeTruthy();
      expect(CONTENT_CAPTION_KEYS).toContain(key);
      const ko = CAPTION_FALLBACK.ko[key!];
      const en = CAPTION_FALLBACK.en[key!];
      expect(ko, `${id} ko`).toMatch(/^\[.+\]$/);
      expect(en, `${id} en`).toMatch(/^\[.+\]$/);
      expect(ko).not.toBe(en);
      expect(/[가-힣]/.test(ko!), `${id} ko is Korean`).toBe(true);
      expect(/[가-힣]/.test(en!), `${id} en has no Hangul`).toBe(false);
    }
    // Bursty cues keep a longer caption throttle (a scoop is one line, not five).
    for (const k of ['caption.coinPickup', 'caption.billPickup', 'caption.coinPop']) expect(CAPTION_REPEAT_MS[k]).toBeGreaterThanOrEqual(1500);
  });

  it('the engine never stacks a cue deeper than its limit (hammer 2, coins 4)', async () => {
    const ctx = mockContext();
    const engine = new AudioEngine({ createContext: () => ctx, autoPump: false, seed: 3 });
    await engine.unlock();
    const live = (id: string): number =>
      (engine as unknown as { voices: { id: string; end: number; priority: number }[] }).voices.filter((v) => v.id === id && v.priority >= 0 && v.end > ctx.currentTime).length;
    for (const id of ['hammerBonk', 'coinPickup', 'coinSpill', 'supplyIncoming', 'piggyJackpot'] as SfxId[]) {
      let maxLive = 0;
      for (let i = 0; i < 12; i++) {
        engine.play(id, { volume: 1 });
        maxLive = Math.max(maxLive, live(id));
        ctx.currentTime += 0.07;
      }
      expect(maxLive, id).toBeLessThanOrEqual(SFX_RECIPES[id].maxVoices);
      expect(maxLive, id).toBeGreaterThanOrEqual(1);
    }
  });

  /** Frequencies of every oscillator a cue schedules (first automation value, last value). */
  function oscFreqs(id: SfxId, step: number, variant: number, type?: OscillatorType): { first: number; last: number }[] {
    const ctx = mockContext();
    const mixer = createMixer(ctx);
    const from = (ctx as unknown as MockAudioContext).nodes.length;
    spawnSfx(ctx, mixer, id, { t: 0.5, mix: spatialMix({ x: 0, y: 0 }, null), volume: 1, pitch: 1, variant, step, key: 65, rnd: makeRng(7) });
    return (ctx as unknown as MockAudioContext).nodes
      .slice(from)
      .filter((n): n is MockOscillator => n instanceof MockOscillator && (type === undefined || n.type === type) && n.frequency.events.length > 0)
      .map((o) => ({ first: o.frequency.events[0]!.value, last: o.frequency.events.at(-1)!.value }));
  }
  const near = (f: number, target: number, tol: number): boolean => Math.abs(f / target - 1) <= tol;

  it('coin pickups climb the key one pentatonic degree per pile (ART_DIRECTION §1)', () => {
    let prev = 0;
    for (let step = 0; step <= CONTENT_AUDIO.climbMax; step++) {
      const target = midiToHz(scaleNote(65, 9 + step));
      // The coin's FM carrier is the first oscillator of variant 0.
      const f = oscFreqs('coinPickup', step, 0)[0]!.first;
      expect(near(f, target, 0.006), `step ${step}: ${f} vs ${target}`).toBe(true);
      expect(f).toBeGreaterThan(prev);
      prev = f;
    }
  });

  it('the hammer squeak lands on a note of the key; the golden hammer two degrees lower (still in key)', () => {
    const contourEnd = [1.0, 1.12, 1.25, 1.33]; // last contour ratio per variant (sfxItems hammerBonk)
    const degs = [9, 10, 8, 9];
    for (let v = 0; v < 4; v++) {
      for (const step of [0, GOLD_STEP]) {
        const sq = oscFreqs('hammerBonk', step, v, 'square')[0]!;
        const target = midiToHz(scaleNote(65, degs[v]! + step)) * contourEnd[v]!;
        expect(near(sq.last, target, 0.015), `v${v} step ${step}`).toBe(true);
      }
    }
    // Wind-up: ends on its degree (ratio 1.04 overshoot of the in-key note at the top).
    const w = oscFreqs('hammerWindup', 0, 0, 'square')[0]!;
    expect(near(w.last, midiToHz(scaleNote(65, 7)) * 1.04, 0.02)).toBe(true);
    expect(w.first).toBeLessThan(w.last);
  });

  it('the deposit riser lasts the deposit dwell', () => {
    expect(DEPOSIT_SECONDS).toBeCloseTo(COINS.depositTicks / TICK_RATE, 6);
  });
});

// ---------------------------------------------------------------------------------------------
// Director mapping
// ---------------------------------------------------------------------------------------------

describe('director [C9] mapping', () => {
  it('coin pickups climb per raccoon within 1.5 s; bills use the paper cue; the listener is loudest', () => {
    const { eng, dir } = setup();
    const sim = view(chars(), []);
    const pick = (tick: number, charId: number, value = 10): SimEvent => ({ type: 'coinPickup', tick, charId, coinId: 10000 + tick, value, bag: value });
    dir.onEvents([pick(100, 1)], sim);
    dir.onEvents([pick(130, 1)], sim);
    dir.onEvents([pick(150, 1, 50)], sim);
    dir.onEvents([pick(151, 3)], sim); // a rival's climb is its own
    dir.onEvents([pick(150 + CONTENT_AUDIO.climbWindowTicks + 1, 1)], sim); // window over: back to the first coin
    const steps = eng.calls.filter((c) => c.fn === 'play').map((c) => [c.id, c.o?.step, c.o?.volume]);
    expect(steps).toEqual([
      ['coinPickup', 0, 1],
      ['coinPickup', 1, 1],
      ['billPickup', 2, 1],
      ['coinPickup', 0, CONTENT_AUDIO.pickupVolume.rival],
      ['coinPickup', 0, 1],
    ]);
    // Ten piles in a row cap at climbMax.
    eng.clear();
    for (let i = 0; i < 12; i++) dir.onEvents([pick(1000 + i * 10, 2)], sim);
    expect(Math.max(...eng.played('coinPickup').map((c) => c.o!.step!))).toBe(CONTENT_AUDIO.climbMax);
    expect(eng.played('coinPickup')[0]!.o!.volume).toBe(CONTENT_AUDIO.pickupVolume.team);
  });

  it('two piles in one tick: the listener is heard first', () => {
    const { eng, dir } = setup();
    const sim = view(chars(), []);
    dir.onEvents(
      [
        { type: 'coinPickup', tick: 5, charId: 3, coinId: 10001, value: 10, bag: 10 },
        { type: 'coinPickup', tick: 5, charId: 1, coinId: 10002, value: 10, bag: 10 },
      ],
      sim,
    );
    expect(eng.played('coinPickup').map((c) => c.o!.volume)).toEqual([1, CONTENT_AUDIO.pickupVolume.rival]);
  });

  it('spill: a cascade sized by the spilled value, at the victim', () => {
    const { eng, dir } = setup();
    const sim = view(chars(), []);
    for (const value of [10, 30, 40, 70, 80, 200]) dir.onEvents([{ type: 'bagSpilled', tick: 9, charId: 3, value, byId: 1, cause: 'hammer' }], sim);
    expect(eng.played('coinSpill').map((c) => c.o!.variant)).toEqual([0, 0, 1, 1, 2, 2]);
    expect(eng.played('coinSpill')[0]!.o!.pos).toEqual(RIVAL.pos);
    // A spill's coinSpawn adds nothing (one cascade, not two).
    eng.clear();
    dir.onEvents([{ type: 'coinSpawn', tick: 9, ids: [10001], total: 10, pos: RIVAL.pos, source: 'spill', sourceId: 3, byCharId: 1 }], sim);
    expect(eng.plays()).toEqual([]);
  });

  it('deposit: a tagged riser while dwelling, cut on cancel; the pour when it lands (rival lower)', () => {
    const { eng, dir } = setup();
    const sim = view(chars(), []);
    dir.onEvents([{ type: 'coinDepositStart', tick: 10, charId: 1, team: 0 }], sim);
    expect(eng.played('depositStart')[0]!.o!.tag).toBe('dep:1');
    dir.onEvents([{ type: 'coinDepositCancel', tick: 20, charId: 1, team: 0 }], sim);
    expect(eng.calls.filter((c) => c.fn === 'stop')).toEqual([{ fn: 'stop', id: 'depositStart', key: 'dep:1' }]);
    eng.clear();
    dir.onEvents([{ type: 'coinsBanked', tick: 40, charId: 1, team: 0, value: 120 }], sim);
    dir.onEvents([{ type: 'coinsBanked', tick: 41, charId: 3, team: 1, value: 30 }], sim);
    expect(eng.calls.filter((c) => c.fn === 'stop').map((c) => c.key)).toEqual(['dep:1', 'dep:3']);
    expect(eng.played('coinDeposit').map((c) => [c.o!.variant, c.o!.step, c.o!.volume])).toEqual([
      [2, 0, 1],
      [0, CONTENT_AUDIO.rivalDepositStep, 0.7],
    ]);
  });

  it('hammer: wind-up then swing; the golden hammer two degrees lower; a rival wind-up at full level (the dodge cue)', () => {
    const { eng, dir } = setup();
    const sim = view(chars(), []);
    dir.onEvents([{ type: 'itemUse', tick: 1, charId: 3, kind: 'hammer', phase: 'windup' }], sim);
    dir.onEvents([{ type: 'itemUse', tick: 7, charId: 3, kind: 'hammer', phase: 'fire' }], sim);
    dir.onEvents([{ type: 'itemUse', tick: 9, charId: 2, kind: 'goldHammer', phase: 'windup' }], sim);
    expect(eng.calls.map((c) => [c.id, c.o?.step, c.o?.volume])).toEqual([
      ['hammerWindup', 0, 1],
      ['hammerSwing', 0, 1],
      ['hammerWindup', GOLD_STEP, 0.8],
    ]);
  });

  it('a swing that hits several things bonks once, at its strongest target (+ the dizzy boing and a duck on a KO of the listener)', () => {
    const { eng, dir } = setup();
    const cs = chars();
    const piggy = loot(20, { x: 15, y: 11 }, { variant: 'piggy', anchored: false });
    const sim = view(cs, [piggy], { breakables: [{ id: 'b1', kind: 'crate', center: { x: 13, y: 9 }, half: { x: 0.45, y: 0.45 }, angle: 0, hp: 0, innerValue: 0, broken: true } as BreakableState] });
    dir.onEvents(
      [
        { type: 'itemHit', tick: 3, charId: 3, kind: 'hammer', target: 'breakable', targetId: 'b1', knockdown: false },
        { type: 'itemHit', tick: 3, charId: 3, kind: 'hammer', target: 'char', targetId: 1, knockdown: true },
        { type: 'itemHit', tick: 3, charId: 3, kind: 'hammer', target: 'loot', targetId: 20, knockdown: false },
        { type: 'itemHit', tick: 3, charId: 2, kind: 'goldHammer', target: 'fence', targetId: 'f1', knockdown: false, homeRun: false },
      ],
      sim,
    );
    const bonks = eng.played('hammerBonk');
    expect(bonks.map((c) => [c.o!.pos, c.o!.volume, c.o!.step])).toEqual([
      [ME.pos, CONTENT_AUDIO.bonkVolume.knockdown, 0],
      [{ x: 30, y: 10 }, CONTENT_AUDIO.bonkVolume.fence, GOLD_STEP],
    ]);
    expect(eng.played('knockdown').length).toBe(1);
    expect(eng.calls.some((c) => c.fn === 'duck')).toBe(true);
    // Home run climbs.
    eng.clear();
    dir.onEvents([{ type: 'itemHit', tick: 4, charId: 1, kind: 'hammer', target: 'char', targetId: 3, knockdown: true, homeRun: true }], sim);
    expect(eng.played('hammerBonk')[0]!.o!.step).toBe(CONTENT_AUDIO.homeRunStep);
    expect(eng.calls.some((c) => c.fn === 'duck')).toBe(false);
  });

  it('clash at the midpoint; pickups, drops and expiries of items', () => {
    const { eng, dir } = setup();
    const items: ItemPickupState[] = [{ id: 2001, kind: 'hammer', padId: 'p1', pos: { x: 20, y: 5 }, phase: 'incoming', landTick: 200, expiresTick: 2000, uses: 5 }];
    const sim = view(chars(), [], { items });
    dir.onEvents([{ type: 'itemClash', tick: 1, aId: 1, bId: 3 }], sim);
    expect(eng.played('hammerClash')[0]!.o!.pos).toEqual({ x: 12, y: 10 });
    dir.onEvents([{ type: 'itemIncoming', tick: 20, padId: 'p1', kind: 'hammer', landTick: 200 }], sim);
    expect(eng.played('supplyIncoming')[0]!.o!.pos).toEqual({ x: 20, y: 5 });
    expect(eng.played('goldHammerSting')).toEqual([]);
    dir.onEvents([{ type: 'itemIncoming', tick: 20, padId: 'p1', kind: 'goldHammer', landTick: 200 }], sim);
    expect(eng.played('goldHammerSting').length).toBe(1);
    dir.onEvents([{ type: 'itemSpawn', tick: 200, itemId: 2001, kind: 'hammer', pos: { x: 20, y: 5 } }], sim);
    expect(eng.played('supplyLand')[0]!.o!.pos).toEqual({ x: 20, y: 5 });
    // The ground item vanishes from the state before its expiry is heard: the remembered spot poofs.
    sim.state.items = [];
    dir.onEvents([{ type: 'itemExpired', tick: 2000, charId: null, itemId: 2001, kind: 'hammer' }], sim);
    expect(eng.played('itemPoof')[0]!.o!.pos).toEqual({ x: 20, y: 5 });
    dir.onEvents([{ type: 'itemPickup', tick: 300, charId: 1, itemId: 2002, kind: 'goldHammer' }], sim);
    expect(eng.played('itemPickup')[0]!.o!.step).toBe(2);
    dir.onEvents([{ type: 'itemDropped', tick: 400, charId: 1, itemId: 2003, kind: 'goldHammer', uses: 3, pos: { x: 9, y: 9 } }], sim);
    expect(eng.played('itemDrop')[0]!.o!.pos).toEqual({ x: 9, y: 9 });
    // A held item running out poofs at its holder.
    dir.onEvents([{ type: 'itemExpired', tick: 500, charId: 3, itemId: null, kind: 'hammer' }], sim);
    expect(eng.played('itemPoof')[1]!.o!.pos).toEqual(RIVAL.pos);
  });

  it('props: ATM spurt / bonk, money-tree rip + flutter, piggy kick / crack / jackpot', () => {
    const { eng, dir } = setup();
    const atm = loot(20, { x: 5, y: 5 }, { variant: 'atm' });
    const tree = loot(21, { x: 30, y: 20 }, { variant: 'moneyTree' });
    const piggy = loot(22, { x: 32, y: 24 }, { variant: 'piggy', anchored: false, cracks: 0 });
    const sim = view(chars(), [atm, tree, piggy]);
    dir.onEvents([{ type: 'coinSpawn', tick: 1, ids: [10001, 10002], total: 20, pos: atm.pos, source: 'spurt', sourceId: 20, byCharId: 1 }], sim);
    dir.onEvents([{ type: 'coinSpawn', tick: 2, ids: [10003, 10004], total: 20, pos: atm.pos, source: 'bonk', sourceId: 20, byCharId: 1 }], sim);
    dir.onEvents([{ type: 'unanchored', tick: 3, lootId: 21, kind: 'largeSafe', byTeam: 0 }], sim);
    dir.onEvents([{ type: 'unanchored', tick: 3, lootId: 20, kind: 'largeSafe', byTeam: 0 }], sim);
    dir.onEvents([{ type: 'coinSpawn', tick: 4, ids: [10005], total: 50, pos: tree.pos, source: 'shed', sourceId: 21, byCharId: null }], sim);
    expect(eng.plays().filter((id) => CONTENT_IDS.includes(id as SfxId))).toEqual(['atmSpurt', 'atmBonk', 'rootRip', 'billFlutter']);
    expect(eng.played('rootRip')[0]!.o!.pos).toEqual(tree.pos);
    // Piggy: a kick that did not crack it oinks; a crack cracks + oinks higher; the smash jackpots.
    eng.clear();
    dir.onEvents([{ type: 'propHit', tick: 5, lootId: 22, byCharId: 1, how: 'dash', coins: 0 }], sim);
    expect(eng.plays()).toEqual(['piggyOink']);
    eng.clear();
    piggy.cracks = 1;
    dir.onEvents(
      [
        { type: 'piggyCrack', tick: 6, lootId: 22, cracks: 1, smashed: false, byCharId: 3 },
        { type: 'propHit', tick: 6, lootId: 22, byCharId: 3, how: 'dash', coins: 0 },
      ],
      sim,
    );
    expect(eng.plays()).toEqual(['piggyCrack', 'piggyOink']);
    expect(eng.played('piggyOink')[0]!.o!.pitch).toBeCloseTo(1 + CONTENT_AUDIO.oinkPitchPerCrack, 6);
    eng.clear();
    // The smashed shell has left the state: the burst's position is used.
    const gone = view(chars(), [atm, tree]);
    dir.onEvents(
      [
        { type: 'coinSpawn', tick: 7, ids: [10010, 10011], total: 300, pos: { x: 33, y: 25 }, source: 'smash', sourceId: 22, byCharId: 1 },
        { type: 'piggyCrack', tick: 7, lootId: 22, cracks: 3, smashed: true, byCharId: 1 },
        { type: 'propHit', tick: 7, lootId: 22, byCharId: 1, how: 'hammer', coins: 14 },
      ],
      gone,
    );
    expect(eng.plays()).toEqual(['piggyJackpot']);
    expect(eng.played('piggyJackpot')[0]!.o!.pos).toEqual({ x: 33, y: 25 });
  });

  it('breakables: the vending machine coughs on a hit; crates and machines have their own break', () => {
    const { eng, dir } = setup();
    const crate: BreakableState = { id: 'c1', kind: 'crate', center: { x: 3, y: 3 }, half: { x: 0.45, y: 0.45 }, angle: 0, hp: 0, innerValue: 0, broken: true };
    const vend: BreakableState = { id: 'v1', kind: 'vending', center: { x: 6, y: 3 }, half: { x: 0.6, y: 0.5 }, angle: 0, hp: 2, innerValue: 50, broken: false };
    const sim = view(chars(), [], { breakables: [crate, vend] });
    dir.onEvents(
      [
        { type: 'breakableHit', tick: 1, id: 'v1', hp: 2, byCharId: 1 },
        { type: 'coinSpawn', tick: 1, ids: [10001], total: 10, pos: { x: 6, y: 2 }, source: 'break', sourceId: 'v1', byCharId: 1 },
      ],
      sim,
    );
    dir.onEvents([{ type: 'breakableHit', tick: 2, id: 'c1', hp: 0, byCharId: 1 }, { type: 'breakableBroken', tick: 2, id: 'c1', byCharId: 1 }], sim);
    dir.onEvents([{ type: 'breakableHit', tick: 3, id: 'v1', hp: 0, byCharId: 1 }, { type: 'breakableBroken', tick: 3, id: 'v1', byCharId: 1 }], sim);
    expect(eng.plays()).toEqual(['vendingHit', 'crateBreak', 'vendingBreak']);
    expect(eng.played('crateBreak')[0]!.o!.pos).toEqual(crate.center);
  });

  it('contentSfx: false keeps the pre-Content-2.0 mapping (nothing new plays)', () => {
    const { eng, dir } = setup({ contentSfx: false });
    const sim = view(chars(), []);
    dir.onEvents(
      [
        { type: 'coinPickup', tick: 1, charId: 1, coinId: 10001, value: 10, bag: 10 },
        { type: 'itemUse', tick: 1, charId: 1, kind: 'hammer', phase: 'windup' },
        { type: 'bagSpilled', tick: 1, charId: 1, value: 50, byId: 3, cause: 'dash' },
        { type: 'coinsBanked', tick: 1, charId: 1, team: 0, value: 50 },
      ],
      sim,
    );
    expect(eng.plays()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Integration: a real v2 match
// ---------------------------------------------------------------------------------------------

/** Content-hungry stand-in (fetch items, scoop, deposit, smash, tug props, hammer rivals). */
function greedy(sim: Simulation, slot: number): () => Command {
  let prevDash = false;
  let tug = 0;
  let k = slot * 7 + 1;
  const rnd = (): number => ((k = (k * 1103515245 + 12345) >>> 0) / 4294967296);
  return () => {
    const st = sim.state;
    const ch = st.characters[slot]!;
    const d = (p: Vec2): number => Math.hypot(p.x - ch.pos.x, p.y - ch.pos.y);
    const go = (to: Vec2, dashWithin = 0, grab = false): Command => {
      const dx = to.x - ch.pos.x;
      const dy = to.y - ch.pos.y;
      const L = Math.hypot(dx, dy) || 1;
      const dash = dashWithin > 0 && L < dashWithin && !prevDash && rnd() < 0.35;
      prevDash = dash;
      return { move: { x: dx / L, y: dy / L }, grab, dash, aim: { x: dx, y: dy }, ping: null };
    };
    const zone = sim.layout.zones.find((z) => z.team === ch.team)!.center;
    if (ch.grab) return tug-- > 0 ? { ...go(zone), grab: true, dash: false } : { move: { x: 0, y: 0 }, grab: false, dash: false };
    const rival = st.characters.filter((c) => c.team !== ch.team).sort((a, b) => d(a.pos) - d(b.pos))[0]!;
    if (ch.item && d(rival.pos) < 9) return go(rival.pos, 1.9);
    const item = st.items.filter((i) => i.phase === 'ground').sort((a, b) => d(a.pos) - d(b.pos))[0];
    if (!ch.item && item && d(item.pos) < 18) return go(item.pos);
    const bag = ch.bag ?? 0;
    const pile = [...st.coins].sort((a, b) => d(a.pos) - d(b.pos))[0];
    if (pile && bag < 200 && d(pile.pos) < 14) return go(pile.pos);
    if (bag >= 90) return go(zone);
    const brk = st.breakables.filter((b) => !b.broken).sort((a, b) => d(a.center) - d(b.center))[0];
    if (brk && d(brk.center) < 16) return go(brk.center, 2.4);
    const prop = st.loot.filter((l) => l.variant && !l.recovered && !l.dormant && !l.airborne).sort((a, b) => d(a.pos) - d(b.pos))[0];
    if (prop) {
      if (prop.variant === 'piggy') return go(prop.pos, 2.6);
      if (d(prop.pos) < 1.6) {
        tug = 60 + Math.floor(rnd() * 120);
        return { ...go(prop.pos), grab: true, dash: false };
      }
      return go(prop.pos);
    }
    return bag > 0 ? go(zone) : go(rival.pos, 2.0);
  };
}

describe('integration: a real v2 match', () => {
  it('coins, crates, ATMs and hammers from the real sim play through a real engine on the mock context, within their voice limits', async () => {
    const ctx = mockContext();
    const engine = new AudioEngine({ createContext: () => ctx, autoPump: false, seed: 4 });
    await engine.unlock();
    const { sim, bots } = createMatch({
      layout: 'counter',
      team0: [{ personality: 'hodadak', difficulty: 'normal', humanProxy: true }, { personality: 'nunchi', difficulty: 'normal' }],
      team1: [{ personality: 'tongkeun', difficulty: 'normal' }, { personality: 'hodadak', difficulty: 'normal' }],
      seed: 7,
      rules: { content: 'v2', police: true },
    });
    const drivers = new Map([
      [0, greedy(sim, 0)],
      [3, greedy(sim, 3)],
    ]);
    const plays = new Map<string, number>();
    const real = engine.play.bind(engine);
    engine.play = (id, o) => {
      plays.set(id, (plays.get(id) ?? 0) + 1);
      real(id, o);
    };
    const dir = new MatchAudioDirector(engine, { localTeam: 0, listenerCharId: 1 });
    const voices = (engine as unknown as { voices: { id: string; end: number; priority: number }[] }).voices;
    const maxLive = new Map<string, number>();
    for (let t = 0; t < 60 * 170 && !sim.state.over; t++) {
      const cmds = bots.map((b, i) => drivers.get(i)?.() ?? b.update(sim));
      const ev = sim.step(cmds);
      if (ev.length) dir.onEvents(ev, sim);
      ctx.currentTime += 1 / 60;
      if (t % 2 === 0) {
        dir.update(sim, 1 / 30);
        engine.pump();
      }
      const per = new Map<string, number>();
      for (const v of voices) if (v.priority >= 0 && v.end > ctx.currentTime + 0.045) per.set(v.id, (per.get(v.id) ?? 0) + 1);
      for (const [id, n] of per) maxLive.set(id, Math.max(maxLive.get(id) ?? 0, n));
    }
    for (const id of ['coinPickup', 'crateBreak', 'atmSpurt', 'supplyIncoming', 'supplyLand', 'itemPickup', 'hammerWindup', 'hammerSwing', 'coinDeposit'] as SfxId[]) {
      expect(plays.get(id) ?? 0, id).toBeGreaterThan(0);
    }
    for (const id of CONTENT_IDS) expect(maxLive.get(id) ?? 0, id).toBeLessThanOrEqual(SFX_RECIPES[id].maxVoices);
    dir.stop();
  });

  it('a classic match plays none of the new cues', () => {
    const eng = new RecordingEngine();
    const { sim, bots } = createMatch({
      layout: 'plaza',
      team0: [{ personality: 'hodadak', difficulty: 'normal', humanProxy: true }],
      team1: [{ personality: 'tongkeun', difficulty: 'normal' }],
      seed: 3,
      rules: { content: 'classic', police: true },
      maxTicks: 60 * 90,
    });
    const dir = new MatchAudioDirector(eng as unknown as AudioEngine, { localTeam: 0, listenerCharId: 1, footsteps: false });
    for (let t = 0; t < 60 * 90 && !sim.state.over; t++) {
      const ev = sim.step(bots.map((b) => b.update(sim)));
      if (ev.length) dir.onEvents(ev, sim);
    }
    expect(eng.plays().length).toBeGreaterThan(10);
    expect(eng.plays().filter((id) => CONTENT_IDS.includes(id as SfxId))).toEqual([]);
  });
});
