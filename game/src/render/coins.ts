/**
 * Coins (C7a, content-plan §3.3 / §5.1): loose piles, coin bags on the raccoons' backs, pickups,
 * deposits (쏟아붓기) and spills (와르르). Pure view of `state.coins`, `CharacterState.bag /
 * depositTicks` and the coin events.
 *
 *  - Piles: one instance per pile — 동전 10 = three paw-embossed coins (our own coin design,
 *    ART §3), 지폐 다발 50 = a banded stack of the game's banknotes. Interpolated between ticks;
 *    a fresh pile hops out of its source (fan / radial / spill from bag height, falls from the
 *    sky for 돈비) and lands with a squash. A soft gold glow under each pile and an occasional
 *    glint keep them readable at the game camera.
 *  - Pickup: the pile pops and one coin climbs into the taker's bag with a sparkle that grows with
 *    consecutive pickups (the audio climbs a scale step per pile, C9).
 *  - Bag: a burlap sack on the back, scaled by its value (empty = hidden), coins peeking out from
 *    100; it squashes on every pickup, shakes and tilts while depositing, and pours a coin arc to
 *    the van on 'coinsBanked'. A spill squashes it and stamps "와르르!".
 *
 * No allocation per frame in steady state: instanced meshes with fixed capacity (grown only if a
 * match ever exceeds it), pooled pile records.
 */
import * as THREE from 'three';
import type { CharacterState, CoinPile, CoinSpawnSource, EntityId, SimEvent, SimState, TeamId } from '../sim';
import { COINS } from '../sim';
import { TEAM_STYLES } from '../shared/teams';
import type { ViewExtra, ViewExtrasHost } from './extras';
import { billBundleGeometry, billTopGeometry, billTopMaterial, coinPileGeometry, pawCoinGeometry } from './models/props';
import { G, PartBuilder, lathe } from './models/geometry';
import { matGlow, matVC } from './models/materials';
import { radialGlowTexture } from './models/textures';
import { cameraFacingYaw } from './models/occlusion';
import { PAL } from './models/palette';
import { damp } from './sync';

interface PileRec {
  id: EntityId;
  value: 10 | 50;
  px: number;
  py: number;
  cx: number;
  cy: number;
  tick: number;
  /** View time first seen. */
  born: number;
  /** Hop style from its spawn source. */
  hop: 0 | 1 | 2 | 3;
  yaw: number;
  /** Last interpolated pose (for pickup FX after the pile is gone). */
  x: number;
  y: number;
  seen: boolean;
}

interface BagView {
  charId: EntityId;
  team: TeamId;
  root: THREE.Group;
  sack: THREE.Mesh;
  peek: THREE.Mesh;
  value: number;
  scale: number;
  pulse: number;
  pour: number;
  climbStep: number;
  lastPickup: number;
  depositing: boolean;
}

const HOP = { none: 0, fan: 1, spill: 2, rain: 3 } as const;
const HOP_TIME = [0, 0.5, 0.45, 0.85] as const;
const HOP_HEIGHT = [0, 0.95, 0.75, 8] as const;
const BAG_FULL = COINS.bagCap;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

function hopFor(source: CoinSpawnSource): 0 | 1 | 2 | 3 {
  if (source === 'rain') return HOP.rain;
  if (source === 'spill') return HOP.spill;
  return HOP.fan;
}

let sackGeo: THREE.BufferGeometry | null = null;
/** Burlap sack (origin at its bottom, hanging on the back: local -x away from the body). */
function sackGeometry(): THREE.BufferGeometry {
  if (sackGeo) return sackGeo;
  const b = new PartBuilder();
  const body = lathe(
    [
      [0.0, 0.0],
      [0.13, 0.02],
      [0.19, 0.1],
      [0.2, 0.2],
      [0.16, 0.29],
      [0.08, 0.34],
      [0.07, 0.36],
    ],
    16,
  );
  b.add(body, { color: '#E9D3A6', pos: [-0.06, 0, 0], scale: [1, 1, 1.1] });
  body.dispose();
  // Drawstring tie + ruffled neck.
  b.add(G.torus(0.3, 6, 16), { color: '#8C5E3B', pos: [-0.06, 0.345, 0], rot: [Math.PI / 2, 0, 0], scale: [0.075, 0.075, 0.06] });
  b.add(G.cone(10), { color: '#DCC292', pos: [-0.06, 0.4, 0], scale: [0.1, 0.09, 0.1] });
  // Patch + gold paw coin stamp on the outer side (reads as "money bag" from above).
  b.add(G.cyl(1, 1, 18), { color: '#F6C64F', pos: [-0.25, 0.17, 0], rot: [0, 0, Math.PI / 2], scale: [0.085, 0.02, 0.085], emissive: 0.2 });
  b.add(G.sphere(8, 6), { color: '#C88F25', pos: [-0.262, 0.155, 0], scale: [0.006, 0.03, 0.026] });
  for (const dz of [-0.03, -0.01, 0.01, 0.03]) b.add(G.sphere(6, 4), { color: '#C88F25', pos: [-0.262, 0.19 + (Math.abs(dz) < 0.02 ? 0.01 : 0), dz], scale: [0.005, 0.011, 0.011] });
  // Stitches.
  for (let i = 0; i < 5; i++) b.add(G.box(), { color: '#B89566', pos: [-0.06 + Math.cos(i * 1.3) * 0.2, 0.2, Math.sin(i * 1.3) * 0.21], rot: [0, -i * 1.3, 0.6], scale: [0.005, 0.04, 0.012] });
  sackGeo = b.merge('vc')!;
  return sackGeo;
}

let peekGeo: THREE.BufferGeometry | null = null;
/** Coins peeking out of a full sack. */
function peekGeometry(): THREE.BufferGeometry {
  if (peekGeo) return peekGeo;
  const b = new PartBuilder();
  for (let i = 0; i < 3; i++) {
    b.push([-0.06 + (i - 1) * 0.05, 0.4 + (i % 2) * 0.03, (i - 1) * 0.03], [Math.PI / 2 - 0.4 + i * 0.4, 0, (i - 1) * 0.4]);
    b.addPrepared(pawCoinGeometry(), { scale: 0.6 });
    b.pop();
  }
  peekGeo = b.merge('vc')!;
  return peekGeo;
}

export class CoinsSync implements ViewExtra {
  private readonly host: ViewExtrasHost;
  private readonly root = new THREE.Group();
  private coinMesh: THREE.InstancedMesh;
  private billMesh: THREE.InstancedMesh;
  private billTop: THREE.InstancedMesh;
  private glow: THREE.InstancedMesh;
  private readonly glowGeo: THREE.BufferGeometry;
  private readonly piles = new Map<EntityId, PileRec>();
  private readonly pool: PileRec[] = [];
  private readonly spawnSource = new Map<EntityId, CoinSpawnSource>();
  /** coinId -> taker (pickup FX when the pile disappears). */
  private readonly pickedBy = new Map<EntityId, EntityId>();
  private readonly bags = new Map<EntityId, BagView>();
  private lastTick = -1;
  private nextGlint = 0;
  private glintCursor = 0;

  constructor(host: ViewExtrasHost) {
    this.host = host;
    this.root.name = 'coins';
    host.world.add(this.root);
    this.glowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    // A vertex color for the glow (matGlow uses vertex colors x the radial map).
    const n = this.glowGeo.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    const c = new THREE.Color(PAL.goldLight).multiplyScalar(0.55);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    this.glowGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.coinMesh = this.makeMesh(coinPileGeometry(), matVC(), 128, 'coinPiles', true);
    this.billMesh = this.makeMesh(billBundleGeometry(), matVC(), 48, 'billPiles', true);
    this.billTop = this.makeMesh(billTopGeometry(), billTopMaterial(), 48, 'billTops', false);
    this.glow = this.makeMesh(this.glowGeo, matGlow(radialGlowTexture()), 176, 'coinGlow', false);
    this.glow.renderOrder = -1;
    host.effects.coinSpray.onArrive = (x, y, z, step) => {
      if (step < 0) return;
      const k = Math.min(1, step / 8);
      this.host.effects.fx.sparkle({ x, y: y - 0.3, z }, { count: 2 + Math.round(4 * k), radius: 0.25 + 0.2 * k, color: k > 0.6 ? '#FFFFFF' : PAL.goldLight });
    };
  }

  private makeMesh(geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, name: string, shadow: boolean): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.name = name;
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = shadow;
    m.receiveShadow = shadow;
    m.userData.noOutline = true;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.root.add(m);
    return m;
  }

  private grow(mesh: THREE.InstancedMesh, need: number): THREE.InstancedMesh {
    if (need <= mesh.instanceMatrix.count) return mesh;
    const cap = Math.max(need, mesh.instanceMatrix.count * 2);
    const next = this.makeMesh(mesh.geometry, mesh.material as THREE.Material, cap, mesh.name, mesh.castShadow);
    next.renderOrder = mesh.renderOrder;
    mesh.removeFromParent();
    mesh.dispose();
    return next;
  }

  // ---------------------------------------------------------------------------

  onEvents(events: readonly SimEvent[]): void {
    const h = this.host;
    for (const e of events) {
      switch (e.type) {
        case 'coinSpawn': {
          for (const id of e.ids) this.spawnSource.set(id, e.source);
          // A little decorative glitter at the source (the piles themselves carry the value).
          if (e.source === 'smash' || e.source === 'truck') h.effects.coinFountain(e.pos, null, Math.ceil(e.ids.length / 2), 0.8, 1.2);
          else if (e.source !== 'rain') h.effects.fx.sparkle({ x: e.pos.x, y: 0.4, z: e.pos.y }, { count: Math.min(10, 3 + e.ids.length), radius: 0.5, color: PAL.goldLight });
          break;
        }
        case 'coinPickup':
          this.pickedBy.set(e.coinId, e.charId);
          break;
        case 'bagSpilled': {
          const bv = this.bags.get(e.charId);
          if (bv) bv.pulse = -0.5;
          const p = h.charPose(e.charId);
          if (p) h.effects.stamp('spill', p, { y: 2.0, scale: e.value >= 60 ? 1.25 : 1 });
          break;
        }
        case 'coinDepositStart': {
          const bv = this.bags.get(e.charId);
          if (bv) bv.depositing = true;
          break;
        }
        case 'coinDepositCancel': {
          const bv = this.bags.get(e.charId);
          if (bv) bv.depositing = false;
          break;
        }
        case 'coinsBanked': {
          const bv = this.bags.get(e.charId);
          const zone = h.sim.layout.zones.find((z) => z.team === e.team);
          const p = h.charPose(e.charId);
          if (bv) {
            bv.depositing = false;
            bv.pour = 1;
            if (zone) h.effects.coinPour(bv.root, zone.vanPos, Math.round(e.value / 10));
          }
          if (p) {
            h.effects.fx.ring({ x: p.x, y: p.h + 0.02, z: p.y }, { radius: 1.6 + Math.min(1.4, e.value / 120), color: TEAM_STYLES[e.team].color, duration: 0.5 });
            h.effects.fx.sparkle({ x: p.x, y: p.h + 0.4, z: p.y }, { count: 8 + Math.min(12, Math.round(e.value / 20)), radius: 0.7, color: PAL.goldLight });
          }
          h.pulse(e.charId, 0.12);
          break;
        }
        default:
          break;
      }
    }
  }

  // ---------------------------------------------------------------------------

  sync(state: SimState, alpha: number, dt: number): void {
    const h = this.host;
    const now = h.time();
    const tickChanged = state.tick !== this.lastTick;
    this.lastTick = state.tick;
    // --- piles: update records ------------------------------------------------------------
    this.piles.forEach(this.unseePile);
    let nCoins = 0;
    let nBills = 0;
    const coins = state.coins;
    for (let i = 0; i < coins.length; i++) {
      const c = coins[i]!;
      let r = this.piles.get(c.id);
      if (!r) r = this.addPile(c, now);
      else if (tickChanged && r.tick !== state.tick) {
        r.px = r.cx;
        r.py = r.cy;
        r.cx = c.pos.x;
        r.cy = c.pos.y;
        r.tick = state.tick;
        // Teleport (unstuck / nudge out of a static): snap.
        if (Math.abs(r.cx - r.px) + Math.abs(r.cy - r.py) > 2) {
          r.px = r.cx;
          r.py = r.cy;
        }
      }
      r.seen = true;
      if (c.value === 50) nBills++;
      else nCoins++;
    }
    // Gone piles: pickup climb or poof.
    this.sweepState = state;
    this.sweepNow = now;
    this.piles.forEach(this.sweepPile);
    this.sweepState = null;
    // --- piles: draw ---------------------------------------------------------------------
    if (nCoins > this.coinMesh.instanceMatrix.count) this.coinMesh = this.grow(this.coinMesh, nCoins);
    if (nBills > this.billMesh.instanceMatrix.count) {
      this.billMesh = this.grow(this.billMesh, nBills);
      this.billTop = this.grow(this.billTop, nBills);
    }
    if (nCoins + nBills > this.glow.instanceMatrix.count) this.glow = this.grow(this.glow, nCoins + nBills);
    let ic = 0;
    let ib = 0;
    let ig = 0;
    const k = Math.min(1, Math.max(0, alpha));
    const pulse = 1 + 0.08 * Math.sin(now * 3.2);
    for (let i = 0; i < coins.length; i++) {
      const c = coins[i]!;
      const r = this.piles.get(c.id)!;
      const x = r.px + (r.cx - r.px) * k;
      const y = r.py + (r.cy - r.py) * k;
      r.x = x;
      r.y = y;
      const age = now - r.born;
      const ht = HOP_TIME[r.hop];
      let yH = 0;
      let spin = 0;
      let sq = 1;
      if (age < ht) {
        const u = age / ht;
        if (r.hop === HOP.rain) {
          yH = HOP_HEIGHT[r.hop] * (1 - u) * (1 - u);
          spin = u * 6;
        } else {
          yH = HOP_HEIGHT[r.hop] * 4 * u * (1 - u) + (r.hop === HOP.spill ? 0.5 * (1 - u) : 0);
          spin = u * Math.PI * 2;
        }
      } else if (age < ht + 0.3) {
        const v = age - ht;
        sq = 1 - 0.25 * Math.exp(-v * 14) * Math.cos(v * 32);
      }
      // Bill bundles print a big "50": they rest at the camera-facing yaw so it reads upright
      // (coins carry no text and keep their random per-pile yaw).
      const restYaw = c.value === 50 ? cameraFacingYaw() : r.yaw;
      _e.set(spin * (c.value === 50 ? 0.35 : 1), restYaw + spin * 0.5, 0);
      _q.setFromEuler(_e);
      _p.set(x, yH, y);
      const grow = age < 0.08 ? 0.4 + 0.6 * (age / 0.08) : 1;
      _s.set(grow / Math.sqrt(sq), grow * sq, grow / Math.sqrt(sq));
      _m.compose(_p, _q, _s);
      if (c.value === 50) {
        this.billMesh.setMatrixAt(ib, _m);
        this.billTop.setMatrixAt(ib, _m);
        ib++;
      } else this.coinMesh.setMatrixAt(ic++, _m);
      // Ground glow (fades in after landing).
      const gk = age < ht ? 0 : Math.min(1, (age - ht) / 0.3);
      const gs = (c.value === 50 ? 1.15 : 0.95) * pulse * gk;
      _q.identity();
      _p.set(x, 0.015, y);
      _s.set(Math.max(0.001, gs), 1, Math.max(0.001, gs));
      _m.compose(_p, _q, _s);
      this.glow.setMatrixAt(ig++, _m);
    }
    this.coinMesh.count = ic;
    this.billMesh.count = ib;
    this.billTop.count = ib;
    this.glow.count = ig;
    if (ic) this.coinMesh.instanceMatrix.needsUpdate = true;
    if (ib) {
      this.billMesh.instanceMatrix.needsUpdate = true;
      this.billTop.instanceMatrix.needsUpdate = true;
    }
    if (ig) this.glow.instanceMatrix.needsUpdate = true;
    // Occasional glint on a resting pile (readability; one every ~0.6 s across the field).
    if (dt > 0 && state.coins.length && now >= this.nextGlint && !h.reducedMotion()) {
      this.nextGlint = now + 0.6;
      this.glintCursor = (this.glintCursor + 7) % state.coins.length;
      const r = this.piles.get(state.coins[this.glintCursor]!.id);
      if (r && now - r.born > 1) h.effects.fx.sparkle({ x: r.x, y: 0.05, z: r.y }, { count: 1, radius: 0.15, color: '#FFFFFF' });
    }

    // --- bags ------------------------------------------------------------------------------
    const chars = state.characters;
    for (let i = 0; i < chars.length; i++) this.syncBag(chars[i]!, state, dt);
  }

  // Pre-bound per-frame pile sweeps (Map.forEach: no iterator / entry garbage per frame).
  private sweepState: SimState | null = null;
  private sweepNow = 0;
  private readonly unseePile = (r: PileRec): void => {
    r.seen = false;
  };
  private readonly sweepPile = (r: PileRec): void => {
    if (r.seen) return;
    const taker = this.pickedBy.get(r.id);
    if (taker !== undefined) {
      const bv = this.sweepState ? this.bagFor(taker, this.sweepState) : null;
      if (bv) {
        const now = this.sweepNow;
        if (now - bv.lastPickup > 1.5) bv.climbStep = 0;
        bv.lastPickup = now;
        this.host.effects.coinClimb({ x: r.x, y: r.y }, bv.root, bv.climbStep++);
        bv.pulse = Math.max(bv.pulse, 0.6);
      }
      this.pickedBy.delete(r.id);
    } else this.host.effects.poof({ x: r.x, y: r.y }, 0.1, PAL.goldLight);
    this.piles.delete(r.id);
    this.spawnSource.delete(r.id);
    this.pool.push(r);
  };

  private addPile(c: CoinPile, now: number): PileRec {
    const r =
      this.pool.pop() ??
      ({ id: 0, value: 10, px: 0, py: 0, cx: 0, cy: 0, tick: 0, born: 0, hop: 0, yaw: 0, x: 0, y: 0, seen: false } as PileRec);
    const src = this.spawnSource.get(c.id);
    r.id = c.id;
    r.value = c.value;
    r.px = r.cx = r.x = c.pos.x;
    r.py = r.cy = r.y = c.pos.y;
    r.tick = this.host.sim.state.tick;
    // Piles already on the field at load (or without an event) appear in place.
    r.hop = src ? hopFor(src) : HOP.none;
    r.born = src ? now : now - 10;
    // Fixed yaw from the id (deterministic look, mirrored piles do not look cloned).
    r.yaw = ((c.id * 2654435761) % 6283) / 1000;
    r.seen = true;
    this.piles.set(c.id, r);
    return r;
  }

  private bagFor(charId: EntityId, state: SimState): BagView | null {
    let bv = this.bags.get(charId);
    if (bv) return bv;
    const rig = this.host.charRig(charId);
    const c = state.characters.find((x) => x.id === charId);
    if (!rig || !c) return null;
    const root = new THREE.Group();
    root.name = `bag:${charId}`;
    const sack = new THREE.Mesh(sackGeometry(), matVC());
    sack.castShadow = true;
    sack.name = 'bag:sack';
    const peek = new THREE.Mesh(peekGeometry(), matVC());
    peek.name = 'bag:peek';
    peek.visible = false;
    root.add(sack, peek);
    root.scale.setScalar(0.001);
    root.visible = false;
    // Slung high on the back so the neck peeks over the shoulders (clear of the tail).
    root.position.set(-0.06, -0.06, 0);
    rig.attach.back.add(root);
    bv = { charId, team: c.team, root, sack, peek, value: 0, scale: 0, pulse: 0, pour: 0, climbStep: 0, lastPickup: -9, depositing: false };
    this.bags.set(charId, bv);
    return bv;
  }

  private syncBag(c: CharacterState, state: SimState, dt: number): void {
    const bag = c.bag ?? 0;
    let bv: BagView | null = this.bags.get(c.id) ?? null;
    if (!bv) {
      if (bag <= 0) return;
      bv = this.bagFor(c.id, state);
      if (!bv) return;
    }
    if (bag > bv.value) bv.pulse = Math.max(bv.pulse, 0.5);
    bv.value = bag;
    const target = bag > 0 ? 0.62 + 0.62 * Math.sqrt(Math.min(1, bag / BAG_FULL)) : 0;
    // During a pour the sack keeps its size until the coins are out, then shrinks.
    const pouring = bv.pour > 0;
    bv.scale += (target - bv.scale) * damp(pouring ? 6 : 12, dt);
    if (Math.abs(target - bv.scale) < 0.002) bv.scale = target;
    bv.pulse = bv.pulse > 0 ? Math.max(0, bv.pulse - dt * 4) : Math.min(0, bv.pulse + dt * 3);
    bv.pour = Math.max(0, bv.pour - dt * 2.2);
    const s = bv.scale;
    bv.root.visible = s > 0.02;
    if (!bv.root.visible) return;
    const t = this.host.time();
    const p = bv.pulse;
    const sq = 1 + 0.25 * p * Math.sin((1 - Math.abs(p)) * Math.PI * 3);
    bv.root.scale.set(s / Math.sqrt(sq), s * sq, s / Math.sqrt(sq));
    bv.peek.visible = bag >= 100;
    // Deposit: shake + tilt the sack open toward the ground; pour: tip it over.
    const depositK = (c.depositTicks ?? 0) / COINS.depositTicks;
    const shake = bv.depositing || depositK > 0 ? 0.12 * Math.sin(t * 38) * Math.max(0.3, depositK) : 0;
    bv.root.rotation.set(shake, 0, -(depositK * 0.6 + bv.pour * 1.2) + Math.sin(t * 5) * 0.04);
  }

  dispose(): void {
    if (this.host.effects.coinSpray.onArrive) this.host.effects.coinSpray.onArrive = null;
    for (const bv of this.bags.values()) bv.root.removeFromParent();
    this.bags.clear();
    this.piles.clear();
    this.pool.length = 0;
    this.spawnSource.clear();
    this.pickedBy.clear();
    for (const m of [this.coinMesh, this.billMesh, this.billTop, this.glow]) m.dispose();
    this.glowGeo.dispose();
    this.root.removeFromParent();
  }
}
