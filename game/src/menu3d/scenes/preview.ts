/**
 * Layout preview: a 3D miniature of the REAL level on a slowly swinging turntable (replaces the
 * old 2D paper map). Same information for both sides (doc §9):
 *   - statics as chunky toy blocks, trees / lamps / fountains, bank-breakable fences striped;
 *   - both banks as the real bank model (dollhouse cutaway) with their three safes inside;
 *   - every outdoor safe as the real safe model;
 *   - both recovery zones with the team emblem, the team vans with flags;
 *   - curated bank routes as chevron arrows in team colours;
 *   - police entry points (if the match has police) as a parked police car + label;
 *   - floating price tags (HTML, crisp in both languages) over every safe and bank.
 */
import * as THREE from 'three';
import type { LayoutDef, TeamId, Vec2 } from '../../sim/types';
import { BANK_MODEL, SCORE } from '../../sim/config';
import { TEAM_STYLES } from '../../shared/teams';
import { createBank, createSafe, createVan, placeOnSim, type BankRig, type SafeRig, type VanRig } from '../../render/models';
import { fmtScore, icon, lootIcon, t, teamEmblem } from '../../ui';
import { MenuScene, damp, easeOutBack } from '../scene';
import { POP, PropBuilder, ball, cyl, disposeProp, disposeTablecloth, roundBox, tablecloth } from '../kit';

export interface PreviewSceneOptions {
  layout: LayoutDef;
  /** Show police entry points (the match has the police event on). */
  police: boolean;
  /** Police entry points to mark (sim.policeEntries()), if any. */
  policeEntries?: readonly { park: Vec2; angle: number }[];
  /** The local player's team (labels say "우리 차" for it). */
  myTeam: TeamId;
}

const STYLE_COLORS: Record<string, string> = {
  cafe: '#F6B48F',
  bakery: '#F7D08A',
  toy: '#9AD7F5',
  brick: '#D98E7A',
  glass: '#A8D8E8',
  bookstore: '#C4A8E8',
  florist: '#F5A8C8',
};

const BANK_SCALE = 1.35;
const SAFE_SCALE = 1.7;

const KIND_COLORS = {
  building: ['#F6B48F', '#B9A6F0', '#9AD7F5', '#F5A8C8', '#A8E3C0', '#F7D08A'],
  wall: '#C8B4D9',
  planter: POP.grass,
  bench: POP.wood,
  kiosk: '#F5A8C8',
  fountain: '#9FDCF5',
  barrier: '#D7CCE4',
} as const;

function bankInterior(pos: Vec2, angle: number): { kind: 'smallSafe' | 'largeSafe'; local: [number, number] }[] {
  void pos;
  void angle;
  return [
    { kind: 'smallSafe', local: [-2.8, 0] },
    { kind: 'largeSafe', local: [0, 0] },
    { kind: 'smallSafe', local: [2.8, 0] },
  ];
}

export class PreviewScene extends MenuScene {
  readonly id = 'preview';
  private readonly table = new THREE.Group();
  private readonly base: THREE.Group;
  private readonly board: THREE.Group;
  private readonly banks: BankRig[] = [];
  private readonly safes: SafeRig[] = [];
  private readonly vans: VanRig[] = [];
  private readonly cops: THREE.Group[] = [];
  private readonly flags: THREE.Group[] = [];
  private readonly layout: LayoutDef;
  private readonly radius: number;
  private intro = 0;
  private swing = 0;
  private readonly cloth: THREE.Mesh;

  constructor(o: PreviewSceneOptions) {
    super({ sky: ['#3C9BEA', '#8ED0FF', '#D9F1FF'], skyStyle: { clouds: '#FFF6E6', stars: 0 }, shadowRadius: 40 });
    this.baseFov = 30;
    this.layout = o.layout;
    const L = o.layout;
    const W = L.size.x;
    const H = L.size.y;
    this.radius = Math.hypot(W, H) / 2;
    this.scene.fog = null;
    this.scene.add(this.table);
    // The toy board sits on a gingham tablecloth (static: only the board swings).
    this.cloth = tablecloth(Math.max(W, H) * 6, '#2FA27C', '#C9F5E2', 22);
    this.cloth.position.y = -4.15;
    this.scene.add(this.cloth);
    // The diorama is authored in sim space centred on the layout middle.
    const cx = W / 2;
    const cz = H / 2;

    // --- turntable + base plate ---------------------------------------------------------------
    const bb = new PropBuilder();
    // Board box: a thick wooden tray with a sunny rim and bulbs, on a small dark turntable.
    const R = Math.min(W, H) * 0.42;
    bb.add(cyl(R, R * 1.04, 1.4, 64), POP.woodDark, [0, -3.4, 0]);
    bb.add(cyl(R * 1.06, R * 1.06, 0.4, 64), POP.tomato, [0, -2.6, 0]);
    bb.add(roundBox(W + 6, 2.2, H + 6, 0.6), POP.wood, [0, -1.45, 0]);
    bb.add(roundBox(W + 6.4, 0.5, H + 6.4, 0.25), POP.sun, [0, -0.5, 0]);
    bb.add(roundBox(W + 2.6, 0.4, H + 2.6, 0.2), POP.grass, [0, -0.32, 0]);
    bb.add(roundBox(W + 0.4, 0.2, H + 0.4, 0.1), POP.paving, [0, -0.1, 0]);
    const per = 2 * (W + H + 12.8);
    const nb = Math.round(per / 2.4);
    for (let i = 0; i < nb; i++) {
      const u = (i / nb) * per;
      const hw = (W + 6.4) / 2;
      const hh = (H + 6.4) / 2;
      let x: number;
      let z: number;
      if (u < 2 * hw) [x, z] = [-hw + u, hh];
      else if (u < 2 * hw + 2 * hh) [x, z] = [hw, hh - (u - 2 * hw)];
      else if (u < 4 * hw + 2 * hh) [x, z] = [hw - (u - 2 * hw - 2 * hh), -hh];
      else [x, z] = [-hw, -hh + (u - 4 * hw - 2 * hh)];
      bb.add(ball(0.42, 8), i % 2 ? POP.tomato : POP.cream, [x, -0.2, z]);
    }
    // paving checker (big tiles, subtle)
    for (let x = 0; x < W; x += 8) {
      for (let z = 0; z < H; z += 8) {
        if (((x / 8) + (z / 8)) % 2 === 0) continue;
        bb.add(roundBox(Math.min(8, W - x) - 0.1, 0.04, Math.min(8, H - z) - 0.1, 0.02), POP.pavingDark, [x - cx + Math.min(8, W - x) / 2, 0.01, z - cz + Math.min(8, H - z) / 2]);
      }
    }
    this.base = bb.build('preview:base', { castShadow: false });
    this.base.userData.noOutlineBase = true;
    this.table.add(this.base);
    this.batcher.add(this.base);

    // --- board content (statics, circles, fences, zones, routes, flags) ------------------------
    const b = new PropBuilder();
    const at = (p: Vec2, y = 0): [number, number, number] => [p.x - cx, y, p.y - cz];
    let bi = 0;
    for (const s of L.statics) {
      const w = s.half.x * 2;
      const d = s.half.y * 2;
      if (s.kind === 'building') {
        const h = Math.min(4.2, Math.max(2.4, s.height * 0.42));
        const col = (s.style && STYLE_COLORS[s.style]) || KIND_COLORS.building[bi++ % KIND_COLORS.building.length]!;
        b.add(roundBox(w, h, d, 0.35), col, at(s.center, h / 2), { rot: [0, -s.angle, 0] });
        b.add(roundBox(w + 0.3, 0.45, d + 0.3, 0.2), new THREE.Color(col).multiplyScalar(0.72), at(s.center, h + 0.2), { rot: [0, -s.angle, 0] });
      } else if (s.kind === 'planter') {
        b.add(roundBox(w, 0.7, d, 0.25), '#B98A62', at(s.center, 0.35), { rot: [0, -s.angle, 0] });
        b.add(roundBox(w - 0.3, 0.5, d - 0.3, 0.22), POP.grass, at(s.center, 0.8), { rot: [0, -s.angle, 0] });
      } else if (s.kind === 'kiosk') {
        b.add(roundBox(w, 2.2, d, 0.3), KIND_COLORS.kiosk, at(s.center, 1.1), { rot: [0, -s.angle, 0] });
        b.add(roundBox(w + 0.5, 0.35, d + 0.5, 0.15), POP.tomato, at(s.center, 2.35), { rot: [0, -s.angle, 0] });
      } else if (s.kind === 'fountain') {
        b.add(roundBox(w, 0.6, d, 0.4), '#E7DCEB', at(s.center, 0.3), { rot: [0, -s.angle, 0] });
        b.add(roundBox(w - 0.6, 0.35, d - 0.6, 0.3), KIND_COLORS.fountain, at(s.center, 0.5), { rot: [0, -s.angle, 0] });
      } else {
        const h = s.kind === 'wall' ? Math.min(2.4, s.height * 0.6 || 1.6) : s.kind === 'bench' ? 0.5 : 0.9;
        const col = s.kind === 'wall' ? KIND_COLORS.wall : s.kind === 'bench' ? KIND_COLORS.bench : KIND_COLORS.barrier;
        b.add(roundBox(w, h, d, Math.min(0.2, w / 3, d / 3)), col, at(s.center, h / 2), { rot: [0, -s.angle, 0] });
      }
    }
    for (const c of L.circles) {
      const p = at(c.center);
      if (c.kind === 'tree') {
        b.add(cyl(0.18, 0.25, 1.6, 8), POP.woodDark, [p[0], 0.8, p[2]]);
        b.add(ball(Math.max(1.0, c.radius * 1.5), 12), '#7CC46A', [p[0], 2.3, p[2]]);
        b.add(ball(Math.max(0.7, c.radius), 10), '#5EA54E', [p[0] + 0.4, 2.8, p[2] - 0.2]);
      } else if (c.kind === 'lamp' || c.kind === 'pole') {
        b.add(cyl(0.08, 0.1, 3, 6), POP.ink, [p[0], 1.5, p[2]]);
        b.add(ball(0.28, 8), c.kind === 'lamp' ? POP.sun : POP.steel, [p[0], 3.05, p[2]]);
      } else if (c.kind === 'fountain') {
        b.add(cyl(c.radius, c.radius * 1.05, 0.6, 28), '#E7DCEB', [p[0], 0.3, p[2]]);
        b.add(cyl(c.radius * 0.85, c.radius * 0.85, 0.1, 28), KIND_COLORS.fountain, [p[0], 0.62, p[2]]);
        b.add(cyl(0.3, 0.45, 1.6, 12), '#E7DCEB', [p[0], 1.0, p[2]]);
        b.add(ball(0.5, 12), '#BDE9FA', [p[0], 1.9, p[2]]);
      } else if (c.kind === 'statue') {
        b.add(cyl(c.radius, c.radius, 0.8, 16), '#D7CCE4', [p[0], 0.4, p[2]]);
        b.add(ball(c.radius * 0.7, 12), '#BFB2D3', [p[0], 1.3, p[2]]);
      } else {
        b.add(cyl(c.radius, c.radius, 0.8, 10), c.kind === 'hydrant' ? POP.tomato : POP.steel, [p[0], 0.4, p[2]]);
      }
    }
    // Fences: chunky hazard barriers (bank-breakable)
    for (const f of L.fences) {
      const alongX = f.half.x >= f.half.y;
      const len = 2 * (alongX ? f.half.x : f.half.y);
      const n = Math.max(2, Math.round(len / 0.8));
      for (let i = 0; i < n; i++) {
        const k = (i + 0.5) / n - 0.5;
        const local = alongX ? { x: k * len, y: 0 } : { x: 0, y: k * len };
        const ca = Math.cos(f.angle);
        const sa = Math.sin(f.angle);
        const wp = { x: f.center.x + local.x * ca - local.y * sa, y: f.center.y + local.x * sa + local.y * ca };
        b.add(roundBox(alongX ? len / n - 0.04 : 0.35, 1.0, alongX ? 0.35 : len / n - 0.04, 0.06), i % 2 ? POP.ink : POP.sun, at(wp, 0.5), { rot: [0, -f.angle, 0] });
      }
    }
    // Zones: team pads with dashed rims + emblem
    for (const z of L.zones) {
      const st = TEAM_STYLES[z.team];
      const w = z.half.x * 2;
      const d = z.half.y * 2;
      b.add(roundBox(w, 0.08, d, 0.5), st.tint, at(z.center, 0.05), { rot: [0, -z.angle, 0] });
      const per = 2 * (w + d);
      const dashes = Math.round(per / 1.6);
      for (let i = 0; i < dashes; i++) {
        const u = (i / dashes) * per;
        let lx: number;
        let lz: number;
        let along: boolean;
        if (u < w) [lx, lz, along] = [u - w / 2, -d / 2, true];
        else if (u < w + d) [lx, lz, along] = [w / 2, u - w - d / 2, false];
        else if (u < 2 * w + d) [lx, lz, along] = [w / 2 - (u - w - d), d / 2, true];
        else [lx, lz, along] = [-w / 2, d / 2 - (u - 2 * w - d), false];
        const ca = Math.cos(z.angle);
        const sa = Math.sin(z.angle);
        const wp = { x: z.center.x + lx * ca - lz * sa, y: z.center.y + lx * sa + lz * ca };
        b.add(roundBox(along ? 0.9 : 0.3, 0.12, along ? 0.3 : 0.9, 0.05), st.color, at(wp, 0.1), { rot: [0, -z.angle, 0] });
      }
      // Emblem: star / moon as an extruded flat shape on the pad
      const shape = st.emblem === 'star' ? starShape(2.4) : moonShape(2.4);
      const eg = new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false, curveSegments: 10 });
      eg.rotateX(-Math.PI / 2);
      b.add(eg, st.color, at(z.center, 0.1));
      // Flag on the van side
      const fp = { x: z.vanPos.x - Math.sin(z.vanAngle) * 2.0, y: z.vanPos.y + Math.cos(z.vanAngle) * 2.0 };
      const fpa = at(fp);
      b.add(cyl(0.08, 0.1, 4.6, 8), POP.cream, [fpa[0], 2.3, fpa[2]]);
      b.add(ball(0.2, 8), POP.sun, [fpa[0], 4.7, fpa[2]]);
    }
    // Bank routes: chevrons in team colours
    for (const r of L.bankRoutes) {
      const col = TEAM_STYLES[r.team].color;
      for (let i = 0; i + 1 < r.points.length; i++) {
        const a = r.points[i]!;
        const c = r.points[i + 1]!;
        const seg = Math.hypot(c.x - a.x, c.y - a.y);
        const ang = Math.atan2(c.y - a.y, c.x - a.x);
        const n = Math.floor(seg / 2.6);
        for (let k = 1; k <= n; k++) {
          const u = k / (n + 1);
          const p = { x: a.x + (c.x - a.x) * u, y: a.y + (c.y - a.y) * u };
          b.add(chevronGeo(), col, at(p, 0.09), { rot: [0, -ang, 0] });
        }
      }
    }
    this.board = b.build('preview:board');
    this.table.add(this.board);
    this.batcher.add(this.board);

    // --- flags (team cloth with the emblem colour), vans ------------------------------------------
    for (const z of L.zones) {
      const st = TEAM_STYLES[z.team];
      const fp = { x: z.vanPos.x - Math.sin(z.vanAngle) * 2.0, y: z.vanPos.y + Math.cos(z.vanAngle) * 2.0 };
      const fb = new PropBuilder();
      fb.add(roundBox(1.8, 1.1, 0.08, 0.06), st.color, [0.95, 0, 0]);
      fb.add(roundBox(0.5, 0.5, 0.1, 0.24), st.tint, [0.95, 0, 0]);
      const flag = fb.build(`preview:flag${z.team}`);
      flag.position.set(fp.x - cx, 4.1, fp.y - cz);
      this.table.add(flag);
      this.batcher.add(flag);
      this.flags.push(flag);
      const van = createVan(z.team);
      placeOnSim(van.root, { x: z.vanPos.x - cx, y: z.vanPos.y - cz }, z.vanAngle);
      this.table.add(van.root);
      this.batcher.add(van.root);
      this.vans.push(van);
      this.addShadow(this.table, 5.6, 3.0, [z.vanPos.x - cx, 0.05, z.vanPos.y - cz], 0.28).rotation.y = -z.vanAngle;
      const mine = z.team === o.myTeam;
      const tag = document.createElement('div');
      tag.className = `uh-m3d-tag uh-m3d-tag--team uh-m3d-tag--t${z.team}`;
      tag.append(teamEmblem(z.team), document.createTextNode(t(mine ? 'preview.ourVan' : 'preview.theirVan')));
      this.pending.push({ id: `van${z.team}`, el: tag, target: van.root, dy: 3.2, prio: 1 });
    }

    // --- banks with their safes, outdoor safes -----------------------------------------------------
    L.banks.forEach((bp, i) => {
      const bank = createBank();
      // Roof lifted off (toy dollhouse): the vault room and its three safes read from above.
      bank.setRoofOpacity(0);
      placeOnSim(bank.root, { x: bp.pos.x - cx, y: bp.pos.y - cz }, bp.angle);
      // Toy exaggeration: the banks (and every safe) are a little oversized on the miniature.
      bank.root.scale.setScalar(BANK_SCALE);
      this.table.add(bank.root);
      this.batcher.add(bank.root);
      this.banks.push(bank);
      this.addShadow(this.table, 10 * BANK_SCALE, 8 * BANK_SCALE, [bp.pos.x - cx, 0.05, bp.pos.y - cz], 0.3).rotation.y = -bp.angle;
      for (const s of bankInterior(bp.pos, bp.angle)) {
        const rig = createSafe(s.kind);
        rig.setAnchored(false);
        this.batchDecals(rig.root);
        rig.root.position.set(s.local[0], 0.06, s.local[1]);
        rig.root.rotation.y = Math.PI / 2;
        this.hideCoin(rig.root);
        bank.root.add(rig.root);
        this.batcher.add(rig.root);
        this.safes.push(rig);
      }
      const value = SCORE.bankBuilding + SCORE.smallSafe * 2 + SCORE.largeSafe;
      const tag = document.createElement('div');
      tag.className = 'uh-m3d-tag uh-m3d-tag--bank';
      tag.append(lootIcon('bank', 'uh-loot-icon'), spanText(fmtScore(value), 'uh-m3d-tag__num'), spanText(t('preview.tagBankParts'), 'uh-m3d-tag__sub'));
      this.pending.push({ id: `bank${i}`, el: tag, target: bank.root, dy: (BANK_MODEL.roofHeight + 1.2) * BANK_SCALE, prio: 0 });
    });
    L.safes.forEach((sp, i) => {
      const rig = createSafe(sp.kind);
      rig.setAnchored(false);
      this.batchDecals(rig.root);
      placeOnSim(rig.root, { x: sp.pos.x - cx, y: sp.pos.y - cz }, sp.angle);
      rig.root.scale.setScalar(SAFE_SCALE);
      this.hideCoin(rig.root);
      this.table.add(rig.root);
      this.batcher.add(rig.root);
      this.safes.push(rig);
      const tag = document.createElement('div');
      tag.className = `uh-m3d-tag uh-m3d-tag--${sp.kind}`;
      tag.append(lootIcon(sp.kind, 'uh-loot-icon'), spanText(fmtScore(sp.kind === 'smallSafe' ? SCORE.smallSafe : SCORE.largeSafe), 'uh-m3d-tag__num'));
      this.pending.push({ id: `safe${i}`, el: tag, target: rig.root, dy: (sp.kind === 'largeSafe' ? 1.6 : 1.1) * SAFE_SCALE, prio: 2 });
    });

    // --- police entry points ----------------------------------------------------------------------
    if (o.police) {
      for (const [i, e] of (o.policeEntries ?? []).entries()) {
        const pb = new PropBuilder();
        pb.add(roundBox(3.6, 1.0, 1.8, 0.35), '#F7F5FF', [0, 0.75, 0]);
        pb.add(roundBox(2.0, 0.8, 1.6, 0.3), '#F7F5FF', [-0.2, 1.55, 0]);
        pb.add(roundBox(1.9, 0.5, 1.64, 0.2), '#A9D8FF', [-0.2, 1.55, 0]);
        pb.add(roundBox(3.64, 0.3, 1.84, 0.12), '#5A56C2', [0, 0.8, 0]);
        pb.add(roundBox(0.5, 0.26, 0.6, 0.1), '#FF5A5A', [-0.2, 2.1, -0.38]);
        pb.add(roundBox(0.5, 0.26, 0.6, 0.1), '#5AA0FF', [-0.2, 2.1, 0.38]);
        for (const [x, z] of [[1.2, 0.85], [1.2, -0.85], [-1.2, 0.85], [-1.2, -0.85]] as const) pb.add(cyl(0.38, 0.38, 0.3, 12), POP.ink, [x, 0.38, z], { rot: [Math.PI / 2, 0, 0] });
        const car = pb.build(`preview:cop${i}`);
        placeOnSim(car, { x: e.park.x - cx, y: e.park.y - cz }, e.angle);
        this.table.add(car);
        this.batcher.add(car);
        this.cops.push(car);
        const tag = document.createElement('div');
        // Icon-only badge (the legend names it): keeps the board readable around the banks.
        tag.className = 'uh-m3d-tag uh-m3d-tag--police';
        tag.title = t('preview.policeEntry');
        tag.append(icon('police'));
        this.pending.push({ id: `cop${i}`, el: tag, target: car, dy: 2.9, prio: 3 });
      }
    }

    this.lighting.sun.intensity *= 1.05;
    this.camLook.set(0, 0, 2);
    this.camPos.set(0, 70, 92);
  }

  private readonly pending: { id: string; el: HTMLElement; target: THREE.Object3D; dy: number; prio: number }[] = [];
  /** Free screen area (0..1 fractions) between the preview's header and footer cards. */
  private safeSrc: (() => SafeArea | null) | null = null;
  private safe: SafeArea | null = null;
  private safePolled = -1;
  private distMul = 1;
  private lookZ = 1.2;
  private readonly corner = new THREE.Vector3();

  /**
   * Fit the board into the screen area the HTML leaves free (polled twice a second). The camera
   * eases its distance and aim until the board's projected bounds sit inside it.
   */
  setSafeArea(src: (() => SafeArea | null) | null): void {
    this.safeSrc = src;
    this.safePolled = -1;
  }

  protected override onAttach(): void {
    const labels = this.env?.labels;
    if (!labels) return;
    for (const p of this.pending) labels.pin(p.id, p.el, p.target, p.dy, p.prio);
  }

  /** The coin label on top of a safe faces the camera via a render hook: the HTML tag replaces it. */
  private hideCoin(root: THREE.Object3D): void {
    root.traverse((o) => {
      if (/coin/i.test(o.name)) o.visible = false;
    });
  }

  protected update(dt: number, t: number): void {
    const rm = this.reducedMotion;
    this.intro = Math.min(1, this.intro + dt / 1.4);
    const k = rm ? 1 : easeOutBack(this.intro, 1.2);
    // turntable: a slow swing so the layout keeps its in-game orientation most of the time
    this.swing = rm ? 0 : Math.sin(t * 0.32) * 0.3;
    this.table.rotation.y = this.swing;
    this.table.position.y = (1 - k) * -8;
    for (const bnk of this.banks) bnk.update(dt);
    for (const s of this.safes) s.update(dt);
    for (const v of this.vans) v.update(dt);
    for (const f of this.flags) f.rotation.y = Math.sin(t * 2.2 + f.position.x) * 0.25 - 0.2;
    const W = this.layout.size.x;
    if (this.safeSrc && t - this.safePolled > 0.5) {
      this.safePolled = t;
      try {
        this.safe = this.safeSrc();
      } catch {
        this.safe = null;
      }
    }
    if (this.safe) this.fitToSafe(rm ? 1 : Math.min(1, dt * 4));
    // Pulled back a little so the title card (top-left) and the team cards (bottom) frame the
    // board instead of covering its edges.
    const dist = (W * 1.38 + 16) * this.distMul;
    const goalPos = new THREE.Vector3(0, dist * 0.84, this.lookZ - 1.2 + dist * 0.8);
    this.camPos.lerp(goalPos, rm ? 1 : damp(2.2, dt));
    this.camLook.set(0, -2.5, this.lookZ);
  }

  /** One easing step of the board-into-safe-area fit (uses last frame's camera). */
  private fitToSafe(gain: number): void {
    const sa = this.safe!;
    const cam = this.camera;
    if (sa.r - sa.l < 0.1 || sa.b - sa.t < 0.1) return;
    const hx = this.layout.size.x / 2 + 1.5;
    const hz = this.layout.size.y / 2 + 1.5;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    this.table.updateMatrixWorld();
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (const y of [0, 3.5]) {
          this.corner.set(sx * hx, y, sz * hz).applyMatrix4(this.table.matrixWorld).project(cam);
          x0 = Math.min(x0, this.corner.x);
          x1 = Math.max(x1, this.corner.x);
          y0 = Math.min(y0, this.corner.y);
          y1 = Math.max(y1, this.corner.y);
        }
      }
    }
    if (!Number.isFinite(x0 + x1 + y0 + y1)) return;
    // Safe area in NDC (y up).
    const sx0 = sa.l * 2 - 1;
    const sx1 = sa.r * 2 - 1;
    const sy0 = 1 - sa.b * 2;
    const sy1 = 1 - sa.t * 2;
    const k = Math.max((x1 - x0) / (sx1 - sx0), (y1 - y0) / (sy1 - sy0));
    if (k > 0.05 && Number.isFinite(k)) this.distMul = Math.min(2.6, Math.max(0.55, this.distMul * Math.pow(k, gain * 0.8)));
    const dist = (this.layout.size.x * 1.38 + 16) * this.distMul;
    const cy = (y0 + y1) / 2;
    const scy = (sy0 + sy1) / 2;
    this.lookZ = Math.min(40, Math.max(-40, this.lookZ + (scy - cy) * dist * 0.35 * gain));
  }

  protected override onDispose(): void {
    for (const b of this.banks) b.dispose();
    for (const s of this.safes) s.dispose();
    for (const v of this.vans) v.dispose();
    for (const c of this.cops) disposeProp(c);
    for (const f of this.flags) disposeProp(f);
    disposeProp(this.board);
    disposeProp(this.base);
    disposeTablecloth(this.cloth);
  }
}

/** Screen rect as 0..1 fractions of the viewport. */
export interface SafeArea {
  l: number;
  t: number;
  r: number;
  b: number;
}

function spanText(text: string, cls: string): HTMLElement {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
}

function starShape(r: number): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    const rr = i % 2 ? r * 0.45 : r;
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

function moonShape(r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.absarc(0, 0, r, Math.PI * 0.35, Math.PI * 1.65, false);
  s.absarc(r * 0.55, 0, r * 0.82, Math.PI * 1.45, Math.PI * 0.55, true);
  s.closePath();
  return s;
}

let chev: THREE.BufferGeometry | null = null;
function chevronGeo(): THREE.BufferGeometry {
  // A fresh copy each time (PropBuilder consumes it).
  if (!chev) {
    const sh = new THREE.Shape();
    sh.moveTo(-0.5, -0.7);
    sh.lineTo(0.2, 0);
    sh.lineTo(-0.5, 0.7);
    sh.lineTo(-0.1, 0.7);
    sh.lineTo(0.6, 0);
    sh.lineTo(-0.1, -0.7);
    sh.closePath();
    chev = new THREE.ExtrudeGeometry(sh, { depth: 0.08, bevelEnabled: false });
    chev.rotateX(-Math.PI / 2);
  }
  return chev.clone();
}
