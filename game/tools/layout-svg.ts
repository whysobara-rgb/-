/**
 * Renders every layout top-down as SVG (and optionally PNG via headless Chromium)
 * for level-design review.
 *
 *   npx tsx tools/layout-svg.ts [outDir] [--png] [--only=plaza,counter]
 *
 * outDir defaults to <os tmpdir>/uproot-layouts. --png needs the Playwright Chromium
 * (PLAYWRIGHT_BROWSERS_PATH) and writes <id>.png next to each SVG.
 *
 * Draws statics, circles, fences, zones, vans, banks (with doors and interior
 * safes), outdoor safes, bank routes (with the 10 m sweep band), declared alleys
 * and lanes, chokepoints, spawns and decor.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { BANK_MODEL, SAFE_SPECS, VAN } from '../src/sim/config';
import { LAYOUT_STRINGS } from '../src/sim/layouts/strings';
import { obbCorners, toWorld } from '../src/sim/layouts/geometry';
import { BANK_SWEEP_RADIUS } from '../src/sim/layouts/validate';
import type { LayoutDef, OBB, Vec2 } from '../src/sim/types';
import type { LayoutDesignMeta } from '../src/sim/layouts/meta';
import { TEAM_STYLES } from '../src/shared/teams';

const S = 14; // px per meter
const PAD = 30;

const STATIC_FILL: Record<string, string> = {
  building: '#C9B79C',
  wall: '#9C9488',
  planter: '#86B86A',
  bench: '#B07D4F',
  kiosk: '#F0A35E',
  fountain: '#7EC8E3',
  barrier: '#A9A9A9',
};
const STYLE_FILL: Record<string, string> = {
  cafe: '#D9A57B',
  bakery: '#F2C894',
  toy: '#F59FB5',
  flower: '#F7B6D2',
  books: '#9DB4D8',
  ramen: '#E88D67',
  laundry: '#A8D8EA',
  arcade: '#B59DE0',
  icecream: '#FBD3E9',
  grocery: '#B5D99C',
  bank: '#E7D3A1',
  brick: '#C47F64',
  glass: '#A9C7D6',
  pharmacy: '#9FD8C2',
  music: '#C8A2C8',
  tea: '#C9D99A',
  bike: '#E3C26B',
  hanok: '#C9A27E',
};
const CIRCLE_FILL: Record<string, string> = {
  tree: '#5E9E52',
  lamp: '#FFE08A',
  pole: '#777',
  hydrant: '#E05A47',
  fountain: '#7EC8E3',
  statue: '#B9B3A8',
};
const DECOR_FILL: Record<string, string> = {
  flowers: '#F28DB2',
  cone: '#FF8C2B',
  sign: '#FFFFFF',
  crate: '#C49A6C',
  umbrella: '#F25C54',
  trash: '#6B8E7B',
  bush: '#4F8F45',
  puddle: '#9CC9E6',
  arrow: '#FFFFFF',
  balloon: '#FF6FA5',
};

const X = (x: number): number => PAD + x * S;
const Y = (y: number): number => PAD + y * S;

function poly(pts: Vec2[], attrs: string): string {
  return `<polygon points="${pts.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')}" ${attrs}/>`;
}

function obb(o: OBB, attrs: string): string {
  return poly(obbCorners(o), attrs);
}

function text(x: number, y: number, s: string, size = 10, fill = '#333', extra = ''): string {
  const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<text x="${X(x).toFixed(1)}" y="${Y(y).toFixed(1)}" font-size="${size}" fill="${fill}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" ${extra}>${esc}</text>`;
}

export function renderLayoutSvg(def: LayoutDef, meta: LayoutDesignMeta, lang: 'ko' | 'en' = 'ko'): string {
  const W = def.size.x * S + PAD * 2;
  const H = def.size.y * S + PAD * 2 + 40;
  const str = LAYOUT_STRINGS[lang];
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#2B2F3A"/>`);
  const ground = { plaza: '#EDE3CC', arcade: '#E4DDD2', square: '#E8E1D3', practice: '#E3EAD5', yard: '#E6DCC3', funpark: '#3A3550' }[def.groundStyle ?? 'plaza'];
  out.push(`<rect x="${X(0)}" y="${Y(0)}" width="${def.size.x * S}" height="${def.size.y * S}" fill="${ground}"/>`);
  // 4 m grid
  for (let x = 0; x <= def.size.x; x += 4) out.push(`<line x1="${X(x)}" y1="${Y(0)}" x2="${X(x)}" y2="${Y(def.size.y)}" stroke="#0000000d"/>`);
  for (let y = 0; y <= def.size.y; y += 4) out.push(`<line x1="${X(0)}" y1="${Y(y)}" x2="${X(def.size.x)}" y2="${Y(y)}" stroke="#0000000d"/>`);
  if (def.zones.length === 2) out.push(`<line x1="${X(def.size.x / 2)}" y1="${Y(0)}" x2="${X(def.size.x / 2)}" y2="${Y(def.size.y)}" stroke="#0000002a" stroke-dasharray="6 6"/>`);

  // route sweep bands (under everything)
  for (const r of def.bankRoutes) {
    const col = TEAM_STYLES[r.team].color;
    const pts = r.points.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
    out.push(`<polyline points="${pts}" fill="none" stroke="${col}" stroke-opacity="0.07" stroke-width="${BANK_SWEEP_RADIUS * 2 * S}" stroke-linejoin="round" stroke-linecap="round"/>`);
  }
  // zones
  for (const z of def.zones) {
    const st = TEAM_STYLES[z.team];
    out.push(obb({ center: z.center, half: z.half, angle: z.angle }, `fill="${st.tint}" fill-opacity="0.8" stroke="${st.color}" stroke-width="3" stroke-dasharray="10 5"`));
    out.push(text(z.center.x, z.center.y, `${st.emblem === 'star' ? '★' : '☾'} ZONE ${z.team}`, 16, st.dark, 'font-weight="bold"'));
    out.push(obb({ center: z.vanPos, half: VAN.half, angle: z.vanAngle }, `fill="${st.color}" stroke="${st.dark}" stroke-width="2"`));
    out.push(text(z.vanPos.x, z.vanPos.y, 'VAN', 9, '#fff', `transform="rotate(${(z.vanAngle * 180) / Math.PI} ${X(z.vanPos.x)} ${Y(z.vanPos.y)})"`));
  }
  // decor (under statics)
  for (const d of def.decor) {
    const r = 0.35 * (d.scale ?? 1);
    const fill = d.color ?? DECOR_FILL[d.kind] ?? '#999';
    if (d.kind === 'arrow') {
      const tip = { x: d.pos.x + Math.cos(d.angle) * 0.9, y: d.pos.y + Math.sin(d.angle) * 0.9 };
      const l = { x: d.pos.x + Math.cos(d.angle + 2.5) * 0.6, y: d.pos.y + Math.sin(d.angle + 2.5) * 0.6 };
      const rr = { x: d.pos.x + Math.cos(d.angle - 2.5) * 0.6, y: d.pos.y + Math.sin(d.angle - 2.5) * 0.6 };
      out.push(poly([tip, l, rr], `fill="#ffffff" stroke="#888" stroke-width="1"`));
    } else if (d.kind === 'puddle') {
      out.push(`<ellipse cx="${X(d.pos.x)}" cy="${Y(d.pos.y)}" rx="${r * 2 * S}" ry="${r * 1.2 * S}" fill="${fill}" fill-opacity="0.7"/>`);
    } else if (d.kind === 'cone' || d.kind === 'balloon') {
      out.push(`<circle cx="${X(d.pos.x)}" cy="${Y(d.pos.y)}" r="${r * S * 0.7}" fill="${fill}" stroke="#0004"/>`);
    } else {
      out.push(`<rect x="${X(d.pos.x - r)}" y="${Y(d.pos.y - r)}" width="${2 * r * S}" height="${2 * r * S}" rx="${d.kind === 'flowers' || d.kind === 'bush' ? r * S : 2}" fill="${fill}" stroke="#0003"/>`);
    }
  }
  // statics
  for (const s of def.statics) {
    const fill = (s.kind === 'building' && s.style && STYLE_FILL[s.style]) || STATIC_FILL[s.kind] || '#aaa';
    out.push(obb(s, `fill="${fill}" stroke="#4a4036" stroke-width="${s.kind === 'building' ? 1.5 : 1}"`));
    if (s.signKey) {
      const label = str[s.signKey] ?? `?${s.signKey}`;
      const vertical = s.half.y > s.half.x * 1.6;
      out.push(text(s.center.x, s.center.y, label, 10, '#2b2118', `font-weight="bold"${vertical ? ` transform="rotate(-90 ${X(s.center.x)} ${Y(s.center.y)})"` : ''}`));
    }
  }
  for (const c of def.circles) {
    out.push(`<circle cx="${X(c.center.x)}" cy="${Y(c.center.y)}" r="${c.radius * S}" fill="${CIRCLE_FILL[c.kind] ?? '#888'}" stroke="#0005"/>`);
  }
  // fences
  for (const f of def.fences) {
    out.push(obb(f, `fill="#FFD23F" stroke="#B5651D" stroke-width="2" stroke-dasharray="4 3"`));
    out.push(text(f.center.x, f.center.y, '🏦', 12));
  }
  // banks
  def.banks.forEach((b, i) => {
    const o: OBB = { center: b.pos, half: BANK_MODEL.half, angle: b.angle };
    out.push(obb(o, `fill="#F8EBC0" stroke="none"`));
    for (const w of BANK_MODEL.walls) {
      out.push(obb({ center: toWorld(o, w.center), half: w.half, angle: b.angle }, `fill="#9C7413"`));
    }
    for (const s of BANK_MODEL.interior) {
      const spec = SAFE_SPECS[s.kind];
      out.push(obb({ center: toWorld(o, s.pos), half: spec.half, angle: b.angle + s.angle }, `fill="${s.kind === 'smallSafe' ? '#7FB77E' : '#5B6BBF'}" stroke="#222"`));
    }
    for (const d of BANK_MODEL.doors) {
      const p = toWorld(o, { x: d.center.x + d.normal.x * 0.9, y: d.center.y + d.normal.y * 0.9 });
      out.push(`<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="4" fill="#E0457B"/>`);
    }
    out.push(text(b.pos.x, b.pos.y, `BANK ${i}`, 11, '#6b4c00', 'font-weight="bold"'));
  });
  // outdoor safes
  def.safes.forEach((s, i) => {
    const spec = SAFE_SPECS[s.kind];
    out.push(obb({ center: s.pos, half: spec.half, angle: s.angle }, `fill="${s.kind === 'smallSafe' ? '#7FB77E' : '#5B6BBF'}" stroke="#111" stroke-width="1.5"`));
    out.push(text(s.pos.x, s.pos.y - spec.half.y - 0.5, `${s.kind === 'smallSafe' ? 100 : 300}#${i}`, 9, '#111', 'font-weight="bold"'));
  });
  // declared paths
  for (const p of meta.paths) {
    out.push(`<line x1="${X(p.a.x)}" y1="${Y(p.a.y)}" x2="${X(p.b.x)}" y2="${Y(p.b.y)}" stroke="${p.cls === 'narrow' ? '#E8364F' : '#1FA2C4'}" stroke-width="2" stroke-dasharray="3 3"/>`);
  }
  // route centerlines
  for (const r of def.bankRoutes) {
    const col = TEAM_STYLES[r.team].color;
    const pts = r.points.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
    out.push(`<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2" stroke-dasharray="${r.breaksFences.length ? '8 4' : '2 4'}"/>`);
  }
  // chokepoints
  for (const c of def.chokepoints) {
    out.push(`<circle cx="${X(c.pos.x)}" cy="${Y(c.pos.y)}" r="${c.radius * S}" fill="none" stroke="#7A3FD1" stroke-width="2" stroke-dasharray="5 4"/>`);
    out.push(text(c.pos.x, c.pos.y + c.radius + 0.6, str[c.nameKey] ?? `?${c.nameKey}`, 10, '#5a22a8', 'font-weight="bold"'));
  }
  // spawns
  for (const s of def.spawns) {
    const st = TEAM_STYLES[s.team];
    const tip = { x: s.pos.x + Math.cos(s.facing) * 0.8, y: s.pos.y + Math.sin(s.facing) * 0.8 };
    const l = { x: s.pos.x + Math.cos(s.facing + 2.4) * 0.6, y: s.pos.y + Math.sin(s.facing + 2.4) * 0.6 };
    const r = { x: s.pos.x + Math.cos(s.facing - 2.4) * 0.6, y: s.pos.y + Math.sin(s.facing - 2.4) * 0.6 };
    out.push(poly([tip, l, r], `fill="${st.color}" stroke="#000" stroke-width="1.5"`));
  }
  const title = `${str[def.nameKey] ?? def.nameKey} — ${def.id} (${def.size.x}×${def.size.y} m)`;
  out.push(`<text x="${PAD}" y="${H - 16}" font-size="16" fill="#fff" font-family="sans-serif">${title}</text>`);
  out.push('</svg>');
  return out.join('\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const png = args.includes('--png');
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice(7).split(',') : null;
  const outDir = resolve(args.find((a) => !a.startsWith('--')) ?? join(tmpdir(), 'uproot-layouts'));
  mkdirSync(outDir, { recursive: true });
  const { LAYOUTS, LAYOUT_META } = await import('../src/sim/layouts/index');
  const files: string[] = [];
  for (const def of Object.values(LAYOUTS)) {
    if (only && !only.includes(def.id)) continue;
    const svg = renderLayoutSvg(def, LAYOUT_META[def.id]);
    const f = join(outDir, `${def.id}.svg`);
    writeFileSync(f, svg);
    files.push(f);
    console.log(`wrote ${f}`);
  }
  if (png) {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch();
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    for (const f of files) {
      await page.goto(`file://${f}`);
      const out = f.replace(/\.svg$/, '.png');
      const el = await page.$('svg');
      if (el) await el.screenshot({ path: out });
      console.log(`wrote ${out}`);
    }
    await browser.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]).endsWith('layout-svg.ts')) {
  void main();
}
