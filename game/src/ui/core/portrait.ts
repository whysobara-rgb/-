/**
 * Portraits everywhere (setup cards, intermission, HUD names, toasts, wardrobe, results) are
 * render-to-texture snapshots of the REAL 3D raccoons and loot. The UI stays renderer-free: game
 * flow installs a provider (src/menu3d PortraitCache) and the UI asks it for an image URL; with no
 * provider (unit tests, the UI gallery without WebGL) the hand-drawn SVG portrait is the fallback.
 */
import type { HatId, LayoutDef, LootKind, TeamId } from '../../sim/types';
import { h } from './dom';
import { lootIcon, raccoon, type Expression, type RivalId } from './icons';

export interface PortraitSpec {
  hat?: HatId;
  rival?: RivalId | null;
  team?: TeamId | null;
  expression?: Expression;
  silhouette?: boolean;
  /** 'head' (default) or 'bust'. */
  frame?: 'head' | 'bust';
}

export interface PortraitProvider {
  raccoon(spec: PortraitSpec): string | null;
  object(kind: LootKind | 'gift'): string | null;
  /** Snapshot of the 3D layout miniature (optional). */
  layout?(layout: LayoutDef): string | null;
}

let provider: PortraitProvider | null = null;

export function setPortraitProvider(p: PortraitProvider | null): void {
  provider = p;
}

export function hasPortraitProvider(): boolean {
  return provider !== null;
}

function img(src: string, cls: string): HTMLElement {
  const el = h('img', { class: 'uh-portrait__img', src, alt: '', draggable: 'false' });
  return h('div', { class: `uh-portrait ${cls}` }, el);
}

/** Raccoon portrait element (3D snapshot, or the SVG drawing as a fallback). */
export function portrait(spec: PortraitSpec, cls = ''): HTMLElement {
  let url: string | null = null;
  try {
    url = provider?.raccoon(spec) ?? null;
  } catch {
    url = null;
  }
  if (url) {
    const el = img(url, cls);
    if (spec.silhouette) el.classList.add('is-silhouette');
    return el;
  }
  const svg = raccoon({ hat: spec.hat, rival: spec.rival ?? null, team: spec.team ?? null, expression: spec.expression, silhouette: spec.silhouette });
  return h('div', { class: `uh-portrait uh-portrait--svg ${cls}` }, svg);
}

/** Loot / gift-box card (3D snapshot, or the SVG icon). */
export function objectPortrait(kind: LootKind | 'gift', cls = ''): HTMLElement {
  let url: string | null = null;
  try {
    url = provider?.object(kind) ?? null;
  } catch {
    url = null;
  }
  if (url) return img(url, `uh-portrait--obj ${cls}`);
  if (kind === 'gift') return h('div', { class: `uh-portrait uh-portrait--svg uh-portrait--obj ${cls}` }, giftSvg());
  return h('div', { class: `uh-portrait uh-portrait--svg uh-portrait--obj ${cls}` }, lootIcon(kind, 'uh-loot-icon'));
}

function giftSvg(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML =
    '<rect x="7" y="18" width="34" height="24" rx="4" fill="#8E6CF0" stroke="#2A2131" stroke-width="3"/>' +
    '<rect x="5" y="13" width="38" height="8" rx="3" fill="#A88CF6" stroke="#2A2131" stroke-width="3"/>' +
    '<path d="M24 13v29" stroke="#FFD23F" stroke-width="5"/><path d="M24 13v29" stroke="#2A2131" stroke-width="1" opacity=".3"/>' +
    '<path d="M24 13c-3-7-11-8-11-3 0 3 6 3 11 3zM24 13c3-7 11-8 11-3 0 3-6 3-11 3z" fill="#FFD23F" stroke="#2A2131" stroke-width="2.6" stroke-linejoin="round"/>';
  return svg;
}

/** 3D snapshot of a layout's miniature, or null (callers fall back to the 2D map). */
export function layoutPortrait(layout: LayoutDef, cls = ''): HTMLElement | null {
  let url: string | null = null;
  try {
    url = provider?.layout?.(layout) ?? null;
  } catch {
    url = null;
  }
  return url ? img(url, `uh-portrait--layout ${cls}`) : null;
}
