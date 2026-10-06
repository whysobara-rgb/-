/**
 * MatchAudioDirector: sim events and state -> sounds, loops and music.
 * Unit checks with a recording engine, then an integration run of a real fuzzed match through
 * a real AudioEngine on the strict mock context (every event shape the sim emits must play).
 */
import { describe, expect, it } from 'vitest';
import { AudioEngine, MatchAudioDirector, type AudioSimView, type PlayOptions, type SfxId } from '../../src/audio';
import { mockContext } from '../../src/audio/dev/mockAudioContext';
import type { LoopId, MusicId } from '../../src/audio/ids';
import { LAYOUTS } from '../../src/sim/layouts';
import { Simulation } from '../../src/sim';
import type { CharacterState, LootState, SimEvent, SimState, Vec2 } from '../../src/sim/types';
import { FuzzDriver } from '../sim/fixtures/fuzzbot';

interface Call {
  fn: string;
  id?: string;
  o?: PlayOptions;
  i?: number;
  key?: string | number;
}

class RecordingEngine {
  calls: Call[] = [];
  listener: Vec2 = { x: 0, y: 0 };
  play(id: SfxId, o: PlayOptions = {}): void {
    this.calls.push({ fn: 'play', id, o });
  }
  stop(id: SfxId, tag?: string | number): void {
    this.calls.push({ fn: 'stop', id, key: tag });
  }
  setLoop(id: LoopId, i: number, _pos?: Vec2, key: string | number = 0): void {
    this.calls.push({ fn: 'loop', id, i, key });
  }
  playMusic(id: MusicId): void {
    this.calls.push({ fn: 'music', id });
  }
  setMusicIntensity(x: number): void {
    this.calls.push({ fn: 'intensity', i: x });
  }
  setListener(p: Vec2): void {
    this.listener = p;
  }
  plays(): string[] {
    return this.calls.filter((c) => c.fn === 'play').map((c) => c.id!);
  }
}

function char(id: number, team: 0 | 1, pos: Vec2, extra: Partial<CharacterState> = {}): CharacterState {
  return {
    id, slot: id - 1, team, name: `c${id}`, isBot: id !== 1, look: { hat: 'none' }, pos, vel: { x: 0, y: 0 }, facing: 0,
    moveIntent: { x: 0, y: 0 }, grab: null, straining: false, dashTicks: 0, dashCooldown: 0, boostTicks: 0,
    knockdownTicks: 0, protectTicks: 0, floorOf: null, ...extra,
  };
}

function loot(id: number, kind: LootState['kind'], pos: Vec2, extra: Partial<LootState> = {}): LootState {
  return {
    id, kind, baseValue: kind === 'bank' ? 500 : kind === 'largeSafe' ? 300 : 100, pos, angle: 0, vel: { x: 0, y: 0 }, angVel: 0,
    half: { x: 0.4, y: 0.4 }, anchored: false, unanchorProgress: 1, recovered: false, recoveredBy: null, recoveredTick: null,
    grabbedBy: [], recovery: null, floorOf: null, loadedIn: null, homeBank: null, loadedSafes: [], estimatedValue: 100,
    lastHolder: null, ...extra,
  };
}

function view(chars: CharacterState[], loots: LootState[], extra: Partial<SimState> = {}): AudioSimView {
  const state = {
    layoutId: 'plaza', tick: 600, endTick: 14400, over: false, result: null, scores: [0, 0], characters: chars, loot: loots,
    fences: [], banksRecovered: 0, finalCountdown: false, finalCountdownTick: null, remainingValue: 3200, totalValue: 3200, pings: [],
    ...extra,
  } as SimState;
  return { state, getLoot: (id) => loots.find((l) => l.id === id), getCharacter: (id) => chars.find((c) => c.id === id) };
}

describe('event mapping', () => {
  it('match start, grabs, dash hits, recoveries, end', () => {
    const eng = new RecordingEngine();
    const dir = new MatchAudioDirector(eng as unknown as AudioEngine, { localTeam: 0 });
    const sim = view([char(1, 0, { x: 5, y: 5 }), char(2, 1, { x: 8, y: 5 })], [loot(10, 'smallSafe', { x: 6, y: 5 }), loot(11, 'bank', { x: 20, y: 20 })]);
    const ev: SimEvent[] = [
      { type: 'matchStart', tick: 0 },
      { type: 'grab', tick: 1, charId: 1, targetId: 10, part: 'safe' },
      { type: 'release', tick: 2, charId: 1, targetId: 10, forced: true },
      { type: 'dashHit', tick: 3, attackerId: 2, victimId: 1, knockdown: true },
      { type: 'unanchored', tick: 4, lootId: 11, kind: 'bank', byTeam: 0 },
      { type: 'recoveryStart', tick: 5, lootId: 10, team: 0 },
      { type: 'recoveryCancel', tick: 6, lootId: 10, team: 0, progressTicks: 30 },
      { type: 'ping', tick: 7, pingId: 1, team: 1, charId: 2, pos: { x: 0, y: 0 }, targetId: null, kind: 'goHere' },
      { type: 'ping', tick: 8, pingId: 2, team: 0, charId: 1, pos: { x: 0, y: 0 }, targetId: 10, kind: 'grabTogether' },
    ];
    dir.onEvents(ev, sim);
    expect(eng.plays()).toEqual(['whistleStart', 'grab', 'dashHit', 'knockdown', 'unanchorBank', 'recoverStart', 'recoverCancel', 'ping']);
    expect(eng.calls.find((c) => c.fn === 'music')?.id).toBe('match');
    expect(eng.calls.find((c) => c.fn === 'stop')).toMatchObject({ id: 'recoverStart', key: 10 });
    expect(eng.calls.find((c) => c.id === 'grab')?.o?.pos).toEqual({ x: 5, y: 5 });
  });

  it('consecutive own recoveries climb the scale; opponent scores sit lower', () => {
    const eng = new RecordingEngine();
    const dir = new MatchAudioDirector(eng as unknown as AudioEngine, { localTeam: 0 });
    const sim = view([char(1, 0, { x: 0, y: 0 })], [loot(10, 'smallSafe', { x: 0, y: 0 })]);
    const rec = (team: 0 | 1, kind: LootState['kind'], tick: number): SimEvent => ({
      type: 'recovered', tick, lootId: 10, kind, team, value: 100, safeIds: [], safesValue: 0, holders: [],
    });
    const steps: (number | undefined)[] = [];
    for (let i = 0; i < 4; i++) {
      // 2 s between recoveries: inside the combo window.
      dir.onEvents([rec(0, 'smallSafe', 600 + i * 120)], sim);
      steps.push(eng.calls.at(-1)?.o?.step);
    }
    expect(steps).toEqual([0, 1, 2, 3]);
    // 10 s later the window has expired.
    dir.onEvents([rec(0, 'largeSafe', 600 + 3 * 120 + 600)], sim);
    expect(eng.calls.at(-1)).toMatchObject({ id: 'scoreLarge', o: { step: 0 } });
    dir.onEvents([rec(1, 'bank', 2000)], sim);
    expect(eng.calls.at(-1)).toMatchObject({ id: 'scoreBank', o: { step: -2, volume: 0.7 } });
  });

  it('a new matchStart resets the combo climb (rematch with the same director)', () => {
    const eng = new RecordingEngine();
    const dir = new MatchAudioDirector(eng as unknown as AudioEngine, { localTeam: 0 });
    const sim = view([char(1, 0, { x: 0, y: 0 }, { vel: { x: 5, y: 0 }, moveIntent: { x: 1, y: 0 } })], [loot(10, 'smallSafe', { x: 0, y: 0 })]);
    const rec = (tick: number): SimEvent => ({
      type: 'recovered', tick, lootId: 10, kind: 'smallSafe', team: 0, value: 100, safeIds: [], safesValue: 0, holders: [],
    });
    const lastStep = (): number | undefined => eng.calls.filter((c) => c.id === 'scoreSmall').at(-1)?.o?.step;
    dir.onEvents([{ type: 'matchStart', tick: 0 }], sim);
    const steps: (number | undefined)[] = [];
    for (const tick of [14000, 14100, 14200, 14300]) {
      dir.onEvents([rec(tick)], sim);
      steps.push(lastStep());
    }
    expect(steps).toEqual([0, 1, 2, 3]);
    for (let i = 0; i < 20; i++) dir.update(sim, 1 / 60);
    dir.onEvents([{ type: 'matchEnd', tick: 14400, result: { reason: 'time', winner: 0, scores: [400, 0], endTick: 14400 } }], sim);
    eng.calls = [];
    dir.onEvents([{ type: 'matchStart', tick: 0 }], sim);
    // Music intensity is re-armed for the new match.
    expect(eng.calls.find((c) => c.fn === 'intensity')?.i).toBeCloseTo(0.4);
    dir.onEvents([rec(600)], sim);
    expect(lastStep()).toBe(0);
    // Even without a matchStart, a tick counter that went backwards never continues a combo.
    const dir2 = new MatchAudioDirector(eng as unknown as AudioEngine, { localTeam: 0 });
    dir2.onEvents([rec(14000), rec(14100)], sim);
    expect(lastStep()).toBe(1);
    dir2.onEvents([rec(600)], sim);
    expect(lastStep()).toBe(0);
  });

  it('final-countdown siren loop: starts after the one-shot, urgency rises 0.25 -> 1', () => {
    const eng = new RecordingEngine();
    const dir = new MatchAudioDirector(eng as unknown as AudioEngine, { localTeam: 0, footsteps: false });
    const start = 6000;
    const end = start + 30 * 60;
    const at = (tick: number): AudioSimView =>
      view([char(1, 0, { x: 0, y: 0 })], [], { tick, endTick: end, finalCountdown: true, finalCountdownTick: start });
    const siren = (): number[] => eng.calls.filter((c) => c.fn === 'loop' && c.id === 'sirenLoop').map((c) => c.i!);
    dir.update(at(start + 60), 1 / 60); // 1 s in: the one-shot siren is still playing
    expect(siren()).toEqual([]);
    dir.update(at(start + 2 * 60 + 1), 1 / 60);
    expect(siren().at(-1)).toBeCloseTo(0.25 + 0.75 * (2 / 30), 2);
    dir.update(at(end - 1), 1 / 60);
    expect(siren().at(-1)).toBeGreaterThan(0.99);
    const all = siren();
    for (let i = 1; i < all.length; i++) expect(all[i]).toBeGreaterThanOrEqual(all[i - 1]);
  });

  it('final countdown -> siren + final track; match end -> horn + result jingle', () => {
    const eng = new RecordingEngine();
    const dir = new MatchAudioDirector(eng as unknown as AudioEngine, { localTeam: 1 });
    const sim = view([char(1, 1, { x: 0, y: 0 })], []);
    dir.onEvents([{ type: 'finalCountdown', tick: 100, endTick: 1900, previousEndTick: 14400 }], sim);
    expect(eng.plays()).toContain('siren');
    expect(eng.calls.filter((c) => c.fn === 'music').map((c) => c.id)).toEqual(['final']);
    dir.onEvents([{ type: 'matchEnd', tick: 1900, result: { reason: 'time', winner: 1, scores: [100, 300], endTick: 1900 } }], sim);
    expect(eng.plays().slice(-2)).toEqual(['hornEnd', 'victory']);
    expect(eng.calls.at(-1)?.o?.delay).toBeGreaterThan(0.5);
  });
});

describe('state-driven loops', () => {
  it('drag / rumble / strain follow state and are silenced when they stop', () => {
    const eng = new RecordingEngine();
    const dir = new MatchAudioDirector(eng as unknown as AudioEngine, { localTeam: 0, footsteps: false });
    const c = char(1, 0, { x: 0, y: 0 }, { straining: true });
    const dragged = loot(10, 'smallSafe', { x: 1, y: 0 }, { grabbedBy: [1], vel: { x: 3, y: 0 } });
    const bank = loot(11, 'bank', { x: 10, y: 0 }, { vel: { x: 0.8, y: 0 } });
    const anchored = loot(12, 'largeSafe', { x: 2, y: 2 }, { anchored: true, unanchorProgress: 0.5, grabbedBy: [1] });
    const sim = view([c], [dragged, bank, anchored]);
    dir.update(sim, 1 / 60);
    const loops = eng.calls.filter((x) => x.fn === 'loop');
    expect(loops.map((l) => `${l.id}:${l.key}`).sort()).toEqual(['bankRumble:11', 'drag:10', 'strain:12']);
    expect(loops.find((l) => l.id === 'strain')!.i).toBeCloseTo(0.15 + 0.85 * 0.5);
    // Everything stops moving -> each loop gets an explicit 0.
    eng.calls = [];
    dragged.vel = { x: 0, y: 0 };
    bank.vel = { x: 0, y: 0 };
    c.straining = false;
    dir.update(sim, 1 / 60);
    const zeros = eng.calls.filter((x) => x.fn === 'loop');
    expect(zeros.every((l) => l.i === 0)).toBe(true);
    expect(zeros.length).toBe(3);
  });

  it('footsteps follow walking pace and pause when standing still', () => {
    const eng = new RecordingEngine();
    const dir = new MatchAudioDirector(eng as unknown as AudioEngine, { localTeam: 0, driveMusic: false });
    const walker = char(1, 0, { x: 0, y: 0 }, { vel: { x: 5, y: 0 }, moveIntent: { x: 1, y: 0 } });
    const sim = view([walker], []);
    for (let i = 0; i < 60; i++) dir.update(sim, 1 / 60);
    const steps = eng.plays().filter((p) => p === 'footstep').length;
    expect(steps).toBeGreaterThanOrEqual(5); // ~5 m/s with ~0.7 m strides
    expect(steps).toBeLessThanOrEqual(10);
    eng.calls = [];
    walker.vel = { x: 0, y: 0 };
    walker.moveIntent = { x: 0, y: 0 };
    for (let i = 0; i < 60; i++) dir.update(sim, 1 / 60);
    expect(eng.plays()).not.toContain('footstep');
  });
});

describe('integration with the real simulation', () => {
  it('a fuzzed match plays through a real engine on the mock context without errors', async () => {
    const ctx = mockContext();
    const engine = new AudioEngine({ createContext: () => ctx, autoPump: false, seed: 2 });
    await engine.unlock();
    const sim = new Simulation({
      layout: LAYOUTS.plaza,
      roster: [
        { team: 0, isBot: false, name: 'P1', look: { hat: 'teamCapA' } },
        { team: 0, isBot: true, name: 'B1', look: { hat: 'teamCapA' } },
        { team: 1, isBot: true, name: 'B2', look: { hat: 'teamCapB' } },
        { team: 1, isBot: true, name: 'B3', look: { hat: 'teamCapB' } },
      ],
      seed: 77,
    });
    const dir = new MatchAudioDirector(engine, { localTeam: 0, listenerCharId: 1 });
    const driver = new FuzzDriver(sim, 77);
    const seen = new Set<string>();
    for (let t = 0; t < 60 * 120 && !sim.state.over; t++) {
      driver.assist(240);
      const ev = sim.step(driver.commands());
      for (const e of ev) seen.add(e.type);
      dir.onEvents(ev, sim);
      if (t % 2 === 0) {
        ctx.currentTime += 1 / 30;
        dir.update(sim, 1 / 30);
        engine.pump();
      }
    }
    // The fuzzer produces a rich mix of events; all of them went through the audio path.
    expect(seen.has('grab')).toBe(true);
    expect(seen.has('recovered')).toBe(true);
    expect(ctx.sourcesStarted).toBeGreaterThan(100);
  });
});
