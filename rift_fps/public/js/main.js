// 로비 UI · 상점 · 뽑기 · 무기고 · HUD 연결
import { WEAPONS, WEAPON_BY_ID, RARITIES, ARMORS, ARMOR_BY_ID, TYPES, dailyShop, gachaBanner, gachaRoll } from './data.js';
import { SaveStore } from './save.js';
import { initAudio, sfx, setVolume } from './audio.js';
import { Game } from './game.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.floor(n).toLocaleString();
const SERVERS = [['alpha', '알파'], ['bravo', '브라보'], ['charlie', '찰리'], ['delta', '델타']];
const store = new SaveStore();
let P = null; // 현재 플레이어 프로필
let selServer = 'alpha', selSlot = 0, invFilter = -1;

// ───────── 무기 실루엣 SVG (종류별 형태 + 등급 색 + 고유 색조) ─────────
export function gunSvg(def) {
  const c = RARITIES[def.rarity].color;
  const body = `hsl(${def.hue} 22% ${18 + def.rarity * 4}%)`;
  const L = 60 + def.len * 90;
  const x0 = 200 - L - 20;
  let s = '';
  const r = (x, y, w, h, f, rx = 2) => (s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${f}"/>`);
  if (def.mode === 'melee') return meleeSvg(def, c, body);
  if (def.tube) {
    r(x0, 22, L, def.type === 'rpg' ? 22 : 18, body, 8);
    r(x0 + 6, 20, 6, 26, c); r(x0 + L - 14, 20, 6, 26, c);
    if (def.type === 'rpg') s += `<path d="M${x0 - 16} 33 L${x0} 22 L${x0} 44 Z" fill="${c}"/>`;
  } else {
    r(x0 + L * 0.35, 22, L * 0.55, 16, body, 3);
    const bars = def.barrels === 2 ? [24, 32] : def.gatling ? [23, 28, 33] : [28];
    for (const y of bars) r(x0, y - 2, L * 0.4, def.pellets > 1 ? 6 : 4, '#2a2d36', 1);
    r(x0 + L * 0.25, 26, L * 0.2, 10, body, 2);
    if (def.rail) for (let i = 0; i < 4; i++) r(x0 + 4 + i * (L * 0.08), 20, 4, 20, c, 1);
    if (def.gatling) r(x0 + L * 0.3, 18, 8, 24, c, 2);
  }
  r(x0 + L * 0.42, 36, 12, 22, '#1d1f26', 3);
  if (!def.tube) r(x0 + L * 0.62, 38, 10, 20, '#1d1f26', 2);
  if (def.len > 0.5 && !def.tube) r(x0 + L * 0.88, 24, L * 0.22, 14, body, 3);
  r(x0 + L * 0.37, 25, L * 0.48, 3, c, 1);
  if (def.accent > 0) r(x0 + L * 0.5, 33, L * 0.28, 2, c, 1);
  if (def.scope) { r(x0 + L * 0.45, 12, L * 0.3, 8, '#2a2d36', 4); r(x0 + L * 0.45, 13, 3, 6, c, 1); }
  if (def.rarity >= 4) s += `<circle cx="${x0 + L * 0.7}" cy="30" r="4" fill="#fff" opacity=".9"/><circle cx="${x0 + L * 0.7}" cy="30" r="8" fill="${c}" opacity=".35"/>`;
  return `<svg viewBox="0 0 200 64" preserveAspectRatio="xMidYMid meet">${s}</svg>`;
}

// 근접 무기 실루엣 (가로 방향, 손잡이 오른쪽)
function meleeSvg(def, c, body) {
  const steel = def.rarity >= 3 ? c : '#cfd5df';
  const shapes = {
    knife: `<rect x="120" y="28" width="40" height="9" rx="3" fill="#1d1f26"/><rect x="114" y="24" width="6" height="17" fill="${body}"/><path d="M60 30 L114 26 L114 38 L66 36 Z" fill="${steel}"/><path d="M62 35 L114 36 L114 38 L66 36Z" fill="${c}"/>`,
    katana: `<rect x="150" y="29" width="40" height="7" rx="3" fill="#1d1f26"/><ellipse cx="147" cy="32" rx="3" ry="9" fill="${body}"/><path d="M14 36 Q80 22 144 29 L144 34 Q80 28 18 40 Z" fill="${steel}"/><path d="M18 39 Q80 27 144 33 L144 34 Q80 29 18 40Z" fill="${c}"/>`,
    great: `<rect x="160" y="28" width="32" height="9" rx="3" fill="#1d1f26"/><rect x="152" y="16" width="8" height="33" fill="${body}"/><path d="M8 32 L22 22 L152 22 L152 42 L22 42 Z" fill="${steel}"/><rect x="24" y="30" width="126" height="3" fill="${c}"/>`,
    hammer: `<rect x="50" y="30" width="140" height="6" rx="3" fill="#1d1f26"/><rect x="18" y="12" width="40" height="42" rx="4" fill="${body}"/><rect x="18" y="28" width="40" height="8" fill="${c}"/>`,
    chain: `<rect x="150" y="27" width="40" height="10" rx="3" fill="#1d1f26"/><rect x="132" y="20" width="20" height="24" rx="3" fill="${body}"/><rect x="18" y="24" width="114" height="16" rx="6" fill="#2a2d36"/><rect x="18" y="22" width="114" height="4" fill="${c}" stroke-dasharray="4 3"/><rect x="18" y="38" width="114" height="4" fill="${c}"/>`,
    scythe: `<rect x="40" y="30" width="150" height="6" rx="3" fill="#1d1f26"/><path d="M44 30 Q30 2 100 6 Q60 10 50 32 Z" fill="${steel}"/><path d="M48 30 Q36 6 100 6 Q62 12 52 31Z" fill="${c}" opacity=".8"/>`,
    plasma: `<rect x="150" y="28" width="40" height="9" rx="3" fill="#1d1f26"/><rect x="144" y="22" width="6" height="21" fill="${body}"/><rect x="16" y="27" width="128" height="11" rx="5" fill="${c}" opacity=".45"/><rect x="16" y="30" width="128" height="5" rx="2" fill="#fff"/>`,
    fist: `<rect x="70" y="14" width="70" height="38" rx="10" fill="${body}"/><rect x="58" y="16" width="14" height="34" rx="5" fill="#2a2d36"/>${[0, 1, 2, 3].map((i) => `<rect x="56" y="${17 + i * 8.5}" width="6" height="6" rx="2" fill="${c}"/>`).join('')}<rect x="140" y="22" width="30" height="22" rx="4" fill="#1d1f26"/>`,
    spear: `<rect x="40" y="30" width="155" height="5" rx="2" fill="#1d1f26"/><path d="M4 32 L40 22 L40 43 Z" fill="${c}"/><rect x="40" y="26" width="6" height="13" fill="${body}"/>`,
  };
  const glowDot = def.rarity >= 4 ? `<circle cx="165" cy="32" r="4" fill="#fff"/><circle cx="165" cy="32" r="8" fill="${c}" opacity=".35"/>` : '';
  return `<svg viewBox="0 0 200 64" preserveAspectRatio="xMidYMid meet">${shapes[def.mshape] || shapes.knife}${glowDot}</svg>`;
}

function statRow(label, v, max, txt) {
  return `<div class="st">${label}<i><u style="width:${Math.min(100, (v / max) * 100)}%"></u></i><em>${txt}</em></div>`;
}
function tags(def) {
  const t = [def.cls];
  if (def.pierce) t.push(def.pierce >= 99 ? '무한 관통' : `관통 ${def.pierce}`);
  if (def.aoe) t.push(`폭발 ${def.aoe}m`);
  if (def.pellets > 1) t.push(`산탄 ${def.pellets}`);
  if (def.barrels > 1) t.push('이중 총열');
  if (def.burst) t.push(`${def.burst}점사`);
  if (def.chain) t.push(`연쇄 ${def.chain}`);
  if (def.slow) t.push('둔화');
  if (def.leech) t.push(`흡혈 ${def.leech}`);
  if (def.wave) t.push('검기 발사');
  if (def.mode === 'melee' && def.arc < 0) t.push('360° 베기');
  return t.map((x) => `<span>${x}</span>`).join('');
}
function weaponCard(def, foot = '', extraClass = '') {
  const R = RARITIES[def.rarity];
  return `<div class="wcard r${def.rarity} ${extraClass}" style="--rc:${R.color}">
    <div class="rtag"><span>${R.en} · ${R.name}</span><span>${def.model}</span></div>
    <div class="wn">${def.name}</div><div class="wc">${TYPES.find((t) => t.key === def.type).name} · DPS ${fmt(def.dps)}</div>
    ${gunSvg(def)}
    ${statRow('피해', def.dmg * def.pellets * def.barrels, 600, def.pellets * def.barrels > 1 ? `${def.dmg}×${def.pellets * def.barrels}` : def.dmg)}
    ${statRow('연사', def.rate, 35, def.rate + '/s')}
    ${def.mode === 'melee' ? statRow('흡혈', def.leech, 10, '+' + def.leech + ' HP') : statRow('장전', 3.2 - def.reload, 3, def.reload + 's')}
    ${def.mode === 'melee' ? statRow('사거리', def.range, 9, def.range + 'm') : statRow('탄창', def.mag, 260, def.mag)}
    <div class="tags">${tags(def)}</div>
    ${def.skill ? `<div class="wskill-tag"><b>${def.skill.icon} ${def.skill.name}<em>X · ${def.skill.cd}s</em></b><span>${def.skill.desc}</span></div>` : ''}
    ${foot}</div>`;
}

// ───────── 저장 ─────────
let saveTimer = null;
function save(now) {
  clearTimeout(saveTimer);
  const run = () => store.save(P);
  if (now) run(); else saveTimer = setTimeout(run, 400);
}
function notice(msg) { const n = $('notice'); n.textContent = msg; n.classList.add('show'); clearTimeout(n._t); n._t = setTimeout(() => n.classList.remove('show'), 2200); }
function spend(n) { if (P.coins < n) { notice('코인이 부족합니다'); sfx('empty'); return false; } P.coins -= n; refreshCoins(); return true; }
function refreshCoins() { $('coins').textContent = fmt(P.coins); }
function addWeapon(id) { const uid = P.nextUid++; P.weapons.push({ uid, id }); return uid; }
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function fixLoadout() {
  const uids = new Set(P.weapons.map((w) => w.uid));
  P.loadout = P.loadout.map((u) => (uids.has(u) ? u : null));
  if (!P.loadout.some((u) => u != null) && P.weapons.length) P.loadout[0] = P.weapons[0].uid;
}

// ───────── 로그인 ─────────
function buildLogin() {
  const box = $('serverList');
  box.innerHTML = SERVERS.map(([id, n]) => `<button data-s="${id}" class="${id === selServer ? 'sel' : ''}">${id.toUpperCase()}<small>● ${n}</small></button>`).join('');
  box.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; selServer = b.dataset.s; buildLogin(); };
  try { const last = JSON.parse(localStorage.getItem('riftbreaker::last') || '{}'); if (last.name && !$('callsign').value) { $('callsign').value = last.name; } if (last.server && !box.dataset.init) { box.dataset.init = 1; selServer = last.server; buildLogin(); } } catch { /* 무시 */ }
}
$('loginBtn').onclick = async () => {
  initAudio();
  const name = $('callsign').value.trim(), pin = $('pin').value.trim();
  if (name.length < 2) { $('loginErr').textContent = '콜사인은 2자 이상'; return; }
  if (!/^\d{4,8}$/.test(pin)) { $('loginErr').textContent = 'PIN은 숫자 4~8자리'; return; }
  $('loginBtn').disabled = true;
  const r = await store.login(selServer, name, pin);
  $('loginBtn').disabled = false;
  if (r.error) { $('loginErr').textContent = r.error; sfx('empty'); return; }
  try { localStorage.setItem('riftbreaker::last', JSON.stringify({ name, server: selServer })); } catch { /* 무시 */ }
  P = r.data; fixLoadout();
  setVolume(P.settings.vol);
  $('whoName').textContent = name;
  $('whoServer').textContent = `SERVER ${selServer.toUpperCase()} · ${store.mode === 'server' ? 'ONLINE' : 'LOCAL'}`;
  $('login').classList.remove('show'); $('lobby').classList.add('show');
  sfx('buy');
  if (r.created) { save(true); notice(`신규 요원 등록 완료 — 서버 ${selServer.toUpperCase()}`); }
  showTab('rift');
};
$('pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('loginBtn').click(); });
$('logoutBtn').onclick = () => { save(true); P = null; $('lobby').classList.remove('show'); $('login').classList.add('show'); $('pin').value = ''; };

// ───────── 탭 ─────────
$('tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) { sfx('click'); showTab(b.dataset.tab); } };
function showTab(t) {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('show', x.id === 'tab-' + t));
  refreshCoins();
  ({ rift: renderRift, arsenal: renderArsenal, shop: renderShop, gacha: renderGacha, armor: renderArmor, settings: renderSettings })[t]();
}

function renderRift() {
  $('riftLevel').textContent = `LV.${P.clears + 1}`;
  $('loadoutPreview').innerHTML = P.loadout.map((u, i) => {
    const w = P.weapons.find((x) => x.uid === u); if (!w) return `<div class="slot"><b>${i + 1}</b><span class="sc">빈 슬롯</span></div>`;
    const d = WEAPON_BY_ID[w.id];
    return `<div class="slot" style="border-color:${RARITIES[d.rarity].color}"><b>${i + 1}</b><div><div class="sn" style="color:${RARITIES[d.rarity].color}">${d.name}</div><div class="sc">${d.cls} · DPS ${fmt(d.dps)}</div></div></div>`;
  }).join('');
  const a = ARMOR_BY_ID[P.armor];
  $('statsBox').innerHTML = [
    ['클리어', P.clears], ['사망', P.deaths], ['총 처치', fmt(P.kills)], ['최고 처치', fmt(P.bestKills)],
    ['보유 무기', P.weapons.length], ['방어구', a.name],
  ].map(([k, v]) => `<div>${k}<b>${v}</b></div>`).join('');
}

function renderArsenal() {
  const eq = new Set(P.loadout);
  $('slotBar').innerHTML = P.loadout.map((u, i) => {
    const w = P.weapons.find((x) => x.uid === u); const d = w && WEAPON_BY_ID[w.id];
    return `<div class="slot" data-i="${i}" style="${i === selSlot ? 'border-style:solid;border-color:var(--pink);' : ''}${d ? `box-shadow:inset 0 0 20px ${RARITIES[d.rarity].color}33` : ''}">
      <b>${i + 1}</b>${d ? `<div><div class="sn" style="color:${RARITIES[d.rarity].color}">${d.name}</div><div class="sc">${d.cls}</div></div>` : '<span class="sc">비어 있음 — 클릭해 선택</span>'}</div>`;
  }).join('');
  $('slotBar').onclick = (e) => { const s = e.target.closest('.slot'); if (s) { selSlot = +s.dataset.i; renderArsenal(); } };
  $('invFilters').innerHTML = `<button data-f="-1" class="${invFilter === -1 ? 'on' : ''}">전체</button>` + RARITIES.map((r) => `<button data-f="${r.id}" class="${invFilter === r.id ? 'on' : ''}" style="color:${r.color}">${r.name}</button>`).join('');
  $('invFilters').onclick = (e) => { const b = e.target.closest('button'); if (b) { invFilter = +b.dataset.f; renderArsenal(); } };
  $('invCount').textContent = `보유 ${P.weapons.length}정 · 도감 ${new Set(P.weapons.map((w) => w.id)).size}/${WEAPONS.length}`;
  const list = P.weapons.map((w) => ({ w, d: WEAPON_BY_ID[w.id] })).filter((x) => invFilter < 0 || x.d.rarity === invFilter)
    .sort((a, b) => b.d.rarity - a.d.rarity || b.d.dps - a.d.dps);
  $('inventory').innerHTML = list.map(({ w, d }) => {
    const on = eq.has(w.uid);
    const sell = Math.round(d.price * 0.75 / 10) * 10;
    return weaponCard(d, `<div class="foot"><button class="btn" data-eq="${w.uid}">${on ? '해제' : `슬롯 ${selSlot + 1}에 장착`}</button><button class="btn danger" data-sell="${w.uid}">판매 ${fmt(sell)}</button></div>${on ? '<div class="eqbadge">장착중</div>' : ''}`, on ? 'equipped' : '');
  }).join('');
  $('inventory').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.eq) {
      const uid = +b.dataset.eq; const idx = P.loadout.indexOf(uid);
      if (idx >= 0) {
        if (P.loadout.filter((x) => x != null).length <= 1) return notice('최소 1개의 무기는 장착해야 합니다');
        P.loadout[idx] = null;
      } else { P.loadout[selSlot] = uid; selSlot = (selSlot + 1) % 4; }
      sfx('click');
    } else if (b.dataset.sell) {
      const uid = +b.dataset.sell;
      if (P.weapons.length <= 1) return notice('마지막 무기는 판매할 수 없습니다');
      const w = P.weapons.find((x) => x.uid === uid); const d = WEAPON_BY_ID[w.id];
      P.weapons = P.weapons.filter((x) => x.uid !== uid); P.coins += Math.round(d.price * 0.75 / 10) * 10;
      fixLoadout(); sfx('coin'); refreshCoins();
    }
    save(); renderArsenal();
  };
}

function renderShop() {
  const day = today();
  if (P.shopDay !== day) { P.shopDay = day; P.shopBought = []; save(); }
  const items = dailyShop(day, store.server, store.playerId);
  const tick = () => {
    const n = new Date(), m = new Date(n); m.setHours(24, 0, 0, 0);
    const s = Math.floor((m - n) / 1000);
    $('shopReset').textContent = `갱신까지 ${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  tick(); clearInterval(renderShop.t); renderShop.t = setInterval(tick, 1000);
  $('shopGrid').innerHTML = items.map((it, i) => {
    const d = WEAPON_BY_ID[it.id]; const sold = P.shopBought.includes(i);
    return weaponCard(d, `<div class="foot"><span class="price"><span class="coin"></span>${fmt(it.price)}</span><button class="btn primary" data-buy="${i}">${sold ? '구매 완료' : '구매'}</button></div>`, sold ? 'sold' : '');
  }).join('');
  $('shopGrid').onclick = (e) => {
    const b = e.target.closest('[data-buy]'); if (!b) return;
    const i = +b.dataset.buy; if (P.shopBought.includes(i)) return;
    const it = items[i];
    if (!spend(it.price)) return;
    addWeapon(it.id); P.shopBought.push(i); sfx('buy'); notice(`${WEAPON_BY_ID[it.id].name} 구매 완료!`);
    save(); renderShop();
  };
}

function renderArmor() {
  $('armorGrid').innerHTML = ARMORS.map((a) => {
    const own = P.armors.includes(a.id), on = P.armor === a.id;
    const shape = `<svg viewBox="0 0 100 90" width="100" height="90"><path d="M30 8 L50 16 L70 8 L88 22 L80 46 L78 84 L22 84 L20 46 L12 22 Z" fill="${a.color}33" stroke="${a.color}" stroke-width="3"/><path d="M38 30 H62 M36 46 H64 M36 62 H64" stroke="${a.color}" stroke-width="3"/></svg>`;
    return `<div class="acard" style="--rc:${a.color}"><div class="ashape">${shape}</div><h3 style="color:${a.color}">${a.name}</h3><p>${a.desc}</p>
      <div class="wcard" style="all:unset;display:flex;justify-content:space-between;align-items:center">
      <span class="price" style="font-family:Orbitron;color:var(--gold)">${own ? '보유중' : `<span class="coin"></span> ${fmt(a.price)}`}</span>
      <button class="btn ${on ? '' : 'primary'}" data-a="${a.id}" ${on ? 'disabled' : ''}>${on ? '착용중' : own ? '착용' : '구매'}</button></div></div>`;
  }).join('');
  $('armorGrid').onclick = (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = ARMOR_BY_ID[b.dataset.a];
    if (!P.armors.includes(a.id)) { if (!spend(a.price)) return; P.armors.push(a.id); sfx('buy'); }
    P.armor = a.id; save(); renderArmor();
  };
}

// ───────── 랜덤 뽑기 ─────────
function banner() { return gachaBanner(P.gachaSeed, store.server, store.playerId); }
function renderGacha() {
  const b = banner();
  $('gbTheme').textContent = `「${b.theme}」`;
  $('gbFeat').innerHTML = `픽업: <b style="color:var(--pink)">${b.featuredName}</b> 계열 확률 UP · 배너 #${b.seed}`;
  $('gbOdds').innerHTML = RARITIES.map((r, i) => `<div><span style="color:${r.color}">${r.name}</span><i><u style="width:${Math.min(100, b.pct[i] * 2)}%;background:${r.color}"></u></i><span style="text-align:right;font-family:Orbitron">${b.pct[i]}%</span></div>`).join('');
  $('pull1').innerHTML = `1회 뽑기<small>● ${fmt(b.price)}</small>`;
  $('pull10').innerHTML = `10회 뽑기<small>● ${fmt(b.price * 9)} (10% 할인)</small>`;
}
async function pull(n) {
  const b = banner(); const cost = n === 1 ? b.price : b.price * 9;
  if (!spend(cost)) return;
  $('pull1').disabled = $('pull10').disabled = true;
  const res = [...Array(n)].map(() => gachaRoll(b));
  res.forEach((d) => addWeapon(d.id)); save(true);
  const st = $('gachaStage');
  st.innerHTML = res.map((d, i) => `<div class="flip ${n > 1 ? 'small' : ''}" data-i="${i}"><div class="back" style="--gc:${RARITIES[d.rarity].color}">◆</div><div class="front">${weaponCard(d)}</div></div>`).join('');
  sfx('gacha');
  const flips = [...st.querySelectorAll('.flip')];
  for (let i = 0; i < flips.length; i++) {
    const d = res[i];
    if (d.rarity >= 3) { flips[i].querySelector('.back').classList.add('glow'); await wait(500); }
    flips[i].classList.add('open');
    if (d.rarity >= 3) sfx('gachaRare'); else sfx('click');
    await wait(n > 1 ? 160 : 300);
  }
  const best = res.reduce((a, d) => (d.rarity > a.rarity ? d : a), res[0]);
  notice(`${RARITIES[best.rarity].name} 등급 「${best.name}」 획득!`);
  $('pull1').disabled = $('pull10').disabled = false;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
$('pull1').onclick = () => pull(1);
$('pull10').onclick = () => pull(10);

function renderSettings() {
  const s = P.settings;
  const bind = (id, key, f) => { const el = $(id); el.value = s[key]; $(id + 'V').textContent = f(s[key]); el.oninput = () => { s[key] = +el.value; $(id + 'V').textContent = f(s[key]); if (key === 'vol') setVolume(s.vol); save(); }; };
  bind('sens', 'sens', (v) => v.toFixed(2)); bind('fov', 'fov', (v) => v + '°'); bind('vol', 'vol', (v) => Math.round(v * 100) + '%');
}

// ───────── 전투 ─────────
const hud = {
  hpBar: document.querySelector('.bar.hp'), hpI: document.querySelector('.bar.hp i'), armI: document.querySelector('.bar.armor i'),
  rbar: document.querySelector('#riftbar .rbar i'), boss: $('bossbar'), bossI: document.querySelector('#bossbar .bbar i'),
  bname: document.querySelector('#bossbar .bname'), bskill: document.querySelector('#bossbar .bskill'),
};
const SKILLS = [['dash', 'Q', '💨'], ['shock', 'E', '💥'], ['over', 'F', '⚡'], ['nade', 'G', '💣'], ['slash', 'V', '🗡']];
$('skills').innerHTML = SKILLS.map(([k, key, ic]) => `<div class="sk" id="sk-${k}"><kbd>${key}</kbd><span class="ic">${ic}</span><div class="cd"></div><span class="cdt"></span></div>`).join('');
let runCoins = 0, lastSlotsKey = '', lastPipKey = '', skillTimer = null;

const game = window.__game = new Game($('c'), {
  onStart(total) { runCoins = 0; $('runCoins').textContent = '0'; lastSlotsKey = ''; lastPipKey = ''; $('lootfeed').innerHTML = ''; $('toasts').innerHTML = ''; hud.boss.classList.remove('show'); },
  onCoins(n) { P.coins += n; runCoins += n; $('runCoins').textContent = fmt(runCoins); sfx('coin'); },
  onLoot(def) {
    addWeapon(def.id);
    const R = RARITIES[def.rarity];
    const el = document.createElement('div'); el.className = 'lootitem'; el.style.setProperty('--rc', R.color);
    el.innerHTML = `${gunSvg(def)}<div><b>${R.en}</b>${def.name}</div>`;
    $('lootfeed').prepend(el); setTimeout(() => el.remove(), 4600);
  },
  onToast(text, color) {
    const el = document.createElement('div'); el.className = 'toast'; el.textContent = text; el.style.color = color; el.style.borderColor = color;
    $('toasts').appendChild(el); setTimeout(() => el.remove(), 2900);
    while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
  },
  onHitmark(crit, kill) {
    const h = $('hitmarker'); h.className = (crit ? 'crit' : '') + (kill ? ' kill' : ''); h.style.transition = 'none'; h.style.opacity = 1; h.style.transform = `scale(${kill ? 1.6 : 1.3})`;
    requestAnimationFrame(() => { h.style.transition = 'opacity .25s, transform .12s'; h.style.opacity = 0; h.style.transform = 'scale(1)'; });
  },
  onHurt(k) {
    const v = $('vignette'); v.style.boxShadow = `inset 0 0 ${120 + k * 120}px rgba(255,0,40,${0.4 + k * 0.5})`;
    clearTimeout(v._t); v._t = setTimeout(() => (v.style.boxShadow = ''), 180);
  },
  onFlash(color) { const f = $('flash'); f.style.background = color; f.style.transition = 'none'; f.style.opacity = 1; requestAnimationFrame(() => { f.style.transition = 'opacity .3s'; f.style.opacity = 0; }); },
  onBoss(e) { hud.boss.classList.toggle('show', !!e); hud.bskill.textContent = ''; },
  onBossSkill(t) { hud.bskill.textContent = '⚠ ' + t; clearTimeout(skillTimer); skillTimer = setTimeout(() => (hud.bskill.textContent = ''), 1800); },
  onPause() { $('pause').classList.add('show'); },
  onHud(h) {
    hud.hpI.style.width = (h.hp / h.maxHp) * 100 + '%'; hud.hpBar.classList.toggle('low', h.hp < 35);
    hud.armI.style.width = h.maxArmor ? (h.armor / h.maxArmor) * 100 + '%' : '0%';
    $('hpTxt').textContent = Math.ceil(h.hp); $('armorTxt').textContent = Math.ceil(h.armor);
    const a = $('ammoTxt'); a.textContent = h.over || h.melee ? '∞' : h.ammo; a.className = h.over ? 'inf' : !h.melee && h.ammo <= h.mag * 0.25 ? 'low' : '';
    $('magTxt').textContent = h.melee ? '근접' : '/ ' + h.mag;
    const ws = $('wSkill');
    if (h.wskill) {
      const k = h.wskill.left / h.wskill.cd;
      ws.style.display = ''; ws.classList.toggle('ready', h.wskill.left <= 0);
      ws.innerHTML = `<kbd>X</kbd><span class="ic">${h.wskill.icon}</span><span class="nm">${h.wskill.name}</span><em>${h.wskill.left > 0 ? Math.ceil(h.wskill.left) + 's' : 'READY'}</em><i style="width:${(1 - k) * 100}%"></i>`;
    } else ws.style.display = 'none';
    // 탄약 눈금: 탄창 크기만큼 칸을 그리고 남은 탄만 밝게
    const pipKey = h.melee || h.over ? 'x' : h.mag + ':' + h.ammo;
    if (pipKey !== lastPipKey) {
      lastPipKey = pipKey;
      const pips = $('ammoPips'), n = h.melee || h.over ? 0 : Math.min(h.mag, 120);
      pips.className = h.mag > 40 ? 'many' : '';
      const filled = Math.round(h.ammo / h.mag * n);
      pips.innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < filled ? '' : 'e'}"></i>`).join('');
    }
    const R = RARITIES[h.weapon.rarity];
    $('wName').innerHTML = `<small style="color:${R.color}">${R.en} · ${h.weapon.cls}</small>${h.weapon.name}`;
    $('reloadBar').classList.toggle('show', h.reload >= 0); $('reloadBar').firstElementChild.style.width = Math.max(0, h.reload) * 100 + '%';
    const key = h.slots.map((s) => s.id).join() + h.cur;
    if (key !== lastSlotsKey) {
      lastSlotsKey = key;
      $('wSlots').innerHTML = h.slots.map((d, i) => `<div class="${i === h.cur ? 'on' : ''}" style="--rc:${RARITIES[d.rarity].color}"><kbd>${i + 1}</kbd>${gunSvg(d)}</div>`).join('');
    }
    $('killsTxt').textContent = `처치 ${fmt(h.kills)} · 남은 개체 ${fmt(Math.max(0, h.remaining))}`;
    hud.rbar.style.width = (h.kills / (h.total + 1)) * 100 + '%';
    $('timeTxt').textContent = `${Math.floor(h.time / 60)}:${String(Math.floor(h.time % 60)).padStart(2, '0')}`;
    const st = $('stageTimer');
    st.textContent = h.collapsed ? '균열 붕괴 — 보스 강림' : `붕괴까지 ${Math.floor(h.stageLeft / 60)}:${String(Math.floor(h.stageLeft % 60)).padStart(2, '0')}`;
    st.classList.toggle('urgent', h.collapsed || h.stageLeft < 30);
    $('combo').innerHTML = h.combo >= 5 ? `${h.combo}<small>KILL STREAK</small>` : '';
    for (const [k] of SKILLS) {
      const el = $('sk-' + k), cd = h.cds[k];
      el.querySelector('.cd').style.height = (cd / h.cdMax[k]) * 100 + '%';
      el.querySelector('.cdt').textContent = cd > 0 ? Math.ceil(cd) : '';
      el.classList.toggle('ready', cd <= 0); el.classList.toggle('active', k === 'over' && h.over);
    }
    if (h.boss) {
      hud.bname.textContent = h.boss.name; hud.bossI.style.width = Math.max(0, h.boss.hp / h.boss.max) * 100 + '%';
      hud.boss.classList.toggle('enraged', h.boss.enraged);
    }
    const sp = 6 + h.spread * 400 + (game.mouseDown ? 4 : 0);
    const ch = document.querySelectorAll('#crosshair i');
    ch[0].style.transform = `translateY(${-sp - 10}px)`; ch[1].style.transform = `translateY(${sp}px)`;
    ch[2].style.transform = `translateX(${-sp - 10}px)`; ch[3].style.transform = `translateX(${sp}px)`;
  },
  onEnd(r) { finishRun(r); },
});

$('deployBtn').onclick = () => {
  initAudio(); fixLoadout();
  const weapons = P.loadout.filter((u) => u != null).map((u) => WEAPON_BY_ID[P.weapons.find((w) => w.uid === u).id]);
  $('lobby').classList.remove('show'); $('hud').classList.add('show');
  game.start({ weapons, armor: ARMOR_BY_ID[P.armor], clears: P.clears, settings: P.settings });
};
$('resumeBtn').onclick = () => { $('pause').classList.remove('show'); game.resume(); };
$('abandonBtn').onclick = () => { $('pause').classList.remove('show'); game.paused = false; game.end('dead'); };

function finishRun(r) {
  $('hud').classList.remove('show');
  P.kills += r.kills; P.bestKills = Math.max(P.bestKills, r.kills);
  const lost = [];
  let bonus = 0;
  if (r.result === 'clear') {
    bonus = Math.round((500 + r.total * 2) * (1 + P.clears * 0.12));
    P.coins += bonus; P.clears++; P.gachaSeed++;
  } else {
    P.deaths++;
    // 사망 페널티: 보유 아이템(무기·방어구) 중 20~40%를 무작위로 소실, 단 무기는 최소 1개 유지
    const pool = [...P.weapons.map((w) => ({ kind: 'w', w })), ...P.armors.filter((a) => a !== 'a0').map((a) => ({ kind: 'a', a }))];
    let n = Math.max(1, Math.round(pool.length * (0.2 + Math.random() * 0.2)));
    pool.sort(() => Math.random() - 0.5);
    for (const it of pool) {
      if (n <= 0) break;
      if (it.kind === 'w') {
        if (P.weapons.length <= 1) continue;
        P.weapons = P.weapons.filter((x) => x.uid !== it.w.uid);
        lost.push({ name: WEAPON_BY_ID[it.w.id].name, color: RARITIES[WEAPON_BY_ID[it.w.id].rarity].color });
      } else {
        P.armors = P.armors.filter((x) => x !== it.a);
        if (P.armor === it.a) P.armor = 'a0';
        lost.push({ name: ARMOR_BY_ID[it.a].name, color: ARMOR_BY_ID[it.a].color });
      }
      n--;
    }
    fixLoadout();
  }
  save(true);
  const win = r.result === 'clear';
  $('resTitle').textContent = win ? 'RIFT CLOSED' : 'K.I.A.';
  $('resTitle').className = win ? 'win' : 'lose';
  $('resStats').innerHTML = [
    ['처치', `${fmt(r.kills)} / ${fmt(r.total)}`], ['획득 코인', fmt(r.coins)], ['클리어 보너스', win ? fmt(bonus) : '-'],
    ['작전 시간', `${Math.floor(r.time / 60)}:${String(Math.floor(r.time % 60)).padStart(2, '0')}`],
  ].map(([k, v]) => `<div>${k}<b>${v}</b></div>`).join('');
  $('resLoot').innerHTML = r.loot.length ? `<h4>획득 무기 ${r.loot.length}</h4>` + r.loot.map((d) => `<span class="chip" style="--rc:${RARITIES[d.rarity].color}">${RARITIES[d.rarity].name} · ${d.name}</span>`).join('') : '';
  $('resLost').innerHTML = lost.length ? `<h4 style="color:#ff6b8b">사망 페널티 — 소실된 아이템 ${lost.length}</h4>` + lost.map((x) => `<span class="chip lost" style="--rc:${x.color}">${x.name}</span>`).join('') : '';
  if (win) $('resLost').innerHTML = `<h4 style="color:var(--gold)">랜덤 뽑기 배너가 갱신되었습니다! (#${P.gachaSeed})</h4>`;
  $('result').classList.add('show');
}
$('resBtn').onclick = () => { $('result').classList.remove('show'); $('lobby').classList.add('show'); showTab('rift'); };

addEventListener('beforeunload', () => { if (P) store.save(P); });
// 카드 3D 기울기 + 하이라이트가 마우스를 따라감
addEventListener('pointermove', (e) => {
  const c = e.target.closest && e.target.closest('.wcard');
  document.querySelectorAll('.wcard.tilt').forEach((x) => { if (x !== c) { x.classList.remove('tilt'); x.style.transform = ''; } });
  if (!c || c.closest('.flip')) return;
  const r = c.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
  c.classList.add('tilt');
  c.style.setProperty('--mx', px * 100 + '%'); c.style.setProperty('--my', py * 100 + '%');
  c.style.transform = `rotateY(${(px - 0.5) * 12}deg) rotateX(${(0.5 - py) * 10}deg) translateY(-4px)`;
});
buildLogin();
