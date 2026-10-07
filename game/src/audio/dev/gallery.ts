/**
 * Audio gallery (dev only): every SFX with each variation, every loop with live intensity,
 * every music track with intensity, volume sliders, a spatial pad, a peak/RMS meter and the
 * caption stream.
 *
 *   npx vite --port 5183 --strictPort  ->  http://127.0.0.1:5183/dev/audio-gallery.html
 *
 * QA hooks for headless renders (Playwright): `window.audioQA` renders through the exact
 * production graph with OfflineAudioContext and returns base64 WAV data.
 */
import { AudioEngine, type CaptionEvent } from '../audio';
import { MatchAudioDirector, POLICE_AUDIO, STRAIN_PITCH } from '../director';
import { renderDirectedScene } from './directorRender';
import { SCENES, type SceneId, type ScriptedScene } from './scenes';
import { captionText } from '../captions';
import { LOOP_IDS, SFX_IDS, TRACK_IDS, type LoopId, type MusicId, type SfxId, type TrackId } from '../ids';
import { DEFAULT_VOLUMES, type Volumes } from '../mixer';
import { encodeWav, renderLoop, renderMusic, renderScene, renderSfx, type SceneOptions } from '../offline';
import { SFX_RECIPES } from '../sfx';
import { SPATIAL } from '../spatial';

const engine = new AudioEngine();
const app = document.getElementById('app')!;
const unlockBtn = document.getElementById('unlock') as HTMLButtonElement;
const meterEl = document.getElementById('meter')!;

let lang: 'ko' | 'en' = 'ko';
let soundPos: { x: number; y: number } | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const k of kids) e.append(k);
  return e;
}

function section(title: string, ...kids: Node[]): HTMLElement {
  return el('section', {}, el('h2', {}, title), ...kids);
}

interface Slider {
  el: HTMLElement;
  set(v: number): void;
}

function slider(label: string, value: number, onInput: (v: number) => void, mark?: number): Slider {
  const input = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(value) });
  const out = el('span', {}, value.toFixed(2));
  if (mark !== undefined) input.title = `default ${mark.toFixed(2)}`;
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = v.toFixed(2);
    onInput(v);
  });
  return {
    el: el('label', { class: 'slider' }, el('span', {}, label), input, out),
    set(v: number): void {
      input.value = String(v);
      out.textContent = v.toFixed(2);
    },
  };
}

async function ensureUnlocked(): Promise<void> {
  await engine.unlock();
  if (engine.unlocked) {
    unlockBtn.textContent = 'Audio running';
    unlockBtn.classList.add('ready');
  }
}
unlockBtn.addEventListener('click', () => void ensureUnlocked());
window.addEventListener('pointerdown', () => void ensureUnlocked(), { once: true });

// ---- captions --------------------------------------------------------------------------------
const captionBox = el('div', { id: 'captions' });
engine.setCaptionListener((e: CaptionEvent) => {
  const arrow = e.side === 'left' ? '◀ ' : e.side === 'right' ? ' ▶' : '';
  const line = el('div', {}, e.side === 'left' ? arrow + captionText(e.key, lang) : captionText(e.key, lang) + arrow);
  captionBox.prepend(line);
  while (captionBox.childElementCount > 5) captionBox.lastElementChild?.remove();
});

// ---- volumes ---------------------------------------------------------------------------------
// Start at the shipped defaults: that is the calibrated mix a new player hears.
const VOL_KEYS = ['master', 'music', 'sfx', 'ui'] as const;
const vols: Volumes = { ...DEFAULT_VOLUMES };
engine.setVolumes(vols);
const volSliders = VOL_KEYS.map((k) =>
  slider(
    k,
    vols[k],
    (v) => {
      vols[k] = v;
      engine.setVolumes(vols);
    },
    DEFAULT_VOLUMES[k],
  ),
);
function applyVolumes(v: Volumes): void {
  Object.assign(vols, v);
  VOL_KEYS.forEach((k, i) => volSliders[i].set(vols[k]));
  engine.setVolumes(vols);
}
const defaultsBtn = el('button', {}, 'Defaults');
defaultsBtn.addEventListener('click', () => applyVolumes({ ...DEFAULT_VOLUMES }));
const fullBtn = el('button', {}, 'All 1.0');
fullBtn.addEventListener('click', () => applyVolumes({ master: 1, music: 1, sfx: 1, ui: 1 }));
const volSection = section(
  'Volumes (start at the shipped defaults)',
  ...volSliders.map((x) => x.el),
  el('div', { class: 'row' }, defaultsBtn, fullBtn),
  el('div', { class: 'row' }),
);
const muffleBtn = el('button', {}, 'Pause muffle');
let muffled = false;
muffleBtn.addEventListener('click', () => {
  muffled = !muffled;
  muffleBtn.classList.toggle('on', muffled);
  engine.setMuffled(muffled);
});
const langBtn = el('button', {}, 'Captions: 한국어');
langBtn.addEventListener('click', () => {
  lang = lang === 'ko' ? 'en' : 'ko';
  langBtn.textContent = lang === 'ko' ? 'Captions: 한국어' : 'Captions: English';
});
volSection.lastElementChild!.append(muffleBtn, langBtn);

// ---- spatial pad -----------------------------------------------------------------------------
const pad = el('canvas', { id: 'pad', width: '640', height: '400' });
const PAD_RANGE = 44; // meters from center to the horizontal edge
function drawPad(): void {
  const g = pad.getContext('2d')!;
  const w = pad.width;
  const h = pad.height;
  const sx = w / (2 * PAD_RANGE);
  g.clearRect(0, 0, w, h);
  g.strokeStyle = '#3c3170';
  for (const r of [SPATIAL.refDistance, SPATIAL.fadeStart, SPATIAL.maxDistance]) {
    g.beginPath();
    g.arc(w / 2, h / 2, r * sx, 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = '#ffd66b';
  g.beginPath();
  g.arc(w / 2, h / 2, 7, 0, Math.PI * 2);
  g.fill();
  if (soundPos) {
    g.fillStyle = '#9effc8';
    g.beginPath();
    g.arc(w / 2 + soundPos.x * sx, h / 2 + soundPos.y * sx, 6, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#b9add9';
  g.font = '12px monospace';
  g.fillText(soundPos ? `sound at (${soundPos.x.toFixed(1)}, ${soundPos.y.toFixed(1)}) m` : 'centered (click to place, right-click to clear)', 8, h - 10);
}
pad.addEventListener('click', (ev) => {
  const r = pad.getBoundingClientRect();
  const sx = (2 * PAD_RANGE) / r.width;
  soundPos = { x: (ev.clientX - r.left - r.width / 2) * sx, y: (ev.clientY - r.top - r.height / 2) * sx };
  drawPad();
});
pad.addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  soundPos = null;
  drawPad();
});
drawPad();
const padSection = section('Spatial (listener at center; rings = 6 m / 24 m / 40 m)', pad, captionBox);

// ---- SFX -------------------------------------------------------------------------------------
let comboStep = 0;
let rivalFlavor = false;
/** Per-id play options the game uses (size pitches, combo, rival flavor of the callouts). */
function playOpts(id: SfxId): { step: number; pitch: number } {
  if (id.startsWith('score')) return { step: comboStep, pitch: 1 };
  if (id.startsWith('callout')) return { step: rivalFlavor ? -1 : 0, pitch: 1 };
  if (id === 'uprootLand') return { step: 0, pitch: sizeIsLarge ? 0.85 : 1.15 };
  if (id === 'unanchorSafe') return { step: 0, pitch: sizeIsLarge ? 0.85 : 1 };
  return { step: 0, pitch: 1 };
}
let sizeIsLarge = false;
const NEW_SFX = new Set<SfxId>([
  'uprootLand', 'bankLand', 'calloutUproot', 'calloutBank', 'calloutSteal', 'calloutDodge', 'policeSkid', 'carDoor', 'carVroom',
  'policeWhistle', 'policeBark', 'tackleWhoosh', 'tackleHit', 'tackleMiss', 'policeStun', 'policePhew', 'unanchorSafe', 'unanchorBank',
]);
const sfxRows = SFX_IDS.map((id) => {
  const r = SFX_RECIPES[id];
  const play = el('button', {}, '▶ random');
  play.addEventListener('click', () => {
    void ensureUnlocked().then(() => {
      engine.play(id, { pos: soundPos ?? undefined, ...playOpts(id) });
    });
  });
  const variants = Array.from({ length: r.variants }, (_, k) => {
    const b = el('button', { class: 'small' }, `v${k}`);
    b.addEventListener('click', () => void ensureUnlocked().then(() => engine.play(id, { pos: soundPos ?? undefined, variant: k, ...playOpts(id) })));
    return b;
  });
  const name = el('span', { class: 'name' }, id);
  if (NEW_SFX.has(id)) name.classList.add('new');
  return el('div', { class: 'sfx' }, name, el('div', { class: 'row' }, play, ...variants, el('span', { class: 'hint' }, r.bus)));
});
const comboBtn = el('button', {}, 'combo step: 0');
comboBtn.addEventListener('click', () => {
  comboStep = (comboStep + 1) % 7;
  comboBtn.textContent = `combo step: ${comboStep}`;
});
const rivalBtn = el('button', {}, 'callouts: own team');
rivalBtn.addEventListener('click', () => {
  rivalFlavor = !rivalFlavor;
  rivalBtn.classList.toggle('on', rivalFlavor);
  rivalBtn.textContent = rivalFlavor ? 'callouts: rival flavor' : 'callouts: own team';
});
const sizeBtn = el('button', {}, 'safe size: small');
sizeBtn.addEventListener('click', () => {
  sizeIsLarge = !sizeIsLarge;
  sizeBtn.textContent = sizeIsLarge ? 'safe size: large' : 'safe size: small';
});
const sfxSection = section(
  'Sound effects',
  el(
    'div',
    { class: 'row' },
    comboBtn,
    rivalBtn,
    sizeBtn,
    el('span', { class: 'hint' }, 'score sounds climb the scale per step; callouts have an own-team and a rival flavor; highlighted = police / presentation sounds'),
  ),
  el('div', { class: 'sfx-list' }, ...sfxRows),
);
sfxSection.classList.add('wide');

// ---- loops -----------------------------------------------------------------------------------
const loopLevels = Object.fromEntries(LOOP_IDS.map((id) => [id, 0])) as Record<LoopId, number>;
let loopPitch = 1;
const loopSection = section(
  'Loops (intensity)',
  ...LOOP_IDS.map(
    (id) =>
      slider(id, 0, (v) => {
        loopLevels[id] = v;
        void ensureUnlocked();
      }).el,
  ),
  slider('pitch', 0.5, (v) => {
    loopPitch = 0.55 + 0.9 * v;
  }).el,
  el(
    'p',
    { class: 'hint' },
    `Loops follow the spatial pad position. Drag the strain slider up slowly to hear the build-up (creak and groan rise in pitch and grit, roots quiver and snap past 40 %, the ground shakes past 80 %); pitch = size (small ${STRAIN_PITCH.smallSafe}, large ${STRAIN_PITCH.largeSafe}, bank ${STRAIN_PITCH.bank} ≈ slider ${((STRAIN_PITCH.bank - 0.55) / 0.9).toFixed(2)}). policeSiren: pitch = doppler (±${POLICE_AUDIO.dopplerMaxBend * 100} %). The getaway siren phrases with the music playing (one wail per 4 bars); above 0.8 the gaps fill in.`,
  ),
);
function tickLoops(): void {
  if (!sceneRunning) for (const id of LOOP_IDS) engine.setLoop(id, loopLevels[id], soundPos ?? undefined, 'gallery', loopPitch);
  requestAnimationFrame(tickLoops);
}
requestAnimationFrame(tickLoops);

// ---- scenes (the real director on a scripted match) -----------------------------------------
let sceneRunning = false;
let sceneStop: (() => void) | null = null;
const sceneStatus = el('span', { class: 'hint' }, 'idle');
function runScene(id: SceneId): void {
  sceneStop?.();
  void ensureUnlocked().then(() => {
    const scene: ScriptedScene = SCENES[id]();
    const director = new MatchAudioDirector(engine, { localTeam: 0, listenerCharId: scene.listenerId });
    if (engine.currentMusic === 'none') {
      engine.setMusicIntensity(0.4);
      engine.playMusic('match');
      for (const [k, x] of musicBtns) x.classList.toggle('on', k === 'match');
    }
    sceneRunning = true;
    let acc = 0;
    let ticks = 0;
    let last = performance.now();
    let raf = 0;
    const total = Math.round(scene.seconds * 60);
    const stop = (): void => {
      cancelAnimationFrame(raf);
      director.stop();
      sceneRunning = false;
      sceneStop = null;
      sceneStatus.textContent = 'idle';
    };
    sceneStop = stop;
    const frame = (): void => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      acc += dt;
      while (acc >= 1 / 60 && ticks < total) {
        acc -= 1 / 60;
        ticks++;
        const ev = scene.step();
        if (ev.length) director.onEvents(ev, scene.view);
      }
      director.update(scene.view, dt);
      sceneStatus.textContent = `${scene.name}: ${(ticks / 60).toFixed(1)} / ${scene.seconds} s`;
      if (ticks >= total) {
        stop();
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  });
}
const chaseBtn = el('button', {}, '▶ Police chase (20 s)');
chaseBtn.addEventListener('click', () => runScene('policeChase'));
const uprootBtn = el('button', {}, '▶ Uproot: small, large, bank (13 s)');
uprootBtn.addEventListener('click', () => runScene('uproot'));
const stopSceneBtn = el('button', {}, '■ Stop');
stopSceneBtn.addEventListener('click', () => sceneStop?.());
const sceneSection = section(
  'Scenes (the real MatchAudioDirector on a scripted match)',
  el('div', { class: 'row' }, chaseBtn, uprootBtn, stopSceneBtn),
  sceneStatus,
  el(
    'p',
    { class: 'hint' },
    'Police chase: the car drives in with its two-tone siren (doppler), skids, doors; officers whistle and shout "멈춰!", the chase layer joins the music, a bank alarm rings nearby; coins stay clear (sirens and bells duck under scoring), a dodged tackle, a dash stuns an officer, a tackle lands (music ducks), a steal, the car leaves ("phew"). Uproot: strain build-up -> POP -> landing -> callout for each size; the bank ends with its alarm.',
  ),
);

// ---- music -----------------------------------------------------------------------------------
const musicBtns = new Map<MusicId, HTMLButtonElement>();
const musicRow = el('div', { class: 'row' });
for (const id of [...TRACK_IDS, 'none'] as MusicId[]) {
  const b = el('button', {}, id);
  b.addEventListener('click', () => {
    void ensureUnlocked().then(() => {
      engine.playMusic(id);
      for (const [k, x] of musicBtns) x.classList.toggle('on', k === id && id !== 'none');
    });
  });
  musicBtns.set(id, b);
  musicRow.append(b);
}
const musicSection = section(
  'Music',
  musicRow,
  slider('intensity', 0.5, (v) => engine.setMusicIntensity(v)).el,
  slider('chase', 0, (v) => engine.setMusicTension(v)).el,
  el(
    'p',
    { class: 'hint' },
    "'match' layers: base (bass, clav, shaker) → drums ≥0.1 → lead ≥0.35 → extra ≥0.65. 'chase' = the police tension layer (low toms + pizzicato ostinato) while officers are on the field. Tonal SFX are tuned to the track key.",
  ),
);
engine.setMusicIntensity(0.5);

app.append(volSection, musicSection, sceneSection, padSection, loopSection, sfxSection);

// ---- meter -----------------------------------------------------------------------------------
let analyser: AnalyserNode | null = null;
let buf: Float32Array<ArrayBuffer> | null = null;
let peakHold = -Infinity;
function meter(): void {
  const ctx = engine.context;
  const out = engine.outputNode;
  if (ctx && out && !analyser) {
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    out.connect(analyser);
    buf = new Float32Array(analyser.fftSize);
  }
  if (analyser && buf) {
    analyser.getFloatTimeDomainData(buf);
    let pk = 0;
    let s = 0;
    for (const x of buf) {
      pk = Math.max(pk, Math.abs(x));
      s += x * x;
    }
    const db = (x: number): string => (x > 0 ? (20 * Math.log10(x)).toFixed(1) : '-inf');
    peakHold = Math.max(peakHold - 0.15, pk > 0 ? 20 * Math.log10(pk) : -120);
    const st = engine.stats();
    meterEl.textContent = `peak ${db(pk)} dBFS (hold ${peakHold.toFixed(1)}) · rms ${db(Math.sqrt(s / buf.length))} dBFS · voices ${st.voices} · loops ${st.loops} · music ${st.music}`;
  }
  requestAnimationFrame(meter);
}
requestAnimationFrame(meter);

// ---- QA hooks (headless offline renders) --------------------------------------------------------
function toBase64(ab: ArrayBuffer): string {
  const bytes = new Uint8Array(ab);
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}

const qa = {
  sfxIds: SFX_IDS as readonly SfxId[],
  loopIds: LOOP_IDS as readonly LoopId[],
  trackIds: TRACK_IDS as readonly TrackId[],
  recipes: Object.fromEntries(SFX_IDS.map((id) => [id, { variants: SFX_RECIPES[id].variants, bus: SFX_RECIPES[id].bus, length: SFX_RECIPES[id].length }])),
  async renderSfx(
    id: SfxId,
    variant = 0,
    seed = 1,
    extra: { step?: number; pitch?: number; pos?: { x: number; y: number }; volumes?: Volumes } = {},
  ): Promise<string> {
    return toBase64(encodeWav(await renderSfx(id, { variant, seed, ...extra }), 32));
  },
  async renderMusic(id: TrackId, seconds: number, intensity = 0.75, seed = 7, only?: string[], volumes?: Volumes): Promise<string> {
    return toBase64(encodeWav(await renderMusic(id, seconds, { intensity, seed, only, volumes }), 32));
  },
  /** 'match' at a fixed intensity with the police chase layer off for the first half, on after. */
  async renderMusicChase(seconds: number, intensity = 0.6, seed = 7, volumes?: Volumes): Promise<string> {
    return toBase64(encodeWav(await renderMusic('match', seconds, { intensity, seed, volumes, tension: (t) => (t < seconds / 2 ? 0 : 1) }), 32));
  },
  /** Intensity ramps 0 -> 1 over the first 80 % then holds (shows the whole range). */
  async renderMusicRamp(id: TrackId, seconds: number, seed = 7, volumes?: Volumes): Promise<string> {
    return toBase64(encodeWav(await renderMusic(id, seconds, { intensity: (t) => Math.min(1, t / (seconds * 0.8)), seed, volumes }), 32));
  },
  async renderScene(seconds: number, o: SceneOptions): Promise<string> {
    return toBase64(encodeWav(await renderScene(seconds, o), 32));
  },
  /** 'ramp': 0 -> 1 over 85 % then silent; 'full': held at 1; 'urgency': 0.25 -> 1 (the director's siren). */
  async renderLoop(id: LoopId, seconds: number, shape: 'ramp' | 'full' | 'urgency' = 'ramp', volumes?: Volumes, pitch = 1, pos?: { x: number; y: number }): Promise<string> {
    const intensity =
      shape === 'full'
        ? () => 1
        : shape === 'urgency'
          ? (t: number) => 0.25 + (0.75 * t) / seconds
          : (t: number) => (t < seconds * 0.85 ? t / (seconds * 0.85) : 0);
    return toBase64(encodeWav(await renderLoop(id, seconds, { intensity, volumes, pitch: () => pitch, pos: pos ? () => pos : undefined }), 32));
  },
  /**
   * A police car driving in like the sim's (2 s ease-out from 26 m to 14 m north of the
   * listener), doppler-bent like the director does, then parked with its siren settling.
   */
  async renderSirenDriveIn(seconds = 7, volumes?: Volumes): Promise<string> {
    const y = (t: number): number => -26 + 12 * (1 - Math.pow(1 - Math.min(1, t / 2), 2));
    const v = (t: number): number => (t < 2 ? 12 * 2 * (1 - t / 2) * 0.5 : 0); // dy/dt of the ease-out
    const pitch = (t: number): number => 1 + Math.min(POLICE_AUDIO.dopplerMaxBend, (POLICE_AUDIO.dopplerScale * v(t)) / 343);
    const intensity = (t: number): number => (t < 2 ? 1 : 1 + (POLICE_AUDIO.sirenParkedLevel - 1) * Math.min(1, (t - 2) / POLICE_AUDIO.sirenSettleSeconds));
    return toBase64(encodeWav(await renderLoop('policeSiren', seconds, { intensity, pitch, pos: (t) => ({ x: 3, y: y(t) }), volumes }), 32));
  },
  /** Strain build-up of one object size over `seconds` (progress 0 -> 1, then silent). */
  async renderStrain(kind: 'smallSafe' | 'largeSafe' | 'bank', seconds = 4, volumes?: Volumes): Promise<string> {
    const T = seconds * 0.85;
    const intensity = (t: number): number => (t < T ? 0.15 + 0.85 * (t / T) : 0);
    return toBase64(encodeWav(await renderLoop('strain', seconds, { intensity, pitch: () => STRAIN_PITCH[kind], volumes }), 32));
  },
  /** A scripted scene through the real director + engine (see ./scenes.ts). */
  async renderDirected(id: SceneId, volumes?: Volumes, music: TrackId | null = 'match'): Promise<string> {
    return toBase64(encodeWav(await renderDirectedScene(SCENES[id](), { volumes, music }), 32));
  },
};
(window as unknown as { audioQA: typeof qa }).audioQA = qa;
document.body.dataset.ready = '1';
