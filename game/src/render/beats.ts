/**
 * Render beats (fun round WP3 / Content 2.0 F3): the small, presentation-only story beats the
 * GameView plays on top of the match — all of them fed by game flow (match.ts funObserve /
 * funEnding, app.ts toResults) from MomentTracker facts; nothing here reads or changes the sim's
 * rules, and nothing here re-derives a moment.
 *
 *   GlanceTracker ...... big-play camera glance: blend the match camera target toward a point by
 *                        weight <= 0.3 for `ms`, eased in / held / eased out, shift capped so the
 *                        player stays in frame. No yaw change (doc §4).
 *   getawayDepart() .... the end-hold drive-off timeline (honk + rev, then pull away 3-4 m).
 *   vanFreeRun() ....... how far a van can roll forward before it would hit a static.
 *   BeatLabel .......... constant-pixel-size sticker label pinned to a world point, drawn on top
 *                        of everything (police markers included) and clamped out of the HUD
 *                        bands / into the screen ("이게 들어가면 끝!", "막아야 해!", "빼내기 +300").
 *   PulseRing .......... pulsing ground ring + ripple (decisive load, bag carrier, steal door).
 *   WindupRing ......... spiky spark ring at a bot's feet during its readable dash wind-up.
 *   BarkBubble ......... text-only speech bubble over a bot (WP2 barks).
 *
 * Steady state allocates nothing per frame: textures are cached per text, every vector is a
 * module scratch, and the visuals are created once per view / per character.
 */
import * as THREE from 'three';
import type { Vec2 } from '../sim';
import { FONT_STACK, makeCanvasTexture } from './models/textures';

// ---------------------------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------------------------

export const BEATS = {
  glance: {
    /** Contract cap on the blend weight. */
    maxWeight: 0.3,
    /** Never shift the camera target further than this (m): the player stays in frame. */
    maxShift: 6,
    /** Fractions of the glance spent easing in / out (the rest holds). */
    easeIn: 0.22,
    easeOut: 0.38,
    /** Duration clamp (ms). */
    minMs: 120,
    maxMs: 2500,
  },
  getaway: {
    /** Honk + rev in place before rolling (s). */
    revFor: 0.42,
    /** Pull-away duration (s) and distance (m, plan: 3-4 m). */
    driveFor: 1.5,
    distance: 3.6,
    /** Shorter free runs than this just rev (m). */
    minRun: 1.2,
    /** Exhaust puff cadence while revving / rolling (s). */
    puffEvery: 0.1,
    /** Draw: both vans rev at these times (s). */
    drawRevs: [0, 0.75, 1.5] as readonly number[],
    /** van.setDepart(t) moves t^2 * 28 m (models/van.ts). */
    vanDepartMeters: 28,
  },
  label: {
    /** Label height at 720p (CSS px); scales with the viewport height. */
    px: 46,
    /** NDC clamp box: below the scoreboard / decisive prompt band, above the bottom HUD. */
    maxY: 0.42,
    minY: -0.72,
    maxX: 0.84,
  },
  bark: { seconds: 2.4, width: 2.5 },
} as const;

// ---------------------------------------------------------------------------------------------
// Glance
// ---------------------------------------------------------------------------------------------

function smooth01(k: number): number {
  const x = Math.min(1, Math.max(0, k));
  return x * x * (3 - 2 * x);
}

/** Big-play camera glance (pure; times in seconds of the view clock). */
export class GlanceTracker {
  private gx = 0;
  private gy = 0;
  private weight = 0;
  private start = 0;
  private dur = 0;

  /** Start (or replace) a glance toward `pos`; weight is clamped to 0..0.3. */
  begin(pos: Vec2, weight: number, ms: number, now: number): boolean {
    const w = Math.min(BEATS.glance.maxWeight, Math.max(0, Number.isFinite(weight) ? weight : 0));
    if (!(w > 0) || !Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(ms) || ms <= 0) return false;
    this.gx = pos.x;
    this.gy = pos.y;
    this.weight = w;
    this.start = now;
    this.dur = Math.min(BEATS.glance.maxMs, Math.max(BEATS.glance.minMs, ms)) / 1000;
    return true;
  }

  clear(): void {
    this.weight = 0;
    this.dur = 0;
  }

  get active(): boolean {
    return this.dur > 0;
  }

  /** Current blend weight (0 when idle or finished). */
  weightAt(now: number): number {
    if (this.dur <= 0) return 0;
    const k = (now - this.start) / this.dur;
    if (k >= 1 || k < 0) {
      if (k >= 1) this.clear();
      return 0;
    }
    const G = BEATS.glance;
    const env = k < G.easeIn ? smooth01(k / G.easeIn) : k > 1 - G.easeOut ? smooth01((1 - k) / G.easeOut) : 1;
    return this.weight * env;
  }

  /**
   * Shift a camera target (tx, ty) toward the glance point for time `now`; writes the result in
   * `out` (may alias nothing; no allocation). Returns the weight used.
   */
  apply(now: number, tx: number, ty: number, out: { x: number; y: number }): number {
    const w = this.weightAt(now);
    let dx = (this.gx - tx) * w;
    let dy = (this.gy - ty) * w;
    const l = Math.hypot(dx, dy);
    const cap = BEATS.glance.maxShift;
    if (l > cap) {
      dx *= cap / l;
      dy *= cap / l;
    }
    out.x = tx + dx;
    out.y = ty + dy;
    return w;
  }
}

// ---------------------------------------------------------------------------------------------
// Getaway timeline
// ---------------------------------------------------------------------------------------------

/** Meters the winning van has rolled `t` seconds into the getaway (free run `run` m). */
export function getawayDepart(t: number, run: number): number {
  const G = BEATS.getaway;
  if (!(run >= G.minRun) || t <= G.revFor) return 0;
  const k = Math.min(1, (t - G.revFor) / G.driveFor);
  // ease-in-out: a lazy pull-away that settles (the results cut comes right after)
  const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  return Math.min(run, G.distance) * e;
}

/** van.setDepart() parameter for a forward roll of `meters`. */
export function departParam(meters: number): number {
  return Math.sqrt(Math.max(0, meters) / BEATS.getaway.vanDepartMeters);
}

/**
 * Free forward run (m, 0..BEATS.getaway.distance) for a van at `pos` facing `angle` with half
 * extents `half`: probes circles ahead of the nose until `isFree` fails.
 */
export function vanFreeRun(pos: Vec2, angle: number, half: Vec2, isFree: (p: Vec2, r: number) => boolean): number {
  const D = BEATS.getaway.distance;
  const r = Math.min(1, half.y);
  const cx = Math.cos(angle);
  const cy = Math.sin(angle);
  const p = { x: 0, y: 0 };
  let free = 0;
  const span = Math.max(0, D - r);
  const steps = Math.ceil(span / 0.25);
  for (let i = 0; i <= steps; i++) {
    const s = Math.min(span, i * 0.25);
    const d = half.x + r + 0.05 + s;
    p.x = pos.x + cx * d;
    p.y = pos.y + cy * d;
    if (!isFree(p, r)) break;
    free = Math.min(D, s + r);
  }
  return free;
}

// ---------------------------------------------------------------------------------------------
// Sticker label (constant pixel size, on top, clamped into the safe screen box)
// ---------------------------------------------------------------------------------------------

export type LabelStyle = 'ours' | 'theirs' | 'steal';

const LABEL_W = 640;
const LABEL_H = 144;
const INK = '#2A2131';

const STYLE: Record<LabelStyle, { bg: string; fg: string; stroke: string | null }> = {
  ours: { bg: '#FFD23F', fg: INK, stroke: null },
  theirs: { bg: '#FF5A5F', fg: '#FFF6E6', stroke: INK },
  steal: { bg: '#7FE0B4', fg: INK, stroke: null },
};

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawLabel(ctx: CanvasRenderingContext2D, w: number, h: number, text: string, style: LabelStyle): number {
  ctx.clearRect(0, 0, w, h);
  const s = STYLE[style];
  let size = 70;
  ctx.font = `bold ${size}px ${FONT_STACK}`;
  let tw = ctx.measureText(text).width;
  const maxText = w - 90;
  if (tw > maxText) {
    size = Math.max(36, Math.floor((size * maxText) / tw));
    ctx.font = `bold ${size}px ${FONT_STACK}`;
    tw = ctx.measureText(text).width;
  }
  const pw = Math.min(w - 16, tw + 70);
  const ph = h - 40;
  const x = (w - pw) / 2;
  const y = 8;
  // drop shadow, sticker rim, ink line, fill
  ctx.fillStyle = 'rgba(42,33,49,0.45)';
  roundRect(ctx, x + 5, y + 8, pw, ph, ph / 2);
  ctx.fill();
  roundRect(ctx, x, y, pw, ph, ph / 2);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 16;
  ctx.strokeStyle = '#FFFFFF';
  ctx.stroke();
  ctx.lineWidth = 7;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = s.bg;
  ctx.fill();
  // pointer tail toward the load
  ctx.beginPath();
  ctx.moveTo(w / 2 - 18, y + ph - 2);
  ctx.lineTo(w / 2, h - 6);
  ctx.lineTo(w / 2 + 18, y + ph - 2);
  ctx.closePath();
  ctx.fillStyle = s.bg;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillRect(w / 2 - 15, y + ph - 8, 30, 6);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (s.stroke) {
    ctx.lineWidth = 10;
    ctx.strokeStyle = s.stroke;
    ctx.strokeText(text, w / 2, y + ph / 2 + 3);
  }
  ctx.fillStyle = s.fg;
  ctx.fillText(text, w / 2, y + ph / 2 + 3);
  return pw / w;
}

const _ndc = new THREE.Vector3();

/** Sprite scale (sizeAttenuation off) for a label `px` tall at a viewport height of 720. */
export function labelScaleFor(px: number, fovDeg: number): number {
  return (px / 720) * 2 * Math.tan(((fovDeg * Math.PI) / 180) / 2);
}

/**
 * Clamp a projected point (NDC) into the label box; returns true when it moved. Pure helper
 * (exported for tests).
 */
export function clampNdc(p: { x: number; y: number }, box: { minY: number; maxY: number; maxX: number } = BEATS.label): boolean {
  const x = Math.min(box.maxX, Math.max(-box.maxX, p.x));
  const y = Math.min(box.maxY, Math.max(box.minY, p.y));
  const moved = x !== p.x || y !== p.y;
  p.x = x;
  p.y = y;
  return moved;
}

export class BeatLabel {
  readonly sprite: THREE.Sprite;
  private readonly mat: THREE.SpriteMaterial;
  private readonly textures = new Map<string, { tex: THREE.Texture; frac: number }>();
  private key = '';
  private frac = 1;
  private pop = 0;

  constructor(name: string) {
    this.mat = new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false, sizeAttenuation: false });
    this.sprite = new THREE.Sprite(this.mat);
    this.sprite.name = name;
    this.sprite.renderOrder = 46;
    this.sprite.center.set(0.5, 0);
    this.sprite.userData.noOutline = true;
    this.sprite.raycast = () => {};
    this.sprite.visible = false;
    this.sprite.frustumCulled = false;
  }

  /** Show `text` in `style` (texture cached per text + style; a change pops the sticker). */
  set(text: string, style: LabelStyle): void {
    const key = style + '|' + text;
    if (key === this.key) return;
    this.key = key;
    let hit = this.textures.get(key);
    if (!hit) {
      let frac = 1;
      const tex = makeCanvasTexture(
        LABEL_W,
        LABEL_H,
        (ctx, w, h) => {
          frac = drawLabel(ctx, w, h, text, style);
        },
        { fontText: text, mipmaps: false },
      );
      hit = { tex, frac };
      if (this.textures.size > 12) {
        for (const [k, v] of this.textures) {
          if (k === key) continue;
          v.tex.dispose();
          this.textures.delete(k);
          break;
        }
      }
      this.textures.set(key, hit);
    }
    this.mat.map = hit.tex;
    this.mat.needsUpdate = true;
    this.frac = hit.frac;
    this.pop = 0;
  }

  hide(): void {
    this.sprite.visible = false;
    this.key = '';
  }

  get shown(): boolean {
    return this.sprite.visible;
  }

  /**
   * Pin the label's tail to world point (x, y = height, z), clamped into the safe screen box.
   * `pulse` 0..1 adds a gentle breathing scale (0 = still). Call after the camera update.
   */
  place(x: number, h: number, z: number, camera: THREE.PerspectiveCamera, dt: number, pulse: number): void {
    if (!this.key) return;
    this.sprite.visible = true;
    _ndc.set(x, h, z).project(camera);
    // Behind the camera (never with the high match camera): mirror into the screen.
    if (_ndc.z > 1) {
      _ndc.x = -_ndc.x;
      _ndc.y = -_ndc.y;
      _ndc.z = 0.98;
    }
    if (clampNdc(_ndc)) {
      _ndc.unproject(camera);
      this.sprite.position.copy(_ndc);
    } else this.sprite.position.set(x, h, z);
    this.pop = Math.min(1, this.pop + Math.max(0, dt) / 0.18);
    const k = this.pop;
    const popS = k < 1 ? 0.35 + 0.65 * (1 - Math.pow(1 - k, 3)) + Math.sin(Math.PI * k) * 0.18 : 1;
    const s = labelScaleFor(BEATS.label.px, camera.fov) * popS * (1 + 0.05 * pulse);
    this.sprite.scale.set((s * LABEL_W) / LABEL_H, s, 1);
  }

  /** Width fraction of the drawn plate (tests). */
  get plateFraction(): number {
    return this.frac;
  }

  dispose(): void {
    for (const v of this.textures.values()) v.tex.dispose();
    this.textures.clear();
    this.mat.dispose();
    this.sprite.removeFromParent();
  }
}

// ---------------------------------------------------------------------------------------------
// Ground rings
// ---------------------------------------------------------------------------------------------

let ringGeo: THREE.RingGeometry | null = null;
let rippleGeo: THREE.RingGeometry | null = null;
let spikeGeo: THREE.BufferGeometry | null = null;

function sharedRing(): THREE.RingGeometry {
  if (!ringGeo) {
    ringGeo = new THREE.RingGeometry(0.84, 1, 56, 1);
    ringGeo.rotateX(-Math.PI / 2);
  }
  return ringGeo;
}

function sharedRipple(): THREE.RingGeometry {
  if (!rippleGeo) {
    rippleGeo = new THREE.RingGeometry(0.95, 1, 56, 1);
    rippleGeo.rotateX(-Math.PI / 2);
  }
  return rippleGeo;
}

/** Star-burst spark ring (12 spikes + a thin band), flat on the ground, radius ~1. */
function sharedSpikes(): THREE.BufferGeometry {
  if (spikeGeo) return spikeGeo;
  const pos: number[] = [];
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const da = (Math.PI / n) * 0.55;
    const r0 = 0.62;
    const r1 = i % 2 ? 0.96 : 1.12;
    pos.push(Math.cos(a - da) * r0, 0, Math.sin(a - da) * r0, Math.cos(a) * r1, 0, Math.sin(a) * r1, Math.cos(a + da) * r0, 0, Math.sin(a + da) * r0);
  }
  const band = 48;
  for (let i = 0; i < band; i++) {
    const a0 = (i / band) * Math.PI * 2;
    const a1 = ((i + 1) / band) * Math.PI * 2;
    const ri = 0.56;
    const ro = 0.66;
    const p = (r: number, a: number): [number, number, number] => [Math.cos(a) * r, 0, Math.sin(a) * r];
    pos.push(...p(ri, a0), ...p(ro, a1), ...p(ro, a0), ...p(ri, a0), ...p(ri, a1), ...p(ro, a1));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeBoundingSphere();
  spikeGeo = g;
  return g;
}

function groundMat(color: THREE.ColorRepresentation): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
}

/** Pulsing ground ring with an outward ripple (decisive load / bag carrier / steal door). */
export class PulseRing {
  readonly root = new THREE.Group();
  private readonly ring: THREE.Mesh;
  private readonly ripple: THREE.Mesh;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly rippleMat: THREE.MeshBasicMaterial;
  private phase = 0;
  private fade = 0;

  constructor(name: string) {
    this.root.name = name;
    this.ringMat = groundMat('#FFD23F');
    this.rippleMat = groundMat('#FFD23F');
    this.ring = new THREE.Mesh(sharedRing(), this.ringMat);
    this.ripple = new THREE.Mesh(sharedRipple(), this.rippleMat);
    for (const m of [this.ring, this.ripple]) {
      m.userData.noOutline = true;
      m.renderOrder = 3;
      m.raycast = () => {};
      m.frustumCulled = false;
    }
    this.root.add(this.ring, this.ripple);
    this.root.visible = false;
  }

  setColor(color: THREE.ColorRepresentation): void {
    this.ringMat.color.set(color);
    this.rippleMat.color.set(color);
  }

  /**
   * Show at (x, h, z) with `radius`, or fade out when `on` is false. `rate` = pulses per second;
   * `calm` (reduced motion) holds a steady ring without the ripple.
   */
  update(on: boolean, x: number, h: number, z: number, radius: number, dt: number, rate: number, calm: boolean): void {
    const step = Math.max(0, dt);
    this.fade = on ? Math.min(1, this.fade + step / 0.15) : Math.max(0, this.fade - step / 0.2);
    this.root.visible = this.fade > 0.001;
    if (!this.root.visible) return;
    this.phase = (this.phase + step * rate) % 1;
    const breathe = calm ? 0 : Math.sin(this.phase * Math.PI * 2);
    if (on) this.root.position.set(x, h + 0.035, z);
    const r = radius * (1 + 0.05 * breathe);
    this.ring.scale.set(r, 1, r);
    this.ringMat.opacity = this.fade * (0.78 + 0.18 * breathe);
    if (calm) {
      this.ripple.visible = false;
      return;
    }
    this.ripple.visible = true;
    const rr = radius * (1 + this.phase * 0.55);
    this.ripple.scale.set(rr, 1, rr);
    this.rippleMat.opacity = this.fade * 0.6 * (1 - this.phase);
  }

  dispose(): void {
    this.ringMat.dispose();
    this.rippleMat.dispose();
    this.root.removeFromParent();
  }
}

/** Spark ring at a bot's feet during its dash wind-up (crouch is posed by the view). */
export class WindupRing {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.MeshBasicMaterial;
  private k = 0;

  constructor() {
    this.mat = groundMat('#FFE45E');
    this.mesh = new THREE.Mesh(sharedSpikes(), this.mat);
    this.mesh.name = 'windupRing';
    this.mesh.userData.noOutline = true;
    this.mesh.renderOrder = 3;
    this.mesh.raycast = () => {};
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
  }

  /** `t` = seconds since the wind-up started (null = not winding up). */
  update(t: number | null, x: number, h: number, z: number, dt: number, calm: boolean): void {
    const step = Math.max(0, dt);
    this.k = t !== null ? Math.min(1, this.k + step / 0.08) : Math.max(0, this.k - step / 0.12);
    this.mesh.visible = this.k > 0.001;
    if (!this.mesh.visible) return;
    if (t !== null) this.mesh.position.set(x, h + 0.04, z);
    const flick = calm || t === null ? 0 : Math.sin(t * 40) * 0.5 + 0.5;
    const s = 0.55 + 0.55 * this.k + 0.06 * flick;
    this.mesh.scale.set(s, 1, s);
    if (!calm && t !== null) this.mesh.rotation.y = -t * 5;
    this.mat.color.setRGB(1, 0.86 + 0.14 * flick, 0.32 + 0.5 * flick);
    this.mat.opacity = this.k * (0.85 + 0.15 * flick);
  }

  dispose(): void {
    this.mat.dispose();
    this.mesh.removeFromParent();
  }
}

// ---------------------------------------------------------------------------------------------
// Bark bubble
// ---------------------------------------------------------------------------------------------

const BARK_W = 512;
const BARK_H = 224;

function drawBark(ctx: CanvasRenderingContext2D, w: number, h: number, text: string): void {
  ctx.clearRect(0, 0, w, h);
  let size = 72;
  ctx.font = `bold ${size}px ${FONT_STACK}`;
  let tw = ctx.measureText(text).width;
  if (tw > w - 110) {
    size = Math.max(34, Math.floor((size * (w - 110)) / tw));
    ctx.font = `bold ${size}px ${FONT_STACK}`;
    tw = ctx.measureText(text).width;
  }
  const bw = Math.min(w - 20, tw + 90);
  const bh = 140;
  const x = (w - bw) / 2;
  const y = 10;
  ctx.lineJoin = 'round';
  // bubble + tail (one path so the rim is continuous)
  const r = bh / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + bw, y, x + bw, y + bh, r);
  ctx.arcTo(x + bw, y + bh, x, y + bh, r);
  ctx.lineTo(w / 2 + 6, y + bh);
  ctx.lineTo(w / 2 - 26, h - 14);
  ctx.lineTo(w / 2 - 30, y + bh);
  ctx.arcTo(x, y + bh, x, y, r);
  ctx.arcTo(x, y, x + bw, y, r);
  ctx.closePath();
  ctx.lineWidth = 18;
  ctx.strokeStyle = '#FFFFFF';
  ctx.stroke();
  ctx.lineWidth = 8;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = '#FFF6E6';
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = INK;
  ctx.fillText(text, w / 2, y + bh / 2 + 4);
}

/** Text-only speech bubble over one character (world-sized, drawn on top). */
export class BarkBubble {
  readonly sprite: THREE.Sprite;
  private readonly mat: THREE.SpriteMaterial;
  private readonly textures = new Map<string, THREE.Texture>();
  private age = 0;
  private dur = 0;

  constructor() {
    this.mat = new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    this.sprite = new THREE.Sprite(this.mat);
    this.sprite.name = 'barkBubble';
    this.sprite.renderOrder = 22;
    this.sprite.center.set(0.5, 0);
    this.sprite.userData.noOutline = true;
    this.sprite.raycast = () => {};
    this.sprite.visible = false;
    this.sprite.frustumCulled = false;
  }

  show(text: string, seconds: number): void {
    const t = text.trim();
    if (!t) return;
    let tex = this.textures.get(t);
    if (!tex) {
      tex = makeCanvasTexture(BARK_W, BARK_H, (ctx, w, h) => drawBark(ctx, w, h, t), { fontText: t, mipmaps: false });
      if (this.textures.size > 8) {
        for (const [k, v] of this.textures) {
          v.dispose();
          this.textures.delete(k);
          break;
        }
      }
      this.textures.set(t, tex);
    }
    this.mat.map = tex;
    this.mat.needsUpdate = true;
    this.age = 0;
    this.dur = Math.min(6, Math.max(0.6, Number.isFinite(seconds) ? seconds : BEATS.bark.seconds));
  }

  hide(): void {
    this.dur = 0;
    this.sprite.visible = false;
  }

  get shown(): boolean {
    return this.dur > 0;
  }

  /** Follow the head anchor (world). Returns false once finished. */
  update(x: number, y: number, z: number, dt: number, calm: boolean): boolean {
    if (this.dur <= 0) return false;
    this.age += Math.max(0, dt);
    if (this.age >= this.dur) {
      this.hide();
      return false;
    }
    const t = this.age;
    const pop = t < 0.16 ? 0.3 + 0.7 * (1 - Math.pow(1 - t / 0.16, 3)) + Math.sin((Math.PI * t) / 0.16) * 0.15 : 1;
    const out = this.dur - t < 0.18 ? (this.dur - t) / 0.18 : 1;
    const bob = calm ? 0 : Math.sin(t * 5) * 0.04;
    const w = BEATS.bark.width * pop * (0.6 + 0.4 * out);
    this.sprite.visible = true;
    this.sprite.position.set(x, y + bob, z);
    this.sprite.scale.set(w, (w * BARK_H) / BARK_W, 1);
    this.mat.opacity = out;
    return true;
  }

  dispose(): void {
    for (const t of this.textures.values()) t.dispose();
    this.textures.clear();
    this.mat.dispose();
    this.sprite.removeFromParent();
  }
}

/** Free the shared ring geometries (view caches teardown). */
export function disposeBeatGeometries(): void {
  ringGeo?.dispose();
  rippleGeo?.dispose();
  spikeGeo?.dispose();
  ringGeo = rippleGeo = spikeGeo = null;
}
