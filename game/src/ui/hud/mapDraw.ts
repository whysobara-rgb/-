/**
 * Canvas drawing of a LayoutDef + live objects, shared by the LayoutPreview ("paper map")
 * and the HUD minimap ("night map"). Pure drawing: no DOM except the context passed in.
 *
 * Map orientation matches the camera: sim +x = right, sim +y = down (screen up == sim -y).
 * Shapes carry identity, colors are secondary (doc §13): small safe = square, large safe =
 * wide rectangle, bank = walled rectangle with door gaps, teams = star / moon emblems.
 */
import type { FenceDef, LayoutDef, PropVariant, SafeKind, StaticBoxKind, StaticCircleKind, TeamId, Vec2 } from '../../sim/types';
import { BANK_MODEL, PROP_SPECS, SAFE_SPECS, VAN } from '../../sim/config';
import { LOOT_STYLE, TEAM_STYLES } from '../../shared/teams';
import { MOON_PATH, STAR_POINTS } from '../core/icons';

export type MapTheme = 'paper' | 'night';

export interface MapTransform {
  /** CSS pixels per meter. */
  scale: number;
  ox: number;
  oy: number;
}

interface Palette {
  bg: string;
  arena: string;
  arenaStroke: string;
  ink: string;
  statics: Record<StaticBoxKind, string>;
  circles: Record<StaticCircleKind, string>;
  zoneAlpha: number;
  lineW: number;
}

const PALETTES: Record<MapTheme, Palette> = {
  paper: {
    bg: '#F3E3C8',
    arena: '#FBF1DF',
    arenaStroke: '#2E2442',
    ink: '#2E2442',
    statics: {
      building: '#B7A3CC',
      wall: '#7D6A98',
      planter: '#9CCB86',
      bench: '#CDA77C',
      kiosk: '#EBA3BA',
      fountain: '#8FD0F0',
      barrier: '#A79FB6',
    },
    circles: { tree: '#7DBA6E', lamp: '#6E5A88', pole: '#6E5A88', hydrant: '#E2615F', fountain: '#8FD0F0', statue: '#B0A8C0' },
    zoneAlpha: 0.55,
    lineW: 1.6,
  },
  night: {
    bg: 'rgba(22, 15, 44, 0.86)',
    arena: 'rgba(255, 244, 228, 0.07)',
    arenaStroke: 'rgba(255, 244, 228, 0.35)',
    ink: 'rgba(16, 10, 34, 0.95)',
    statics: {
      building: 'rgba(196, 176, 236, 0.38)',
      wall: 'rgba(196, 176, 236, 0.55)',
      planter: 'rgba(140, 210, 130, 0.42)',
      bench: 'rgba(220, 180, 130, 0.35)',
      kiosk: 'rgba(240, 160, 190, 0.45)',
      fountain: 'rgba(140, 210, 245, 0.5)',
      barrier: 'rgba(200, 190, 220, 0.4)',
    },
    circles: {
      tree: 'rgba(130, 200, 115, 0.5)',
      lamp: 'rgba(255, 230, 160, 0.5)',
      pole: 'rgba(200, 190, 220, 0.4)',
      hydrant: 'rgba(240, 110, 110, 0.6)',
      fountain: 'rgba(140, 210, 245, 0.5)',
      statue: 'rgba(200, 190, 220, 0.45)',
    },
    zoneAlpha: 0.4,
    lineW: 1.2,
  },
};

export function palette(theme: MapTheme): Palette {
  return PALETTES[theme];
}

/** Fit the arena into a w x h box with padding (CSS px). */
export function fitTransform(size: Vec2, w: number, h: number, pad: number): MapTransform {
  const scale = Math.min((w - pad * 2) / size.x, (h - pad * 2) / size.y);
  return { scale, ox: (w - size.x * scale) / 2, oy: (h - size.y * scale) / 2 };
}

export function toMap(tf: MapTransform, p: Vec2): Vec2 {
  return { x: tf.ox + p.x * tf.scale, y: tf.oy + p.y * tf.scale };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Run `fn` in a frame centered at sim point `p` rotated by `angle` (units: CSS px). */
function inFrame(ctx: CanvasRenderingContext2D, tf: MapTransform, p: Vec2, angle: number, fn: () => void): void {
  ctx.save();
  ctx.translate(tf.ox + p.x * tf.scale, tf.oy + p.y * tf.scale);
  ctx.rotate(angle);
  fn();
  ctx.restore();
}

let starPath: Path2D | null = null;
let moonPath: Path2D | null = null;
function emblemPath(emblem: 'star' | 'moon'): Path2D {
  if (emblem === 'star') {
    if (!starPath) {
      starPath = new Path2D();
      const pts = STAR_POINTS.split(' ').map((s) => s.split(',').map(Number));
      pts.forEach(([x, y], i) => (i === 0 ? starPath!.moveTo(x, y) : starPath!.lineTo(x, y)));
      starPath.closePath();
    }
    return starPath;
  }
  if (!moonPath) moonPath = new Path2D(MOON_PATH);
  return moonPath;
}

/** Draw a team emblem centered at (cx, cy) with radius r (CSS px). */
export function drawEmblem(
  ctx: CanvasRenderingContext2D,
  team: TeamId,
  cx: number,
  cy: number,
  r: number,
  o: { fill?: string; stroke?: string; lineWidth?: number; rotation?: number } = {},
): void {
  const s = TEAM_STYLES[team];
  ctx.save();
  ctx.translate(cx, cy);
  if (o.rotation) ctx.rotate(o.rotation);
  const k = (r * 2) / 24;
  ctx.scale(k, k);
  ctx.translate(-12, -12);
  ctx.lineJoin = 'round';
  ctx.fillStyle = o.fill ?? s.color;
  ctx.strokeStyle = o.stroke ?? s.dark;
  ctx.lineWidth = (o.lineWidth ?? 1.5) / k;
  const path = emblemPath(s.emblem);
  ctx.fill(path);
  ctx.stroke(path);
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Static layout
// ---------------------------------------------------------------------------------------------

export interface BaseDrawOptions {
  theme: MapTheme;
  /** Fence ids that are broken (skip or draw as gaps). */
  brokenFences?: ReadonlySet<string>;
  /** Draw spawn markers (preview). */
  spawns?: boolean;
}

export function drawLayoutBase(ctx: CanvasRenderingContext2D, layout: LayoutDef, tf: MapTransform, o: BaseDrawOptions): void {
  const pal = PALETTES[o.theme];
  const s = tf.scale;
  // Arena floor
  ctx.fillStyle = pal.arena;
  ctx.strokeStyle = pal.arenaStroke;
  ctx.lineWidth = pal.lineW * 1.4;
  roundRect(ctx, tf.ox, tf.oy, layout.size.x * s, layout.size.y * s, Math.max(4, s * 1.2));
  ctx.fill();
  ctx.stroke();

  // Zones (under everything else)
  for (const z of layout.zones) {
    const st = TEAM_STYLES[z.team];
    inFrame(ctx, tf, z.center, z.angle, () => {
      const w = z.half.x * 2 * s;
      const hh = z.half.y * 2 * s;
      ctx.globalAlpha = pal.zoneAlpha;
      ctx.fillStyle = o.theme === 'paper' ? st.tint : st.color;
      roundRect(ctx, -w / 2, -hh / 2, w, hh, s * 1.2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.setLineDash([s * 0.9, s * 0.6]);
      ctx.lineWidth = Math.max(1.5, s * 0.22);
      ctx.strokeStyle = o.theme === 'paper' ? st.dark : st.color;
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }

  // Statics
  for (const b of layout.statics) {
    inFrame(ctx, tf, b.center, b.angle, () => {
      const w = b.half.x * 2 * s;
      const hh = b.half.y * 2 * s;
      ctx.fillStyle = pal.statics[b.kind] ?? pal.statics.wall;
      const r = b.kind === 'planter' || b.kind === 'fountain' ? Math.min(w, hh) * 0.35 : Math.min(w, hh) * 0.12;
      roundRect(ctx, -w / 2, -hh / 2, w, hh, r);
      ctx.fill();
      if (o.theme === 'paper') {
        ctx.lineWidth = pal.lineW;
        ctx.strokeStyle = pal.ink;
        ctx.stroke();
        if (b.kind === 'building') {
          // Roof ridge hint for a friendlier look
          ctx.strokeStyle = 'rgba(46,36,66,0.25)';
          ctx.beginPath();
          if (w > hh) {
            ctx.moveTo(-w / 2 + r, 0);
            ctx.lineTo(w / 2 - r, 0);
          } else {
            ctx.moveTo(0, -hh / 2 + r);
            ctx.lineTo(0, hh / 2 - r);
          }
          ctx.stroke();
        }
      }
    });
  }
  for (const c of layout.circles) {
    const p = toMap(tf, c.center);
    const r = Math.max(c.kind === 'tree' || c.kind === 'fountain' ? 2.5 : 1.5, c.radius * s);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = pal.circles[c.kind] ?? pal.circles.pole;
    ctx.fill();
    if (o.theme === 'paper' && (c.kind === 'tree' || c.kind === 'fountain' || c.kind === 'statue')) {
      ctx.lineWidth = pal.lineW * 0.8;
      ctx.strokeStyle = pal.ink;
      ctx.stroke();
    }
  }

  // Fences
  for (const f of layout.fences) drawFence(ctx, tf, f, o.brokenFences?.has(f.id) ?? false, o.theme);

  // Vans
  for (const z of layout.zones) drawVan(ctx, tf, z.team, z.vanPos, z.vanAngle, o.theme);

  // Zone emblems (on top of vans so the team identity is always readable)
  for (const z of layout.zones) {
    const c = toMap(tf, z.center);
    const r = Math.max(6, Math.min(z.half.x, z.half.y) * s * 0.42);
    drawEmblem(ctx, z.team, c.x, c.y, r, {
      fill: o.theme === 'paper' ? TEAM_STYLES[z.team].color : TEAM_STYLES[z.team].tint,
      stroke: o.theme === 'paper' ? '#2E2442' : TEAM_STYLES[z.team].dark,
      lineWidth: o.theme === 'paper' ? 1.8 : 1.4,
    });
  }

  if (o.spawns) {
    for (const sp of layout.spawns) {
      const p = toMap(tf, sp.pos);
      drawEmblem(ctx, sp.team, p.x, p.y, Math.max(4, s * 0.55), { lineWidth: 1 });
    }
  }
}

export function drawVan(ctx: CanvasRenderingContext2D, tf: MapTransform, team: TeamId, pos: Vec2, angle: number, theme: MapTheme): void {
  const s = tf.scale;
  const st = TEAM_STYLES[team];
  inFrame(ctx, tf, pos, angle, () => {
    const w = VAN.half.x * 2 * s;
    const hh = VAN.half.y * 2 * s;
    ctx.fillStyle = st.color;
    roundRect(ctx, -w / 2, -hh / 2, w, hh, Math.min(w, hh) * 0.3);
    ctx.fill();
    ctx.lineWidth = theme === 'paper' ? 1.6 : 1.2;
    ctx.strokeStyle = theme === 'paper' ? '#2E2442' : st.dark;
    ctx.stroke();
    // Windshield on the local +x end (vans face +x in their frame)
    ctx.fillStyle = theme === 'paper' ? '#D9F1FF' : 'rgba(220,240,255,0.8)';
    roundRect(ctx, w / 2 - w * 0.24, -hh / 2 + hh * 0.18, w * 0.16, hh * 0.64, 2);
    ctx.fill();
  });
}

export function drawFence(ctx: CanvasRenderingContext2D, tf: MapTransform, f: FenceDef, broken: boolean, theme: MapTheme): void {
  const s = tf.scale;
  inFrame(ctx, tf, f.center, f.angle, () => {
    const w = Math.max(3, f.half.x * 2 * s);
    const hh = Math.max(3, f.half.y * 2 * s);
    if (broken) {
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = theme === 'paper' ? 'rgba(46,36,66,0.45)' : 'rgba(255,230,150,0.45)';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(-w / 2, -hh / 2, w, hh);
      ctx.setLineDash([]);
      return;
    }
    // Hazard stripes = "bank can break this"
    ctx.save();
    roundRect(ctx, -w / 2, -hh / 2, w, hh, 1.5);
    ctx.clip();
    ctx.fillStyle = '#FFD24A';
    ctx.fillRect(-w / 2, -hh / 2, w, hh);
    ctx.strokeStyle = '#2E2442';
    ctx.lineWidth = Math.max(1.5, Math.min(w, hh) * 0.45);
    const step = Math.max(4, Math.min(w, hh) * 1.4);
    ctx.beginPath();
    for (let x = -w / 2 - hh; x < w / 2 + hh; x += step) {
      ctx.moveTo(x, hh / 2);
      ctx.lineTo(x + hh, -hh / 2);
    }
    ctx.stroke();
    ctx.restore();
    ctx.lineWidth = theme === 'paper' ? 1.4 : 1;
    ctx.strokeStyle = '#2E2442';
    roundRect(ctx, -w / 2, -hh / 2, w, hh, 1.5);
    ctx.stroke();
  });
  // Little bank badge so the fence reads as "bank-breakable" without color.
  const c = toMap(tf, f.center);
  const r = Math.max(4.5, s * 0.75);
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#FFF9F0';
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = '#2E2442';
  ctx.stroke();
  drawBankGlyph(ctx, c.x, c.y, r * 0.75, '#2E2442');
}

/** Tiny pediment + columns glyph. */
function drawBankGlyph(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx - r, cy - r * 0.25);
  ctx.lineTo(cx, cy - r);
  ctx.lineTo(cx + r, cy - r * 0.25);
  ctx.closePath();
  ctx.fill();
  const cw = r * 0.28;
  for (const dx of [-0.62, 0, 0.62]) ctx.fillRect(cx + dx * r - cw / 2, cy - r * 0.15, cw, r * 0.8);
  ctx.fillRect(cx - r, cy + r * 0.7, r * 2, r * 0.25);
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Loot
// ---------------------------------------------------------------------------------------------

export interface BankDrawOptions {
  theme: MapTheme;
  recovered?: boolean;
  recoveredBy?: TeamId | null;
  /** Team currently dragging it (draws a team-colored outline). */
  carriedBy?: TeamId | null;
  /** Emphasize door openings with arrows (preview). */
  doorArrows?: boolean;
  /** Minimum on-map size in px for the long side. */
  minPx?: number;
}

export function drawBank(ctx: CanvasRenderingContext2D, tf: MapTransform, pos: Vec2, angle: number, o: BankDrawOptions): void {
  const real = BANK_MODEL.half.x * 2 * tf.scale;
  const k = o.minPx && real < o.minPx ? o.minPx / real : 1;
  const s = tf.scale * k;
  const hx = BANK_MODEL.half.x * s;
  const hy = BANK_MODEL.half.y * s;
  const t = Math.max(1.6, BANK_MODEL.wallThickness * s);
  const door = (BANK_MODEL.doorWidth * s) / 2;
  const paper = o.theme === 'paper';
  inFrame(ctx, tf, pos, angle, () => {
    if (o.recovered) {
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = paper ? '#2E2442' : 'rgba(255,244,228,0.6)';
      ctx.lineWidth = 1.2;
      roundRect(ctx, -hx, -hy, hx * 2, hy * 2, 3);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      return;
    }
    if (o.carriedBy !== undefined && o.carriedBy !== null) {
      ctx.lineWidth = Math.max(3, s * 0.5);
      ctx.strokeStyle = TEAM_STYLES[o.carriedBy].color;
      roundRect(ctx, -hx - 2, -hy - 2, hx * 2 + 4, hy * 2 + 4, 4);
      ctx.stroke();
    }
    // Floor
    ctx.fillStyle = paper ? '#FFF0C2' : 'rgba(242, 193, 78, 0.35)';
    roundRect(ctx, -hx, -hy, hx * 2, hy * 2, 2);
    ctx.fill();
    // Walls: sides solid, front/back split by door gaps (doors on local ±y).
    ctx.fillStyle = LOOT_STYLE.bank.color;
    ctx.strokeStyle = paper ? '#2E2442' : LOOT_STYLE.bank.dark;
    ctx.lineWidth = paper ? 1.4 : 1;
    const seg = (x0: number, y0: number, w: number, hh: number): void => {
      ctx.beginPath();
      ctx.rect(x0, y0, w, hh);
      ctx.fill();
      ctx.stroke();
    };
    seg(-hx, -hy, t, hy * 2); // west side
    seg(hx - t, -hy, t, hy * 2); // east side
    seg(-hx, -hy, hx - door, t); // back-left
    seg(door, -hy, hx - door, t); // back-right
    seg(-hx, hy - t, hx - door, t); // front-left
    seg(door, hy - t, hx - door, t); // front-right
    if (o.doorArrows) {
      // Door chevrons pointing outward on both door sides.
      ctx.fillStyle = paper ? '#2E2442' : '#FFF4E4';
      for (const dir of [-1, 1]) {
        const y = dir * (hy + Math.max(4, s * 0.55));
        const a = Math.max(3.5, s * 0.55);
        ctx.beginPath();
        ctx.moveTo(-a, y - dir * a * 0.2);
        ctx.lineTo(0, y + dir * a * 0.8);
        ctx.lineTo(a, y - dir * a * 0.2);
        ctx.closePath();
        ctx.fill();
      }
    }
  });
}

export interface SafeDrawOptions {
  theme: MapTheme;
  /** Minimum size scale so tiny safes stay visible on small maps. */
  minPx?: number;
  /** Loaded inside a bank (drawn slightly smaller with a light outline). */
  loaded?: boolean;
  /** Held/carried by a team (outline in team color). */
  heldBy?: TeamId | null;
}

export function drawSafe(ctx: CanvasRenderingContext2D, tf: MapTransform, kind: SafeKind, pos: Vec2, angle: number, o: SafeDrawOptions): void {
  const spec = SAFE_SPECS[kind];
  const style = LOOT_STYLE[kind];
  const realW = spec.half.x * 2 * tf.scale;
  const min = o.minPx ?? 0;
  const k = realW < min ? min / realW : 1;
  const w = spec.half.x * 2 * tf.scale * k;
  const hh = spec.half.y * 2 * tf.scale * k * (kind === 'largeSafe' ? 0.8 : 1);
  inFrame(ctx, tf, pos, angle, () => {
    if (o.heldBy !== undefined && o.heldBy !== null) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = TEAM_STYLES[o.heldBy].color;
      roundRect(ctx, -w / 2 - 2, -hh / 2 - 2, w + 4, hh + 4, 3);
      ctx.stroke();
    }
    ctx.fillStyle = style.color;
    roundRect(ctx, -w / 2, -hh / 2, w, hh, Math.min(w, hh) * 0.2);
    ctx.fill();
    ctx.lineWidth = o.theme === 'paper' ? 1.4 : 1.1;
    ctx.strokeStyle = o.theme === 'paper' ? '#2E2442' : 'rgba(255,249,240,0.9)';
    ctx.stroke();
    // Dial dot: helps read "safe" even at tiny sizes
    if (Math.min(w, hh) >= 7) {
      ctx.beginPath();
      ctx.arc(kind === 'largeSafe' ? -w * 0.18 : 0, 0, Math.min(w, hh) * 0.18, 0, Math.PI * 2);
      ctx.fillStyle = '#FFF6E8';
      ctx.fill();
    }
  });
}

/** Bank interior safes for a static layout preview (from BANK_MODEL.interior). */
export function bankInteriorWorld(pos: Vec2, angle: number): { kind: SafeKind; pos: Vec2; angle: number }[] {
  const c = Math.cos(angle);
  const sn = Math.sin(angle);
  return BANK_MODEL.interior.map((it) => ({
    kind: it.kind,
    pos: { x: pos.x + it.pos.x * c - it.pos.y * sn, y: pos.y + it.pos.x * sn + it.pos.y * c },
    angle: angle + it.angle,
  }));
}

/** Fill the canvas background for the theme (call before drawLayoutBase). */
export function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number, theme: MapTheme, radius: number): void {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = PALETTES[theme].bg;
  roundRect(ctx, 0, 0, w, h, radius);
  ctx.fill();
}

/** Prepare a canvas for crisp drawing at devicePixelRatio; returns the context in CSS px. */
export function setupCanvas(canvas: HTMLCanvasElement, cssW: number, cssH: number): CanvasRenderingContext2D | null {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

// ---------------------------------------------------------------------------------------------
// [C8] Content 2.0: props, supply pads, coin density (minimap + layout preview)
// ---------------------------------------------------------------------------------------------

const PROP_COLORS: Record<PropVariant, { fill: string; dark: string }> = {
  atm: { fill: '#4FD6A6', dark: '#1F9A6E' },
  piggy: { fill: '#FF8FB8', dark: '#C2507A' },
  moneyTree: { fill: '#7FB77E', dark: '#3F6E3E' },
  goldSafe: { fill: '#FFC21F', dark: '#9C7413' },
};

export interface PropDrawOptions {
  theme: MapTheme;
  /** Minimum on-map size of the long side (px). */
  minPx?: number;
  /** Held / carried by a team (team-coloured outline). */
  heldBy?: TeamId | null;
}

/**
 * A prop by its own shape (identity by shape, colour secondary): ATM = upright box with a screen,
 * 돼지저금통 = round body with a snout bump, 돈나무 = leafy round crown on a trunk bar, 황금 금고 =
 * gold box with a dial and a sparkle.
 */
export function drawProp(ctx: CanvasRenderingContext2D, tf: MapTransform, variant: PropVariant, pos: Vec2, angle: number, o: PropDrawOptions): void {
  const spec = PROP_SPECS[variant];
  const col = PROP_COLORS[variant];
  const paper = o.theme === 'paper';
  const ink = paper ? '#2E2442' : 'rgba(255,249,240,0.92)';
  const realLong = Math.max(spec.half.x, spec.half.y) * 2 * tf.scale;
  const k = o.minPx && realLong < o.minPx ? o.minPx / realLong : 1;
  const hx = spec.half.x * tf.scale * k;
  const hy = spec.half.y * tf.scale * k;
  inFrame(ctx, tf, pos, angle, () => {
    if (o.heldBy !== undefined && o.heldBy !== null) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = TEAM_STYLES[o.heldBy].color;
      if (spec.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, hx + 2.5, 0, Math.PI * 2);
      } else roundRect(ctx, -hx - 2.5, -hy - 2.5, hx * 2 + 5, hy * 2 + 5, 3);
      ctx.stroke();
    }
    ctx.lineWidth = paper ? 1.4 : 1.1;
    ctx.strokeStyle = ink;
    ctx.fillStyle = col.fill;
    if (variant === 'piggy') {
      ctx.beginPath();
      ctx.arc(0, 0, hx, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hx * 0.95, 0, hx * 0.38, 0, Math.PI * 2);
      ctx.fillStyle = '#FFC6DA';
      ctx.fill();
      ctx.stroke();
      return;
    }
    if (variant === 'moneyTree') {
      ctx.fillStyle = '#B07A4A';
      roundRect(ctx, -hx, -hy * 0.45, hx * 2, hy * 0.9, hy * 0.4);
      ctx.fill();
      ctx.stroke();
      const r = Math.max(hy * 1.6, Math.min(hx, hy * 2.2));
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = col.fill;
      ctx.fill();
      ctx.stroke();
      if (r >= 4) {
        ctx.fillStyle = '#A9F0D3';
        ctx.fillRect(-r * 0.45, -r * 0.35, r * 0.5, r * 0.3);
        ctx.fillRect(r * 0.05, r * 0.05, r * 0.5, r * 0.3);
      }
      return;
    }
    roundRect(ctx, -hx, -hy, hx * 2, hy * 2, Math.min(hx, hy) * 0.3);
    ctx.fill();
    ctx.stroke();
    if (Math.min(hx, hy) >= 3) {
      ctx.fillStyle = variant === 'atm' ? '#D9F1FF' : '#FFF6E8';
      if (variant === 'atm') roundRect(ctx, -hx * 0.6, -hy * 0.6, hx * 1.2, hy * 0.7, 1);
      else {
        ctx.beginPath();
        ctx.arc(0, 0, Math.min(hx, hy) * 0.42, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  });
}

/** A supply-drop pad: a dashed landing ring with a small balloon (axis pad slightly bigger). */
export function drawItemPad(ctx: CanvasRenderingContext2D, tf: MapTransform, pos: Vec2, o: { theme: MapTheme; axis?: boolean; minPx?: number }): void {
  const c = toMap(tf, pos);
  const r = Math.max((o.minPx ?? 4) * (o.axis ? 1.2 : 1), 0.9 * tf.scale);
  const paper = o.theme === 'paper';
  ctx.save();
  ctx.setLineDash([Math.max(1.5, r * 0.45), Math.max(1.5, r * 0.35)]);
  ctx.lineWidth = Math.max(1.2, r * 0.22);
  ctx.strokeStyle = paper ? '#8E6CF0' : 'rgba(205, 189, 255, 0.85)';
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  // balloon + string
  const br = r * 0.42;
  ctx.beginPath();
  ctx.moveTo(c.x, c.y + br * 0.9);
  ctx.lineTo(c.x, c.y + br * 1.9);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, br * 0.85, br, 0, 0, Math.PI * 2);
  ctx.fillStyle = paper ? '#FF8FB8' : 'rgba(255, 143, 184, 0.9)';
  ctx.fill();
  ctx.restore();
}

/** Coin density: piles binned into `cell`-metre cells (value summed, position averaged). */
export interface CoinCell {
  x: number;
  y: number;
  value: number;
  n: number;
}

export function binCoins(coins: readonly { pos: Vec2; value: number }[], cell: number, out: CoinCell[] = [], keyOf: Map<number, number> = new Map()): CoinCell[] {
  out.length = 0;
  keyOf.clear();
  for (const c of coins) {
    if (!Number.isFinite(c.pos.x) || !Number.isFinite(c.pos.y)) continue;
    const key = Math.floor(c.pos.x / cell) * 4096 + Math.floor(c.pos.y / cell);
    const i = keyOf.get(key);
    if (i === undefined) {
      keyOf.set(key, out.length);
      out.push({ x: c.pos.x * c.value, y: c.pos.y * c.value, value: c.value, n: 1 });
    } else {
      const b = out[i]!;
      b.x += c.pos.x * c.value;
      b.y += c.pos.y * c.value;
      b.value += c.value;
      b.n++;
    }
  }
  for (const b of out) {
    b.x /= b.value;
    b.y /= b.value;
  }
  return out;
}

/** One coin-density blob (gold glow + core), radius grows with the cell's value. */
export function drawCoinCell(ctx: CanvasRenderingContext2D, tf: MapTransform, cell: CoinCell, glow: CanvasImageSource | null, minPx = 3): void {
  const c = toMap(tf, cell);
  const r = Math.min(minPx * 3.4, minPx + Math.sqrt(cell.value) * minPx * 0.18);
  if (glow) ctx.drawImage(glow, c.x - r * 2, c.y - r * 2, r * 4, r * 4);
  ctx.beginPath();
  ctx.arc(c.x, c.y, Math.max(1.5, r * 0.5), 0, Math.PI * 2);
  ctx.fillStyle = '#FFD23F';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(42, 33, 49, 0.9)';
  ctx.stroke();
}

/** A soft gold glow sprite (size×size CSS px) for coin cells. */
export function makeCoinGlow(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = setupCanvas(canvas, size, size);
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255, 222, 90, 0.85)');
    g.addColorStop(0.45, 'rgba(255, 200, 60, 0.35)');
    g.addColorStop(1, 'rgba(255, 190, 40, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return canvas;
}
