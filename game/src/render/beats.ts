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
 *   BeatLabel .......... HUD-sized sticker label pinned above a world point (and above the HUD's
 *                        own world chip there), drawn on top of everything (police markers
 *                        included) and laid out clear of the HUD zones (LabelScreen /
 *                        layoutLabel) inside a 16 px gutter ("승부 포인트!", "막아야 해!", "빼내기 +300").
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
    /**
     * Label height (whole sticker incl. tail) in HUD rem: the HUD's root font size is
     * min(vw / 120, vh / 67.5) x uiScale (styles/tokens.css), so 4.875 rem = 52 px at 1280x720 and
     * the label scales with the HUD (aspect, UI scale) instead of with the 3D view.
     */
    rem: 4.875,
    /** Gap between the HUD's world chip over the load and the label's tail tip (rem). */
    gapRem: 0.45,
    /** Screen gutter (CSS px; at least this many rem). */
    gutterPx: 16,
    gutterRem: 1.2,
    /** Margin kept around every HUD rect the label steps out of (rem). */
    marginRem: 0.35,
    /** Ease rate (1/s) of the avoidance offset (no jumps when the chosen side changes). */
    ease: 14,
  },
  bark: { seconds: 2.4, width: 3.3 },
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

/** Sprite scale (sizeAttenuation off) for a label `px` tall in a viewport `viewH` px tall. */
export function labelScaleFor(px: number, fovDeg: number, viewH = 720): number {
  return (px / Math.max(1, viewH)) * 2 * Math.tan(((fovDeg * Math.PI) / 180) / 2);
}

/** Screen rectangle in CSS px (y down). */
export interface ScreenRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function rect(): ScreenRect {
  return { x0: 0, y0: 0, x1: 0, y1: 0 };
}

function setRect(r: ScreenRect, x0: number, y0: number, x1: number, y1: number): ScreenRect {
  r.x0 = x0;
  r.y0 = y0;
  r.x1 = x1;
  r.y1 = y1;
  return r;
}

/** HUD root font size (px) for a viewport (styles/tokens.css: min(vw / 120, vh / 67.5) x uiScale). */
export function hudRem(w: number, h: number, uiScale = 1): number {
  const s = Number.isFinite(uiScale) && uiScale > 0 ? uiScale : 1;
  return Math.max(4, Math.min(w / 120, h / 67.5) * s);
}

/** Size (rem) of the HUD's own world chip above a load, bottom-centred on its anchor. */
export interface ChipSize {
  w: number;
  h: number;
}

/**
 * Where the beat labels may go: the viewport, the HUD rem and the HUD's fixed screen zones (all
 * CSS px). The zones mirror styles/hud.css: the top cluster (scoreboard, timer, the decisive-load
 * prompt under it), the stamp column below it, the minimap (bottom left), the action buttons
 * (bottom right) and the bottom-centre carry panel / prompt bar. `extras` are per-placement
 * rects (another label, a recovery ring) and are reset by `clearExtras()`.
 */
export class LabelScreen {
  w = 1280;
  h = 720;
  rem = hudRem(1280, 720);
  readonly zones: ScreenRect[] = [rect(), rect(), rect(), rect(), rect()];
  /**
   * Overlap cost per zone (1 = hard: the label never sits there when any spot is free). The
   * moment-stamp column is soft: stamps pop for ~1 s and are drawn over the canvas, so reserving
   * their column for good would push every label out of the upper middle of the view (where the
   * loads ahead of the player are); the label only steps out of it when that is cheap.
   */
  readonly zoneWeight: number[] = [1, 0.0006, 1, 1, 1];
  readonly extras: ScreenRect[] = [rect(), rect(), rect(), rect()];
  extraCount = 0;

  constructor() {
    this.setViewport(1280, 720, 1);
  }

  setViewport(w: number, h: number, uiScale = 1, rem?: number): void {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.rem = rem !== undefined && Number.isFinite(rem) && rem > 0 ? rem : hudRem(this.w, this.h, uiScale);
    const W = this.w;
    const H = this.h;
    const r = this.rem;
    const z = this.zones;
    setRect(z[0]!, W / 2 - 29 * r, -1e4, W / 2 + 29 * r, 15.5 * r); // scoreboard + timer + prompt
    setRect(z[1]!, W / 2 - 13 * r, 15.5 * r, W / 2 + 13 * r, 22 * r); // moment stamps (.uh-stamps top 15rem)
    setRect(z[2]!, -1e4, H - 17.3 * r, 23.6 * r, H + 1e4); // minimap
    setRect(z[3]!, W - 17.9 * r, H - 14 * r, W + 1e4, H + 1e4); // dash / ping / emote buttons
    setRect(z[4]!, W / 2 - 15.2 * r, H - 16 * r, W / 2 + 15.2 * r, H + 1e4); // carry panel + prompt bar
  }

  clearExtras(): void {
    this.extraCount = 0;
  }

  addExtra(x0: number, y0: number, x1: number, y1: number): void {
    if (this.extraCount >= this.extras.length) return;
    setRect(this.extras[this.extraCount++]!, x0, y0, x1, y1);
  }

  get gutter(): number {
    return Math.max(BEATS.label.gutterPx, BEATS.label.gutterRem * this.rem);
  }
}

const _defaultScreen = new LabelScreen();

/** Mutable layout scratch (one per BeatLabel). */
interface LayoutState {
  /** Label centre x, bottom (tail tip) y, width, height (px). */
  cx: number;
  by: number;
  pw: number;
  lh: number;
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/** Layout context of the running layoutLabel call (module scratch: no closures per call). */
const L = { minX: 0, maxX: 0, minB: 0, maxB: 0, w: 0, h: 0, pw: 0, lh: 0, x0: 0, b0: 0, nz: 0, ne: 0, n: 0 };
let Lscreen: LabelScreen = null as unknown as LabelScreen;
let Lchip: ScreenRect | null = null;

function lClampX(x: number): number {
  return L.minX > L.maxX ? L.w / 2 : Math.min(L.maxX, Math.max(L.minX, x));
}

function lClampB(b: number): number {
  return L.minB > L.maxB ? L.h / 2 : Math.min(L.maxB, Math.max(L.minB, b));
}

function lRect(i: number): ScreenRect {
  return i < L.nz ? Lscreen.zones[i]! : i < L.nz + L.ne ? Lscreen.extras[i - L.nz]! : Lchip!;
}

function lHits(i: number, x: number, b: number): number {
  const r = lRect(i);
  return overlap(x - L.pw / 2, x + L.pw / 2, r.x0, r.x1) * overlap(b - L.lh, b, r.y0, r.y1);
}

function lWeight(i: number): number {
  return i < L.nz ? Lscreen.zoneWeight[i] ?? 1 : 1;
}

/**
 * Weighted overlap of the label at (x, b) with every rect, as a fraction of the label area
 * (`hardOnly`: only the rects of weight 1).
 */
function lCovered(x: number, b: number, hardOnly = false): number {
  let s = 0;
  for (let i = 0; i < L.n; i++) {
    const w = lWeight(i);
    if (hardOnly && w < 1) continue;
    s += lHits(i, x, b) * w;
  }
  return s / (L.pw * L.lh);
}

function lScore(x: number, b: number, cov: number): number {
  const db = b - L.b0;
  return Math.hypot(x - L.x0, db > 0 ? db * 2.2 : db) + cov * 1e5;
}

/**
 * Pure label layout (exported for tests): put a label of size `pw` x `lh` px whose tail wants to
 * sit at (`cx`, `by`) somewhere on screen that overlaps none of the zones / extras of `screen`
 * (plus `chip`), moving it as little as possible (moving it below the wanted spot costs a little
 * more: the tail then points away from the load). The wanted spot is first clamped into the
 * screen box (gutter); then every rect it overlaps is stepped out of (up / down / left / right),
 * and once more out of a rect the first step lands on. Soft zones (LabelScreen.zoneWeight < 1)
 * only cost a little. Writes the result into `out`; returns the overlap with hard rects left, as
 * a fraction of the label area (0 = clear). Allocation-free.
 */
export function layoutLabel(cx: number, by: number, pw: number, lh: number, screen: LabelScreen, chip: ScreenRect | null, out: { cx: number; by: number }): number {
  const g = screen.gutter;
  const m = BEATS.label.marginRem * screen.rem;
  Lscreen = screen;
  Lchip = chip;
  L.w = screen.w;
  L.h = screen.h;
  L.pw = pw;
  L.lh = lh;
  L.minX = g + pw / 2;
  L.maxX = screen.w - g - pw / 2;
  L.minB = g + lh;
  L.maxB = screen.h - g;
  L.nz = screen.zones.length;
  L.ne = screen.extraCount;
  L.n = L.nz + L.ne + (chip ? 1 : 0);
  const x0 = lClampX(cx);
  const b0 = lClampB(by);
  L.x0 = x0;
  L.b0 = b0;
  let bestX = x0;
  let bestB = b0;
  let bestCov = lCovered(x0, b0);
  let best = lScore(x0, b0, bestCov);
  if (bestCov > 0) {
    for (let i = 0; i < L.n; i++) {
      if (lHits(i, x0, b0) <= 0) continue;
      const r = lRect(i);
      for (let d = 0; d < 4; d++) {
        const x1 = d === 2 ? lClampX(r.x0 - m - pw / 2) : d === 3 ? lClampX(r.x1 + m + pw / 2) : x0;
        const b1 = d === 0 ? lClampB(r.y0 - m) : d === 1 ? lClampB(r.y1 + m + lh) : b0;
        const c1 = lCovered(x1, b1);
        const s1 = lScore(x1, b1, c1);
        if (s1 < best) {
          best = s1;
          bestX = x1;
          bestB = b1;
          bestCov = c1;
        }
        if (c1 <= 0) continue;
        // second step: out of whatever the first step landed on
        for (let j = 0; j < L.n; j++) {
          if (j === i || lHits(j, x1, b1) <= 0) continue;
          const q = lRect(j);
          for (let e = 0; e < 4; e++) {
            const x2 = e === 2 ? lClampX(q.x0 - m - pw / 2) : e === 3 ? lClampX(q.x1 + m + pw / 2) : x1;
            const b2 = e === 0 ? lClampB(q.y0 - m) : e === 1 ? lClampB(q.y1 + m + lh) : b1;
            const c2 = lCovered(x2, b2);
            const s2 = lScore(x2, b2, c2);
            if (s2 < best) {
              best = s2;
              bestX = x2;
              bestB = b2;
              bestCov = c2;
            }
          }
        }
      }
    }
  }
  const hard = bestCov > 0 ? lCovered(bestX, bestB, true) : 0;
  Lchip = null;
  out.cx = bestX;
  out.by = bestB;
  return hard;
}

const _chip = rect();
const _lay = { cx: 0, by: 0 };

export class BeatLabel {
  readonly sprite: THREE.Sprite;
  private readonly mat: THREE.SpriteMaterial;
  private readonly textures = new Map<string, { tex: THREE.Texture; frac: number }>();
  private key = '';
  private frac = 1;
  private pop = 0;
  /** Eased avoidance offset (px) and whether it has been placed since it was shown. */
  private offX = 0;
  private offY = 0;
  private placed = false;
  /** Last placed screen rect of the whole sticker (CSS px), for other labels to avoid. */
  readonly rect: ScreenRect = rect();
  /** Overlap fraction left by the last layout (0 = clear of every HUD rect; tests / tools). */
  lastCover = 0;
  private readonly st: LayoutState = { cx: 0, by: 0, pw: 0, lh: 0 };

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
    this.placed = false;
  }

  get shown(): boolean {
    return this.sprite.visible;
  }

  /**
   * Pin the label's tail above world point (x, y = height, z). `chip` = the HUD's own world chip
   * bottom-centred on that same point (rem; null = none): the label sits on top of it. The label
   * is then laid out on screen (layoutLabel) clear of the HUD zones in `screen` (+ its extras)
   * and of the chip, with the 16 px gutter. `pulse` 0..1 adds a gentle breathing scale (0 =
   * still). Call after the camera update.
   */
  place(x: number, h: number, z: number, camera: THREE.PerspectiveCamera, dt: number, pulse: number, screen: LabelScreen = _defaultScreen, chip: ChipSize | null = null): void {
    if (!this.key) {
      this.sprite.visible = false;
      return;
    }
    this.sprite.visible = true;
    this.pop = Math.min(1, this.pop + Math.max(0, dt) / 0.18);
    const k = this.pop;
    const popS = k < 1 ? 0.35 + 0.65 * (1 - Math.pow(1 - k, 3)) + Math.sin(Math.PI * k) * 0.18 : 1;
    const W = screen.w;
    const H = screen.h;
    const st = this.st;
    st.lh = BEATS.label.rem * screen.rem;
    st.pw = ((st.lh * LABEL_W) / LABEL_H) * this.frac;
    const s = labelScaleFor(st.lh, camera.fov, H) * popS * (1 + 0.05 * pulse);
    this.sprite.scale.set((s * LABEL_W) / LABEL_H, s, 1);
    _ndc.set(x, h, z).project(camera);
    // Behind the camera (never with the high match camera): mirror into the screen.
    if (_ndc.z > 1) {
      _ndc.x = -_ndc.x;
      _ndc.y = -_ndc.y;
    }
    const ax = ((_ndc.x + 1) / 2) * W;
    const ay = ((1 - _ndc.y) / 2) * H;
    const onScreen = ax >= 0 && ax <= W && ay >= 0 && ay <= H;
    let lift = BEATS.label.gapRem * screen.rem;
    let chipRect: ScreenRect | null = null;
    if (chip && onScreen) {
      const cw = chip.w * screen.rem;
      const ch = chip.h * screen.rem;
      chipRect = setRect(_chip, ax - cw / 2, ay - ch, ax + cw / 2, ay);
      lift += ch;
    }
    // wanted spot, clamped into the screen box: the base the eased avoidance offset is added to
    const g = screen.gutter;
    const bx = Math.min(W - g - st.pw / 2, Math.max(g + st.pw / 2, ax));
    const bb = Math.min(H - g, Math.max(g + st.lh, ay - lift));
    this.lastCover = layoutLabel(ax, ay - lift, st.pw, st.lh, screen, chipRect, _lay);
    const tx = _lay.cx - bx;
    const ty = _lay.by - bb;
    if (!this.placed) {
      this.offX = tx;
      this.offY = ty;
      this.placed = true;
    } else {
      const e = 1 - Math.exp(-BEATS.label.ease * Math.max(0, dt));
      this.offX += (tx - this.offX) * e;
      this.offY += (ty - this.offY) * e;
    }
    st.cx = Math.min(W - g - st.pw / 2, Math.max(g + st.pw / 2, bx + this.offX));
    st.by = Math.min(H - g, Math.max(g + st.lh, bb + this.offY));
    setRect(this.rect, st.cx - st.pw / 2, st.by - st.lh, st.cx + st.pw / 2, st.by);
    _ndc.set((st.cx / W) * 2 - 1, 1 - (st.by / H) * 2, 0.5);
    _ndc.unproject(camera);
    this.sprite.position.copy(_ndc);
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
  // Symmetric tail whose tip sits on the sprite anchor (w / 2): points straight at the head.
  ctx.lineTo(w / 2 + 18, y + bh);
  ctx.lineTo(w / 2, h - 14);
  ctx.lineTo(w / 2 - 18, y + bh);
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
