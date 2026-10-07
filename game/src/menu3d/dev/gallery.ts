/**
 * 3D menu gallery (dev only): every live menu scene on the real MenuStage, with draw-call and
 * frame-time stats, optional deterministic stepping for screenshot sequences.
 *
 *   npx vite  ->  /dev/menu3d-gallery.html#title?focus=quickMatch&hud=0&manual=1&lang=en
 *
 * window.__m3d: { ready, stage, show(route), step(seconds, frames), stats(), act(name) }
 */
import { preloadModelFonts } from '../../render/models';
import { createUiRoot, fontsReady, setLanguage } from '../../ui';
import { getLayout } from '../../sim/layouts';
import type { LayoutId } from '../../sim/types';
import { MenuStage } from '../stage';
import type { MenuScene } from '../scene';
import { TitleScene } from '../scenes/title';
import { HideoutScene, type HideoutFocus, type HideoutFraming } from '../scenes/hideout';
import { PreviewScene } from '../scenes/preview';
import { TournamentScene, type StageRival, type StageState } from '../scenes/tournament';
import { WardrobeScene } from '../scenes/wardrobe';
import type { HatId } from '../../sim/types';
import { policeEntriesFor } from '../../sim';

interface Route {
  name: string;
  q: URLSearchParams;
}

function parse(): Route {
  const raw = location.hash.replace(/^#/, '') || 'title';
  const [name, query = ''] = raw.split('?');
  return { name: name || 'title', q: new URLSearchParams(query) };
}

type Factory = (q: URLSearchParams) => MenuScene;

export const FACTORIES: Record<string, Factory> = {
  title: () => new TitleScene({ hat: 'teamCapA' }),
  preview: (q) => {
    const layout = getLayout((q.get('layout') as LayoutId) ?? 'plaza');
    return new PreviewScene({ layout, police: q.get('police') !== '0', policeEntries: policeEntriesFor(layout), myTeam: 0 });
  },
  tournament: (q) => {
    const st = (q.get('states') ?? 'cleared,inProgress,locked').split(',') as StageState[];
    return new TournamentScene({
      rivals: (['hodadak', 'tongkeun', 'nunchi'] as StageRival[]).map((rival, i) => ({ rival, state: st[i] ?? 'available' })),
      focus: (q.get('focus') as StageRival) ?? 'tongkeun',
      closeup: (q.get('closeup') as StageRival) ?? null,
    });
  },
  wardrobe: (q) => {
    const s = new WardrobeScene({ hat: 'teamCapA', team: 0 });
    const hat = q.get('hat') as HatId | null;
    if (hat) s.showHat(hat, q.get('locked') !== '1');
    return s;
  },
  hideout: (q) => {
    const s = new HideoutScene({ hat: 'teamCapA', framing: (q.get('framing') as HideoutFraming) ?? 'menu' });
    s.setFocus((q.get('focus') as HideoutFocus) ?? 'quickMatch');
    return s;
  },
};

const hudEl = document.getElementById('m3d-hud')!;
const navEl = document.getElementById('m3d-nav')!;

async function main(): Promise<void> {
  const r0 = parse();
  setLanguage(r0.q.get('lang') === 'en' ? 'en' : 'ko');
  const app = document.getElementById('app')!;
  const ui = createUiRoot(app);
  await Promise.race([Promise.all([fontsReady(), preloadModelFonts().catch(() => false)]), new Promise((r) => setTimeout(r, 4000))]);
  const stage = new MenuStage(app, ui.el, { quality: (r0.q.get('quality') as 'low' | 'medium' | 'high') ?? 'medium', reducedMotion: r0.q.get('rm') === '1' });
  const manual = r0.q.get('manual') === '1';
  hudEl.hidden = r0.q.get('hud') === '0';
  navEl.hidden = r0.q.get('hud') === '0';
  for (const k of Object.keys(FACTORIES)) {
    const a = document.createElement('a');
    a.href = `#${k}`;
    a.textContent = k;
    navEl.appendChild(a);
  }

  const show = (): void => {
    const r = parse();
    const f = FACTORIES[r.name] ?? FACTORIES.title!;
    const s = stage.setScene(f(r.q));
    void s;
  };
  show();
  window.addEventListener('hashchange', show);

  let last = performance.now();
  let frames = 0;
  const loop = (now: number): void => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!manual) stage.frame(dt);
    if (++frames % 15 === 0) {
      const s = stage.stats();
      hudEl.textContent = `${s.scene}  calls ${s.drawCalls}  tris ${s.triangles.toLocaleString()}  batched ${s.batched}  ${s.frameMs.toFixed(1)} ms`;
    }
  };
  requestAnimationFrame(loop);

  (window as unknown as { __m3d: unknown }).__m3d = {
    ready: true,
    stage,
    layout: (id: LayoutId) => getLayout(id),
    show(route: string) {
      location.hash = route;
      show();
    },
    /** Advance the scene `seconds` in `frames` equal steps, drawing the last one. */
    step(seconds: number, frames = 1) {
      const n = Math.max(1, frames);
      for (let i = 0; i < n; i++) stage.frame(seconds / n);
      return stage.stats();
    },
    stats: () => stage.stats(),
    scene: () => stage.scene,
  };
  document.body.dataset.ready = '1';
}

void main();
