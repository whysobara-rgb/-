// 절차적 3D 모델: 무기 뷰모델, 괴생물체
import * as THREE from 'three';
import { RARITIES } from './data.js';

const metalCache = {};
function mat(color, opts = {}) {
  const k = color + JSON.stringify(opts);
  if (!metalCache[k]) metalCache[k] = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.8, ...opts });
  return metalCache[k];
}
function glow(color, intensity = 2.5) {
  const k = 'g' + color + intensity;
  if (!metalCache[k]) metalCache[k] = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(color), emissiveIntensity: intensity, roughness: 0.4 });
  return metalCache[k];
}
const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const cyl = (r1, r2, h, m, seg = 12) => {
  const g = new THREE.CylinderGeometry(r1, r2, h, seg); g.rotateX(Math.PI / 2);
  return new THREE.Mesh(g, m);
};

// 무기마다 등급 색, 종류별 실루엣, 고유 색조(hue)·장식으로 모두 다르게 보이도록 생성
export function buildGun(def) {
  const g = new THREE.Group();
  const rar = RARITIES[def.rarity];
  const body = new THREE.Color().setHSL(def.hue / 360, 0.25 + def.rarity * 0.08, 0.12 + def.rarity * 0.025);
  const mBody = mat(body.getHex(), { metalness: 0.6 + def.rarity * 0.06 });
  const mDark = mat(0x16181d, { roughness: 0.6 });
  const mAccent = glow(rar.color, 1.4 + def.rarity * 0.6);
  const L = def.len;
  const muzzles = [];
  if (def.mode === 'melee') return buildMelee(def, g, mBody, mDark, mAccent, rar);

  // 리시버 + 그립 + 탄창
  const rec = box(0.085, 0.11, L * 0.55, mBody); rec.position.z = -L * 0.2; g.add(rec);
  const grip = box(0.06, 0.16, 0.07, mDark); grip.position.set(0, -0.11, 0.02); grip.rotation.x = 0.35; g.add(grip);
  if (!def.tube) {
    const magz = box(0.05, 0.14, 0.07, mDark); magz.position.set(0, -0.1, -L * 0.28); magz.rotation.x = -0.15; g.add(magz);
  }
  const stock = box(0.06, 0.09, 0.18, mBody); stock.position.set(0, -0.02, 0.17); if (L > 0.5) g.add(stock);
  // 발광 라인 (등급 색)
  const strip = box(0.088, 0.012, L * 0.5, mAccent); strip.position.set(0, 0.035, -L * 0.2); g.add(strip);
  if (def.accent > 0) { const s2 = box(0.09, 0.01, L * 0.3, mAccent); s2.position.set(0, -0.03, -L * 0.25); g.add(s2); }

  const barrelZ = -L * 0.48 - L * 0.25;
  const offsets = def.barrels === 2 ? [-0.032, 0.032] : [0];
  if (def.gatling) {
    const spin = new THREE.Group(); spin.position.z = -L * 0.65;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const b = cyl(0.014, 0.014, L * 0.6, mDark, 6); b.position.set(Math.cos(a) * 0.035, Math.sin(a) * 0.035, 0); spin.add(b);
    }
    const ring = cyl(0.055, 0.055, 0.03, mAccent); ring.position.z = -L * 0.28; spin.add(ring);
    g.add(spin); g.userData.spin = spin;
    const m = new THREE.Object3D(); m.position.set(0, 0, -L * 0.95); g.add(m); muzzles.push(m);
  } else if (def.tube) {
    const tubeR = def.type === 'rpg' ? 0.07 : 0.055;
    const t = cyl(tubeR, tubeR * 0.9, L, mBody, 16); t.position.set(0, 0.04, -L * 0.35); g.add(t);
    const r1 = cyl(tubeR + 0.008, tubeR + 0.008, 0.04, mAccent, 16); r1.position.set(0, 0.04, -L * 0.8); g.add(r1);
    const r2 = r1.clone(); r2.position.z = -L * 0.1; g.add(r2);
    if (def.type === 'rpg') { const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 12).rotateX(-Math.PI / 2), mAccent); tip.position.set(0, 0.04, -L * 0.88); g.add(tip); }
    const m = new THREE.Object3D(); m.position.set(0, 0.04, -L * 0.88); g.add(m); muzzles.push(m);
  } else {
    for (const ox of offsets) {
      const r = def.type.includes('shotgun') || def.type === 'flak' ? 0.022 : 0.014;
      const b = cyl(r, r, L * 0.5, mDark, 10); b.position.set(ox, 0.01, barrelZ); g.add(b);
      if (def.rail) {
        for (let i = 0; i < 4; i++) { const c = cyl(0.032, 0.032, 0.025, mAccent, 10); c.position.set(ox, 0.01, barrelZ - L * 0.2 + i * L * 0.12); g.add(c); }
      }
      const m = new THREE.Object3D(); m.position.set(ox, 0.01, barrelZ - L * 0.26); g.add(m); muzzles.push(m);
    }
    const hand = box(0.075, 0.07, L * 0.3, mBody); hand.position.set(0, -0.005, -L * 0.55); g.add(hand);
  }
  if (def.scope) {
    const sc = cyl(0.028, 0.028, 0.22, mDark); sc.position.set(0, 0.1, -L * 0.2); g.add(sc);
    const lens = cyl(0.03, 0.03, 0.01, glow(rar.color, 3)); lens.position.set(0, 0.1, -L * 0.2 - 0.11); g.add(lens);
  } else if (def.rarity >= 1) {
    const sight = box(0.03, 0.03, 0.05, mDark); sight.position.set(0, 0.075, -L * 0.12); g.add(sight);
    const dot = box(0.008, 0.008, 0.01, glow('#ff2222', 4)); dot.position.set(0, 0.08, -L * 0.12 - 0.026); g.add(dot);
  }
  // 고등급 장식: 부유하는 링 / 에너지 코어
  if (def.rarity >= 3) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.006, 6, 24), mAccent);
    ring.position.set(0, 0.01, -L * 0.45); g.add(ring); g.userData.ring = ring;
  }
  if (def.rarity >= 4) {
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.03, 0), glow(rar.color, 5));
    core.position.set(0.055, 0.02, -L * 0.15); g.add(core); g.userData.core = core;
  }
  if (def.rarity >= 5) {
    const fins = box(0.16, 0.006, 0.12, mAccent); fins.position.set(0, 0.05, -L * 0.05); g.add(fins);
  }
  g.userData.muzzles = muzzles;
  return g;
}

// 근접 무기: 손잡이는 원점, 날은 -z(앞) 방향으로 뻗고 위로 기울여 든다
function buildMelee(def, g, mBody, mDark, mAccent, rar) {
  const L = def.len;
  const blade = def.rarity >= 3 ? mAccent : mat(0xc9ced8, { metalness: 1, roughness: 0.15 });
  const edge = glow(rar.color, 2 + def.rarity * 0.6);
  const add = (m, x, y, z, rx = 0, ry = 0, rz = 0) => { m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m; };
  const handle = (len) => add(cyl(0.022, 0.025, len, mDark, 8), 0, 0, len * 0.2);
  let tipZ = -L;
  switch (def.mshape) {
    case 'knife':
      handle(0.14); add(box(0.08, 0.02, 0.025, mBody), 0, 0, -0.05);
      add(box(0.012, 0.045, L, blade), 0, 0.005, -0.05 - L / 2); add(box(0.014, 0.006, L, edge), 0, -0.02, -0.05 - L / 2);
      tipZ = -0.05 - L; break;
    case 'katana': case 'plasma': {
      handle(0.26); add(cyl(0.05, 0.05, 0.015, mBody, 10), 0, 0, -0.1);
      const bm = def.mshape === 'plasma' ? glow(rar.color, 4) : blade;
      add(box(0.012, 0.05, L, bm), 0, 0.01, -0.12 - L / 2, 0.04);
      add(box(0.014, 0.008, L, edge), 0, -0.016, -0.12 - L / 2, 0.04);
      if (def.mshape === 'plasma') add(box(0.03, 0.09, L * 0.98, glow(rar.color, 1.2)), 0, 0.01, -0.12 - L / 2);
      tipZ = -0.12 - L; break;
    }
    case 'great':
      handle(0.3); add(box(0.26, 0.05, 0.05, mBody), 0, 0, -0.12);
      add(box(0.03, 0.15, L, blade), 0, 0, -0.15 - L / 2); add(box(0.034, 0.02, L * 0.9, edge), 0, 0, -0.15 - L / 2);
      tipZ = -0.15 - L; break;
    case 'hammer':
      add(cyl(0.025, 0.025, L, mDark, 8), 0, 0, -L / 2 + 0.1);
      add(box(0.32, 0.18, 0.2, mBody), 0, 0, -L + 0.05); add(box(0.34, 0.04, 0.22, edge), 0, 0, -L + 0.05);
      tipZ = -L; break;
    case 'chain':
      handle(0.2); add(box(0.08, 0.1, 0.12, mBody), 0, 0, -0.08);
      add(box(0.02, 0.09, L, mDark), 0, 0, -0.14 - L / 2);
      g.userData.teeth = add(box(0.024, 0.11, L, edge), 0, 0, -0.14 - L / 2);
      tipZ = -0.14 - L; break;
    case 'scythe': {
      add(cyl(0.024, 0.024, L, mDark, 8), 0, 0, -L / 2 + 0.15);
      const arcM = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.03, 4, 24, Math.PI * 0.85), blade);
      add(arcM, 0, 0.02, -L + 0.15, 0, Math.PI / 2, Math.PI * 0.55);
      add(new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.01, 4, 24, Math.PI * 0.85), edge), 0, 0.02, -L + 0.15, 0, Math.PI / 2, Math.PI * 0.55);
      tipZ = -L; break;
    }
    case 'fist':
      add(box(0.13, 0.13, 0.22, mBody), 0, 0, -0.05);
      for (let i = 0; i < 4; i++) add(box(0.025, 0.035, 0.05, edge), -0.045 + i * 0.03, 0.04, -0.17);
      add(cyl(0.075, 0.075, 0.05, mDark, 10), 0, 0, 0.08);
      tipZ = -0.2; break;
    case 'spear':
      add(cyl(0.02, 0.02, L, mDark, 8), 0, 0, -L / 2 + 0.2);
      add(new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.3, 6).rotateX(-Math.PI / 2), edge), 0, 0, -L + 0.05);
      add(cyl(0.035, 0.035, 0.03, mAccent, 8), 0, 0, -L + 0.22);
      tipZ = -L - 0.1; break;
  }
  if (def.rarity >= 4) { const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.028, 0), glow(rar.color, 5)); core.position.set(0, 0.04, 0.02); g.add(core); g.userData.core = core; }
  const tip = new THREE.Object3D(); tip.position.set(0, 0, tipZ); g.add(tip);
  g.userData.muzzles = [tip];
  g.userData.melee = true;
  g.rotation.x = def.mshape === 'fist' ? 0 : 0.55; // 날을 세워 든 자세
  return g;
}

// 여러 지오메트리를 하나로 합쳐 드로우콜 절감
function merge(geos) {
  const parts = geos.map((x) => (x.index ? x.toNonIndexed() : x));
  let n = 0; parts.forEach((p) => (n += p.attributes.position.count));
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array, o * 3); nor.set(p.attributes.normal.array, o * 3);
    o += p.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

const enemyGeoCache = {};
export function enemyGeometry(key, def) {
  if (enemyGeoCache[key]) return enemyGeoCache[key];
  const s = def.size;
  const body = [], eyes = [];
  const T = (geo, x, y, z, rx = 0, ry = 0, rz = 0) => {
    geo.rotateX(rx); geo.rotateY(ry); geo.rotateZ(rz); geo.translate(x, y, z); return geo;
  };
  const core = new THREE.IcosahedronGeometry(s, 1); core.scale(1, 0.8, 1.15); body.push(T(core, 0, 0, 0));
  const head = new THREE.IcosahedronGeometry(s * 0.55, 1); body.push(T(head, 0, s * 0.25, s * 0.95));
  // 다리
  const legs = def.fly ? 0 : key === 'brute' || def.boss ? 4 : 6;
  for (let i = 0; i < legs; i++) {
    const side = i % 2 ? 1 : -1; const k = Math.floor(i / 2);
    const leg = new THREE.ConeGeometry(s * 0.14, s * 1.3, 5);
    body.push(T(leg, side * s * 0.9, -s * 0.55, (k - (legs / 4)) * s * 0.6, 0, 0, side * 0.6));
  }
  // 날개 (비행 개체): 납작한 삼각 날개 + 날개 뼈
  if (key === 'wraith') {
    for (const side of [-1, 1]) {
      const wing = new THREE.ConeGeometry(s * 0.9, s * 2.4, 3); wing.scale(1, 1, 0.12);
      body.push(T(wing, side * s * 1.5, s * 0.15, 0, 0, 0, -side * Math.PI / 2));
      const bone = new THREE.ConeGeometry(s * 0.08, s * 2.6, 4);
      body.push(T(bone, side * s * 1.5, s * 0.35, s * 0.3, 0, 0, -side * Math.PI / 2));
    }
  }
  if (key === 'gazer') {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const ten = new THREE.ConeGeometry(s * 0.12, s * 1.6, 5);
      body.push(T(ten, Math.cos(a) * s * 0.6, -s * 1.1, Math.sin(a) * s * 0.6, Math.PI + Math.sin(a) * 0.3, 0, Math.cos(a) * 0.3));
    }
  }
  // 등 가시
  const spikes = def.boss ? 9 : key === 'brute' ? 5 : 3;
  for (let i = 0; i < spikes; i++) {
    const sp = new THREE.ConeGeometry(s * 0.13, s * (def.boss ? 0.9 : 0.6), 5);
    body.push(T(sp, (i % 3 - 1) * s * 0.35, s * 0.75, (Math.floor(i / 3) - 1) * s * 0.4 - s * 0.1, -0.3));
  }
  if (key === 'brute' || def.boss) {
    for (const side of [-1, 1]) {
      const arm = new THREE.BoxGeometry(s * 0.35, s * 0.35, s * 1.1);
      body.push(T(arm, side * s * 1.05, -s * 0.05, s * 0.5, 0.3));
      const claw = new THREE.ConeGeometry(s * 0.18, s * 0.6, 4);
      body.push(T(claw, side * s * 1.05, -s * 0.1, s * 1.2, Math.PI / 2));
    }
  }
  if (def.boss === 2) {
    for (let i = 0; i < 5; i++) {
      const horn = new THREE.ConeGeometry(s * 0.09, s * 0.8, 5);
      body.push(T(horn, (i - 2) * s * 0.18, s * 0.85, s * 0.95, -0.5 + Math.abs(i - 2) * 0.1));
    }
  }
  const eyeN = def.boss ? 4 : key === 'spitter' ? 3 : key === 'gazer' ? 0 : 2;
  for (let i = 0; i < eyeN; i++) {
    const e = new THREE.SphereGeometry(s * 0.1, 8, 6);
    eyes.push(T(e, (i - (eyeN - 1) / 2) * s * 0.22, s * 0.35, s * 1.42));
  }
  if (key === 'gazer') { const big = new THREE.SphereGeometry(s * 0.55, 16, 12); eyes.push(T(big, 0, s * 0.1, s * 0.75)); }
  if (def.explode) { const sac = new THREE.SphereGeometry(s * 0.6, 12, 8); eyes.push(T(sac, 0, s * 0.45, -s * 0.3)); }
  if (key === 'spitter') { const sac = new THREE.SphereGeometry(s * 0.35, 10, 8); eyes.push(T(sac, 0, s * 0.7, -s * 0.2)); }
  const res = { body: merge(body), eyes: merge(eyes) };
  enemyGeoCache[key] = res;
  return res;
}
