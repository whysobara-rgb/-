/**
 * Runtime self-test for the procedural models (run from the gallery with ?selftest=1).
 * Verifies API behavior and that visual geometry matches the sim contracts (bank walls and
 * door gaps vs BANK_MODEL colliders, safe / van footprints, draw-call budget per layout),
 * plus the review fixes: belly clearance per girth, team emblem shape on every hat, safes
 * inside their colliders, camera-facing labels, compact bank roots, localized signs and
 * whole-building occlusion fades.
 */
import * as THREE from 'three';
import {
  BANK_FLOOR_Y,
  FxSystem,
  PAL,
  buildStaticScenery,
  cameraFacingYaw,
  createBank,
  createFence,
  createRaccoon,
  createSafe,
  createVan,
  createZoneMarker,
  idlePose,
  setOcclusionFocus,
  setViewCamera,
} from '../models';
import { fadeTexture } from '../models/occlusion';
import { BANK_MODEL, SAFE_SPECS, VAN } from '../../sim/config';
import { TEAM_STYLES } from '../../shared/teams';
import { LAYOUT_STRINGS } from '../../sim/layouts/strings';
import type { HatId, LayoutDef, TeamId } from '../../sim/types';

const HANGUL = /[\u3131-\u318E\uAC00-\uD7A3]/;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Does a geometry's vertex color attribute contain (approximately) this color? */
function hasVertexColor(geo: THREE.BufferGeometry, color: string): boolean {
  const c = new THREE.Color(color);
  const col = geo.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!col) return false;
  for (let i = 0; i < col.count; i++) {
    if (Math.abs(col.getX(i) - c.r) < 0.01 && Math.abs(col.getY(i) - c.g) < 0.01 && Math.abs(col.getZ(i) - c.b) < 0.01) return true;
  }
  return false;
}

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

  guard('raccoon belly clearance', () => {
    // Rays from the front at belly height must hit the cream patch first, clearly in front of
    // the fur (no z-fighting for any girth: tongkeun 1.17, hodadak 0.95, default 1).
    const ray = new THREE.Raycaster();
    const issues: string[] = [];
    let minGap = Infinity;
    for (const rival of [null, 'hodadak', 'tongkeun', 'nunchi'] as const) {
      const r = createRaccoon({ team: 0, look: { hat: 'none', rival } });
      r.update(0, idlePose(0));
      r.root.updateMatrixWorld(true);
      const body = r.root.getObjectByName('raccoon:body') as THREE.Mesh;
      const col = body.geometry.getAttribute('color') as THREE.BufferAttribute;
      const cream = new THREE.Color(PAL.cream);
      const isCream = (i: number): boolean => Math.abs(col.getX(i) - cream.r) < 0.01 && Math.abs(col.getY(i) - cream.g) < 0.01;
      for (const y of [0.3, 0.37, 0.44]) {
        for (const z of [-0.07, 0, 0.07]) {
          ray.set(new THREE.Vector3(2, y, z), new THREE.Vector3(-1, 0, 0));
          const hits = ray.intersectObject(body, false);
          if (!hits.length || !hits[0].face) continue;
          if (rival === 'hodadak' && y > 0.28 && y < 0.46 && Math.abs(z) < 0.09) continue; // racing bib
          if (rival === 'tongkeun' && y > 0.4) continue; // medallion / chain
          if (!isCream(hits[0].face.a)) {
            issues.push(`${rival ?? 'default'} y${y} z${z}: first hit not cream`);
            continue;
          }
          const fur = hits.find((h) => h.face && !isCream(h.face.a));
          if (fur) minGap = Math.min(minGap, fur.distance - hits[0].distance);
        }
      }
      r.dispose();
    }
    if (minGap < 0.015) issues.push(`belly only ${minGap.toFixed(3)} m proud of the fur`);
    check('raccoon belly clearance', issues.length === 0, issues.join('; ') || `belly >= ${minGap.toFixed(3)} m in front of the fur`);
  });

  guard('team emblem on every hat', () => {
    // doc §13: head decoration shape + team emblem, never color alone. Every hat shows the
    // wearer's team color AND a team-specific shape (the head geometries of the two teams
    // differ in structure, not just in color).
    const hats: HatId[] = ['none', 'teamCapA', 'teamCapB', 'hodadakBand', 'tongkeunHat', 'nunchiMask'];
    const issues: string[] = [];
    for (const hat of hats) {
      const heads = ([0, 1] as TeamId[]).map((team) => {
        const r = createRaccoon({ team, look: { hat } });
        const head = (r.root.getObjectByName('raccoon:head') as THREE.Mesh).geometry;
        const info = { verts: head.getAttribute('position').count, team: hasVertexColor(head, TEAM_STYLES[team].color) };
        r.dispose();
        return info;
      });
      if (!heads[0].team || !heads[1].team) issues.push(`${hat}: team color missing on the head`);
      if (heads[0].verts === heads[1].verts) issues.push(`${hat}: same head shape for both teams`);
    }
    check('team emblem on every hat', issues.length === 0, issues.join('; ') || `${hats.length} hats x 2 teams`);
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
      // The whole visual footprint (dial, wheel, handles, rings) stays inside the collider.
      const okX = box.max.x <= spec.half.x + 0.01 && box.min.x >= -spec.half.x - 0.01 && size.x > spec.half.x * 2 - 0.12;
      const okZ = box.max.z <= spec.half.y + 0.01 && box.min.z >= -spec.half.y - 0.01 && size.z > spec.half.y * 2 - 0.12;
      const okY = Math.abs(box.max.y - spec.height) < 0.06;
      const anchors = s.root.getObjectByName(`${kind}:anchors`)!;
      const anchoredVisible = anchors.visible;
      s.setAnchored(false);
      check(
        `safe ${kind}`,
        okX && okZ && okY && anchoredVisible && !anchors.visible,
        `visual ${size.x.toFixed(3)} x ${size.z.toFixed(3)} (x ${box.min.x.toFixed(3)}..${box.max.x.toFixed(3)}, z ${box.min.z.toFixed(3)}..${box.max.z.toFixed(3)}) vs collider ${spec.half.x * 2} x ${spec.half.y * 2}, h ${box.max.y.toFixed(2)}`,
      );
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
      // Up to raccoon head height the walls hug their colliders; above it the interior is
      // dressed with wall-mounted things (planters, CCTV, niches, the counter ledge) that may
      // reach into the room but never down to where raccoons walk.
      const low = overshoot(mesh, w, 1.12);
      const high = overshoot(mesh, w, 99);
      if (low > 0.13) problems.push(`wall ${i}: exceeds collider by ${low.toFixed(3)} below 1.12 m`);
      if (high > 0.66) problems.push(`wall ${i}: exceeds collider by ${high.toFixed(3)} overall`);
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

  guard('camera-facing labels', () => {
    // Results / title shots may look from any yaw: the safe coin and the bank sign turn so
    // the number / sign read upright for the CURRENT camera.
    const cam = new THREE.PerspectiveCamera(38, 1.6, 0.5, 200);
    const issues: string[] = [];
    const expect: [string, THREE.Vector3, number][] = [
      ['north-looking', new THREE.Vector3(0, 20, 15), 0],
      ['west-looking', new THREE.Vector3(15, 20, 0), Math.PI / 2],
      ['south-looking', new THREE.Vector3(0, 20, -15), Math.PI],
    ];
    for (const [name, pos, want] of expect) {
      cam.position.copy(pos);
      cam.lookAt(0, 0, 0);
      setViewCamera(cam);
      const yaw = cameraFacingYaw();
      const d = Math.atan2(Math.sin(yaw - want), Math.cos(yaw - want));
      if (Math.abs(d) > 0.02) issues.push(`${name}: yaw ${yaw.toFixed(2)} want ${want.toFixed(2)}`);
      const s = createSafe('largeSafe');
      s.root.rotation.y = 0.7;
      s.root.updateMatrixWorld(true);
      s.update(1 / 60);
      const coin = s.root.getObjectByName('largeSafe:coin')!;
      coin.updateWorldMatrix(true, false);
      const e = new THREE.Euler().setFromQuaternion(coin.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
      const dc = Math.atan2(Math.sin(e.y - want), Math.cos(e.y - want));
      if (Math.abs(dc) > 0.03) issues.push(`${name}: coin world yaw ${e.y.toFixed(2)}`);
      s.dispose();
    }
    setViewCamera(null);
    check('camera-facing labels', issues.length === 0, issues.join('; ') || 'coin + sign follow the camera yaw');
  });

  guard('bank roots compact', () => {
    // Raccoons grab the walls from ~0.55 m: the anchored roots / pipes / cables must stay
    // low and close to the slab so they never pass through them.
    const bank = createBank();
    bank.root.updateMatrixWorld(true);
    const roots = bank.root.getObjectByName('bank:rootsAttached') as THREE.Mesh;
    const hx = BANK_MODEL.half.x;
    const hz = BANK_MODEL.half.y;
    // Raised parts only (flat dirt patches / soil seam decals lie on the ground).
    const pos = roots.geometry.getAttribute('position') as THREE.BufferAttribute;
    let reach = 0;
    let sideReach = 0;
    let maxY = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      maxY = Math.max(maxY, y);
      if (y < 0.03) continue;
      const out = Math.max(Math.abs(x) - hx, Math.abs(z) - hz);
      reach = Math.max(reach, out);
      // Along the walls (away from the corners) the reach must be even smaller.
      const nearCorner = Math.abs(x) > hx - 0.9 && Math.abs(z) > hz - 0.9;
      if (!nearCorner) sideReach = Math.max(sideReach, out);
    }
    bank.dispose();
    // Raccoons stand ~0.55 m out: along the walls only the root tips diving into the ground
    // reach under their toes; corner flares stay within ~0.7 m.
    check('bank roots compact', reach < 0.75 && sideReach < 0.6 && maxY < 0.2, `raised parts reach ${reach.toFixed(2)} m (sides ${sideReach.toFixed(2)} m) past the footprint, top ${maxY.toFixed(2)} m`);
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

  // --- scenery budget + localized signs for every layout -------------------------------------------
  if (layouts) {
    const viewEn = (k: string): string => LAYOUT_STRINGS.en[k] ?? LAYOUT_STRINGS.ko[k] ?? k;
    const viewKo = (k: string): string => LAYOUT_STRINGS.ko[k] ?? k;
    for (const [id, layout] of Object.entries(layouts)) {
      guard(`scenery ${id}`, () => {
        const t0 = performance.now();
        const sc = buildStaticScenery(layout, viewEn);
        const ms = performance.now() - t0;
        // English view resolver: no Korean left on any sign (kiosks, unnamed shops, backdrop).
        const korean = sc.signTexts().filter((t) => HANGUL.test(t));
        sc.setSignResolver(viewKo);
        const english = sc.signTexts().filter((t) => !HANGUL.test(t));
        let resolved = 0;
        sc.setSignResolver((k) => {
          resolved++;
          return `EN ${k}`;
        });
        const custom = sc.signTexts().filter((t) => !t.startsWith('EN '));
        const ok = sc.stats.drawCalls < 150 && resolved > 0 && korean.length === 0 && english.length === 0 && custom.length === 0;
        check(
          `scenery ${id}`,
          ok,
          `${sc.stats.drawCalls} meshes (${sc.stats.shadowCasters} shadow casters), ${sc.stats.triangles.toLocaleString()} tris, ${sc.stats.chunks} chunks, ${sc.stats.fadeGroups} fade groups, ${ms.toFixed(0)} ms` +
            (korean.length ? `; KO left in EN: ${korean.join(', ')}` : '') +
            (english.length ? `; EN left in KO: ${english.join(', ')}` : '') +
            (custom.length ? `; resolver ignored: ${custom.join(', ')}` : ''),
        );
        sc.dispose();
      });
    }

    // Whole-building occlusion fade: a building between the camera and the focus fades as a
    // whole (fade texture = 1) and its chunk's ghost twins show; clearing the focus restores.
    const layout = layouts.shortcut ?? Object.values(layouts)[0];
    if (layout) {
      try {
        const sc = buildStaticScenery(layout);
        sc.updateMatrixWorld(true);
        const tall = layout.statics.filter((d) => d.kind === 'building' && d.height >= 5);
        // Put the focus just north of a tall building, the camera south of it (match camera).
        const bld = tall.sort((a, b) => b.center.y - a.center.y)[0];
        let detail = 'no tall building';
        let ok = false;
        if (bld) {
          const ext = Math.abs(Math.cos(bld.angle)) * bld.half.y + Math.abs(Math.sin(bld.angle)) * bld.half.x;
          const target = new THREE.Vector3(bld.center.x, 0.6, bld.center.y - ext - 1.2);
          const cam = new THREE.Vector3(target.x, Math.sin(0.96) * 24, target.z + Math.cos(0.96) * 24);
          for (let i = 0; i < 16; i++) {
            setOcclusionFocus(cam, target);
            await sleep(40);
          }
          const on = sc.occlusionState();
          const data = fadeTexture().image.data as Uint8Array;
          let maxFade = 0;
          for (let i = 1; i < 256; i++) maxFade = Math.max(maxFade, data[i * 4]);
          for (let i = 0; i < 40; i++) {
            setOcclusionFocus(null, null);
            await sleep(40);
          }
          const off = sc.occlusionState();
          ok = on.faded >= 1 && maxFade === 255 && on.ghostsVisible > 0 && off.faded === 0 && off.fading === 0 && off.ghostsVisible === 0;
          detail = `focus behind ${bld.id}: ${on.faded}/${on.groups} groups faded, ${on.ghostsVisible} ghost meshes on; cleared: ${off.faded + off.fading} faded, ${off.ghostsVisible} ghosts`;
        }
        sc.dispose();
        check('occlusion fade', ok, detail);
      } catch (e) {
        check('occlusion fade', false, String((e as Error)?.stack ?? e));
      }
    }
  }
  return out;
}
