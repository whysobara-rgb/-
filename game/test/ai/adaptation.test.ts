/**
 * Rival observation and between-game adaptation (doc §11 라이벌전의 다음 판, §19 라이벌 재대결 검증).
 */
import { describe, expect, it } from 'vitest';
import { RivalObserver, chooseAdaptation, type ObservationSummary } from '../../src/ai/observer';
import { Bot } from '../../src/ai/bot';
import { LAYOUTS } from '../../src/sim/layouts/index';
import { Simulation } from '../../src/sim/sim';
import type { Command, RosterEntry, Vec2 } from '../../src/sim/types';
import { EMPTY_COMMAND } from '../../src/sim/types';

function summary(over: Partial<ObservationSummary> = {}): ObservationSummary {
  return {
    humanTeam: 0,
    botTeam: 1,
    layoutId: 'plaza',
    ticks: 9000,
    smallRecoveries: 0,
    smallRecoveryValue: 0,
    chokeSightings: {},
    chokeValue: {},
    bankRecoveries: 0,
    bankRecoveryValue: 0,
    thefts: 0,
    theftValue: 0,
    ...over,
  };
}

describe('chooseAdaptation', () => {
  const plaza = LAYOUTS.plaza;

  it('returns null when nothing qualifies (one sighting is not a habit)', () => {
    expect(chooseAdaptation(summary(), plaza, 'hodadak')).toBeNull();
    expect(chooseAdaptation(summary({ chokeSightings: { 'choke.plaza.bakeryAlley': 1 }, smallRecoveries: 3, smallRecoveryValue: 300 }), plaza, 'hodadak')).toBeNull();
  });

  it('ambushChoke after >= 2 sightings at the same chokepoint, with the chokepoint name as a line param', () => {
    const a = chooseAdaptation(summary({ chokeSightings: { 'choke.plaza.bakeryAlley': 3, 'choke.plaza.fountain': 1 }, chokeValue: { 'choke.plaza.bakeryAlley': 300 }, smallRecoveries: 3, smallRecoveryValue: 300 }), plaza, 'hodadak')!;
    expect(a.kind).toBe('ambushChoke');
    expect(a.chokepointId).toBe('choke.plaza.bakeryAlley');
    expect(a.lineParams).toEqual({ choke: 'choke.plaza.bakeryAlley' });
    expect(a.lineKey).toMatch(/^adapt\.hodadak\.ambushChoke\.[123]$/);
  });

  it('stripBank after the human recovered a bank whole', () => {
    const a = chooseAdaptation(summary({ bankRecoveries: 1, bankRecoveryValue: 1000 }), plaza, 'tongkeun')!;
    expect(a.kind).toBe('stripBank');
    expect(a.chokepointId).toBeUndefined();
    expect(a.lineKey).toMatch(/^adapt\.tongkeun\.stripBank\.[123]$/);
  });

  it('guardDoors after >= 1 theft from a bank the bots were hauling', () => {
    const a = chooseAdaptation(summary({ thefts: 1, theftValue: 300 }), plaza, 'nunchi')!;
    expect(a.kind).toBe('guardDoors');
    expect(a.lineKey).toMatch(/^adapt\.nunchi\.guardDoors\.[123]$/);
  });

  it('picks exactly one counter: the behavior that cost the bots the most points', () => {
    const s = summary({
      chokeSightings: { 'choke.plaza.bakeryAlley': 2 },
      chokeValue: { 'choke.plaza.bakeryAlley': 200 },
      bankRecoveries: 1,
      bankRecoveryValue: 700,
      thefts: 2,
      theftValue: 400,
    });
    expect(chooseAdaptation(s, plaza, 'hodadak')!.kind).toBe('stripBank');
    expect(chooseAdaptation({ ...s, bankRecoveryValue: 300 }, plaza, 'hodadak')!.kind).toBe('guardDoors');
    expect(chooseAdaptation({ ...s, bankRecoveries: 0, bankRecoveryValue: 0, thefts: 0, theftValue: 0 }, plaza, 'hodadak')!.kind).toBe('ambushChoke');
  });
});

describe('RivalObserver', () => {
  /**
   * The human drags a small safe north->south through the plaza bakery alley (x = 12) and past
   * its chokepoint (12, 7.5). The single bot is either far away (no sight) or watching.
   */
  function run(botPos: Vec2): ReturnType<RivalObserver['summary']> {
    const roster: RosterEntry[] = [
      { team: 0, isBot: false, name: 'human', look: { hat: 'none' } },
      { team: 1, isBot: true, name: 'bot', look: { hat: 'none' } },
    ];
    const sim = new Simulation({ layout: LAYOUTS.plaza, roster, seed: 1 });
    const obs = new RivalObserver(sim, 0);
    const safe = sim.state.loot.find((l) => l.kind === 'smallSafe' && l.floorOf === null)!;
    sim.debug.setAnchored(safe.id, false);
    sim.debug.teleport(safe.id, { x: 12, y: 1.25 }, 0);
    sim.debug.teleport(1, { x: 12, y: 2.2 }, Math.PI / 2);
    sim.debug.teleport(2, botPos);
    const cmd = (c: Partial<Command>): Command => ({ ...EMPTY_COMMAND, ...c });
    for (let t = 0; t < 400; t++) {
      const me = sim.characterBySlot(0);
      let c: Command;
      if (!me.grab) c = cmd({ grab: t % 2 === 0, aim: { x: 0, y: -1 } });
      else c = cmd({ grab: true, move: me.pos.y < 11 ? { x: 0, y: 1 } : { x: 0, y: 0 } });
      const ev = sim.step([c, EMPTY_COMMAND]);
      obs.observe(sim, ev);
    }
    // sanity: the human really dragged it through the choke
    const s = sim.getLoot(safe.id)!;
    expect(s.pos.y).toBeGreaterThan(8);
    return obs.summary();
  }

  it('records a chokepoint only when a bot really saw the human carrying a small safe there', () => {
    const unseen = run({ x: 70, y: 44 });
    expect(unseen.chokeSightings).toEqual({});
    const seen = run({ x: 12, y: 13 });
    expect(seen.chokeSightings['choke.plaza.bakeryAlley']).toBe(1);
  });

  it('a whole-bank recovery by the human team is a public record', () => {
    const roster: RosterEntry[] = [
      { team: 0, isBot: false, name: 'human', look: { hat: 'none' } },
      { team: 1, isBot: true, name: 'bot', look: { hat: 'none' } },
    ];
    const sim = new Simulation({ layout: LAYOUTS.plaza, roster, seed: 1 });
    const obs = new RivalObserver(sim, 0);
    const bank = sim.state.loot.find((l) => l.kind === 'bank')!;
    sim.debug.setAnchored(bank.id, false);
    sim.debug.teleport(bank.id, LAYOUTS.plaza.zones[0]!.center, 0);
    for (let t = 0; t < 120; t++) obs.observe(sim, sim.step([EMPTY_COMMAND, EMPTY_COMMAND]));
    const s = obs.summary();
    expect(s.bankRecoveries).toBe(1);
    expect(s.bankRecoveryValue).toBe(1000);
    expect(chooseAdaptation(s, LAYOUTS.plaza, 'tongkeun')!.kind).toBe('stripBank');
  });
});

describe('adapted bots change exactly the one behavior', () => {
  const roster: RosterEntry[] = [
    { team: 0, isBot: false, name: 'human', look: { hat: 'none' } },
    { team: 1, isBot: true, name: 'rival', look: { hat: 'none' } },
  ];

  const ambush = (choke: { id: string; nameKey: string }) => ({ kind: 'ambushChoke' as const, chokepointId: choke.id, lineKey: 'adapt.nunchi.ambushChoke.1', lineParams: { choke: choke.nameKey } });

  it('ambushChoke: no watch schedule — while the human is not seen near the chokepoint the rival just plays', () => {
    const choke = LAYOUTS.plaza.chokepoints.find((c) => c.id === 'choke.plaza.flowerRoadE')!;
    const run = (adapted: boolean): { watch: number; score: number } => {
      const sim = new Simulation({ layout: LAYOUTS.plaza, roster, seed: 3 });
      const bot = new Bot(sim, { slot: 1, personality: 'nunchi', difficulty: 'normal', seed: 5, adaptation: adapted ? ambush(choke) : null });
      let watch = 0;
      for (let t = 0; t < 90 * 60; t++) {
        sim.step([EMPTY_COMMAND, bot.update(sim)]);
        if (bot.intent().goal === 'ambush') watch++;
      }
      return { watch, score: sim.state.scores[1] };
    };
    const adapted = run(true);
    const plain = run(false);
    expect(adapted.watch).toBe(0);
    expect(plain.watch).toBe(0);
    // it scores like a normal rival (exact numbers differ: the extra option changes its rolls)
    expect(adapted.score).toBeGreaterThan(0.6 * plain.score);
  });

  it('ambushChoke: when the human is SEEN carrying a small safe toward that chokepoint, the rival goes there to cut them off', () => {
    // the human drags a small safe north->south through the plaza bakery alley (x = 12) and past
    // its chokepoint (12, 7.5); the rival (호다닥: normally busy collecting) can see it
    const choke = LAYOUTS.plaza.chokepoints.find((c) => c.id === 'choke.plaza.bakeryAlley')!;
    const run = (adapted: boolean): number => {
      const sim = new Simulation({ layout: LAYOUTS.plaza, roster, seed: 1 });
      const safe = sim.state.loot.find((l) => l.kind === 'smallSafe' && l.floorOf === null)!;
      sim.debug.setAnchored(safe.id, false);
      sim.debug.teleport(safe.id, { x: 12, y: 1.25 }, 0);
      sim.debug.teleport(1, { x: 12, y: 2.2 }, Math.PI / 2);
      sim.debug.teleport(2, { x: 13, y: 14 });
      const bot = new Bot(sim, { slot: 1, personality: 'hodadak', difficulty: 'normal', seed: 5, adaptation: adapted ? ambush(choke) : null });
      const cmd = (c: Partial<Command>): Command => ({ ...EMPTY_COMMAND, ...c });
      let n = 0;
      for (let t = 0; t < 8 * 60; t++) {
        const me = sim.characterBySlot(0);
        let c: Command;
        if (!me.grab) c = cmd({ grab: t % 2 === 0, aim: { x: 0, y: -1 } });
        else c = cmd({ grab: true, move: me.pos.y < 11 ? { x: 0, y: 0.6 } : { x: 0, y: 0 } });
        sim.step([c, bot.update(sim)]);
        const g = bot.intent().goal;
        if (g === 'ambush' || g === 'intercept') n++;
      }
      return n;
    };
    expect(run(true)).toBeGreaterThan(2 * 60);
    expect(run(false)).toBe(0);
  });

  it('guardDoors: a hauling rival leaves the wall to guard its bank door when the human shows up there', () => {
    const run = (adapted: boolean): boolean => {
      const sim = new Simulation({ layout: LAYOUTS.plaza, roster, seed: 4 });
      const bot = new Bot(sim, { slot: 1, personality: 'tongkeun', difficulty: 'normal', seed: 9, adaptation: adapted ? { kind: 'guardDoors', lineKey: 'adapt.tongkeun.guardDoors.1' } : null });
      const bank = sim.state.loot.find((l) => l.kind === 'bank')!;
      bot.assignTask(sim, { kind: 'haul', targetId: bank.id });
      let guarded = false;
      let placed = false;
      for (let t = 0; t < 70 * 60 && !guarded; t++) {
        sim.step([EMPTY_COMMAND, bot.update(sim)]);
        const b = sim.getLoot(bank.id)!;
        const me = sim.characterBySlot(1);
        if (!placed && !b.anchored && me.grab?.targetId === bank.id && Math.hypot(b.vel.x, b.vel.y) > 0.3) {
          // the human appears just outside the door on the hauler's side of the bank
          const doors = [0, 1].map((i) => {
            const n = { x: -Math.sin(b.angle) * (i ? -1 : 1), y: Math.cos(b.angle) * (i ? -1 : 1) };
            return { x: b.pos.x + n.x * 3.9, y: b.pos.y + n.y * 3.9 };
          });
          const spot = doors.sort((p, q) => Math.hypot(p.x - me.pos.x, p.y - me.pos.y) - Math.hypot(q.x - me.pos.x, q.y - me.pos.y))[0]!;
          if (sim.lineOfSight(me.pos, spot) && sim.isFree(spot, 0.45)) {
            sim.debug.teleport(1, spot);
            placed = true;
          }
        }
        if (placed && bot.intent().goal === 'defendDoor') guarded = true;
      }
      return guarded;
    };
    expect(run(true)).toBe(true);
    expect(run(false)).toBe(false); // 통큰이's readable weakness without the adaptation
  });

  it('stripBank: the rival values taking the large safe out of a bank over hauling it', () => {
    const score = (adapted: boolean): { strip: number; haul: number } => {
      const sim = new Simulation({ layout: LAYOUTS.counter, roster, seed: 6 });
      const bot = new Bot(sim, { slot: 1, personality: 'tongkeun', difficulty: 'normal', seed: 2, adaptation: adapted ? { kind: 'stripBank', lineKey: 'adapt.tongkeun.stripBank.1' } : null });
      const cands = (bot as unknown as { candidates(s: Simulation): { key: string; kind: string; utility: number; targetId: number | null }[] }).candidates(sim);
      const larges = new Set(sim.state.loot.filter((l) => l.kind === 'largeSafe' && l.floorOf !== null).map((l) => l.id));
      return {
        strip: Math.max(...cands.filter((c) => c.targetId !== null && larges.has(c.targetId)).map((c) => c.utility)),
        haul: Math.max(...cands.filter((c) => c.kind === 'haulBank').map((c) => c.utility)),
      };
    };
    const base = score(false);
    const adapted = score(true);
    expect(adapted.strip / adapted.haul).toBeGreaterThan((base.strip / base.haul) * 1.8);
  });
});
