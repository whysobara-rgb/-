/**
 * Game feel: hit-stop / slow-mo only change wall-clock pacing; the sim stays deterministic.
 * Match setup: roster rules and deterministic seeds. Version: matches package.json.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HITSTOP, RUMBLE, SLOWMO, TimeScale, rumbleFor } from '../../src/game/feel';
import { botSeed, buildMatch, mixSeed, type MatchConfig } from '../../src/game/setup';
import { parseLaunchParams } from '../../src/game/params';
import { GAME_VERSION } from '../../src/game/version';
import { DT, Simulation, type Command } from '../../src/sim';
import { createBot } from '../../src/ai';

describe('TimeScale', () => {
  it('hit-stop freezes for exactly the requested wall time, then runs at full speed', () => {
    const ts = new TimeScale();
    ts.hitstop(HITSTOP.dashKnockdown);
    expect(ts.frozen).toBe(true);
    expect(ts.advance(0.05)).toBe(0);
    // 20 ms of hit-stop left, then 30 ms of play
    expect(ts.advance(0.05)).toBeCloseTo(0.03, 6);
    expect(ts.frozen).toBe(false);
    expect(ts.advance(1 / 60)).toBeCloseTo(1 / 60, 9);
  });

  it('overlapping hit-stops take the longest (never stack) and are capped', () => {
    const ts = new TimeScale();
    ts.hitstop(0.07);
    ts.hitstop(0.12);
    ts.hitstop(0.05);
    expect(ts.advance(0.119)).toBe(0);
    expect(ts.advance(0.011)).toBeCloseTo(0.01, 6);
    ts.hitstop(5);
    expect(ts.advance(1)).toBeCloseTo(1 - HITSTOP.max, 6);
  });

  it('slow-mo runs at ~0.35x for ~0.6 s and eases back to 1', () => {
    const ts = new TimeScale();
    ts.slowmo();
    let game = 0;
    for (let i = 0; i < 36; i++) game += ts.advance(1 / 60);
    expect(ts.slow).toBe(false);
    expect(game).toBeGreaterThan(SLOWMO.seconds * SLOWMO.scale);
    expect(game).toBeLessThan(SLOWMO.seconds * 0.6);
    expect(ts.advance(0.1)).toBeCloseTo(0.1, 9);
  });

  it('reduced motion disables both (and cancels running ones)', () => {
    const ts = new TimeScale();
    ts.hitstop(0.1);
    ts.setEnabled(false);
    expect(ts.frozen).toBe(false);
    ts.hitstop(0.1);
    ts.slowmo();
    expect(ts.advance(0.05)).toBeCloseTo(0.05, 9);
  });

  it('pacing never changes the simulation: same ticks + commands -> same state', () => {
    const cfg: MatchConfig = { kind: 'quick', layoutId: 'plaza', mode: '1v1', rival: 'nunchi', difficulty: 'normal', adaptation: null, seed: 99, humanHat: 'teamCapA' };
    const run = (paced: boolean): string => {
      const built = buildMatch(cfg);
      const sim = new Simulation(built.setup);
      const bots = built.bots.map((b) => createBot(sim, b));
      const human = createBot(sim, { slot: 0, personality: 'tongkeun', difficulty: 'normal', seed: 5 });
      const ts = new TimeScale();
      let acc = 0;
      let frame = 0;
      while (sim.state.tick < 1200) {
        frame++;
        if (paced && frame % 37 === 0) ts.hitstop(0.12);
        if (paced && frame % 101 === 0) ts.slowmo();
        acc += ts.advance(1 / 60);
        let steps = 0;
        while (acc >= DT && steps < 5) {
          acc -= DT;
          steps++;
          const cmds: Command[] = [human.update(sim)];
          for (const b of bots) cmds[b.slot] = b.update(sim);
          sim.step(cmds);
        }
      }
      return JSON.stringify({ t: sim.state.tick, s: sim.state.scores, c: sim.state.characters.map((c) => [c.pos.x.toFixed(6), c.pos.y.toFixed(6)]) });
    };
    expect(run(true)).toBe(run(false));
  }, 60000);
});

describe('rumble', () => {
  it('patterns: light tick on grab, thud on knockdown, long roll on bank uproot / recovery', () => {
    expect(RUMBLE.grabTick[0]!.strength).toBeLessThan(0.3);
    expect(RUMBLE.knockdownThud[0]!.strength).toBeGreaterThan(0.8);
    const total = (n: keyof typeof RUMBLE): number => RUMBLE[n].reduce((s, p) => s + p.ms + (p.delayMs ?? 0), 0);
    expect(total('bankUprootRoll')).toBeGreaterThan(500);
    expect(total('bankRecoveryRoll')).toBeGreaterThan(total('safeRecovery'));
  });

  it('only events the player is part of rumble', () => {
    const me = { pos: { x: 0, y: 0 } };
    const sim = {
      getCharacter: (id: number) => (id === 1 ? (me as never) : undefined),
      getLoot: () => undefined,
    };
    expect(rumbleFor({ type: 'grab', tick: 1, charId: 1, targetId: 9, part: 'safe' }, sim, 1, 0)).toBe('grabTick');
    expect(rumbleFor({ type: 'grab', tick: 1, charId: 2, targetId: 9, part: 'safe' }, sim, 1, 0)).toBeNull();
    expect(rumbleFor({ type: 'dashHit', tick: 1, attackerId: 3, victimId: 1, knockdown: true }, sim, 1, 0)).toBe('knockdownThud');
    expect(rumbleFor({ type: 'recovered', tick: 1, lootId: 5, kind: 'bank', team: 0, value: 1000, safeIds: [], safesValue: 0, holders: [] }, sim, 1, 0)).toBe('bankRecoveryRoll');
    expect(rumbleFor({ type: 'recovered', tick: 1, lootId: 5, kind: 'bank', team: 1, value: 1000, safeIds: [], safesValue: 0, holders: [] }, sim, 1, 0)).toBeNull();
  });
});

describe('match setup', () => {
  const base: MatchConfig = { kind: 'quick', layoutId: 'plaza', mode: '1v1', rival: 'tongkeun', difficulty: 'challenge', adaptation: null, seed: 1234, humanHat: 'nunchiMask' };

  it('1:1: human slot 0 / team 0 in the equipped hat, one rival bot on team 1 in its look', () => {
    const b = buildMatch(base);
    expect(b.setup.roster.map((r) => [r.team, r.isBot])).toEqual([
      [0, false],
      [1, true],
    ]);
    expect(b.setup.roster[0]!.look.hat).toBe('nunchiMask');
    expect(b.setup.roster[1]!.look).toMatchObject({ hat: 'tongkeunHat', rival: 'tongkeun' });
    expect(b.bots).toEqual([{ slot: 1, personality: 'tongkeun', difficulty: 'challenge', adaptation: null, seed: botSeed(1234, 1) }]);
  });

  it('2:2: a teammate bot + two opponents; only the tournament passes an adaptation', () => {
    const adaptation = { kind: 'guardDoors' as const, lineKey: 'adapt.tongkeun.guardDoors.1' };
    const quick = buildMatch({ ...base, mode: '2v2', adaptation });
    expect(quick.setup.roster.map((r) => [r.team, r.isBot])).toEqual([
      [0, false],
      [0, true],
      [1, true],
      [1, true],
    ]);
    expect(quick.bots.map((b) => b.adaptation)).toEqual([null, null, null]);
    const tour = buildMatch({ ...base, kind: 'tournament', adaptation });
    expect(tour.bots[0]!.adaptation).toEqual(adaptation);
  });

  it('police (owner addition): on for real matches unless turned off, never in the tutorial', () => {
    expect(buildMatch(base).setup.rules).toMatchObject({ police: true });
    expect(buildMatch({ ...base, police: false }).setup.rules).toMatchObject({ police: false });
    expect(buildMatch({ ...base, kind: 'tutorial', layoutId: 'tutorial' }).setup.rules?.police).toBeUndefined();
  });

  it('tutorial: alone, no time limit, no early decision', () => {
    const b = buildMatch({ ...base, kind: 'tutorial', layoutId: 'tutorial' });
    expect(b.setup.roster).toHaveLength(1);
    expect(b.bots).toEqual([]);
    expect(b.setup.rules).toMatchObject({ timeLimit: false, earlyDecision: false });
  });

  it('seeds are deterministic and well mixed', () => {
    expect(botSeed(1, 1)).toBe(botSeed(1, 1));
    expect(botSeed(1, 1)).not.toBe(botSeed(1, 2));
    expect(mixSeed(5, 1)).toBe(mixSeed(5, 1));
    expect(new Set([1, 2, 3, 4, 5].map((i) => mixSeed(42, i))).size).toBe(5);
  });
});

describe('launch params / version', () => {
  it('parses test hooks and clamps them', () => {
    const p = parseLaunchParams('?autotest=1&speed=99&render=4&layout=counter&mode=2v2&flow=quick&skipIntro=1&lang=en&quality=low', false);
    expect(p).toMatchObject({ autotest: true, speed: 32, renderEvery: 4, layout: 'counter', mode: '2v2', flow: 'quick', skipIntro: true, lang: 'en', quality: 'low', hooks: true });
    const q = parseLaunchParams('?layout=nope&mode=3v3', false);
    expect(q).toMatchObject({ autotest: false, speed: 1, renderEvery: 1, layout: null, mode: null, hooks: false });
    expect(parseLaunchParams('', true).hooks).toBe(true);
    expect(parseLaunchParams('?police=0', false).police).toBe(false);
    expect(parseLaunchParams('', false).police).toBeNull();
  });

  it('GAME_VERSION matches package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(GAME_VERSION).toBe(pkg.version);
  });
});

describe('camera punch requested by game flow', () => {
  it('stays stable and settles even at the 0.1 s frame-time clamp (slow machines, ?render=N)', async () => {
    const { GameCamera } = await import('../../src/render/camera');
    for (const dt of [1 / 60, 0.05, 0.089, 0.1]) {
      const cam = new GameCamera();
      cam.setArena({ x: 60, y: 40 });
      const goal = { target: { x: 30, y: 20 }, distance: 20, pitch: 55, fov: 38, followRate: 6, clamp: false };
      cam.snap();
      cam.update(dt, goal, { screenShake: 1, reducedMotion: false });
      const rest = cam.camera.position.clone();
      cam.punch({ x: 0, y: 1 }, 1);
      cam.zoomPunch(0.3);
      expect(cam.shakeTrauma).toBe(0);
      let peak = 0;
      for (let i = 0; i < Math.ceil(3 / dt); i++) {
        cam.update(dt, goal, { screenShake: 1, reducedMotion: false });
        peak = Math.max(peak, cam.camera.position.distanceTo(rest));
      }
      expect(peak).toBeLessThan(5);
      expect(cam.camera.position.distanceTo(rest)).toBeLessThan(0.05);
    }
  });
});
