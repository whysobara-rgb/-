/**
 * [C8] Dev harness for the Content 2.0 HUD (dev only, not shipped): the real Hud on top of a real
 * v2 Simulation (plaza / shortcut / counter), with scripted scenes for screenshots and a live
 * mode where a tiny scripted driver plays the human slot (grabs the supply-drop hammer, smashes
 * crates with it, scoops coins, deposits at the van) against a real bot.
 *
 *   npx vite --port 5131 --strictPort  ->  http://127.0.0.1:5131/dev/hud-content.html?scene=item
 *
 * URL: scene=item|carry|deposit|drop|spill|gold|live  layout=plaza|shortcut|counter
 *      view=1 (real 3D GameView behind the HUD; slow on software GL) lang=en  rm=1  speed=N
 * window.__hud: { scene(name), run(seconds), frame(), model(), ready }.
 * Sets document.body.dataset.ready = '1' when the scene is staged and painted.
 */
import { Simulation, type CharacterState, type Command, type LayoutId, type SimEvent, type Vec2 } from '../../../sim';
import { COINS, ITEMS, ITEM_FOREVER, TICK_RATE } from '../../../sim/config';
import type { SimContext } from '../../../sim/context';
import { LAYOUTS } from '../../../sim/layouts';
import { createUiRoot, fontsReady, Hud, setLanguage } from '../../index';
import { hudModelFromSim, type Projector } from '../adapters';
import { drawBackground, drawLayoutBase, fitTransform, setupCanvas, type MapTransform } from '../mapDraw';
import type { HudModel } from '../types';
import type { GameView } from '../../../render/view';

const q = new URLSearchParams(location.search);
const layoutId = (['plaza', 'shortcut', 'counter'].includes(q.get('layout') ?? '') ? q.get('layout') : 'plaza') as LayoutId;
let sceneName = q.get('scene') ?? 'item';
const useView = q.get('view') === '1';
const speed = Math.max(0.25, Math.min(8, Number(q.get('speed') ?? '1') || 1));
setLanguage(q.get('lang') === 'en' ? 'en' : 'ko');

const sceneEl = document.getElementById('scene')!;
const info = document.getElementById('dev-info')!;
const root = createUiRoot(document.getElementById('app')!);
root.setReducedMotion(q.get('rm') === '1');
const hud = new Hud(root);
// dev page: never touch the player's save (first-sighting tags always on here)
hud.content.setItemSightings(() => true);

let sim!: Simulation;
let view: GameView | null = null;
let canvas: HTMLCanvasElement | null = null;
let tf: MapTransform | null = null;
let override: ((m: HudModel) => void) | null = null;
const idle: Command = { move: { x: 0, y: 0 }, grab: false, dash: false };

const ctxOf = (s: Simulation): SimContext => (s as unknown as { ctx: SimContext }).ctx;
const me = (): CharacterState => sim.state.characters[0]!;

function newSim(): void {
  sim = new Simulation({
    layout: LAYOUTS[layoutId],
    seed: 21,
    roster: [
      { team: 0, isBot: false, name: '나', look: { hat: 'teamCapA' } },
      { team: 1, isBot: true, name: '호다닥', look: { hat: 'hodadakBand', rival: 'hodadak' } },
    ],
    rules: { content: 'v2', police: false },
  });
  hud.reset();
  hud.setLayout(sim.layout);
  hud.setTeamLabels(null);
  hud.show();
  view?.load(sim);
  view?.setMode('match');
  override = null;
}

function teleport(slot: number, p: Vec2, facing = 0): void {
  sim.debug.teleport(sim.state.characters[slot]!.id, p, facing);
  view?.captureTick(sim);
  view?.captureTick(sim);
}

function step(n: number, cmds: (s: Simulation) => Command[] = () => [idle, idle]): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    all.push(...sim.step(cmds(sim)));
    view?.captureTick(sim);
  }
  if (all.length && view) view.onEvents(all, sim);
  return all;
}

const nearest = <T>(list: readonly T[], pos: (t: T) => Vec2, from: Vec2): T | null => {
  let best: T | null = null;
  let bd = Infinity;
  for (const t of list) {
    const p = pos(t);
    const d = (p.x - from.x) ** 2 + (p.y - from.y) ** 2;
    if (d < bd) {
      bd = d;
      best = t;
    }
  }
  return best;
};

// ---------------------------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------------------------

function hammer(kind: 'hammer' | 'goldHammer', uses: number, lifeFrac: number): void {
  const spec = ITEMS.specs[kind];
  me().item = { kind, uses, expiresTick: kind === 'goldHammer' ? ITEM_FOREVER : sim.state.tick + Math.round(spec.lifetimeTicks * lifeFrac), cooldown: 0, phase: 'idle', phaseTicks: 0, aim: 0 };
}

function stage(name: string): void {
  sceneName = name;
  newSim();
  const st = sim.state;
  const zone = sim.layout.zones.find((z) => z.team === 0)!;
  switch (name) {
    case 'item': {
      // next to an ATM, a crate within reach, hammer 3/5 with ~60 % life, a few coins in the bag
      step(30);
      const atm = nearest(st.loot.filter((l) => l.variant === 'atm'), (l) => l.pos, zone.center)!;
      teleport(0, { x: atm.pos.x + (atm.pos.x < sim.layout.size.x / 2 ? 2.4 : -2.4), y: atm.pos.y - 1.2 }, Math.PI);
      step(2);
      hammer('hammer', 3, 0.6);
      me().bag = 40;
      break;
    }
    case 'carry': {
      // carrying (stowed hammer badge, normal dash label) with a bag
      step(30);
      const safe = nearest(st.loot.filter((l) => l.kind === 'smallSafe' && !l.loadedIn && !l.variant), (l) => l.pos, zone.center)!;
      teleport(0, { x: safe.pos.x, y: safe.pos.y + 1.1 }, -Math.PI / 2);
      step(1);
      for (let i = 0; i < 90 && !me().grab; i++) step(1, () => [{ ...idle, grab: true, aim: { x: safe.pos.x - me().pos.x, y: safe.pos.y - me().pos.y } }, idle]);
      step(70, () => [{ ...idle, grab: true }, idle]);
      hammer('hammer', 4, 0.8);
      me().bag = 120;
      break;
    }
    case 'deposit': {
      step(30);
      teleport(0, { x: zone.center.x, y: zone.center.y });
      step(2);
      me().bag = 130;
      me().depositTicks = Math.round(COINS.depositTicks * 0.6);
      break;
    }
    case 'drop': {
      // the first supply pair is announced (incoming tag), the player stands near the west pad
      const pads = sim.layout.v2!.itemPads;
      const pad = nearest(pads.filter((p) => p.twin !== null), (p) => p.pos, zone.center)!;
      teleport(0, { x: pad.pos.x + 2.5, y: pad.pos.y + 2.5 });
      const land = Math.round(ITEMS.drop.pairs[0]! * TICK_RATE);
      step(land - Math.round(1.6 * TICK_RATE));
      break;
    }
    case 'spill': {
      // a knockdown spilled the bag: piles fanned out (minimap coin density), bag chip "와르르!"
      step(30);
      const c = sim.layout.size;
      teleport(0, { x: c.x * 0.38, y: c.y * 0.5 });
      step(2);
      me().bag = 200;
      paint(performance.now());
      ctxOf(sim).content!.coins.spillBag(me().id, 'dash', st.characters[1]!.id, 0.4);
      ctxOf(sim).content!.coins.spawnCoins({ pos: { x: c.x * 0.6, y: c.y * 0.35 }, dir: 0, values: [50, 50, 10, 10, 10, 10, 50, 10], pattern: 'radial', source: 'smash', sourceId: null, byCharId: null });
      step(20);
      break;
    }
    case 'gold': {
      step(30);
      const axisPad = sim.layout.v2!.itemPads.find((p) => p.twin === null)!;
      teleport(0, { x: axisPad.pos.x - 3, y: axisPad.pos.y + 1 });
      step(2);
      hammer('goldHammer', 8, 1);
      break;
    }
    case 'live':
    default:
      break;
  }
}

// ---------------------------------------------------------------------------------------------
// Live driver: a tiny scripted human stand-in (no pathfinding; plaza is open enough for a demo)
// ---------------------------------------------------------------------------------------------

function drive(s: Simulation): Command {
  const st = s.state;
  const c = st.characters[0]!;
  const zone = s.layout.zones.find((z) => z.team === 0)!;
  const go = (p: Vec2, dash = false): Command => {
    const dx = p.x - c.pos.x;
    const dy = p.y - c.pos.y;
    const d = Math.hypot(dx, dy) || 1;
    return { move: { x: dx / d, y: dy / d }, grab: false, dash, aim: { x: dx, y: dy } };
  };
  const dist = (p: Vec2): number => Math.hypot(p.x - c.pos.x, p.y - c.pos.y);
  if ((c.bag ?? 0) >= 60) return go(zone.center);
  if (!c.item) {
    const it = nearest(st.items.filter((i) => i.phase === 'ground'), (i) => i.pos, c.pos);
    if (it && dist(it.pos) < 30) return go(it.pos);
  }
  const pile = nearest(st.coins, (p) => p.pos, c.pos);
  if (pile && dist(pile.pos) < 9) return go(pile.pos);
  const br = nearest(st.breakables.filter((b) => !b.broken), (b) => b.center, c.pos);
  if (br) {
    const d = dist(br.center);
    return go(br.center, d < (c.item ? 1.9 : 2.6) && (st.tick % 20) < 10);
  }
  const atm = nearest(st.loot.filter((l) => l.variant === 'atm' && !l.recovered), (l) => l.pos, c.pos);
  if (atm) return go(atm.pos, dist(atm.pos) < 2 && (st.tick % 30) < 15);
  return idle;
}

let botCmd: ((s: Simulation) => Command) | null = null;
async function loadBot(): Promise<void> {
  try {
    const ai = await import('../../../ai');
    const bot = ai.createBot(sim, { slot: 1, personality: 'hodadak', difficulty: 'normal', seed: 5 });
    botCmd = (s) => bot.update(s);
  } catch (err) {
    console.warn('[hud-content] bot unavailable', err);
  }
}

// ---------------------------------------------------------------------------------------------
// Backdrop + HUD
// ---------------------------------------------------------------------------------------------

function projector(): Projector {
  if (view) return (p, h) => view!.project(p, h);
  return (p, h) => (tf ? { x: tf.ox + p.x * tf.scale, y: tf.oy + p.y * tf.scale - h * tf.scale * 0.7, onScreen: true } : { x: NaN, y: NaN, onScreen: false });
}

function drawBackdrop(): void {
  if (!canvas) return;
  const w = window.innerWidth;
  const hgt = window.innerHeight;
  const ctx = setupCanvas(canvas, w, hgt);
  if (!ctx) return;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${hgt}px`;
  drawBackground(ctx, w, hgt, 'paper', 0);
  tf = fitTransform(sim.layout.size, w, hgt, 30);
  drawLayoutBase(ctx, sim.layout, tf, { theme: 'paper', brokenFences: new Set(sim.state.fences.filter((f) => f.broken).map((f) => f.id)) });
  const s = tf.scale;
  const P = (p: Vec2): Vec2 => ({ x: tf!.ox + p.x * s, y: tf!.oy + p.y * s });
  for (const b of sim.state.breakables) {
    if (b.broken) continue;
    const c = P(b.center);
    ctx.fillStyle = b.kind === 'crate' ? '#E8B07A' : '#FF8FB8';
    ctx.fillRect(c.x - b.half.x * s, c.y - b.half.y * s, b.half.x * 2 * s, b.half.y * 2 * s);
  }
  for (const l of sim.state.loot) {
    if (l.recovered || l.dormant) continue;
    const c = P(l.pos);
    ctx.fillStyle = l.kind === 'bank' ? 'rgba(242,193,78,0.6)' : l.variant ? '#4FD6A6' : l.kind === 'smallSafe' ? '#7FB77E' : '#5B6BBF';
    const r = l.kind === 'bank' ? 4 * s : 0.6 * s;
    ctx.fillRect(c.x - r, c.y - r * 0.7, r * 2, r * 1.4);
  }
  for (const p of sim.state.coins) {
    const c = P(p.pos);
    ctx.beginPath();
    ctx.arc(c.x, c.y, p.value === 50 ? 4 : 2.5, 0, Math.PI * 2);
    ctx.fillStyle = p.value === 50 ? '#7FD08A' : '#FFD23F';
    ctx.fill();
  }
  for (const it of sim.state.items) {
    const c = P(it.pos);
    ctx.beginPath();
    ctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = it.phase === 'incoming' ? 'rgba(142,108,240,0.4)' : '#8E6CF0';
    ctx.fill();
  }
  for (const ch of sim.state.characters) {
    const c = P(ch.pos);
    ctx.beginPath();
    ctx.arc(c.x, c.y, 0.5 * s, 0, Math.PI * 2);
    ctx.fillStyle = ch.team === 0 ? '#FF8A3D' : '#3D8BFF';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#2E2442';
    ctx.stroke();
  }
}

let lastModel: HudModel | null = null;
function paint(now: number): void {
  if (view) view.render(sim, 1, 1 / 60, { charId: me().id, grabCandidate: null, pingTargetIds: [] });
  else drawBackdrop();
  const m = hudModelFromSim(sim, { meId: me().id, myTeam: 0, project: projector(), nearRadius: 7 });
  override?.(m);
  lastModel = m;
  hud.update(m);
  void now;
  const c = me();
  info.textContent = `scene=${sceneName} t=${(sim.state.tick / TICK_RATE).toFixed(1)}s bag=${c.bag ?? 0} item=${c.item ? `${c.item.kind} ${c.item.uses}` : '-'} score=${sim.state.scores.join(':')} coins=${sim.state.coins.length}`;
}

let running = sceneName === 'live';
let acc = 0;
let last = performance.now();
function loop(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (running) {
    acc += dt * speed;
    let n = 0;
    while (acc >= 1 / TICK_RATE && n < 16) {
      acc -= 1 / TICK_RATE;
      step(1, (s) => [drive(s), botCmd ? botCmd(s) : idle]);
      n++;
    }
  }
  paint(now);
  requestAnimationFrame(loop);
}

async function main(): Promise<void> {
  if (useView) {
    const { GameView } = await import('../../../render/view');
    view = new GameView(sceneEl, { quality: 'low', screenShake: 0, reducedMotion: true, language: q.get('lang') === 'en' ? 'en' : 'ko' });
  } else {
    canvas = document.createElement('canvas');
    sceneEl.appendChild(canvas);
  }
  stage(sceneName);
  if (sceneName === 'live') await loadBot();
  await fontsReady();
  paint(performance.now());
  requestAnimationFrame(() => requestAnimationFrame(() => {
    paint(performance.now());
    document.body.dataset.ready = '1';
  }));
  requestAnimationFrame(loop);
}

(window as unknown as { __hud: unknown }).__hud = {
  scene: (name: string) => {
    running = name === 'live';
    stage(name);
    if (name === 'live' && !botCmd) void loadBot();
  },
  run: (seconds: number) => step(Math.round(seconds * TICK_RATE), (s) => [drive(s), botCmd ? botCmd(s) : idle]),
  frame: () => paint(performance.now()),
  model: () => lastModel,
  sim: () => sim,
  setRunning: (on: boolean) => (running = on),
};

void main();
