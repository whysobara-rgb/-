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
 * Scenarios: start, strain, haul, pullSafe, fence, recover, final, preview, title, results, free
 *
 * Keys: WASD/arrows move, Space grab (hold), Shift dash, E ping at the mouse, Tab next focus,
 *       M cycle view mode, 1/2/3 quality, R reload scenario.
 *
 * window.__harness exposes step / advance / capture / stats for Playwright.
 */
import { Simulation, EMPTY_COMMAND, type Command, type EntityId, type LayoutId, type MatchSetup, type RosterEntry, type SimEvent, type Vec2 } from '../../sim';
import { LAYOUTS } from '../../sim/layouts';
import { GameView, type ViewFocus, type ViewMode, type ViewSettings } from '../view';
import type { QualityLevel } from '../quality';

type Controller = (sim: Simulation) => Command;

interface BotLike {
  readonly slot: number;
  update(sim: Simulation): Command;
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
    const back = { x: b.pos.x, y: b.pos.y - 4.55 };
    if (fence) d.teleport(b.id, { x: fence.center.x, y: fence.center.y - 4 - 1.2 }, b.angle);
    const nb = sim.getLoot(b.id)!;
    d.teleport(charId(0), { x: nb.pos.x - 1.6, y: nb.pos.y - 4.55 }, Math.PI / 2);
    d.teleport(charId(1), { x: nb.pos.x + 1.6, y: nb.pos.y - 4.55 }, Math.PI / 2);
    controllers.set(0, holdCtl({ x: 0, y: 1 }, { x: 0, y: 1 }));
    controllers.set(1, holdCtl({ x: 0, y: 1 }, { x: 0, y: 1 }));
    void back;
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
    d.teleport(charId(0), { x: z0.vanPos.x + 3.2, y: z0.vanPos.y + 6.4 }, -Math.PI / 2);
    d.teleport(charId(1), { x: z0.vanPos.x + 4.6, y: z0.vanPos.y + 6.9 }, -Math.PI / 2);
    scripted.add(0).add(1);
    controllers.set(0, holdCtl({ x: 0, y: 0 }, { x: 0, y: -1 }, false));
    controllers.set(1, holdCtl({ x: 0, y: 0 }, { x: 0, y: -1 }, false));
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
  // Settle the first tick so poses exist.
  step(1);
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
    view.captureTick(sim);
    view.onEvents(ev, sim);
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
