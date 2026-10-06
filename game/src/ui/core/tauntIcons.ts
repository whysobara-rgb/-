/**
 * Taunt icons for the emote wheel and hints (owner addition): one hand-authored SVG per taunt in
 * the sticker style (same ink line and palette as the in-world taunt bubbles in
 * src/render/models/art.ts — the same motifs, redrawn as vectors). Each icon has one moving part
 * (`.uh-ti__a`) that CSS animates while the icon is live (`.is-live` on an ancestor): the tail
 * swishes, the tongue wags, the fan flaps, the spring boings, the speed lines stream, the arm
 * pumps, the paws shrug. Reduced motion keeps them still.
 *
 * Markup is static and authored here (trusted); no player text is ever interpolated.
 */
import type { EmoteId } from '../../sim/types';
import { svgFromMarkup } from './dom';

const INK = '#2A2131';
const FUR = '#B9AEB5';
const FUR_D = '#4A3F4D';
const CREAM = '#F7E2C8';
const PINK = '#FF7F9C';

const twinkle = (x: number, y: number, r: number, fill = '#FFD45C'): string => {
  const pts: string[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * 0.34 : r;
    pts.push(`${(x + Math.cos(a) * rr).toFixed(1)},${(y + Math.sin(a) * rr).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`;
};

const paw = (x: number, y: number, s: number, rot: number): string =>
  `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">
    <ellipse cx="0" cy="0" rx="9" ry="8" fill="${CREAM}" stroke="${INK}" stroke-width="2.6"/>
    <ellipse cx="0" cy="2" rx="4.2" ry="3.3" fill="#E79AA8"/>
    <circle cx="-5" cy="-4.4" r="1.7" fill="#E79AA8"/><circle cx="-1.8" cy="-6.8" r="1.7" fill="#E79AA8"/>
    <circle cx="1.8" cy="-6.8" r="1.7" fill="#E79AA8"/><circle cx="5" cy="-4.4" r="1.7" fill="#E79AA8"/>
  </g>`;

const MARKUP: Readonly<Record<EmoteId, string>> = {
  wiggle: `<path d="M9 30a24 24 0 0 1 4-12M55 30a24 24 0 0 0-4-12M7 40a26 26 0 0 0 4 9M57 40a26 26 0 0 1-4 9" fill="none" stroke="${PINK}" stroke-width="3.2" stroke-linecap="round"/>
    <g class="uh-ti__a uh-ti__a--swish">
      <clipPath id="uh-ti-tail"><path d="M28 56C14 46 18 18 34 12c12-4 18 6 12 13-5 6-6 17-6 31z"/></clipPath>
      <path d="M28 56C14 46 18 18 34 12c12-4 18 6 12 13-5 6-6 17-6 31z" fill="${FUR}"/>
      <g clip-path="url(#uh-ti-tail)" fill="${FUR_D}">
        <ellipse cx="32" cy="19" rx="22" ry="4.2" transform="rotate(-14 32 19)"/>
        <ellipse cx="32" cy="32" rx="22" ry="4.2" transform="rotate(-10 32 32)"/>
        <ellipse cx="32" cy="45" rx="22" ry="4.2" transform="rotate(-6 32 45)"/>
      </g>
      <path d="M28 56C14 46 18 18 34 12c12-4 18 6 12 13-5 6-6 17-6 31z" fill="none" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    </g>`,
  bleh: `<ellipse cx="32" cy="31" rx="21" ry="19" fill="${CREAM}" stroke="${INK}" stroke-width="3"/>
    <ellipse cx="22.5" cy="27" rx="8" ry="6" fill="${FUR_D}" transform="rotate(-14 22.5 27)"/>
    <ellipse cx="41.5" cy="27" rx="8" ry="6" fill="${FUR_D}" transform="rotate(14 41.5 27)"/>
    <path d="M18.5 28.5q4-5 8 0" fill="none" stroke="#FFF6E6" stroke-width="2.6" stroke-linecap="round"/>
    <circle cx="41.5" cy="26" r="3.2" fill="#fff"/>
    <ellipse cx="41.5" cy="32.5" rx="4.4" ry="2.1" fill="#FF8FA8"/>
    <path d="M25.5 38.5q6.5 3 13 0q-6.5 5-13 0z" fill="#7A2E45"/>
    <g class="uh-ti__a uh-ti__a--wag"><path d="M27 39.5h10q1.5 12-5 12.5q-6.5-.5-5-12.5z" fill="${PINK}" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/><path d="M32 42v6" stroke="#D9536F" stroke-width="1.6" stroke-linecap="round"/></g>`,
  fanCash: `<g class="uh-ti__a uh-ti__a--flap">
      ${[-30, 0, 30]
        .map(
          (a) => `<g transform="rotate(${a} 32 52)"><rect x="24" y="14" width="16" height="32" rx="3" fill="#DDF4CB" stroke="${INK}" stroke-width="2.6"/>
        <rect x="27" y="17" width="10" height="26" rx="2" fill="none" stroke="#5FA86A" stroke-width="1.6"/><circle cx="32" cy="30" r="4" fill="#FFC93C"/></g>`,
        )
        .join('')}
      <circle cx="32" cy="52" r="3.6" fill="${CREAM}" stroke="${INK}" stroke-width="2.2"/>
    </g>
    ${twinkle(51, 13, 6.5)}`,
  squatBounce: `<g class="uh-ti__a uh-ti__a--boing">
      <path d="M19 47L45 41L19 35L45 29L19 23L45 17" fill="none" stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/>
      <path d="M19 47L45 41L19 35L45 29L19 23L45 17" fill="none" stroke="${PINK}" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round"/>
    </g>
    <rect x="15" y="48" width="34" height="7" rx="3" fill="#8C74E8" stroke="${INK}" stroke-width="2.6"/>
    <g class="uh-ti__a uh-ti__a--pop">${twinkle(10, 22, 5.5)}${twinkle(55, 30, 4.8, '#FFFFFF')}</g>`,
  hodadakZoom: `<g class="uh-ti__a uh-ti__a--stream" stroke="#7FC8FF" stroke-width="3.2" stroke-linecap="round">
      <path d="M4 25h12"/><path d="M2 33h17"/><path d="M5 41h11"/>
    </g>
    <g class="uh-ti__a uh-ti__a--jitter">
      <path d="M21 24q1-6 10-4l5 9q15 2 17 11v4H20z" fill="#fff" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
      <rect x="18.5" y="43" width="37" height="6" rx="2.6" fill="#8FE3C8" stroke="${INK}" stroke-width="2.4"/>
      <path d="M32 39l7-8M38 40l6-7" stroke="#E8505B" stroke-width="3" stroke-linecap="round"/>
    </g>`,
  tongkeunFlex: `<g class="uh-ti__a uh-ti__a--pump">
      <path d="M10 48q-1-12 11-14q2-12 12-5l4-8l9 4q-3 13-10 17q-9 9-17 7z" fill="${FUR}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M21 39q5-5 10 0" fill="none" stroke="#8F8390" stroke-width="2" stroke-linecap="round"/>
      ${paw(42, 18, 0.9, 22)}
    </g>
    <g class="uh-ti__a uh-ti__a--twinkle">${twinkle(14, 17, 7.5)}${twinkle(54, 44, 4.6, '#FFFFFF')}</g>`,
  nunchiShrug: `<ellipse cx="32" cy="36" rx="14" ry="13" fill="${CREAM}" stroke="${INK}" stroke-width="3"/>
    <ellipse cx="26.5" cy="33.5" rx="5" ry="3.8" fill="${FUR_D}"/><ellipse cx="37.5" cy="33.5" rx="5" ry="3.8" fill="${FUR_D}"/>
    <path d="M22.5 34h8M33.5 34h8" stroke="#FFF6E6" stroke-width="1.9" stroke-linecap="round"/>
    <path d="M28.5 42.5q5 1.5 8.5-2.5" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>
    <g class="uh-ti__a uh-ti__a--shrug">${paw(11, 28, 0.78, -28)}${paw(53, 28, 0.78, 28)}
      <path d="M15 15l2-4M49 15l-2-4" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/></g>`,
};

/** The taunt's icon as an SVG element (64x64 artboard). */
export function tauntIcon(id: EmoteId, className = 'uh-tauntIcon'): SVGSVGElement {
  const svg = svgFromMarkup(`<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${MARKUP[id] ?? ''}</svg>`, `${className} uh-ti uh-ti--${id}`);
  svg.setAttribute('aria-hidden', 'true');
  return svg;
}
