/**
 * Test-only layouts and helpers for the simulation tests.
 * (Real match layouts live in src/sim/layouts and are owned by level design.)
 */
import { Simulation } from '../../../src/sim/sim';
import type {
  BankPlacementDef,
  Command,
  FenceDef,
  LayoutDef,
  MatchSetup,
  RuleConfig,
  SafePlacementDef,
  StaticBoxDef,
  StaticCircleDef,
  TeamId,
  Vec2,
  ZoneDef,
} from '../../../src/sim/types';

export interface OpenLayoutOptions {
  size?: Vec2;
  banks?: BankPlacementDef[];
  safes?: SafePlacementDef[];
  statics?: StaticBoxDef[];
  circles?: StaticCircleDef[];
  fences?: FenceDef[];
  zones?: ZoneDef[];
  spawns?: { team: TeamId; pos: Vec2; facing: number }[];
}

/** Default zones: team 0 west, team 1 east (100 x 60 arena). */
export const ZONE0: ZoneDef = { team: 0, center: { x: 10, y: 30 }, half: { x: 6.5, y: 5.5 }, angle: 0, vanPos: { x: 10, y: 21.5 }, vanAngle: 0 };
export const ZONE1: ZoneDef = { team: 1, center: { x: 90, y: 30 }, half: { x: 6.5, y: 5.5 }, angle: 0, vanPos: { x: 90, y: 21.5 }, vanAngle: 0 };

/** A mostly empty test arena; everything is configurable. */
export function openLayout(o: OpenLayoutOptions = {}): LayoutDef {
  return {
    id: 'tutorial',
    nameKey: 'test.open',
    descKey: 'test.open',
    size: o.size ?? { x: 100, y: 60 },
    statics: o.statics ?? [],
    circles: o.circles ?? [],
    fences: o.fences ?? [],
    zones: o.zones ?? [ZONE0, ZONE1],
    spawns: o.spawns ?? [
      { team: 0, pos: { x: 30, y: 50 }, facing: 0 },
      { team: 0, pos: { x: 32, y: 50 }, facing: 0 },
      { team: 1, pos: { x: 70, y: 50 }, facing: Math.PI },
      { team: 1, pos: { x: 68, y: 50 }, facing: Math.PI },
    ],
    banks: o.banks ?? [],
    safes: o.safes ?? [],
    bankRoutes: [],
    chokepoints: [],
    decor: [],
    groundStyle: 'practice',
  };
}

/**
 * Full-size fixture with the doc §9 loot set: 2 banks (each 2 small + 1 large inside),
 * 6 small + 2 large outdoor safes = 3200 points, with buildings, planters, trees, fences.
 */
export function fullLayout(): LayoutDef {
  const b = (id: string, kind: StaticBoxDef['kind'], x: number, y: number, hx: number, hy: number, angle = 0): StaticBoxDef => ({
    id,
    kind,
    center: { x, y },
    half: { x: hx, y: hy },
    angle,
    height: kind === 'building' ? 8 : 1,
  });
  return {
    id: 'plaza',
    nameKey: 'test.full',
    descKey: 'test.full',
    size: { x: 96, y: 64 },
    statics: [
      b('bld.nw', 'building', 20, 8, 8, 4),
      b('bld.ne', 'building', 76, 8, 8, 4),
      b('bld.sw', 'building', 20, 56, 8, 4),
      b('bld.se', 'building', 76, 56, 8, 4),
      b('wall.c1', 'wall', 48, 32, 0.1, 3),
      b('planter.1', 'planter', 36, 20, 2, 0.8),
      b('planter.2', 'planter', 60, 44, 2, 0.8),
      b('bench.1', 'bench', 40, 44, 1, 0.3, 0.4),
      b('kiosk.1', 'kiosk', 56, 20, 1.5, 1.5),
    ],
    circles: [
      { id: 'tree.1', kind: 'tree', center: { x: 30, y: 32 }, radius: 0.6, height: 5 },
      { id: 'tree.2', kind: 'tree', center: { x: 66, y: 32 }, radius: 0.6, height: 5 },
      { id: 'lamp.1', kind: 'lamp', center: { x: 48, y: 24 }, radius: 0.2, height: 4 },
    ],
    fences: [
      { id: 'fence.n', center: { x: 48, y: 4 }, half: { x: 3, y: 0.1 }, angle: Math.PI / 2 },
      { id: 'fence.s', center: { x: 48, y: 60 }, half: { x: 3, y: 0.1 }, angle: Math.PI / 2 },
    ],
    zones: [
      { team: 0, center: { x: 10.5, y: 32 }, half: { x: 6.5, y: 5.5 }, angle: 0, vanPos: { x: 2.6, y: 32 }, vanAngle: Math.PI / 2 },
      { team: 1, center: { x: 85.5, y: 32 }, half: { x: 6.5, y: 5.5 }, angle: 0, vanPos: { x: 93.4, y: 32 }, vanAngle: Math.PI / 2 },
    ],
    spawns: [
      { team: 0, pos: { x: 20, y: 30 }, facing: 0 },
      { team: 0, pos: { x: 20, y: 34 }, facing: 0 },
      { team: 1, pos: { x: 76, y: 30 }, facing: Math.PI },
      { team: 1, pos: { x: 76, y: 34 }, facing: Math.PI },
    ],
    banks: [
      { pos: { x: 48, y: 15 }, angle: 0 },
      { pos: { x: 48, y: 49 }, angle: Math.PI },
    ],
    safes: [
      { kind: 'smallSafe', pos: { x: 30, y: 24 }, angle: 0 },
      { kind: 'smallSafe', pos: { x: 66, y: 24 }, angle: 0 },
      { kind: 'smallSafe', pos: { x: 30, y: 40 }, angle: 0.3 },
      { kind: 'smallSafe', pos: { x: 66, y: 40 }, angle: -0.3 },
      { kind: 'smallSafe', pos: { x: 40, y: 32 }, angle: 0 },
      { kind: 'smallSafe', pos: { x: 56, y: 32 }, angle: 0 },
      { kind: 'largeSafe', pos: { x: 24, y: 18 }, angle: 0 },
      { kind: 'largeSafe', pos: { x: 72, y: 46 }, angle: 0 },
    ],
    bankRoutes: [],
    chokepoints: [],
    decor: [],
    groundStyle: 'plaza',
  };
}

export function makeSetup(layout: LayoutDef, teams: TeamId[] = [0, 0, 1, 1], rules?: Partial<RuleConfig>): MatchSetup {
  return {
    layout,
    seed: 1,
    roster: teams.map((team, i) => ({ team, isBot: true, name: `p${i}`, look: { hat: team === 0 ? 'teamCapA' : 'teamCapB' } })),
    rules,
  };
}

export function makeSim(layout: LayoutDef, teams: TeamId[] = [0, 0, 1, 1], rules?: Partial<RuleConfig>): Simulation {
  return new Simulation(makeSetup(layout, teams, rules));
}

export function cmd(mx = 0, my = 0, grab = false, dash = false, aim: Vec2 | null = null): Command {
  return { move: { x: mx, y: my }, grab, dash, aim, ping: null };
}

/** Step `n` ticks with a constant command per slot (or a function of the tick). */
export function run(sim: Simulation, n: number, cmds: (Command | undefined)[] | ((t: number) => (Command | undefined)[])) {
  const events = [];
  for (let i = 0; i < n; i++) {
    const c = typeof cmds === 'function' ? cmds(i) : cmds;
    events.push(...sim.step(c));
    if (sim.state.over) break;
  }
  return events;
}

/** Ids by kind for a sim built from a layout. */
export function lootIds(sim: Simulation) {
  const banks = sim.state.loot.filter((l) => l.kind === 'bank').map((l) => l.id);
  const small = sim.state.loot.filter((l) => l.kind === 'smallSafe').map((l) => l.id);
  const large = sim.state.loot.filter((l) => l.kind === 'largeSafe').map((l) => l.id);
  return { banks, small, large };
}

/** Assert-free invariant probe used by many tests. */
export function invariantHolds(sim: Simulation): boolean {
  const s = sim.state;
  return s.scores[0] + s.scores[1] + s.remainingValue === s.totalValue;
}

/** Commands array with `c` in slot `slot` and idle elsewhere. */
export function only(slot: number, c: Command, n = 4): Command[] {
  const out: Command[] = [];
  for (let i = 0; i < n; i++) out.push(i === slot ? c : cmd());
  return out;
}

/** Local -> world for a bank at (pos, angle). */
export function bankLocal(sim: Simulation, bankId: number, lx: number, ly: number): Vec2 {
  const b = sim.getLoot(bankId)!;
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  return { x: b.pos.x + lx * c - ly * s, y: b.pos.y + lx * s + ly * c };
}

/** World -> bank local. */
export function toBankLocal(sim: Simulation, bankId: number, p: Vec2): Vec2 {
  const b = sim.getLoot(bankId)!;
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  const dx = p.x - b.pos.x;
  const dy = p.y - b.pos.y;
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
}

/** Command that walks slot's character toward `target` (full speed until close). */
export function steer(sim: Simulation, slot: number, target: Vec2, grab = false): Command {
  const p = sim.state.characters[slot]!.pos;
  const dx = target.x - p.x;
  const dy = target.y - p.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.05) return cmd(0, 0, grab);
  const k = Math.min(1, d / 0.5) / d;
  return cmd(dx * k, dy * k, grab);
}
