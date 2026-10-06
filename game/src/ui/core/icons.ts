/**
 * Static SVG artwork for the UI: team emblems, loot shapes, menu icons and the parametric
 * raccoon portrait (hats, rival signatures, expressions).
 *
 * All markup here is authored in this file (trusted); no player text is ever interpolated.
 * Team/loot colors come from src/shared/teams.ts so render, minimap and UI agree.
 */
import type { HatId, LootKind, TeamId } from '../../sim/types';
import { LOOT_STYLE, TEAM_STYLES } from '../../shared/teams';
import { svgFromMarkup } from './dom';

export type RivalId = 'hodadak' | 'tongkeun' | 'nunchi';
export type Emblem = 'star' | 'moon';

const INK = '#2E2442';

// ---------------------------------------------------------------------------------------------
// Team emblems (shape first, color second — doc §13)
// ---------------------------------------------------------------------------------------------

/** Rounded 5-point star, 24x24 box. */
export const STAR_POINTS = '12,2.6 14.9,8.7 21.5,9.4 16.5,13.9 17.9,20.5 12,17.1 6.1,20.5 7.5,13.9 2.5,9.4 9.1,8.7';
/** Crescent moon (opening to the right), 24x24 box. */
export const MOON_PATH = 'M15.2 3.1A9.2 9.2 0 1 0 21 16.1A7.4 7.4 0 0 1 15.2 3.1Z';

export function emblemMarkup(emblem: Emblem, fill: string, stroke: string, strokeWidth = 1.7): string {
  const shape =
    emblem === 'star'
      ? `<polygon points="${STAR_POINTS}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>`
      : `<path d="${MOON_PATH}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>`;
  return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">${shape}</svg>`;
}

/** Team emblem icon in team colors. `variant: 'light'` draws a cream emblem for dark chips. */
export function teamEmblem(team: TeamId, className = 'uh-emblem', variant: 'color' | 'light' = 'color'): SVGSVGElement {
  const s = TEAM_STYLES[team];
  const svg = svgFromMarkup(
    variant === 'color' ? emblemMarkup(s.emblem, s.color, s.dark) : emblemMarkup(s.emblem, '#FFF9F0', s.dark),
    className,
  );
  svg.dataset.emblem = s.emblem;
  return svg;
}

// ---------------------------------------------------------------------------------------------
// Loot icons (shape + number; color is secondary)
// ---------------------------------------------------------------------------------------------

function smallSafeMarkup(): string {
  const c = LOOT_STYLE.smallSafe;
  return `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
  <rect x="9" y="38" width="7" height="5" rx="1.5" fill="${c.dark}"/><rect x="32" y="38" width="7" height="5" rx="1.5" fill="${c.dark}"/>
  <rect x="7" y="7" width="34" height="33" rx="7" fill="${c.color}" stroke="${INK}" stroke-width="3"/>
  <rect x="12" y="12" width="24" height="23" rx="4" fill="none" stroke="${c.dark}" stroke-width="2.4"/>
  <circle cx="24" cy="23.5" r="6" fill="#FFF6E8" stroke="${INK}" stroke-width="2.4"/>
  <path d="M24 19.5v4l2.6 1.8" stroke="${INK}" stroke-width="2.2" stroke-linecap="round" fill="none"/>
</svg>`;
}

function largeSafeMarkup(): string {
  const c = LOOT_STYLE.largeSafe;
  return `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
  <rect x="6" y="37" width="8" height="5" rx="1.5" fill="${c.dark}"/><rect x="34" y="37" width="8" height="5" rx="1.5" fill="${c.dark}"/>
  <rect x="2.5" y="9" width="43" height="30" rx="6" fill="${c.color}" stroke="${INK}" stroke-width="3"/>
  <path d="M24 13v22" stroke="${c.dark}" stroke-width="2.4"/>
  <circle cx="15" cy="24" r="5.4" fill="#FFF6E8" stroke="${INK}" stroke-width="2.3"/>
  <path d="M15 20.4v3.6l2.3 1.6" stroke="${INK}" stroke-width="2" stroke-linecap="round" fill="none"/>
  <rect x="30" y="19.5" width="9" height="9" rx="2" fill="#FFF6E8" stroke="${INK}" stroke-width="2.3"/>
  <path d="M34.5 21.5v5" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>
</svg>`;
}

function bankMarkup(): string {
  const c = LOOT_STYLE.bank;
  return `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
  <path d="M5 17L24 5l19 12z" fill="${c.color}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
  <rect x="7" y="17" width="34" height="4.5" rx="1.5" fill="${c.dark}" stroke="${INK}" stroke-width="2.4"/>
  <rect x="10" y="21.5" width="5" height="15" fill="#FFF3D6" stroke="${INK}" stroke-width="2.2"/>
  <rect x="21.5" y="21.5" width="5" height="15" fill="#FFF3D6" stroke="${INK}" stroke-width="2.2"/>
  <rect x="33" y="21.5" width="5" height="15" fill="#FFF3D6" stroke="${INK}" stroke-width="2.2"/>
  <rect x="5" y="36.5" width="38" height="6" rx="2" fill="${c.color}" stroke="${INK}" stroke-width="3"/>
  <circle cx="24" cy="12.6" r="2.4" fill="${INK}"/>
  <path d="M10 46c2-2.5 4-2.5 6 0M32 46c2-2.5 4-2.5 6 0" stroke="#8C6A3E" stroke-width="2" fill="none" stroke-linecap="round"/>
</svg>`;
}

export function lootIcon(kind: LootKind, className = 'uh-loot-icon'): SVGSVGElement {
  const markup = kind === 'smallSafe' ? smallSafeMarkup() : kind === 'largeSafe' ? largeSafeMarkup() : bankMarkup();
  const svg = svgFromMarkup(markup, className);
  svg.dataset.loot = kind;
  return svg;
}

// ---------------------------------------------------------------------------------------------
// Line icons (24x24, currentColor)
// ---------------------------------------------------------------------------------------------

export type IconName =
  | 'practice' | 'quick' | 'tournament' | 'wardrobe' | 'settings' | 'quit' | 'lock' | 'check'
  | 'play' | 'back' | 'chevLeft' | 'chevRight' | 'hat' | 'speaker' | 'display' | 'gamepad'
  | 'keyboard' | 'globe' | 'siren' | 'flag' | 'map' | 'van' | 'ping' | 'clock' | 'dice'
  | 'trophy' | 'sparkle' | 'reset' | 'home' | 'pause' | 'arrow' | 'hand' | 'bolt' | 'door';

const LINE = 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"';

const ICONS: Record<IconName, string> = {
  practice: `<path d="M8.5 20h7M12 3.5l-4.6 14h9.2z" ${LINE}/><path d="M9.3 12h5.4M10.3 8.5h3.4" ${LINE}/><path d="M5 20h14" ${LINE}/>`,
  quick: `<path d="M13.5 2.5L5 13.5h6l-1 8 8.5-11h-6z" ${LINE}/>`,
  tournament: `<path d="M7.5 3.5h9v5a4.5 4.5 0 0 1-9 0z" ${LINE}/><path d="M7.5 5.5H4.5a3 3 0 0 0 3 4M16.5 5.5h3a3 3 0 0 1-3 4M12 13v3.5M8.5 20.5h7M9.5 16.5h5l.5 4h-6z" ${LINE}/>`,
  wardrobe: `<path d="M12 6.5a2 2 0 1 1 2-2M12 6.5v1.6L3.2 14.6a1.4 1.4 0 0 0 .8 2.5h16a1.4 1.4 0 0 0 .8-2.5L12 8.1" ${LINE}/>`,
  settings: `<circle cx="12" cy="12" r="3.2" ${LINE}/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" ${LINE}/>`,
  quit: `<path d="M13.5 4.5h-7v15h7M10 12h10.5M17 8.5l3.5 3.5-3.5 3.5" ${LINE}/>`,
  lock: `<rect x="5" y="10.5" width="14" height="10" rx="2.5" ${LINE}/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2.5" ${LINE}/>`,
  check: `<path d="M4.5 12.5l4.8 4.8L19.5 7" ${LINE} stroke-width="3"/>`,
  play: `<path d="M8 5.5v13l10.5-6.5z" ${LINE}/>`,
  back: `<path d="M10 6l-6 6 6 6M4.5 12H20" ${LINE}/>`,
  chevLeft: `<path d="M14.5 5.5L8 12l6.5 6.5" ${LINE} stroke-width="3"/>`,
  chevRight: `<path d="M9.5 5.5L16 12l-6.5 6.5" ${LINE} stroke-width="3"/>`,
  hat: `<path d="M3 17.5c3-1.5 15-1.5 18 0M6 16.8V10a6 6 0 0 1 12 0v6.8" ${LINE}/><path d="M6 13c3.5 1 8.5 1 12 0" ${LINE}/>`,
  speaker: `<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" ${LINE}/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" ${LINE}/>`,
  display: `<rect x="3" y="4.5" width="18" height="12" rx="2" ${LINE}/><path d="M9 20h6M12 16.5V20" ${LINE}/>`,
  gamepad: `<path d="M7 8h10a4 4 0 0 1 3.9 4.8l-.8 4a2.4 2.4 0 0 1-4.2 1l-1.6-2.1H9.7l-1.6 2.1a2.4 2.4 0 0 1-4.2-1l-.8-4A4 4 0 0 1 7 8z" ${LINE}/><path d="M8 11.2v3M6.5 12.7h3" ${LINE}/><circle cx="15.8" cy="11.8" r=".9" fill="currentColor"/><circle cx="17.6" cy="13.6" r=".9" fill="currentColor"/>`,
  keyboard: `<rect x="2.5" y="6" width="19" height="12" rx="2" ${LINE}/><path d="M6 9.5h.01M9.5 9.5h.01M13 9.5h.01M16.5 9.5h.01M7.5 14.5h9" ${LINE}/>`,
  globe: `<circle cx="12" cy="12" r="8.8" ${LINE}/><path d="M3.5 12h17M12 3.2c2.6 2.6 3.6 5.6 3.6 8.8s-1 6.2-3.6 8.8c-2.6-2.6-3.6-5.6-3.6-8.8s1-6.2 3.6-8.8z" ${LINE}/>`,
  siren: `<path d="M6 18.5v-6a6 6 0 0 1 12 0v6M4 18.5h16v2.5H4zM12 2.5v2M4.2 5.7l1.4 1.4M19.8 5.7l-1.4 1.4" ${LINE}/>`,
  flag: `<path d="M5.5 21V4M5.5 4.5h11l-2 4 2 4h-11" ${LINE}/>`,
  map: `<path d="M3.5 6.5l5.5-2.5 6 2.5 5.5-2.5v13.5L15 20l-6-2.5-5.5 2.5z" ${LINE}/><path d="M9 4v13.5M15 6.5V20" ${LINE}/>`,
  van: `<path d="M2.5 16.5V7.5a1.5 1.5 0 0 1 1.5-1.5h10.5v10.5M14.5 9h3.8l3.2 3.6v3.9h-2" ${LINE}/><circle cx="7" cy="17" r="2" ${LINE}/><circle cx="17" cy="17" r="2" ${LINE}/>`,
  ping: `<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z" ${LINE}/><circle cx="12" cy="10" r="2.3" ${LINE}/>`,
  clock: `<circle cx="12" cy="12.5" r="8.3" ${LINE}/><path d="M12 8v4.8l3 1.9M9.5 2.5h5" ${LINE}/>`,
  dice: `<rect x="4" y="4" width="16" height="16" rx="3.5" ${LINE}/><circle cx="8.7" cy="8.7" r="1.3" fill="currentColor"/><circle cx="15.3" cy="15.3" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="15.3" cy="8.7" r="1.3" fill="currentColor"/><circle cx="8.7" cy="15.3" r="1.3" fill="currentColor"/>`,
  trophy: `<path d="M7.5 3.5h9v5a4.5 4.5 0 0 1-9 0z" ${LINE}/><path d="M7.5 5.5H4.5a3 3 0 0 0 3 4M16.5 5.5h3a3 3 0 0 1-3 4M12 13v3.5M8.5 20.5h7M9.5 16.5h5l.5 4h-6z" ${LINE}/>`,
  sparkle: `<path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z" ${LINE}/><path d="M19 17l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" fill="currentColor"/>`,
  reset: `<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4h4" ${LINE}/>`,
  home: `<path d="M3.5 11.5L12 4l8.5 7.5M6 10v10h12V10" ${LINE}/>`,
  pause: `<path d="M8.5 5v14M15.5 5v14" ${LINE} stroke-width="3.2"/>`,
  arrow: `<path d="M12 3l8 12h-5v6h-6v-6H4z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`,
  hand: `<path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v7c0 4.5-2.5 7.5-6.5 7.5-3 0-4.5-1.5-6-4.5L3.3 13a1.5 1.5 0 0 1 2.4-1.8L8 14" ${LINE}/>`,
  bolt: `<path d="M13.5 2.5L5 13.5h6l-1 8 8.5-11h-6z" ${LINE}/>`,
  door: `<path d="M5 21V4.5A1.5 1.5 0 0 1 6.5 3h11A1.5 1.5 0 0 1 19 4.5V21M3 21h18M15 12h.01" ${LINE}/>`,
};

export function icon(name: IconName, className = 'uh-icon'): SVGSVGElement {
  return svgFromMarkup(`<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">${ICONS[name]}</svg>`, className);
}

// ---------------------------------------------------------------------------------------------
// Raccoon portrait
// ---------------------------------------------------------------------------------------------

export type Expression = 'neutral' | 'happy' | 'sad' | 'smug' | 'determined' | 'surprised';

export interface RaccoonOptions {
  hat?: HatId;
  /** Rival signature: implies their hat + default expression unless overridden. */
  rival?: RivalId | null;
  expression?: Expression;
  /** Team badge (emblem) at the bottom-right. Null = no badge. */
  team?: TeamId | null;
  /** Show a silhouette (locked items). */
  silhouette?: boolean;
}

const RIVAL_LOOK: Readonly<Record<RivalId, { hat: HatId; expression: Expression }>> = {
  hodadak: { hat: 'hodadakBand', expression: 'determined' },
  tongkeun: { hat: 'tongkeunHat', expression: 'happy' },
  nunchi: { hat: 'nunchiMask', expression: 'smug' },
};

const FUR = '#A9A4BE';
const FUR_DARK = '#7F7998';
const MASK = '#3E3656';
const CREAM = '#F7EFE4';

function ears(): string {
  return `
  <path d="M58 80C47 54 45 36 52 24C64 26 82 40 92 60Z" fill="${FUR_DARK}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
  <path d="M142 80C153 54 155 36 148 24C136 26 118 40 108 60Z" fill="${FUR_DARK}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
  <path d="M62 68C58 54 58 44 60 36C68 40 77 49 83 60Z" fill="#EADFEE"/>
  <path d="M138 68C142 54 142 44 140 36C132 40 123 49 117 60Z" fill="#EADFEE"/>`;
}

function head(mask: boolean): string {
  return `
  <path d="M100 46C140 46 168 70 171 104C172 116 180 121 186 128C177 130 172 134 170 141C162 166 134 182 100 182C66 182 38 166 30 141C28 134 23 130 14 128C20 121 28 116 29 104C32 70 60 46 100 46Z" fill="${FUR}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
  <path d="M100 50C95 62 93 76 95 90H105C107 76 105 62 100 50Z" fill="${FUR_DARK}"/>
  <path d="M100 106C80 106 61 114 53 129C47 143 57 162 79 168C91 171 109 171 121 168C143 162 153 143 147 129C139 114 120 106 100 106Z" fill="${CREAM}"/>
  <path d="M60 96C68 88 80 88 88 94M140 96C132 88 120 88 112 94" stroke="${CREAM}" stroke-width="6" stroke-linecap="round" fill="none"/>
  ${mask ? `<path d="M34 114C44 94 72 91 95 105C98 107 102 107 105 105C128 91 156 94 166 114C162 130 147 137 131 133C118 130 110 125 100 125C90 125 82 130 69 133C53 137 38 130 34 114Z" fill="${MASK}"/>` : ''}`;
}

function eyes(expr: Expression, onMask: boolean): string {
  const lid = onMask ? '#F7EFE4' : INK;
  switch (expr) {
    case 'happy':
      return `<path d="M60 116Q71 103 82 116M118 116Q129 103 140 116" stroke="${lid}" stroke-width="6" stroke-linecap="round" fill="none"/>`;
    case 'sad':
      return `
      <ellipse cx="71" cy="115" rx="10" ry="11" fill="#fff"/><ellipse cx="129" cy="115" rx="10" ry="11" fill="#fff"/>
      <circle cx="71" cy="119" r="6.5" fill="#1C1528"/><circle cx="129" cy="119" r="6.5" fill="#1C1528"/>
      <circle cx="73.5" cy="116" r="2.2" fill="#fff"/><circle cx="131.5" cy="116" r="2.2" fill="#fff"/>
      <path d="M58 99L80 105M142 99L120 105" stroke="${CREAM}" stroke-width="5" stroke-linecap="round"/>
      <path d="M63 130C61 136 63 140 66 140C69 140 70 136 68 131Z" fill="#8FD3FF" stroke="${INK}" stroke-width="2"/>`;
    case 'smug':
      return `
      <ellipse cx="71" cy="116" rx="10" ry="9" fill="#fff"/><ellipse cx="129" cy="116" rx="10" ry="9" fill="#fff"/>
      <circle cx="74" cy="118" r="6" fill="#1C1528"/><circle cx="132" cy="118" r="6" fill="#1C1528"/>
      <path d="M59 113Q71 106 83 112L83 106L59 106Z" fill="${MASK}"/><path d="M117 112Q129 106 141 113L141 106L117 106Z" fill="${MASK}"/>
      <path d="M59 113Q71 107 83 112M117 112Q129 107 141 113" stroke="${CREAM}" stroke-width="3.5" stroke-linecap="round" fill="none"/>`;
    case 'determined':
      return `
      <ellipse cx="71" cy="116" rx="10.5" ry="11" fill="#fff"/><ellipse cx="129" cy="116" rx="10.5" ry="11" fill="#fff"/>
      <circle cx="72.5" cy="117" r="7" fill="#1C1528"/><circle cx="127.5" cy="117" r="7" fill="#1C1528"/>
      <circle cx="75" cy="114" r="2.5" fill="#fff"/><circle cx="130" cy="114" r="2.5" fill="#fff"/>
      <path d="M58 101L82 107M142 101L118 107" stroke="${CREAM}" stroke-width="5" stroke-linecap="round"/>`;
    case 'surprised':
      return `
      <ellipse cx="71" cy="114" rx="12" ry="13" fill="#fff"/><ellipse cx="129" cy="114" rx="12" ry="13" fill="#fff"/>
      <circle cx="71" cy="114" r="5.5" fill="#1C1528"/><circle cx="129" cy="114" r="5.5" fill="#1C1528"/>
      <circle cx="73" cy="111.5" r="2" fill="#fff"/><circle cx="131" cy="111.5" r="2" fill="#fff"/>`;
    case 'neutral':
    default:
      return `
      <ellipse cx="71" cy="115" rx="10.5" ry="11.5" fill="#fff"/><ellipse cx="129" cy="115" rx="10.5" ry="11.5" fill="#fff"/>
      <circle cx="72" cy="116" r="7" fill="#1C1528"/><circle cx="128" cy="116" r="7" fill="#1C1528"/>
      <circle cx="74.6" cy="113" r="2.6" fill="#fff"/><circle cx="130.6" cy="113" r="2.6" fill="#fff"/>`;
  }
}

function mouth(expr: Expression): string {
  const nose = `<path d="M90 136C90 130 110 130 110 136C110 142 104 146 100 146C96 146 90 142 90 136Z" fill="#2A2238"/><ellipse cx="96" cy="134.5" rx="3" ry="1.8" fill="#fff" opacity=".55"/>`;
  const blush = `<ellipse cx="56" cy="146" rx="9" ry="5" fill="#FF9EAE" opacity=".6"/><ellipse cx="144" cy="146" rx="9" ry="5" fill="#FF9EAE" opacity=".6"/>`;
  let m: string;
  switch (expr) {
    case 'happy':
      m = `<path d="M86 150Q100 172 114 150Z" fill="#7A2E4A" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><path d="M93 158Q100 164 107 158Q103 155 100 156Q97 155 93 158Z" fill="#FF8FA3"/>`;
      break;
    case 'sad':
      m = `<path d="M90 161Q100 151 110 161" stroke="${INK}" stroke-width="4" stroke-linecap="round" fill="none"/>`;
      break;
    case 'smug':
      m = `<path d="M90 154Q103 162 114 149" stroke="${INK}" stroke-width="4" stroke-linecap="round" fill="none"/>`;
      break;
    case 'determined':
      m = `<path d="M88 152Q100 162 112 152Z" fill="#7A2E4A" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><path d="M92 152.5h16" stroke="#fff" stroke-width="3"/>`;
      break;
    case 'surprised':
      m = `<ellipse cx="100" cy="157" rx="6" ry="7" fill="#7A2E4A" stroke="${INK}" stroke-width="3.5"/>`;
      break;
    case 'neutral':
    default:
      m = `<path d="M88 151Q94 158 100 151Q106 158 112 151" stroke="${INK}" stroke-width="4" stroke-linecap="round" fill="none"/>`;
  }
  return nose + m + blush;
}

function hatMarkup(hat: HatId): { back: string; front: string; earsOnTop: boolean; hideMask?: boolean } {
  const t0 = TEAM_STYLES[0];
  const t1 = TEAM_STYLES[1];
  switch (hat) {
    case 'teamCapA':
      return {
        back: '',
        earsOnTop: false,
        front: `
        <path d="M46 86C44 56 66 36 92 30C100 18 112 10 122 12C116 18 112 24 112 30C140 38 158 58 154 86Z" fill="${t0.color}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
        <path d="M40 80C70 70 130 70 160 80L162 98C130 88 70 88 38 98Z" fill="${t0.dark}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
        <path d="M58 76v14M74 73v14M90 72v14M106 72v14M122 73v14M138 75v14" stroke="${t0.color}" stroke-width="3" stroke-linecap="round" opacity=".7"/>
        <g transform="translate(110 -4) scale(1.35)"><polygon points="${STAR_POINTS}" fill="#FFD66B" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/></g>
        <g transform="translate(86 42) scale(1.2)"><polygon points="${STAR_POINTS}" fill="#FFF9F0" stroke="${t0.dark}" stroke-width="2" stroke-linejoin="round"/></g>`,
      };
    case 'teamCapB':
      return {
        back: '',
        earsOnTop: true,
        front: `
        <path d="M44 92C42 54 70 32 100 32C130 32 158 54 156 92Z" fill="${t1.color}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
        <path d="M62 52C72 42 86 38 98 38" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".55" fill="none"/>
        <path d="M38 90C66 102 134 102 162 90L160 100C132 112 68 112 40 100Z" fill="${t1.tint}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
        <ellipse cx="100" cy="26" rx="16" ry="7" fill="none" stroke="${INK}" stroke-width="9"/>
        <ellipse cx="100" cy="26" rx="16" ry="7" fill="none" stroke="#FFD66B" stroke-width="4.5"/>
        <g transform="translate(86 50) scale(1.2)"><path d="${MOON_PATH}" fill="#FFF9F0" stroke="${t1.dark}" stroke-width="2" stroke-linejoin="round"/></g>`,
      };
    case 'hodadakBand':
      return {
        back: '',
        earsOnTop: false,
        front: `
        <path d="M33 86C68 70 132 70 167 86L165 101C130 87 70 87 35 101Z" fill="#FF5A5F" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
        <path d="M44 88C76 78 124 78 156 88" stroke="#fff" stroke-width="4" stroke-linecap="round" fill="none"/>
        <path d="M164 90C176 80 188 78 196 80C190 86 184 90 172 94Z" fill="#FF5A5F" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
        <path d="M166 96C178 98 188 104 194 112C184 112 174 108 166 102Z" fill="#FF5A5F" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
        <circle cx="166" cy="94" r="7" fill="#E0404A" stroke="${INK}" stroke-width="4"/>`,
      };
    case 'tongkeunHat':
      return {
        back: '',
        earsOnTop: false,
        front: `
        <g transform="rotate(-8 104 54)">
          <ellipse cx="104" cy="56" rx="60" ry="12" fill="#3B2C52" stroke="${INK}" stroke-width="5"/>
          <path d="M72 56L76 4H132L136 56Z" fill="#4A3866" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
          <path d="M74 42H134L135 54H73Z" fill="#FFC23D" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
          <path d="M84 12L86 36" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".3"/>
          <circle cx="104" cy="48" r="5" fill="#FF8A3D" stroke="${INK}" stroke-width="3"/>
        </g>`,
      };
    case 'nunchiMask':
      return {
        back: '',
        earsOnTop: false,
        hideMask: true,
        front: `
        <path d="M30 112C40 90 72 88 96 103C98 104 102 104 104 103C128 88 160 90 170 112C166 132 148 139 131 135C118 132 110 127 100 127C90 127 82 132 69 135C52 139 34 132 30 112Z" fill="#6E3FA3" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
        <path d="M31 108C22 104 14 106 8 112C16 114 22 114 30 116Z" fill="#6E3FA3" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
        <path d="M31 114C24 120 20 128 20 136C28 130 32 124 34 118Z" fill="#6E3FA3" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
        <ellipse cx="71" cy="115" rx="14" ry="13" fill="#3E3656" stroke="#B58BE8" stroke-width="3"/>
        <ellipse cx="129" cy="115" rx="14" ry="13" fill="#3E3656" stroke="#B58BE8" stroke-width="3"/>
        <path d="M150 96l2.5 6 6 2.5-6 2.5-2.5 6-2.5-6-6-2.5 6-2.5z" fill="#FFD66B"/>`,
      };
    case 'none':
    default:
      return { back: '', front: '', earsOnTop: false };
  }
}

function badge(team: TeamId): string {
  const s = TEAM_STYLES[team];
  const shape =
    s.emblem === 'star'
      ? `<g transform="translate(149 155) scale(1.15)"><polygon points="${STAR_POINTS}" fill="${s.color}" stroke="${s.dark}" stroke-width="2" stroke-linejoin="round"/></g>`
      : `<g transform="translate(149 155) scale(1.15)"><path d="${MOON_PATH}" fill="${s.color}" stroke="${s.dark}" stroke-width="2" stroke-linejoin="round"/></g>`;
  return `<circle cx="163" cy="169" r="22" fill="#FFF9F0" stroke="${INK}" stroke-width="5"/>${shape}`;
}

/** Build the raccoon portrait markup (200x200 box). */
export function raccoonMarkup(o: RaccoonOptions = {}): string {
  const rivalLook = o.rival ? RIVAL_LOOK[o.rival] : null;
  const hat: HatId = o.hat ?? rivalLook?.hat ?? 'none';
  const expr: Expression = o.expression ?? rivalLook?.expression ?? 'neutral';
  const hm = hatMarkup(hat);
  const showMask = !hm.hideMask;
  const parts = [
    hm.back,
    hm.earsOnTop ? '' : ears(),
    head(showMask),
    eyes(expr, showMask),
    mouth(expr),
    hm.front,
    hm.earsOnTop ? ears() : '',
    o.team !== undefined && o.team !== null ? badge(o.team) : '',
  ].join('');
  const filter = o.silhouette
    ? `<defs><filter id="uh-sil"><feColorMatrix type="matrix" values="0 0 0 0 0.24  0 0 0 0 0.2  0 0 0 0 0.33  0 0 0 1 0"/></filter></defs><g filter="url(#uh-sil)" opacity=".85">${parts}</g>`
    : parts;
  return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">${filter}</svg>`;
}

export function raccoon(o: RaccoonOptions = {}, className = 'uh-raccoon'): SVGSVGElement {
  return svgFromMarkup(raccoonMarkup(o), className);
}
