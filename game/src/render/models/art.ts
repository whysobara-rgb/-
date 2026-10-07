/**
 * Hand-authored canvas art for the presentation pass (all original, drawn in code):
 *  - the pompous cat-banker portrait hanging in the bank,
 *  - the bank carpet: marble checker, red runner door to door, treasure medallions under the
 *    safe spots and the bank's own crest (keyhole shield, coin pair, three-bump crown),
 *  - a raccoon "수배 WANTED" poster (environmental storytelling),
 *  - the uproot crack decal (data texture: R crack mask, G growth order, B crater mask,
 *    A crack rim) used by uproot.ts,
 *  - the emote sticker atlas (no emoji: every icon is drawn with the same ink line weight and
 *    corner radius, sticker style: ink outline + white border).
 */
import * as THREE from 'three';
import { FONT_STACK, makeCanvasTexture, outlinedText, roundRectPath } from './textures';
import { PAL } from './palette';
import { rng } from './geometry';

const HAS_DOM = typeof document !== 'undefined' && typeof document.createElement === 'function';

const cache = new Map<string, THREE.Texture>();
function cached(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = cache.get(key);
  if (!t) {
    t = make();
    t.name = key;
    cache.set(key, t);
  }
  return t;
}

export function disposeArtCache(): void {
  cache.forEach((t) => t.dispose());
  cache.clear();
}

const INK = '#2A2131';

// ---------------------------------------------------------------------------
// Crest (shared by carpet, plaques)
// ---------------------------------------------------------------------------

/** The bank's own crest: rounded shield, keyhole, two coins, three-bump crown, ribbon. */
export function drawBankCrest(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s / 100, s / 100);
  ctx.lineJoin = 'round';
  // Crown (three round bumps on a band).
  ctx.fillStyle = PAL.gold;
  ctx.strokeStyle = '#7A5A16';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-42, -78);
  ctx.lineTo(-42, -100);
  ctx.arc(-28, -104, 13, Math.PI, 0);
  ctx.arc(0, -112, 15, Math.PI, 0);
  ctx.arc(28, -104, 13, Math.PI, 0);
  ctx.lineTo(42, -78);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Shield.
  const shield = (): void => {
    ctx.beginPath();
    ctx.moveTo(-62, -76);
    ctx.quadraticCurveTo(-62, -84, -54, -84);
    ctx.lineTo(54, -84);
    ctx.quadraticCurveTo(62, -84, 62, -76);
    ctx.lineTo(62, 4);
    ctx.quadraticCurveTo(58, 52, 0, 84);
    ctx.quadraticCurveTo(-58, 52, -62, 4);
    ctx.closePath();
  };
  shield();
  ctx.fillStyle = '#7A5A16';
  ctx.fill();
  ctx.save();
  ctx.scale(0.86, 0.86);
  shield();
  const g = ctx.createLinearGradient(0, -84, 0, 84);
  g.addColorStop(0, '#2F7F78');
  g.addColorStop(1, '#1D5560');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
  // Keyhole.
  ctx.fillStyle = PAL.goldLight;
  ctx.beginPath();
  ctx.arc(0, -18, 17, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-9, -8);
  ctx.lineTo(9, -8);
  ctx.lineTo(14, 34);
  ctx.lineTo(-14, 34);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#1D5560';
  ctx.beginPath();
  ctx.arc(0, -18, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(-3.5, -14, 7, 36);
  // Coin pair.
  for (const sx of [-1, 1]) {
    ctx.fillStyle = PAL.goldDark;
    ctx.beginPath();
    ctx.arc(sx * 38, 10, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PAL.gold;
    ctx.beginPath();
    ctx.arc(sx * 38, 8, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PAL.goldDark;
    ctx.fillRect(sx * 38 - 1.5, 1, 3, 14);
  }
  // Ribbon.
  ctx.fillStyle = '#C9566E';
  ctx.strokeStyle = '#7E2B40';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-74, 62);
  ctx.quadraticCurveTo(0, 86, 74, 62);
  ctx.lineTo(80, 82);
  ctx.quadraticCurveTo(0, 106, -80, 82);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Bank carpet (covers the 8 x 6 m floor)
// ---------------------------------------------------------------------------

export function bankCarpetTexture(): THREE.Texture {
  return cached('art.bankCarpet', () =>
    makeCanvasTexture(1024, 768, (ctx, w, h) => {
      const ppm = w / 8;
      const r = rng(31);
      // Cream / mint marble checker.
      ctx.fillStyle = '#E2D4BC';
      ctx.fillRect(0, 0, w, h);
      const t = 0.6 * ppm;
      const cx = w / 2;
      const cy = h / 2;
      for (let i = -8; i <= 8; i++) {
        for (let j = -6; j <= 6; j++) {
          const light = (i + j) % 2 === 0;
          ctx.fillStyle = light ? '#F7EEDC' : '#9BD3C5';
          roundRectPath(ctx, cx + i * t - t / 2 + 1.5, cy + j * t - t / 2 + 1.5, t - 3, t - 3, 4);
          ctx.fill();
          // Marble veins.
          ctx.strokeStyle = light ? 'rgba(170,150,120,0.18)' : 'rgba(40,110,96,0.2)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          const x0 = cx + i * t - t / 2 + r() * t;
          const y0 = cy + j * t - t / 2;
          ctx.moveTo(x0, y0 + 4);
          ctx.bezierCurveTo(x0 + (r() - 0.5) * t, y0 + t * 0.3, x0 + (r() - 0.5) * t, y0 + t * 0.6, x0 + (r() - 0.5) * t * 0.6, y0 + t - 4);
          ctx.stroke();
        }
      }
      // Gold border band.
      ctx.strokeStyle = PAL.goldDark;
      ctx.lineWidth = 7;
      ctx.strokeRect(0.42 * ppm, 0.42 * ppm, w - 0.84 * ppm, h - 0.84 * ppm);
      ctx.strokeStyle = PAL.gold;
      ctx.lineWidth = 3;
      ctx.strokeRect(0.52 * ppm, 0.52 * ppm, w - 1.04 * ppm, h - 1.04 * ppm);
      // Red runner door to door (local y = canvas y), 2.1 m wide.
      const rw = 2.1 * ppm;
      ctx.fillStyle = '#A83A4E';
      ctx.fillRect(cx - rw / 2, 0, rw, h);
      ctx.fillStyle = '#C9566E';
      ctx.fillRect(cx - rw / 2 + 0.12 * ppm, 0, rw - 0.24 * ppm, h);
      // Runner pattern: little gold diamonds + border stitches.
      ctx.fillStyle = 'rgba(255,214,120,0.85)';
      for (let y = 0.3 * ppm; y < h; y += 0.42 * ppm) {
        for (const off of [-0.55, 0, 0.55]) {
          const x = cx + off * ppm;
          ctx.beginPath();
          ctx.moveTo(x, y - 7);
          ctx.lineTo(x + 7, y);
          ctx.lineTo(x, y + 7);
          ctx.lineTo(x - 7, y);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.strokeStyle = PAL.gold;
      ctx.lineWidth = 4;
      ctx.setLineDash([10, 8]);
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + sx * (rw / 2 - 0.2 * ppm), 0);
        ctx.lineTo(cx + sx * (rw / 2 - 0.2 * ppm), h);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      // Treasure medallions under the small safe spots (local x = ±2.8 m).
      for (const sx of [-1, 1]) {
        const mx = cx + sx * 2.8 * ppm;
        const rr = 0.72 * ppm;
        const g = ctx.createRadialGradient(mx, cy, rr * 0.2, mx, cy, rr);
        g.addColorStop(0, 'rgba(255,233,166,0.95)');
        g.addColorStop(0.7, 'rgba(246,198,79,0.9)');
        g.addColorStop(1, 'rgba(200,143,37,0.95)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(mx, cy, rr, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#8A6116';
        ctx.lineWidth = 4;
        ctx.stroke();
        // Sun rays.
        ctx.strokeStyle = 'rgba(138,97,22,0.55)';
        ctx.lineWidth = 3;
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(mx + Math.cos(a) * rr * 0.62, cy + Math.sin(a) * rr * 0.62);
          ctx.lineTo(mx + Math.cos(a) * rr * 0.9, cy + Math.sin(a) * rr * 0.9);
          ctx.stroke();
        }
      }
      // Crest on the runner by both doors.
      drawBankCrest(ctx, cx, 1.15 * ppm, 0.62 * ppm);
      ctx.save();
      ctx.translate(cx, h - 1.15 * ppm);
      ctx.rotate(Math.PI);
      drawBankCrest(ctx, 0, 0, 0.62 * ppm);
      ctx.restore();
      // Door mats.
      for (const yy of [0, h - 0.5 * ppm]) {
        ctx.fillStyle = '#5E4636';
        roundRectPath(ctx, cx - 1.0 * ppm, yy + 0.06 * ppm, 2.0 * ppm, 0.38 * ppm, 10);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,233,166,0.6)';
        ctx.lineWidth = 3;
        roundRectPath(ctx, cx - 0.92 * ppm, yy + 0.12 * ppm, 1.84 * ppm, 0.26 * ppm, 8);
        ctx.stroke();
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// Cat-banker portrait
// ---------------------------------------------------------------------------

export function catPortraitTexture(): THREE.Texture {
  return cached('art.catPortrait', () =>
    makeCanvasTexture(384, 300, (ctx, w, h) => {
      // Velvet backdrop.
      const bg = ctx.createRadialGradient(w / 2, h * 0.4, 20, w / 2, h / 2, w * 0.7);
      bg.addColorStop(0, '#3E7F75');
      bg.addColorStop(1, '#183F45');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      // Curtain swag.
      ctx.fillStyle = '#A83A4E';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w, 0);
      ctx.lineTo(w, 30);
      ctx.quadraticCurveTo(w * 0.75, 70, w / 2, 34);
      ctx.quadraticCurveTo(w * 0.25, 70, 0, 30);
      ctx.closePath();
      ctx.fill();
      const cx = w / 2;
      // Suit body.
      ctx.fillStyle = '#2E2A46';
      ctx.beginPath();
      ctx.moveTo(cx - 140, h);
      ctx.quadraticCurveTo(cx - 130, h * 0.62, cx, h * 0.6);
      ctx.quadraticCurveTo(cx + 130, h * 0.62, cx + 140, h);
      ctx.closePath();
      ctx.fill();
      // Shirt + lapels.
      ctx.fillStyle = '#FFF6E6';
      ctx.beginPath();
      ctx.moveTo(cx - 34, h * 0.62);
      ctx.lineTo(cx + 34, h * 0.62);
      ctx.lineTo(cx, h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#3F3A60';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + s * 34, h * 0.62);
        ctx.lineTo(cx + s * 70, h * 0.66);
        ctx.lineTo(cx + s * 12, h);
        ctx.closePath();
        ctx.fill();
      }
      // Bow tie.
      ctx.fillStyle = '#C9566E';
      ctx.beginPath();
      ctx.moveTo(cx, h * 0.66);
      ctx.lineTo(cx - 30, h * 0.6);
      ctx.lineTo(cx - 30, h * 0.73);
      ctx.closePath();
      ctx.moveTo(cx, h * 0.66);
      ctx.lineTo(cx + 30, h * 0.6);
      ctx.lineTo(cx + 30, h * 0.73);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, h * 0.665, 7, 0, Math.PI * 2);
      ctx.fill();
      // Head (round, chubby cheeks).
      const hy = h * 0.43;
      ctx.fillStyle = '#F2B97A';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + s * 40, hy - 52);
        ctx.lineTo(cx + s * 70, hy - 98);
        ctx.lineTo(cx + s * 84, hy - 30);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = '#F6C88E';
      ctx.beginPath();
      ctx.ellipse(cx, hy, 88, 72, 0, 0, Math.PI * 2);
      ctx.fill();
      // Tabby stripes.
      ctx.strokeStyle = '#D9905A';
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      for (const x of [-16, 0, 16]) {
        ctx.beginPath();
        ctx.moveTo(cx + x, hy - 70);
        ctx.lineTo(cx + x * 1.1, hy - 46);
        ctx.stroke();
      }
      // Inner ears.
      ctx.fillStyle = '#F2A0AE';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + s * 50, hy - 56);
        ctx.lineTo(cx + s * 68, hy - 86);
        ctx.lineTo(cx + s * 76, hy - 44);
        ctx.closePath();
        ctx.fill();
      }
      // Smug half-closed eyes.
      ctx.strokeStyle = INK;
      ctx.lineWidth = 6;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + s * 22, hy - 8);
        ctx.quadraticCurveTo(cx + s * 38, hy - 16, cx + s * 54, hy - 8);
        ctx.stroke();
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.ellipse(cx + s * 38, hy - 4, 9, 6, 0, 0, Math.PI);
        ctx.fill();
      }
      // Monocle on the right eye + chain.
      ctx.strokeStyle = PAL.gold;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(cx + 38, hy - 6, 19, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.arc(cx + 34, hy - 12, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx + 54, hy + 4);
      ctx.quadraticCurveTo(cx + 74, hy + 60, cx + 52, h * 0.7);
      ctx.stroke();
      // Nose, muzzle, mustache.
      ctx.fillStyle = '#FFF3DE';
      ctx.beginPath();
      ctx.ellipse(cx, hy + 26, 34, 22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#E87F8F';
      ctx.beginPath();
      ctx.moveTo(cx - 9, hy + 12);
      ctx.lineTo(cx + 9, hy + 12);
      ctx.lineTo(cx, hy + 21);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 9;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx, hy + 26);
        ctx.quadraticCurveTo(cx + s * 30, hy + 40, cx + s * 52, hy + 18);
        ctx.quadraticCurveTo(cx + s * 62, hy + 8, cx + s * 56, hy + 2);
        ctx.stroke();
      }
      // Whiskers.
      ctx.strokeStyle = 'rgba(42,33,49,0.55)';
      ctx.lineWidth = 2;
      for (const s of [-1, 1]) for (const k of [-1, 0, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + s * 40, hy + 30 + k * 6);
        ctx.lineTo(cx + s * 96, hy + 26 + k * 12);
        ctx.stroke();
      }
      // Tiny top hat, tilted.
      ctx.save();
      ctx.translate(cx - 24, hy - 70);
      ctx.rotate(-0.18);
      ctx.fillStyle = '#25222B';
      ctx.fillRect(-36, -6, 72, 10);
      ctx.fillRect(-24, -52, 48, 48);
      ctx.fillStyle = '#C9566E';
      ctx.fillRect(-24, -16, 48, 9);
      ctx.restore();
      // Varnish sheen.
      const sheen = ctx.createLinearGradient(0, 0, w, h);
      sheen.addColorStop(0, 'rgba(255,255,255,0.12)');
      sheen.addColorStop(0.45, 'rgba(255,255,255,0)');
      ctx.fillStyle = sheen;
      ctx.fillRect(0, 0, w, h);
    }),
  );
}

// ---------------------------------------------------------------------------
// Wanted poster
// ---------------------------------------------------------------------------

export function wantedPosterTexture(): THREE.Texture {
  return cached('art.wanted', () =>
    makeCanvasTexture(
      256,
      320,
      (ctx, w, h) => {
        ctx.fillStyle = '#F3E2BF';
        ctx.fillRect(0, 0, w, h);
        // Torn edges + stains.
        ctx.fillStyle = 'rgba(160,120,70,0.18)';
        const r = rng(77);
        for (let i = 0; i < 9; i++) {
          ctx.beginPath();
          ctx.arc(r() * w, r() * h, 6 + r() * 18, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = '#8A6A42';
        ctx.lineWidth = 6;
        ctx.strokeRect(10, 10, w - 20, h - 20);
        outlinedText(ctx, '수배', w / 2, 50, 54, '#8C2F3C', null);
        outlinedText(ctx, 'WANTED', w / 2, 92, 26, '#5A3A12', null);
        // Raccoon mugshot.
        const cx = w / 2;
        const cy = 182;
        ctx.fillStyle = '#9A95A8';
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(cx + s * 46, cy - 46, 20, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.ellipse(cx, cy, 66, 56, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#3A3443';
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(cx + s * 26, cy - 4, 24, 16, s * 0.2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#FFFFFF';
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(cx + s * 26, cy - 6, 6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#FFF3DE';
        ctx.beginPath();
        ctx.ellipse(cx, cy + 28, 30, 18, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#2A2430';
        ctx.beginPath();
        ctx.ellipse(cx, cy + 18, 9, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        // Height chart lines behind.
        ctx.strokeStyle = 'rgba(90,58,18,0.25)';
        ctx.lineWidth = 2;
        for (let y = 120; y < 250; y += 16) {
          ctx.beginPath();
          ctx.moveTo(22, y);
          ctx.lineTo(44, y);
          ctx.moveTo(w - 44, y);
          ctx.lineTo(w - 22, y);
          ctx.stroke();
        }
        outlinedText(ctx, '₩ ? ? ?', w / 2, 278, 34, '#5A3A12', null);
        // Tape corners.
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        for (const [x, y, a] of [
          [18, 14, -0.6],
          [w - 18, 14, 0.6],
        ] as const) {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(a);
          ctx.fillRect(-20, -7, 40, 14);
          ctx.restore();
        }
      },
      { fontText: '수배 WANTED ₩' },
    ),
  );
}

// ---------------------------------------------------------------------------
// Uproot crack decal (data texture)
// ---------------------------------------------------------------------------

/**
 * Crack decal, 512 x 512, centered on the uprooted object.
 *   R: crack line mask, G: growth order (0 at the object, 1 at the tips) — the shader shows a
 *   crack pixel once progress > G, so cracks crawl outward; B: crater mask (soft churned
 *   blotch) revealed after the pop; A: crack rim (slightly wider stroke, lifted-edge light).
 * `inner` is the fraction of the half size covered by the object's footprint (cracks start at
 * its edge).
 */
export function crackTexture(seed: number, inner: number, aspect = 1, widthMul = 1): THREE.Texture {
  const key = `art.crack|${seed}|${inner.toFixed(3)}|${aspect.toFixed(3)}|${widthMul}`;
  return cached(key, () => {
    const N = 512;
    const data = new Uint8Array(N * N * 4);
    if (!HAS_DOM) {
      const t = new THREE.DataTexture(data, N, N);
      t.needsUpdate = true;
      return t;
    }
    const canvas = document.createElement('canvas');
    canvas.width = N;
    canvas.height = N;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const r = rng(seed * 977 + 13);
    type Seg = { x0: number; y0: number; x1: number; y1: number; w: number; g0: number; g1: number };
    const segs: Seg[] = [];
    const c = N / 2;
    // Cartoon ground cracks: sharp zig-zags that start wide at the footprint and taper to a
    // point (wedge-like), with a few short forks — never wandering twig-like branches.
    const branch = (x: number, y: number, ang: number, len: number, w: number, g: number, depth: number): void => {
      let px = x;
      let py = y;
      let drift = 0;
      let zig = r() < 0.5 ? -1 : 1;
      const steps = Math.max(3, Math.round(len / 24));
      const gStep = (1 - g) / (steps * (depth === 0 ? 1.05 : 1.6));
      let gg = g;
      for (let i = 0; i < steps; i++) {
        zig = -zig;
        drift += (r() - 0.5) * 0.18;
        const a = ang + drift + zig * (0.32 + r() * 0.3);
        const l = (len / steps) * (0.75 + r() * 0.5);
        const nx = px + Math.cos(a) * l;
        const ny = py + Math.sin(a) * l;
        const wi = w * Math.max(0.12, 1 - (i / steps) * 0.95);
        segs.push({ x0: px, y0: py, x1: nx, y1: ny, w: wi, g0: gg, g1: Math.min(1, gg + gStep) });
        gg = Math.min(1, gg + gStep);
        if (depth < 1 && i > 0 && i < steps - 1 && r() < 0.26) branch(nx, ny, ang + drift + zig * (0.7 + r() * 0.4), len * (0.22 + r() * 0.18), wi * 0.6, gg, depth + 1);
        px = nx;
        py = ny;
      }
    };
    const n = 9 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.45;
      // Start on the footprint edge (ellipse in texture space).
      const sx = c + Math.cos(a) * c * inner * (aspect >= 1 ? 1 : aspect);
      const sy = c + Math.sin(a) * c * inner * (aspect >= 1 ? 1 / aspect : 1);
      branch(sx, sy, a, c * (1 - inner) * (0.45 + r() * 0.4), (7 + r() * 3) * widthMul, 0, 0);
    }
    const strokeAll = (extra: number, color: (s: Seg) => string): void => {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'miter';
      for (const s of segs) {
        ctx.strokeStyle = color(s);
        ctx.lineWidth = s.w + extra;
        ctx.beginPath();
        ctx.moveTo(s.x0, s.y0);
        ctx.lineTo(s.x1, s.y1);
        ctx.stroke();
      }
    };
    // R: mask.
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, N, N);
    strokeAll(0, () => '#FFF');
    const R = ctx.getImageData(0, 0, N, N).data;
    // A: rim (wider).
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, N, N);
    strokeAll(5 * widthMul, () => '#FFF');
    const A = ctx.getImageData(0, 0, N, N).data;
    // G: growth order (min over overlaps: draw on white with 'darken').
    ctx.fillStyle = '#FFF';
    ctx.fillRect(0, 0, N, N);
    ctx.globalCompositeOperation = 'darken';
    strokeAll(8, (s) => {
      const v = Math.round(((s.g0 + s.g1) / 2) * 255);
      return `rgb(${v},${v},${v})`;
    });
    ctx.globalCompositeOperation = 'source-over';
    const Gd = ctx.getImageData(0, 0, N, N).data;
    // B: crater blotch (soft, lumpy edge just outside the footprint).
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, N, N);
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const rr = c * (inner * (1.02 + r() * 0.16));
      const x = c + Math.cos(a) * rr * (aspect >= 1 ? 1 : aspect);
      const y = c + Math.sin(a) * rr * (aspect >= 1 ? 1 / aspect : 1);
      const g = ctx.createRadialGradient(x, y, 0, x, y, c * 0.22);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, N, N);
    }
    ctx.fillStyle = '#FFF';
    ctx.beginPath();
    ctx.ellipse(c, c, c * inner * (aspect >= 1 ? 1 : aspect) * 1.02, c * inner * (aspect >= 1 ? 1 / aspect : 1) * 1.02, 0, 0, Math.PI * 2);
    ctx.fill();
    const B = ctx.getImageData(0, 0, N, N).data;
    for (let i = 0; i < N * N; i++) {
      data[i * 4] = R[i * 4]!;
      data[i * 4 + 1] = Gd[i * 4]!;
      data[i * 4 + 2] = B[i * 4]!;
      data[i * 4 + 3] = A[i * 4]!;
    }
    const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.flipY = false;
    tex.needsUpdate = true;
    return tex;
  });
}

// ---------------------------------------------------------------------------
// Emote sticker atlas
// ---------------------------------------------------------------------------

export type EmoteKind =
  | 'exclaim'
  | 'question'
  | 'angry'
  | 'sweat'
  | 'sparkle'
  | 'heart'
  | 'note'
  | 'dizzy'
  | 'panic'
  | 'flame'
  | 'happy'
  | 'strain'
  | 'shock'
  | 'whistle'
  | 'stop'
  | 'puff'
  | 'coin'
  | 'tear'
  | 'zzz'
  | 'siren'
  | 'pointer'
  // Taunt bubbles (owner addition), one per taunt emote.
  | 'tauntWiggle'
  | 'tauntBleh'
  | 'tauntCash'
  | 'tauntSquat'
  | 'tauntZoom'
  | 'tauntFlex'
  | 'tauntShrug';

/** Atlas cell per emote (8 x 4 grid). */
export const EMOTE_CELLS: Readonly<Record<EmoteKind, number>> = {
  exclaim: 0,
  question: 1,
  angry: 2,
  sweat: 3,
  sparkle: 4,
  heart: 5,
  note: 6,
  dizzy: 7,
  panic: 8,
  flame: 9,
  happy: 10,
  strain: 11,
  shock: 12,
  whistle: 13,
  stop: 14,
  puff: 15,
  coin: 16,
  tear: 17,
  zzz: 18,
  siren: 19,
  pointer: 20,
  tauntWiggle: 21,
  tauntBleh: 22,
  tauntCash: 23,
  tauntSquat: 24,
  tauntZoom: 25,
  tauntFlex: 26,
  tauntShrug: 27,
};
export const EMOTE_ATLAS = { cols: 8, rows: 4, cell: 128 } as const;

/** Taunt bubbles: drawn in the pink-rimmed taunt bubble. */
export const TAUNT_KINDS: readonly EmoteKind[] = ['tauntWiggle', 'tauntBleh', 'tauntCash', 'tauntSquat', 'tauntZoom', 'tauntFlex', 'tauntShrug'];

/** Emotes drawn inside a speech bubble (the others float free beside the head). */
export const EMOTE_BUBBLED: ReadonlySet<EmoteKind> = new Set<EmoteKind>(['exclaim', 'question', 'heart', 'note', 'happy', 'strain', 'shock', 'whistle', 'stop', 'coin', 'zzz', ...TAUNT_KINDS]);

const LW = 7; // ink line width (px) shared by every icon

function sticker(ctx: CanvasRenderingContext2D, draw: () => void, fill: string, outlineOnly = false): void {
  // White sticker border, then ink, then the fill.
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  draw();
  ctx.lineWidth = LW + 10;
  ctx.strokeStyle = '#FFFFFF';
  ctx.stroke();
  ctx.lineWidth = LW;
  ctx.strokeStyle = INK;
  ctx.stroke();
  if (!outlineOnly) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.restore();
}

function bubble(ctx: CanvasRenderingContext2D, cx: number, cy: number, taunt = false): void {
  ctx.save();
  ctx.lineJoin = 'round';
  const path = (): void => {
    ctx.beginPath();
    roundRectPath(ctx, cx - 50, cy - 52, 100, 88, 34);
    // Tail (pointing down-left toward the head).
    ctx.moveTo(cx - 18, cy + 34);
    ctx.lineTo(cx - 30, cy + 56);
    ctx.lineTo(cx + 4, cy + 34);
  };
  path();
  ctx.lineWidth = LW + 10;
  ctx.strokeStyle = '#FFFFFF';
  ctx.stroke();
  ctx.lineWidth = LW;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  // Cover the tail seam.
  ctx.fillRect(cx - 24, cy + 28, 26, 9);
  if (taunt) {
    // Taunts: a candy-pink inner rim and two little "teasing" ticks on the top-right corner.
    ctx.beginPath();
    roundRectPath(ctx, cx - 43, cy - 45, 86, 74, 28);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#FF9EC0';
    ctx.stroke();
    ctx.lineCap = 'round';
    ctx.lineWidth = 5;
    ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.moveTo(cx + 46, cy - 50);
    ctx.lineTo(cx + 54, cy - 60);
    ctx.moveTo(cx + 51, cy - 42);
    ctx.lineTo(cx + 62, cy - 47);
    ctx.stroke();
  }
  ctx.restore();
}

/** Small filled ellipse with the ink outline (taunt icons). */
function blob(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string, lw = 5, rot = 0): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

/** Raccoon paw (pad + four toe beans), centered at x, y, pointing up (rotation `rot`). */
function pawIcon(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  blob(ctx, 0, 0, 15 * s, 13 * s, '#F7E2C8', 4.5);
  ctx.fillStyle = '#E79AA8';
  ctx.beginPath();
  ctx.ellipse(0, 3 * s, 7 * s, 5.5 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const [dx, dy] of [
    [-8, -7],
    [-3, -11],
    [3, -11],
    [8, -7],
  ] as const) {
    ctx.beginPath();
    ctx.arc(dx * s, dy * s, 2.6 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Four-point twinkle. */
function twinkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill = '#FFD45C'): void {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * 0.32 : r;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

/**
 * One of our raccoon heads (round ears, grey fur, bandit mask band, cream muzzle, nose) centered
 * at (x, y), scale `s` (1 = 70 px wide), so face taunts read as this game's raccoons; `eyes`
 * draws the eyes on top of the mask in head-local units.
 */
function raccoonHeadIcon(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, eyes: (c: CanvasRenderingContext2D) => void): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  for (const e of [-1, 1]) {
    blob(ctx, e * 24, -24, 11, 11, '#B9AEB5', 4.5);
    ctx.fillStyle = '#4A3F4D';
    ctx.beginPath();
    ctx.arc(e * 24, -24, 5.5, 0, Math.PI * 2);
    ctx.fill();
  }
  blob(ctx, 0, 0, 35, 30, '#B9AEB5', 5);
  ctx.fillStyle = '#F7E2C8';
  ctx.beginPath();
  ctx.ellipse(0, 13, 21, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#4A3F4D';
  for (const e of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(e * 15, -5, 15, 10.5, e * 0.21, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#F7E2C8';
  for (const e of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(e * 17, -18.5, 8, 3.2, e * 0.17, 0, Math.PI * 2);
    ctx.fill();
  }
  eyes(ctx);
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(0, 6, 5, 3.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Taunt bubble icons (one per taunt emote), drawn inside the taunt bubble around (cx, by). */
function drawTauntIcon(ctx: CanvasRenderingContext2D, kind: EmoteKind, cx: number, by: number): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (kind) {
    case 'tauntWiggle': {
      // The big ringed tail mid-swish, with motion arcs on both sides.
      ctx.save();
      ctx.translate(cx + 2, by + 4);
      ctx.rotate(-0.35);
      const tail = (): void => {
        ctx.beginPath();
        ctx.moveTo(-6, 30);
        ctx.bezierCurveTo(-30, 10, -22, -26, 4, -32);
        ctx.bezierCurveTo(24, -36, 30, -18, 20, -8);
        ctx.bezierCurveTo(12, 2, 10, 18, 10, 30);
        ctx.closePath();
      };
      tail();
      ctx.fillStyle = '#B9AEB5';
      ctx.fill();
      ctx.save();
      tail();
      ctx.clip();
      ctx.fillStyle = '#4A3F4D';
      for (const y of [-22, -4, 14]) {
        ctx.beginPath();
        ctx.ellipse(0, y, 40, 6.5, -0.25, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      tail();
      ctx.lineWidth = 5;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.restore();
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#FF7FA8';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(cx + s * 4, by + 4, 38, s < 0 ? Math.PI * 0.86 : -Math.PI * 0.14, s < 0 ? Math.PI * 1.14 : Math.PI * 0.14);
        ctx.stroke();
      }
      break;
    }
    case 'tauntBleh': {
      // "Nyah!" raccoon: one eye squeezed shut, the other with its lid pulled down by a paw,
      // tongue out.
      raccoonHeadIcon(ctx, cx - 2, by - 3, 0.86, (c) => {
        c.strokeStyle = '#FFF6E6';
        c.lineWidth = 4.5;
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(-22, -2);
        c.quadraticCurveTo(-15, -11, -8, -2);
        c.stroke();
        c.fillStyle = '#FF8FA8';
        c.beginPath();
        c.ellipse(15, 0, 8.5, 8, 0, 0, Math.PI);
        c.closePath();
        c.fill();
        c.lineWidth = 2.5;
        c.strokeStyle = INK;
        c.stroke();
        c.fillStyle = '#FFFFFF';
        c.beginPath();
        c.arc(15, -5, 6, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = INK;
        c.beginPath();
        c.arc(16, -4.5, 2.8, 0, Math.PI * 2);
        c.fill();
      });
      ctx.fillStyle = '#7A2E45';
      ctx.beginPath();
      ctx.moveTo(cx - 11, by + 12);
      ctx.quadraticCurveTo(cx - 2, by + 15, cx + 7, by + 12);
      ctx.quadraticCurveTo(cx - 2, by + 20, cx - 11, by + 12);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - 9, by + 14);
      ctx.lineTo(cx + 5, by + 14);
      ctx.quadraticCurveTo(cx + 7, by + 33, cx - 2, by + 34);
      ctx.quadraticCurveTo(cx - 11, by + 33, cx - 9, by + 14);
      ctx.fillStyle = '#FF7F9C';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = INK;
      ctx.stroke();
      pawIcon(ctx, cx + 30, by + 10, 0.62, -0.45);
      break;
    }
    case 'tauntCash': {
      // Three fanned banknotes (mint paper, gold paw roundel) and a twinkle.
      for (const [a, dx] of [
        [-0.55, -9],
        [-0.05, 0],
        [0.45, 9],
      ] as const) {
        ctx.save();
        ctx.translate(cx + dx * 0.3, by + 26);
        ctx.rotate(a);
        ctx.beginPath();
        roundRectPath(ctx, -14, -56, 28, 50, 5);
        ctx.fillStyle = '#DDF4CB';
        ctx.fill();
        ctx.lineWidth = 4.5;
        ctx.strokeStyle = INK;
        ctx.stroke();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#5FA86A';
        ctx.beginPath();
        roundRectPath(ctx, -9, -51, 18, 40, 3);
        ctx.stroke();
        ctx.fillStyle = '#FFC93C';
        ctx.beginPath();
        ctx.arc(0, -31, 6.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      twinkle(ctx, cx + 30, by - 24, 10);
      break;
    }
    case 'tauntSquat': {
      // Squished "boing" spring with stars popping off both sides.
      ctx.lineWidth = 11;
      ctx.strokeStyle = INK;
      const coil = (): void => {
        ctx.beginPath();
        ctx.moveTo(cx - 22, by + 26);
        for (let i = 0; i < 5; i++) ctx.lineTo(cx + (i % 2 ? -22 : 22), by + 18 - i * 9);
        ctx.lineTo(cx - 22, by - 27);
      };
      coil();
      ctx.stroke();
      ctx.lineWidth = 5.5;
      ctx.strokeStyle = '#FF7FA8';
      coil();
      ctx.stroke();
      ctx.beginPath();
      roundRectPath(ctx, cx - 26, by + 24, 52, 10, 4);
      ctx.fillStyle = '#8C74E8';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = INK;
      ctx.stroke();
      twinkle(ctx, cx - 34, by - 16, 9);
      twinkle(ctx, cx + 34, by - 4, 8, '#FFFFFF');
      break;
    }
    case 'tauntZoom': {
      // A chunky sneaker with speed lines streaming behind.
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#7FC8FF';
      for (const [y, l] of [
        [-12, 20],
        [0, 28],
        [12, 18],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(cx - 40, by + y + 4);
        ctx.lineTo(cx - 40 + l, by + y + 4);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(cx - 16, by - 14);
      ctx.quadraticCurveTo(cx - 14, by - 24, cx + 2, by - 20);
      ctx.lineTo(cx + 10, by - 6);
      ctx.quadraticCurveTo(cx + 34, by - 2, cx + 38, by + 12);
      ctx.lineTo(cx + 38, by + 18);
      ctx.lineTo(cx - 18, by + 18);
      ctx.closePath();
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.beginPath();
      roundRectPath(ctx, cx - 20, by + 16, 60, 9, 4);
      ctx.fillStyle = '#8FE3C8';
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#E8505B';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(cx + 2, by + 10);
      ctx.lineTo(cx + 14, by - 4);
      ctx.moveTo(cx + 12, by + 12);
      ctx.lineTo(cx + 22, by + 1);
      ctx.stroke();
      break;
    }
    case 'tauntFlex': {
      // A raccoon arm flexing (fur sleeve, bicep bump, paw up) and a gold glint.
      ctx.save();
      ctx.translate(cx - 4, by + 6);
      ctx.beginPath();
      ctx.moveTo(-32, 22);
      ctx.quadraticCurveTo(-34, 2, -14, -2);
      ctx.quadraticCurveTo(-10, -22, 6, -10);
      ctx.lineTo(12, -22);
      ctx.lineTo(26, -16);
      ctx.quadraticCurveTo(22, 4, 10, 10);
      ctx.quadraticCurveTo(-4, 24, -16, 22);
      ctx.closePath();
      ctx.fillStyle = '#B9AEB5';
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.strokeStyle = '#8F8390';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-14, 4);
      ctx.quadraticCurveTo(-6, -4, 2, 2);
      ctx.stroke();
      ctx.restore();
      pawIcon(ctx, cx + 16, by - 22, 0.85, 0.4);
      twinkle(ctx, cx - 26, by - 22, 11);
      twinkle(ctx, cx + 34, by + 14, 7, '#FFFFFF');
      break;
    }
    case 'tauntShrug': {
      // Half-lidded, smirking raccoon between two paws turned up.
      raccoonHeadIcon(ctx, cx, by + 6, 0.66, (c) => {
        for (const e of [-1, 1]) {
          c.fillStyle = '#FFFFFF';
          c.beginPath();
          c.ellipse(e * 15, -3, 7.5, 5.5, 0, 0, Math.PI * 2);
          c.fill();
          c.fillStyle = INK;
          c.beginPath();
          c.arc(e * 15 + 2.5, -1.5, 3, 0, Math.PI * 2);
          c.fill();
          c.strokeStyle = '#4A3F4D';
          c.lineWidth = 6;
          c.lineCap = 'round';
          c.beginPath();
          c.moveTo(e * 15 - 9, -6.5);
          c.lineTo(e * 15 + 9, -6.5);
          c.stroke();
        }
      });
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(cx - 5, by + 20);
      ctx.quadraticCurveTo(cx + 3, by + 22, cx + 9, by + 16);
      ctx.stroke();
      pawIcon(ctx, cx - 36, by - 4, 0.75, -0.5);
      pawIcon(ctx, cx + 36, by - 4, 0.75, 0.5);
      ctx.lineWidth = 4;
      ctx.strokeStyle = INK;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + s * 28, by - 28);
        ctx.lineTo(cx + s * 32, by - 35);
        ctx.stroke();
      }
      break;
    }
    default:
      break;
  }
}

function drawEmote(ctx: CanvasRenderingContext2D, kind: EmoteKind, x: number, y: number): void {
  const cx = x + 64;
  const cy = y + 62;
  const inB = EMOTE_BUBBLED.has(kind);
  const by = cy - 6; // icon center inside a bubble
  const taunt = TAUNT_KINDS.includes(kind);
  if (inB) bubble(ctx, cx, cy, taunt);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (taunt) drawTauntIcon(ctx, kind, cx, by);
  switch (kind) {
    case 'exclaim': {
      ctx.fillStyle = '#E8505B';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(cx - 11, by - 38);
      ctx.lineTo(cx + 11, by - 38);
      ctx.lineTo(cx + 6, by + 8);
      ctx.lineTo(cx - 6, by + 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, by + 24, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'question': {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 17;
      ctx.beginPath();
      ctx.arc(cx, by - 14, 18, Math.PI * 1.1, Math.PI * 0.45);
      ctx.quadraticCurveTo(cx, by + 2, cx, by + 10);
      ctx.stroke();
      ctx.strokeStyle = '#4F8CC9';
      ctx.lineWidth = 8;
      ctx.stroke();
      ctx.fillStyle = '#4F8CC9';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cx, by + 28, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'angry': {
      // Four curved "vein" brackets forming a cross.
      ctx.translate(cx, cy);
      for (let k = 0; k < 4; k++) {
        ctx.save();
        ctx.rotate((k * Math.PI) / 2);
        const path = (): void => {
          ctx.beginPath();
          ctx.moveTo(10, -38);
          ctx.quadraticCurveTo(12, -12, 38, -10);
        };
        path();
        ctx.lineWidth = 26;
        ctx.strokeStyle = '#FFFFFF';
        ctx.stroke();
        ctx.lineWidth = 18;
        ctx.strokeStyle = INK;
        ctx.stroke();
        ctx.lineWidth = 10;
        ctx.strokeStyle = '#E8505B';
        ctx.stroke();
        ctx.restore();
      }
      break;
    }
    case 'sweat': {
      const drop = (dx: number, dy: number, s: number): void => {
        sticker(
          ctx,
          () => {
            ctx.beginPath();
            ctx.moveTo(dx, dy - 30 * s);
            ctx.bezierCurveTo(dx + 6 * s, dy - 14 * s, dx + 22 * s, dy - 2 * s, dx + 22 * s, dy + 12 * s);
            ctx.arc(dx, dy + 12 * s, 22 * s, 0, Math.PI);
            ctx.bezierCurveTo(dx - 22 * s, dy - 2 * s, dx - 6 * s, dy - 14 * s, dx, dy - 30 * s);
            ctx.closePath();
          },
          '#8FD8FF',
        );
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.ellipse(dx - 8 * s, dy + 8 * s, 5 * s, 8 * s, -0.4, 0, Math.PI * 2);
        ctx.fill();
      };
      drop(cx + 6, cy + 2, 1.15);
      drop(cx - 30, cy - 26, 0.6);
      break;
    }
    case 'sparkle': {
      const star4 = (sx: number, sy: number, r: number, fill: string): void => {
        sticker(
          ctx,
          () => {
            ctx.beginPath();
            for (let i = 0; i < 8; i++) {
              const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
              const rr = i % 2 === 0 ? r : r * 0.32;
              const px = sx + Math.cos(a) * rr;
              const py = sy + Math.sin(a) * rr;
              if (i === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.closePath();
          },
          fill,
        );
      };
      star4(cx - 6, cy + 4, 38, '#FFE14D');
      star4(cx + 32, cy - 28, 18, '#FFFFFF');
      star4(cx + 30, cy + 34, 12, '#FFE14D');
      break;
    }
    case 'heart': {
      const hx = cx;
      const hy = by + 4;
      ctx.beginPath();
      ctx.moveTo(hx, hy + 26);
      ctx.bezierCurveTo(hx - 44, hy - 4, hx - 26, hy - 40, hx, hy - 18);
      ctx.bezierCurveTo(hx + 26, hy - 40, hx + 44, hy - 4, hx, hy + 26);
      ctx.closePath();
      ctx.fillStyle = '#FF6F91';
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.ellipse(hx - 14, hy - 12, 6, 9, -0.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'note': {
      ctx.fillStyle = '#8C74E8';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 5;
      // Beamed pair.
      ctx.beginPath();
      ctx.ellipse(cx - 16, by + 20, 12, 9, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cx + 20, by + 12, 12, 9, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(cx - 5, by + 18);
      ctx.lineTo(cx - 5, by - 26);
      ctx.lineTo(cx + 31, by - 34);
      ctx.lineTo(cx + 31, by + 10);
      ctx.stroke();
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(cx - 5, by - 22);
      ctx.lineTo(cx + 31, by - 30);
      ctx.stroke();
      break;
    }
    case 'dizzy': {
      const spiral = (): void => {
        ctx.beginPath();
        for (let i = 0; i <= 60; i++) {
          const t = i / 60;
          const a = t * Math.PI * 2 * 2.3;
          const rr = 4 + t * 40;
          const px = cx + Math.cos(a) * rr;
          const py = cy + Math.sin(a) * rr * 0.85;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
      };
      spiral();
      ctx.lineWidth = 22;
      ctx.strokeStyle = '#FFFFFF';
      ctx.stroke();
      ctx.lineWidth = 14;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.lineWidth = 7;
      ctx.strokeStyle = '#FFD45C';
      ctx.stroke();
      break;
    }
    case 'panic': {
      // Three surprise strokes fanning up and out.
      for (const [a, len] of [
        [-2.3, 34],
        [-1.57, 40],
        [-0.84, 34],
      ] as const) {
        const x0 = cx + Math.cos(a) * 14;
        const y0 = cy + 24 + Math.sin(a) * 14;
        const x1 = cx + Math.cos(a) * (14 + len);
        const y1 = cy + 24 + Math.sin(a) * (14 + len);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.lineWidth = 24;
        ctx.strokeStyle = '#FFFFFF';
        ctx.stroke();
        ctx.lineWidth = 15;
        ctx.strokeStyle = INK;
        ctx.stroke();
        ctx.lineWidth = 7;
        ctx.strokeStyle = '#FF8FA3';
        ctx.stroke();
      }
      break;
    }
    case 'flame': {
      const path = (s: number, oy: number): void => {
        ctx.beginPath();
        ctx.moveTo(cx, cy - 46 * s + oy);
        ctx.bezierCurveTo(cx + 10 * s, cy - 22 * s + oy, cx + 40 * s, cy - 10 * s + oy, cx + 34 * s, cy + 18 * s + oy);
        ctx.arc(cx, cy + 16 * s + oy, 34 * s, 0, Math.PI);
        ctx.bezierCurveTo(cx - 38 * s, cy - 4 * s + oy, cx - 18 * s, cy - 14 * s + oy, cx - 12 * s, cy - 30 * s + oy);
        ctx.quadraticCurveTo(cx - 4 * s, cy - 18 * s + oy, cx, cy - 46 * s + oy);
        ctx.closePath();
      };
      sticker(ctx, () => path(1, 4), '#FF7A3D');
      path(0.58, 18);
      ctx.fillStyle = '#FFD45C';
      ctx.fill();
      break;
    }
    case 'happy': {
      // ^^ eyes + smile.
      ctx.strokeStyle = INK;
      ctx.lineWidth = 7;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + s * 20 - 13, by - 2);
        ctx.lineTo(cx + s * 20, by - 16);
        ctx.lineTo(cx + s * 20 + 13, by - 2);
        ctx.stroke();
      }
      ctx.fillStyle = '#FF8FA3';
      ctx.beginPath();
      ctx.moveTo(cx - 14, by + 10);
      ctx.quadraticCurveTo(cx, by + 34, cx + 14, by + 10);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.stroke();
      break;
    }
    case 'strain': {
      // >_<
      ctx.strokeStyle = INK;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(cx - 34, by - 18);
      ctx.lineTo(cx - 14, by - 6);
      ctx.lineTo(cx - 34, by + 6);
      ctx.moveTo(cx + 34, by - 18);
      ctx.lineTo(cx + 14, by - 6);
      ctx.lineTo(cx + 34, by + 6);
      ctx.moveTo(cx - 12, by + 20);
      ctx.lineTo(cx + 12, by + 20);
      ctx.stroke();
      break;
    }
    case 'shock': {
      // !? interrobang pair.
      ctx.fillStyle = '#E8505B';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(cx - 27, by - 36);
      ctx.lineTo(cx - 9, by - 36);
      ctx.lineTo(cx - 13, by + 8);
      ctx.lineTo(cx - 23, by + 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx - 18, by + 24, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 15;
      ctx.beginPath();
      ctx.arc(cx + 18, by - 16, 13, Math.PI * 1.1, Math.PI * 0.45);
      ctx.quadraticCurveTo(cx + 18, by - 2, cx + 18, by + 8);
      ctx.stroke();
      ctx.strokeStyle = '#4F8CC9';
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.fillStyle = '#4F8CC9';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cx + 18, by + 25, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'whistle': {
      ctx.fillStyle = '#DCE1EA';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(cx - 8, by + 6, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      roundRectPath(ctx, cx - 8, by - 12, 40, 18, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(cx - 8, by + 6, 7, 0, Math.PI * 2);
      ctx.fill();
      // Sound waves.
      ctx.strokeStyle = '#FFB81C';
      ctx.lineWidth = 6;
      for (const r0 of [12, 22]) {
        ctx.beginPath();
        ctx.arc(cx + 34, by - 3, r0, -0.9, 0.9);
        ctx.stroke();
      }
      break;
    }
    case 'stop': {
      // Raised open paw.
      ctx.fillStyle = '#F6E3C8';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.ellipse(cx, by + 10, 22, 20, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      for (const [dx, dy] of [
        [-20, -14],
        [-7, -24],
        [8, -24],
        [21, -14],
      ] as const) {
        ctx.beginPath();
        ctx.ellipse(cx + dx, by + dy, 7.5, 9.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillStyle = '#F2A0AE';
      ctx.beginPath();
      ctx.ellipse(cx, by + 12, 10, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'puff': {
      // Breath cloud (tired panting).
      sticker(
        ctx,
        () => {
          ctx.beginPath();
          ctx.arc(cx - 20, cy + 8, 20, Math.PI * 0.5, Math.PI * 1.5);
          ctx.arc(cx - 2, cy - 14, 22, Math.PI, Math.PI * 1.9);
          ctx.arc(cx + 22, cy + 2, 20, Math.PI * 1.4, Math.PI * 0.5);
          ctx.closePath();
        },
        '#F4F1FF',
      );
      break;
    }
    case 'coin': {
      ctx.fillStyle = PAL.goldDark;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(cx, by + 2, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = PAL.gold;
      ctx.beginPath();
      ctx.arc(cx, by, 24, 0, Math.PI * 2);
      ctx.fill();
      // Paw print stamp (the game's own coin design).
      ctx.fillStyle = PAL.goldDark;
      ctx.beginPath();
      ctx.ellipse(cx, by + 6, 9, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      for (const [dx, dy] of [
        [-10, -6],
        [-3, -12],
        [5, -12],
        [11, -6],
      ] as const) {
        ctx.beginPath();
        ctx.arc(cx + dx, by + dy, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'tear': {
      sticker(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(cx, cy - 36);
          ctx.bezierCurveTo(cx + 8, cy - 16, cx + 26, cy - 2, cx + 26, cy + 14);
          ctx.arc(cx, cy + 14, 26, 0, Math.PI);
          ctx.bezierCurveTo(cx - 26, cy - 2, cx - 8, cy - 16, cx, cy - 36);
          ctx.closePath();
        },
        '#7FC8FF',
      );
      break;
    }
    case 'zzz': {
      ctx.font = `bold 34px ${FONT_STACK}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 6;
      ctx.strokeStyle = INK;
      ctx.fillStyle = '#8C74E8';
      ctx.strokeText('z', cx - 18, by + 14);
      ctx.fillText('z', cx - 18, by + 14);
      ctx.font = `bold 44px ${FONT_STACK}`;
      ctx.strokeText('Z', cx + 12, by - 6);
      ctx.fillText('Z', cx + 12, by - 6);
      break;
    }
    case 'siren': {
      // Police light dome (red | blue halves) on a dark base, light rays around it.
      const rays: [number, string][] = [
        [-2.5, '#FF4D5E'],
        [-2.0, '#FF4D5E'],
        [-1.15, '#4D8BFF'],
        [-0.65, '#4D8BFF'],
      ];
      ctx.lineWidth = 9;
      for (const [a, col] of rays) {
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 15;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * 36, cy + 4 + Math.sin(a) * 36);
        ctx.lineTo(cx + Math.cos(a) * 54, cy + 4 + Math.sin(a) * 54);
        ctx.stroke();
        ctx.strokeStyle = col;
        ctx.lineWidth = 8;
        ctx.stroke();
      }
      sticker(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(cx - 30, cy + 14);
          ctx.arc(cx, cy + 14, 30, Math.PI, 0);
          ctx.closePath();
        },
        '#FF4D5E',
      );
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx, cy - 20, 34, 36);
      ctx.clip();
      ctx.fillStyle = '#4D8BFF';
      ctx.beginPath();
      ctx.moveTo(cx - 30, cy + 14);
      ctx.arc(cx, cy + 14, 30 - LW / 2, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 14);
      ctx.lineTo(cx, cy + 14);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.ellipse(cx - 12, cy - 2, 5, 9, -0.5, 0, Math.PI * 2);
      ctx.fill();
      sticker(
        ctx,
        () => {
          ctx.beginPath();
          roundRectPath(ctx, cx - 40, cy + 14, 80, 18, 6);
        },
        '#3A3870',
      );
      break;
    }
    case 'pointer': {
      // Fat arrow pointing right (+x); markers rotate it toward their target.
      sticker(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(cx + 40, cy);
          ctx.lineTo(cx - 14, cy - 34);
          ctx.quadraticCurveTo(cx - 4, cy, cx - 14, cy + 34);
          ctx.closePath();
        },
        '#FFD23F',
      );
      break;
    }
  }
  ctx.restore();
}

export function emoteAtlasTexture(): THREE.Texture {
  return cached('art.emotes', () => {
    const { cols, rows, cell } = EMOTE_ATLAS;
    const tex = makeCanvasTexture(cols * cell, rows * cell, (ctx) => {
      ctx.clearRect(0, 0, cols * cell, rows * cell);
      for (const [kind, idx] of Object.entries(EMOTE_CELLS) as [EmoteKind, number][]) {
        const cx = (idx % cols) * cell;
        const cy = Math.floor(idx / cols) * cell;
        ctx.save();
        ctx.beginPath();
        ctx.rect(cx, cy, cell, cell);
        ctx.clip();
        drawEmote(ctx, kind, cx, cy);
        ctx.restore();
      }
    });
    tex.anisotropy = 4;
    return tex;
  });
}
