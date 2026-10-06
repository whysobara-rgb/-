/**
 * Menu backdrop: a cozy dusk plaza (gradient sky, stars, crescent, drifting clouds, a
 * procedural two-layer skyline with lit windows, the central bank, string lights, paving).
 * Pure DOM/SVG, deterministic, cheap. Game flow can hide it when the 3D title scene runs.
 */
import { h, svgFromMarkup } from '../core/dom';
import { getUiRoot } from '../core/root';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function skylineMarkup(seed: number): string {
  const r = rng(seed);
  const W = 1920;
  const H = 360;
  const far: string[] = [];
  const near: string[] = [];
  const windows: string[] = [];
  // Far layer: soft violet blocks.
  for (let x = -40; x < W; ) {
    const w = 70 + r() * 110;
    const top = 70 + r() * 150;
    far.push(`<rect x="${x.toFixed(0)}" y="${top.toFixed(0)}" width="${w.toFixed(0)}" height="${H}" rx="6"/>`);
    if (r() < 0.3) far.push(`<rect x="${(x + w * 0.4).toFixed(0)}" y="${(top - 26).toFixed(0)}" width="6" height="28"/>`);
    x += w - 8 + r() * 20;
  }
  // Near layer: shops with lit windows; leave the center for the bank.
  const center = W / 2;
  for (let x = -30; x < W; ) {
    const w = 90 + r() * 140;
    if (x + w > center - 230 && x < center + 230) {
      x = center + 230;
      continue;
    }
    const top = 150 + r() * 110;
    const roofKind = r();
    near.push(`<rect x="${x.toFixed(0)}" y="${top.toFixed(0)}" width="${w.toFixed(0)}" height="${H}" rx="8"/>`);
    if (roofKind < 0.35) {
      near.push(`<path d="M${(x - 6).toFixed(0)} ${top.toFixed(0)}L${(x + w / 2).toFixed(0)} ${(top - 40 - r() * 20).toFixed(0)}L${(x + w + 6).toFixed(0)} ${top.toFixed(0)}Z"/>`);
    } else if (roofKind < 0.5) {
      near.push(`<rect x="${(x + w * 0.65).toFixed(0)}" y="${(top - 34).toFixed(0)}" width="18" height="36" rx="3"/>`);
    }
    // Awning
    if (r() < 0.55) {
      const ay = top + 70 + r() * 30;
      const colors = ['#FF8F78', '#FFD66B', '#7FD3B0', '#B58BE8'];
      const c = colors[Math.floor(r() * colors.length)];
      windows.push(`<path d="M${(x + 10).toFixed(0)} ${ay.toFixed(0)}h${(w - 20).toFixed(0)}l-8 22h${(-(w - 36)).toFixed(0)}z" fill="${c}" opacity=".75"/>`);
    }
    // Windows
    const cols = Math.max(2, Math.floor(w / 34));
    const rows = 2 + Math.floor(r() * 3);
    for (let cx = 0; cx < cols; cx++) {
      for (let ry = 0; ry < rows; ry++) {
        if (r() < 0.45) continue;
        const wx = x + 14 + cx * ((w - 28) / cols);
        const wy = top + 18 + ry * 36;
        if (wy > H - 90) continue;
        const op = (0.55 + r() * 0.45).toFixed(2);
        windows.push(`<rect x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="16" height="20" rx="3" fill="#FFD98A" opacity="${op}"/>`);
      }
    }
    x += w + 6 + r() * 26;
  }
  // The bank (center): pediment, columns, roots creeping out at the base.
  const bx = center - 190;
  const bank = `
    <g>
      <path d="M${bx - 20} 150L${center} 70L${bx + 400} 150Z" fill="#3A2758"/>
      <rect x="${bx - 6}" y="148" width="392" height="28" rx="6" fill="#3A2758"/>
      ${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${bx + 18 + i * 66}" y="176" width="26" height="120" rx="4" fill="#3A2758"/>`).join('')}
      <rect x="${bx - 20}" y="292" width="420" height="30" rx="6" fill="#3A2758"/>
      <circle cx="${center}" cy="120" r="16" fill="#FFD98A" opacity=".9"/>
      <rect x="${center - 60}" y="200" width="120" height="96" rx="10" fill="#FFD98A" opacity=".5"/>
      <path d="M${bx + 10} 322c-20 18-34 20-52 34M${bx + 80} 322c-6 16-2 24-16 38M${bx + 330} 322c10 16 24 22 44 32M${bx + 380} 322c22 8 30 18 46 30M${center} 322c4 14-4 24 2 38" stroke="#3A2758" stroke-width="9" fill="none" stroke-linecap="round"/>
    </g>`;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg">
    <g fill="#5A3A7E" opacity=".75">${far.join('')}</g>
    <g fill="#2E1F4D">${near.join('')}</g>
    ${bank}
    <g>${windows.join('')}</g>
  </svg>`;
}

function lightsMarkup(): string {
  const W = 1920;
  const spans: string[] = [];
  const bulbs: string[] = [];
  const colors = ['#FFE08A', '#FFB38A', '#FF9EC0', '#B9F2D0', '#A9D4FF'];
  const poles = [0, 480, 960, 1440, 1920];
  for (let i = 0; i < poles.length - 1; i++) {
    const x0 = poles[i];
    const x1 = poles[i + 1];
    const sag = 70;
    spans.push(`<path d="M${x0} 10Q${(x0 + x1) / 2} ${10 + sag * 2} ${x1} 10" stroke="#24183D" stroke-width="3" fill="none"/>`);
    for (let k = 1; k < 12; k++) {
      const t = k / 12;
      const x = x0 + (x1 - x0) * t;
      const y = (1 - t) * (1 - t) * 10 + 2 * (1 - t) * t * (10 + sag * 2) + t * t * 10;
      const c = colors[(i * 11 + k) % colors.length];
      bulbs.push(`<g class="uh-bulb"><circle cx="${x.toFixed(1)}" cy="${(y + 9).toFixed(1)}" r="13" fill="${c}" opacity=".22"/><circle cx="${x.toFixed(1)}" cy="${(y + 9).toFixed(1)}" r="6" fill="${c}"/></g>`);
    }
  }
  return `<svg viewBox="0 0 ${W} 120" preserveAspectRatio="xMidYMin slice" xmlns="http://www.w3.org/2000/svg">${spans.join('')}${bulbs.join('')}</svg>`;
}

export class Backdrop {
  readonly el: HTMLElement;

  constructor(seed = 7) {
    this.el = h(
      'div',
      { class: 'uh-backdrop', 'aria-hidden': 'true' },
      h('div', { class: 'uh-backdrop__stars' }),
      h('div', { class: 'uh-backdrop__stars uh-backdrop__stars--b' }),
      h('div', { class: 'uh-backdrop__moon' }),
      h('div', { class: 'uh-backdrop__cloud', style: 'top:18%;width:16rem;animation-duration:95s;animation-delay:-30s' }),
      h('div', { class: 'uh-backdrop__cloud', style: 'top:30%;width:22rem;animation-duration:130s;animation-delay:-80s;opacity:.7' }),
      h('div', { class: 'uh-backdrop__glow' }),
      svgFromMarkup(skylineMarkup(seed), 'uh-backdrop__skyline'),
      h('div', { class: 'uh-backdrop__ground' }),
      svgFromMarkup(lightsMarkup(), 'uh-backdrop__lights'),
      h('div', { class: 'uh-backdrop__vignette' }),
    );
  }

  mount(parent?: HTMLElement): this {
    (parent ?? getUiRoot().layer('backdrop')).appendChild(this.el);
    return this;
  }

  show(): this {
    if (!this.el.isConnected) this.mount();
    this.el.hidden = false;
    return this;
  }

  hide(): this {
    this.el.hidden = true;
    return this;
  }

  destroy(): void {
    this.el.remove();
  }
}
