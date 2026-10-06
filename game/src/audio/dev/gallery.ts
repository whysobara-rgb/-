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
import { captionText } from '../captions';
import { LOOP_IDS, SFX_IDS, TRACK_IDS, type LoopId, type MusicId, type SfxId, type TrackId } from '../ids';
import { encodeWav, renderLoop, renderMusic, renderSfx } from '../offline';
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

function slider(label: string, value: number, onInput: (v: number) => void): HTMLElement {
  const input = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(value) });
  const out = el('span', {}, value.toFixed(2));
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = v.toFixed(2);
    onInput(v);
  });
  return el('label', { class: 'slider' }, el('span', {}, label), input, out);
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
const vols = { master: 1, music: 1, sfx: 1, ui: 1 };
engine.setVolumes(vols);
const volSection = section(
  'Volumes',
  ...(['master', 'music', 'sfx', 'ui'] as const).map((k) =>
    slider(k, vols[k], (v) => {
      vols[k] = v;
      engine.setVolumes(vols);
    }),
  ),
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
const sfxRows = SFX_IDS.map((id) => {
  const r = SFX_RECIPES[id];
  const play = el('button', {}, '▶ random');
  play.addEventListener('click', () => {
    void ensureUnlocked().then(() => {
      engine.play(id, { pos: soundPos ?? undefined, step: id.startsWith('score') ? comboStep : 0 });
    });
  });
  const variants = Array.from({ length: r.variants }, (_, k) => {
    const b = el('button', { class: 'small' }, `v${k}`);
    b.addEventListener('click', () => void ensureUnlocked().then(() => engine.play(id, { pos: soundPos ?? undefined, variant: k })));
    return b;
  });
  return el('div', { class: 'sfx' }, el('span', { class: 'name' }, id), el('div', { class: 'row' }, play, ...variants, el('span', { class: 'hint' }, r.bus)));
});
const comboBtn = el('button', {}, 'combo step: 0');
comboBtn.addEventListener('click', () => {
  comboStep = (comboStep + 1) % 7;
  comboBtn.textContent = `combo step: ${comboStep}`;
});
const sfxSection = section('Sound effects', el('div', { class: 'row' }, comboBtn, el('span', { class: 'hint' }, 'score sounds climb the scale per step')), ...sfxRows);

// ---- loops -----------------------------------------------------------------------------------
const loopLevels: Record<LoopId, number> = { drag: 0, bankRumble: 0, strain: 0, sirenLoop: 0 };
const loopSection = section(
  'Loops (intensity)',
  ...LOOP_IDS.map((id) => slider(id, 0, (v) => {
    loopLevels[id] = v;
    void ensureUnlocked();
  })),
  el('p', { class: 'hint' }, 'Loops follow the spatial pad position. Drag the strain slider up slowly to hear the rising creak.'),
);
function tickLoops(): void {
  for (const id of LOOP_IDS) engine.setLoop(id, loopLevels[id], soundPos ?? undefined);
  requestAnimationFrame(tickLoops);
}
requestAnimationFrame(tickLoops);

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
  slider('intensity', 0.5, (v) => engine.setMusicIntensity(v)),
  el('p', { class: 'hint' }, "'match' layers: base (bass, clav, shaker) → drums ≥0.1 → lead ≥0.35 → extra ≥0.65. Tonal SFX are tuned to the track key."),
);
engine.setMusicIntensity(0.5);

app.append(volSection, musicSection, padSection, loopSection, sfxSection);

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
  async renderSfx(id: SfxId, variant = 0, seed = 1, extra: { step?: number; pitch?: number; pos?: { x: number; y: number } } = {}): Promise<string> {
    return toBase64(encodeWav(await renderSfx(id, { variant, seed, ...extra }), 32));
  },
  async renderMusic(id: TrackId, seconds: number, intensity = 0.75, seed = 7, only?: string[]): Promise<string> {
    return toBase64(encodeWav(await renderMusic(id, seconds, { intensity, seed, only }), 32));
  },
  /** Intensity ramps 0 -> 1 over the first 80 % then holds (shows the whole range). */
  async renderMusicRamp(id: TrackId, seconds: number, seed = 7): Promise<string> {
    return toBase64(encodeWav(await renderMusic(id, seconds, { intensity: (t) => Math.min(1, t / (seconds * 0.8)), seed }), 32));
  },
  async renderLoop(id: LoopId, seconds: number, shape: 'ramp' | 'full' = 'ramp'): Promise<string> {
    const intensity = shape === 'full' ? () => 1 : (t: number) => (t < seconds * 0.85 ? t / (seconds * 0.85) : 0);
    return toBase64(encodeWav(await renderLoop(id, seconds, { intensity }), 32));
  },
};
(window as unknown as { audioQA: typeof qa }).audioQA = qa;
document.body.dataset.ready = '1';
