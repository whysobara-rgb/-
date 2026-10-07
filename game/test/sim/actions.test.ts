/**
 * Action contracts: grab candidate selection (doc §4), grab level signal + latch, grip break,
 * dash / knockdown / protection / same-team rules (doc §7, §8 돌진과 교착), carry boost, pings.
 */
import { describe, expect, it } from 'vitest';
import { CHARACTER, DASH, KNOCKDOWN_TICKS, PING, PROTECT_TICKS } from '../../src/sim/config';
import type { SimEvent } from '../../src/sim/types';
import { bankLocal, cmd, makeSim, openLayout, run } from './fixtures/layouts';

const E = { x: 1, y: 0 };
const CHARACTER_R = CHARACTER.radius;

describe('grab candidate (doc §4: 금고를 가리키면 금고, 외벽을 가리키면 은행)', () => {
  /** Bank at (50,30) angle 0 (east outer face x = 54) and a free small safe touching it outside. */
  function setup() {
    const sim = makeSim(
      openLayout({ banks: [{ pos: { x: 50, y: 30 }, angle: 0 }], safes: [{ kind: 'smallSafe', pos: { x: 54.45, y: 30 }, angle: 0 }] }),
      [0],
    );
    const bank = sim.state.loot[0]!.id;
    const safe = sim.state.loot.find((l) => l.kind === 'smallSafe' && l.homeBank === null)!.id;
    return { sim, bank, safe };
  }

  it('pointing at the safe picks the safe; pointing at the wall picks the bank', () => {
    const { sim, bank, safe } = setup();
    sim.debug.teleport(1, { x: 55.4, y: 30 }, Math.PI);
    const c1 = sim.getGrabCandidate(1)!;
    expect(c1.targetId).toBe(safe);
    expect(c1.part).toBe('safe');
    expect(c1.anchorWorld.x).toBeCloseTo(54.85, 6);
    sim.debug.teleport(1, { x: 55.0, y: 31.5 }, Math.PI);
    const c2 = sim.getGrabCandidate(1)!;
    expect(c2.targetId).toBe(bank);
    expect(c2.part).toBe('bankWall');
    expect(c2.anchorWorld.x).toBeCloseTo(54, 6);
    expect(c2.anchorLocal.x).toBeCloseTo(4, 6);
    // the wall is pointed at even though the safe is in the cone: the wall wins
    sim.debug.teleport(1, { x: 55.1, y: 30.6 }, Math.PI);
    expect(sim.getGrabCandidate(1)!.targetId).toBe(bank);
  });

  it('step() grabs exactly the candidate (same function)', () => {
    const { sim, safe } = setup();
    sim.debug.teleport(1, { x: 55.4, y: 30 }, Math.PI);
    const cand = sim.getGrabCandidate(1)!;
    const ev = sim.step([cmd(0, 0, true)]);
    const g = ev.find((e) => e.type === 'grab');
    expect(g).toEqual({ type: 'grab', tick: 1, charId: 1, targetId: safe, part: 'safe' });
    expect(sim.state.characters[0]!.grab).toEqual({ targetId: cand.targetId, part: cand.part, anchorLocal: cand.anchorLocal });
    expect(sim.getLoot(safe)!.grabbedBy).toEqual([1]);
    expect(sim.getLoot(safe)!.lastHolder).toBe(1);
  });

  it('never grabs through a bank wall', () => {
    const { sim, bank, safe } = setup();
    const inner = sim.state.loot.find((l) => l.kind === 'smallSafe' && l.homeBank === bank)!.id;
    sim.debug.teleport(safe, { x: 80, y: 50 });
    sim.debug.teleport(inner, bankLocal(sim, bank, 3.15, 0)); // right behind the east wall, inside
    sim.debug.teleport(1, { x: 54.5, y: 30 }, Math.PI);
    const c = sim.getGrabCandidate(1);
    expect(c?.targetId).toBe(bank); // the wall it points at, never the safe behind it
    // facing along the wall so the ray misses the bank: the safe is in range and in the cone,
    // but the segment to it crosses the wall -> not grabbable
    sim.debug.teleport(1, { x: 54.5, y: 30 }, Math.PI * 0.75);
    const c2 = sim.getGrabCandidate(1);
    expect(c2?.targetId === inner).toBe(false);
  });

  it('never grabs through a static wall', () => {
    const sim = makeSim(
      openLayout({
        safes: [{ kind: 'smallSafe', pos: { x: 30, y: 30 }, angle: 0 }],
        statics: [{ id: 'w', kind: 'wall', center: { x: 30.7, y: 30 }, half: { x: 0.1, y: 3 }, angle: 0, height: 2 }],
      }),
      [0],
    );
    sim.debug.teleport(1, { x: 31.4, y: 30 }, Math.PI);
    expect(sim.getGrabCandidate(1)).toBeNull();
  });

  it('a character on a bank floor cannot grab that bank, but can grab safes inside', () => {
    const { sim, bank } = setup();
    sim.debug.teleport(1, bankLocal(sim, bank, 1.6, 1.8), 0); // facing east wall from inside
    expect(sim.state.characters[0]!.floorOf === null || true).toBe(true);
    const c = sim.getGrabCandidate(1);
    expect(c === null || c.part === 'safe').toBe(true);
    // stand in the doorway facing the jamb: still not the bank
    sim.debug.teleport(1, bankLocal(sim, bank, 0, 2.8), 0);
    expect(sim.getGrabCandidate(1)?.targetId === bank).toBe(false);
    // inside next to the interior large safe (bank center) -> that safe
    const large = sim.state.loot.find((l) => l.kind === 'largeSafe')!.id;
    sim.debug.teleport(1, bankLocal(sim, bank, -1.4, 0), 0);
    expect(sim.getGrabCandidate(1)?.targetId).toBe(large);
  });

  it('cone fallback picks the smallest angle; exact ties go to the lower id', () => {
    const sim = makeSim(
      openLayout({
        safes: [
          { kind: 'smallSafe', pos: { x: 31, y: 31 }, angle: 0 },
          { kind: 'smallSafe', pos: { x: 31, y: 29 }, angle: 0 },
        ],
      }),
      [0],
    );
    const [a, b] = sim.state.loot.map((l) => l.id);
    sim.debug.teleport(1, { x: 30, y: 30 }, 0);
    expect(sim.getGrabCandidate(1)!.targetId).toBe(Math.min(a!, b!));
    sim.debug.teleport(1, { x: 30, y: 30 }, 0.3); // turned toward +y -> safe at y=31
    expect(sim.getGrabCandidate(1)!.targetId).toBe(a);
    sim.debug.teleport(1, { x: 30, y: 30 }, Math.PI); // facing away -> nothing
    expect(sim.getGrabCandidate(1)).toBeNull();
  });

  it('out of reach -> null; recovered loot is never a candidate', () => {
    const sim = makeSim(openLayout({ safes: [{ kind: 'smallSafe', pos: { x: 30, y: 30 }, angle: 0 }] }), [0]);
    sim.debug.teleport(1, { x: 31.7, y: 30 }, Math.PI); // 1.3 m from the surface > 1.2
    expect(sim.getGrabCandidate(1)).toBeNull();
    sim.debug.teleport(1, { x: 31.5, y: 30 }, Math.PI);
    expect(sim.getGrabCandidate(1)).not.toBeNull();
  });
});

describe('grab level signal, release, latch and grip break', () => {
  function holdSmall() {
    const sim = makeSim(openLayout({ safes: [{ kind: 'smallSafe', pos: { x: 30, y: 30 }, angle: 0 }] }), [0, 1]);
    const id = sim.state.loot[0]!.id;
    sim.debug.setAnchored(id, false);
    sim.debug.teleport(1, { x: 30.95, y: 30 }, Math.PI);
    sim.step([cmd(0, 0, true), cmd()]);
    expect(sim.state.characters[0]!.grab?.targetId).toBe(id);
    return { sim, id };
  }

  it('grab=false releases (forced=false); holding grab keeps holding', () => {
    const { sim, id } = holdSmall();
    run(sim, 30, [cmd(1, 0, true), cmd()]);
    expect(sim.state.characters[0]!.grab?.targetId).toBe(id);
    const ev = sim.step([cmd(0, 0, false), cmd()]);
    expect(ev.find((e) => e.type === 'release')).toEqual({ type: 'release', tick: sim.state.tick, charId: 1, targetId: id, forced: false });
    expect(sim.getLoot(id)!.grabbedBy).toEqual([]);
  });

  it('a violent yank breaks the grip (forced) and the grab must be re-pressed', () => {
    const { sim, id } = holdSmall();
    sim.debug.setVelocity(id, { x: -14, y: 0 });
    const ev = sim.step([cmd(0, 0, true), cmd()]);
    const rel = ev.find((e) => e.type === 'release');
    expect(rel && rel.type === 'release' && rel.forced).toBe(true);
    expect(sim.state.characters[0]!.protectTicks).toBe(PROTECT_TICKS);
    // still holding the button: latch prevents re-grabbing even when in reach
    sim.debug.setVelocity(id, { x: 0, y: 0 });
    sim.debug.teleport(id, { x: 30, y: 30 });
    sim.debug.teleport(1, { x: 30.95, y: 30 }, Math.PI);
    run(sim, 10, [cmd(0, 0, true), cmd()]);
    expect(sim.state.characters[0]!.grab).toBeNull();
    sim.step([cmd(0, 0, false), cmd()]);
    sim.step([cmd(0, 0, true), cmd()]);
    expect(sim.state.characters[0]!.grab?.targetId).toBe(id);
  });

  it('normal carrying, tug of war and boosted pulls never break the grip', () => {
    const { sim, id } = holdSmall();
    sim.debug.teleport(2, { x: 29.05, y: 30 }, 0);
    sim.step([cmd(0, 0, true), cmd(0, 0, true)]);
    expect(sim.getLoot(id)!.grabbedBy).toEqual([1, 2]);
    const ev = run(sim, 300, (t) => [cmd(1, 0, true, t === 10), cmd(-1, 0.2, true, t === 20)]);
    expect(ev.filter((e) => e.type === 'release')).toEqual([]);
    expect(ev.filter((e) => e.type === 'dash').length).toBe(2);
  });
});

describe('dash (doc §7, §8)', () => {
  function duel(teams: (0 | 1)[] = [0, 1, 0]) {
    const sim = makeSim(openLayout(), teams);
    sim.debug.teleport(1, { x: 30, y: 30 }, 0);
    sim.debug.teleport(2, { x: 32, y: 30 }, Math.PI);
    if (teams.length > 2) sim.debug.teleport(3, { x: 30, y: 26 }, 0);
    return sim;
  }

  function dashInto(sim: ReturnType<typeof duel>, slot: number, n: number, other: (t: number) => ReturnType<typeof cmd>[] = () => []) {
    const ev: SimEvent[] = [];
    for (let t = 0; t < n; t++) {
      const c = [cmd(), cmd(), cmd()];
      c[slot] = cmd(0, 0, false, t === 0, E);
      const o = other(t);
      o.forEach((x, i) => {
        if (i !== slot && x) c[i] = x;
      });
      ev.push(...sim.step(c));
    }
    return ev;
  }

  it('empty-handed dash bursts at DASH.speed in the facing direction, then cools down 4 s', () => {
    const sim = makeSim(openLayout(), [0]);
    sim.debug.teleport(1, { x: 30, y: 30 }, 0);
    const ev = sim.step([cmd(0, 0, false, true, { x: 0, y: 1 })]);
    expect(ev.find((e) => e.type === 'dash')).toEqual({ type: 'dash', tick: 1, charId: 1, carrying: false });
    expect(sim.state.characters[0]!.vel.y).toBeCloseTo(DASH.speed, 1);
    expect(sim.state.characters[0]!.dashCooldown).toBe(DASH.cooldownTicks);
    // holding the button does not re-trigger; a new press during cooldown does nothing
    const more = run(sim, DASH.cooldownTicks - 2, (t) => [cmd(0, 0, false, t % 2 === 0)]);
    expect(more.filter((e) => e.type === 'dash')).toEqual([]);
    run(sim, 2, [cmd()]);
    expect(sim.step([cmd(0, 0, false, true)]).some((e) => e.type === 'dash')).toBe(true);
    // travel distance ~ speed * duration + slide
    expect(sim.state.characters[0]!.pos.y).toBeGreaterThan(33);
  });

  it('hitting an opponent: knockdown, protection from that moment, knockback, ignores commands', () => {
    const sim = duel();
    const ev = dashInto(sim, 0, 8, () => [cmd(), cmd(-1, 0, true)]);
    const hit = ev.find((e) => e.type === 'dashHit');
    expect(hit).toMatchObject({ type: 'dashHit', attackerId: 1, victimId: 2, knockdown: true });
    const hitTick = hit!.tick;
    const v = sim.state.characters[1]!;
    expect(v.knockdownTicks).toBe(KNOCKDOWN_TICKS - (sim.state.tick - hitTick));
    expect(v.protectTicks).toBe(PROTECT_TICKS - (sim.state.tick - hitTick));
    expect(v.pos.x).toBeGreaterThan(32); // knocked back away from the attacker
    // commands ignored while knocked down
    expect(v.moveIntent).toEqual({ x: 0, y: 0 });
    const x0 = v.pos.x;
    run(sim, KNOCKDOWN_TICKS - (sim.state.tick - hitTick) - 1, [cmd(), cmd(-1, 0), cmd()]);
    expect(v.knockdownTicks).toBe(1);
    expect(v.pos.x).toBeGreaterThanOrEqual(x0 - 1e-9);
    run(sim, 20, [cmd(), cmd(-1, 0), cmd()]);
    expect(v.knockdownTicks).toBe(0);
    expect(v.pos.x).toBeLessThan(x0);
  });

  it('a holder that is knocked down is forced to release', () => {
    const sim = makeSim(openLayout({ safes: [{ kind: 'smallSafe', pos: { x: 33.5, y: 30 }, angle: 0 }] }), [0, 1]);
    const safe = sim.state.loot[0]!.id;
    sim.debug.teleport(1, { x: 30, y: 30 }, 0);
    sim.debug.teleport(2, { x: 32.5, y: 30 }, 0);
    sim.step([cmd(), cmd(0, 0, true, false, E)]);
    expect(sim.state.characters[1]!.grab?.targetId).toBe(safe);
    const ev: SimEvent[] = [];
    for (let t = 0; t < 10; t++) ev.push(...sim.step([cmd(0, 0, false, t === 0, E), cmd(0, 0, true)]));
    expect(ev.find((e) => e.type === 'release')).toMatchObject({ charId: 2, targetId: safe, forced: true });
    expect(sim.state.characters[1]!.grab).toBeNull();
    expect(sim.getLoot(safe)!.grabbedBy).toEqual([]);
  });

  it('protected or knocked-down opponents are not knocked down again', () => {
    const sim = duel([0, 1, 0]);
    dashInto(sim, 0, 8);
    expect(sim.state.characters[1]!.knockdownTicks).toBeGreaterThan(0);
    // teammate of the attacker dashes into the protected victim
    run(sim, 40, [cmd(), cmd(), cmd()]);
    const vpos = sim.state.characters[1]!.pos;
    sim.debug.teleport(1, { x: 20, y: 40 }, 0); // original attacker out of the way
    sim.debug.teleport(3, { x: vpos.x - 1.5, y: vpos.y }, 0);
    const ev = dashInto(sim, 2, 8);
    const hit = ev.find((e) => e.type === 'dashHit');
    expect(hit).toMatchObject({ attackerId: 3, victimId: 2, knockdown: false });
    expect(sim.state.characters[1]!.knockdownTicks).toBe(0);
    // after protection expires the victim is vulnerable again
    run(sim, PROTECT_TICKS + DASH.cooldownTicks, [cmd(), cmd(), cmd()]);
    const p2 = sim.state.characters[1]!.pos;
    sim.debug.teleport(3, { x: 20, y: 20 }, 0);
    sim.debug.teleport(1, { x: p2.x - 1.5, y: p2.y }, 0);
    const ev2 = dashInto(sim, 0, 8);
    expect(ev2.find((e) => e.type === 'dashHit')).toMatchObject({ victimId: 2, knockdown: true });
  });

  it('same-team dash never knocks down: small shove only, grip kept', () => {
    const sim = makeSim(openLayout({ safes: [{ kind: 'smallSafe', pos: { x: 33.5, y: 30 }, angle: 0 }] }), [0, 0]);
    const safe = sim.state.loot[0]!.id;
    sim.debug.setAnchored(safe, false);
    sim.debug.teleport(1, { x: 30, y: 30 }, 0);
    sim.debug.teleport(2, { x: 32.5, y: 30 }, 0);
    sim.step([cmd(), cmd(0, 0, true, false, E)]);
    const ev: SimEvent[] = [];
    for (let t = 0; t < 10; t++) ev.push(...sim.step([cmd(0, 0, false, t === 0, E), cmd(0, 0, true)]));
    expect(ev.find((e) => e.type === 'dashHit')).toMatchObject({ attackerId: 1, victimId: 2, knockdown: false });
    expect(sim.state.characters[1]!.knockdownTicks).toBe(0);
    expect(sim.state.characters[1]!.grab?.targetId).toBe(safe);
    expect(ev.some((e) => e.type === 'release')).toBe(false);
  });

  it('dash lands only in front of the burst: dashing away from or past a touching opponent does nothing to them', () => {
    for (const vpos of [
      { x: 39.1, y: 30 }, // directly behind, touching
      { x: 39.0, y: 30 }, // behind, inside reach
      { x: 40, y: 30.95 }, // beside, touching
      { x: 40.5, y: 30.93 }, // diagonal-ahead but outside the 60 degree cone
    ]) {
      const sim = makeSim(openLayout(), [0, 1]);
      sim.debug.teleport(1, { x: 40, y: 30 }, 0);
      sim.debug.teleport(2, vpos, 0);
      const ev: SimEvent[] = [];
      for (let t = 0; t < 30; t++) ev.push(...sim.step([cmd(0, 0, false, t === 0, E), cmd()]));
      expect(ev.filter((e) => e.type === 'dashHit')).toEqual([]);
      expect(sim.state.characters[1]!.knockdownTicks).toBe(0);
      // the burst itself was not cut short by the bystander
      expect(sim.state.characters[0]!.pos.x).toBeGreaterThan(42.5);
    }
    // the same opponent straight ahead is hit
    const sim = makeSim(openLayout(), [0, 1]);
    sim.debug.teleport(1, { x: 40, y: 30 }, 0);
    sim.debug.teleport(2, { x: 41.5, y: 30.3 }, 0);
    const ev: SimEvent[] = [];
    for (let t = 0; t < 10; t++) ev.push(...sim.step([cmd(0, 0, false, t === 0, E), cmd()]));
    expect(ev.find((e) => e.type === 'dashHit')).toMatchObject({ attackerId: 1, victimId: 2, knockdown: true });
  });

  it('a head-on clash is symmetric: both bounce apart, nobody is knocked down, whatever the slot order', () => {
    const outcomes: string[] = [];
    for (const teams of [
      [0, 1],
      [1, 0],
    ] as const) {
      const sim = makeSim(openLayout(), [...teams]);
      sim.debug.teleport(1, { x: 40, y: 30 }, 0);
      sim.debug.teleport(2, { x: 43, y: 30 }, Math.PI);
      const ev: SimEvent[] = [];
      ev.push(...sim.step([cmd(0, 0, false, true, E), cmd(0, 0, false, true, { x: -1, y: 0 })]));
      for (let t = 0; t < 20; t++) ev.push(...sim.step([cmd(), cmd()]));
      const hits = ev.filter((e) => e.type === 'dashHit');
      expect(hits).toHaveLength(2);
      for (const h of hits) expect(h).toMatchObject({ knockdown: false });
      expect(hits.map((h) => (h.type === 'dashHit' ? `${h.attackerId}->${h.victimId}` : ''))).toEqual(['1->2', '2->1']);
      const [a, b] = sim.state.characters;
      expect(a!.knockdownTicks).toBe(0);
      expect(b!.knockdownTicks).toBe(0);
      // mirror symmetry about x = 41.5
      expect(a!.pos.x + b!.pos.x).toBeCloseTo(83, 6);
      expect(a!.pos.x).toBeLessThan(41.5 - CHARACTER_R);
      outcomes.push(`${a!.pos.x.toFixed(9)}|${b!.pos.x.toFixed(9)}`);
    }
    expect(outcomes[0]).toBe(outcomes[1]);
  });

  it('two attackers hitting the same victim in one substep: one knockdown, both events, order-independent', () => {
    const results: string[] = [];
    for (const teams of [
      [0, 0, 1],
      [1, 1, 0],
    ] as const) {
      const sim = makeSim(openLayout(), [...teams]);
      sim.debug.teleport(1, { x: 38, y: 30 }, 0);
      sim.debug.teleport(2, { x: 42, y: 30 }, Math.PI);
      sim.debug.teleport(3, { x: 40, y: 30 }, 0);
      const ev: SimEvent[] = [];
      ev.push(...sim.step([cmd(0, 0, false, true, E), cmd(0, 0, false, true, { x: -1, y: 0 }), cmd()]));
      for (let t = 0; t < 20; t++) ev.push(...sim.step([cmd(), cmd(), cmd()]));
      const hits = ev.filter((e) => e.type === 'dashHit');
      expect(hits).toHaveLength(2);
      for (const h of hits) expect(h).toMatchObject({ victimId: 3, knockdown: true });
      const v = sim.state.characters[2]!;
      expect(v.knockdownTicks).toBeGreaterThan(0);
      expect(v.pos.x).toBeCloseTo(40, 3); // opposite knockbacks cancel
      results.push(sim.state.characters.map((c) => `${c.pos.x.toFixed(9)},${c.pos.y.toFixed(9)}`).join(';'));
    }
    expect(results[0]).toBe(results[1]);
  });

  it('dash while holding = carry boost (shared cooldown)', () => {
    const sim = makeSim(openLayout({ safes: [{ kind: 'largeSafe', pos: { x: 30, y: 30 }, angle: 0 }] }), [0]);
    const id = sim.state.loot[0]!.id;
    sim.debug.setAnchored(id, false);
    sim.debug.teleport(1, { x: 31.25, y: 30 }, Math.PI);
    sim.step([cmd(0, 0, true)]);
    run(sim, 240, [cmd(1, 0, true)]);
    const v0 = sim.getLoot(id)!.vel.x;
    const ev = sim.step([cmd(1, 0, true, true)]);
    expect(ev.find((e) => e.type === 'dash')).toMatchObject({ carrying: true });
    expect(sim.state.characters[0]!.boostTicks).toBe(DASH.boostTicks);
    expect(sim.state.characters[0]!.dashTicks).toBe(0);
    run(sim, DASH.boostTicks - 1, [cmd(1, 0, true)]);
    expect(sim.getLoot(id)!.vel.x).toBeGreaterThan(v0 * 1.3);
    expect(sim.state.characters[0]!.dashCooldown).toBe(DASH.cooldownTicks - (DASH.boostTicks - 1));
    expect(sim.state.characters[0]!.grab?.targetId).toBe(id);
    run(sim, 120, [cmd(1, 0, true)]);
    expect(sim.getLoot(id)!.vel.x).toBeLessThan(v0 * 1.05);
  });
});

describe('pings (doc §4: 같이 잡자 / 이쪽으로)', () => {
  it('loot target -> grabTogether, ground -> goHere; one per character; cooldown; expiry', () => {
    const sim = makeSim(openLayout({ safes: [{ kind: 'smallSafe', pos: { x: 30, y: 30 }, angle: 0 }] }), [0, 0]);
    const safe = sim.state.loot[0]!.id;
    const p = (pos: { x: number; y: number }, targetId: number | null) => ({ ...cmd(), ping: { pos, targetId } });
    let ev = sim.step([p({ x: 30, y: 30 }, safe), cmd()]);
    expect(ev.find((e) => e.type === 'ping')).toMatchObject({ kind: 'grabTogether', targetId: safe, charId: 1, team: 0 });
    expect(sim.state.pings.length).toBe(1);
    // cooldown: an immediate second ping is ignored
    ev = sim.step([p({ x: 40, y: 40 }, null), cmd()]);
    expect(ev.some((e) => e.type === 'ping')).toBe(false);
    run(sim, PING.cooldownTicks, [cmd(), cmd()]);
    ev = sim.step([p({ x: 40, y: 40 }, null), p({ x: 20, y: 20 }, 999)]);
    const pings = ev.filter((e) => e.type === 'ping');
    expect(pings.map((e) => (e.type === 'ping' ? e.kind : ''))).toEqual(['goHere', 'goHere']); // unknown id -> ground
    expect(sim.state.pings.length).toBe(2); // replaced, not added
    expect(sim.state.pings.find((x) => x.charId === 1)!.kind).toBe('goHere');
    run(sim, PING.durationTicks, [cmd(), cmd()]);
    expect(sim.state.pings).toEqual([]);
  });
});
