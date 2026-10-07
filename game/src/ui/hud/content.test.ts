/**
 * [C8] Content 2.0 HUD adapters against the real v2 Simulation (node, no DOM): item slot, bag
 * chip (never score), deposit ring, prop / breakable / item tags (proximity only), minimap layers,
 * props named as themselves in the grab prompt, classic untouched.
 */
import { describe, expect, it } from 'vitest';
import { Simulation, type Command, type MatchSetup, type RuleConfig } from '../../sim';
import { COINS, ITEMS, ITEM_FOREVER, PROP_SPECS, TICK_RATE } from '../../sim/config';
import { LAYOUTS } from '../../sim/layouts';
import { contentFromSim, grabFromState, hudModelFromSim, itemSlotFromState, type SimView } from './adapters';
import { ko } from '../strings/ko';
import { en } from '../strings/en';

function setup(rules: Partial<RuleConfig>): MatchSetup {
  return {
    layout: LAYOUTS.plaza,
    seed: 11,
    roster: [
      { team: 0, isBot: false, name: '나', look: { hat: 'teamCapA' } },
      { team: 1, isBot: true, name: '호다닥', look: { hat: 'hodadakBand', rival: 'hodadak' } },
    ],
    rules,
  };
}

const idle: Command = { move: { x: 0, y: 0 }, grab: false, dash: false };
const project = (p: { x: number; y: number }, h: number) => ({ x: p.x * 20, y: p.y * 20 - h * 10, onScreen: true });

function v2(): Simulation {
  const sim = new Simulation(setup({ content: 'v2', police: false }));
  for (let i = 0; i < 30; i++) sim.step([idle, idle]);
  return sim;
}

describe('[C8] content HUD adapters', () => {
  it('classic matches carry no content model (and no content minimap layers)', () => {
    const sim = new Simulation(setup({ content: 'classic' }));
    sim.step([idle, idle]);
    const me = sim.characterBySlot(0);
    const m = hudModelFromSim(sim, { meId: me.id, myTeam: 0, project });
    expect(m.content).toBeNull();
    expect(m.minimap?.itemPads ?? []).toHaveLength(0);
    expect(m.minimap?.items ?? []).toHaveLength(0);
    expect(m.minimap?.coins ?? []).toHaveLength(0);
    expect(contentFromSim(sim, me, project)).toBeNull();
  });

  it('item slot: pips, lifetime ring, armed only with empty hands; golden hammer has no ring', () => {
    const sim = v2();
    const st = sim.state;
    const me = st.characters[0]!;
    expect(itemSlotFromState(st, me)).toBeNull();
    const spec = ITEMS.specs.hammer;
    me.item = { kind: 'hammer', uses: 3, expiresTick: st.tick + spec.lifetimeTicks / 2, cooldown: spec.cooldownTicks, phase: 'idle', phaseTicks: 0, aim: 0 };
    const s = itemSlotFromState(st, me)!;
    expect(s).toMatchObject({ kind: 'hammer', uses: 3, maxUses: 5, armed: true, phase: 'idle' });
    expect(s.life).toBeCloseTo(0.5, 5);
    expect(s.lifeSec).toBeCloseTo(spec.lifetimeTicks / 2 / TICK_RATE, 5);
    expect(s.cooldown).toBe(1);
    me.item = { kind: 'goldHammer', uses: 8, expiresTick: ITEM_FOREVER, cooldown: 0, phase: 'windup', phaseTicks: 3, aim: 0 };
    const g = itemSlotFromState(st, me)!;
    expect(g.life).toBeNull();
    expect(g.lifeSec).toBeNull();
    expect(g.maxUses).toBe(8);
    me.item = { kind: 'skates', uses: ITEM_FOREVER, expiresTick: st.tick + 60, cooldown: 0, phase: 'idle', phaseTicks: 0, aim: 0 };
    expect(itemSlotFromState(st, me)!.uses).toBeNull(); // unlimited: no pips
    me.item = null;
  });

  it('bag chip + deposit ring: carried value only, never score', () => {
    const sim = v2();
    const st = sim.state;
    const me = st.characters[0]!;
    me.bag = 150;
    me.depositTicks = COINS.depositTicks / 2;
    const m = hudModelFromSim(sim, { meId: me.id, myTeam: 0, project });
    expect(m.content?.bag).toEqual({ value: 150, cap: COINS.bagCap, deposit: 0.5 });
    expect(m.content?.deposit).toMatchObject({ progress: 0.5, value: 150, team: 0 });
    // the bag never shows up as score (scores, swing remaining is F4's and counts bags as "남은")
    expect(m.scores).toEqual([0, 0]);
    expect(m.carry).toBeNull();
    me.depositTicks = 0;
    const m2 = hudModelFromSim(sim, { meId: me.id, myTeam: 0, project });
    expect(m2.content?.bag?.deposit).toBeNull();
    expect(m2.content?.deposit).toBeNull();
    me.bag = 0;
    expect(hudModelFromSim(sim, { meId: me.id, myTeam: 0, project }).content?.bag).toBeNull();
  });

  it('props are tagged by name + coins (proximity only) instead of a safe value tag', () => {
    const sim = v2();
    const me = sim.state.characters[0]!;
    const far = hudModelFromSim(sim, { meId: me.id, myTeam: 0, project, nearRadius: 0.01 });
    expect((far.content?.labels ?? []).filter((l) => l.kind === 'prop' || l.kind === 'breakable')).toHaveLength(0);
    const near = hudModelFromSim(sim, { meId: me.id, myTeam: 0, project, nearRadius: 500 });
    const props = (near.content?.labels ?? []).filter((l) => l.kind === 'prop');
    const variants = props.map((l) => (l.kind === 'prop' ? l.variant : '')).sort();
    expect(variants).toEqual(['atm', 'atm', 'moneyTree', 'piggy']);
    const atm = props.find((l) => l.kind === 'prop' && l.variant === 'atm');
    expect(atm).toMatchObject({ value: 200, coins: 10, bills: 0, cracks: null });
    const tree = props.find((l) => l.kind === 'prop' && l.variant === 'moneyTree');
    expect(tree).toMatchObject({ value: 300, bills: 4 });
    const piggy = props.find((l) => l.kind === 'prop' && l.variant === 'piggy');
    expect(piggy).toMatchObject({ value: 300, cracks: 0 });
    expect((near.content?.labels ?? []).filter((l) => l.kind === 'breakable').length).toBe(sim.state.breakables.length);
    // no safe-style value tag for a prop (it would read "큰 금고 100")
    const propIds = new Set(sim.state.loot.filter((l) => l.variant).map((l) => l.id));
    expect((near.labels ?? []).some((l) => l.kind === 'value' && propIds.has(Number(l.id)))).toBe(false);
  });

  it('minimap: supply pads, field items, coin piles and prop variants', () => {
    const sim = v2();
    const me = sim.state.characters[0]!;
    const m = hudModelFromSim(sim, { meId: me.id, myTeam: 0, project });
    expect(m.minimap?.itemPads?.length).toBe(LAYOUTS.plaza.v2!.itemPads.length);
    expect(m.minimap?.itemPads?.filter((p) => p.twin === null)).toHaveLength(1);
    expect(m.minimap?.coins).toBe(sim.state.coins);
    expect(m.minimap?.safes.filter((s) => s.variant).map((s) => s.variant).sort()).toEqual(['atm', 'atm', 'moneyTree', 'piggy']);
    // run to the first pair drop (15 s): both twins appear on the minimap and as item labels
    const land = Math.round(ITEMS.drop.pairs[0]! * TICK_RATE);
    while (sim.state.tick < land + 1) sim.step([idle, idle]);
    const m2 = hudModelFromSim(sim, { meId: me.id, myTeam: 0, project });
    expect(m2.minimap?.items?.length).toBe(2);
    expect(m2.minimap?.items?.every((i) => i.kind === 'hammer' && !i.incoming)).toBe(true);
    expect((m2.content?.labels ?? []).filter((l) => l.kind === 'item')).toHaveLength(2);
  });

  it('grab prompt names a prop as itself with its own uproot time', () => {
    const sim = v2();
    const me = sim.state.characters[0]!;
    const atm = sim.state.loot.find((l) => l.variant === 'atm')!;
    const view: SimView = {
      state: sim.state,
      rules: sim.rules,
      layout: sim.layout,
      getGrabCandidate: () => ({ targetId: atm.id, part: 'safe', anchorWorld: atm.pos, anchorLocal: { x: 0, y: 0 } }),
      getLoot: (id) => sim.getLoot(id),
    };
    const g = grabFromState(view, me)!;
    expect(g.variant).toBe('atm');
    expect(g.unanchorSec).toBe(PROP_SPECS.atm.uprootTicks / TICK_RATE);
    expect(g.value).toBe(200);
  });

  it('every content string key exists in ko and en', () => {
    const keys = Object.keys(ko).filter((k) => k.startsWith('hud.content.'));
    expect(keys.length).toBeGreaterThan(30);
    for (const k of keys) expect((en as Record<string, string>)[k], k).toBeTruthy();
    for (const kind of Object.keys(ITEMS.specs)) for (const f of ['name', 'verb', 'hint']) expect(ko[`hud.content.item.${kind}.${f}` as keyof typeof ko], `${kind}.${f}`).toBeTruthy();
    for (const v of Object.keys(PROP_SPECS)) expect(ko[`hud.content.prop.${v}` as keyof typeof ko], v).toBeTruthy();
  });
});
