/**
 * Props and breakables (C7a, content-plan §5.1): the per-frame and per-event presentation of
 * the 동전 ATM, 대왕 돼지저금통, 돈나무, 황금 금고 (their rigs are created by the GameView's safe
 * pipeline from models/props.ts, so interpolation, uproot strain / pop, highlights and recovery
 * flights already work) and the breakables (나무 상자, 꿀꺽 자판기), which this sync owns.
 *
 *  - Contents: the ATM hopper stack / tree bills / value coin follow `innerValue` and
 *    `estimatedValue`; piggy crack decals follow `cracks` (3 = broken bowl).
 *  - Hits: 'propHit' wobbles the prop away from the hitter; an ATM spurt flashes "짤랑!" on its
 *    screen and extends the receipt (40 ms hit-stop near the focus, ART §2 / content-plan C7); a
 *    tree shed flutters bills off. 'piggyCrack' adds a crack with pink chips; the smash shatters
 *    it with "잭팟!" and a 120 ms hit-stop.
 *  - Dormant loot (event / gondola safes before they appear) is hidden; airborne loot rides its
 *    flight arc above the ground (catapult / tube / crane / parachute, from `airborne`).
 *  - Smashed piggy: the sim removes the shell (`recovered`) on the smashing tick and the GameView
 *    then stops drawing that loot, so this sync keeps the broken bowl on the spot for a beat
 *    (SHELL.hold s, wobbling from the smash) and then sinks / shrinks it away (SHELL.fade s).
 *  - Breakables: rigs placed from `state.breakables`; hits wobble them (vending: cracked glass +
 *    flickering sign per lost HP); breaking bursts planks / panels / cans.
 */
import * as THREE from 'three';
import type { BreakableState, EntityId, LootState, SimEvent, SimState } from '../sim';
import type { ViewExtra, ViewExtrasHost } from './extras';
import { createBreakableRig, type BreakableRig, type PropRig } from './models/props';
import { placeOnSim } from './models';
import { PAL } from './models/palette';

/** Smashed piggy shell: how long the broken bowl stays, then how long it takes to sink away (s). */
export const SHELL = { hold: 1.6, fade: 0.5 } as const;

interface ShellView {
  id: EntityId;
  rig: PropRig;
  age: number;
  /** Rig scale / height when the hold started (restored on dispose). */
  sx: number;
  sy: number;
  sz: number;
  y: number;
}

interface BreakableView {
  id: string;
  rig: BreakableRig;
  hp: number;
  broken: boolean;
}

function isPropRig(r: unknown): r is PropRig {
  return !!r && typeof (r as PropRig).setContents === 'function';
}

export class PropsSync implements ViewExtra {
  private readonly host: ViewExtrasHost;
  private readonly root = new THREE.Group();
  private readonly breakables = new Map<string, BreakableView>();
  private readonly cracks = new Map<EntityId, number>();
  /** Last prop rig seen per loot id (the GameView stops lending it once the loot is recovered). */
  private readonly rigs = new Map<EntityId, PropRig>();
  /** Smashed piggy shells being held on screen (few; plain array, swap-removed). */
  private readonly shells: ShellView[] = [];
  private readonly shelled = new Set<EntityId>();
  private nextGlint = 0;

  constructor(host: ViewExtrasHost) {
    this.host = host;
    this.root.name = 'props';
    host.world.add(this.root);
  }

  private dirFrom(byCharId: EntityId | null, to: { x: number; y: number }): number | null {
    if (byCharId === null) return null;
    const p = this.host.charPose(byCharId);
    if (!p) return null;
    const dx = to.x - p.x;
    const dy = to.y - p.y;
    return Math.hypot(dx, dy) > 1e-3 ? Math.atan2(dy, dx) : null;
  }

  onEvents(events: readonly SimEvent[]): void {
    const h = this.host;
    const focus = h.focusId();
    for (const e of events) {
      switch (e.type) {
        case 'propHit': {
          const rig = h.lootRig(e.lootId);
          const pose = h.lootPose(e.lootId);
          if (!isPropRig(rig) || !pose) break;
          const dir = this.dirFrom(e.byCharId, pose);
          const strength = e.how === 'hammer' ? 1.2 : e.how === 'impact' ? 0.6 : 0.9;
          rig.hit(dir, strength);
          if (rig.variant === 'atm' && e.coins > 0) {
            rig.spurt(e.coins);
            if (e.byCharId === focus || h.nearFocus(pose, 4) > 0.5) h.hitstop(0.04);
          } else if (rig.variant === 'moneyTree' && e.coins > 0) {
            rig.spurt(Math.max(1, Math.round(e.coins)));
            h.effects.fx.sparkle({ x: pose.x, y: 1.6, z: pose.y }, { count: 6, radius: 1, color: '#DDF4CB' });
          }
          if (e.how === 'dash' || e.how === 'hammer') h.effects.fx.stars({ x: pose.x, y: 0.5, z: pose.y }, { count: 3, size: 0.12 });
          break;
        }
        case 'piggyCrack': {
          const rig = h.lootRig(e.lootId);
          const pose = h.lootPose(e.lootId);
          if (!pose) break;
          const dir = this.dirFrom(e.byCharId, pose);
          const pr = isPropRig(rig) ? rig : this.rigs.get(e.lootId);
          if (pr) {
            pr.hit(dir, e.smashed ? 1.6 : 1);
            pr.setCracks(Math.min(3, e.cracks));
          }
          this.cracks.set(e.lootId, e.cracks);
          if (e.smashed) {
            if (pr) this.holdShell(e.lootId, pr);
            h.effects.piggyShatter(pose);
            h.effects.stamp('jackpot', pose, { y: 2.4, scale: 1.1 });
            h.hitstop(e.byCharId === focus || h.nearFocus(pose, 10) > 0.3 ? 0.12 : 0);
            h.shake(pose, 0.5, 22);
            h.impact(pose, 0.9, 0.5);
            h.scare(pose, 10);
          } else {
            h.effects.fx.chunks({ x: pose.x, y: 0.8, z: pose.y }, { count: 5, colors: ['#FF9EC0', '#E8739A', '#FFFFFF'], size: 0.06, power: 0.9 });
            h.effects.fx.stars({ x: pose.x, y: 0.7, z: pose.y }, { count: 3, size: 0.13 });
          }
          break;
        }
        case 'coinSpawn': {
          if (e.source !== 'spurt' || typeof e.sourceId !== 'number') break;
          // ATM tug spurt (coins shoot out while someone strains on it).
          const rig = h.lootRig(e.sourceId);
          const pose = h.lootPose(e.sourceId);
          if (isPropRig(rig)) rig.spurt(e.ids.length);
          if (pose && (e.byCharId === focus || h.nearFocus(pose, 4) > 0.5)) h.hitstop(0.04);
          break;
        }
        case 'breakableHit': {
          const bv = this.breakables.get(e.id);
          if (!bv) break;
          const p = { x: bv.rig.root.position.x, y: bv.rig.root.position.z };
          bv.rig.hit(this.dirFrom(e.byCharId, p));
          bv.rig.setHp(e.hp);
          bv.hp = e.hp;
          h.effects.fx.stars({ x: p.x, y: 0.4, z: p.y }, { count: 3, size: 0.12 });
          h.effects.fx.chunks({ x: p.x, y: 0.5, z: p.y }, { count: 3, colors: bv.rig.kind === 'crate' ? [PAL.wood, PAL.woodLight] : ['#4FC3A1', '#E8FAFF'], size: 0.05, power: 0.7 });
          break;
        }
        case 'breakableBroken': {
          const bv = this.breakables.get(e.id);
          if (!bv || bv.broken) break;
          this.breakApart(bv, e.byCharId);
          break;
        }
        default:
          break;
      }
    }
  }

  private breakApart(bv: BreakableView, byCharId: EntityId | null): void {
    const h = this.host;
    const p = { x: bv.rig.root.position.x, y: bv.rig.root.position.z };
    const pieces = bv.rig.breakApart(this.dirFrom(byCharId, p));
    h.effects.splinters(p, pieces, bv.rig.kind);
    h.shake(p, bv.rig.kind === 'vending' ? 0.3 : 0.15, 14);
    h.scare(p, 6);
    bv.broken = true;
  }

  /** Keep a smashed piggy's broken bowl on screen for a beat (the view hides recovered loot). */
  private holdShell(id: EntityId, rig: PropRig): void {
    if (this.shelled.has(id)) return;
    this.shelled.add(id);
    rig.setCracks(3);
    const r = rig.root;
    this.shells.push({ id, rig, age: 0, sx: r.scale.x, sy: r.scale.y, sz: r.scale.z, y: r.position.y });
  }

  private syncShells(dt: number): void {
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i]!;
      s.age += dt;
      const r = s.rig.root;
      if (s.age >= SHELL.hold + SHELL.fade || !r.parent) {
        r.visible = false;
        r.scale.set(s.sx, s.sy, s.sz);
        r.position.y = s.y;
        this.shells[i] = this.shells[this.shells.length - 1]!;
        this.shells.pop();
        continue;
      }
      // The GameView no longer poses / updates recovered loot: we drive the bowl here.
      r.visible = true;
      s.rig.setStrain(0);
      s.rig.update(dt);
      const k = s.age <= SHELL.hold ? 0 : (s.age - SHELL.hold) / SHELL.fade;
      const e = k * k;
      const sc = Math.max(0.001, 1 - e);
      r.scale.set(s.sx * sc, s.sy * sc * (1 - 0.3 * e), s.sz * sc);
      r.position.y = s.y - 0.35 * e;
    }
  }

  sync(state: SimState, alpha: number, dt: number): void {
    const h = this.host;
    const now = h.time();
    // --- loot props ----------------------------------------------------------------------
    const loot = state.loot;
    for (let i = 0; i < loot.length; i++) {
      const l = loot[i]!;
      if (l.variant === null || l.variant === undefined) continue;
      if (l.recovered) {
        // Smashed piggy without its event in this batch (e.g. a resync): still hold the bowl.
        if (l.variant === 'piggy' && l.recoveredBy === null && (l.cracks ?? 0) >= 3 && !this.shelled.has(l.id)) {
          const pr = this.rigs.get(l.id);
          if (pr) this.holdShell(l.id, pr);
        }
        continue;
      }
      const rig = h.lootRig(l.id);
      if (!isPropRig(rig)) continue;
      if (this.rigs.get(l.id) !== rig) this.rigs.set(l.id, rig);
      this.syncProp(l, rig, state, alpha, now, dt);
    }
    this.syncShells(dt);
    // --- breakables ------------------------------------------------------------------------
    const bs = state.breakables;
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i]!;
      let bv = this.breakables.get(b.id);
      if (!bv) bv = this.createBreakable(b);
      if (b.broken && !bv.broken) this.breakApart(bv, null);
      if (!bv.broken && b.hp !== bv.hp) {
        bv.hp = b.hp;
        bv.rig.setHp(b.hp);
      }
      if (!bv.broken) bv.rig.update(dt);
    }
  }

  private syncProp(l: LootState, rig: PropRig, state: SimState, alpha: number, now: number, dt: number): void {
    const h = this.host;
    rig.setContents(l.innerValue ?? 0, l.estimatedValue);
    if (l.variant === 'piggy') {
      const c = l.cracks ?? 0;
      if (this.cracks.get(l.id) !== c) {
        this.cracks.set(l.id, c);
        rig.setCracks(Math.min(3, c));
      }
    }
    rig.setMotion(l.vel.x, l.vel.y);
    // Dormant: not on the field yet.
    rig.root.visible = !l.dormant;
    // Airborne: ride the flight arc (height from the fixed flight, the ground track from the sim).
    const air = l.airborne;
    if (air) {
      const t = state.tick - 1 + Math.min(1, Math.max(0, alpha));
      const span = Math.max(1, air.toTick - air.fromTick);
      const k = Math.min(1, Math.max(0, (t - air.fromTick) / span));
      const dist = Math.hypot(air.to.x - air.from.x, air.to.y - air.from.y);
      const peak = air.via === 'parachute' ? 0 : air.via === 'tube' ? 0.6 : Math.max(2.5, dist * 0.35);
      const y = air.via === 'parachute' ? 12 * (1 - k) : peak * 4 * k * (1 - k);
      rig.root.position.y += y;
      rig.root.rotation.z = air.via === 'catapult' ? Math.sin(k * Math.PI * 2) * 0.4 : 0;
    } else if (rig.root.rotation.z !== 0) rig.root.rotation.z = 0;
    // Golden safe glints (it is the 400 everyone races for).
    if (l.variant === 'goldSafe' && !l.dormant && dt > 0 && now >= this.nextGlint && !h.reducedMotion()) {
      this.nextGlint = now + 0.35;
      const p = h.lootPose(l.id);
      if (p) h.effects.fx.sparkle({ x: p.x, y: p.h + 0.6, z: p.y }, { count: 2, radius: 0.8, color: PAL.goldLight });
    }
  }

  private createBreakable(b: BreakableState): BreakableView {
    const rig = createBreakableRig(b.kind, this.host.language());
    placeOnSim(rig.root, b.center, b.angle);
    this.root.add(rig.root);
    const bv: BreakableView = { id: b.id, rig, hp: b.hp, broken: false };
    rig.setHp(b.hp);
    if (b.broken) {
      rig.root.visible = false;
      bv.broken = true;
    }
    this.breakables.set(b.id, bv);
    return bv;
  }

  dispose(): void {
    for (const bv of this.breakables.values()) bv.rig.dispose();
    this.breakables.clear();
    this.cracks.clear();
    for (const s of this.shells) {
      s.rig.root.scale.set(s.sx, s.sy, s.sz);
      s.rig.root.position.y = s.y;
    }
    this.shells.length = 0;
    this.shelled.clear();
    this.rigs.clear();
    this.root.removeFromParent();
  }
}
