/**
 * Content 2.0 view extras (C7a) on mocked v2 state, headless (no WebGL): coins / bags, items /
 * hazards / plungers, props / breakables. Checks the state -> view mapping, the event beats, the
 * rig contracts (attach points, item poses, reactions), steady-state churn (no Object3D /
 * geometry / material created per frame) and clean disposal.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ITEMS, PROP_SPECS, Simulation, type EntityId, type LootState, type PropVariant, type SimEvent } from '../../src/sim';
import { LAYOUTS } from '../../src/sim/layouts';
import { ViewEffects } from '../../src/render/effects';
import { qualityPreset } from '../../src/render/quality';
import { createRaccoon, idlePose, type RaccoonRig } from '../../src/render/models/raccoon';
import { createPropRig, createBreakableRig, type PropRig } from '../../src/render/models/props';
import { createViewExtras, type ViewExtra, type ViewExtrasHost } from '../../src/render/extras';
import { createItemModel } from '../../src/render/items';

interface Rigged {
  sim: Simulation;
  host: ViewExtrasHost;
  world: THREE.Group;
  effects: ViewEffects;
  chars: Map<EntityId, RaccoonRig>;
  loot: Map<EntityId, PropRig>;
  props: Partial<Record<PropVariant, EntityId>>;
  hitstops: number[];
  time: { t: number };
}

function setup(): Rigged {
  const layout = LAYOUTS.plaza;
  const sim = new Simulation({
    layout,
    seed: 5,
    roster: [
      { team: 0, isBot: false, name: 'a', look: { hat: 'teamCapA' } },
      { team: 0, isBot: true, name: 'b', look: { hat: 'teamCapA' } },
      { team: 1, isBot: true, name: 'c', look: { hat: 'teamCapB' } },
      { team: 1, isBot: true, name: 'd', look: { hat: 'teamCapB' } },
    ],
  });
  const st = sim.state;
  const props: Partial<Record<PropVariant, EntityId>> = {};
  const outs = st.loot.filter((l) => l.kind !== 'bank' && l.homeBank === null);
  (['atm', 'piggy', 'moneyTree', 'goldSafe'] as const).forEach((v, i) => {
    const l = outs[i] as LootState;
    const spec = PROP_SPECS[v];
    l.variant = v;
    l.innerValue = spec.inner.c10 * 10 + spec.inner.c50 * 50;
    l.baseValue = spec.shell;
    l.estimatedValue = spec.shell + l.innerValue;
    l.cracks = 0;
    props[v] = l.id;
  });
  const world = new THREE.Group();
  const effects = new ViewEffects(qualityPreset('high'));
  const chars = new Map<EntityId, RaccoonRig>();
  for (const c of st.characters) {
    const r = createRaccoon({ team: c.team, look: c.look });
    world.add(r.root);
    chars.set(c.id, r);
  }
  const loot = new Map<EntityId, PropRig>();
  for (const l of st.loot) {
    if (!l.variant) continue;
    const r = createPropRig(l.variant);
    world.add(r.root);
    loot.set(l.id, r);
  }
  const hitstops: number[] = [];
  const time = { t: 0 };
  const host: ViewExtrasHost = {
    world,
    effects,
    sim,
    time: () => time.t,
    preset: () => qualityPreset('high'),
    reducedMotion: () => false,
    language: () => 'ko',
    mode: () => 'match',
    focusId: () => st.characters[0]!.id,
    charRig: (id) => chars.get(id) ?? null,
    charPose: (id) => {
      const c = sim.getCharacter(id);
      return c ? { x: c.pos.x, y: c.pos.y, a: c.facing, h: 0 } : null;
    },
    lootRig: (id) => loot.get(id) ?? null,
    lootPose: (id) => {
      const l = sim.getLoot(id);
      return l ? { x: l.pos.x, y: l.pos.y, a: l.angle, h: 0 } : null;
    },
    officerPos: () => ({ x: 10, y: 10 }),
    hitstop: (s) => hitstops.push(s),
    shake: () => {},
    punch: () => {},
    impact: () => {},
    pulse: () => {},
    scare: () => {},
    nearFocus: () => 1,
  };
  return { sim, host, world, effects, chars, loot, props, hitstops, time };
}

function frame(r: Rigged, extras: ViewExtra[], dt = 1 / 60): void {
  r.time.t += dt;
  for (const x of extras) x.sync(r.sim.state, 1, dt);
  for (const rig of r.chars.values()) rig.update(dt, idlePose(r.time.t));
  for (const rig of r.loot.values()) rig.update(dt);
  r.effects.update(dt);
}

function find(root: THREE.Object3D, name: string): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o.name === name) out.push(o);
  });
  return out;
}

function populate(r: Rigged): void {
  const st = r.sim.state;
  const c0 = st.characters[0]!;
  for (let i = 0; i < 6; i++) st.coins.push({ id: 10000 + i, pos: { x: c0.pos.x + 2 + i * 0.5, y: c0.pos.y }, vel: { x: 0, y: 0 }, value: i % 3 === 0 ? 50 : 10, noPickupCharId: null, noPickupUntil: 0 });
  st.breakables.push({ id: 'cr', kind: 'crate', center: { x: c0.pos.x - 3, y: c0.pos.y }, half: { x: 0.45, y: 0.45 }, angle: 0, hp: 1, innerValue: 20, broken: false });
  st.breakables.push({ id: 'vd', kind: 'vending', center: { x: c0.pos.x - 5, y: c0.pos.y }, half: { x: 0.6, y: 0.5 }, angle: 0, hp: 3, innerValue: 60, broken: false });
  st.items.push({ id: 2000, kind: 'hammer', padId: 'p', pos: { x: c0.pos.x, y: c0.pos.y + 3 }, phase: 'ground', landTick: 0, expiresTick: 99999, uses: 5 });
  st.items.push({ id: 2001, kind: 'goldHammer', padId: 'q', pos: { x: c0.pos.x + 3, y: c0.pos.y + 3 }, phase: 'incoming', landTick: st.tick + 120, expiresTick: 99999, uses: 8 });
  st.hazards.push({ id: 4000, kind: 'slick', pos: { x: c0.pos.x - 2, y: c0.pos.y + 2 }, radius: 1.6, untilTick: st.tick + 600, ownerTeam: 0 });
  c0.item = { kind: 'hammer', uses: 5, expiresTick: st.tick + 1500, cooldown: 0, phase: 'idle', phaseTicks: 0, aim: 0 };
  st.characters[1]!.bag = 120;
  st.characters[2]!.item = { kind: 'skates', uses: ITEMS.specs.skates.uses, expiresTick: st.tick + 600, cooldown: 0, phase: 'idle', phaseTicks: 0, aim: 0 };
  st.characters[3]!.dizzyTicks = 30;
}

describe('render extras (C7a)', () => {
  it('maps coins, bags, items, hazards, props and breakables from state', () => {
    const r = setup();
    populate(r);
    const extras = createViewExtras(r.host);
    expect(extras.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < 5; i++) frame(r, extras);
    // Coin piles: 4 x 10 + 2 x 50 instances.
    const coinMesh = find(r.world, 'coinPiles')[0] as THREE.InstancedMesh;
    const billMesh = find(r.world, 'billPiles')[0] as THREE.InstancedMesh;
    expect(coinMesh.count).toBe(4);
    expect(billMesh.count).toBe(2);
    // Bag on the back of character 2 (bag 120), none on character 1.
    const c = r.sim.state.characters;
    const bag = find(r.chars.get(c[1]!.id)!.root, `bag:${c[1]!.id}`)[0]!;
    expect(bag.visible).toBe(true);
    expect(bag.scale.y).toBeGreaterThan(0.6);
    expect(find(r.chars.get(c[0]!.id)!.root, `bag:${c[0]!.id}`).length).toBe(0);
    // Held hammer in the right paw, skates on both feet.
    expect(find(r.chars.get(c[0]!.id)!.attach.handR, 'item:hammer').length).toBe(1);
    expect(find(r.chars.get(c[2]!.id)!.attach.footL, 'item:skates').length).toBe(1);
    expect(find(r.chars.get(c[2]!.id)!.attach.footR, 'item:skates').length).toBe(1);
    // Ground pickups + slick + breakables exist.
    expect(find(r.world, 'pickup:2000').length).toBe(1);
    expect(find(r.world, 'pickup:2001').length).toBe(1);
    expect(find(r.world, 'slick').length).toBe(1);
    expect(find(r.world, 'breakable:crate').length).toBe(1);
    expect(find(r.world, 'breakable:vending').length).toBe(1);
    for (const x of extras) x.dispose();
  });

  it('plays the beats: pickup climb, spill stamp, hammer bonk with hit-stop, piggy jackpot, breakable break', () => {
    const r = setup();
    populate(r);
    const extras = createViewExtras(r.host);
    frame(r, extras);
    const st = r.sim.state;
    const [a, , v] = st.characters;
    const send = (events: SimEvent[]): void => {
      for (const x of extras) x.onEvents(events);
    };
    // Pickup: the pile disappears with a coinPickup -> a coin climbs into the bag.
    const pile = st.coins.shift()!;
    a!.bag = pile.value;
    send([{ type: 'coinPickup', tick: st.tick, charId: a!.id, coinId: pile.id, value: pile.value, bag: a!.bag }]);
    frame(r, extras);
    expect(r.effects.coinSpray.alive).toBeGreaterThan(0);
    expect(find(r.chars.get(a!.id)!.root, `bag:${a!.id}`).length).toBe(1);
    // Spill: stamp.
    send([{ type: 'bagSpilled', tick: st.tick, charId: a!.id, value: 10, byId: v!.id, cause: 'hammer' }]);
    expect(r.effects.stamps.count).toBeGreaterThan(0);
    // Hammer bonk on the rival (focus involved) -> 90 ms hit-stop request.
    send([{ type: 'itemHit', tick: st.tick, charId: a!.id, kind: 'hammer', target: 'char', targetId: v!.id, knockdown: true }]);
    expect(r.hitstops).toContain(0.09);
    // Piggy smash -> jackpot hit-stop (120 ms) + broken bowl.
    const pig = r.props.piggy!;
    const lp = r.sim.getLoot(pig)!;
    lp.cracks = 3;
    send([{ type: 'piggyCrack', tick: st.tick, lootId: pig, cracks: 3, smashed: true, byCharId: a!.id }]);
    expect(r.hitstops).toContain(0.12);
    frame(r, extras);
    // Breakable broken -> rig hidden.
    const crate = st.breakables.find((b) => b.id === 'cr')!;
    crate.broken = true;
    crate.hp = 0;
    send([{ type: 'breakableBroken', tick: st.tick, id: 'cr', byCharId: a!.id }]);
    frame(r, extras);
    expect(find(r.world, 'breakable:crate')[0]!.visible).toBe(false);
    for (const x of extras) x.dispose();
  });

  it('drives the hammer swing pose and keeps steady-state frames free of Object3D / geometry / material churn', () => {
    const r = setup();
    populate(r);
    const extras = createViewExtras(r.host);
    for (let i = 0; i < 30; i++) frame(r, extras);
    const c0 = r.sim.state.characters[0]!;
    // Swing phases advance the rig without errors.
    c0.item!.phase = 'windup';
    for (let i = 0; i < 6; i++) frame(r, extras);
    c0.item!.phase = 'active';
    for (let i = 0; i < 9; i++) frame(r, extras);
    c0.item!.phase = 'idle';
    for (let i = 0; i < 30; i++) frame(r, extras);
    // Warm up lazily cached looks (the raccoon's blink faces etc. are created once on first use).
    for (let i = 0; i < 600; i++) frame(r, extras);
    // Steady state: count ids handed out by three's global counters across 300 frames.
    const ids = (): [number, number, number] => [new THREE.Object3D().id, new THREE.BufferGeometry().id, (new THREE.MeshBasicMaterial() as unknown as { id: number }).id];
    const before = ids();
    for (let i = 0; i < 300; i++) frame(r, extras);
    const after = ids();
    expect(after[0] - before[0]).toBe(1);
    expect(after[1] - before[1]).toBe(1);
    expect(after[2] - before[2]).toBe(1);
    for (const x of extras) x.dispose();
  });

  it('disposes cleanly: nothing left in the world or on the rigs', () => {
    const r = setup();
    const baseline = r.world.children.length;
    populate(r);
    const extras = createViewExtras(r.host);
    for (let i = 0; i < 10; i++) frame(r, extras);
    for (const x of extras) x.dispose();
    expect(r.world.children.length).toBe(baseline);
    for (const rig of r.chars.values()) {
      expect(rig.attach.handR.children.length).toBe(0);
      expect(rig.attach.back.children.length).toBe(0);
      expect(rig.attach.footL.children.length).toBe(0);
    }
  });

  it('classic state draws nothing', () => {
    const r = setup();
    for (const l of r.sim.state.loot) l.variant = undefined;
    r.loot.clear();
    const baseline = r.world.children.map((o) => o.name);
    const extras = createViewExtras(r.host);
    for (let i = 0; i < 5; i++) frame(r, extras);
    expect((find(r.world, 'coinPiles')[0] as THREE.InstancedMesh).count).toBe(0);
    expect(r.effects.coinSpray.alive).toBe(0);
    for (const x of extras) x.dispose();
    expect(r.world.children.map((o) => o.name)).toEqual(baseline);
  });

  it('prop rigs: SafeRig contract, contents, cracks, footprints; item models build for every kind', () => {
    for (const v of ['atm', 'piggy', 'moneyTree', 'goldSafe'] as const) {
      const rig = createPropRig(v);
      expect(rig.kind).toBe('largeSafe');
      expect(rig.footprint).toEqual(PROP_SPECS[v].half);
      rig.setAnchored(false);
      rig.setStrain(0.5);
      rig.setContents(0, PROP_SPECS[v].shell);
      rig.hit(0, 1);
      rig.spurt(2);
      rig.update(1 / 60);
      rig.dispose();
    }
    const pig = createPropRig('piggy');
    pig.setCracks(2);
    const cracks = pig.root.children[0]!.children.filter((o) => (o as THREE.Mesh).isMesh && o.visible).length;
    expect(cracks).toBeGreaterThan(1);
    pig.dispose();
    for (const k of ['crate', 'vending'] as const) {
      const b = createBreakableRig(k);
      b.setHp(1);
      b.hit(0);
      b.update(1 / 60);
      expect(b.breakApart(0).length).toBeGreaterThan(4);
      expect(b.root.visible).toBe(false);
      b.dispose();
    }
    for (const k of ['hammer', 'goldHammer', 'plunger', 'skates', 'soap', 'balloons', 'smoke'] as const) {
      for (const held of [true, false]) {
        const m = createItemModel(k, held);
        expect(m.root.children.length).toBeGreaterThan(0);
        m.dispose();
      }
    }
  });
});
