/**
 * Canvas-drawn textures: Korean text (Jua), faces, value plates, signs, ground paving,
 * zone paint, dashed outlines, glow gradients.
 *
 * Fonts: Jua is bundled through @fontsource (works offline in Electron). Its files are split
 * by unicode-range, so we ask `document.fonts.load('48px Jua', text)` with the actual text
 * to fetch the right subsets, draw immediately with a fallback stack, then redraw once the
 * font is ready (graceful fallback when the font never loads).
 *
 * All textures are cached; they are shared by every instance that uses them.
 */
import '@fontsource/jua';
import * as THREE from 'three';
import type { TeamId } from '../../sim/types';
import { TEAM_STYLES } from '../../shared/teams';
import { PAL, type SignIcon } from './palette';
import { rng, hashString } from './geometry';

export const FONT_STACK = '"Jua", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", "Nanum Gothic", sans-serif';

const HAS_DOM = typeof document !== 'undefined' && typeof document.createElement === 'function';

const fontPromises = new Map<string, Promise<boolean>>();

/** Resolve when Jua glyphs for `text` are available (false = fallback font in use). */
export function loadJua(text = '은행 BANK 0123456789'): Promise<boolean> {
  if (!HAS_DOM || !document.fonts) return Promise.resolve(false);
  let p = fontPromises.get(text);
  if (!p) {
    p = document.fonts
      .load('48px "Jua"', text)
      .then((faces) => faces.length > 0)
      .catch(() => false);
    fontPromises.set(text, p);
  }
  return p;
}

/** Preload the glyph subsets used by the built-in model textures. */
export function preloadModelFonts(extraText = ''): Promise<boolean> {
  return loadJua('은행 BANK 100 300 회수 구역 점 ' + extraText);
}

type DrawFn = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

export interface CanvasTexOptions {
  /** Redraw after Jua glyphs for this text are loaded. */
  fontText?: string;
  repeat?: boolean;
  srgb?: boolean;
  anisotropy?: number;
  mipmaps?: boolean;
}

/** Create a canvas texture from a draw callback (1x1 placeholder without a DOM). */
export function makeCanvasTexture(w: number, h: number, draw: DrawFn, o: CanvasTexOptions = {}): THREE.Texture {
  if (!HAS_DOM) {
    const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    t.needsUpdate = true;
    return t;
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  if (o.srgb !== false) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = o.anisotropy ?? 8;
  if (o.repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  if (o.mipmaps === false) {
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
  }
  if (o.fontText) {
    void loadJua(o.fontText).then((ok) => {
      if (!ok) return;
      ctx.clearRect(0, 0, w, h);
      draw(ctx, w, h);
      tex.needsUpdate = true;
    });
  }
  return tex;
}

const texCache = new Map<string, THREE.Texture>();
function cachedTex(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = texCache.get(key);
  if (!t) {
    t = make();
    t.name = key;
    texCache.set(key, t);
  }
  return t;
}

export function disposeTextureCache(): void {
  texCache.forEach((t) => t.dispose());
  texCache.clear();
}

// ---------------------------------------------------------------------------
// Canvas drawing helpers
// ---------------------------------------------------------------------------

export function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, inner = 0.47, points = 5): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i / (points * 2)) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : r * inner;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Crescent opening to the right. */
export function moonPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const a0 = Math.PI * 0.32;
  const ox = r * 0.48;
  const ex = Math.cos(a0) * r;
  const ey = Math.sin(a0) * r;
  const ir = Math.hypot(ex - ox, ey);
  ctx.beginPath();
  ctx.arc(cx, cy, r, a0, Math.PI * 2 - a0, false);
  ctx.arc(cx + ox, cy, ir, Math.atan2(-ey, ex - ox), Math.atan2(ey, ex - ox), true);
  ctx.closePath();
}

export function emblemPath(ctx: CanvasRenderingContext2D, emblem: 'star' | 'moon', cx: number, cy: number, r: number): void {
  if (emblem === 'star') starPath(ctx, cx, cy, r);
  else moonPath(ctx, cx - r * 0.12, cy, r);
}

/** Text with a thick outline, centered. */
export function outlinedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  stroke: string | null,
  strokeWidth = size * 0.16,
  maxWidth?: number,
): void {
  ctx.font = `${size}px ${FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let scale = 1;
  if (maxWidth) {
    const w = ctx.measureText(text).width;
    if (w > maxWidth) scale = maxWidth / w;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, 1);
  if (stroke) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = stroke;
    ctx.strokeText(text, 0, 0);
  }
  ctx.fillStyle = fill;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** Tiny bank pictogram (pediment + columns + base). */
export function bankIconPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx - s, cy - s * 0.35);
  ctx.lineTo(cx, cy - s);
  ctx.lineTo(cx + s, cy - s * 0.35);
  ctx.closePath();
  ctx.fill();
  const colW = s * 0.22;
  for (let i = 0; i < 4; i++) {
    const x = cx - s * 0.78 + i * s * 0.52;
    ctx.fillRect(x, cy - s * 0.25, colW, s * 0.85);
  }
  ctx.fillRect(cx - s * 1.0, cy + s * 0.62, s * 2.0, s * 0.22);
}

// ---------------------------------------------------------------------------
// Generic textures
// ---------------------------------------------------------------------------

/** White radial gradient (additive glows, light pools). */
export function radialGlowTexture(): THREE.Texture {
  return cachedTex('radialGlow', () =>
    makeCanvasTexture(128, 128, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.14)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }),
  );
}

/** Soft dark blob for contact shadows under characters and loot. */
export function blobShadowTexture(): THREE.Texture {
  return cachedTex('blobShadow', () =>
    makeCanvasTexture(128, 128, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(40,24,48,0.55)');
      g.addColorStop(0.55, 'rgba(40,24,48,0.32)');
      g.addColorStop(1, 'rgba(40,24,48,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }),
  );
}

/** Bright dashed band (marked floor range). u repeats every dash period. */
export function dashedLineTexture(): THREE.Texture {
  return cachedTex('dashed', () =>
    makeCanvasTexture(
      128,
      32,
      (ctx, w, h) => {
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = PAL.ink;
        roundRectPath(ctx, 6, 3, w * 0.62, h - 6, 8);
        ctx.fill();
        ctx.fillStyle = '#FFE14D';
        roundRectPath(ctx, 10, 7, w * 0.62 - 8, h - 14, 6);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillRect(14, 9, w * 0.62 - 18, 4);
      },
      { repeat: true },
    ),
  );
}

// ---------------------------------------------------------------------------
// Raccoon face decals
// ---------------------------------------------------------------------------

export type FaceExpression = 'normal' | 'blink' | 'happy' | 'cheer' | 'strain' | 'dizzy' | 'sad' | 'sly' | 'slyBlink';

/**
 * The face decal is a sphere patch: phi (around Y) spans FACE_DECAL.phiLength centred on
 * the facing direction, theta (from the top) spans [thetaStart, thetaStart + thetaLength].
 * Faces are drawn in "angle space" (1 unit = 1 radian) so features stay round on the head.
 */
export const FACE_DECAL = { phiLength: 2.3, thetaStart: 0.8, thetaLength: 1.45, width: 512, height: 324 } as const;

const FACE = {
  eyeX: 0.37,
  eyeY: 0.42,
  eyeRX: 0.155,
  eyeRY: 0.2,
  mouthY: 1.12,
};

const INK = '#3A2E3A';
const LINE_LIGHT = '#FFF6E6';

function faceSpace(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const sx = w / FACE_DECAL.phiLength;
  const sy = h / FACE_DECAL.thetaLength;
  ctx.setTransform(sx, 0, 0, sy, w / 2, 0);
}

function drawFaceBase(ctx: CanvasRenderingContext2D): void {
  // Cream lower face (cheeks + chin) under the mask.
  ctx.fillStyle = PAL.cream;
  ctx.beginPath();
  ctx.ellipse(0, 0.86, 0.6, 0.36, 0, 0, Math.PI * 2);
  ctx.fill();
  // Cream brow patches.
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * 0.34, 0.15, 0.23, 0.085, s * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }
  // Dark forehead stripe down to the nose bridge.
  ctx.fillStyle = 'rgba(58,52,67,0.55)';
  ctx.beginPath();
  ctx.ellipse(0, 0.12, 0.045, 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  // Bandit mask: two slanted patches joined by a bridge.
  ctx.fillStyle = PAL.mask;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * 0.38, 0.45, 0.33, 0.235, s * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.ellipse(0, 0.53, 0.2, 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  // Blush.
  ctx.fillStyle = 'rgba(255,140,165,0.75)';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * 0.62, 0.78, 0.11, 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawEyeOpen(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1, lookDown = 0): void {
  const rx = FACE.eyeRX * scale;
  const ry = FACE.eyeRY * scale;
  // Soft light rim to separate the eye from the dark mask.
  ctx.fillStyle = 'rgba(255,246,230,0.85)';
  ctx.beginPath();
  ctx.ellipse(x, y, rx + 0.022, ry + 0.022, 0, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createLinearGradient(0, y - ry, 0, y + ry);
  g.addColorStop(0, '#16121C');
  g.addColorStop(0.65, '#2A2036');
  g.addColorStop(1, '#5A3F6E');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  // Big + small catchlights.
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.ellipse(x - rx * 0.32, y - ry * 0.38 + lookDown, rx * 0.4, ry * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + rx * 0.35, y + ry * 0.42 + lookDown * 0.5, rx * 0.17, ry * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();
}

function strokeStyle(ctx: CanvasRenderingContext2D, color: string, width: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

function drawMouth(ctx: CanvasRenderingContext2D, kind: FaceExpression): void {
  const y = FACE.mouthY;
  strokeStyle(ctx, INK, 0.028);
  switch (kind) {
    case 'happy':
    case 'cheer': {
      ctx.fillStyle = '#7A2E45';
      ctx.beginPath();
      ctx.moveTo(-0.13, y - 0.03);
      ctx.quadraticCurveTo(0, y - 0.01, 0.13, y - 0.03);
      ctx.quadraticCurveTo(0.1, y + 0.16, 0, y + 0.16);
      ctx.quadraticCurveTo(-0.1, y + 0.16, -0.13, y - 0.03);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#FF8FA3';
      ctx.beginPath();
      ctx.ellipse(0, y + 0.11, 0.06, 0.035, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'strain': {
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.ellipse(0, y + 0.02, 0.14, 0.05, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 0.016;
      for (const x of [-0.07, 0, 0.07]) {
        ctx.beginPath();
        ctx.moveTo(x, y - 0.025);
        ctx.lineTo(x, y + 0.065);
        ctx.stroke();
      }
      break;
    }
    case 'dizzy': {
      ctx.beginPath();
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        const x = -0.14 + t * 0.28;
        const yy = y + Math.sin(t * Math.PI * 3) * 0.025;
        if (i === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
      break;
    }
    case 'sad': {
      ctx.beginPath();
      ctx.moveTo(-0.09, y + 0.05);
      ctx.quadraticCurveTo(0, y - 0.04, 0.09, y + 0.05);
      ctx.stroke();
      break;
    }
    case 'sly':
    case 'slyBlink': {
      ctx.beginPath();
      ctx.moveTo(-0.1, y + 0.01);
      ctx.quadraticCurveTo(0.02, y + 0.05, 0.12, y - 0.04);
      ctx.stroke();
      break;
    }
    default: {
      // 'ω' smile
      ctx.beginPath();
      ctx.moveTo(-0.11, y - 0.01);
      ctx.quadraticCurveTo(-0.055, y + 0.07, 0, y);
      ctx.quadraticCurveTo(0.055, y + 0.07, 0.11, y - 0.01);
      ctx.stroke();
    }
  }
}

function drawFace(ctx: CanvasRenderingContext2D, w: number, h: number, kind: FaceExpression): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  faceSpace(ctx, w, h);
  drawFaceBase(ctx);
  const ex = FACE.eyeX;
  const ey = FACE.eyeY;
  switch (kind) {
    case 'normal':
      drawEyeOpen(ctx, -ex, ey);
      drawEyeOpen(ctx, ex, ey);
      break;
    case 'blink':
    case 'slyBlink':
      strokeStyle(ctx, LINE_LIGHT, 0.04);
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * ex - 0.12, ey + 0.01);
        ctx.quadraticCurveTo(s * ex, ey + 0.09, s * ex + 0.12, ey + 0.01);
        ctx.stroke();
      }
      break;
    case 'happy':
    case 'cheer':
      strokeStyle(ctx, LINE_LIGHT, 0.048);
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * ex - 0.13, ey + 0.06);
        ctx.quadraticCurveTo(s * ex, ey - 0.14, s * ex + 0.13, ey + 0.06);
        ctx.stroke();
      }
      break;
    case 'strain':
      strokeStyle(ctx, LINE_LIGHT, 0.05);
      // viewer-left eye '>' and viewer-right eye '<'
      ctx.beginPath();
      ctx.moveTo(-ex - 0.11, ey - 0.1);
      ctx.lineTo(-ex + 0.09, ey);
      ctx.lineTo(-ex - 0.11, ey + 0.1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ex + 0.11, ey - 0.1);
      ctx.lineTo(ex - 0.09, ey);
      ctx.lineTo(ex + 0.11, ey + 0.1);
      ctx.stroke();
      break;
    case 'dizzy':
      strokeStyle(ctx, LINE_LIGHT, 0.032);
      for (const s of [-1, 1]) {
        ctx.beginPath();
        const turns = 2.4;
        for (let i = 0; i <= 60; i++) {
          const t = i / 60;
          const a = t * turns * Math.PI * 2 * s;
          const r = 0.01 + t * 0.15;
          const x = s * ex + Math.cos(a) * r;
          const y = ey + Math.sin(a) * r * 1.15;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      break;
    case 'sad':
      drawEyeOpen(ctx, -ex, ey + 0.03, 0.88, 0.04);
      drawEyeOpen(ctx, ex, ey + 0.03, 0.88, 0.04);
      // Droopy lids (mask colored) slanting down toward the outside.
      ctx.fillStyle = PAL.mask;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * (ex - 0.2), ey - 0.06);
        ctx.lineTo(s * (ex + 0.2), ey - 0.0);
        ctx.lineTo(s * (ex + 0.2), ey - 0.3);
        ctx.lineTo(s * (ex - 0.2), ey - 0.3);
        ctx.closePath();
        ctx.fill();
      }
      // Worried brows.
      strokeStyle(ctx, LINE_LIGHT, 0.04);
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * (ex - 0.14), ey - 0.12);
        ctx.lineTo(s * (ex + 0.12), ey - 0.03);
        ctx.stroke();
      }
      // Tear.
      ctx.fillStyle = '#8FD8FF';
      ctx.beginPath();
      ctx.moveTo(ex + 0.13, ey + 0.13);
      ctx.quadraticCurveTo(ex + 0.2, ey + 0.26, ex + 0.13, ey + 0.29);
      ctx.quadraticCurveTo(ex + 0.06, ey + 0.26, ex + 0.13, ey + 0.13);
      ctx.fill();
      break;
    case 'sly':
      drawEyeOpen(ctx, -ex, ey + 0.02, 0.95);
      drawEyeOpen(ctx, ex, ey + 0.02, 0.95);
      // Heavy half-closed lids.
      for (const s of [-1, 1]) {
        ctx.fillStyle = PAL.mask;
        ctx.beginPath();
        ctx.ellipse(s * ex, ey - 0.13, 0.22, 0.17, s * -0.12, 0, Math.PI * 2);
        ctx.fill();
        strokeStyle(ctx, LINE_LIGHT, 0.034);
        ctx.beginPath();
        ctx.moveTo(s * ex - 0.17, ey + 0.0 + s * 0.012);
        ctx.quadraticCurveTo(s * ex, ey + 0.035, s * ex + 0.17, ey - s * 0.012);
        ctx.stroke();
      }
      break;
  }
  drawMouth(ctx, kind);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

export function faceTexture(kind: FaceExpression): THREE.Texture {
  return cachedTex(`face|${kind}`, () =>
    makeCanvasTexture(FACE_DECAL.width, FACE_DECAL.height, (ctx, w, h) => drawFace(ctx, w, h, kind)),
  );
}

/** Domino mask overlay for the 'nunchiMask' hat (same decal mapping as the face). */
export function nunchiMaskTexture(): THREE.Texture {
  return cachedTex('nunchiMask', () =>
    makeCanvasTexture(FACE_DECAL.width, FACE_DECAL.height, (ctx, w, h) => {
      faceSpace(ctx, w, h);
      const ex = FACE.eyeX;
      const ey = FACE.eyeY;
      ctx.fillStyle = '#7B4FC9';
      ctx.beginPath();
      ctx.moveTo(-0.92, ey - 0.2);
      ctx.quadraticCurveTo(-0.5, ey - 0.36, 0, ey - 0.2);
      ctx.quadraticCurveTo(0.5, ey - 0.36, 0.92, ey - 0.2);
      ctx.quadraticCurveTo(0.74, ey + 0.08, 0.6, ey + 0.2);
      ctx.quadraticCurveTo(0.3, ey + 0.32, 0.08, ey + 0.16);
      ctx.quadraticCurveTo(0, ey + 0.08, -0.08, ey + 0.16);
      ctx.quadraticCurveTo(-0.3, ey + 0.32, -0.6, ey + 0.2);
      ctx.quadraticCurveTo(-0.74, ey + 0.08, -0.92, ey - 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#4E2E8C';
      ctx.lineWidth = 0.025;
      ctx.stroke();
      // Eye holes.
      ctx.globalCompositeOperation = 'destination-out';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(s * ex, ey + 0.02, FACE.eyeRX + 0.045, FACE.eyeRY + 0.03, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      // Shine.
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 0.022;
      ctx.beginPath();
      ctx.moveTo(-0.7, ey - 0.2);
      ctx.quadraticCurveTo(-0.45, ey - 0.28, -0.2, ey - 0.2);
      ctx.stroke();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }),
  );
}

// ---------------------------------------------------------------------------
// Loot value plates, bank sign, fence icon
// ---------------------------------------------------------------------------

/** Gold value plate ('100' / '300' ...). Aspect 2:1. */
export function valuePlateTexture(value: number): THREE.Texture {
  const text = String(value);
  return cachedTex(`plate|${text}`, () =>
    makeCanvasTexture(
      256,
      128,
      (ctx, w, h) => {
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = PAL.goldDark;
        roundRectPath(ctx, 4, 4, w - 8, h - 8, 26);
        ctx.fill();
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#FFE9A6');
        g.addColorStop(1, PAL.gold);
        ctx.fillStyle = g;
        roundRectPath(ctx, 12, 12, w - 24, h - 24, 20);
        ctx.fill();
        // Corner rivets.
        ctx.fillStyle = PAL.goldDark;
        for (const [x, y] of [
          [26, 26],
          [w - 26, 26],
          [26, h - 26],
          [w - 26, h - 26],
        ]) {
          ctx.beginPath();
          ctx.arc(x, y, 6, 0, Math.PI * 2);
          ctx.fill();
        }
        outlinedText(ctx, text, w / 2, h / 2 + 4, 92, '#5A3A12', '#FFF6D8', 12, w - 70);
      },
      { fontText: text },
    ),
  );
}

/** Round gold coin with the value, used on safe tops (kept upright toward the camera). */
export function valueCoinTexture(value: number): THREE.Texture {
  const text = String(value);
  return cachedTex(`coin|${text}`, () =>
    makeCanvasTexture(
      256,
      256,
      (ctx, w, h) => {
        ctx.clearRect(0, 0, w, h);
        const cx = w / 2;
        const cy = h / 2;
        ctx.fillStyle = PAL.goldDark;
        ctx.beginPath();
        ctx.arc(cx, cy, 124, 0, Math.PI * 2);
        ctx.fill();
        const g = ctx.createRadialGradient(cx - 30, cy - 40, 10, cx, cy, 118);
        g.addColorStop(0, '#FFF1B8');
        g.addColorStop(1, PAL.gold);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, 112, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(200,143,37,0.9)';
        ctx.lineWidth = 6;
        ctx.setLineDash([10, 9]);
        ctx.beginPath();
        ctx.arc(cx, cy, 98, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        outlinedText(ctx, text, cx, cy + 6, text.length > 3 ? 74 : 92, '#5A3A12', '#FFF6D8', 12, 190);
      },
      { fontText: text },
    ),
  );
}

/** "은행 BANK" sign board (double-sided usage: mapped on both faces). */
export function bankSignTexture(): THREE.Texture {
  return cachedTex('bankSign', () =>
    makeCanvasTexture(
      512,
      224,
      (ctx, w, h) => {
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = PAL.goldDark;
        roundRectPath(ctx, 0, 0, w, h, 48);
        ctx.fill();
        ctx.fillStyle = PAL.gold;
        roundRectPath(ctx, 8, 8, w - 16, h - 16, 42);
        ctx.fill();
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#356F84');
        g.addColorStop(1, '#244E66');
        ctx.fillStyle = g;
        roundRectPath(ctx, 22, 22, w - 44, h - 44, 32);
        ctx.fill();
        // Coins on both sides.
        for (const x of [70, w - 70]) {
          ctx.fillStyle = PAL.goldDark;
          ctx.beginPath();
          ctx.arc(x, h / 2 + 3, 32, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = PAL.gold;
          ctx.beginPath();
          ctx.arc(x, h / 2, 30, 0, Math.PI * 2);
          ctx.fill();
          outlinedText(ctx, '₩', x, h / 2 + 2, 38, PAL.goldDark, null);
        }
        outlinedText(ctx, '은행', w / 2, h * 0.42, 104, '#FFE9A8', '#173445', 14);
        outlinedText(ctx, 'BANK', w / 2, h * 0.78, 40, PAL.gold, '#173445', 8);
      },
      { fontText: '은행 BANK ₩' },
    ),
  );
}

/** Round warning plate with a bank pictogram: "a bank can break through here". */
export function fenceIconTexture(): THREE.Texture {
  return cachedTex('fenceIcon', () =>
    makeCanvasTexture(128, 128, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = PAL.ink;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 62, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFE14D';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 55, 0, Math.PI * 2);
      ctx.fill();
      bankIconPath(ctx, w / 2, h / 2 + 2, 30, PAL.ink);
      // Crack zig-zag: "breakable".
      ctx.strokeStyle = '#E85D6A';
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(w / 2 + 28, 18);
      ctx.lineTo(w / 2 + 14, 40);
      ctx.lineTo(w / 2 + 30, 50);
      ctx.lineTo(w / 2 + 16, 72);
      ctx.stroke();
    }),
  );
}

// ---------------------------------------------------------------------------
// Ground textures
// ---------------------------------------------------------------------------

export type GroundStyle = 'plaza' | 'arcade' | 'square' | 'practice';

/** Repeating paving texture; one repeat covers PAVING_TILE_METERS. */
export const PAVING_TILE_METERS = 4;

export function pavingTexture(style: GroundStyle): THREE.Texture {
  return cachedTex(`paving|${style}`, () =>
    makeCanvasTexture(
      512,
      512,
      (ctx, w, h) => {
        const r = rng(hashString(style));
        const shade = (base: string, amt: number): string => {
          const c = new THREE.Color(base);
          c.offsetHSL(0, 0, amt);
          return `#${c.getHexString()}`;
        };
        if (style === 'arcade') {
          // Running-bond bricks (0.25 m x 0.5 m).
          const bh = h / 16;
          const bw = w / 8;
          ctx.fillStyle = '#D9A994';
          ctx.fillRect(0, 0, w, h);
          for (let row = 0; row < 16; row++) {
            const off = row % 2 ? bw / 2 : 0;
            for (let col = -1; col < 9; col++) {
              ctx.fillStyle = shade('#EBC0A8', (r() - 0.5) * 0.06);
              ctx.fillRect(col * bw + off + 2, row * bh + 2, bw - 4, bh - 4);
            }
          }
        } else if (style === 'square') {
          // Diamond tiles, two tones.
          ctx.fillStyle = PAL.pavingLine;
          ctx.fillRect(0, 0, w, h);
          const n = 4;
          const s = w / n;
          for (let i = -1; i <= n; i++) {
            for (let j = -1; j <= n; j++) {
              const cx = i * s + (j % 2 ? s / 2 : 0);
              const cy = j * (s / 2);
              ctx.fillStyle = shade((i + j) % 3 === 0 ? '#EFE3F2' : PAL.paving, (r() - 0.5) * 0.04);
              ctx.beginPath();
              ctx.moveTo(cx, cy - s / 2 + 3);
              ctx.lineTo(cx + s / 2 - 3, cy);
              ctx.lineTo(cx, cy + s / 2 - 3);
              ctx.lineTo(cx - s / 2 + 3, cy);
              ctx.closePath();
              ctx.fill();
            }
          }
        } else if (style === 'practice') {
          ctx.fillStyle = '#B9C6E0';
          ctx.fillRect(0, 0, w, h);
          const n = 4;
          const s = w / n;
          for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
              ctx.fillStyle = (i + j) % 2 ? '#C7D3EA' : '#BCC9E3';
              ctx.fillRect(i * s + 3, j * s + 3, s - 6, s - 6);
            }
          }
        } else {
          // plaza: 0.5 m square stones with soft variation and a few accent tiles.
          ctx.fillStyle = PAL.pavingLine;
          ctx.fillRect(0, 0, w, h);
          const n = 8;
          const s = w / n;
          for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
              const accent = r() < 0.06;
              ctx.fillStyle = accent ? shade('#E8D3C0', -0.04) : shade(PAL.paving, (r() - 0.5) * 0.05);
              roundRectPath(ctx, i * s + 2.5, j * s + 2.5, s - 5, s - 5, 5);
              ctx.fill();
              // subtle top-left highlight for a soft chunky look
              ctx.fillStyle = 'rgba(255,255,255,0.18)';
              ctx.fillRect(i * s + 6, j * s + 5, s - 14, 3);
            }
          }
        }
      },
      { repeat: true, anisotropy: 8 },
    ),
  );
}

/** Outer street asphalt with soft speckles. */
export function asphaltTexture(): THREE.Texture {
  return cachedTex('asphalt', () =>
    makeCanvasTexture(
      256,
      256,
      (ctx, w, h) => {
        ctx.fillStyle = PAL.asphalt;
        ctx.fillRect(0, 0, w, h);
        const r = rng(7);
        for (let i = 0; i < 500; i++) {
          ctx.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
          ctx.fillRect(r() * w, r() * h, 2 + r() * 3, 2 + r() * 3);
        }
      },
      { repeat: true },
    ),
  );
}

/** Bank interior floor: checker tiles + door mats; covers the full 8 x 6 footprint. */
export function bankFloorTexture(): THREE.Texture {
  return cachedTex('bankFloor', () =>
    makeCanvasTexture(1024, 768, (ctx, w, h) => {
      const ppm = w / 8; // pixels per meter
      ctx.fillStyle = '#E9DCC4';
      ctx.fillRect(0, 0, w, h);
      // Checker 0.6 m tiles inside a border band.
      const t = 0.6 * ppm;
      const x0 = 0.55 * ppm;
      const y0 = 0.55 * ppm;
      const x1 = w - 0.55 * ppm;
      const y1 = h - 0.55 * ppm;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, x1 - x0, y1 - y0);
      ctx.clip();
      const cx = w / 2;
      const cy = h / 2;
      for (let i = -8; i <= 8; i++) {
        for (let j = -6; j <= 6; j++) {
          ctx.fillStyle = (i + j) % 2 === 0 ? PAL.floorA : PAL.floorB;
          roundRectPath(ctx, cx + i * t - t / 2 + 1.5, cy + j * t - t / 2 + 1.5, t - 3, t - 3, 4);
          ctx.fill();
        }
      }
      ctx.restore();
      ctx.strokeStyle = PAL.goldDark;
      ctx.lineWidth = 6;
      ctx.strokeRect(x0 - 3, y0 - 3, x1 - x0 + 6, y1 - y0 + 6);
      // Central medallion (coin) painted on the floor.
      ctx.fillStyle = 'rgba(246,198,79,0.9)';
      ctx.beginPath();
      ctx.arc(cx, cy, 0.7 * ppm, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(200,143,37,0.9)';
      ctx.beginPath();
      ctx.arc(cx, cy, 0.55 * ppm, 0, Math.PI * 2);
      ctx.fill();
      starPath(ctx, cx, cy, 0.4 * ppm);
      ctx.fillStyle = 'rgba(255,233,166,0.95)';
      ctx.fill();
      // Door mats at both door gaps (local ±y edges -> canvas top/bottom).
      for (const yy of [0, h - 0.95 * ppm]) {
        ctx.fillStyle = '#C9566E';
        roundRectPath(ctx, cx - 1.0 * ppm, yy + 0.1 * ppm, 2.0 * ppm, 0.85 * ppm, 12);
        ctx.fill();
        ctx.strokeStyle = PAL.gold;
        ctx.lineWidth = 5;
        roundRectPath(ctx, cx - 0.9 * ppm, yy + 0.2 * ppm, 1.8 * ppm, 0.65 * ppm, 10);
        ctx.stroke();
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// Zone marker paint
// ---------------------------------------------------------------------------

/** Painted recovery zone (team stripes + emblem + label). Size in meters. */
export function zoneTexture(team: TeamId, sizeX: number, sizeY: number, label = '회수 구역'): THREE.Texture {
  const key = `zone|${team}|${sizeX.toFixed(2)}|${sizeY.toFixed(2)}|${label}`;
  return cachedTex(key, () => {
    const ppm = Math.min(64, 1024 / Math.max(sizeX, sizeY));
    const w = Math.round(sizeX * ppm);
    const h = Math.round(sizeY * ppm);
    const style = TEAM_STYLES[team];
    return makeCanvasTexture(
      w,
      h,
      (ctx) => {
        ctx.clearRect(0, 0, w, h);
        const band = 0.55 * ppm;
        // Inner tint.
        ctx.fillStyle = hexA(style.tint, 0.42);
        roundRectPath(ctx, band, band, w - band * 2, h - band * 2, 0.5 * ppm);
        ctx.fill();
        // Hazard stripes border.
        ctx.save();
        roundRectPath(ctx, 0, 0, w, h, 0.7 * ppm);
        ctx.clip();
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = style.color;
        const step = 0.6 * ppm;
        for (let x = -h; x < w + h; x += step * 2) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x + step, 0);
          ctx.lineTo(x + step - h, h);
          ctx.lineTo(x - h, h);
          ctx.closePath();
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'destination-out';
        roundRectPath(ctx, band, band, w - band * 2, h - band * 2, 0.5 * ppm);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.restore();
        // Inner tint again (destination-out removed it).
        ctx.fillStyle = hexA(style.tint, 0.38);
        roundRectPath(ctx, band, band, w - band * 2, h - band * 2, 0.5 * ppm);
        ctx.fill();
        ctx.strokeStyle = style.dark;
        ctx.lineWidth = 0.08 * ppm;
        roundRectPath(ctx, band, band, w - band * 2, h - band * 2, 0.5 * ppm);
        ctx.stroke();
        // Corner brackets (shape cue independent of color).
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 0.18 * ppm;
        ctx.lineCap = 'round';
        const L = 1.1 * ppm;
        const m = band + 0.45 * ppm;
        for (const [cx, cy, sx, sy] of [
          [m, m, 1, 1],
          [w - m, m, -1, 1],
          [m, h - m, 1, -1],
          [w - m, h - m, -1, -1],
        ]) {
          ctx.beginPath();
          ctx.moveTo(cx, cy + sy * L);
          ctx.lineTo(cx, cy);
          ctx.lineTo(cx + sx * L, cy);
          ctx.stroke();
        }
        // Big emblem.
        const er = Math.min(w, h) * 0.2;
        emblemPath(ctx, style.emblem, w / 2, h / 2 - er * 0.22, er + 0.12 * ppm);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        emblemPath(ctx, style.emblem, w / 2, h / 2 - er * 0.22, er);
        ctx.fillStyle = style.color;
        ctx.fill();
        ctx.strokeStyle = style.dark;
        ctx.lineWidth = 0.06 * ppm;
        ctx.stroke();
        outlinedText(ctx, label, w / 2, h / 2 + er * 1.05, 0.9 * ppm, style.dark, '#FFFFFF', 0.2 * ppm, w * 0.7);
      },
      { fontText: label },
    );
  });
}

/** CSS hex + alpha -> rgba(). */
export function hexA(hex: string, a: number): string {
  const c = new THREE.Color(hex);
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
}

// ---------------------------------------------------------------------------
// Shop sign atlas (scenery): every sign of a layout in one texture -> one draw call
// ---------------------------------------------------------------------------

export interface SignEntry {
  text: string;
  bg: string;
  fg: string;
  icon?: SignIcon;
  /** Optional live text source, re-evaluated by refresh() (language changes). */
  source?: () => string;
}

/** Sign slots are 4:1 (e.g. 2.4 m x 0.6 m boards). */
export class SignAtlas {
  readonly slotW = 512;
  readonly slotH = 128;
  readonly texture: THREE.Texture;
  private entries: SignEntry[] = [];
  private canvas: HTMLCanvasElement | null = null;

  constructor(
    readonly cols = 4,
    readonly rows = 16,
  ) {
    if (HAS_DOM) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = this.cols * this.slotW;
      this.canvas.height = this.rows * this.slotH;
      const tex = new THREE.CanvasTexture(this.canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      this.texture = tex;
    } else {
      this.texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    }
  }

  get capacity(): number {
    return this.cols * this.rows;
  }

  /** Register a sign; returns the uv rect [u0, v0, u1, v1] (flipY-aware). */
  add(entry: SignEntry): readonly [number, number, number, number] {
    const i = Math.min(this.entries.length, this.capacity - 1);
    if (this.entries.length < this.capacity) this.entries.push(entry);
    const col = i % this.cols;
    const row = Math.floor(i / this.cols);
    const pad = 2 / (this.cols * this.slotW);
    const u0 = col / this.cols + pad;
    const u1 = (col + 1) / this.cols - pad;
    const v1 = 1 - row / this.rows - pad;
    const v0 = 1 - (row + 1) / this.rows + pad;
    return [u0, v0, u1, v1];
  }

  /** Draw all slots (call after adding; again whenever the text changes). */
  redraw(): void {
    for (const e of this.entries) if (e.source) e.text = e.source();
    if (!this.canvas) return;
    const ctx = this.canvas.getContext('2d')!;
    const draw = (): void => {
      ctx.clearRect(0, 0, this.canvas!.width, this.canvas!.height);
      this.entries.forEach((e, i) => {
        const x = (i % this.cols) * this.slotW;
        const y = Math.floor(i / this.cols) * this.slotH;
        drawSignSlot(ctx, x, y, this.slotW, this.slotH, e);
      });
      this.texture.needsUpdate = true;
    };
    draw();
    void loadJua(this.entries.map((e) => e.text).join('')).then((ok) => ok && draw());
  }

  /** Re-evaluate every entry's text source and redraw (language switch). */
  refresh(): void {
    this.redraw();
  }

  dispose(): void {
    this.texture.dispose();
  }
}

function drawSignSlot(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, e: SignEntry): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#4A3A40';
  roundRectPath(ctx, 4, 4, w - 8, h - 8, 30);
  ctx.fill();
  ctx.fillStyle = e.bg;
  roundRectPath(ctx, 10, 10, w - 20, h - 20, 25);
  ctx.fill();
  const iconW = e.icon && e.icon !== 'none' ? h * 0.7 : 0;
  if (iconW) drawSignIcon(ctx, 22 + iconW / 2, h / 2, iconW * 0.42, e.icon!, e.fg);
  const tx = (w + iconW) / 2 + (iconW ? 6 : 0);
  outlinedText(ctx, e.text, tx, h / 2 + 3, h * 0.56, e.fg, null, 0, w - iconW - 60);
  ctx.restore();
}

function drawSignIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, icon: NonNullable<SignEntry['icon']>, color: string): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = r * 0.22;
  ctx.lineCap = 'round';
  switch (icon) {
    case 'cup':
      roundRectPath(ctx, cx - r * 0.7, cy - r * 0.4, r * 1.2, r * 1.1, r * 0.25);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + r * 0.55, cy + r * 0.1, r * 0.32, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.3, cy - r * 0.6);
      ctx.quadraticCurveTo(cx - r * 0.1, cy - r * 0.9, cx - r * 0.2, cy - r * 1.1);
      ctx.stroke();
      break;
    case 'bread':
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      for (const dx of [-0.4, 0, 0.4]) {
        ctx.beginPath();
        ctx.moveTo(cx + r * dx - r * 0.12, cy - r * 0.3);
        ctx.lineTo(cx + r * dx + r * 0.12, cy + r * 0.3);
        ctx.stroke();
      }
      break;
    case 'star':
      starPath(ctx, cx, cy, r);
      ctx.fill();
      break;
    case 'flower':
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.5, r * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#FFE14D';
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'book':
      ctx.fillRect(cx - r * 0.9, cy - r * 0.6, r * 0.85, r * 1.2);
      ctx.fillRect(cx + r * 0.05, cy - r * 0.6, r * 0.85, r * 1.2);
      break;
    case 'fork':
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.3, cy + r);
      ctx.lineTo(cx - r * 0.3, cy - r);
      ctx.moveTo(cx + r * 0.3, cy + r);
      ctx.lineTo(cx + r * 0.3, cy - r * 0.2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cx + r * 0.3, cy - r * 0.55, r * 0.25, r * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'note':
      ctx.beginPath();
      ctx.ellipse(cx - r * 0.35, cy + r * 0.55, r * 0.32, r * 0.24, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.06, cy + r * 0.5);
      ctx.lineTo(cx - r * 0.06, cy - r * 0.9);
      ctx.quadraticCurveTo(cx + r * 0.5, cy - r * 0.6, cx + r * 0.6, cy - r * 0.2);
      ctx.stroke();
      break;
    case 'cone':
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.45, cy - r * 0.1);
      ctx.lineTo(cx + r * 0.45, cy - r * 0.1);
      ctx.lineTo(cx, cy + r * 1.0);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy - r * 0.35, r * 0.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'bowl':
      ctx.beginPath();
      ctx.arc(cx, cy - r * 0.1, r * 0.9, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + r * 0.2, cy - r * 0.3);
      ctx.lineTo(cx + r * 0.8, cy - r * 1.1);
      ctx.moveTo(cx + r * 0.45, cy - r * 0.3);
      ctx.lineTo(cx + r * 1.0, cy - r * 0.95);
      ctx.stroke();
      break;
    case 'bubbles':
      for (const [dx, dy, rr] of [
        [-0.35, 0.25, 0.45],
        [0.35, -0.1, 0.38],
        [-0.05, -0.55, 0.28],
      ]) {
        ctx.beginPath();
        ctx.arc(cx + dx * r, cy + dy * r, rr * r, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    case 'leaf':
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 0.45, r * 0.9, 0.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'cross':
      ctx.fillRect(cx - r * 0.25, cy - r * 0.8, r * 0.5, r * 1.6);
      ctx.fillRect(cx - r * 0.8, cy - r * 0.25, r * 1.6, r * 0.5);
      break;
    case 'wheel':
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI;
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(a) * r * 0.8, cy - Math.sin(a) * r * 0.8);
        ctx.lineTo(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8);
        ctx.stroke();
      }
      break;
    case 'mail':
      ctx.fillRect(cx - r * 0.9, cy - r * 0.55, r * 1.8, r * 1.1);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.85, cy - r * 0.5);
      ctx.lineTo(cx, cy + r * 0.1);
      ctx.lineTo(cx + r * 0.85, cy - r * 0.5);
      ctx.stroke();
      break;
    default:
      break;
  }
}
