/**
 * Art-direction palette for the procedural models: a cozy, toy-like town plaza at dusk.
 * Pastel bases with a few saturated accents. Team colors always come from
 * `TEAM_STYLES` (src/shared/teams.ts) and loot colors from `LOOT_STYLE`; neutral props
 * deliberately avoid the team orange/blue so a big surface never reads as "a team thing".
 */
export const PAL = {
  // --- raccoon -------------------------------------------------------------
  fur: '#9A95A8',
  furWarm: '#A8988C',
  furCool: '#8E97AC',
  furDark: '#4C4656',
  furLight: '#D8D2E0',
  cream: '#FFF3DE',
  mask: '#3A3443',
  nose: '#2A2430',
  paw: '#4C4656',
  blush: '#FF9DB0',
  tailLight: '#B3AEC0',
  tailDark: '#4C4656',
  earInner: '#F2B8C6',

  // --- metals / generic ----------------------------------------------------
  gold: '#F6C64F',
  goldDark: '#C88F25',
  goldLight: '#FFE7A1',
  silver: '#DCE1EA',
  steel: '#9AA3B6',
  steelDark: '#5F6779',
  ink: '#2E2A36',
  white: '#FFFFFF',
  black: '#25222B',
  glass: '#BFE3F2',
  glassNight: '#FFE2A6',
  wood: '#C08A5A',
  woodDark: '#8C5E3B',
  woodLight: '#E2B485',
  rope: '#E9D6B0',

  // --- bank ----------------------------------------------------------------
  plaster: '#FFF4E3',
  plasterShade: '#F2E3CB',
  stone: '#E3D5C2',
  stoneDark: '#C7B59D',
  column: '#FFFBF3',
  bankRoof: '#5DB8A6',
  bankRoofDark: '#3E8F80',
  bankTrim: '#F6C64F',
  floorA: '#F7EEDC',
  floorB: '#8FCDBF',
  vault: '#B9C1D0',

  // --- roots / pipes / cables ---------------------------------------------
  root: '#9A6A45',
  rootDark: '#6E4A30',
  pipe: '#9DB7C9',
  pipeDark: '#6D8799',
  pipeCopper: '#D9895B',
  cable: '#3A3542',
  cableStripe: '#FFD84D',
  dirt: '#8A6748',
  dirtDark: '#6A4E37',
  spark: '#FFF2A8',

  // --- ground & nature -----------------------------------------------------
  paving: '#E9E0D4',
  pavingLine: '#D2C5B5',
  pavingAlt: '#F3E7D4',
  curb: '#D9D0C6',
  curbDark: '#BDB2A6',
  asphalt: '#6F6C7E',
  asphaltLine: '#F3EBD8',
  grass: '#9ED48A',
  grassDark: '#7DBE72',
  grassLight: '#BCE5A3',
  soil: '#8E6A4E',
  leaf: '#7CC47A',
  leafDark: '#5DAA67',
  leafLight: '#A6DB8A',
  trunk: '#9A6B4F',
  water: '#7FD3E8',
  waterDeep: '#4FB2D6',
  hedge: '#6FBF73',

  // --- town accents ---------------------------------------------------------
  lampPost: '#4F5A6E',
  lampGlow: '#FFD27A',
  awningRed: '#F2777A',
  awningMint: '#79CDB4',
  awningYellow: '#FFD45C',
  awningPink: '#FF9FBF',
  awningLilac: '#B9A3F0',
  cone: '#F26B5B',
  hydrant: '#E8505B',
  trash: '#6FA89A',
  balloon: ['#FF8FA3', '#FFD45C', '#8FE3C8', '#B9A3F0', '#FFFFFF'] as readonly string[],
  flowers: ['#FF8FA3', '#FFD45C', '#FFFFFF', '#B9A3F0', '#FF6F91'] as readonly string[],
  fence: '#FFF1E0',
  fenceStripe: '#E85D6A',
  confetti: ['#FF8FA3', '#FFD45C', '#8FE3C8', '#B9A3F0', '#7FC8FF', '#FFFFFF'] as readonly string[],

  // --- sky / atmosphere (for the lighting helper and the gallery) ------------
  skyTop: '#6E6AA8',
  skyHorizon: '#F7B39A',
  fog: '#C8B4C6',
  sun: '#FFD3AC',
  hemiSky: '#B8C4FF',
  hemiGround: '#D9C3B4',
} as const;

export type SignIcon = 'cup' | 'bread' | 'star' | 'flower' | 'book' | 'fork' | 'note' | 'cone' | 'bowl' | 'bubbles' | 'leaf' | 'cross' | 'wheel' | 'mail' | 'none';

export interface BuildingStyle {
  body: string;
  trim: string;
  accent: string;
  roof: string;
  awning: string;
  sign: string;
  signText: string;
  icon: SignIcon;
  /** Roof treatment. */
  roofKind?: 'flat' | 'hanok' | 'gable';
}

/** Building facade palettes keyed by StaticBoxDef.style (layouts/meta.ts SHOP_STYLES). */
export const BUILDING_STYLES: Record<string, BuildingStyle> = {
  cafe: { body: '#C9EBDD', trim: '#FFFFFF', accent: '#7A5844', roof: '#8CCFB9', awning: PAL.awningMint, sign: '#7A5844', signText: '#FFF3DE', icon: 'cup' },
  tea: { body: '#E4F0C8', trim: '#FFFFFF', accent: '#6E8B4E', roof: '#A9C98A', awning: '#9CCB7A', sign: '#6E8B4E', signText: '#FFF8E6', icon: 'cup' },
  bakery: { body: '#FFD3DE', trim: '#FFFFFF', accent: '#C9746E', roof: '#F2A0AE', awning: PAL.awningPink, sign: '#FFFFFF', signText: '#C9566E', icon: 'bread', roofKind: 'gable' },
  toy: { body: '#FFE69A', trim: '#FFFFFF', accent: '#E85D6A', roof: '#F7C95E', awning: PAL.awningRed, sign: '#E85D6A', signText: '#FFFFFF', icon: 'star' },
  arcade: { body: '#D9C9FF', trim: '#FFFFFF', accent: '#6A4FC9', roof: '#B7A1F2', awning: '#8C74E8', sign: '#3B2E6E', signText: '#FFE14D', icon: 'star' },
  flower: { body: '#F3DDF5', trim: '#FFFFFF', accent: '#B46BC9', roof: '#D9AEE6', awning: PAL.awningLilac, sign: '#FFFFFF', signText: '#A54FC0', icon: 'flower', roofKind: 'gable' },
  icecream: { body: '#D4F1FA', trim: '#FFFFFF', accent: '#E87FA8', roof: '#FFC2D8', awning: '#FF9FBF', sign: '#FFFFFF', signText: '#E0608F', icon: 'cone' },
  books: { body: '#F5E2C4', trim: '#FFFFFF', accent: '#7E6A52', roof: '#D8B98E', awning: PAL.awningYellow, sign: '#4F6B5A', signText: '#FFF3DE', icon: 'book', roofKind: 'gable' },
  music: { body: '#FFD9C2', trim: '#FFFFFF', accent: '#4F4A7A', roof: '#F2B08E', awning: '#7A74C9', sign: '#2E2A46', signText: '#FFD45C', icon: 'note' },
  ramen: { body: '#FFE9D2', trim: '#FFFFFF', accent: '#C2443C', roof: '#E8846E', awning: '#E8605A', sign: '#C2443C', signText: '#FFF3DE', icon: 'bowl' },
  laundry: { body: '#DDF0FF', trim: '#FFFFFF', accent: '#4F8CC9', roof: '#A9CCEF', awning: '#8FC8F2', sign: '#FFFFFF', signText: '#3F7CBF', icon: 'bubbles' },
  grocery: { body: '#E6F5D6', trim: '#FFFFFF', accent: '#5E9E4E', roof: '#B5DB98', awning: '#7CC46A', sign: '#5E9E4E', signText: '#FFFFFF', icon: 'leaf' },
  pharmacy: { body: '#F2FAF6', trim: '#FFFFFF', accent: '#3FA37C', roof: '#9BD8BE', awning: '#5FC49B', sign: '#FFFFFF', signText: '#2F8C66', icon: 'cross' },
  bike: { body: '#FFF0B8', trim: '#FFFFFF', accent: '#3F7FA6', roof: '#F2D27A', awning: '#5FB6D9', sign: '#3F7FA6', signText: '#FFFFFF', icon: 'wheel' },
  glass: { body: '#CFE3F2', trim: '#F4F8FC', accent: '#5E7896', roof: '#A9C2D8', awning: PAL.awningLilac, sign: '#FFFFFF', signText: '#4F6C8E', icon: 'none' },
  brick: { body: '#E89C84', trim: '#FFF1E0', accent: '#9C5A4A', roof: '#B9695A', awning: PAL.awningYellow, sign: '#4F4258', signText: '#FFE7A1', icon: 'mail' },
  hanok: { body: '#FFF6E6', trim: '#8C5E3B', accent: '#8C5E3B', roof: '#8C95A8', awning: '#C9A27A', sign: '#8C5E3B', signText: '#FFF3DE', icon: 'none', roofKind: 'hanok' },
  // Kiosks (layouts/meta.ts KIOSK_STYLES)
  tteokbokki: { body: '#FFD0C2', trim: '#FFFFFF', accent: '#E8505B', roof: '#E8505B', awning: '#E8505B', sign: '#FFFFFF', signText: '#E8505B', icon: 'bowl' },
  lemonade: { body: '#FFF2A8', trim: '#FFFFFF', accent: '#E8B820', roof: '#FFD45C', awning: '#FFD45C', sign: '#FFFFFF', signText: '#D49A00', icon: 'cup' },
  default: { body: '#F7E7C8', trim: '#FFFFFF', accent: '#8A7660', roof: '#E1C79B', awning: PAL.awningRed, sign: '#FFFFFF', signText: '#5E4E62', icon: 'none' },
};

export function buildingStyle(style: string | undefined): BuildingStyle {
  return (style && BUILDING_STYLES[style]) || BUILDING_STYLES.default;
}

/** Languages the built-in fallback sign names exist in (matches LAYOUT_STRINGS / ui i18n). */
export type SignLanguage = 'ko' | 'en';

/**
 * Fallback shop names per building/kiosk style, used when a sign has no signKey (kiosks,
 * unnamed buildings) and the sign resolver does not know 'sign.style.<style>'.
 */
export const STYLE_FALLBACK_NAMES_BY_LANG: Readonly<Record<SignLanguage, Readonly<Record<string, string>>>> = {
  ko: {
    cafe: '너굴 카페',
    tea: '찻집',
    bakery: '꼬리 빵집',
    toy: '장난감 가게',
    arcade: '오락실',
    flower: '꽃집',
    icecream: '아이스크림',
    books: '책방',
    music: '음반가게',
    ramen: '라멘',
    laundry: '빨래방',
    grocery: '채소가게',
    pharmacy: '약국',
    bike: '자전거',
    glass: '상가',
    brick: '우체국',
    hanok: '떡집',
    tteokbokki: '떡볶이',
    lemonade: '레모네이드',
    default: '동네 가게',
  },
  en: {
    cafe: 'Raccoon Café',
    tea: 'Tea House',
    bakery: 'Tail Bakery',
    toy: 'Toy Shop',
    arcade: 'Arcade',
    flower: 'Florist',
    icecream: 'Ice Cream',
    books: 'Book Nook',
    music: 'Records',
    ramen: 'Ramen',
    laundry: 'Laundromat',
    grocery: 'Greengrocer',
    pharmacy: 'Pharmacy',
    bike: 'Bikes',
    glass: 'Shops',
    brick: 'Post Office',
    hanok: 'Rice Cakes',
    tteokbokki: 'Tteokbokki',
    lemonade: 'Lemonade',
    default: 'Corner Shop',
  },
};

/** Korean fallback names (kept for callers of the original export). */
export const STYLE_FALLBACK_NAMES: Readonly<Record<string, string>> = STYLE_FALLBACK_NAMES_BY_LANG.ko;

export function styleFallbackName(style: string | undefined, lang: SignLanguage): string {
  const table = STYLE_FALLBACK_NAMES_BY_LANG[lang] ?? STYLE_FALLBACK_NAMES_BY_LANG.ko;
  return table[style ?? 'default'] ?? table.default;
}

/**
 * Backdrop (outside the arena) shop names. A sign resolver that knows 'sign.backdrop.N'
 * overrides them; otherwise the detected sign language picks `ko` / `en`.
 */
export const BACKDROP_SIGNS: readonly { text: string; en: string; style: string }[] = [
  { text: '도토리 우체국', en: 'Acorn Post', style: 'brick' },
  { text: '보들 세탁소', en: 'Fluffy Cleaners', style: 'laundry' },
  { text: '냠냠 분식', en: 'Yum-Yum Snacks', style: 'ramen' },
  { text: '토닥 약국', en: 'Pat-Pat Pharmacy', style: 'pharmacy' },
  { text: '사각 문구점', en: 'Scribble Stationery', style: 'books' },
  { text: '찰칵 사진관', en: 'Snap Photo', style: 'glass' },
  { text: '몽실 미용실', en: 'Puffy Salon', style: 'flower' },
  { text: '달콤 케이크', en: 'Sweet Cakes', style: 'bakery' },
  { text: '반짝 철물점', en: 'Shiny Hardware', style: 'bike' },
  { text: '포근 이불가게', en: 'Cozy Bedding', style: 'icecream' },
  { text: '쫀득 떡집', en: 'Chewy Rice Cakes', style: 'hanok' },
  { text: '빙글 음반', en: 'Spin Records', style: 'music' },
];

/** Hanok (giwa) roof colors: tile valleys, raised tile rows, ridge, eave wood. */
export const HANOK_ROOF = {
  valley: '#62719A',
  tile: '#96A3C8',
  tileEnd: '#45506B',
  ridge: '#3F4963',
  mortar: '#F3EEE2',
  wood: '#A9714A',
  rafterEnd: '#F4D9A8',
} as const;

/**
 * Recommended outline colors for setHighlight() (doc §4 grab outline, §8 "들어간 순간 윤곽이
 * 초록색으로", §5 loaded safes shown by outline). Shape/label cues accompany them in the UI.
 */
export const HIGHLIGHT_COLORS = {
  /** Current grab candidate. */
  grab: '#FFF4B8',
  /** Fully inside a recovery zone (dwell running). */
  inZone: '#5BE37D',
  /** Safe loaded on a bank floor. */
  loaded: '#FFD45C',
  /** Pinged by a teammate. */
  ping: '#FF8FD1',
} as const;
