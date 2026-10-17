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
// 움직이는 부품: userData.bolt(노리쇠/슬라이드), pump(펌프), mag(탄창), drum(회전 실린더), warhead(로켓 탄두)
export function buildGun(def) {
  const g = new THREE.Group();
  const rar = RARITIES[def.rarity];
  const body = new THREE.Color().setHSL(def.hue / 360, 0.22 + def.rarity * 0.08, 0.13 + def.rarity * 0.025);
  const mBody = mat(body.getHex(), { metalness: 0.55 + def.rarity * 0.07, roughness: 0.32 });
  const mBody2 = mat(body.clone().multiplyScalar(1.6).getHex(), { metalness: 0.7, roughness: 0.28 });
  const mDark = mat(0x15171c, { roughness: 0.55, metalness: 0.5 });
  const mPoly = mat(0x1f2229, { roughness: 0.85, metalness: 0.05 });
  const mSteel = mat(0x8b919c, { roughness: 0.22, metalness: 1 });
  const mAccent = glow(rar.color, 1.1 + def.rarity * 0.3);
  const L = def.len;
  const muzzles = [];
  if (def.mode === 'melee') return buildMelee(def, g, mBody, mDark, mAccent, rar);
  const add = (m, x, y, z, rx = 0, ry = 0, rz = 0, p = g) => { m.position.set(x, y, z); m.rotation.set(rx, ry, rz); p.add(m); return m; };
  const pistol = def.type === 'pistol';
  const shotgunLike = def.type.includes('shotgun') || def.type === 'flak';

  if (def.tube) {
    // ─ 발사관 계열 (RPG / 유탄 / 수류탄) ─
    const R = def.type === 'rpg' ? 0.072 : 0.058;
    add(cyl(R, R, L, mBody, 20), 0, 0.04, -L * 0.35);
    add(cyl(R * 1.18, R * 1.18, 0.05, mDark, 20), 0, 0.04, -L * 0.84);
    add(cyl(R * 1.18, R * 1.18, 0.05, mDark, 20), 0, 0.04, L * 0.12);
    for (const z of [-0.6, -0.25]) add(cyl(R * 1.06, R * 1.06, 0.018, mAccent, 20), 0, 0.04, L * z);
    add(box(0.05, 0.15, 0.06, mPoly), 0, -0.07, 0.0, 0.3);
    add(box(0.045, 0.12, 0.05, mPoly), 0, -0.06, -L * 0.45, 0.15);
    add(box(0.035, 0.06, 0.08, mDark), -R - 0.012, 0.09, -L * 0.3);
    add(box(0.012, 0.02, 0.02, glow('#ff2222', 4)), -R - 0.012, 0.125, -L * 0.3 - 0.03);
    if (def.type === 'rpg') {
      const wh = new THREE.Group(); add(wh, 0, 0.04, -L * 0.86);
      add(new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 16).rotateX(-Math.PI / 2), mBody2), 0, 0, -0.12, 0, 0, 0, wh);
      add(new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.06, 12).rotateX(-Math.PI / 2), mAccent), 0, 0, -0.24, 0, 0, 0, wh);
      g.userData.warhead = wh;
    } else {
      const drum = new THREE.Group(); add(drum, 0, -0.01, -L * 0.15);
      add(cyl(0.085, 0.085, 0.13, mDark, 6), 0, 0, 0, 0, 0, 0, drum);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; add(cyl(0.022, 0.022, 0.135, mAccent, 8), Math.cos(a) * 0.055, Math.sin(a) * 0.055, 0, 0, 0, 0, drum); }
      g.userData.drum = drum;
    }
    const m = new THREE.Object3D(); m.position.set(0, 0.04, -L * 0.9); g.add(m); muzzles.push(m);
  } else {
    // ─ 리시버 ─
    const recL = pistol ? 0.2 : L * 0.5;
    add(box(0.078, 0.1, recL, mBody), 0, 0, -recL * 0.35);
    add(box(0.07, 0.025, recL * 0.96, mBody2), 0, 0.06, -recL * 0.35);
    add(box(0.082, 0.012, recL * 0.8, mAccent), 0, 0.02, -recL * 0.35);
    // 배출구 + 노리쇠 (사격마다 뒤로 튐)
    add(box(0.006, 0.03, 0.07, mDark), 0.04, 0.025, -recL * 0.25);
    const bolt = new THREE.Group(); add(bolt, 0, 0, 0);
    if (pistol) add(box(0.074, 0.05, 0.22, mBody2), 0, 0.07, -0.07, 0, 0, 0, bolt);
    else { add(box(0.012, 0.022, 0.06, mSteel), 0.046, 0.025, -recL * 0.25, 0, 0, 0, bolt); add(cyl(0.008, 0.008, 0.04, mSteel, 6), 0.06, 0.025, -recL * 0.2, 0, Math.PI / 2, 0, bolt); }
    g.userData.bolt = bolt;
    // 레일
    if (!pistol) {
      add(box(0.03, 0.01, recL * 0.9, mDark), 0, 0.078, -recL * 0.35);
      const teeth = Math.floor(recL * 0.9 / 0.025);
      for (let i = 0; i < teeth; i++) add(box(0.034, 0.008, 0.012, mDark), 0, 0.086, -recL * 0.8 + i * 0.025);
    }
    // 방아쇠울 + 방아쇠 + 그립
    add(new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.005, 6, 16, Math.PI), mDark), 0, -0.05, -0.03, 0, Math.PI / 2, Math.PI);
    add(box(0.008, 0.03, 0.01, mSteel), 0, -0.06, -0.03, 0.3);
    add(box(0.056, 0.15, 0.065, mPoly), 0, -0.11, 0.035, 0.32);
    for (let i = 0; i < 3; i++) add(box(0.058, 0.008, 0.02, mDark), 0, -0.08 - i * 0.035, 0.002 + i * 0.012, 0.32);
    // 탄창 (장전 시 아래로 빠짐)
    const mag = new THREE.Group(); add(mag, 0, -0.05, pistol ? 0.035 : -recL * 0.55);
    if (pistol) add(box(0.04, 0.02, 0.05, mDark), 0, -0.15, 0.0, 0, 0, 0, mag);
    else if (def.type === 'minigun') {
      add(box(0.12, 0.1, 0.14, mBody), 0.08, -0.06, 0.05, 0, 0, 0, mag);
      add(box(0.122, 0.015, 0.142, mAccent), 0.08, -0.02, 0.05, 0, 0, 0, mag);
    } else if (shotgunLike) add(box(0.045, 0.05, 0.06, mDark), 0, -0.04, 0, 0, 0, 0, mag);
    else {
      const curve = def.type === 'rifle' || def.type === 'drifle' || def.type === 'burst' ? 0.25 : 0.08;
      add(box(0.042, 0.09, 0.06, mDark), 0, -0.045, 0, -curve * 0.5, 0, 0, mag);
      add(box(0.04, 0.08, 0.058, mDark), 0, -0.12, 0.018, -curve * 1.5, 0, 0, mag);
      add(box(0.044, 0.01, 0.062, mAccent), 0, -0.16, 0.03, -curve * 1.5, 0, 0, mag);
    }
    g.userData.mag = mag;
    // 개머리판 (스켈레톤)
    if (!pistol && L > 0.5) {
      add(box(0.02, 0.02, 0.3, mBody), 0, 0.03, 0.22);
      add(box(0.02, 0.02, 0.31, mBody), 0, -0.04, 0.22, 0.12);
      add(box(0.06, 0.13, 0.035, mPoly), 0, -0.005, 0.4);
      add(box(0.062, 0.02, 0.037, mAccent), 0, 0.05, 0.4);
    }
    // ─ 총열부 ─
    const frontZ = pistol ? -0.18 : -recL * 0.6;
    const offsets = def.barrels === 2 ? [-0.03, 0.03] : [0];
    if (def.gatling) {
      const spin = new THREE.Group(); spin.position.z = frontZ - L * 0.3; g.add(spin);
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; add(cyl(0.013, 0.013, L * 0.6, mSteel, 8), Math.cos(a) * 0.036, Math.sin(a) * 0.036, 0, 0, 0, 0, spin); }
      for (const z of [-0.28, 0, 0.22]) add(cyl(0.056, 0.056, 0.025, z === 0 ? mAccent : mDark, 16), 0, 0, L * z, 0, 0, 0, spin);
      add(cyl(0.065, 0.06, 0.16, mBody, 16), 0, 0, frontZ + 0.02);
      g.userData.spin = spin;
      const m = new THREE.Object3D(); m.position.set(0, 0, frontZ - L * 0.6); g.add(m); muzzles.push(m);
    } else {
      const bl = pistol ? 0.05 : L * 0.5;
      // 핸드가드 + 통풍구
      if (!pistol) {
        add(box(0.07, 0.068, bl * 0.75, mBody), 0, -0.002, frontZ - bl * 0.375);
        const vents = Math.floor(bl * 0.6 / 0.035);
        for (let i = 0; i < vents; i++) for (const sx of [-1, 1]) add(box(0.004, 0.018, 0.016, def.rarity >= 2 ? mAccent : mDark), sx * 0.036, 0, frontZ - 0.03 - i * 0.035);
        if (shotgunLike) {
          const pump = new THREE.Group(); add(pump, 0, -0.045, frontZ - bl * 0.45);
          add(box(0.06, 0.045, bl * 0.4, mPoly), 0, 0, 0, 0, 0, 0, pump);
          for (let i = 0; i < 4; i++) add(box(0.062, 0.006, 0.01, mDark), 0, 0, -bl * 0.15 + i * bl * 0.1, 0, 0, 0, pump);
          add(cyl(0.016, 0.016, bl * 0.9, mDark, 10), 0, -0.045, frontZ - bl * 0.45);
          g.userData.pump = pump;
        } else if (L > 0.6) add(box(0.03, 0.07, 0.035, mPoly), 0, -0.07, frontZ - bl * 0.3, 0.1);
      }
      for (const ox of offsets) {
        const r = shotgunLike ? 0.02 : 0.012;
        const bz = frontZ - bl * 0.5;
        add(cyl(r, r, bl * (pistol ? 1 : 1.05), mSteel, 14), ox, 0.012, bz - (pistol ? 0 : bl * 0.1));
        // 머즐 브레이크
        const tipZ = frontZ - bl * (pistol ? 1 : 1.12);
        add(cyl(r * 1.7, r * 1.7, 0.05, mDark, 12), ox, 0.012, tipZ);
        if (!pistol) { add(box(r * 3.6, 0.006, 0.012, mDark), ox, 0.012, tipZ - 0.008); add(box(r * 3.6, 0.006, 0.012, mDark), ox, 0.012, tipZ + 0.012); }
        if (def.rail) for (let i = 0; i < 5; i++) add(cyl(0.032, 0.032, 0.018, mAccent, 14), ox, 0.012, frontZ - bl * 0.15 - i * bl * 0.17);
        if (def.mode === 'beam' || def.type === 'plasma' || def.type === 'cryo') add(new THREE.Mesh(new THREE.TorusGeometry(r * 2.2, 0.006, 6, 20), mAccent), ox, 0.012, tipZ - 0.03);
        if (def.type === 'tesla') for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; add(cyl(0.005, 0.002, 0.08, mAccent, 5), ox + Math.cos(a) * 0.03, 0.012 + Math.sin(a) * 0.03, tipZ - 0.04); }
        const m = new THREE.Object3D(); m.position.set(ox, 0.012, tipZ - 0.04); g.add(m); muzzles.push(m);
      }
    }
  }
  // ─ 조준경 ─
  if (def.scope) {
    add(cyl(0.026, 0.026, 0.24, mDark, 16), 0, 0.12, -L * 0.2);
    add(cyl(0.034, 0.028, 0.06, mDark, 16), 0, 0.12, -L * 0.2 - 0.14);
    add(cyl(0.03, 0.026, 0.05, mDark, 16), 0, 0.12, -L * 0.2 + 0.13);
    for (const z of [-0.06, 0.06]) add(box(0.02, 0.04, 0.02, mBody), 0, 0.095, -L * 0.2 + z);
    add(cyl(0.031, 0.031, 0.004, glow(rar.color, 3), 16), 0, 0.12, -L * 0.2 - 0.171);
    add(cyl(0.024, 0.024, 0.004, glow('#3355ff', 1.5), 16), 0, 0.12, -L * 0.2 + 0.156);
  } else if (def.rarity >= 1 && !def.tube) {
    // 홀로그램 도트 사이트
    const sz = pistol ? -0.04 : -L * 0.12;
    add(box(0.04, 0.012, 0.06, mDark), 0, pistol ? 0.1 : 0.092, sz);
    add(box(0.006, 0.04, 0.012, mDark), -0.019, pistol ? 0.12 : 0.112, sz - 0.02);
    add(box(0.006, 0.04, 0.012, mDark), 0.019, pistol ? 0.12 : 0.112, sz - 0.02);
    add(box(0.044, 0.006, 0.012, mDark), 0, pistol ? 0.14 : 0.132, sz - 0.02);
    add(box(0.03, 0.03, 0.002, new THREE.MeshBasicMaterial({ color: 0x66ffcc, transparent: true, opacity: 0.12 })), 0, pistol ? 0.12 : 0.112, sz - 0.02);
    add(box(0.004, 0.004, 0.002, glow('#ff2222', 6)), 0, pistol ? 0.12 : 0.112, sz - 0.021);
  } else if (!def.tube) add(box(0.006, 0.02, 0.006, mDark), 0, 0.075, pistol ? -0.16 : -L * 0.7);
  // ─ 고등급 장식 ─
  if (def.rarity >= 3) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.005, 6, 32), mAccent);
    add(ring, 0, 0.012, -L * 0.5); g.userData.ring = ring;
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.003, 6, 32), mAccent);
    add(ring2, 0, 0.012, -L * 0.42, 0.4); g.userData.ring2 = ring2;
  }
  if (def.rarity >= 4) {
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.026, 1), glow(rar.color, 6));
    add(core, 0.055, 0.03, -L * 0.15); g.userData.core = core;
    add(new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.004, 6, 20), mSteel), 0.055, 0.03, -L * 0.15, 0, Math.PI / 2);
  }
  if (def.rarity >= 5) {
    for (const sx of [-1, 1]) add(box(0.05, 0.004, 0.12, mAccent), sx * 0.055, 0.045, -L * 0.1, 0, 0, sx * 0.35);
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

// 여러 지오메트리를 하나로 합쳐 드로우콜 절감. shade가 주어지면 정점색(위는 밝고 배는 어둡게)을 굽는다
function merge(parts, s = 0) {
  const list = parts.map((x) => (x.isBufferGeometry ? { geo: x, shade: 1 } : x)).map((p) => ({ ...p, geo: p.geo.index ? p.geo.toNonIndexed() : p.geo }));
  let n = 0; list.forEach((p) => (n += p.geo.attributes.position.count));
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = s ? new Float32Array(n * 3) : null;
  let o = 0;
  for (const p of list) {
    const pa = p.geo.attributes.position.array;
    pos.set(pa, o * 3); nor.set(p.geo.attributes.normal.array, o * 3);
    if (col) for (let i = 0; i < pa.length; i += 3) {
      const t = Math.min(1, Math.max(0, (pa[i + 1] + s) / (2 * s)));
      const k = p.shade * (0.42 + 0.7 * t * t);
      col[o * 3 + i] = k; col[o * 3 + i + 1] = k; col[o * 3 + i + 2] = k;
    }
    o += p.geo.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

// 괴생물체: body(갑각·가시·팔), legsA/legsB(교차 보행), jaw(턱·집게), eyes(발광부)
const enemyGeoCache = {};
export function enemyGeometry(key, def) {
  if (enemyGeoCache[key]) return enemyGeoCache[key];
  const s = def.size;
  const body = [], eyes = [], legsA = [], legsB = [], jaw = [];
  const T = (geo, x, y, z, rx = 0, ry = 0, rz = 0) => { geo.rotateX(rx); geo.rotateY(ry); geo.rotateZ(rz); geo.translate(x, y, z); return geo; };
  const B = (geo, shade = 1) => body.push({ geo, shade });
  const ico = (r, d = 2) => new THREE.IcosahedronGeometry(r, d);

  if (key === 'gazer') {
    const core = ico(s * 0.85, 3); B(core, 1);
    for (let i = 0; i < 5; i++) { const pl = ico(s * 0.45, 1); pl.scale(1.3, 0.5, 1); B(T(pl, Math.cos(i * 1.26) * s * 0.55, s * 0.55, Math.sin(i * 1.26) * s * 0.55 - s * 0.1, 0.4, i * 1.26), 1.25); }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const up = new THREE.ConeGeometry(s * 0.13, s * 0.9, 6); B(T(up, Math.cos(a) * s * 0.55, -s * 0.85, Math.sin(a) * s * 0.55, Math.PI + Math.sin(a) * 0.25, 0, Math.cos(a) * 0.25), 0.8);
      const low = new THREE.ConeGeometry(s * 0.08, s * 1.1, 5); (i % 2 ? legsA : legsB).push({ geo: T(low, Math.cos(a) * s * 0.7, -s * 1.6, Math.sin(a) * s * 0.7, Math.PI + Math.sin(a) * 0.4, 0, Math.cos(a) * 0.4), shade: 0.7 });
      eyes.push(T(new THREE.SphereGeometry(s * 0.06, 6, 4), Math.cos(a) * s * 0.82, -s * 0.3, Math.sin(a) * s * 0.82));
    }
    eyes.push(T(new THREE.SphereGeometry(s * 0.5, 20, 14), 0, s * 0.05, s * 0.55));
    const lid = new THREE.TorusGeometry(s * 0.52, s * 0.08, 8, 24); B(T(lid, 0, s * 0.05, s * 0.6), 1.3);
    jaw.push({ geo: T(new THREE.SphereGeometry(s * 0.56, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.32), 0, 0, 0, Math.PI / 2), shade: 1.2 });
  } else {
    // 몸통: 복부 + 겹친 갑각 마디 + 머리
    const abd = ico(s * 0.85); abd.scale(1, 0.75, 1.25); B(T(abd, 0, -s * 0.05, -s * 0.45), 0.9);
    for (let i = 0; i < 4; i++) {
      const seg = ico(s * (0.78 - i * 0.07), 1); seg.scale(1.15, 0.45, 0.62);
      B(T(seg, 0, s * (0.32 - i * 0.02), s * (0.35 - i * 0.38), -0.15), 1.25 - i * 0.05);
    }
    const thorax = ico(s * 0.62); thorax.scale(1, 0.8, 1); B(T(thorax, 0, 0, s * 0.45), 1);
    const head = ico(s * 0.46); head.scale(1, 0.85, 1.15); B(T(head, 0, s * 0.12, s * 1.0), 1.1);
    const crest = ico(s * 0.32, 1); crest.scale(1.2, 0.5, 1.2); B(T(crest, 0, s * 0.38, s * 0.95, -0.3), 1.3);
    // 등 가시 (끝은 발광)
    const spikes = def.boss ? 10 : key === 'brute' ? 7 : 5;
    for (let i = 0; i < spikes; i++) {
      const side = i % 2 ? 1 : -1, row = Math.floor(i / 2);
      const h = s * (def.boss ? 0.95 : 0.6) * (1 - row * 0.12);
      const x = side * s * 0.28, y = s * 0.6, z = s * (0.5 - row * 0.38);
      B(T(new THREE.ConeGeometry(s * 0.1, h, 6), x, y + h * 0.3, z, -0.45, 0, side * 0.25), 0.75);
      eyes.push(T(new THREE.ConeGeometry(s * 0.035, h * 0.3, 5), x + side * h * 0.2, y + h * 0.72, z - h * 0.32, -0.45, 0, side * 0.25));
    }
    // 옆구리 발광 고름주머니
    for (const side of [-1, 1]) for (let i = 0; i < 2; i++) eyes.push(T(new THREE.SphereGeometry(s * 0.1, 8, 6), side * s * 0.78, -s * 0.05, -s * 0.2 - i * s * 0.4));
    // 꼬리 (스토커/보스)
    if (key === 'stalker' || def.boss) {
      for (let i = 0; i < 5; i++) { const t = ico(s * (0.3 - i * 0.045), 1); B(T(t, 0, s * (0.1 + i * 0.12), -s * (1.35 + i * 0.32)), 1 - i * 0.05); }
      B(T(new THREE.ConeGeometry(s * 0.09, s * 0.5, 6), 0, s * 0.75, -s * 2.9, -0.9), 0.8);
    }
    // 관절 다리 (윗다리 + 아랫다리 + 발톱), 교차 보행용으로 A/B 분리
    const legN = def.fly ? 0 : key === 'brute' || def.boss ? 4 : 6;
    for (let i = 0; i < legN; i++) {
      const side = i % 2 ? 1 : -1, k = Math.floor(i / 2), z = (k - (legN / 2 - 1) / 2) * s * 0.65 + s * 0.2;
      const grp = (k + (side > 0 ? 1 : 0)) % 2 ? legsA : legsB;
      const ux = side * s * 1.0, uy = s * 0.35;
      const up = new THREE.CylinderGeometry(s * 0.09, s * 0.13, s * 0.9, 6); grp.push({ geo: T(up, side * s * 0.72, s * 0.2, z, 0, 0, side * -1.0), shade: 1 });
      grp.push({ geo: T(ico(s * 0.12, 1), ux, uy, z), shade: 1.2 });
      const low = new THREE.CylinderGeometry(s * 0.1, s * 0.03, s * 1.15, 6); grp.push({ geo: T(low, ux + side * s * 0.18, uy - s * 0.58, z, 0, 0, side * 0.3), shade: 0.85 });
    }
    // 브루트/보스 팔
    if (key === 'brute' || def.boss) {
      for (const side of [-1, 1]) {
        B(T(ico(s * 0.38, 1), side * s * 0.82, s * 0.32, s * 0.5), 1.3);
        const arm = new THREE.CylinderGeometry(s * 0.17, s * 0.22, s * 1.0, 7); B(T(arm, side * s * 1.0, -s * 0.05, s * 0.85, 1.1, 0, side * 0.2), 1);
        const claw = new THREE.ConeGeometry(s * 0.2, s * 0.75, 5); B(T(claw, side * s * 1.05, -s * 0.2, s * 1.45, Math.PI / 2 + 0.3), 0.9);
        eyes.push(T(new THREE.SphereGeometry(s * 0.09, 8, 6), side * s * 0.82, s * 0.62, s * 0.5));
      }
    }
    if (def.boss === 2) {
      for (let i = 0; i < 5; i++) B(T(new THREE.ConeGeometry(s * 0.08, s * 0.9, 6), (i - 2) * s * 0.17, s * 0.72, s * 0.92, -0.6 + Math.abs(i - 2) * 0.12), 0.7);
      const crown = new THREE.TorusGeometry(s * 0.36, s * 0.035, 6, 24); eyes.push(T(crown, 0, s * 0.5, s * 0.95, Math.PI / 2 - 0.3));
    }
    if (key === 'wraith') {
      for (const side of [-1, 1]) {
        const wing = new THREE.ConeGeometry(s * 1.0, s * 2.6, 3); wing.scale(1, 1, 0.08);
        B(T(wing, side * s * 1.55, s * 0.15, -s * 0.1, 0, 0, -side * Math.PI / 2), 0.6);
        for (let i = 0; i < 3; i++) B(T(new THREE.CylinderGeometry(s * 0.04, s * 0.02, s * 2.4, 4), side * s * 1.4, s * 0.3, -s * 0.1 + (i - 1) * s * 0.35, 0, (i - 1) * 0.3 * side, -side * Math.PI / 2), 1.2);
        eyes.push(T(new THREE.SphereGeometry(s * 0.06, 6, 4), side * s * 2.7, s * 0.2, -s * 0.1));
      }
    }
    // 눈
    const eyeN = def.boss ? 6 : key === 'spitter' ? 4 : 3;
    for (let i = 0; i < eyeN; i++) {
      const row = i % 2, col = (i - (eyeN - 1) / 2) * s * 0.17;
      eyes.push(T(new THREE.SphereGeometry(s * (row ? 0.07 : 0.1), 10, 8), col, s * (0.27 - row * 0.12), s * 1.38 - row * s * 0.05));
    }
    if (def.explode) { eyes.push(T(new THREE.SphereGeometry(s * 0.62, 16, 12), 0, s * 0.45, -s * 0.5)); }
    if (key === 'spitter') { eyes.push(T(new THREE.SphereGeometry(s * 0.4, 14, 10), 0, s * 0.75, -s * 0.35)); }
    // 턱: 좌우 집게 + 아래턱 (원점이 관절)
    for (const side of [-1, 1]) {
      const m1 = new THREE.ConeGeometry(s * 0.08, s * 0.5, 5); jaw.push({ geo: T(m1, side * s * 0.16, -s * 0.02, s * 0.22, Math.PI / 2, 0, -side * 0.35), shade: 1.3 });
      jaw.push({ geo: T(new THREE.ConeGeometry(s * 0.035, s * 0.18, 4), side * s * 0.06, -s * 0.05, s * 0.42, Math.PI / 2 + 0.4, 0, side * 0.5), shade: 1.5 });
    }
    const lower = ico(s * 0.22, 1); lower.scale(1.1, 0.45, 1.2); jaw.push({ geo: T(lower, 0, -s * 0.12, s * 0.12), shade: 0.9 });
  }
  const res = {
    body: merge(body, s), eyes: merge(eyes), jaw: merge(jaw, s),
    legsA: legsA.length ? merge(legsA, s) : null, legsB: legsB.length ? merge(legsB, s) : null,
    jawPos: key === 'gazer' ? [0, s * 0.05, s * 0.62] : [0, s * 0.02, s * 1.2],
  };
  enemyGeoCache[key] = res;
  return res;
}
