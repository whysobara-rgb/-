/**
 * Deterministic pseudo-random "heist" driver for fuzz tests: characters wander, chase loot,
 * grab, drag toward their zone, dash, ping and release at random — enough to exercise real
 * recoveries, tug of war, bank moves, fences, knockdowns and the moving floor.
 */
import { createRng } from '../../../src/sim/math';
import type { Simulation } from '../../../src/sim/sim';
import type { Command, Vec2 } from '../../../src/sim/types';

interface BotMem {
  target: number | null;
  mode: 'chase' | 'wander' | 'random';
  wanderTo: Vec2;
  modeTicks: number;
  grabHeld: boolean;
}

export class FuzzDriver {
  private readonly rng: () => number;
  private readonly mem: BotMem[];

  constructor(
    private readonly sim: Simulation,
    seed: number,
  ) {
    this.rng = createRng(seed);
    this.mem = sim.state.characters.map(() => ({ target: null, mode: 'chase', wanderTo: { x: 0, y: 0 }, modeTicks: 0, grabHeld: false }));
  }

  private pick<T>(arr: T[]): T | undefined {
    return arr.length ? arr[Math.floor(this.rng() * arr.length)] : undefined;
  }

  /**
   * Chaos assist: occasionally frees a random unrecovered item and drops it (with whatever
   * rides on it) into a random zone, so settlements, ejections and endings happen often.
   */
  assist(everyTicks: number): void {
    const sim = this.sim;
    const st = sim.state;
    if (st.tick === 0 || st.tick % everyTicks !== 0) return;
    const live = st.loot.filter((l) => !l.recovered);
    const pick = this.pick(live);
    if (!pick) return;
    const zone = this.pick([...sim.layout.zones])!;
    sim.debug.setAnchored(pick.id, false);
    const off = pick.kind === 'bank' ? { x: 0, y: 0 } : { x: (this.rng() - 0.5) * 10, y: this.rng() < 0.5 ? -4.3 : 4.3 };
    sim.debug.teleport(pick.id, { x: zone.center.x + off.x, y: zone.center.y + off.y }, pick.kind === 'bank' ? 0 : this.rng() * 3);
  }

  commands(): Command[] {
    const sim = this.sim;
    const st = sim.state;
    const r = this.rng;
    return st.characters.map((ch, slot) => {
      const m = this.mem[slot]!;
      if (--m.modeTicks <= 0) {
        const x = r();
        m.mode = x < 0.7 ? 'chase' : x < 0.9 ? 'wander' : 'random';
        m.modeTicks = 60 + Math.floor(r() * 400);
        m.wanderTo = { x: r() * sim.layout.size.x, y: r() * sim.layout.size.y };
        const live = st.loot.filter((l) => !l.recovered);
        const banks = live.filter((l) => l.kind === 'bank').map((l) => l.id);
        // join a teammate's carry half of the time, else favour banks (the big heist) 40%
        const mate = st.characters.find((c) => c.team === ch.team && c.id !== ch.id && c.grab);
        if (mate && r() < 0.5) m.target = mate.grab!.targetId;
        else if (banks.length && r() < 0.4) m.target = this.pick(banks) ?? null;
        else m.target = this.pick(live.map((l) => l.id)) ?? null;
      }
      const ping = r() < 0.002 ? { pos: { x: r() * sim.layout.size.x, y: r() * sim.layout.size.y }, targetId: r() < 0.5 ? m.target : null } : null;
      const dash = r() < 0.01;
      if (m.mode === 'random') {
        const a = r() * Math.PI * 2;
        const g = r() < 0.5;
        return { move: { x: Math.cos(a) * r() * 1.2, y: Math.sin(a) * r() * 1.2 }, grab: g, dash, aim: r() < 0.3 ? { x: r() - 0.5, y: r() - 0.5 } : null, ping };
      }
      if (ch.grab) {
        // drag toward own zone (with noise); occasionally let go
        const held = sim.getLoot(ch.grab.targetId);
        const letGo = held && held.kind === 'bank' ? 0.0003 : 0.002;
        if (r() < letGo) return { move: { x: 0, y: 0 }, grab: false, dash: false, ping };
        const zone = sim.layout.zones.find((z) => z.team === ch.team)!;
        const dx = zone.center.x - ch.pos.x + (r() - 0.5) * 6;
        const dy = zone.center.y - ch.pos.y + (r() - 0.5) * 6;
        const d = Math.hypot(dx, dy) || 1;
        return { move: { x: dx / d, y: dy / d }, grab: true, dash, ping };
      }
      let goal: Vec2 = m.wanderTo;
      let aim: Vec2 | null = null;
      let grab = false;
      if (m.mode === 'chase' && m.target !== null) {
        const t = sim.getLoot(m.target);
        if (!t || t.recovered) m.modeTicks = 0;
        else {
          goal = t.pos;
          const d = Math.hypot(t.pos.x - ch.pos.x, t.pos.y - ch.pos.y);
          if (d < Math.max(t.half.x, t.half.y) + 1.6) {
            aim = { x: t.pos.x - ch.pos.x, y: t.pos.y - ch.pos.y };
            grab = r() < 0.9;
          }
        }
      }
      const dx = goal.x - ch.pos.x;
      const dy = goal.y - ch.pos.y;
      const d = Math.hypot(dx, dy) || 1;
      // jitter so characters slide around obstacles eventually
      const jx = (r() - 0.5) * 0.8;
      const jy = (r() - 0.5) * 0.8;
      return { move: { x: dx / d + jx, y: dy / d + jy }, grab, dash, aim, ping };
    });
  }
}
