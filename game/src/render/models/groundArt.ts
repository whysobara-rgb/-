/**
 * Painted ground overlay for a layout (one textured plane over the arena paving): breaks the
 * flat tile field into a place — brick paths along the bank routes (they also hint the haul
 * lines), painted bike lanes along the edges, manhole covers and drain grates, grass rings
 * under trees, warm light pools under lamps, scuffed wear where the action happens, and a few
 * chalk doodles (hopscotch, a raccoon face, an arrow to the bank) as little stories.
 * Everything is visual only; colliders never change.
 */
import * as THREE from 'three';
import type { LayoutDef, Vec2 } from '../../sim/types';
import { hashString, rng } from './geometry';
import { createToonMaterial } from './materials';
import { roundRectPath } from './textures';

const HAS_DOM = typeof document !== 'undefined' && typeof document.createElement === 'function';

function insideStatic(layout: LayoutDef, p: Vec2, pad: number): boolean {
  for (const s of layout.statics) {
    const dx = p.x - s.center.x;
    const dy = p.y - s.center.y;
    const c = Math.cos(s.angle);
    const sn = Math.sin(s.angle);
    const lx = dx * c + dy * sn;
    const ly = -dx * sn + dy * c;
    if (Math.abs(lx) < s.half.x + pad && Math.abs(ly) < s.half.y + pad) return true;
  }
  for (const c of layout.circles) if (Math.hypot(p.x - c.center.x, p.y - c.center.y) < c.radius + pad) return true;
  for (const b of layout.banks) if (Math.abs(p.x - b.pos.x) < 5.5 && Math.abs(p.y - b.pos.y) < 5.5) return true;
  for (const z of layout.zones) if (Math.abs(p.x - z.center.x) < z.half.x + 1 && Math.abs(p.y - z.center.y) < z.half.y + 1) return true;
  return false;
}

/** Ground overlay mesh for the arena (null without a DOM). `ppm` = texture pixels per meter. */
export function createGroundOverlay(layout: LayoutDef, ppm = 20): THREE.Mesh | null {
  if (!HAS_DOM) return null;
  const W = layout.size.x;
  const H = layout.size.y;
  const scale = Math.min(ppm, 2048 / Math.max(W, H));
  const cw = Math.round(W * scale);
  const ch = Math.round(H * scale);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const r = rng(hashString(layout.id) + 77);
  const practice = layout.groundStyle === 'practice';

  // --- wear: soft scuffs where raccoons run (banks, zones, center) ----------------------
  const scuff = (x: number, y: number, rad: number, a: number): void => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(120,86,92,${a})`);
    g.addColorStop(1, 'rgba(120,86,92,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, rad, rad * (0.6 + r() * 0.4), r() * 3, 0, Math.PI * 2);
    ctx.fill();
  };
  for (const b of layout.banks) for (let i = 0; i < 6; i++) scuff(b.pos.x + (r() - 0.5) * 12, b.pos.y + (r() - 0.5) * 10, 2 + r() * 2.5, 0.07);
  for (let i = 0; i < 14; i++) scuff(r() * W, r() * H, 1.5 + r() * 3, 0.05);

  // --- brick paths along the bank routes ------------------------------------------------------
  if (!practice) {
    for (const route of layout.bankRoutes) {
      const pts = route.points;
      if (pts.length < 2) continue;
      const path = (): void => {
        ctx.beginPath();
        ctx.moveTo(pts[0]!.x, pts[0]!.y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
      };
      // A narrow, pale flagstone path with crisp edging: reads as a path, never as a broad
      // pink wash over the play area (the old wide salmon band did).
      path();
      ctx.strokeStyle = 'rgba(150,104,96,0.26)';
      ctx.lineWidth = 2.3;
      ctx.stroke();
      path();
      ctx.strokeStyle = 'rgba(246,226,206,0.34)';
      ctx.lineWidth = 2.0;
      ctx.stroke();
      // Brick joints across the band.
      ctx.strokeStyle = 'rgba(150,104,96,0.2)';
      ctx.lineWidth = 0.05;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const ux = (b.x - a.x) / len;
        const uy = (b.y - a.y) / len;
        for (let d = 0.25; d < len; d += 0.5) {
          const x = a.x + ux * d;
          const y = a.y + uy * d;
          ctx.beginPath();
          ctx.moveTo(x - uy * 0.95, y + ux * 0.95);
          ctx.lineTo(x + uy * 0.95, y - ux * 0.95);
          ctx.stroke();
        }
      }
    }
  }

  // --- painted bike lane along the long edges ---------------------------------------------------
  ctx.setLineDash([1.6, 1.1]);
  ctx.strokeStyle = 'rgba(255,214,92,0.55)';
  ctx.lineWidth = 0.14;
  for (const y of [2.2, H - 2.2]) {
    ctx.beginPath();
    ctx.moveTo(3, y);
    ctx.lineTo(W - 3, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // Bicycle pictograms on the lane.
  const bike = (x: number, y: number): void => {
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 0.08;
    for (const dx of [-0.35, 0.35]) {
      ctx.beginPath();
      ctx.arc(x + dx, y, 0.22, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(x - 0.35, y);
    ctx.lineTo(x - 0.05, y - 0.3);
    ctx.lineTo(x + 0.35, y);
    ctx.moveTo(x - 0.05, y - 0.3);
    ctx.lineTo(x + 0.15, y - 0.3);
    ctx.stroke();
  };
  for (let x = 8; x < W - 6; x += 18) {
    if (!insideStatic(layout, { x, y: 1.4 }, 0.5)) bike(x, 1.4);
    if (!insideStatic(layout, { x: W - x, y: H - 1.4 }, 0.5)) bike(W - x, H - 1.4);
  }

  // --- grass rings under trees, warm pools under lamps -------------------------------------------
  for (const c of layout.circles) {
    if (c.kind === 'tree') {
      const g = ctx.createRadialGradient(c.center.x, c.center.y, 0.3, c.center.x, c.center.y, 2.1);
      g.addColorStop(0, 'rgba(126,190,114,0.85)');
      g.addColorStop(0.75, 'rgba(158,212,138,0.55)');
      g.addColorStop(1, 'rgba(158,212,138,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c.center.x, c.center.y, 2.1, 0, Math.PI * 2);
      ctx.fill();
      // Little tufts.
      ctx.fillStyle = 'rgba(93,170,103,0.7)';
      for (let i = 0; i < 7; i++) {
        const a = r() * Math.PI * 2;
        const d = 0.9 + r() * 0.9;
        ctx.beginPath();
        ctx.ellipse(c.center.x + Math.cos(a) * d, c.center.y + Math.sin(a) * d, 0.12, 0.07, a, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (c.kind === 'lamp') {
      const g = ctx.createRadialGradient(c.center.x, c.center.y, 0, c.center.x, c.center.y, 3.6);
      g.addColorStop(0, 'rgba(255,226,150,0.45)');
      g.addColorStop(0.5, 'rgba(255,214,140,0.18)');
      g.addColorStop(1, 'rgba(255,214,140,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c.center.x, c.center.y, 3.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // --- manholes + drain grates on free ground -------------------------------------------------
  const spots: Vec2[] = [];
  for (let tries = 0; tries < 400 && spots.length < 7; tries++) {
    const p = { x: 4 + r() * (W - 8), y: 4 + r() * (H - 8) };
    if (insideStatic(layout, p, 1.2)) continue;
    if (spots.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 9)) continue;
    spots.push(p);
  }
  spots.forEach((p, i) => {
    if (i % 3 !== 2) {
      // Manhole: rim, plate, cross-hatch, a little raccoon paw stamp in the middle.
      ctx.fillStyle = 'rgba(95,103,121,0.95)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.48, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(154,163,182,1)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.38, 0, Math.PI * 2);
      ctx.clip();
      ctx.strokeStyle = 'rgba(95,103,121,0.8)';
      ctx.lineWidth = 0.04;
      for (let k = -4; k <= 4; k++) {
        ctx.beginPath();
        ctx.moveTo(p.x + k * 0.1, p.y - 0.5);
        ctx.lineTo(p.x + k * 0.1, p.y + 0.5);
        ctx.moveTo(p.x - 0.5, p.y + k * 0.1);
        ctx.lineTo(p.x + 0.5, p.y + k * 0.1);
        ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = 'rgba(220,225,234,1)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 0.04, 0.09, 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
      for (const [dx, dy] of [
        [-0.1, -0.07],
        [-0.035, -0.13],
        [0.035, -0.13],
        [0.1, -0.07],
      ] as const) {
        ctx.beginPath();
        ctx.arc(p.x + dx, p.y + dy, 0.032, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // Drain grate.
      ctx.fillStyle = 'rgba(95,103,121,0.95)';
      roundRectPath(ctx, p.x - 0.5, p.y - 0.22, 1.0, 0.44, 0.06);
      ctx.fill();
      ctx.fillStyle = 'rgba(46,42,54,0.9)';
      for (let k = 0; k < 6; k++) ctx.fillRect(p.x - 0.42 + k * 0.15, p.y - 0.15, 0.08, 0.3);
    }
  });

  // --- chalk doodles (stories) -------------------------------------------------------------------
  const free = (): Vec2 | null => {
    for (let tries = 0; tries < 200; tries++) {
      const p = { x: 5 + r() * (W - 10), y: 5 + r() * (H - 10) };
      if (!insideStatic(layout, p, 2.2) && spots.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > 3)) return p;
    }
    return null;
  };
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 0.07;
  const hop = free();
  if (hop) {
    // Hopscotch 1-2-3-45-6.
    ctx.save();
    ctx.translate(hop.x, hop.y);
    ctx.rotate(r() * 0.6 - 0.3);
    const sq = 0.55;
    const cells: [number, number][] = [
      [0, 0],
      [0, -1],
      [0, -2],
      [-0.5, -3],
      [0.5, -3],
      [0, -4],
    ];
    for (const [cx, cy] of cells) ctx.strokeRect(cx * sq - sq / 2, cy * sq - sq / 2, sq, sq);
    ctx.beginPath();
    ctx.arc(0, -4.9 * sq, sq * 0.55, Math.PI, 0);
    ctx.stroke();
    ctx.restore();
  }
  const face = free();
  if (face) {
    // A chalk raccoon face with a crown (somebody is a fan).
    ctx.save();
    ctx.translate(face.x, face.y);
    ctx.strokeStyle = 'rgba(255,240,170,0.8)';
    ctx.beginPath();
    ctx.arc(0, 0, 0.55, 0, Math.PI * 2);
    ctx.stroke();
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(s * 0.42, -0.42, 0.18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(s * 0.22, -0.05, 0.16, 0.1, s * 0.3, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0.2, 0.06, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-0.3, -0.62);
    ctx.lineTo(-0.2, -0.85);
    ctx.lineTo(-0.05, -0.68);
    ctx.lineTo(0.08, -0.9);
    ctx.lineTo(0.2, -0.68);
    ctx.lineTo(0.32, -0.62);
    ctx.stroke();
    ctx.restore();
  }
  const arrowAt = free();
  if (arrowAt && layout.banks.length) {
    // Chalk arrow pointing at the nearest bank.
    let best = layout.banks[0]!.pos;
    for (const b of layout.banks) if (Math.hypot(b.pos.x - arrowAt.x, b.pos.y - arrowAt.y) < Math.hypot(best.x - arrowAt.x, best.y - arrowAt.y)) best = b.pos;
    const a = Math.atan2(best.y - arrowAt.y, best.x - arrowAt.x);
    ctx.save();
    ctx.translate(arrowAt.x, arrowAt.y);
    ctx.rotate(a);
    ctx.strokeStyle = 'rgba(255,160,180,0.8)';
    ctx.lineWidth = 0.09;
    ctx.beginPath();
    ctx.moveTo(-0.9, 0);
    ctx.lineTo(0.9, 0);
    ctx.moveTo(0.55, -0.3);
    ctx.lineTo(0.9, 0);
    ctx.lineTo(0.55, 0.3);
    ctx.stroke();
    // A little coin doodle at the tail.
    ctx.beginPath();
    ctx.arc(-1.2, 0, 0.22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = createToonMaterial({ map: tex, transparent: true, rim: 0, polygonOffset: -1, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H).rotateX(-Math.PI / 2), mat);
  mesh.position.set(W / 2, 0.004, H / 2);
  mesh.receiveShadow = true;
  mesh.renderOrder = 0;
  mesh.name = 'ground:overlay';
  mesh.userData.noOutline = true;
  return mesh;
}

