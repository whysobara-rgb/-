/**
 * Dev harness for the Content 2.0 view extras (C7a): a real GameView on a real layout with the
 * Content 2.0 state MOCKED the way the v2 sim will produce it (props, breakables, coins, bags,
 * items, hazards, plungers) and scripted event beats (hammer swing + bonk, spill, ATM spurt,
 * piggy cracks + jackpot, tree shed, crate / vending breaks, coin pickups, deposit, supply drop,
 * hammer clash, plunger throw). Use it for screenshots at the default game camera.
 *
 *   npx vite --port 5111 --strictPort  ->  http://127.0.0.1:5111/dev/content-harness.html
 *
 * URL params: layout=plaza|shortcut|counter  quality=low|medium|high  scene=lineup|empty
 *             auto=0 (no rAF loop; drive via window.__content)  reduced=1  lang=en  hud=0
 * window.__content: setup(scene) / act(name) / run(seconds) / frame() / perf(frames) / stats().
 */
import {
  EMPTY_COMMAND,
  ITEMS,
  ITEM_FOREVER,
  PROP_SPECS,
  Simulation,
  type CharacterState,
  type CoinPile,
  type EntityId,
  type ItemKind,
  type LayoutId,
  type LootState,
  type PropVariant,
  type RosterEntry,
  type SimEvent,
  type Vec2,
} from '../../sim';
import { BREAKABLE_SPECS, COINS } from '../../sim/config';
import type { BreakableDef, Command, ItemPadDef, LayoutDef, PropPlacementDef } from '../../sim';
import { LAYOUTS } from '../../sim/layouts';
import { GameView, type ViewFocus, type ViewSettings } from '../view';
import type { QualityLevel } from '../quality';

const params = new URLSearchParams(location.search);
const app = document.getElementById('app')!;
const hud = document.getElementById('hud')!;
if (params.get('hud') === '0') hud.classList.add('hidden');
const layoutId = (params.get('layout') ?? 'plaza') as LayoutId;
const auto = params.get('auto') !== '0';

const settings: ViewSettings = {
  quality: (params.get('quality') ?? 'high') as QualityLevel,
  screenShake: 1,
  reducedMotion: params.get('reduced') === '1',
  language: params.get('lang') === 'en' ? 'en' : 'ko',
};
const view = new GameView(app, settings);

let sim!: Simulation;
/** 'live' scene: the real v2 systems (coins / props / items / breakables) driven by bots. */
let live = false;
interface BotLike {
  readonly slot: number;
  update(sim: Simulation): Command;
}
let bots: BotLike[] = [];
type CreateBot = (sim: Simulation, opts: { slot: number; personality: 'hodadak' | 'tongkeun' | 'nunchi'; difficulty: 'novice' | 'normal' | 'challenge'; seed: number }) => BotLike;
let createBot: CreateBot | null = null;
const aiModules = import.meta.glob('../../ai/index.ts');
async function loadBots(): Promise<void> {
  const loader = aiModules['../../ai/index.ts'];
  if (!loader) return;
  try {
    const mod = (await loader()) as { createBot?: CreateBot };
    if (typeof mod.createBot === 'function') createBot = mod.createBot;
  } catch (err) {
    console.warn('[content-harness] bots unavailable:', err);
  }
}

/**
 * A v2 composition for a real layout (until C4 attaches layout.v2): its classic safes, mirrored
 * ATMs near the spawns, the piggy + money tree on the axis, mirrored crates / vending machines and
 * item pads (pairs + axis), all on free ground found by search.
 */
function liveLayout(base: LayoutDef): LayoutDef {
  if (base.v2) return base;
  const probe = new Simulation({ layout: base, roster: roster(), seed: 1 });
  const axis = base.size.x / 2;
  const mirror = (q: Vec2): Vec2 => ({ x: 2 * axis - q.x, y: q.y });
  const taken: Vec2[] = [];
  const free = (q: Vec2, r: number): boolean => {
    if (q.x < 3 || q.y < 3 || q.x > base.size.x - 3 || q.y > base.size.y - 3) return false;
    for (const t of [q, mirror(q)]) {
      if (!probe.isFree(t, r)) return false;
      for (const l of probe.state.loot) if (Math.hypot(l.pos.x - t.x, l.pos.y - t.y) < (l.kind === 'bank' ? 7.5 : 2.5)) return false;
      for (const z of base.zones) if (Math.abs(t.x - z.center.x) < z.half.x + 3 && Math.abs(t.y - z.center.y) < z.half.y + 3) return false;
      for (const o of taken) if (Math.hypot(o.x - t.x, o.y - t.y) < r + 1.6) return false;
    }
    return true;
  };
  const near = (from: Vec2, rMin: number, rMax: number, r: number, side: number): Vec2 | null => {
    for (let d = rMin; d <= rMax; d += 0.5) {
      for (let a = 0; a < 48; a++) {
        const q = { x: from.x + Math.cos((a / 48) * Math.PI * 2) * d, y: from.y + Math.sin((a / 48) * Math.PI * 2) * d };
        if (side !== 0 && (q.x - axis) * side > -1.5) continue;
        if (free(q, r)) return q;
      }
    }
    return null;
  };
  const spawn = base.spawns.find((sp) => sp.team === 0)!;
  const side = spawn.pos.x < axis ? -1 : 1;
  const props: PropPlacementDef[] = [];
  const breakables: BreakableDef[] = [];
  const itemPads: ItemPadDef[] = [];
  const atm = near(spawn.pos, 8, 14, 1.4, side);
  if (atm) {
    taken.push(atm, mirror(atm));
    props.push({ variant: 'atm', pos: atm, angle: 0 }, { variant: 'atm', pos: mirror(atm), angle: 0 });
  }
  for (const [v, dy] of [
    ['piggy', -5],
    ['moneyTree', 5],
  ] as const) {
    for (let k = 0; k < 30; k++) {
      const q = { x: axis, y: base.size.y / 2 + dy + (k % 2 ? 1 : -1) * Math.floor(k / 2) };
      if (probe.isFree(q, v === 'moneyTree' ? 1.6 : 1.2) && !taken.some((o) => Math.hypot(o.x - q.x, o.y - q.y) < 3)) {
        taken.push(q);
        props.push({ variant: v, pos: q, angle: 0 });
        break;
      }
    }
  }
  (['crate', 'crate', 'vending'] as const).forEach((kind, i) => {
    const q = near(spawn.pos, 5, 10, 1.2, side);
    if (!q) return;
    taken.push(q, mirror(q));
    const half = { ...BREAKABLE_SPECS[kind].half };
    breakables.push({ id: `live.${kind}.${i}.a`, kind, center: q, half, angle: 0 }, { id: `live.${kind}.${i}.b`, kind, center: mirror(q), half, angle: 0 });
  });
  const pad = near(spawn.pos, 10, 16, 1, side);
  if (pad) {
    taken.push(pad, mirror(pad));
    itemPads.push({ id: 'live.pad.a', pos: pad, twin: 'live.pad.b' }, { id: 'live.pad.b', pos: mirror(pad), twin: 'live.pad.a' });
  }
  for (let k = 0; k < 30; k++) {
    const q = { x: axis, y: base.size.y / 2 + (k % 2 ? 1 : -1) * Math.floor(k / 2) };
    if (probe.isFree(q, 1) && !taken.some((o) => Math.hypot(o.x - q.x, o.y - q.y) < 2.5)) {
      itemPads.push({ id: 'live.pad.axis', pos: q, twin: null });
      break;
    }
  }
  return { ...base, v2: { safes: base.safes, props, breakables, gimmicks: [], itemPads, eventSpots: [] } };
}
let P: Vec2 = { x: 0, y: 0 };
let nextCoinId = 10000;
let scene = params.get('scene') ?? 'lineup';
const props: Partial<Record<PropVariant, EntityId>> = {};
const schedule: { tick: number; fn: () => void }[] = [];
let pendingEvents: SimEvent[] = [];
let eventLog: string[] = [];

function roster(): RosterEntry[] {
  return [
    { team: 0, isBot: false, name: '나', look: { hat: 'teamCapA', furTint: 0.5 } },
    { team: 0, isBot: true, name: '동료', look: { hat: 'teamCapA', furTint: 0.25 } },
    { team: 1, isBot: true, name: '통큰이', look: { hat: 'tongkeunHat', rival: 'tongkeun', furTint: 0.8 } },
    { team: 1, isBot: true, name: '호다닥', look: { hat: 'hodadakBand', rival: 'hodadak', furTint: 0.35 } },
  ];
}

const ch = (slot: number): CharacterState => sim.state.characters[slot]!;
const at = (dx: number, dy: number): Vec2 => ({ x: P.x + dx, y: P.y + dy });
const tick = (): number => sim.state.tick;

function emit(e: SimEvent): void {
  pendingEvents.push(e);
}
function later(dtSec: number, fn: () => void): void {
  schedule.push({ tick: tick() + Math.max(1, Math.round(dtSec * 60)), fn });
}

function findOpen(radius: number): Vec2 {
  const L = sim.layout;
  const mid = { x: L.size.x / 2, y: L.size.y / 2 + 6 };
  let best = mid;
  let bestScore = -1;
  for (let y = 8; y < L.size.y - 8; y += 1) {
    for (let x = 10; x < L.size.x - 10; x += 1) {
      const p = { x, y };
      // Keep clear of the recovery zones (props would start recovering) and the banks.
      if (L.zones.some((z) => Math.abs(x - z.center.x) < z.half.x + 9 && Math.abs(y - z.center.y) < z.half.y + 8)) continue;
      if (sim.state.loot.some((l) => l.kind === 'bank' && Math.hypot(l.pos.x - x, l.pos.y - y) < 12)) continue;
      let free = 0;
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        for (const r of [2, 4, 6, radius]) if (sim.isFree({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r * 0.7 }, 0.8)) free++;
      }
      const score = free - Math.hypot(x - mid.x, y - mid.y) * 0.3;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
  }
  return best;
}

function makeProp(l: LootState, v: PropVariant, pos: Vec2): void {
  const spec = PROP_SPECS[v];
  const inner = spec.inner.c10 * 10 + spec.inner.c50 * 50;
  l.variant = v;
  l.innerValue = inner;
  l.baseValue = spec.shell;
  l.estimatedValue = spec.shell + inner;
  l.cracks = 0;
  sim.debug.setAnchored(l.id, false);
  sim.debug.teleport(l.id, pos, 0);
  if (spec.uprootTicks > 0) sim.debug.setAnchored(l.id, true);
  props[v] = l.id;
}

function addCoin(pos: Vec2, value: 10 | 50): CoinPile {
  const c: CoinPile = { id: nextCoinId++, pos: { ...pos }, vel: { x: 0, y: 0 }, value, noPickupCharId: null, noPickupUntil: 0 };
  sim.state.coins.push(c);
  return c;
}

/** Spawn a burst of piles with velocities (the v2 sim integrates them; here they glide by hand). */
function burst(src: Vec2, dir: number | null, values: (10 | 50)[], source: 'spurt' | 'bonk' | 'break' | 'smash' | 'shed' | 'spill', sourceId: EntityId | string | null, byCharId: EntityId | null): void {
  const ids: EntityId[] = [];
  values.forEach((v, i) => {
    const n = values.length;
    const a = dir === null ? (i / n) * Math.PI * 2 : dir + (n === 1 ? 0 : (i / (n - 1) - 0.5) * 2 * COINS.fanHalfAngle);
    const sp = COINS.speeds[i % COINS.speeds.length]!;
    const c = addCoin(src, v);
    c.vel = { x: Math.cos(a) * sp, y: Math.sin(a) * sp };
    ids.push(c.id);
  });
  emit({ type: 'coinSpawn', tick: tick(), ids, total: values.reduce((s, v) => s + v, 0), pos: { ...src }, source, sourceId, byCharId });
}

function giveItem(slot: number, kind: ItemKind | null): void {
  const c = ch(slot);
  c.item = kind ? { kind, uses: ITEMS.specs[kind].uses, expiresTick: kind === 'goldHammer' ? ITEM_FOREVER : tick() + 60 * 20, cooldown: 0, phase: 'idle', phaseTicks: 0, aim: c.facing } : null;
}

/**
 * Live-mode proxy for slot 0 (exercises the real v2 events through the view): breaks crates /
 * vending machines with dashes, scoops coins, deposits at its zone, fetches items and bonks the
 * nearest rival with a hammer.
 */
let proxyDashPrev = false;
let proxyNextDash = 0;
function proxyCommand(): Command {
  const st = sim.state;
  const me = st.characters[0]!;
  const dash = (want: boolean): boolean => {
    let d = false;
    if (want && st.tick >= proxyNextDash && !proxyDashPrev) {
      d = true;
      proxyNextDash = st.tick + 30;
    }
    proxyDashPrev = d;
    return d;
  };
  const go = (t: Vec2, dashNear = 0): Command => {
    const dx = t.x - me.pos.x;
    const dy = t.y - me.pos.y;
    const d = Math.hypot(dx, dy) || 1;
    return { move: { x: dx / d, y: dy / d }, grab: false, dash: dash(dashNear > 0 && d < dashNear), aim: { x: dx / d, y: dy / d } };
  };
  const nearest = <T,>(list: T[], pos: (t: T) => Vec2): T | null => {
    let best: T | null = null;
    let bd = Infinity;
    for (const x of list) {
      const p = pos(x);
      const d = Math.hypot(p.x - me.pos.x, p.y - me.pos.y);
      if (d < bd) {
        bd = d;
        best = x;
      }
    }
    return best;
  };
  const bag = me.bag ?? 0;
  const brk = nearest(st.breakables.filter((b) => !b.broken), (b) => b.center);
  if (brk && bag < 120) return go(brk.center, 2.2);
  const coin = nearest(st.coins.filter((c) => c.noPickupCharId !== me.id || st.tick >= c.noPickupUntil), (c) => c.pos);
  if (coin && bag < 200) return go(coin.pos);
  if (bag > 0) {
    const z = sim.layout.zones.find((zz) => zz.team === me.team)!;
    return go(z.center);
  }
  const item = nearest(st.items.filter((i) => i.phase === 'ground'), (i) => i.pos);
  if (!me.item && item) return go(item.pos);
  const rival = nearest(st.characters.filter((c) => c.team !== me.team && c.knockdownTicks <= 0), (c) => c.pos);
  if (me.item && rival) return go(rival.pos, 1.5);
  return { move: { x: 0, y: 0 }, grab: false, dash: dash(false) };
}

function setupLive(): void {
  live = true;
  const layout = liveLayout(LAYOUTS[layoutId] ?? LAYOUTS.plaza);
  sim = new Simulation({ layout, roster: roster(), seed: 21, rules: { content: 'v2', events: 'off', police: params.get('police') === '1' } });
  view.load(sim);
  view.setMode('match');
  bots = [];
  if (createBot) {
    const pers = ['hodadak', 'tongkeun', 'tongkeun', 'hodadak'] as const;
    for (const c of sim.state.characters) {
      if (c.slot === 0 && params.get('proxy') !== '0') continue;
      try {
        bots.push(createBot(sim, { slot: c.slot, personality: c.look.rival ?? pers[c.slot]!, difficulty: 'normal', seed: 31 + c.slot }));
      } catch (err) {
        console.warn('[content-harness] createBot failed', err);
      }
    }
  }
}

function setup(name: string): void {
  scene = name;
  live = false;
  if (name === 'live') {
    schedule.length = 0;
    pendingEvents = [];
    eventLog = [];
    setupLive();
    return;
  }
  schedule.length = 0;
  pendingEvents = [];
  eventLog = [];
  nextCoinId = 10000;
  const layout = LAYOUTS[layoutId] ?? LAYOUTS.plaza;
  sim = new Simulation({ layout, roster: roster(), seed: 3 });
  P = findOpen(9);
  const d = sim.debug;
  // Four outdoor safes become the props, in an arc north of the player.
  const outs = sim.state.loot.filter((l) => l.kind !== 'bank' && l.homeBank === null);
  const variants: PropVariant[] = ['atm', 'piggy', 'moneyTree', 'goldSafe'];
  const spots = [at(-5.6, -3.4), at(-1.8, -4.4), at(2.4, -4.6), at(6.4, -3.2)];
  if (name !== 'empty') variants.forEach((v, i) => outs[i] && makeProp(outs[i]!, v, spots[i]!));
  // Characters.
  d.teleport(ch(0).id, at(0, 0), -Math.PI / 2);
  d.teleport(ch(1).id, at(-2.6, 1.2), -0.3);
  d.teleport(ch(2).id, at(1.3, -0.2), Math.PI);
  d.teleport(ch(3).id, at(4.6, 1.4), Math.PI * 0.85);
  view.load(sim);
  view.setMode('match');
  if (name === 'empty') return;
  const st = sim.state;
  // Breakables (south-west / south-east of the player).
  st.breakables.push(
    { id: 'crate-a', kind: 'crate', center: at(-4.6, 2.8), half: { ...BREAKABLE_SPECS.crate.half }, angle: 0.2, hp: BREAKABLE_SPECS.crate.hp, innerValue: 20, broken: false },
    { id: 'crate-b', kind: 'crate', center: at(-3.5, 3.6), half: { ...BREAKABLE_SPECS.crate.half }, angle: -0.3, hp: BREAKABLE_SPECS.crate.hp, innerValue: 20, broken: false },
    { id: 'vend-a', kind: 'vending', center: at(7.2, 2.4), half: { ...BREAKABLE_SPECS.vending.half }, angle: 0, hp: BREAKABLE_SPECS.vending.hp, innerValue: 60, broken: false },
  );
  // Loose piles (coins + bills) south of the player.
  for (let i = 0; i < 7; i++) addCoin(at(-1.2 + (i % 4) * 0.9 + (i > 3 ? 0.45 : 0), 2.4 + (i > 3 ? 0.8 : 0)), 10);
  addCoin(at(2.6, 2.6), 50);
  addCoin(at(3.4, 3.1), 50);
  // Items: ground pickups along the south edge + an incoming supply crate.
  const kinds: ItemKind[] = ['soap', 'hammer', 'goldHammer', 'plunger', 'skates'];
  kinds.forEach((k, i) => st.items.push({ id: 2000 + i, kind: k, padId: 'pad', pos: at(-3.6 + i * 1.8, 4.4), phase: 'ground', landTick: 0, expiresTick: tick() + 1800, uses: ITEMS.specs[k].uses }));
  st.items.push({ id: 2010, kind: 'hammer', padId: 'pad-x', pos: at(8.6, -0.6), phase: 'incoming', landTick: tick() + 100, expiresTick: tick() + 2000, uses: 5 });
  // Soap slick west.
  st.hazards.push({ id: 4000, kind: 'slick', pos: at(-7.6, 0.2), radius: ITEMS.soap.slickRadius, untilTick: tick() + 60 * 600, ownerTeam: 0 });
  // Held items / bags / dizzy.
  giveItem(0, 'hammer');
  giveItem(1, 'skates');
  ch(1).bag = 150;
  giveItem(2, 'plunger');
  ch(2).bag = 40;
  giveItem(3, 'soap');
  ch(3).dizzyTicks = 60 * 600;
  for (const c of st.characters) c.depositTicks = 0;
}

// ---------------------------------------------------------------------------
// Scripted beats
// ---------------------------------------------------------------------------

function setPhase(slot: number, phase: 'idle' | 'windup' | 'active' | 'recover'): void {
  const it = ch(slot).item;
  if (it) {
    it.phase = phase;
    it.phaseTicks = 0;
  }
}

const acts: Record<string, () => void> = {
  swing() {
    const a = ch(0);
    const v = ch(2);
    giveItem(0, a.item?.kind === 'goldHammer' ? 'goldHammer' : 'hammer');
    setPhase(0, 'windup');
    emit({ type: 'itemUse', tick: tick(), charId: a.id, kind: a.item!.kind, phase: 'windup' });
    later(ITEMS.hammer.windupTicks / 60, () => {
      setPhase(0, 'active');
      emit({ type: 'itemUse', tick: tick(), charId: a.id, kind: a.item!.kind, phase: 'fire' });
    });
    later((ITEMS.hammer.windupTicks + 5) / 60, () => {
      emit({ type: 'itemHit', tick: tick(), charId: a.id, kind: a.item!.kind, target: 'char', targetId: v.id, knockdown: true });
      v.knockdownTicks = 60;
      const spill = Math.max(10, Math.floor((v.bag ?? 0) / 2 / 10) * 10);
      if ((v.bag ?? 0) > 0) {
        v.bag = (v.bag ?? 0) - spill;
        emit({ type: 'bagSpilled', tick: tick(), charId: v.id, value: spill, byId: a.id, cause: 'hammer' });
        burst(v.pos, Math.atan2(v.pos.y - a.pos.y, v.pos.x - a.pos.x), Array(spill / 10).fill(10), 'spill', v.id, a.id);
      }
    });
    later((ITEMS.hammer.windupTicks + ITEMS.hammer.swingTicks) / 60, () => setPhase(0, 'recover'));
    later((ITEMS.hammer.windupTicks + ITEMS.hammer.swingTicks + ITEMS.hammer.recoverTicks) / 60, () => setPhase(0, 'idle'));
    later(1.2, () => (v.knockdownTicks = 0));
  },
  windup() {
    setPhase(0, 'windup');
  },
  spurt() {
    const id = props.atm;
    const l = id !== undefined ? sim.getLoot(id) : undefined;
    if (!l || (l.innerValue ?? 0) <= 0) return;
    l.innerValue = (l.innerValue ?? 0) - 20;
    l.estimatedValue = l.baseValue + l.innerValue;
    emit({ type: 'propHit', tick: tick(), lootId: l.id, byCharId: ch(0).id, how: 'dash', coins: 2 });
    burst({ x: l.pos.x, y: l.pos.y + 0.6 }, Math.PI / 2, [10, 10], 'bonk', l.id, ch(0).id);
  },
  crack() {
    const id = props.piggy;
    const l = id !== undefined ? sim.getLoot(id) : undefined;
    if (!l) return;
    const n = Math.min(3, (l.cracks ?? 0) + 1);
    l.cracks = n;
    const smashed = n >= 3;
    emit({ type: 'piggyCrack', tick: tick(), lootId: l.id, cracks: n, smashed, byCharId: ch(0).id });
    if (smashed && (l.innerValue ?? 0) > 0) {
      l.innerValue = 0;
      l.estimatedValue = 0;
      burst(l.pos, null, [50, 10, 10, 50, 10, 10, 10, 50, 10, 10, 50, 10, 10, 10], 'smash', l.id, ch(0).id);
    }
  },
  shed() {
    const id = props.moneyTree;
    const l = id !== undefined ? sim.getLoot(id) : undefined;
    if (!l || (l.innerValue ?? 0) <= 0) return;
    l.innerValue = (l.innerValue ?? 0) - 50;
    l.estimatedValue = l.baseValue + l.innerValue;
    emit({ type: 'propHit', tick: tick(), lootId: l.id, byCharId: null, how: 'impact', coins: 1 });
    burst({ x: l.pos.x, y: l.pos.y + 0.6 }, Math.PI / 2, [50], 'shed', l.id, null);
  },
  uproot() {
    for (const v of ['atm', 'moneyTree', 'goldSafe'] as const) {
      const id = props[v];
      if (id === undefined) continue;
      sim.debug.setAnchored(id, false);
      emit({ type: 'unanchored', tick: tick(), lootId: id, kind: 'largeSafe', byTeam: 0 });
    }
  },
  breakCrate() {
    const b = sim.state.breakables.find((x) => x.kind === 'crate' && !x.broken);
    if (!b) return;
    b.hp = 0;
    b.broken = true;
    emit({ type: 'breakableHit', tick: tick(), id: b.id, hp: 0, byCharId: ch(1).id });
    emit({ type: 'breakableBroken', tick: tick(), id: b.id, byCharId: ch(1).id });
    burst(b.center, -Math.PI / 2, [10, 10], 'break', b.id, ch(1).id);
  },
  hitVending() {
    const b = sim.state.breakables.find((x) => x.kind === 'vending' && !x.broken);
    if (!b) return;
    b.hp -= 1;
    emit({ type: 'breakableHit', tick: tick(), id: b.id, hp: b.hp, byCharId: ch(3).id });
    if (b.hp <= 0) {
      b.broken = true;
      emit({ type: 'breakableBroken', tick: tick(), id: b.id, byCharId: ch(3).id });
      burst(b.center, Math.PI * 0.5, [10, 10, 10, 10, 10], 'break', b.id, ch(3).id);
    } else burst(b.center, Math.PI * 0.6, [10], 'break', b.id, ch(3).id);
  },
  pickup() {
    // The teammate scoops the three nearest piles, one per 0.12 s (coin climb).
    const c = ch(1);
    const near = [...sim.state.coins].sort((a, b) => Math.hypot(a.pos.x - c.pos.x, a.pos.y - c.pos.y) - Math.hypot(b.pos.x - c.pos.x, b.pos.y - c.pos.y)).slice(0, 3);
    near.forEach((pile, i) =>
      later(0.12 * i + 0.02, () => {
        const k = sim.state.coins.indexOf(pile);
        if (k < 0) return;
        sim.state.coins.splice(k, 1);
        c.bag = Math.min(COINS.bagCap, (c.bag ?? 0) + pile.value);
        emit({ type: 'coinPickup', tick: tick(), charId: c.id, coinId: pile.id, value: pile.value, bag: c.bag });
      }),
    );
  },
  deposit() {
    const c = ch(1);
    emit({ type: 'coinDepositStart', tick: tick(), charId: c.id, team: c.team });
    for (let i = 1; i <= COINS.depositTicks; i++) later(i / 60, () => (c.depositTicks = i));
    later(COINS.depositTicks / 60 + 0.02, () => {
      const v = c.bag ?? 0;
      c.bag = 0;
      c.depositTicks = 0;
      emit({ type: 'coinsBanked', tick: tick(), charId: c.id, team: c.team, value: v });
    });
  },
  drop() {
    const it = sim.state.items.find((x) => x.phase === 'incoming');
    if (!it) {
      const id = 2020 + Math.floor(Math.random() * 100);
      sim.state.items.push({ id, kind: 'goldHammer', padId: 'axis', pos: at(8.6, -0.6), phase: 'incoming', landTick: tick() + ITEMS.drop.warnTicks, expiresTick: tick() + 3000, uses: 8 });
      emit({ type: 'itemIncoming', tick: tick(), padId: 'axis', kind: 'goldHammer', landTick: tick() + ITEMS.drop.warnTicks });
    }
  },
  clash() {
    giveItem(2, 'hammer');
    setPhase(0, 'active');
    setPhase(2, 'active');
    emit({ type: 'itemClash', tick: tick(), aId: ch(0).id, bId: ch(2).id });
    later(0.3, () => {
      setPhase(0, 'idle');
      setPhase(2, 'idle');
    });
  },
  plunger() {
    giveItem(2, 'plunger');
    const c = ch(2);
    setPhase(2, 'windup');
    later(0.2, () => {
      setPhase(2, 'active');
      emit({ type: 'itemUse', tick: tick(), charId: c.id, kind: 'plunger', phase: 'fire' });
      const dir = Math.PI * 0.9;
      sim.state.projectiles.push({ id: 3000, kind: 'plunger', ownerId: c.id, pos: { x: c.pos.x + Math.cos(dir) * 0.6, y: c.pos.y + Math.sin(dir) * 0.6 }, vel: { x: Math.cos(dir) * 25, y: Math.sin(dir) * 25 }, dieTick: tick() + 19 });
    });
    later(0.52, () => setPhase(2, 'idle'));
  },
  police() {
    // Hammer on an officer (no officer in this mock: the FX play at a spot).
    emit({ type: 'itemHit', tick: tick(), charId: ch(0).id, kind: 'hammer', target: 'police', targetId: 1000, knockdown: false });
  },
  gold() {
    giveItem(0, 'goldHammer');
  },
};

// ---------------------------------------------------------------------------
// Stepping (the classic sim keeps characters / loot in place; mocked content moves here)
// ---------------------------------------------------------------------------

function stepMock(): void {
  const st = sim.state;
  // Glide piles with drag (the v2 sim's coin integration, simplified).
  for (const c of st.coins) {
    if (c.vel.x === 0 && c.vel.y === 0) continue;
    c.pos.x += c.vel.x / 60;
    c.pos.y += c.vel.y / 60;
    const k = Math.exp(-COINS.drag / 60);
    c.vel.x *= k;
    c.vel.y *= k;
    if (Math.hypot(c.vel.x, c.vel.y) < 0.05) c.vel = { x: 0, y: 0 };
  }
  for (let i = st.items.length - 1; i >= 0; i--) {
    const it = st.items[i]!;
    if (it.phase === 'incoming' && st.tick >= it.landTick) {
      it.phase = 'ground';
      emit({ type: 'itemSpawn', tick: st.tick, itemId: it.id, kind: it.kind, pos: { ...it.pos } });
    }
  }
  for (let i = st.projectiles.length - 1; i >= 0; i--) {
    const p = st.projectiles[i]!;
    p.pos.x += p.vel.x / 60;
    p.pos.y += p.vel.y / 60;
    if (st.tick >= p.dieTick) st.projectiles.splice(i, 1);
  }
  for (const c of st.characters) {
    if (c.knockdownTicks > 0 && scene !== 'lineup') c.knockdownTicks--;
    const it = c.item;
    if (it) it.phaseTicks++;
  }
}

function stepOnce(): void {
  if (live) {
    const cmds = sim.state.characters.map((c) => (c.slot === 0 && params.get('proxy') !== '0' ? proxyCommand() : bots.find((b) => b.slot === c.slot)?.update(sim) ?? EMPTY_COMMAND));
    const ev = sim.state.over ? [] : sim.step(cmds);
    view.captureTick(sim);
    for (const e of ev) eventLog.push(e.type);
    if (ev.length) view.onEvents(ev, sim);
    return;
  }
  const cmds = sim.state.characters.map(() => EMPTY_COMMAND);
  const ev = sim.step(cmds);
  // Classic sim may not touch knockdown we set by hand for show: keep it.
  stepMock();
  for (let i = schedule.length - 1; i >= 0; i--) {
    if (schedule[i]!.tick <= tick()) {
      const s = schedule.splice(i, 1)[0]!;
      s.fn();
    }
  }
  view.captureTick(sim);
  const all = ev.concat(pendingEvents);
  pendingEvents = [];
  for (const e of all) eventLog.push(e.type);
  if (all.length) view.onEvents(all, sim);
}

function focus(): ViewFocus {
  return { charId: ch(0).id, grabCandidate: null, pingTargetIds: [] };
}

function run(seconds: number, draw = false): void {
  const n = Math.max(1, Math.round(seconds * 60));
  for (let i = 0; i < n; i++) {
    stepOnce();
    if (draw) view.render(sim, 1, 1 / 60, focus());
    else view.advance(sim, 1, 1 / 60, focus());
  }
}

declare global {
  interface Window {
    __content?: ContentApi;
  }
}

interface ContentApi {
  ready: boolean;
  readonly sim: Simulation;
  readonly view: GameView;
  setup(scene: string): void;
  act(name: string): void;
  run(seconds: number, draw?: boolean): void;
  frame(): void;
  /** Median ms of advance() over `frames` frames and of render() over `renders` frames (sim paused, dt 1/60). */
  perf(frames: number, renders?: number): { advance: number; render: number; draws: number; triangles: number };
  stats(): ReturnType<GameView['stats']> & { coins: number; items: number; events: string[] };
  setQuality(q: QualityLevel): void;
  setReduced(on: boolean): void;
  focusOn(dx: number, dy: number): void;
  /** Close-up still (dev only): aim the camera at P + (dx, dy) from `dist` m at `pitch`° / `yaw`° and draw. */
  closeup(dx: number, dy: number, dist: number, pitch?: number, yaw?: number, h?: number): void;
}

const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)] ?? 0;
};

const api: ContentApi = {
  ready: false,
  get sim() {
    return sim;
  },
  view,
  setup,
  act(name: string) {
    acts[name]?.();
  },
  run,
  frame() {
    view.render(sim, 1, 0, focus());
  },
  perf(frames: number, renders = 3) {
    const adv: number[] = [];
    const ren: number[] = [];
    for (let i = 0; i < frames; i++) {
      const t = performance.now();
      view.advance(sim, 1, 1 / 60, focus());
      adv.push(performance.now() - t);
    }
    for (let i = 0; i < renders; i++) {
      const t = performance.now();
      view.render(sim, 1, 1 / 60, focus());
      ren.push(performance.now() - t);
    }
    const s = view.stats();
    return { advance: median(adv), render: median(ren), draws: s.sceneDrawCalls, triangles: s.triangles };
  },
  stats() {
    return { ...view.stats(), coins: sim.state.coins.length, items: sim.state.items.length, events: [...eventLog] };
  },
  setQuality(q: QualityLevel) {
    settings.quality = q;
    view.applySettings(settings);
  },
  setReduced(on: boolean) {
    settings.reducedMotion = on;
    view.applySettings(settings);
  },
  closeup(dx: number, dy: number, dist: number, pitch = 40, yaw = 0, h = 0.6) {
    view.advance(sim, 1, 0, focus());
    const cam = view.camera;
    const t = at(dx, dy);
    const pr = (pitch * Math.PI) / 180;
    const yr = (yaw * Math.PI) / 180;
    cam.position.set(t.x + Math.sin(yr) * Math.cos(pr) * dist, h + Math.sin(pr) * dist, t.y + Math.cos(yr) * Math.cos(pr) * dist);
    cam.lookAt(t.x, h, t.y);
    cam.updateMatrixWorld();
    const scene = (view as unknown as { scene: import('three').Scene }).scene;
    view.webgl.render(scene, cam);
  },
  focusOn(dx: number, dy: number) {
    sim.debug.teleport(ch(0).id, at(dx, dy), -Math.PI / 2);
    view.captureTick(sim);
    view.captureTick(sim);
  },
};
window.__content = api;

await loadBots();
setup(scene);
run(0.1);
api.ready = true;
hud.textContent = 'Content 2.0 harness — keys: 1 swing · 2 spurt · 3 crack · 4 shed · 5 crate · 6 vending · 7 pickup · 8 deposit · 9 drop · 0 clash · P plunger · U uproot · G gold';
const keyActs: Record<string, string> = { '1': 'swing', '2': 'spurt', '3': 'crack', '4': 'shed', '5': 'breakCrate', '6': 'hitVending', '7': 'pickup', '8': 'deposit', '9': 'drop', '0': 'clash', p: 'plunger', u: 'uproot', g: 'gold' };
addEventListener('keydown', (e) => {
  const a = keyActs[e.key.toLowerCase()];
  if (a) acts[a]?.();
});
if (auto) {
  let last = performance.now();
  let acc = 0;
  const loop = (now: number): void => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt;
    let n = 0;
    while (acc >= 1 / 60 && n < 4) {
      stepOnce();
      acc -= 1 / 60;
      n++;
    }
    if (n === 4) acc = 0;
    view.render(sim, Math.min(1, acc * 60), dt, focus());
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
} else view.render(sim, 1, 0, focus());
