/**
 * Dev harness for the in-game view: a real Simulation driven by the keyboard (focus raccoon),
 * scripted scenario controllers and — when src/ai/index.ts exports createBot — real bots.
 *
 *   npx vite --port 5183 --strictPort  ->  http://127.0.0.1:5183/dev/view-harness.html
 *
 * URL params:
 *   layout=plaza|shortcut|counter|tutorial   quality=low|medium|high   scenario=<name>
 *   bots=0 (no AI)   hud=0 (hide overlay)   auto=0 (no rAF loop; drive via window.__harness)
 *   labels=1 (draw project() test labels)   lang=ko|en
 * Scenarios: start, strain, haul, pullSafe, fence, recover, final, ping, dash, preview, title, results, free,
 *            taunt (four raccoons face off; taunts cycle on mocked CharacterState.emote states)
 *
 * Taunts (owner addition): until the sim plays them, the harness MOCKS them the way the sim will:
 * it sets CharacterState.emote and feeds an 'emote' event (with nearOpponentId) to the view, and
 * clears the state at endTick (or with 'emoteCancel'). Keys: Z/X/C/V base taunts on the focus
 * raccoon, B/N/M-less: 5/6/7 rival taunts; window.__harness.emote(slot, id) / cancelEmote(slot).
 * showOthers=0 renders with the "show others' taunts" setting off.
 *
 * Keys: WASD/arrows move, Space grab (hold), Shift dash, E ping at the mouse, Tab next focus,
 *       M cycle view mode, 1/2/3 quality, R reload scenario.
 *
 * window.__harness exposes step / advance / capture / stats for Playwright.
 */
import { Simulation, EMPTY_COMMAND, EMOTE, type Command, type EmoteId, type EntityId, type LayoutId, type MatchSetup, type RosterEntry, type SimEvent, type Vec2 } from '../../sim';
import { LAYOUTS } from '../../sim/layouts';
import { GameView, type ViewFocus, type ViewMode, type ViewSettings } from '../view';
import type { QualityLevel } from '../quality';

type Controller = (sim: Simulation) => Command;

interface BotLike {
  readonly slot: number;
  update(sim: Simulation): Command;
  intent?(): { telegraph: boolean; goal: string };
}

const params = new URLSearchParams(location.search);
const app = document.getElementById('app')!;
const hud = document.getElementById('hud')!;
const labelsEl = document.getElementById('labels')!;
if (params.get('hud') === '0') hud.classList.add('hidden');

const layoutId = (params.get('layout') ?? 'plaza') as LayoutId;
let scenario = params.get('scenario') ?? 'start';
const useBots = params.get('bots') !== '0';
const auto = params.get('auto') !== '0';
const showLabels = params.get('labels') === '1';

const settings: ViewSettings = {
  quality: (params.get('quality') ?? 'high') as QualityLevel,
  screenShake: 1,
  reducedMotion: params.get('reduced') === '1',
  language: params.get('lang') === 'en' ? 'en' : 'ko',
  showOthersTaunts: params.get('showOthers') !== '0',
};
const view = new GameView(app, settings);

// ---------------------------------------------------------------------------
// Optional bots (guarded: src/ai may not exist yet)
// ---------------------------------------------------------------------------

type CreateBot = (sim: Simulation, opts: { slot: number; personality: 'hodadak' | 'tongkeun' | 'nunchi'; difficulty: 'novice' | 'normal' | 'challenge'; seed: number }) => BotLike;
let createBot: CreateBot | null = null;
const aiModules = import.meta.glob('../../ai/index.ts');
async function loadBots(): Promise<void> {
  const loader = aiModules['../../ai/index.ts'];
  if (!loader || !useBots) return;
  try {
    const mod = (await loader()) as { createBot?: CreateBot };
    if (typeof mod.createBot === 'function') createBot = mod.createBot;
  } catch (err) {
    console.warn('[view-harness] bots unavailable:', err);
  }
}

// ---------------------------------------------------------------------------
// Match state
// ---------------------------------------------------------------------------

let sim!: Simulation;
let focusSlot = 0;
const controllers = new Map<number, Controller>();
let bots: BotLike[] = [];
let pendingPing: { pos: Vec2; targetId: EntityId | null } | null = null;
let eventCount = 0;
const eventTypes: Record<string, number> = {};

function roster(): RosterEntry[] {
  return [
    { team: 0, isBot: false, name: '나', look: { hat: 'teamCapA', furTint: 0.5 } },
    { team: 0, isBot: true, name: '동료', look: { hat: 'teamCapA', furTint: 0.25 } },
    { team: 1, isBot: true, name: '통큰이', look: { hat: 'tongkeunHat', rival: 'tongkeun', furTint: 0.8 } },
    { team: 1, isBot: true, name: '호다닥', look: { hat: 'hodadakBand', rival: 'hodadak', furTint: 0.35 } },
  ];
}

function newSim(rules?: MatchSetup['rules']): Simulation {
  const layout = LAYOUTS[layoutId] ?? LAYOUTS.plaza;
  const r = layout.spawns.length < 4 ? roster().slice(0, layout.spawns.length) : roster();
  return new Simulation({ layout, roster: r, seed: 7, rules });
}

const lootOf = (kind: string) => sim.state.loot.filter((l) => l.kind === kind);
const banks = () => lootOf('bank');
const charId = (slot: number) => sim.state.characters[slot]!.id;

function toward(from: Vec2, to: Vec2, scale = 1): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.05) return { x: 0, y: 0 };
  const k = Math.min(1, d / 0.6) * scale;
  return { x: (dx / d) * k, y: (dy / d) * k };
}

/** Hold `grab` while pushing the stick in `dir` (aim at `aim`). */
function holdCtl(dir: Vec2, aim: Vec2, grab = true): Controller {
  return () => ({ move: dir, grab, dash: false, aim, ping: null });
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

function setupScenario(name: string): void {
  controllers.clear();
  let rules: MatchSetup['rules'] | undefined;
  if (name === 'results') rules = { matchTicks: 260, earlyDecision: false };
  if (name === 'police' || name === 'policeTackle' || params.get('police') === '1') rules = { ...(rules ?? {}), police: true };
  sim = newSim(rules);
  view.load(sim);
  view.setMode(name === 'preview' || name === 'title' || name === 'results' ? (name as ViewMode) : 'match');
  if (name !== 'title' && name !== 'preview' && name !== 'results') view.setMode('match');
  bots = [];
  const scripted = new Set<number>();
  const d = sim.debug;
  focusSlot = 0;
  const L = sim.layout;

  if (name === 'strain') {
    // Focus raccoon pulls the camera-side (south) wall of the north bank.
    const b = banks()[0]!;
    const south = { x: b.pos.x - 1, y: b.pos.y + BANK_FACE_Y(b.angle) + 0.55 };
    d.teleport(charId(0), south, -Math.PI / 2);
    controllers.set(0, holdCtl({ x: 0, y: 1 }, { x: 0, y: -1 }));
    d.teleport(charId(2), { x: b.pos.x + 6.5, y: b.pos.y + 6.5 }, Math.PI);
    scripted.add(0);
  } else if (name === 'uprootSmall' || name === 'uprootLarge') {
    // Focus pulls an outdoor safe straight out of the ground (camera side).
    const kind = name === 'uprootSmall' ? 'smallSafe' : 'largeSafe';
    const cands = sim.state.loot.filter((l) => l.kind === kind && l.homeBank === null);
    const mid = { x: L.size.x / 2, y: L.size.y / 2 };
    cands.sort((a, b) => Math.hypot(a.pos.x - mid.x, a.pos.y - mid.y) - Math.hypot(b.pos.x - mid.x, b.pos.y - mid.y));
    const safe = cands[0] ?? sim.state.loot.find((l) => l.kind === kind)!;
    // Re-plant it on open ground near the middle so the moment is readable.
    if (params.get('replant') !== '0') {
      let best = safe.pos;
      for (let r = 3; r < 20 && best === safe.pos; r += 1) {
        for (let k = 0; k < 16; k++) {
          const p = { x: mid.x + Math.cos((k / 16) * Math.PI * 2) * r, y: mid.y + Math.sin((k / 16) * Math.PI * 2) * r };
          if (sim.isFree(p, 2.6)) {
            best = p;
            break;
          }
        }
      }
      d.setAnchored(safe.id, false);
      d.teleport(safe.id, best, 0);
      d.setAnchored(safe.id, true);
    }
    const half = kind === 'smallSafe' ? 0.4 : 0.6;
    d.teleport(charId(0), { x: safe.pos.x, y: safe.pos.y + half + 0.62 }, -Math.PI / 2);
    controllers.set(0, holdCtl({ x: 0, y: 1 }, { x: 0, y: -1 }));
    scripted.add(0);
    // A rival watching nearby (reacts to the pop).
    d.teleport(charId(2), { x: safe.pos.x + 3.5, y: safe.pos.y + 1.5 }, Math.PI);
    controllers.set(2, holdCtl({ x: 0, y: 0 }, { x: -1, y: 0 }, false));
    scripted.add(2);
  } else if (name === 'uprootInterior') {
    // Inside the north bank: the focus pulls the large vault safe off the floor.
    const b = banks()[0]!;
    const large = sim.state.loot.find((l) => l.kind === 'largeSafe' && l.homeBank === b.id)!;
    const c = Math.cos(b.angle);
    const sn = Math.sin(b.angle);
    // Stand on the bank-local -x side of the safe, pulling toward -x.
    const lx = -0.7 - 0.62;
    d.teleport(charId(0), { x: large.pos.x + lx * c, y: large.pos.y + lx * sn }, b.angle);
    controllers.set(0, holdCtl({ x: -c, y: -sn }, { x: c, y: sn }));
    scripted.add(0);
  } else if (name === 'police' || name === 'policeTackle') {
    // Real sim police: the bank gets uprooted (alarm), the focus hauls a small safe; the car
    // arrives after POLICE.dispatchDelayTicks and the officers chase the carrier.
    const b = banks()[0]!;
    const safe = sim.state.loot.find((l) => l.kind === 'smallSafe' && l.homeBank === null)!;
    d.setAnchored(b.id, false);
    d.setAnchored(safe.id, false);
    const entry = (L.policeEntries && L.policeEntries[0]) ?? { park: { x: L.size.x / 2, y: 2.5 } };
    // Open ground in front of the parking spot (toward the arena middle).
    const toMid = Math.sign(L.size.y / 2 - entry.park.y) || 1;
    let spot = { x: entry.park.x + 5, y: entry.park.y + 4.5 * toMid };
    for (let r = 4; r < 22; r += 1) {
      const p = { x: entry.park.x + (name === 'policeTackle' ? 2 : 5), y: entry.park.y + r * toMid };
      if (sim.isFree(p, 1.6)) {
        spot = p;
        break;
      }
    }
    d.teleport(safe.id, spot, 0);
    d.teleport(charId(0), { x: spot.x + 0.4 + 0.62, y: spot.y }, Math.PI);
    controllers.set(0, holdCtl({ x: 0, y: 0 }, { x: -1, y: 0 }));
    scripted.add(0);
    for (const c of sim.state.characters) {
      if (c.slot === 0) continue;
      scripted.add(c.slot);
      controllers.set(c.slot, holdCtl({ x: 0, y: 0 }, { x: 0, y: 1 }, false));
    }
  } else if (name === 'haul') {
    // Teammate hauls the uprooted north bank west; the focus rides inside next to the vault.
    const b = banks()[0]!;
    d.setAnchored(b.id, false);
    d.teleport(charId(0), { x: b.pos.x - 0.2, y: b.pos.y + 1.6 }, Math.PI);
    d.teleport(charId(1), { x: b.pos.x - 3.55, y: b.pos.y - 2.6 }, 0);
    controllers.set(0, holdCtl({ x: 0, y: 0 }, { x: -1, y: 0 }, false));
    controllers.set(1, holdCtl({ x: -1, y: 0 }, { x: 1, y: 0 }));
    scripted.add(0).add(1);
  } else if (name === 'pullSafe') {
    // The rival hauls the bank east while the focus slips in the west door and pulls the vault out.
    const b = banks()[0]!;
    d.setAnchored(b.id, false);
    const large = sim.state.loot.find((l) => l.kind === 'largeSafe' && l.homeBank === b.id)!;
    d.setAnchored(large.id, false);
    d.teleport(large.id, { x: b.pos.x - 2.15, y: b.pos.y }, 0);
    d.teleport(charId(0), { x: b.pos.x - 3.55, y: b.pos.y }, 0);
    controllers.set(0, holdCtl({ x: -1, y: 0.0 }, { x: 1, y: 0 }));
    d.teleport(charId(2), { x: b.pos.x + 3.55, y: b.pos.y + 2.6 }, Math.PI);
    controllers.set(2, holdCtl({ x: 1, y: 0 }, { x: -1, y: 0 }));
    scripted.add(0).add(2);
  } else if (name === 'fence') {
    // Two raccoons push the north bank south through the weak fence (shortcut layout).
    const b = banks()[0]!;
    d.setAnchored(b.id, false);
    const fence = L.fences[0];
    if (fence) d.teleport(b.id, { x: fence.center.x, y: fence.center.y - 4 - 0.6 }, b.angle);
    const nb = sim.getLoot(b.id)!;
    d.teleport(charId(0), { x: nb.pos.x - 1.6, y: nb.pos.y - 4.55 }, Math.PI / 2);
    d.teleport(charId(1), { x: nb.pos.x + 1.6, y: nb.pos.y - 4.55 }, Math.PI / 2);
    controllers.set(0, holdCtl({ x: 0, y: 1 }, { x: 0, y: 1 }));
    controllers.set(1, holdCtl({ x: 0, y: 1 }, { x: 0, y: 1 }));
    scripted.add(0).add(1);
  } else if (name === 'recover') {
    // A large outdoor safe dragged into our zone: green outline + progress sweep, then the flight.
    const z = L.zones.find((zz) => zz.team === 0)!;
    const safe = sim.state.loot.find((l) => l.kind === 'largeSafe' && l.homeBank === null) ?? sim.state.loot.find((l) => l.kind === 'smallSafe' && l.homeBank === null)!;
    d.setAnchored(safe.id, false);
    d.teleport(safe.id, { x: z.center.x + 1.5, y: z.center.y + 1 }, 0.3);
    d.teleport(charId(0), { x: z.center.x + 3.0, y: z.center.y + 1.4 }, Math.PI);
    controllers.set(0, holdCtl({ x: 0, y: 0 }, { x: -1, y: -0.2 }));
    scripted.add(0);
  } else if (name === 'final') {
    // Both banks dropped into the zones -> recovered -> final countdown with van sirens.
    const [b0, b1] = banks();
    const z0 = L.zones.find((z) => z.team === 0)!;
    const z1 = L.zones.find((z) => z.team === 1) ?? z0;
    if (b0) {
      d.setAnchored(b0.id, false);
      d.teleport(b0.id, z0.center, Math.PI / 2);
    }
    if (b1) {
      d.setAnchored(b1.id, false);
      d.teleport(b1.id, z1.center, Math.PI / 2);
    }
    d.teleport(charId(0), { x: z0.vanPos.x + 2.4, y: z0.vanPos.y + 3.6 }, -Math.PI / 2);
    d.teleport(charId(1), { x: z0.vanPos.x + 3.6, y: z0.vanPos.y + 4.4 }, -Math.PI / 2);
    scripted.add(0).add(1);
    controllers.set(0, holdCtl({ x: 0, y: 0 }, { x: 0, y: -1 }, false));
    controllers.set(1, holdCtl({ x: 0, y: 0 }, { x: 0, y: -1 }, false));
  } else if (name === 'ping') {
    // Focus pings a safe ("같이 잡자") and the ground ("이쪽으로"); the safe pulses, beacons float.
    const safe = sim.state.loot.find((l) => l.kind === 'smallSafe' && l.homeBank === null)!;
    d.teleport(charId(0), { x: safe.pos.x + 2.5, y: safe.pos.y + 2 }, Math.PI);
    d.teleport(charId(1), { x: safe.pos.x + 4, y: safe.pos.y + 3.5 }, Math.PI);
    let n = 0;
    controllers.set(0, () => {
      n++;
      const ping = n === 2 ? { pos: safe.pos, targetId: safe.id } : n === 4 ? { pos: { x: safe.pos.x + 5, y: safe.pos.y - 3 }, targetId: null } : null;
      return { move: { x: 0, y: 0 }, grab: false, dash: false, aim: { x: -1, y: -0.6 }, ping };
    });
    scripted.add(0).add(1);
    controllers.set(1, holdCtl({ x: 0, y: 0 }, { x: -1, y: -1 }, false));
  } else if (name === 'dash') {
    // Focus dashes into a rival: knockdown stars + dizzy face.
    const p = { ...sim.state.characters[0]!.pos };
    d.teleport(charId(0), { x: p.x + 4, y: p.y + 1 }, 0);
    d.teleport(charId(2), { x: p.x + 6.6, y: p.y + 1 }, Math.PI);
    let n = 0;
    controllers.set(0, () => {
      n++;
      return { move: { x: 1, y: 0 }, grab: false, dash: n >= 3 && n < 6, aim: { x: 1, y: 0 }, ping: null };
    });
    controllers.set(2, holdCtl({ x: 0, y: 0 }, { x: -1, y: 0 }, false));
    scripted.add(0).add(2);
  } else if (name === 'title') {
    // Idle raccoons on the plaza in front of the north bank.
    const b = banks()[0]!;
    const spots = [
      { x: b.pos.x - 3, y: b.pos.y + 6.2 },
      { x: b.pos.x - 0.8, y: b.pos.y + 7.4 },
      { x: b.pos.x + 1.6, y: b.pos.y + 6.6 },
      { x: b.pos.x + 3.6, y: b.pos.y + 7.6 },
    ];
    sim.state.characters.forEach((c, i) => d.teleport(c.id, spots[i % spots.length]!, Math.PI / 2 + (i - 1.5) * 0.3));
    sim.state.characters.forEach((c) => {
      scripted.add(c.slot);
      controllers.set(c.slot, holdCtl({ x: 0, y: 0 }, { x: 0, y: 1 }, false));
    });
  } else if (name === 'results') {
    const z = L.zones.find((zz) => zz.team === 0)!;
    const safe = sim.state.loot.find((l) => l.kind === 'smallSafe' && l.homeBank === null)!;
    d.setAnchored(safe.id, false);
    d.teleport(safe.id, z.center, 0);
    sim.state.characters.forEach((c) => {
      scripted.add(c.slot);
      controllers.set(c.slot, holdCtl({ x: 0, y: 0 }, { x: 0, y: 1 }, false));
    });
  } else if (name === 'preview') {
    sim.state.characters.forEach((c) => {
      scripted.add(c.slot);
      controllers.set(c.slot, holdCtl({ x: 0, y: 0 }, { x: 0, y: 1 }, false));
    });
  }

  if (createBot && name !== 'preview' && name !== 'title' && name !== 'results') {
    const personalities = ['hodadak', 'tongkeun', 'hodadak', 'hodadak'] as const;
    for (const c of sim.state.characters) {
      if (c.slot === focusSlot || scripted.has(c.slot) || !c.isBot) continue;
      try {
        bots.push(createBot(sim, { slot: c.slot, personality: c.look.rival ?? personalities[c.slot]!, difficulty: 'normal', seed: 11 + c.slot }));
      } catch (err) {
        console.warn('[view-harness] createBot failed', err);
      }
    }
  }
  if (name === 'taunt') {
    // Two pairs face off on open ground: focus (slot 0) vs the rival (slot 2), the teammate and
    // the other rival watch. Everyone stands still (taunts only play standing).
    const mid = { x: L.size.x / 2, y: L.size.y / 2 };
    let spot = mid;
    for (let r = 0; r < 24; r += 1) {
      let found = false;
      for (let k = 0; k < 12 && !found; k++) {
        const p = { x: mid.x + Math.cos((k / 12) * Math.PI * 2) * r, y: mid.y + Math.sin((k / 12) * Math.PI * 2) * r };
        if (sim.isFree(p, 6.5)) {
          spot = p;
          found = true;
        }
      }
      if (found) break;
    }
    const at = [
      { x: spot.x - 1.6, y: spot.y + 0.4, a: 0 },
      { x: spot.x - 2.6, y: spot.y + 2.2, a: -0.3 },
      { x: spot.x + 1.6, y: spot.y - 0.2, a: Math.PI },
      { x: spot.x + 2.8, y: spot.y + 1.8, a: Math.PI + 0.3 },
    ];
    sim.state.characters.forEach((c, i) => {
      const p = at[i % at.length]!;
      d.teleport(c.id, p, p.a);
      scripted.add(c.slot);
      controllers.set(c.slot, holdCtl({ x: 0, y: 0 }, { x: Math.cos(p.a), y: Math.sin(p.a) }, false));
    });
  }

  // Settle the first tick so poses exist.
  step(1);
}

// ---------------------------------------------------------------------------
// Taunt mock (until the sim plays CharacterState.emote itself)
// ---------------------------------------------------------------------------

const TAUNT_IDS: EmoteId[] = ['wiggle', 'bleh', 'fanCash', 'squatBounce', 'hodadakZoom', 'tongkeunFlex', 'nunchiShrug'];
const mockEvents: SimEvent[] = [];

/** Start taunt `id` on `slot` exactly like the sim will: state + 'emote' event. */
function mockEmote(slot: number, id: EmoteId): void {
  const c = sim.state.characters[slot];
  if (!c) return;
  const tick = sim.state.tick;
  if (c.emote && tick < c.emote.endTick) mockEvents.push({ type: 'emoteCancel', tick, charId: c.id, emoteId: c.emote.id });
  c.emote = { id, startTick: tick, endTick: tick + EMOTE.durationTicks[id] };
  // Nearest opponent in front (same rule as the contract: radius + line of sight).
  let near: EntityId | null = null;
  let best: number = EMOTE.nearOpponentRadius;
  for (const o of sim.state.characters) {
    if (o.team === c.team) continue;
    const dd = Math.hypot(o.pos.x - c.pos.x, o.pos.y - c.pos.y);
    if (dd <= best && sim.lineOfSight(c.pos, o.pos)) {
      best = dd;
      near = o.id;
    }
  }
  mockEvents.push({ type: 'emote', tick, charId: c.id, emoteId: id, nearOpponentId: near });
  view.onEvents(mockEvents.splice(0), sim);
}

function mockCancel(slot: number): void {
  const c = sim.state.characters[slot];
  if (!c || !c.emote) return;
  view.onEvents([{ type: 'emoteCancel', tick: sim.state.tick, charId: c.id, emoteId: c.emote.id }], sim);
  c.emote = null;
}

/** Clear finished mocked taunts (the sim will do this itself). */
function mockTick(): void {
  for (const c of sim.state.characters) if (c.emote && sim.state.tick >= c.emote.endTick) c.emote = null;
}

/** Camera-side face offset of a bank at a 90° step angle (half extent along world y). */
function BANK_FACE_Y(angle: number): number {
  return Math.abs(Math.sin(angle)) > 0.5 ? 4 : 3;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const keys = new Set<string>();
let mouse = { x: innerWidth / 2, y: innerHeight / 2 };
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'Tab') {
    e.preventDefault();
    focusSlot = (focusSlot + 1) % sim.state.characters.length;
  } else if (e.code === 'KeyM') {
    const modes: ViewMode[] = ['match', 'preview', 'title', 'results'];
    view.setMode(modes[(modes.indexOf(view.mode) + 1) % modes.length]!);
  } else if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') {
    settings.quality = (['low', 'medium', 'high'] as const)[Number(e.code.slice(-1)) - 1]!;
    view.applySettings(settings);
  } else if (e.code === 'KeyR') setupScenario(scenario);
  else if (e.code === 'KeyZ' || e.code === 'KeyX' || e.code === 'KeyC' || e.code === 'KeyV') mockEmote(focusSlot, TAUNT_IDS[['KeyZ', 'KeyX', 'KeyC', 'KeyV'].indexOf(e.code)]!);
  else if (e.code === 'Digit5' || e.code === 'Digit6' || e.code === 'Digit7') mockEmote(focusSlot, TAUNT_IDS[Number(e.code.slice(-1)) - 1]!);
  else if (e.code === 'KeyE') {
    const g = view.pickGround(mouse.x, mouse.y);
    if (g) {
      let target: EntityId | null = null;
      for (const l of sim.state.loot) {
        if (l.recovered) continue;
        const r = l.kind === 'bank' ? 4.5 : 1.2;
        if (Math.hypot(l.pos.x - g.x, l.pos.y - g.y) < r) target = l.id;
      }
      pendingPing = { pos: g, targetId: target };
    }
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('mousemove', (e) => (mouse = { x: e.clientX, y: e.clientY }));
addEventListener('blur', () => keys.clear());

function humanCommand(): Command {
  let x = 0;
  let y = 0;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1;
  const l = Math.hypot(x, y) || 1;
  const cmd: Command = { move: { x: x / l, y: y / l }, grab: keys.has('Space') || keys.has('KeyJ'), dash: keys.has('ShiftLeft') || keys.has('ShiftRight') || keys.has('KeyK'), aim: null, ping: pendingPing };
  pendingPing = null;
  return cmd;
}

// ---------------------------------------------------------------------------
// Stepping
// ---------------------------------------------------------------------------

function commands(): (Command | undefined)[] {
  const out: (Command | undefined)[] = [];
  for (const c of sim.state.characters) {
    const ctl = controllers.get(c.slot);
    if (ctl) out[c.slot] = ctl(sim);
    else if (c.slot === focusSlot && keys.size + (pendingPing ? 1 : 0) > 0) out[c.slot] = humanCommand();
    else out[c.slot] = EMPTY_COMMAND;
  }
  for (const b of bots) {
    try {
      out[b.slot] = b.update(sim);
    } catch (err) {
      console.warn('[view-harness] bot update failed', err);
    }
  }
  return out;
}

function step(n = 1, advanceView = true): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    const ev = sim.step(commands());
    mockTick();
    view.captureTick(sim);
    view.onEvents(ev, sim);
    for (const b of bots) {
      const it = b.intent?.();
      if (it) view.setBotTelegraph(sim.state.characters[b.slot]!.id, it.telegraph, it.goal);
    }
    for (const e of ev) {
      eventTypes[e.type] = (eventTypes[e.type] ?? 0) + 1;
      all.push(e);
    }
    eventCount += ev.length;
    if (advanceView) view.advance(sim, 1, 1 / 60, focus());
  }
  return all;
}

function focus(): ViewFocus {
  const c = sim.state.characters[focusSlot]!;
  return {
    charId: c.id,
    grabCandidate: c.grab ? null : sim.getGrabCandidate(c.id),
    pingTargetIds: [],
  };
}

function drawLabels(): void {
  if (!showLabels) return;
  let html = '';
  for (const l of sim.state.loot) {
    if (l.recovered) continue;
    const h = l.kind === 'bank' ? 6 : l.kind === 'largeSafe' ? 1.8 : 1.3;
    const p = view.project(l.pos, h);
    if (p.onScreen) html += `<div class="lbl" style="left:${p.x}px;top:${p.y}px">${l.estimatedValue}</div>`;
  }
  labelsEl.innerHTML = html;
}

function hudText(): string {
  const st = sim.state;
  const s = view.stats();
  const c = st.characters[focusSlot]!;
  return [
    `layout ${layoutId} · scenario ${scenario} · mode ${view.mode} · ${s.quality}`,
    `tick ${st.tick} · score ${st.scores[0]} : ${st.scores[1]} · banks ${st.banksRecovered}/2${st.finalCountdown ? ' · SIREN final' : ''}`,
    `focus slot ${focusSlot} (${c.name}) floor ${c.floorOf ?? '-'} grab ${c.grab ? c.grab.targetId : '-'}${c.straining ? ' straining' : ''}`,
    `draws ${s.drawCalls} · tris ${(s.triangles / 1000).toFixed(0)}k · geo ${s.geometries} · tex ${s.textures} · particles ${s.particles}`,
    `bots ${createBot ? bots.length : 'n/a'} · WASD move · Space grab · Shift dash · E ping · Tab focus · M mode · 1/2/3 quality`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Real-time loop
// ---------------------------------------------------------------------------

let acc = 0;
let last = performance.now();
let hudTimer = 0;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;
  let n = 0;
  while (acc >= 1 / 60 && n < 6) {
    step(1, false);
    acc -= 1 / 60;
    n++;
  }
  if (n === 6) acc = 0;
  view.render(sim, acc * 60, dt, focus());
  drawLabels();
  hudTimer -= dt;
  if (hudTimer <= 0) {
    hud.textContent = hudText();
    hudTimer = 0.25;
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Automation API
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __harness?: HarnessApi;
  }
}

interface HarnessApi {
  readonly sim: Simulation;
  readonly view: GameView;
  ready: boolean;
  scenario(name: string): void;
  /** Step the sim n ticks (view advanced each tick without drawing). Returns event types. */
  step(n: number): string[];
  /** Step until an event of `type` fires (max `limit` ticks); returns ticks stepped or -1. */
  stepUntil(type: string, limit?: number): number;
  /** Advance view animations only (sim paused). */
  advance(seconds: number): void;
  /** Draw one frame and return a PNG data URL of the canvas. */
  capture(): string;
  setMode(mode: ViewMode): void;
  setQuality(q: QualityLevel): void;
  setFocus(slot: number): void;
  project(p: Vec2, h: number): { x: number; y: number; onScreen: boolean };
  stats(): ReturnType<GameView['stats']> & { tick: number; events: Record<string, number> };
  hud(): string;
  /** Load/dispose stress test: returns renderer.info.memory after each of n reloads. */
  reloadCycles(n: number): { geometries: number; textures: number }[];
  /** Mock a taunt on a slot (state + 'emote' event, like the sim will). */
  emote(slot: number, id: EmoteId): void;
  /** Mock a taunt cancel on a slot (state cleared + 'emoteCancel'). */
  cancelEmote(slot: number): void;
  /** Toggle the "show others' taunts" setting. */
  setShowOthers(on: boolean): void;
}

const api: HarnessApi = {
  get sim() {
    return sim;
  },
  view,
  ready: false,
  scenario(name: string) {
    scenario = name;
    setupScenario(name);
  },
  step(n: number) {
    return step(n).map((e) => e.type);
  },
  stepUntil(type: string, limit = 900) {
    for (let i = 1; i <= limit; i++) if (step(1).some((e) => e.type === type)) return i;
    return -1;
  },
  advance(seconds: number) {
    const frames = Math.max(1, Math.round(seconds * 60));
    for (let i = 0; i < frames; i++) view.advance(sim, 1, 1 / 60, focus());
  },
  capture() {
    view.render(sim, 1, 0, focus());
    drawLabels();
    return view.canvas.toDataURL('image/png');
  },
  setMode(mode: ViewMode) {
    view.setMode(mode);
  },
  setQuality(q: QualityLevel) {
    settings.quality = q;
    view.applySettings(settings);
  },
  setFocus(slot: number) {
    focusSlot = slot;
  },
  project(p: Vec2, h: number) {
    return view.project(p, h);
  },
  stats() {
    return { ...view.stats(), tick: sim.state.tick, events: { ...eventTypes } };
  },
  hud: hudText,
  emote(slot: number, id: EmoteId) {
    mockEmote(slot, id);
  },
  cancelEmote(slot: number) {
    mockCancel(slot);
  },
  setShowOthers(on: boolean) {
    settings.showOthersTaunts = on;
    view.applySettings(settings);
  },
  reloadCycles(n: number) {
    const out: { geometries: number; textures: number }[] = [];
    for (let i = 0; i < n; i++) {
      setupScenario(scenario);
      view.render(sim, 1, 1 / 60, focus());
      const m = view.webgl.info.memory;
      out.push({ geometries: m.geometries, textures: m.textures });
    }
    return out;
  },
};
window.__harness = api;

await loadBots();
setupScenario(scenario);
api.ready = true;
if (auto) requestAnimationFrame((t) => {
  last = t;
  frame(t);
});
else {
  view.render(sim, 1, 0, focus());
  hud.textContent = hudText();
}
