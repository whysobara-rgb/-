/**
 * (Content 2.0, C6) Bots use the wave-1 content: coins (scoop / deposit / spill scavenging),
 * breakables and the ATM bonk, props (collect at shell + coins inside), supply drops and the
 * 뿅망치 — through Command only, reading public state only — and the bot fixes folded in from the
 * balance review (no bank-face regrab loop).
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/sim/sim';
import { ITEMS, ITEM_FOREVER } from '../../src/sim/config';
import { LAYOUTS } from '../../src/sim/layouts/index';
import type { CharacterState, Command, LayoutId, RosterEntry, SimEvent } from '../../src/sim/types';
import { EMPTY_COMMAND } from '../../src/sim/types';
import { Bot } from '../../src/ai/bot';
import { DIFFICULTY_PARAMS, HUMAN_PROXY_PARAMS, contentSkill } from '../../src/ai/params';
import { perceptionAccess } from '../../src/ai/perception';
import { createMatch } from '../../src/ai/harness';
import type { Difficulty, RivalId } from '../../src/ai/types';

const V2: LayoutId[] = ['plaza', 'shortcut', 'counter'];

function v2Match(layout: LayoutId, members: { team: 0 | 1; bot?: { personality: RivalId; difficulty?: Difficulty } }[], seed: number, rules: Record<string, unknown> = {}): { sim: Simulation; bots: (Bot | null)[] } {
  const roster: RosterEntry[] = members.map((m, i) => ({ team: m.team, isBot: !!m.bot, name: `p${i}`, look: { hat: 'none' } }));
  const sim = new Simulation({ layout: LAYOUTS[layout], roster, seed, rules: { content: 'v2', ...rules } });
  const bots = members.map((m, slot) => (m.bot ? new Bot(sim, { slot, personality: m.bot.personality, difficulty: m.bot.difficulty ?? 'normal', seed: seed * 31 + slot }) : null));
  return { sim, bots };
}

function run(sim: Simulation, bots: (Bot | null)[], ticks: number, human?: (slot: number) => Command): SimEvent[] {
  const all: SimEvent[] = [];
  const total = sim.state.totalValue;
  for (let t = 0; t < ticks && !sim.state.over; t++) {
    const cmds = bots.map((b, slot) => (b ? b.update(sim) : human ? human(slot) : EMPTY_COMMAND));
    for (const e of sim.step(cmds)) all.push(e);
    expect(sim.state.scores[0] + sim.state.scores[1] + sim.state.remainingValue).toBe(total);
  }
  return all;
}

describe('C6 contracts', () => {
  it('difficulty item / gimmick skill and aim error follow the plan (decision and aim only)', () => {
    const deg = Math.PI / 180;
    expect(contentSkill(DIFFICULTY_PARAMS.novice)).toEqual({ item: 0.4, gimmick: 0.4, aimError: 25 * deg });
    expect(contentSkill(DIFFICULTY_PARAMS.normal)).toEqual({ item: 0.75, gimmick: 0.8, aimError: 10 * deg });
    expect(contentSkill(DIFFICULTY_PARAMS.challenge)).toEqual({ item: 1, gimmick: 1, aimError: 4 * deg });
    expect(contentSkill(HUMAN_PROXY_PARAMS).item).toBe(0.7);
    expect(contentSkill(HUMAN_PROXY_PARAMS).aimError).toBeCloseTo(12 * deg, 9);
  });

  it('classic matches propose no content goals', () => {
    const { sim, bots } = createMatch({ layout: 'plaza', seed: 5, team0: [{ personality: 'hodadak', difficulty: 'normal' }], team1: [{ personality: 'nunchi', difficulty: 'normal' }], rules: { content: 'classic' } });
    const cmds: Command[] = [];
    for (let t = 0; t < 1800 && !sim.state.over; t++) {
      for (let i = 0; i < bots.length; i++) cmds[i] = bots[i]!.update(sim);
      sim.step(cmds);
    }
    for (const b of bots) for (const k of ['scoop', 'deposit', 'smash', 'kickPiggy', 'fetchItem', 'bonk', 'useItem']) expect(b.stats.goalsByKind[k] ?? 0).toBe(0);
  });
});

describe('C6 bots play the v2 content', () => {
  for (const layout of V2) {
    it(`${layout}: bots scoop + deposit coins, hit breakables / props, fetch and swing hammers (conservation every tick)`, () => {
      const { sim, bots } = v2Match(
        layout,
        [
          { team: 0, bot: { personality: 'hodadak' } },
          { team: 1, bot: { personality: 'nunchi' } },
        ],
        11,
        { police: true },
      );
      const ev = run(sim, bots, 150 * 60);
      const byBot = (e: SimEvent): boolean => 'charId' in e && (e.charId === 1 || e.charId === 2);
      expect(ev.filter((e) => e.type === 'coinPickup' && byBot(e)).length).toBeGreaterThan(3);
      expect(ev.filter((e) => e.type === 'coinsBanked').reduce((s, e) => s + (e.type === 'coinsBanked' ? e.value : 0), 0)).toBeGreaterThanOrEqual(50);
      expect(ev.some((e) => (e.type === 'breakableHit' && e.byCharId !== null) || (e.type === 'propHit' && e.byCharId !== null))).toBe(true);
      expect(ev.some((e) => e.type === 'itemPickup')).toBe(true);
      expect(ev.some((e) => e.type === 'itemUse' && e.phase === 'fire')).toBe(true);
      // props are hauled at shell + coins inside (at least one prop recovered by somebody)
      expect(ev.some((e) => e.type === 'recovered' && e.variant !== undefined)).toBe(true);
    }, 120_000);
  }

  it('the same seed gives the same v2 match twice (bots deterministic with every wave-1 system on)', () => {
    const play = (): string => {
      const { sim, bots } = v2Match('counter', [{ team: 0, bot: { personality: 'tongkeun' } }, { team: 1, bot: { personality: 'hodadak' } }], 21, { police: true });
      const ev = run(sim, bots, 60 * 60);
      return JSON.stringify(ev);
    };
    expect(play()).toBe(play());
  }, 120_000);

  it('a bot with a ready hammer swings at an opposing bag carrier in reach (a deliberate press, aimed at it)', () => {
    const { sim, bots } = v2Match('plaza', [{ team: 0, bot: { personality: 'nunchi', difficulty: 'challenge' } }, { team: 1 }], 3);
    const me = sim.state.characters[0]!;
    const foe = sim.state.characters[1]!;
    // put the two side by side in the open (the human slot stands still)
    let spot: { x: number; y: number } | null = null;
    for (let y = 8; y < sim.layout.size.y - 8 && !spot; y += 1) {
      for (let x = 8; x < sim.layout.size.x - 8 && !spot; x += 1) if (sim.isFree({ x, y }, 2.5)) spot = { x, y };
    }
    expect(spot).not.toBeNull();
    sim.debug.teleport(me.id, spot!);
    sim.debug.teleport(foe.id, { x: spot!.x + 1.6, y: spot!.y });
    me.item = { kind: 'hammer', uses: ITEMS.specs.hammer.uses, expiresTick: ITEM_FOREVER, cooldown: 0, phase: 'idle', phaseTicks: 0, aim: 0 };
    // (test-only: a visibly fat bag makes the stander a target; value bookkeeping is not checked here)
    (foe as CharacterState).bag = 120;
    let fired = false;
    let hitChar = false;
    let windupIntent = false;
    for (let t = 0; t < 90 && !hitChar; t++) {
      const c = bots[0]!.update(sim);
      if (bots[0]!.intent().phase === 'itemWindup') windupIntent = true;
      const ev = sim.step([c, EMPTY_COMMAND]);
      for (const e of ev) {
        if (e.type === 'itemUse' && e.charId === me.id && e.phase === 'fire') fired = true;
        if (e.type === 'itemHit' && e.charId === me.id && e.target === 'char' && e.targetId === foe.id) hitChar = true;
      }
    }
    expect(fired).toBe(true);
    expect(hitChar).toBe(true);
    expect(windupIntent).toBe(true);
    expect(bots[0]!.stats.itemSwings).toBeGreaterThan(0);
  });

  it('an item holder never fires its item with a plain dash (travel / intercept dashes are dropped)', () => {
    const { sim, bots } = v2Match('shortcut', [{ team: 0, bot: { personality: 'hodadak' } }, { team: 1, bot: { personality: 'nunchi' } }], 7, { police: true });
    const ev = run(sim, bots, 120 * 60);
    let presses = 0;
    for (const [i, b] of bots.entries()) {
      const windups = ev.filter((e) => e.type === 'itemUse' && e.phase === 'windup' && e.charId === i + 1).length;
      // every empty-handed dash press with an item in the pocket was a deliberate swing (or the
      // rare pinned break-out, whose lunge frees the bot just as well)
      expect(b!.stats.itemPresses - b!.stats.itemSwings).toBeLessThanOrEqual(2);
      expect(windups).toBeLessThanOrEqual(b!.stats.itemPresses);
      presses += b!.stats.itemPresses;
    }
    expect(presses).toBeGreaterThan(0);
  }, 120_000);

  it('bots never read opponent character state outside Perception in a v2 match (bags and items are seen, not read)', () => {
    const { sim, bots } = v2Match(
      'plaza',
      [
        { team: 0, bot: { personality: 'nunchi', difficulty: 'challenge' } },
        { team: 0, bot: { personality: 'tongkeun', difficulty: 'challenge' } },
        { team: 1, bot: { personality: 'hodadak', difficulty: 'challenge' } },
        { team: 1, bot: { personality: 'nunchi', difficulty: 'challenge' } },
      ],
      13,
    );
    const PRIVATE = new Set(['pos', 'vel', 'facing', 'moveIntent', 'grab', 'straining', 'dashTicks', 'dashCooldown', 'boostTicks', 'knockdownTicks', 'protectTicks', 'floorOf', 'bag', 'item', 'depositTicks', 'dizzyTicks']);
    let updatingTeam: number | null = null;
    const leaks: string[] = [];
    const chars = sim.state.characters as CharacterState[];
    for (let i = 0; i < chars.length; i++) {
      const target = chars[i]!;
      chars[i] = new Proxy(target, {
        get(t, prop, recv) {
          if (updatingTeam !== null && t.team !== updatingTeam && perceptionAccess.depth === 0 && typeof prop === 'string' && PRIVATE.has(prop)) {
            if (leaks.length < 10) leaks.push(`team ${updatingTeam} bot read ${String(prop)} of opponent ${t.id}`);
          }
          return Reflect.get(t, prop, recv);
        },
      });
    }
    const cmds: Command[] = [];
    let coins = 0;
    for (let t = 0; t < 4200 && !sim.state.over; t++) {
      for (let s = 0; s < bots.length; s++) {
        updatingTeam = sim.characterBySlot(s).team;
        cmds[s] = bots[s]!.update(sim);
        updatingTeam = null;
      }
      for (const e of sim.step(cmds)) if (e.type === 'coinPickup') coins++;
    }
    expect(leaks).toEqual([]);
    expect(coins).toBeGreaterThan(0);
  }, 120_000);
});

describe('C6 balance-review fixes', () => {
  it('no bank-face regrab loop (shortcut 3701017: a forced pull on the wrong face is switched, not regrabbed)', () => {
    const { sim, bots } = createMatch({ layout: 'shortcut', seed: 3701017, team0: [{ personality: 'nunchi', difficulty: 'normal' }], team1: [{ personality: 'tongkeun', difficulty: 'novice' }], rules: { content: 'classic', police: true } });
    const cmds: Command[] = [];
    while (!sim.state.over && sim.state.tick < 6000) {
      for (let i = 0; i < bots.length; i++) cmds[i] = bots[i]!.update(sim);
      sim.step(cmds);
    }
    const regrabs = bots.flatMap((b) => b.log.filter((l) => /regrab bank/.test(l)));
    expect(regrabs.length).toBeLessThanOrEqual(3);
  }, 120_000);
});
