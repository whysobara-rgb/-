/**
 * [C2] Item fuzz (next to police-fuzz / content-fuzz): full 2:2 matches with items 'on', police
 * on, on the fixture and every real map — each with its own `v2` once C4 attaches it, else its
 * classic safes plus mirrored test item pads (one pair 12–18 m from the spawns + one axis pad).
 * The driver chases drops, swings hammers at nearby rivals / loot / officers (and at nothing),
 * grabs, carries and lets the chaos assist finish matches so the final countdown and the golden
 * hammer happen.
 *
 * Checked every tick: conservation against state.totalValue captured at tick 0; pickups have
 * unique ascending ids >= ITEM_ID_BASE, valid phases / kinds / uses, finite positions; held items
 * have valid uses / phase / cooldown; a knocked-down raccoon never holds an item; every swing
 * fires exactly windupTicks after its wind-up and every hammer hit lands inside its swing;
 * finite poses. Plus determinism (same seed -> identical event log) and a mirror run (mirrored
 * commands on a mirrored map -> mirrored outcomes).
 *
 * Seeds: C2_FUZZ_SEEDS per layout (default 2; the acceptance run used more, see the C2 report).
 */
import { describe, expect, it } from 'vitest';
import { ITEM_ID_BASE, ITEMS } from '../../src/sim/config';
import { LAYOUTS, MATCH_LAYOUT_IDS } from '../../src/sim/layouts/index';
import { createRng } from '../../src/sim/math';
import { computeRemainingValue } from '../../src/sim/rules';
import { Simulation } from '../../src/sim/sim';
import type { Command, ItemPadDef, LayoutDef, SimEvent, TeamId, Vec2 } from '../../src/sim/types';
import { FuzzDriver } from './fixtures/fuzzbot';
import { fullLayout, makeSetup } from './fixtures/layouts';

const SEEDS = Number(process.env.C2_FUZZ_SEEDS ?? 2);
const KINDS = new Set(Object.keys(ITEMS.specs));

/** `layout` with item pads: its own v2 if it has pads, else classic safes + mirrored test pads. */
function withItemPads(layout: LayoutDef, force = false): LayoutDef {
  if (!force && layout.v2 && layout.v2.itemPads.length) return layout;
  const probe = new Simulation(makeSetup(layout, [0, 1], { content: 'classic' }));
  const axis = layout.size.x / 2;
  const mirror = (p: Vec2): Vec2 => ({ x: 2 * axis - p.x, y: p.y });
  const clearOf = (q: Vec2): boolean => {
    if (!probe.isFree(q, 1.2)) return false;
    for (const l of probe.state.loot) if (Math.hypot(l.pos.x - q.x, l.pos.y - q.y) < (l.kind === 'bank' ? 7 : 2.5)) return false;
    for (const z of layout.zones) if (Math.abs(q.x - z.center.x) < z.half.x + 1.5 && Math.abs(q.y - z.center.y) < z.half.y + 1.5) return false;
    return true;
  };
  const spawn = layout.spawns.find((s) => s.team === 0)!;
  const homeSide = spawn.pos.x < axis ? -1 : 1;
  let pair: Vec2 | null = null;
  for (let r = 12; r <= 18 && !pair; r += 0.5) {
    for (let a = 0; a < 64 && !pair; a++) {
      const ang = (a / 64) * Math.PI * 2;
      const p = { x: spawn.pos.x + Math.cos(ang) * r, y: spawn.pos.y + Math.sin(ang) * r };
      const m = force ? 6 : 2; // the mirror run keeps 6 m off the axis and the arena edge
      if ((p.x - axis) * homeSide < m || p.x < m || p.y < m || p.x > layout.size.x - m || p.y > layout.size.y - m) continue;
      if (clearOf(p) && clearOf(mirror(p))) pair = p;
    }
  }
  let center: Vec2 | null = null;
  for (let dy = 0; dy < layout.size.y / 2 && !center; dy += 0.5) {
    for (const s of [1, -1]) {
      const p = { x: axis, y: layout.size.y / 2 + s * dy };
      if (!center && clearOf(p)) center = p;
    }
  }
  const pads: ItemPadDef[] = [];
  if (pair) pads.push({ id: 'tp.w', pos: pair, twin: 'tp.e' }, { id: 'tp.e', pos: mirror(pair), twin: 'tp.w' });
  if (center) pads.push({ id: 'tp.axis', pos: center, twin: null });
  const v2 = layout.v2 ?? { safes: layout.safes, props: [], breakables: [], gimmicks: [], itemPads: [], eventSpots: [{ x: axis, y: layout.size.y / 2 }] };
  return { ...layout, v2: { ...v2, itemPads: pads } };
}

function fuzzLayouts(): { name: string; layout: LayoutDef }[] {
  const list = [{ name: 'fixture', layout: withItemPads(fullLayout()) }];
  for (const id of MATCH_LAYOUT_IDS) list.push({ name: id, layout: withItemPads(LAYOUTS[id]) });
  return list;
}

/** Item-happy driver: the heist fuzz driver plus drop chasing and hammer swings. */
class ItemFuzzDriver {
  private readonly base: FuzzDriver;
  private readonly rng: () => number;
  private readonly chase: number[];

  constructor(
    private readonly sim: Simulation,
    seed: number,
  ) {
    this.base = new FuzzDriver(sim, seed);
    this.rng = createRng((seed * 104729 + 7) >>> 0);
    this.chase = sim.state.characters.map(() => 0);
  }

  commands(): Command[] {
    const st = this.sim.state;
    this.base.assist(900);
    const cmds = this.base.commands();
    const r = this.rng;
    st.characters.forEach((ch, slot) => {
      const c = cmds[slot]!;
      const me = ch.pos;
      if (ch.item) {
        // swing: at the nearest rival when close, else now and then at whatever is in front
        let best: Vec2 | null = null;
        let bd = 4;
        for (const o of st.characters) {
          if (o.team === ch.team) continue;
          const d = Math.hypot(o.pos.x - me.x, o.pos.y - me.y);
          if (d < bd) {
            bd = d;
            best = o.pos;
          }
        }
        for (const o of st.police) {
          const d = Math.hypot(o.pos.x - me.x, o.pos.y - me.y);
          if (d < bd) {
            bd = d;
            best = o.pos;
          }
        }
        if (best && r() < 0.5) {
          cmds[slot] = { ...c, grab: r() < 0.1 ? c.grab : false, dash: r() < 0.5, aim: { x: best.x - me.x, y: best.y - me.y } };
        } else if (r() < 0.06) cmds[slot] = { ...c, dash: true, grab: r() < 0.2 && c.grab };
        return;
      }
      if (this.chase[slot]! > 0) this.chase[slot]!--;
      else if (r() < 0.01) this.chase[slot] = 120 + Math.floor(r() * 240);
      if (this.chase[slot]! > 0) {
        let tgt: Vec2 | null = null;
        let bd = Infinity;
        for (const it of st.items) {
          const d = Math.hypot(it.pos.x - me.x, it.pos.y - me.y);
          if (d < bd) {
            bd = d;
            tgt = it.pos;
          }
        }
        if (tgt && bd > 0.05) cmds[slot] = { ...c, move: { x: (tgt.x - me.x) / bd, y: (tgt.y - me.y) / bd }, grab: false };
      }
    });
    return cmds;
  }
}

interface Stats {
  pickups: number;
  fires: number;
  hits: number;
  kos: number;
  policeStuns: number;
  clashes: number;
  drops: number;
  gold: number;
  ticks: number;
}

function runFuzz(layout: LayoutDef, seed: number, stats: Stats): string {
  const setup = makeSetup(layout, [0, 0, 1, 1], { content: 'v2', police: true, items: 'on' });
  setup.seed = seed;
  const sim = new Simulation(setup);
  const total = sim.state.totalValue;
  const drv = new ItemFuzzDriver(sim, seed);
  const windupAt = new Map<number, number>();
  const fireAt = new Map<number, number>();
  const H = ITEMS.hammer;
  let guard = 0;
  while (!sim.state.over && guard++ < 20000) {
    const evs: SimEvent[] = sim.step(drv.commands());
    const st = sim.state;
    stats.ticks++;
    // conservation
    if (st.scores[0] + st.scores[1] + st.remainingValue !== total) throw new Error(`conservation broken at ${st.tick}`);
    if (computeRemainingValue(st) !== st.remainingValue) throw new Error(`remaining drift at ${st.tick}`);
    // pickups on the field
    let prev = ITEM_ID_BASE;
    for (const it of st.items) {
      if (it.id <= prev) throw new Error(`item ids not ascending at ${st.tick}`);
      prev = it.id;
      if (!KINDS.has(it.kind) || (it.phase !== 'incoming' && it.phase !== 'ground')) throw new Error(`bad pickup ${JSON.stringify(it)}`);
      if (!(it.uses >= 1 && it.uses <= ITEMS.specs[it.kind].uses)) throw new Error(`bad pickup uses ${JSON.stringify(it)}`);
      if (!Number.isFinite(it.pos.x) || !Number.isFinite(it.pos.y)) throw new Error('pickup NaN');
    }
    if (st.items.length > ITEMS.drop.maxOnField + st.characters.length + 1) throw new Error(`too many pickups ${st.items.length}`);
    // held items + poses
    for (const ch of st.characters) {
      if (!Number.isFinite(ch.pos.x) || !Number.isFinite(ch.pos.y)) throw new Error(`char NaN at ${st.tick}`);
      const it = ch.item;
      if (!it) continue;
      if (ch.knockdownTicks > 0) throw new Error(`knocked-down ${ch.id} still holds ${it.kind} at ${st.tick}`);
      if (!(it.uses >= 0 && it.uses <= ITEMS.specs[it.kind].uses)) throw new Error(`bad held uses ${JSON.stringify(it)}`);
      if (!['idle', 'windup', 'active', 'recover'].includes(it.phase)) throw new Error(`bad phase ${it.phase}`);
      if (it.cooldown < 0 || it.cooldown > ITEMS.specs[it.kind].cooldownTicks) throw new Error(`bad cooldown ${it.cooldown}`);
    }
    for (const e of evs) {
      if (e.type === 'itemPickup') {
        stats.pickups++;
        if (e.kind === 'goldHammer') stats.gold++;
      } else if (e.type === 'itemDropped') stats.drops++;
      else if (e.type === 'itemClash') stats.clashes++;
      else if (e.type === 'itemUse') {
        if (e.phase === 'windup') windupAt.set(e.charId, e.tick);
        else {
          stats.fires++;
          const w = windupAt.get(e.charId);
          if (w === undefined || e.tick - w !== H.windupTicks) throw new Error(`fire without a full wind-up: char ${e.charId} at ${e.tick} (windup ${w})`);
          windupAt.delete(e.charId);
          fireAt.set(e.charId, e.tick);
        }
      } else if (e.type === 'itemHit') {
        stats.hits++;
        if (e.knockdown && e.target === 'char') stats.kos++;
        if (e.knockdown && e.target === 'police') stats.policeStuns++;
        const f = fireAt.get(e.charId);
        if (f === undefined || e.tick < f || e.tick - f >= H.swingTicks) throw new Error(`hit outside a swing: char ${e.charId} at ${e.tick} (fire ${f})`);
      }
    }
    // a cancelled / dropped wind-up never fires later
    for (const ch of st.characters) if (!ch.item || ch.item.phase !== 'windup') windupAt.delete(ch.id);
  }
  expect(sim.state.over).toBe(true);
  return JSON.stringify(sim.eventLog);
}

describe('item fuzz: full matches, items on, police on, 2:2', () => {
  const layouts = fuzzLayouts();
  for (const { name, layout } of layouts) {
    it(`${name}: invariants hold over ${SEEDS} seeds and the log is deterministic`, () => {
      expect(layout.v2!.itemPads.length).toBeGreaterThanOrEqual(2);
      const stats: Stats = { pickups: 0, fires: 0, hits: 0, kos: 0, policeStuns: 0, clashes: 0, drops: 0, gold: 0, ticks: 0 };
      let first = '';
      for (let s = 0; s < SEEDS; s++) {
        const log = runFuzz(layout, 1000 + s, stats);
        if (s === 0) first = log;
      }
      expect(runFuzz(layout, 1000, { ...stats })).toBe(first);
      if (process.env.C2_FUZZ_REPORT) console.log(`[C2 fuzz] ${name} ${JSON.stringify(stats)}`);
      expect(stats.pickups).toBeGreaterThan(0);
      expect(stats.fires).toBeGreaterThan(0);
    }, 600_000);
  }
});

/**
 * Mirror run: slots 0 (team 0) and 1 (team 1) play on the west half, slots 2 (team 1) and 3
 * (team 0) are their mirror images on the east half (same body order in both pairs, so the
 * physics solver sees mirrored contact sets). Each west raccoon wanders inside the west half
 * (clear of the arena edge and 6 m clear of the axis: the classic solver is not bit-mirror-exact
 * for arena-edge contacts or at the corners of axis statics such as the clock tower, with or
 * without items), chases the west pad's drops and swings hammers at its rival, for 75 s (both
 * pair drops and the axis drop). Discrete outcomes (items, uses, phases, knockdowns, bags) must
 * match exactly; poses to 1e-5 m (x' = 2·axis − x itself rounds, and contact-heavy runs amplify
 * that 1e-13 noise by about two decades per 20 s on plaza).
 */
describe('item fuzz: mirror fairness with items on', () => {
  for (const id of MATCH_LAYOUT_IDS) {
    it(`${id}: mirrored commands give mirrored outcomes (drops, pickups, swings, KOs, spills)`, () => {
      // own test pads clear of the edges / axis (the real pads may sit on an edge lane), real v2 otherwise
      const layout = withItemPads(LAYOUTS[id], true);
      const axis = layout.size.x / 2;
      const setup = makeSetup(layout, [0, 1, 1, 0], { content: 'v2', police: false, items: 'on', events: 'off', earlyDecision: false });
      const sim = new Simulation(setup);
      const chars = sim.state.characters;
      const pads = layout.v2!.itemPads;
      const westPad = pads.find((p) => p.twin !== null && p.pos.x < axis)!;
      // start both west raccoons near the west pad (free spots), mirrors on the east
      const spots: Vec2[] = [];
      for (let r = 1.5; r < 12 && spots.length < 2; r += 0.25) {
        for (let a = 0; a < 32 && spots.length < 2; a++) {
          const p = { x: westPad.pos.x + Math.cos((a / 32) * Math.PI * 2) * r, y: westPad.pos.y + Math.sin((a / 32) * Math.PI * 2) * r };
          if (p.x > axis - 6 || p.x < 4 || p.y < 4 || p.y > layout.size.y - 4) continue;
          if (!sim.isFree(p, 0.8)) continue;
          if (spots.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 2)) continue;
          spots.push(p);
        }
      }
      expect(spots.length).toBe(2);
      sim.debug.teleport(1, spots[0]!, 0);
      sim.debug.teleport(2, spots[1]!, 0);
      sim.debug.teleport(3, { x: 2 * axis - spots[0]!.x, y: spots[0]!.y }, 0);
      sim.debug.teleport(4, { x: 2 * axis - spots[1]!.x, y: spots[1]!.y }, 0);
      const twin = [2, 3, 0, 1];
      const rng = createRng(77);
      const held: Command[] = [0, 1].map(() => ({ move: { x: 0, y: 0 }, grab: false, dash: false, aim: null, ping: null }));
      let kos = 0;
      for (let t = 0; t < 60 * 75; t++) {
        const cmds: Command[] = new Array(4);
        for (const s of [0, 1]) {
          const me = chars[s]!.pos;
          if (t % 20 === 0) {
            const a = rng() * Math.PI * 2;
            const m = 0.4 + 0.6 * rng();
            held[s] = { move: { x: Math.cos(a) * m, y: Math.sin(a) * m }, grab: rng() < 0.25, dash: false, aim: null, ping: null };
          }
          let c: Command = { ...held[s]!, dash: rng() < 0.03 };
          const near = sim.state.items.find((i) => i.phase === 'ground' && i.pos.x < axis);
          if (near && !chars[s]!.item && t % 300 < 200) {
            const d = Math.hypot(near.pos.x - me.x, near.pos.y - me.y);
            if (d > 0.05) c = { ...c, move: { x: (near.pos.x - me.x) / d, y: (near.pos.y - me.y) / d }, grab: false };
          }
          const rival = chars[1 - s]!.pos;
          const rd = Math.hypot(rival.x - me.x, rival.y - me.y);
          if (chars[s]!.item && rd < 3) c = { ...c, grab: false, move: { x: (rival.x - me.x) / rd, y: (rival.y - me.y) / rd }, aim: { x: rival.x - me.x, y: rival.y - me.y }, dash: rng() < 0.3 };
          // stay inside the west half, clear of the edges and the axis
          const mv = { ...c.move };
          if (me.x < 4) mv.x = Math.abs(mv.x) + 0.5;
          if (me.x > axis - 6) mv.x = -Math.abs(mv.x) - 0.5;
          if (me.y < 4) mv.y = Math.abs(mv.y) + 0.5;
          if (me.y > layout.size.y - 4) mv.y = -Math.abs(mv.y) - 0.5;
          const ml = Math.hypot(mv.x, mv.y);
          c = { ...c, move: ml > 1 ? { x: mv.x / ml, y: mv.y / ml } : mv };
          cmds[s] = c;
          cmds[twin[s]!] = { ...c, move: { x: -c.move.x, y: c.move.y }, aim: c.aim ? { x: -c.aim.x, y: c.aim.y } : null };
        }
        const evs = sim.step(cmds);
        kos += evs.filter((e) => e.type === 'itemHit' && e.knockdown).length;
        if (sim.state.over) break;
        for (const s of [0, 1]) {
          const a = chars[s]!;
          const b = chars[twin[s]!]!;
          if (Math.abs(a.pos.x + b.pos.x - 2 * axis) > 1e-5 || Math.abs(a.pos.y - b.pos.y) > 1e-5) throw new Error(`${id}: mirror broken at tick ${sim.state.tick}: ${JSON.stringify([a.pos, b.pos])}`);
          if ((a.item?.kind ?? null) !== (b.item?.kind ?? null) || (a.item?.uses ?? -1) !== (b.item?.uses ?? -1) || (a.item?.phase ?? null) !== (b.item?.phase ?? null)) throw new Error(`${id}: item mirror broken at ${sim.state.tick}`);
          if (a.knockdownTicks !== b.knockdownTicks || (a.bag ?? 0) !== (b.bag ?? 0)) throw new Error(`${id}: state mirror broken at ${sim.state.tick}`);
        }
      }
      const log = sim.eventLog;
      if (process.env.C2_FUZZ_REPORT) console.log(`[C2 mirror] ${id} pickups=${log.filter((e) => e.type === 'itemPickup').length} uses=${log.filter((e) => e.type === 'itemUse').length} hits=${log.filter((e) => e.type === 'itemHit').length} kos=${kos}`);
      expect(log.some((e) => e.type === 'itemPickup')).toBe(true);
      expect(log.some((e) => e.type === 'itemHit')).toBe(true);
      expect(sim.state.scores[0]).toBe(sim.state.scores[1]);
    }, 300_000);
  }
});
