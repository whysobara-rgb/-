/**
 * MatchAudioDirector, police + presentation: police events -> sounds, per-car sirens with doppler,
 * per-bank alarm bells, rate limits (whistles, barks, chase tweets), chase music, ducks, the uproot
 * choreography (pop / landing / callout stingers) and the steal / dodge callouts. Unit checks with
 * a recording engine, then a real police match through a real engine on the strict mock context.
 */
import { describe, expect, it } from 'vitest';
import { AudioEngine, MatchAudioDirector, type AudioSimView, type PlayOptions, type SfxId } from '../../src/audio';
import { readFileSync } from 'node:fs';
import { HITSTOP, POLICE_AUDIO, STRAIN_PITCH } from '../../src/audio/director';
import { mockContext } from '../../src/audio/dev/mockAudioContext';
import type { LoopId, MusicId } from '../../src/audio/ids';
import { LAND_DELAY } from '../../src/audio/sfxStage';
import { LAYOUTS } from '../../src/sim/layouts';
import { Simulation } from '../../src/sim';
import type { CharacterState, LootState, PoliceCarState, PoliceOfficerState, SimEvent, SimState, Vec2 } from '../../src/sim/types';
import { FuzzDriver } from '../sim/fixtures/fuzzbot';

interface Call {
  fn: string;
  id?: string;
  o?: PlayOptions;
  i?: number;
  key?: string | number;
  pitch?: number;
  hold?: number;
}

class RecordingEngine {
  calls: Call[] = [];
  play(id: SfxId, o: PlayOptions = {}): void {
    this.calls.push({ fn: 'play', id, o });
  }
  stop(id: SfxId, tag?: string | number): void {
    this.calls.push({ fn: 'stop', id, key: tag });
  }
  setLoop(id: LoopId, i: number, _pos?: Vec2, key: string | number = 0, pitch = 1): void {
    this.calls.push({ fn: 'loop', id, i, key, pitch });
  }
  playMusic(id: MusicId): void {
    this.calls.push({ fn: 'music', id });
  }
  setMusicIntensity(x: number): void {
    this.calls.push({ fn: 'intensity', i: x });
  }
  setMusicTension(x: number): void {
    this.calls.push({ fn: 'tension', i: x });
  }
  duckMusic(db: number, hold: number): void {
    this.calls.push({ fn: 'duck', i: db, hold });
  }
  setListener(): void {}
  plays(): string[] {
    return this.calls.filter((c) => c.fn === 'play').map((c) => c.id!);
  }
  played(id: string): Call[] {
    return this.calls.filter((c) => c.fn === 'play' && c.id === id);
  }
  loops(id: string): Call[] {
    return this.calls.filter((c) => c.fn === 'loop' && c.id === id);
  }
  tension(): number | undefined {
    return this.calls.filter((c) => c.fn === 'tension').at(-1)?.i;
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

function officer(id: number, pos: Vec2, extra: Partial<PoliceOfficerState> = {}): PoliceOfficerState {
  return { id, carId: 1, pos, vel: { x: 0, y: 0 }, facing: 0, phase: 'patrol', targetCharId: null, tackleTicks: 0, stunTicks: 0, tiredTicks: 0, activeTicks: 0, ...extra };
}

function car(id: number, pos: Vec2, extra: Partial<PoliceCarState> = {}): PoliceCarState {
  return { id, entryIndex: 0, pos, angle: 0, phase: 'arriving', sirenOn: true, wave: 1, ...extra };
}

interface Fake extends AudioSimView {
  state: SimState;
}

function view(chars: CharacterState[], loots: LootState[], extra: Partial<SimState> = {}): Fake {
  const state = {
    layoutId: 'plaza', tick: 600, endTick: 14400, over: false, result: null, scores: [0, 0], characters: chars, loot: loots,
    fences: [], banksRecovered: 0, finalCountdown: false, finalCountdownTick: null, remainingValue: 3200, totalValue: 3200, pings: [],
    police: [], policeCars: [], alarm: { ringing: [], dispatchTick: null, waves: 0 },
    ...extra,
  } as SimState;
  return { state, getLoot: (id) => loots.find((l) => l.id === id), getCharacter: (id) => chars.find((c) => c.id === id) };
}

function setup(o: { footsteps?: boolean } = {}): { eng: RecordingEngine; dir: MatchAudioDirector } {
  const eng = new RecordingEngine();
  const dir = new MatchAudioDirector(eng as unknown as AudioEngine, { localTeam: 0, listenerCharId: 1, footsteps: o.footsteps ?? false });
  return { eng, dir };
}

/** Advance the fake sim by `ticks` ticks, one update per tick. */
function run(dir: MatchAudioDirector, sim: Fake, ticks: number, each?: (tick: number) => void): void {
  for (let i = 0; i < ticks; i++) {
    sim.state.tick++;
    each?.(sim.state.tick);
    dir.update(sim, 1 / 60);
  }
}

describe('police events', () => {
  it('arrival: drift stop at the car, then one door per officer', () => {
    const { eng, dir } = setup();
    const sim = view([char(1, 0, { x: 10, y: 10 })], []);
    dir.onEvents([
      { type: 'policeDispatched', tick: 600, carId: 1, wave: 1, officerIds: [1001, 1002, 1003], entryIndex: 0 },
      { type: 'policeArrived', tick: 720, carId: 1, pos: { x: 20, y: -2.4 } },
    ], sim);
    expect(eng.plays()).toEqual(['policeSkid', 'carDoor', 'carDoor', 'carDoor']);
    expect(eng.played('policeSkid')[0].o?.pos).toEqual({ x: 20, y: -2.4 });
    const delays = eng.played('carDoor').map((c) => c.o!.delay!);
    expect(delays[0]).toBeGreaterThan(0.2);
    for (let i = 1; i < delays.length; i++) expect(delays[i]).toBeGreaterThan(delays[i - 1]);
  });

  it('spotted: whistle + "멈춰!" only for a new pursuit that concerns us; flapping targets stay silent', () => {
    const { eng, dir } = setup();
    const sim = view([char(1, 0, { x: 0, y: 0 }), char(2, 1, { x: 5, y: 0 }), char(3, 1, { x: 60, y: 0 }), char(4, 0, { x: -3, y: 0 })], [], {
      police: [officer(1001, { x: 3, y: 0 }), officer(1002, { x: -3, y: 0 }), officer(1003, { x: 58, y: 0 })],
    });
    const spot = (tick: number, officerId: number, charId = 1): void => dir.onEvents([{ type: 'policeSpotted', tick, officerId, charId }], sim);
    spot(600, 1001);
    expect(eng.plays()).toEqual(['policeWhistle', 'policeBark']);
    expect(eng.played('policeBark')[0].o?.delay).toBeGreaterThan(0.1);
    expect(eng.played('policeWhistle')[0].o?.pos).toEqual({ x: 3, y: 0 });
    // The officer switches to a rival carrier right next to us: a new pursuit within earshot gets
    // its whistle, but no second "멈춰!" this soon (global bark gap).
    eng.calls = [];
    spot(630, 1001, 2);
    expect(eng.plays()).toEqual(['policeWhistle']);
    // ...and flaps straight back to us: a re-acquisition, silent.
    eng.calls = [];
    spot(660, 1001, 1);
    spot(700, 1001, 2);
    expect(eng.plays()).toEqual([]);
    // A second officer joins the chase on us 1.5 s after the first whistle at us: nobody whistles
    // at the same target twice within 3 s.
    spot(690, 1002, 1);
    expect(eng.plays()).toEqual([]);
    // A rival chased far from us (58 m): not our business.
    spot(720, 1003, 3);
    expect(eng.plays()).toEqual([]);
    // Two seconds later the second officer starts on our teammate: a new pursuit at our team.
    spot(840, 1002, 4);
    expect(eng.plays()).toEqual(['policeWhistle']);
    // Ten seconds after the first one, the first officer re-acquires us after losing us for longer
    // than POLICE_AUDIO.respotTicks: whistle again, but it already shouted "멈춰!" at us.
    eng.calls = [];
    spot(660 + POLICE_AUDIO.respotTicks + 60, 1001, 1);
    expect(eng.plays()).toEqual(['policeWhistle']);
    // The second officer has not shouted at us yet: its bark comes once the global gap allows.
    eng.calls = [];
    spot(660 + POLICE_AUDIO.respotTicks + 120 + POLICE_AUDIO.respotTicks, 1002, 1);
    expect(eng.plays()).toContain('policeBark');
  });

  it('pursuits the director saw in state count as recent: re-acquiring after a lunge is silent', () => {
    const { eng, dir } = setup();
    const o = officer(1001, { x: 3, y: 0 }, { phase: 'chase', targetCharId: 1 });
    const sim = view([char(1, 0, { x: 0, y: 0 })], [], { police: [o] });
    dir.onEvents([{ type: 'policeSpotted', tick: 600, officerId: 1001, charId: 1 }], sim);
    run(dir, sim, 60 * 6); // chasing us for 6 s
    o.phase = 'tired';
    o.targetCharId = null;
    run(dir, sim, 60 * 5); // lost us for 5 s (< respotTicks since the state last showed the pursuit)
    eng.calls = [];
    dir.onEvents([{ type: 'policeSpotted', tick: sim.state.tick, officerId: 1001, charId: 1 }], sim);
    expect(eng.played('policeWhistle')).toEqual([]);
  });

  it('whistle budget: at most whistleBurst at once and ~12 a minute sustained, any two >= 0.25 s apart', () => {
    const { eng, dir } = setup();
    const chars = [char(1, 0, { x: 0, y: 0 }), ...Array.from({ length: 30 }, (_, i) => char(10 + i, 0, { x: 2 + i * 0.2, y: 0 }))];
    const cops = Array.from({ length: 40 }, (_, i) => officer(2000 + i, { x: 4, y: i * 0.1 }));
    const sim = view(chars, [], { police: cops });
    const times: number[] = [];
    // Every 0.1 s a fresh officer / teammate pair: far more new pursuits than the budget allows.
    for (let k = 0; k < 1200; k++) {
      const tick = 600 + k * 6;
      const n = eng.played('policeWhistle').length;
      dir.onEvents([{ type: 'policeSpotted', tick, officerId: 2000 + (k % 40), charId: 10 + ((k * 7) % 30) }], sim);
      if (eng.played('policeWhistle').length > n) times.push(tick);
    }
    expect(times.length).toBeGreaterThan(5);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(POLICE_AUDIO.whistleGapTicks);
    // Over any 60 s window: the sustained rate plus the initial burst.
    const perMin = 3600 / POLICE_AUDIO.whistleRefillTicks;
    for (const t of times) expect(times.filter((x) => x >= t && x < t + 3600).length).toBeLessThanOrEqual(perMin + POLICE_AUDIO.whistleBurst);
    // Barks: each pair at most once, any two >= 9 s apart.
    const barks = eng.calls.filter((c) => c.fn === 'play' && c.id === 'policeBark');
    expect(barks.length).toBeGreaterThan(0);
    expect(barks.length).toBeLessThanOrEqual(Math.ceil((1200 * 6) / POLICE_AUDIO.barkGapTicks) + 1);
  });

  it('tackle hit on the listener: whoosh layered in, comic thump, knockdown and a music duck', () => {
    const { eng, dir } = setup();
    const sim = view([char(1, 0, { x: 0, y: 0 }), char(2, 1, { x: 8, y: 0 })], [], { police: [officer(1001, { x: 1, y: 0 }, { phase: 'tired' })] });
    dir.onEvents([{ type: 'policeTackle', tick: 600, officerId: 1001, victimId: 1, hit: true }], sim);
    expect(eng.plays()).toEqual(['tackleWhoosh', 'tackleHit', 'knockdown']);
    expect(eng.played('tackleHit')[0].o?.pos).toEqual({ x: 0, y: 0 });
    const duck = eng.calls.find((c) => c.fn === 'duck');
    expect(duck?.i).toBe(POLICE_AUDIO.tackleDuckDb);
    // A tackle on someone else: no duck.
    eng.calls = [];
    dir.onEvents([{ type: 'policeTackle', tick: 900, officerId: 1001, victimId: 2, hit: true }], sim);
    expect(eng.plays()).toContain('tackleHit');
    expect(eng.calls.find((c) => c.fn === 'duck')).toBeUndefined();
  });

  it('a lunge seen in state whooshes at its start; the hit then adds no second whoosh', () => {
    const { eng, dir } = setup();
    const o = officer(1001, { x: 2, y: 0 }, { phase: 'chase', targetCharId: 1 });
    const sim = view([char(1, 0, { x: 0, y: 0 })], [], { police: [o] });
    run(dir, sim, 3);
    o.phase = 'tackle';
    run(dir, sim, 1);
    expect(eng.played('tackleWhoosh').length).toBe(1);
    run(dir, sim, 5);
    expect(eng.played('tackleWhoosh').length).toBe(1);
    dir.onEvents([{ type: 'policeTackle', tick: sim.state.tick, officerId: 1001, victimId: 1, hit: true }], sim);
    expect(eng.played('tackleWhoosh').length).toBe(1);
    expect(eng.plays()).toContain('tackleHit');
  });

  it('tackle miss: soft swish; "태클 피했다!" only when the listener dodged', () => {
    const { eng, dir } = setup();
    const sim = view([char(1, 0, { x: 0, y: 0 }), char(3, 0, { x: 4, y: 0 })], [], { police: [officer(1001, { x: 1, y: 0 })] });
    dir.onEvents([{ type: 'policeTackle', tick: 600, officerId: 1001, victimId: 1, hit: false }], sim);
    expect(eng.plays()).toEqual(['tackleMiss', 'calloutDodge']);
    expect(eng.played('tackleMiss')[0].o?.pos).toEqual({ x: 1, y: 0 });
    eng.calls = [];
    dir.onEvents([{ type: 'policeTackle', tick: 700, officerId: 1001, victimId: 3, hit: false }], sim);
    expect(eng.plays()).toEqual(['tackleMiss']);
  });

  it('stunned officer: boing + birdies at the officer', () => {
    const { eng, dir } = setup();
    const sim = view([char(1, 0, { x: 0, y: 0 })], [], { police: [officer(1001, { x: 6, y: 2 })] });
    dir.onEvents([{ type: 'policeStunned', tick: 600, officerId: 1001, byCharId: 1 }], sim);
    expect(eng.plays()).toEqual(['policeStun']);
    expect(eng.played('policeStun')[0].o?.pos).toEqual({ x: 6, y: 2 });
  });

  it('leaving: the car revs off; "phew" only when it is the last car on the field', () => {
    const { eng, dir } = setup();
    const sim = view([char(1, 0, { x: 0, y: 0 })], [], {
      policeCars: [car(1, { x: 20, y: -2 }, { phase: 'leaving', sirenOn: false }), car(2, { x: 20, y: 40 }, { phase: 'parked' })],
    });
    dir.onEvents([{ type: 'policeLeaving', tick: 600, carId: 1 }], sim);
    expect(eng.plays()).toEqual(['carVroom']);
    sim.state.policeCars[1].phase = 'leaving';
    sim.state.policeCars[1].sirenOn = false;
    eng.calls = [];
    dir.onEvents([{ type: 'policeLeaving', tick: 900, carId: 2 }], sim);
    expect(eng.plays()).toEqual(['carVroom', 'policePhew']);
    expect(eng.played('policePhew')[0].o?.delay).toBeGreaterThan(0.5);
  });
});

describe('police loops', () => {
  it('alarm bell: one positional loop per ringing bank, starts after the hop, settles, stops on recovery', () => {
    const { eng, dir } = setup();
    const near = loot(11, 'bank', { x: 3, y: 0 }, { half: { x: 3, y: 2.5 } });
    const far = loot(12, 'bank', { x: 32, y: 0 }, { half: { x: 3, y: 2.5 } });
    const sim = view([char(1, 0, { x: 0, y: 0 })], [near, far], { alarm: { ringing: [11, 12], dispatchTick: 1320, waves: 0 } });
    dir.onEvents([
      { type: 'alarm', tick: 600, bankId: 11, dispatchTick: 1320 },
      { type: 'alarm', tick: 600, bankId: 12, dispatchTick: 1320 },
    ], sim);
    run(dir, sim, 20); // 0.33 s: the bank is still in the air
    expect(eng.loops('alarmBell').filter((c) => c.i! > 0)).toEqual([]);
    run(dir, sim, 40); // 1 s in
    const at1 = (key: string): number => eng.loops('alarmBell').filter((c) => c.key === key).at(-1)!.i!;
    expect(at1('bank11')).toBeGreaterThan(0.9);
    // Ducked with distance on top of the spatial roll-off.
    expect(at1('bank12')).toBeLessThan(at1('bank11') * 0.6);
    // After the first seconds it settles.
    run(dir, sim, 60 * 14);
    expect(at1('bank11')).toBeCloseTo(POLICE_AUDIO.alarmSettledLevel, 2);
    // Bank 11 recovered: its bell stops (explicit 0), bank 12 keeps ringing.
    sim.state.alarm.ringing = [12];
    near.recovered = true;
    eng.calls = [];
    run(dir, sim, 1);
    expect(eng.loops('alarmBell').find((c) => c.key === 'bank11')?.i).toBe(0);
    expect(eng.loops('alarmBell').find((c) => c.key === 'bank12')!.i).toBeGreaterThan(0);
  });

  it('alarm level envelope is pure and monotonic in distance', () => {
    const lvl = MatchAudioDirector.alarmLevel;
    expect(lvl(0, 0)).toBe(0);
    expect(lvl(0.5, 0)).toBe(0);
    expect(lvl(2, 0)).toBeCloseTo(1, 6);
    expect(lvl(60, 0)).toBeCloseTo(POLICE_AUDIO.alarmSettledLevel, 6);
    let prev = Infinity;
    for (let d = 0; d <= 40; d += 2) {
      const x = lvl(2, d);
      expect(x).toBeLessThanOrEqual(prev + 1e-12);
      prev = x;
    }
    expect(lvl(2, 40)).toBeCloseTo(POLICE_AUDIO.alarmFarLevel, 6);
  });

  it('siren: one loop per car while its siren is on, doppler-bent while driving in, settling when parked', () => {
    const { eng, dir } = setup();
    const c = car(1, { x: 20, y: -14 });
    const sim = view([char(1, 0, { x: 20, y: 10 })], [], { policeCars: [c] });
    const pitches: number[] = [];
    // Drive in toward the listener (ease-out, 2 s) like the sim does.
    run(dir, sim, 120, (tick) => {
      const u = Math.min(1, (tick - 600) / 120);
      c.pos = { x: 20, y: -14 + 11.6 * (1 - (1 - u) * (1 - u)) };
      const last = eng.loops('policeSiren').at(-1);
      if (last) pitches.push(last.pitch!);
    });
    const sirens = eng.loops('policeSiren');
    expect(new Set(sirens.map((s) => s.key))).toEqual(new Set(['car1']));
    expect(sirens.every((s) => s.i === 1)).toBe(true);
    // Approaching fast at first: bent up, relaxing to natural pitch as it brakes.
    expect(Math.max(...pitches)).toBeGreaterThan(1.04);
    expect(Math.max(...pitches)).toBeLessThanOrEqual(1 + POLICE_AUDIO.dopplerMaxBend + 1e-9);
    expect(pitches.at(-1)!).toBeLessThan(1.01);
    // Parked: settles to the parked level.
    c.phase = 'parked';
    run(dir, sim, 60 * 4);
    expect(eng.loops('policeSiren').at(-1)!.i).toBeCloseTo(POLICE_AUDIO.sirenParkedLevel, 3);
    expect(eng.loops('policeSiren').at(-1)!.pitch).toBeCloseTo(1, 3);
    // Leaving: siren off -> loop silenced.
    c.phase = 'leaving';
    c.sirenOn = false;
    eng.calls = [];
    run(dir, sim, 1);
    expect(eng.loops('policeSiren')).toEqual([{ fn: 'loop', id: 'policeSiren', i: 0, key: 'car1', pitch: 1 }]);
  });

  it('a receding car bends the siren down', () => {
    const { eng, dir } = setup();
    const c = car(1, { x: 0, y: 0 });
    const sim = view([char(1, 0, { x: 0, y: 20 })], [], { policeCars: [c] });
    run(dir, sim, 30, (tick) => {
      c.pos = { x: 0, y: -(tick - 600) * 0.15 };
    });
    expect(eng.loops('policeSiren').at(-1)!.pitch).toBeLessThan(0.97);
  });

  it('chase tweets only for officers chasing near the listener', () => {
    const { eng, dir } = setup();
    const a = officer(1001, { x: 4, y: 0 }, { phase: 'chase', targetCharId: 1 });
    const b = officer(1002, { x: -4, y: 0 }, { phase: 'patrol' });
    const far = officer(1003, { x: 30, y: 0 }, { phase: 'chase', targetCharId: 2 });
    const sim = view([char(1, 0, { x: 0, y: 0 }), char(2, 1, { x: 31, y: 0 })], [], { police: [a, b, far] });
    run(dir, sim, 60 * 12);
    const tweets = eng.played('policeWhistle');
    // Only the near chaser tweets (the patrolling one and the far chaser stay quiet).
    expect(tweets.length).toBeGreaterThanOrEqual(3);
    expect(tweets.every((t) => t.o!.pos!.x === 4)).toBe(true);
    expect(tweets.length).toBeLessThanOrEqual(Math.ceil((12 * 60) / POLICE_AUDIO.chaseTicks));
  });

  it('chase tweet timing: >= chaseTicks per officer, >= chaseGapTicks between any two, within the whistle budget', () => {
    const { eng, dir } = setup();
    const a = officer(1001, { x: 4, y: 0 }, { phase: 'chase', targetCharId: 1 });
    const b = officer(1002, { x: -4, y: 0 }, { phase: 'chase', targetCharId: 1 });
    const sim = view([char(1, 0, { x: 0, y: 0 })], [], { police: [a, b] });
    const times: { tick: number; who: number }[] = [];
    for (let i = 0; i < 60 * 20; i++) {
      sim.state.tick++;
      const n = eng.played('policeWhistle').length;
      dir.update(sim, 1 / 60);
      const now = eng.played('policeWhistle');
      for (const t of now.slice(n)) times.push({ tick: sim.state.tick, who: t.o!.pos!.x });
    }
    // Two officers chasing us for 20 s: sparse tweets from both (the shared budget, ~12 a minute,
    // keeps a token back for the next spotting whistle).
    expect(times.length).toBeGreaterThanOrEqual(4);
    expect(times.length).toBeLessThanOrEqual(Math.ceil((20 * 60) / POLICE_AUDIO.whistleRefillTicks) + POLICE_AUDIO.whistleBurst);
    for (let i = 1; i < times.length; i++) expect(times[i].tick - times[i - 1].tick).toBeGreaterThanOrEqual(POLICE_AUDIO.chaseGapTicks);
    for (const who of [4, -4]) {
      const mine = times.filter((t) => t.who === who).map((t) => t.tick);
      expect(mine.length).toBeGreaterThanOrEqual(1);
      for (let i = 1; i < mine.length; i++) expect(mine[i] - mine[i - 1]).toBeGreaterThanOrEqual(POLICE_AUDIO.chaseTicks);
    }
    // Right after a tweet, a new pursuit (a third officer on our teammate) still gets its spotting
    // whistle: tweets always leave a token in reserve.
    sim.state.characters.push(char(5, 0, { x: 1, y: 1 }));
    sim.state.police.push(officer(1003, { x: 2, y: 2 }));
    const last = times.at(-1)!.tick;
    const n = eng.played('policeWhistle').length;
    dir.onEvents([{ type: 'policeSpotted', tick: last + POLICE_AUDIO.whistleGapTicks, officerId: 1003, charId: 5 }], sim);
    expect(eng.played('policeWhistle').length).toBe(n + 1);
  });

  it('chase music: swells while officers are on the field, full when they chase us, falls after', () => {
    const { eng, dir } = setup();
    const o = officer(1001, { x: 10, y: 0 }, { phase: 'patrol' });
    const sim = view([char(1, 0, { x: 0, y: 0 }), char(2, 1, { x: 20, y: 0 })], [], { police: [o] });
    run(dir, sim, 60 * 6);
    expect(eng.tension()).toBeCloseTo(POLICE_AUDIO.tensionOnField, 1);
    o.phase = 'chase';
    o.targetCharId = 2; // chasing the other team: still just "on the field"
    run(dir, sim, 60 * 6);
    expect(eng.tension()).toBeCloseTo(POLICE_AUDIO.tensionOnField, 1);
    o.targetCharId = 1;
    run(dir, sim, 60 * 6);
    expect(eng.tension()).toBeGreaterThan(0.95);
    // The music intensity got the police bump too.
    const inten = eng.calls.filter((c) => c.fn === 'intensity').at(-1)!.i!;
    expect(inten).toBeGreaterThan(0.5);
    sim.state.police = [];
    run(dir, sim, 60 * 20);
    expect(eng.tension()).toBe(0);
    // stop() (pause, leaving) drops the chase layer at once.
    sim.state.police = [o];
    run(dir, sim, 60 * 3);
    expect(eng.tension()).toBeGreaterThan(0.5);
    dir.stop();
    expect(eng.tension()).toBe(0);
  });
});

describe('uproot presentation and callouts', () => {
  it('safe uproot: POP now, landing thud when the hop lands, "뽑았다!" stinger', () => {
    const { eng, dir } = setup();
    const small = loot(10, 'smallSafe', { x: 2, y: 0 });
    const large = loot(11, 'largeSafe', { x: 3, y: 0 });
    const farSmall = loot(12, 'smallSafe', { x: 30, y: 0 });
    const sim = view([char(1, 0, { x: 0, y: 0 }), char(2, 1, { x: 5, y: 0 })], [small, large, farSmall]);
    dir.onEvents([{ type: 'unanchored', tick: 600, lootId: 10, kind: 'smallSafe', byTeam: 0 }], sim);
    expect(eng.plays()).toEqual(['unanchorSafe', 'uprootLand', 'calloutUproot']);
    const land = eng.played('uprootLand')[0].o!;
    expect(land.delay).toBeCloseTo(LAND_DELAY.smallSafe, 6);
    expect(land.pitch).toBeGreaterThan(1);
    expect(eng.played('calloutUproot')[0].o?.step).toBe(0);
    // Large safe by the rival, near the listener: lower pop, heavier landing after the view's
    // hit-stop, the rival flavor of the stinger.
    eng.calls = [];
    dir.onEvents([{ type: 'unanchored', tick: 700, lootId: 11, kind: 'largeSafe', byTeam: 1 }], sim);
    expect(eng.played('unanchorSafe')[0].o?.pitch).toBeLessThan(1);
    expect(eng.played('uprootLand')[0].o?.delay).toBeCloseTo(LAND_DELAY.largeSafe + 0.05, 6);
    expect(eng.played('calloutUproot')[0].o?.step).toBe(-1);
    // A rival's small safe far away: pop and landing, no stinger.
    eng.calls = [];
    dir.onEvents([{ type: 'unanchored', tick: 800, lootId: 12, kind: 'smallSafe', byTeam: 1 }], sim);
    expect(eng.plays()).toEqual(['unanchorSafe', 'uprootLand']);
  });

  it('bank uproot: the big pop, the slam after the hop (+ hit-stop when near), "은행째!"', () => {
    const { eng, dir } = setup();
    const near = loot(20, 'bank', { x: 6, y: 0 });
    const far = loot(21, 'bank', { x: 40, y: 0 });
    const sim = view([char(1, 0, { x: 0, y: 0 })], [near, far]);
    dir.onEvents([{ type: 'unanchored', tick: 600, lootId: 20, kind: 'bank', byTeam: 0 }], sim);
    expect(eng.plays()).toEqual(['unanchorBank', 'bankLand', 'calloutBank']);
    expect(eng.played('bankLand')[0].o?.delay).toBeCloseTo(LAND_DELAY.bank + 0.12, 6);
    expect(eng.played('calloutBank')[0].o?.step).toBe(0);
    eng.calls = [];
    dir.onEvents([{ type: 'unanchored', tick: 700, lootId: 21, kind: 'bank', byTeam: 1 }], sim);
    expect(eng.played('bankLand')[0].o?.delay).toBeCloseTo(LAND_DELAY.bank, 6);
    expect(eng.played('calloutBank')[0].o?.step).toBe(-1);
  });

  it('reduced motion: no hit-stop, so the landing is not held back', () => {
    const near = loot(20, 'bank', { x: 6, y: 0 });
    const large = loot(11, 'largeSafe', { x: 3, y: 0 });
    const chars = [char(1, 0, { x: 0, y: 0 })];
    const eng = new RecordingEngine();
    const dir = new MatchAudioDirector(eng as unknown as AudioEngine, { localTeam: 0, listenerCharId: 1, footsteps: false, hitstop: false });
    const sim = view(chars, [near, large]);
    dir.onEvents([{ type: 'unanchored', tick: 600, lootId: 20, kind: 'bank', byTeam: 0 }], sim);
    dir.onEvents([{ type: 'unanchored', tick: 700, lootId: 11, kind: 'largeSafe', byTeam: 0 }], sim);
    expect(eng.played('bankLand')[0].o?.delay).toBeCloseTo(LAND_DELAY.bank, 6);
    expect(eng.played('uprootLand')[0].o?.delay).toBeCloseTo(LAND_DELAY.largeSafe, 6);
    // Switched live (settings change mid-match), also as a function asked at each uproot.
    let reduced = false;
    dir.setHitstop(() => !reduced);
    eng.calls = [];
    dir.onEvents([{ type: 'unanchored', tick: 800, lootId: 20, kind: 'bank', byTeam: 0 }], sim);
    expect(eng.played('bankLand')[0].o?.delay).toBeCloseTo(LAND_DELAY.bank + HITSTOP.bank.s, 6);
    reduced = true;
    eng.calls = [];
    dir.onEvents([{ type: 'unanchored', tick: 900, lootId: 20, kind: 'bank', byTeam: 0 }], sim);
    expect(eng.played('bankLand')[0].o?.delay).toBeCloseTo(LAND_DELAY.bank, 6);
  });

  it('the default follows the reduced-motion class the UI root keeps on <html>', () => {
    const classes = new Set<string>();
    const g = globalThis as unknown as { document?: unknown };
    const saved = g.document;
    g.document = { documentElement: { classList: { contains: (c: string) => classes.has(c) } } };
    try {
      const { eng, dir } = setup();
      const sim = view([char(1, 0, { x: 0, y: 0 })], [loot(20, 'bank', { x: 6, y: 0 })]);
      dir.onEvents([{ type: 'unanchored', tick: 600, lootId: 20, kind: 'bank', byTeam: 0 }], sim);
      classes.add('uh-reduced-motion');
      dir.onEvents([{ type: 'unanchored', tick: 900, lootId: 20, kind: 'bank', byTeam: 0 }], sim);
      expect(eng.played('bankLand').map((c) => c.o!.delay!)).toEqual([LAND_DELAY.bank + HITSTOP.bank.s, LAND_DELAY.bank]);
    } finally {
      g.document = saved;
    }
  });

  it('mirrored render constants match the render source (landing times, hit-stops)', () => {
    const src = (f: string): string => readFileSync(new URL(`../../src/render/${f}`, import.meta.url), 'utf8');
    const num = (re: RegExp, text: string, what: string): number => {
      const m = re.exec(text);
      expect(m, `${what} not found: update the audio mirror (sfxStage LAND_DELAY / director HITSTOP) and this test`).not.toBeNull();
      return Number(m![1]);
    };
    const bank = src('models/bank.ts');
    const safes = src('models/safes.ts');
    const uproot = src('uproot.ts');
    const viewSrc = src('view.ts');
    expect(LAND_DELAY.bank).toBeCloseTo(num(/BANK_POP\s*=\s*\{[^}]*\bland:\s*([\d.]+)/, bank, 'BANK_POP.land'), 6);
    const landFrac = num(/SAFE_POP\.large\.time\)\s*\*\s*([\d.]+)/, uproot, 'safe landing fraction');
    expect(LAND_DELAY.smallSafe).toBeCloseTo(num(/small:\s*\{\s*time:\s*([\d.]+)/, safes, 'SAFE_POP.small.time') * landFrac, 6);
    expect(LAND_DELAY.largeSafe).toBeCloseTo(num(/large:\s*\{\s*time:\s*([\d.]+)/, safes, 'SAFE_POP.large.time') * landFrac, 6);
    // view.ts 'unanchored': bank hit-stop when nearFactor(pos, R) > k, large safe likewise.
    const bankR = num(/const near = nearFactor\(l\.pos, ([\d.]+)\)/, viewSrc, 'bank hit-stop radius');
    const bankK = num(/if \(near > ([\d.]+)\) this\.hitstop = Math\.max\(this\.hitstop, [\d.]+\)/, viewSrc, 'bank hit-stop threshold');
    const bankS = num(/if \(near > [\d.]+\) this\.hitstop = Math\.max\(this\.hitstop, ([\d.]+)\)/, viewSrc, 'bank hit-stop length');
    expect(HITSTOP.bank.s).toBeCloseTo(bankS, 6);
    expect(HITSTOP.bank.within).toBeCloseTo(bankR * (1 - bankK), 6);
    const m = /l\.kind === 'largeSafe' && nearFactor\(l\.pos, ([\d.]+)\) > ([\d.]+)\) this\.hitstop = Math\.max\(this\.hitstop, ([\d.]+)\)/.exec(viewSrc);
    expect(m, 'large safe hit-stop not found').not.toBeNull();
    expect(HITSTOP.largeSafe.within).toBeCloseTo(Number(m![1]) * (1 - Number(m![2])), 6);
    expect(HITSTOP.largeSafe.s).toBeCloseTo(Number(m![3]), 6);
    // The view skips its hit-stops with reduced motion (the director's default mirrors that).
    expect(viewSrc).toMatch(/reducedMotion \? 0 : this\.hitstop/);
  });

  it('strain build-up: pitch follows the object size, intensity the unanchor progress', () => {
    const { eng, dir } = setup();
    const c = char(1, 0, { x: 0, y: 0 }, { straining: true });
    const items = [
      loot(10, 'smallSafe', { x: 1, y: 0 }, { anchored: true, unanchorProgress: 0.2, grabbedBy: [1] }),
      loot(11, 'largeSafe', { x: 1, y: 1 }, { anchored: true, unanchorProgress: 0.5, grabbedBy: [1] }),
      loot(12, 'bank', { x: 5, y: 0 }, { anchored: true, unanchorProgress: 0.9, grabbedBy: [1] }),
    ];
    dir.update(view([c], items), 1 / 60);
    const s = eng.loops('strain');
    expect(s.map((x) => x.pitch)).toEqual([STRAIN_PITCH.smallSafe, STRAIN_PITCH.largeSafe, STRAIN_PITCH.bank]);
    expect(STRAIN_PITCH.bank).toBeLessThan(STRAIN_PITCH.largeSafe);
    expect(STRAIN_PITCH.largeSafe).toBeLessThan(STRAIN_PITCH.smallSafe);
    expect(s[2].i).toBeCloseTo(0.15 + 0.85 * 0.9, 6);
  });

  it('"가로채기!": a safe pulled out of a bank the other team was hauling', () => {
    const { eng, dir } = setup();
    const safe = loot(10, 'largeSafe', { x: 2, y: 0 });
    const sim = view([char(1, 0, { x: 0, y: 0 }), char(2, 1, { x: 5, y: 0 }), char(3, 0, { x: 1, y: 0 })], [safe, loot(20, 'bank', { x: 3, y: 0 })]);
    const unload = (byCharId: number | null, bankCarrierTeam: 0 | 1 | null): void =>
      dir.onEvents([{ type: 'safeUnloaded', tick: 600, safeId: 10, bankId: 20, bankValue: 500, byCharId, bankCarrierTeam }], sim);
    unload(1, 1);
    expect(eng.played('calloutSteal').map((c) => c.o?.step)).toEqual([0]);
    eng.calls = [];
    unload(2, 0); // the rival steals from our bank
    expect(eng.played('calloutSteal').map((c) => c.o?.step)).toEqual([-1]);
    eng.calls = [];
    unload(3, 0); // our own team unloading our bank: no steal
    unload(1, null); // nobody hauling: no steal
    expect(eng.played('calloutSteal')).toEqual([]);
    expect(eng.played('safeUnload').length).toBe(2);
  });

  it('consecutive own recoveries keep climbing (coins rise one degree per recovery)', () => {
    const { eng, dir } = setup();
    const sim = view([char(1, 0, { x: 0, y: 0 })], [loot(10, 'smallSafe', { x: 0, y: 0 })]);
    for (let i = 0; i < 4; i++) {
      dir.onEvents([{ type: 'recovered', tick: 600 + i * 120, lootId: 10, kind: 'smallSafe', team: 0, value: 100, safeIds: [], safesValue: 0, holders: [] }], sim);
    }
    expect(eng.played('scoreSmall').map((c) => c.o?.step)).toEqual([0, 1, 2, 3]);
  });

  it('matchStart resets police bookkeeping (a rematch barks again at once)', () => {
    const { eng, dir } = setup();
    const sim = view([char(1, 0, { x: 0, y: 0 })], [], { police: [officer(1001, { x: 2, y: 0 })] });
    dir.onEvents([{ type: 'policeSpotted', tick: 600, officerId: 1001, charId: 1 }], sim);
    dir.onEvents([{ type: 'matchStart', tick: 0 }], sim);
    eng.calls = [];
    dir.onEvents([{ type: 'policeSpotted', tick: 30, officerId: 1001, charId: 1 }], sim);
    expect(eng.plays()).toEqual(['policeWhistle', 'policeBark']);
    expect(eng.tension()).toBeUndefined();
  });
});

describe('integration: a real police match', () => {
  it('police events from the real sim play through a real engine on the mock context', async () => {
    const ctx = mockContext();
    const engine = new AudioEngine({ createContext: () => ctx, autoPump: false, seed: 4 });
    await engine.unlock();
    const sim = new Simulation({
      layout: LAYOUTS.plaza,
      roster: [
        { team: 0, isBot: false, name: 'P1', look: { hat: 'teamCapA' } },
        { team: 0, isBot: true, name: 'B1', look: { hat: 'teamCapA' } },
        { team: 1, isBot: true, name: 'B2', look: { hat: 'teamCapB' } },
        { team: 1, isBot: true, name: 'B3', look: { hat: 'teamCapB' } },
      ],
      seed: 1,
      rules: { police: true, earlyDecision: false },
    });
    const dir = new MatchAudioDirector(engine, { localTeam: 0, listenerCharId: 1 });
    const driver = new FuzzDriver(sim, 5);
    const seen = new Set<string>();
    let maxLoops = 0;
    for (let t = 0; t < 60 * 140 && !sim.state.over; t++) {
      const ev = sim.step(driver.commands());
      for (const e of ev) seen.add(e.type);
      if (ev.length) dir.onEvents(ev, sim);
      if (t % 2 === 0) {
        ctx.currentTime += 1 / 30;
        dir.update(sim, 1 / 30);
        engine.pump();
        maxLoops = Math.max(maxLoops, engine.stats().loops);
      }
    }
    for (const e of ['alarm', 'policeDispatched', 'policeArrived', 'policeSpotted']) expect(seen.has(e), e).toBe(true);
    expect(ctx.sourcesStarted).toBeGreaterThan(300);
    expect(maxLoops).toBeGreaterThan(0);
    dir.stop();
    ctx.currentTime += 3;
    engine.pump();
    expect(engine.stats().loops).toBe(0);
  });
});

describe('integration: police chatter rate in real matches', () => {
  it('whistles and barks stay sparse while officers chase real carriers (targets flap)', () => {
    let whistles = 0;
    let barks = 0;
    let onFieldTicks = 0;
    let spots = 0;
    const barkTicks: number[] = [];
    for (const seed of [1, 2]) {
      const eng = new RecordingEngine();
      const sim = new Simulation({
        layout: LAYOUTS.plaza,
        roster: [
          { team: 0, isBot: false, name: 'P1', look: { hat: 'teamCapA' } },
          { team: 0, isBot: true, name: 'B1', look: { hat: 'teamCapA' } },
          { team: 1, isBot: true, name: 'B2', look: { hat: 'teamCapB' } },
          { team: 1, isBot: true, name: 'B3', look: { hat: 'teamCapB' } },
        ],
        seed,
        rules: { police: true, earlyDecision: false },
      });
      const dir = new MatchAudioDirector(eng as unknown as AudioEngine, { localTeam: 0, listenerCharId: 1, footsteps: false, driveMusic: false });
      const driver = new FuzzDriver(sim, 5 + seed);
      for (let t = 0; t < 60 * 150 && !sim.state.over; t++) {
        const ev = sim.step(driver.commands());
        spots += ev.filter((e) => e.type === 'policeSpotted').length;
        const n = eng.played('policeBark').length;
        if (ev.length) dir.onEvents(ev, sim);
        if (eng.played('policeBark').length > n) barkTicks.push(seed * 1e6 + sim.state.tick);
        dir.update(sim, 1 / 60);
        if (sim.state.police.some((o) => o.phase !== 'leaving' && o.phase !== 'gone')) onFieldTicks++;
      }
      whistles += eng.played('policeWhistle').length;
      barks += eng.played('policeBark').length;
    }
    const minutes = onFieldTicks / 3600;
    expect(minutes).toBeGreaterThan(0.3);
    expect(spots).toBeGreaterThan(0);
    // ~12 whistles a minute at most (budget), and far fewer barks.
    expect(whistles / minutes).toBeLessThanOrEqual(3600 / POLICE_AUDIO.whistleRefillTicks + 2 * POLICE_AUDIO.whistleBurst / minutes);
    expect(barks / minutes).toBeLessThanOrEqual(3600 / POLICE_AUDIO.barkGapTicks + 1 / minutes);
    for (let i = 1; i < barkTicks.length; i++) if (barkTicks[i] - barkTicks[i - 1] < 1e5) expect(barkTicks[i] - barkTicks[i - 1]).toBeGreaterThanOrEqual(POLICE_AUDIO.barkGapTicks);
  });
});

describe('music drive', () => {
  it('intensity keeps converging to its target (small smoothing steps still reach the engine)', () => {
    const { eng, dir } = setup();
    const bank = loot(20, 'bank', { x: 3, y: 0 }, { vel: { x: 1, y: 0 } });
    const sim = view([char(1, 0, { x: 0, y: 0 })], [bank]);
    dir.onEvents([{ type: 'matchStart', tick: 0 }], sim);
    run(dir, sim, 60 * 20);
    // Target with a moving bank: 0.42 + 0.2.
    const last = eng.calls.filter((c) => c.fn === 'intensity').at(-1)!.i!;
    expect(last).toBeGreaterThan(0.6);
  });
});
