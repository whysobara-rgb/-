// 무기 / 방어구 / 몬스터 / 확률 데이터
export function hashStr(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  return h1 >>> 0;
}
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pickWeighted = (weights, r) => {
  const total = weights.reduce((a, b) => a + b, 0);
  let x = r * total;
  for (let i = 0; i < weights.length; i++) { x -= weights[i]; if (x <= 0) return i; }
  return weights.length - 1;
};

export const RARITIES = [
  { id: 0, name: '일반', en: 'COMMON', color: '#a3acb9', dmg: 1.0, price: 120 },
  { id: 1, name: '고급', en: 'UNCOMMON', color: '#4ade80', dmg: 1.35, price: 450 },
  { id: 2, name: '희귀', en: 'RARE', color: '#38bdf8', dmg: 1.85, price: 1600 },
  { id: 3, name: '영웅', en: 'EPIC', color: '#c084fc', dmg: 2.6, price: 5200 },
  { id: 4, name: '전설', en: 'LEGENDARY', color: '#fbbf24', dmg: 3.7, price: 17000 },
  { id: 5, name: '신화', en: 'MYTHIC', color: '#ff3b6b', dmg: 5.4, price: 58000 },
];

// mode: hitscan | proj | beam | chain
// 모든 필드: dmg, rate(발/초), mag, reload(초), spread(rad), pellets, pierce, aoe(m),
//           auto, burst, barrels, speed(투사체), grav, slow, chain, cls(분류)
export const TYPES = [
  { key: 'pistol', name: '권총', cls: '반자동', mode: 'hitscan', dmg: 26, rate: 6, mag: 14, reload: 1.0, spread: 0.008, auto: false, len: 0.32 },
  { key: 'smg', name: '기관단총', cls: '연사', mode: 'hitscan', dmg: 13, rate: 16, mag: 40, reload: 1.3, spread: 0.03, auto: true, len: 0.48 },
  { key: 'rifle', name: '돌격소총', cls: '연사', mode: 'hitscan', dmg: 22, rate: 10, mag: 32, reload: 1.5, spread: 0.014, auto: true, len: 0.7 },
  { key: 'burst', name: '점사소총', cls: '점사', mode: 'hitscan', dmg: 28, rate: 4, burst: 3, mag: 30, reload: 1.4, spread: 0.01, auto: true, len: 0.68 },
  { key: 'drifle', name: '더블 라이플', cls: '더블 라이플', mode: 'hitscan', dmg: 20, rate: 9, barrels: 2, mag: 48, reload: 1.7, spread: 0.016, auto: true, len: 0.74 },
  { key: 'shotgun', name: '샷건', cls: '샷건', mode: 'hitscan', dmg: 14, pellets: 9, rate: 1.6, mag: 8, reload: 1.6, spread: 0.08, auto: false, len: 0.72 },
  { key: 'dshotgun', name: '더블 샷건', cls: '더블 샷건', mode: 'hitscan', dmg: 14, pellets: 9, barrels: 2, rate: 2.4, mag: 2, reload: 1.1, spread: 0.1, auto: false, len: 0.66 },
  { key: 'sniper', name: '관통 저격총', cls: '관통', mode: 'hitscan', dmg: 140, pierce: 6, rate: 1.2, mag: 6, reload: 1.9, spread: 0, auto: false, len: 1.05, scope: true },
  { key: 'railgun', name: '레일건', cls: '관통', mode: 'hitscan', dmg: 220, pierce: 99, rate: 0.8, mag: 4, reload: 2.2, spread: 0, auto: false, len: 1.0, rail: true },
  { key: 'exrifle', name: '폭발 소총', cls: '폭발성', mode: 'hitscan', dmg: 30, aoe: 2.6, rate: 5, mag: 20, reload: 1.7, spread: 0.012, auto: true, len: 0.75 },
  { key: 'pboom', name: '관통폭발 캐논', cls: '관통폭발', mode: 'hitscan', dmg: 70, pierce: 5, aoe: 3, rate: 1.5, mag: 8, reload: 2.0, spread: 0, auto: false, len: 0.95, rail: true },
  { key: 'rpg', name: 'RPG', cls: 'RPG', mode: 'proj', dmg: 220, aoe: 6, speed: 45, grav: 0, rate: 0.9, mag: 1, reload: 1.8, spread: 0, auto: false, len: 1.1, tube: true },
  { key: 'grenade', name: '수류탄 투척기', cls: '수류탄', mode: 'proj', dmg: 180, aoe: 6.5, speed: 24, grav: 22, bounce: true, rate: 1.4, mag: 4, reload: 1.6, spread: 0, auto: false, len: 0.45, tube: true },
  { key: 'gl', name: '유탄발사기', cls: '유탄', mode: 'proj', dmg: 130, aoe: 5, speed: 38, grav: 14, rate: 2.2, mag: 6, reload: 1.9, spread: 0.01, auto: false, len: 0.8, tube: true },
  { key: 'minigun', name: '미니건', cls: '연사', mode: 'hitscan', dmg: 11, rate: 28, mag: 200, reload: 3.0, spread: 0.04, auto: true, len: 0.95, gatling: true },
  { key: 'laser', name: '레이저 빔', cls: '빔', mode: 'beam', dmg: 9, rate: 30, mag: 240, reload: 2.2, spread: 0, auto: true, len: 0.8, pierce: 2 },
  { key: 'plasma', name: '플라즈마 건', cls: '플라즈마', mode: 'proj', dmg: 60, aoe: 2.2, pierce: 4, speed: 34, grav: 0, rate: 4, mag: 24, reload: 1.6, spread: 0.01, auto: true, len: 0.7 },
  { key: 'tesla', name: '테슬라 체인건', cls: '연쇄', mode: 'chain', dmg: 34, chain: 5, rate: 6, mag: 30, reload: 1.6, spread: 0.01, auto: true, len: 0.7 },
  { key: 'flak', name: '플랙 캐논', cls: '폭발 샷건', mode: 'hitscan', dmg: 22, pellets: 6, aoe: 1.8, rate: 1.3, mag: 6, reload: 1.9, spread: 0.07, auto: false, len: 0.85 },
  { key: 'cryo', name: '크라이오 라이플', cls: '빙결', mode: 'hitscan', dmg: 24, slow: 0.5, pierce: 1, rate: 8, mag: 36, reload: 1.5, spread: 0.012, auto: true, len: 0.72 },
];

const PREFIX = [
  ['녹슨', '훈련용', '보급형', '구형', '잡동사니'],
  ['개량형', '강화', '전술', '정찰', '경량'],
  ['정예', '특수전', '헌터', '프로토', '팬텀'],
  ['보이드', '나이트폴', '인페르노', '스톰', '디바인'],
  ['아포칼립스', '드래곤', '타이탄', '오버로드', '제우스'],
  ['차원붕괴', '종언의', '아카식', '오메가', '무한궤도'],
];
const CODENAMES = ['바이퍼', '코브라', '팔콘', '레이븐', '호넷', '울프', '하운드', '세이버', '레퀴엠', '노바',
  '오로라', '헬파이어', '블리츠', '썬더', '가디언', '리퍼', '스펙터', '케르베로스', '히드라', '피닉스'];

// 20 종류 × 6 등급 = 120종 무기 (시드 고정이라 모든 플레이어가 같은 도감을 공유)
export const WEAPONS = [];
TYPES.forEach((t, ti) => {
  RARITIES.forEach((r, ri) => {
    const R = rng(hashStr(t.key + ':' + ri));
    const v = () => 0.9 + R() * 0.25;
    const lvl = ri;
    const w = {
      id: `${t.key}_${ri}`, type: t.key, rarity: ri,
      name: `${PREFIX[ri][Math.floor(R() * 5)]} ${CODENAMES[(ti * 7 + ri * 3) % CODENAMES.length]} ${t.name}`,
      model: `${t.key.toUpperCase().slice(0, 3)}-${(ti + 1) * 100 + ri * 11 + Math.floor(R() * 9)}`,
      cls: t.cls, mode: t.mode,
      dmg: Math.round(t.dmg * r.dmg * v()),
      rate: +(t.rate * (1 + lvl * 0.09) * v()).toFixed(2),
      mag: Math.max(1, Math.round(t.mag * (1 + lvl * 0.14))),
      reload: +(t.reload * (1 - lvl * 0.085) * (0.95 + R() * 0.1)).toFixed(2),
      spread: t.spread * (1 - lvl * 0.1),
      pellets: t.pellets || 1, pierce: (t.pierce || 0) + (t.pierce ? Math.floor(lvl / 2) : 0),
      aoe: t.aoe ? +(t.aoe * (1 + lvl * 0.08)).toFixed(1) : 0,
      auto: t.auto, burst: t.burst || 0, barrels: t.barrels || 1,
      speed: t.speed || 0, grav: t.grav || 0, bounce: !!t.bounce,
      slow: t.slow || 0, chain: t.chain ? t.chain + lvl : 0,
      len: t.len, scope: !!t.scope, rail: !!t.rail, tube: !!t.tube, gatling: !!t.gatling,
      hue: (ti * 37 + ri * 61) % 360,
      accent: Math.floor(R() * 3),
    };
    w.price = Math.round(r.price * (0.8 + R() * 0.7) * (1 + ti * 0.02) / 10) * 10;
    w.dps = Math.round(w.dmg * w.pellets * w.barrels * w.rate * (w.burst ? 0.8 : 1) * (w.aoe ? 1.6 : 1) * (w.pierce ? 1.3 : 1));
    WEAPONS.push(w);
  });
});
export const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

export const ARMORS = [
  { id: 'a0', name: '전투복', armor: 0, dr: 0, price: 0, color: '#64748b', desc: '기본 지급 전투복' },
  { id: 'a1', name: '경량 방탄조끼', armor: 40, dr: 0.05, price: 800, color: '#a3acb9', desc: '아머 40 · 피해감소 5%' },
  { id: 'a2', name: '전술 플레이트', armor: 80, dr: 0.1, price: 2800, color: '#4ade80', desc: '아머 80 · 피해감소 10%' },
  { id: 'a3', name: '케블라 강화복', armor: 120, dr: 0.15, price: 7500, color: '#38bdf8', desc: '아머 120 · 피해감소 15%' },
  { id: 'a4', name: '엑소 슈트 Mk.I', armor: 180, dr: 0.2, price: 18000, color: '#c084fc', desc: '아머 180 · 피해감소 20%' },
  { id: 'a5', name: '보이드 아머', armor: 260, dr: 0.27, price: 42000, color: '#fbbf24', desc: '아머 260 · 피해감소 27%' },
  { id: 'a6', name: '차원 수호자 갑주', armor: 380, dr: 0.35, price: 99000, color: '#ff3b6b', desc: '아머 380 · 피해감소 35%' },
];
export const ARMOR_BY_ID = Object.fromEntries(ARMORS.map((a) => [a.id, a]));

export const ENEMIES = {
  crawler: { name: '크롤러', hp: 28, speed: 7, dmg: 6, size: 0.6, color: 0x7c3aed, eye: 0x39ff14, coin: [2, 5] },
  stalker: { name: '스토커', hp: 45, speed: 9.5, dmg: 8, size: 0.7, color: 0x0ea5e9, eye: 0xff2d55, coin: [3, 6] },
  brute: { name: '브루트', hp: 170, speed: 4.6, dmg: 18, size: 1.25, color: 0x9f1239, eye: 0xffd60a, coin: [8, 14] },
  spitter: { name: '스피터', hp: 45, speed: 5, dmg: 8, size: 0.75, color: 0x15803d, eye: 0xf0abfc, coin: [4, 8], ranged: true },
  exploder: { name: '자폭충', hp: 22, speed: 10, dmg: 22, size: 0.6, color: 0xea580c, eye: 0xffffff, coin: [3, 6], explode: true },
  ravager: { name: '중간보스 · 라바저', hp: 3200, speed: 5.5, dmg: 25, size: 2.3, color: 0x4c1d95, eye: 0xff0040, coin: [350, 500], boss: 1 },
  tyrant: { name: '보스 · 균열의 폭군', hp: 14000, speed: 4, dmg: 35, size: 3.6, color: 0x111827, eye: 0xff2a2a, coin: [1800, 2600], boss: 2 },
};

// 드랍 확률: 일반 6%, 중간보스/보스는 대폭 상승
export const DROP_CHANCE = { normal: 0.06, mid: 0.45, boss: 1.0 };
export const DROP_RARITY = {
  normal: [52, 27, 13, 5.5, 2, 0.5],
  mid: [10, 25, 32, 20, 10, 3],
  boss: [0, 5, 25, 35, 25, 10],
};

export function rollWeapon(rarityWeights, r = Math.random) {
  const ri = pickWeighted(rarityWeights, r());
  const pool = WEAPONS.filter((w) => w.rarity === ri);
  return pool[Math.floor(r() * pool.length)];
}

// 일일 상점: 날짜 + 서버 + 플레이어 시드 → 하루 동안 고정된 5개
export function dailyShop(day, server, player) {
  const R = rng(hashStr(`shop:${day}:${server}:${player}`));
  const out = []; const used = new Set();
  const weights = [30, 28, 20, 13, 7, 2];
  while (out.length < 5) {
    const w = rollWeapon(weights, R);
    if (used.has(w.id)) continue;
    used.add(w.id);
    out.push({ id: w.id, price: Math.round(w.price * (0.75 + R() * 0.6) / 10) * 10 });
  }
  return out;
}

// 랜덤 뽑기 배너: 차원의 틈을 클리어할 때마다 시드가 바뀌어 가격·확률·픽업 계열이 달라진다
export function gachaBanner(seed, server, player) {
  const R = rng(hashStr(`gacha:${seed}:${server}:${player}`));
  const base = [48, 27, 14, 7, 3, 1];
  const odds = base.map((b, i) => b * (0.6 + R() * (0.6 + i * 0.18)));
  const sum = odds.reduce((a, b) => a + b, 0);
  const pct = odds.map((o) => +(o / sum * 100).toFixed(2));
  const featured = TYPES[Math.floor(R() * TYPES.length)];
  const qual = pct[3] + pct[4] + pct[5];
  const price = Math.round((300 + R() * 1400 + qual * 90) / 10) * 10;
  const themes = ['차원 붕괴', '심연의 메아리', '붉은 일식', '보이드 스톰', '타이탄 강림', '네온 학살', '종말 프로토콜', '은하 균열'];
  return { seed, price, pct, featured: featured.key, featuredName: featured.name, theme: themes[Math.floor(R() * themes.length)] };
}

export function gachaRoll(banner) {
  const ri = pickWeighted(banner.pct, Math.random());
  let pool = WEAPONS.filter((w) => w.rarity === ri);
  const feat = pool.filter((w) => w.type === banner.featured);
  if (feat.length && Math.random() < 0.35) pool = feat;
  return pool[Math.floor(Math.random() * pool.length)];
}
