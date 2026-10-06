/**
 * Runtime self-test for the procedural models (run from the gallery with ?selftest=1).
 * Verifies API behavior and that visual geometry matches the sim contracts (bank walls and
 * door gaps vs BANK_MODEL colliders, safe / van footprints, draw-call budget per layout).
 */
import * as THREE from 'three';
import {
  BANK_FLOOR_Y,
  FxSystem,
  buildStaticScenery,
  createBank,
  createFence,
  createRaccoon,
  createSafe,
  createVan,
  createZoneMarker,
  idlePose,
} from '../models';
import { BANK_MODEL, SAFE_SPECS, VAN } from '../../sim/config';
import type { HatId, LayoutDef, TeamId } from '../../sim/types';

export interface SelfTestResult {
  name: string;
  ok: boolean;
  detail?: string;
}

/** Union of the geometry bounds of every effectively visible mesh (ignores hidden FX children). */
function visibleMeshBox(root: THREE.Object3D, filter: (m: THREE.Mesh) => boolean = () => true): THREE.Box3 {
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  root.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.isOutlineHull || !filter(m)) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    tmp.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld);
    box.union(tmp);
  });
  return box;
}

/** Max distance (m) that a wall mesh's vertices below `maxY` extend past the collider box. */
function overshoot(mesh: THREE.Mesh, c: { center: { x: number; y: number }; half: { x: number; y: number } }, maxY: number): number {
  const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  let worst = 0;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    if (v.y > maxY) continue;
    const dx = Math.abs(v.x - c.center.x) - c.half.x;
    const dz = Math.abs(v.z - c.center.y) - c.half.y;
    worst = Math.max(worst, dx, dz);
  }
  return worst;
}

export async function runModelSelfTest(layouts: Record<string, LayoutDef> | null): Promise<SelfTestResult[]> {
  const out: SelfTestResult[] = [];
  const check = (name: string, ok: boolean, detail?: string): void => {
    out.push({ name, ok, detail });
  };
  const guard = (name: string, fn: () => void): void => {
    try {
      fn();
    } catch (e) {
      check(name, false, String((e as Error)?.stack ?? e));
    }
  };

  // --- raccoon: every look x pose -------------------------------------------------------
  guard('raccoon looks/poses', () => {
    const hats: HatId[] = ['none', 'teamCapA', 'teamCapB', 'hodadakBand', 'tongkeunHat', 'nunchiMask'];
    const rivals = [null, 'hodadak', 'tongkeun', 'nunchi'] as const;
    let n = 0;
    for (const team of [0, 1, null] as (TeamId | null)[]) {
      for (const hat of hats) {
        for (const rival of rivals) {
          const r = createRaccoon({ team, look: { hat, rival, furTint: Math.random() } });
          const flags = ['grabbing', 'straining', 'dashing', 'boosting', 'knockedDown', 'celebrating', 'sad'] as const;
          let t = 0;
          for (const f of flags) {
            for (let i = 0; i < 20; i++) {
              t += 1 / 60;
              r.update(1 / 60, { ...idlePose(t), speed: 3, [f]: true });
            }
          }
          r.setHighlight('#ffffff');
          r.setLook({ hat: hats[(hats.indexOf(hat) + 1) % hats.length], rival });
          r.setHighlight(null);
          const box = new THREE.Box3().setFromObject(r.root);
          if (box.max.y < 0.95 || box.max.y > 1.9) throw new Error(`raccoon height ${box.max.y.toFixed(2)} (${hat}/${rival})`);
          r.dispose();
          n++;
        }
      }
    }
    check('raccoon looks/poses', true, `${n} rigs`);
  });

  guard('raccoon height (no hat)', () => {
    const r = createRaccoon({ team: 0, look: { hat: 'none' } });
    r.update(0, idlePose(0));
    r.root.updateMatrixWorld(true);
    const box = visibleMeshBox(r.root, (m) => !m.name.includes('blob'));
    const h = box.max.y;
    const rad = Math.max(Math.abs(box.min.x), box.max.x, Math.abs(box.min.z), box.max.z);
    check('raccoon height (no hat)', h > 0.98 && h < 1.12, `height ${h.toFixed(3)} m, max extent ${rad.toFixed(2)} m`);
    r.dispose();
  });

  // --- safes ------------------------------------------------------------------------------
  for (const kind of ['smallSafe', 'largeSafe'] as const) {
    guard(`safe ${kind}`, () => {
      const s = createSafe(kind);
      s.setAnchored(true);
      s.setStrain(1);
      s.update(0.1);
      s.setStrain(0);
      s.update(0.1);
      s.root.updateMatrixWorld(true);
      const body = s.root.getObjectByName(`${kind}:body`)!;
      const box = new THREE.Box3().setFromObject(body);
      const size = box.getSize(new THREE.Vector3());
      const spec = SAFE_SPECS[kind];
      const okX = Math.abs(size.x - spec.half.x * 2) < 0.12;
      const okZ = size.z < spec.half.y * 2 + 0.25 && size.z > spec.half.y * 2 - 0.05;
      const okY = Math.abs(box.max.y - spec.height) < 0.06;
      const anchors = s.root.getObjectByName(`${kind}:anchors`)!;
      const anchoredVisible = anchors.visible;
      s.setAnchored(false);
      check(`safe ${kind}`, okX && okZ && okY && anchoredVisible && !anchors.visible, `size ${size.x.toFixed(2)} x ${size.z.toFixed(2)} h ${box.max.y.toFixed(2)}`);
      s.setHighlight('#00ff00');
      s.setHighlight(null);
      s.dispose();
    });
  }

  // --- bank: walls match colliders, door gaps are open -------------------------------------------
  guard('bank walls vs colliders', () => {
    const bank = createBank();
    bank.root.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    const problems: string[] = [];
    if (bank.walls.length !== BANK_MODEL.walls.length) problems.push(`walls ${bank.walls.length}`);
    BANK_MODEL.walls.forEach((w, i) => {
      // A ray through the collider center at 1.2 m must hit wall i first.
      const alongX = w.half.x > w.half.y;
      const n = alongX ? new THREE.Vector3(0, 0, Math.sign(w.center.y)) : new THREE.Vector3(Math.sign(w.center.x), 0, 0);
      // Probe off-center away from windows/door-adjacent columns.
      const probe = new THREE.Vector3(w.center.x, 0.45, w.center.y);
      const origin = probe.clone().addScaledVector(n, 3);
      ray.set(origin, n.clone().negate());
      const hits = ray.intersectObject(bank.walls[i], true).filter((h) => !h.object.userData.isOutlineHull);
      if (!hits.length) problems.push(`wall ${i}: no hit`);
      else {
        const surface = (alongX ? Math.abs(w.center.y) + w.half.y : Math.abs(w.center.x) + w.half.x);
        const d = Math.abs((alongX ? Math.abs(hits[0].point.z) : Math.abs(hits[0].point.x)) - surface);
        if (d > 0.08) problems.push(`wall ${i}: surface off by ${d.toFixed(3)}`);
      }
      // Below head height (2 m) the visuals may exceed the collider only by thin trims
      // (sills, column bases); higher up, sconces/cornices may reach further.
      const mesh = bank.walls[i].children[0] as THREE.Mesh;
      const low = overshoot(mesh, w, 2.0);
      const high = overshoot(mesh, w, 99);
      if (low > 0.13) problems.push(`wall ${i}: exceeds collider by ${low.toFixed(3)} below 2 m`);
      if (high > 0.3) problems.push(`wall ${i}: exceeds collider by ${high.toFixed(3)} overall`);
    });
    // Door gaps: a horizontal ray at 1 m through each door must not hit walls or headers.
    for (const d of BANK_MODEL.doors) {
      for (const off of [-0.8, 0, 0.8]) {
        const origin = new THREE.Vector3(d.center.x + off, 1.0, d.center.y + d.normal.y * 2);
        ray.set(origin, new THREE.Vector3(0, 0, -d.normal.y));
        ray.far = 4;
        const blockers = ray
          .intersectObjects([...bank.walls, ...bank.root.children], true)
          .filter((h) => !h.object.userData.isOutlineHull && /wall|header/.test(h.object.name));
        if (blockers.length) problems.push(`door ${d.normal.y > 0 ? 'front' : 'back'} blocked at ${off}: ${blockers[0].object.name}`);
      }
    }
    // Opacity + roof API.
    bank.setWallOpacity(0, 0.3);
    const mat = (bank.walls[0].children[0] as THREE.Mesh).material as THREE.Material;
    if (!mat.transparent || Math.abs(mat.opacity - 0.3) > 1e-6) problems.push('setWallOpacity did not fade');
    bank.setWallOpacity(0, 1);
    if (mat.transparent) problems.push('setWallOpacity(1) left transparent');
    bank.setRoofOpacity(0);
    if (bank.roof.visible) problems.push('roof visible at opacity 0');
    bank.setRoofOpacity(1);
    bank.setUprooted(true);
    bank.setStrain(1);
    bank.wobbleSign(2);
    for (let i = 0; i < 60; i++) bank.update(1 / 60);
    bank.setHighlight('#fff4b8');
    bank.setHighlight(null);
    check('bank walls vs colliders', problems.length === 0, problems.join('; ') || `floor y ${BANK_FLOOR_Y}`);
    bank.dispose();
  });

  // --- van / zone / fence ---------------------------------------------------------------------------
  guard('van footprint', () => {
    const v = createVan(0);
    v.root.updateMatrixWorld(true);
    const body = v.root.getObjectByName('van:body')!;
    const box = new THREE.Box3().setFromObject(body);
    const size = box.getSize(new THREE.Vector3());
    // Body within the collider (+ bumpers/mirrors trims); roof cargo may rise above.
    const ok = size.x <= VAN.half.x * 2 + 0.15 && size.x > VAN.half.x * 2 - 0.2 && size.z <= VAN.half.y * 2 + 0.15 && box.max.y < VAN.height + 1.0;
    v.setSiren(true);
    v.bounce();
    v.setDepart(0.5);
    for (let i = 0; i < 30; i++) v.update(1 / 60);
    check('van footprint', ok, `size ${size.x.toFixed(2)} x ${size.z.toFixed(2)} x ${size.y.toFixed(2)}`);
    v.dispose();
  });

  guard('zone + fence', () => {
    const z = createZoneMarker({ team: 1, center: { x: 5, y: 5 }, half: { x: 6.5, y: 5.5 }, angle: 0.3, vanPos: { x: 0, y: 0 }, vanAngle: 0 });
    z.setActive(1);
    z.setProgress(0.6);
    z.update(0.016);
    z.dispose();
    const f = createFence({ id: 'test.f', center: { x: 1, y: 2 }, half: { x: 0.2, y: 3 }, angle: 0.2 });
    const burst = f.breakApart({ x: 1, y: 0 });
    let frames = 0;
    while (burst.update(1 / 60) && frames < 1000) frames++;
    const pieces = burst.root.children.length;
    burst.dispose();
    f.reset();
    const ok = f.broken === false && pieces > 4 && frames < 1000;
    f.dispose();
    check('zone + fence', ok, `${pieces} debris pieces, ${frames} frames`);
  });

  guard('fx pools', () => {
    const fx = new FxSystem();
    for (let i = 0; i < 20; i++) {
      fx.dust({ x: 0, y: 0, z: 0 });
      fx.confetti({ x: 0, y: 0, z: 0 });
      fx.stars({ x: 0, y: 0, z: 0 });
      fx.coins({ x: 0, y: 0, z: 0 });
      fx.sparkle({ x: 0, y: 0, z: 0 });
      fx.ring({ x: 0, y: 0, z: 0 });
    }
    const peak = fx.activeCount;
    for (let i = 0; i < 300; i++) fx.update(1 / 60);
    const after = fx.activeCount;
    fx.dispose();
    check('fx pools', peak > 0 && after === 0, `peak ${peak}, after 5 s ${after}`);
  });

  // --- scenery budget for every layout ---------------------------------------------------------
  if (layouts) {
    for (const [id, layout] of Object.entries(layouts)) {
      guard(`scenery ${id}`, () => {
        const t0 = performance.now();
        const sc = buildStaticScenery(layout);
        const ms = performance.now() - t0;
        let resolved = 0;
        sc.setSignResolver((k) => {
          resolved++;
          return `EN ${k}`;
        });
        const ok = sc.stats.drawCalls < 150 && resolved > 0;
        check(`scenery ${id}`, ok, `${sc.stats.drawCalls} meshes (${sc.stats.shadowCasters} shadow casters), ${sc.stats.triangles.toLocaleString()} tris, ${sc.stats.chunks} chunks, ${ms.toFixed(0)} ms`);
        sc.dispose();
      });
    }
  }
  return out;
}
