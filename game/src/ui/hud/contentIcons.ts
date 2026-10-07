/**
 * [C8] Sticker glyphs for the Content 2.0 HUD: items, props, breakables, the coin bag and the coin.
 * Same sticker language as `lootIcon` (48×48, ink outline, flat pastel fill, round joins). All
 * shapes are original (ART_DIRECTION §3): the squeaky hammer has an accordion head with cream
 * caps, the coin is a round rim with a raccoon-paw emboss, the vending machine is the fictional
 * 꿀꺽 brand. No question marks anywhere (an item is always shown as itself).
 */
import type { BreakableKind, ItemKind, PropVariant } from '../../sim/types';
import { svgFromMarkup } from '../core/dom';

const INK = '#2A2131';
const S = `stroke="${INK}" stroke-linejoin="round" stroke-linecap="round"`;

const wrap = (body: string): string => `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

/** Raccoon paw (pad + 3 toes) centred at (cx, cy), radius ~r. */
function paw(cx: number, cy: number, r: number, fill = INK): string {
  const t = r * 0.34;
  return (
    `<ellipse cx="${cx}" cy="${cy + r * 0.28}" rx="${r * 0.52}" ry="${r * 0.42}" fill="${fill}"/>` +
    `<circle cx="${cx - r * 0.62}" cy="${cy - r * 0.32}" r="${t}" fill="${fill}"/>` +
    `<circle cx="${cx}" cy="${cy - r * 0.62}" r="${t}" fill="${fill}"/>` +
    `<circle cx="${cx + r * 0.62}" cy="${cy - r * 0.32}" r="${t}" fill="${fill}"/>`
  );
}

function hammer(head: string, cap: string, sparkle: boolean): string {
  return (
    `<g transform="rotate(-32 24 24)">` +
    `<rect x="21.4" y="19" width="5.2" height="26" rx="2.6" fill="#E8B07A" ${S} stroke-width="2.6"/>` +
    `<rect x="9" y="6.5" width="30" height="14" rx="4.5" fill="${head}" ${S} stroke-width="2.8"/>` +
    `<path d="M16 7.5v12M21 7.5v12M27 7.5v12M32 7.5v12" ${S} stroke-width="1.8" fill="none" opacity="0.75"/>` +
    `<rect x="4.5" y="8.2" width="6" height="10.6" rx="2.4" fill="${cap}" ${S} stroke-width="2.4"/>` +
    `<rect x="37.5" y="8.2" width="6" height="10.6" rx="2.4" fill="${cap}" ${S} stroke-width="2.4"/>` +
    `</g>` +
    (sparkle ? `<path d="M40 30l1.4 3.6 3.6 1.4-3.6 1.4L40 40l-1.4-3.6L35 35l3.6-1.4z" fill="#FFF6E6" ${S} stroke-width="1.6"/>` : '')
  );
}

const ITEM_MARKUP: Record<ItemKind, string> = {
  hammer: hammer('#FF6F91', '#FFF6E6', false),
  goldHammer: hammer('#FFC21F', '#FFF6E6', true),
  plunger:
    `<rect x="21.5" y="3.5" width="5" height="27" rx="2.5" fill="#E8B07A" ${S} stroke-width="2.6"/>` +
    `<path d="M9 40.5c0-8.5 6.5-13 15-13s15 4.5 15 13z" fill="#FF5A4E" ${S} stroke-width="2.8"/>` +
    `<path d="M7 41h34" ${S} stroke-width="3.2" fill="none"/>` +
    `<path d="M16 34c2-2 5-3 8-3" ${S} stroke="#FFF6E6" stroke-width="2" fill="none" opacity="0.8"/>`,
  skates:
    `<path d="M5 25.5l-4 2 4 2" fill="#FFD23F" ${S} stroke-width="1.8"/>` +
    `<rect x="5" y="23" width="8" height="7" rx="2" fill="#B4A9C6" ${S} stroke-width="2.2"/>` +
    `<path d="M13 9h12v13l9.5 3.6c3 1.2 4.5 3.2 4.5 6.4v3H13z" fill="#4FB6FF" ${S} stroke-width="2.8"/>` +
    `<path d="M25 14h-5M25 18h-5" ${S} stroke-width="2" fill="none"/>` +
    `<circle cx="18.5" cy="39.5" r="3.8" fill="#FFF6E6" ${S} stroke-width="2.4"/>` +
    `<circle cx="33.5" cy="39.5" r="3.8" fill="#FFF6E6" ${S} stroke-width="2.4"/>`,
  soap:
    `<rect x="11" y="16" width="18" height="26" rx="5.5" fill="#FF8FB8" ${S} stroke-width="2.8"/>` +
    `<rect x="15.5" y="8.5" width="9" height="7.5" rx="2" fill="#FFF6E6" ${S} stroke-width="2.4"/>` +
    `<path d="M24.5 11h5" ${S} stroke-width="2.4" fill="none"/>` +
    `<rect x="14.5" y="24" width="11" height="9" rx="2.5" fill="#FFF6E6" ${S} stroke-width="1.8"/>` +
    `<circle cx="36" cy="14" r="5" fill="#ADDCFF" ${S} stroke-width="2.2"/>` +
    `<circle cx="39.5" cy="26" r="3.2" fill="#ADDCFF" ${S} stroke-width="2"/>` +
    `<circle cx="34.5" cy="34" r="2.2" fill="#ADDCFF" ${S} stroke-width="1.8"/>`,
  balloons:
    `<path d="M24 44c0-6-6-10-9-16M24 44c0-7 0-12 0-19M24 44c0-6 6-10 9-16" ${S} stroke-width="1.8" fill="none"/>` +
    `<ellipse cx="14" cy="17" rx="7.5" ry="9" fill="#FF8FB8" ${S} stroke-width="2.6"/>` +
    `<ellipse cx="34" cy="17" rx="7.5" ry="9" fill="#4FD6A6" ${S} stroke-width="2.6"/>` +
    `<ellipse cx="24" cy="13" rx="7.5" ry="9" fill="#FFD23F" ${S} stroke-width="2.6"/>`,
  smoke:
    `<path d="M12 36c-5 0-8-3-8-7s3-7 7-7c1-5 5-8 10-8 4 0 7 2 9 5 1-1 3-1 4-1 5 0 8 4 8 8s-3 10-8 10z" fill="#E9E3F2" ${S} stroke-width="2.8"/>` +
    `<path d="M17 28c1.5 1.5 4 1.5 5.5 0M27 28c1.5 1.5 4 1.5 5.5 0" ${S} stroke-width="2" fill="none"/>`,
};

const PROP_MARKUP: Record<PropVariant, string> = {
  atm:
    `<rect x="10" y="5.5" width="28" height="37" rx="4.5" fill="#4FD6A6" ${S} stroke-width="3"/>` +
    `<rect x="15" y="10.5" width="18" height="11" rx="2.2" fill="#D9F1FF" ${S} stroke-width="2.2"/>` +
    `<path d="M18.5 16h3M24 16h5" ${S} stroke-width="2" fill="none"/>` +
    `<rect x="17" y="27" width="14" height="3.6" rx="1.6" fill="${INK}"/>` +
    `<circle cx="24" cy="36.3" r="2.6" fill="#FFD23F" ${S} stroke-width="1.8"/>`,
  piggy:
    `<rect x="12.5" y="33" width="5.5" height="8.5" rx="2.2" fill="#FF8FB8" ${S} stroke-width="2.4"/>` +
    `<rect x="28.5" y="33" width="5.5" height="8.5" rx="2.2" fill="#FF8FB8" ${S} stroke-width="2.4"/>` +
    `<path d="M13 16.5l2.5-7.5 6 5.5" fill="#FF8FB8" ${S} stroke-width="2.4"/>` +
    `<ellipse cx="23" cy="25.5" rx="17" ry="12.5" fill="#FF8FB8" ${S} stroke-width="3"/>` +
    `<ellipse cx="39.5" cy="26.5" rx="4" ry="5" fill="#FFC6DA" ${S} stroke-width="2.4"/>` +
    `<circle cx="38.6" cy="25.2" r="0.9" fill="${INK}"/><circle cx="40.4" cy="27.8" r="0.9" fill="${INK}"/>` +
    `<circle cx="31.5" cy="21" r="1.8" fill="${INK}"/>` +
    `<rect x="18" y="13.6" width="9" height="2.6" rx="1.2" fill="${INK}"/>`,
  moneyTree:
    `<ellipse cx="24" cy="41.5" rx="11" ry="4" fill="#B07A4A" ${S} stroke-width="2.4"/>` +
    `<rect x="21" y="25" width="6" height="16" rx="1.5" fill="#CDA77C" ${S} stroke-width="2.6"/>` +
    `<circle cx="24" cy="17.5" r="13.5" fill="#7FB77E" ${S} stroke-width="3"/>` +
    `<rect x="12.5" y="11" width="9" height="5.5" rx="1.2" fill="#A9F0D3" ${S} stroke-width="1.8" transform="rotate(-18 17 13.7)"/>` +
    `<rect x="25.5" y="8" width="9" height="5.5" rx="1.2" fill="#A9F0D3" ${S} stroke-width="1.8" transform="rotate(14 30 10.7)"/>` +
    `<rect x="19.5" y="19.5" width="9" height="5.5" rx="1.2" fill="#A9F0D3" ${S} stroke-width="1.8" transform="rotate(-6 24 22.2)"/>`,
  goldSafe:
    `<rect x="6" y="10" width="36" height="30" rx="5" fill="#FFC21F" ${S} stroke-width="3"/>` +
    `<rect x="10.5" y="14.5" width="27" height="21" rx="3" fill="#FFE88A" ${S} stroke-width="2.2"/>` +
    `<circle cx="24" cy="25" r="5.5" fill="#FFF6E6" ${S} stroke-width="2.4"/>` +
    `<path d="M24 21.5v3.5l2.5 1.5" ${S} stroke-width="2" fill="none"/>` +
    `<path d="M41 6l1.2 3 3 1.2-3 1.2L41 14.5l-1.2-3-3-1.2 3-1.2z" fill="#FFF6E6" ${S} stroke-width="1.4"/>`,
};

const BREAKABLE_MARKUP: Record<BreakableKind, string> = {
  crate:
    `<rect x="7" y="9" width="34" height="32" rx="3" fill="#E8B07A" ${S} stroke-width="3"/>` +
    `<path d="M7 18h34M7 32h34" ${S} stroke-width="2.4" fill="none"/>` +
    `<path d="M11 32l26-14" ${S} stroke-width="2.6" fill="none"/>`,
  vending:
    `<rect x="10" y="4.5" width="28" height="39" rx="4" fill="#FF8FB8" ${S} stroke-width="3"/>` +
    `<rect x="14" y="9" width="13" height="22" rx="2" fill="#D9F1FF" ${S} stroke-width="2.2"/>` +
    `<path d="M14 16.5h13M14 24h13" ${S} stroke-width="1.8" fill="none"/>` +
    `<rect x="30" y="11" width="4.5" height="7" rx="1.5" fill="#FFF6E6" ${S} stroke-width="1.8"/>` +
    `<rect x="14" y="35" width="20" height="4.5" rx="1.5" fill="${INK}"/>`,
};

const BAG_MARKUP =
  `<path d="M17 12.5l-3.5-7h21l-3.5 7" fill="#E9CFA8" ${S} stroke-width="2.6"/>` +
  `<path d="M16.5 13c-6.5 6-9 12.5-9 18 0 6.5 7 10 16.5 10s16.5-3.5 16.5-10c0-5.5-2.5-12-9-18z" fill="#E9CFA8" ${S} stroke-width="3"/>` +
  `<path d="M15.5 13h17" ${S} stroke-width="3.2" fill="none"/>` +
  `<circle cx="24" cy="29.5" r="7.2" fill="#FFD23F" ${S} stroke-width="2.4"/>` +
  paw(24, 30, 4.2, '#C98A12');

const COIN_MARKUP = `<circle cx="24" cy="24" r="18" fill="#FFD23F" ${S} stroke-width="3"/><circle cx="24" cy="24" r="12.5" fill="none" stroke="#C98A12" stroke-width="2"/>` + paw(24, 24.5, 7.5, '#C98A12');

export function itemGlyph(kind: ItemKind, cls = 'uh-cglyph'): SVGSVGElement {
  const svg = svgFromMarkup(wrap(ITEM_MARKUP[kind]), cls);
  svg.dataset.item = kind;
  return svg;
}

export function propGlyph(variant: PropVariant, cls = 'uh-cglyph'): SVGSVGElement {
  const svg = svgFromMarkup(wrap(PROP_MARKUP[variant]), cls);
  svg.dataset.prop = variant;
  return svg;
}

export function breakableGlyph(kind: BreakableKind, cls = 'uh-cglyph'): SVGSVGElement {
  return svgFromMarkup(wrap(BREAKABLE_MARKUP[kind]), cls);
}

export function bagGlyph(cls = 'uh-cglyph'): SVGSVGElement {
  return svgFromMarkup(wrap(BAG_MARKUP), cls);
}

export function coinGlyph(cls = 'uh-cglyph'): SVGSVGElement {
  return svgFromMarkup(wrap(COIN_MARKUP), cls);
}

/** Text keys (hud.content.*) for content names. */
export const itemNameKey = (k: ItemKind): string => `hud.content.item.${k}.name`;
export const itemVerbKey = (k: ItemKind): string => `hud.content.item.${k}.verb`;
export const itemHintKey = (k: ItemKind): string => `hud.content.item.${k}.hint`;
export const propNameKey = (v: PropVariant): string => `hud.content.prop.${v}`;
export const breakableNameKey = (b: BreakableKind): string => `hud.content.breakable.${b}`;
