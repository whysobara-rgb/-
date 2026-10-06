/**
 * Dev-only mock data for the UI gallery: a plaza-like LayoutDef plus HUD view-models.
 * The gallery prefers the real layouts from src/sim/layouts when that module is available.
 */
import type { LayoutDef, StaticBoxDef, StaticCircleDef } from '../../sim/types';
import type { HudModel, MinimapModel, WorldLabelModel } from '../hud/types';

const box = (id: string, kind: StaticBoxDef['kind'], x: number, y: number, hx: number, hy: number, angle = 0, height = 6): StaticBoxDef => ({
  id,
  kind,
  center: { x, y },
  half: { x: hx, y: hy },
  angle,
  height,
});
const circ = (id: string, kind: StaticCircleDef['kind'], x: number, y: number, r: number): StaticCircleDef => ({ id, kind, center: { x, y }, radius: r, height: 3 });

/** Point-symmetric mock of 수집 광장 (84 x 56 m). */
export function mockPlazaLayout(): LayoutDef {
  const W = 84;
  const H = 56;
  const statics: StaticBoxDef[] = [];
  const circles: StaticCircleDef[] = [];
  // Mirror helper: point symmetry around the arena center.
  const sym = (b: StaticBoxDef): void => {
    statics.push(b, { ...b, id: `${b.id}-m`, center: { x: W - b.center.x, y: H - b.center.y } });
  };
  const symC = (c: StaticCircleDef): void => {
    circles.push(c, { ...c, id: `${c.id}-m`, center: { x: W - c.center.x, y: H - c.center.y } });
  };
  sym(box('b1', 'building', 9, 3.5, 8, 3.5, 0, 9));
  sym(box('b2', 'building', 30, 3, 6, 3, 0, 8));
  sym(box('b3', 'building', 55, 3, 7, 3, 0, 10));
  sym(box('b4', 'building', 75.5, 4, 7.5, 4, 0, 9));
  sym(box('w1', 'wall', 20, 13, 0.4, 5));
  sym(box('k1', 'kiosk', 32, 26, 1.5, 1.2, 0, 3));
  sym(box('p1', 'planter', 17, 21.5, 3, 0.9, 0, 1));
  sym(box('p2', 'planter', 33, 34.5, 3.5, 0.9, 0, 1));
  sym(box('bn1', 'bench', 27, 22, 1.4, 0.45, 0, 1));
  sym(box('br1', 'barrier', 48, 22.5, 0.4, 2.6, 0, 1));
  circles.push(circ('fountain', 'fountain', W / 2, H / 2, 3.2));
  symC(circ('t1', 'tree', 14, 12, 1.4));
  symC(circ('t2', 'tree', 36, 19.5, 1.3));
  symC(circ('t3', 'tree', 62, 15, 1.4));
  symC(circ('l1', 'lamp', 24, 28, 0.3));
  symC(circ('l2', 'lamp', 42, 9, 0.3));
  symC(circ('h1', 'hydrant', 50, 9.5, 0.3));
  return {
    id: 'plaza',
    nameKey: 'layout.plaza.name',
    descKey: 'layout.plaza.desc',
    size: { x: W, y: H },
    statics,
    circles,
    fences: [
      { id: 'f1', center: { x: 26.5, y: 13 }, half: { x: 0.25, y: 3.2 }, angle: 0 },
      { id: 'f2', center: { x: W - 26.5, y: H - 13 }, half: { x: 0.25, y: 3.2 }, angle: 0 },
    ],
    zones: [
      { team: 0, center: { x: 9.5, y: 28 }, half: { x: 6.5, y: 5.5 }, angle: 0, vanPos: { x: 2.6, y: 28 }, vanAngle: Math.PI / 2 },
      { team: 1, center: { x: W - 9.5, y: 28 }, half: { x: 6.5, y: 5.5 }, angle: 0, vanPos: { x: W - 2.6, y: 28 }, vanAngle: -Math.PI / 2 },
    ],
    spawns: [
      { team: 0, pos: { x: 15, y: 25 }, facing: 0 },
      { team: 0, pos: { x: 15, y: 31 }, facing: 0 },
      { team: 1, pos: { x: W - 15, y: 25 }, facing: Math.PI },
      { team: 1, pos: { x: W - 15, y: 31 }, facing: Math.PI },
    ],
    banks: [
      { pos: { x: 42, y: 14.5 }, angle: 0 },
      { pos: { x: 42, y: 41.5 }, angle: 0 },
    ],
    safes: [
      { kind: 'smallSafe', pos: { x: 23, y: 7.5 }, angle: 0 },
      { kind: 'smallSafe', pos: { x: 61, y: 48.5 }, angle: 0 },
      { kind: 'smallSafe', pos: { x: 28, y: 44 }, angle: 0.3 },
      { kind: 'smallSafe', pos: { x: 56, y: 12 }, angle: 0.3 },
      { kind: 'smallSafe', pos: { x: 21, y: 34 }, angle: 0 },
      { kind: 'smallSafe', pos: { x: 63, y: 22 }, angle: 0 },
      { kind: 'largeSafe', pos: { x: 32, y: 20.5 }, angle: 0 },
      { kind: 'largeSafe', pos: { x: 52, y: 35.5 }, angle: 0 },
    ],
    bankRoutes: [],
    chokepoints: [
      { id: 'northAlley', nameKey: 'choke.northAlley', pos: { x: 26, y: 10 }, radius: 3 },
      { id: 'fountain', nameKey: 'choke.fountain', pos: { x: 42, y: 28 }, radius: 4 },
    ],
    decor: [],
    groundStyle: 'plaza',
  };
}

/** Practice yard mock: one bank, one safe, team 0 only. */
export function mockTutorialLayout(): LayoutDef {
  const L = mockPlazaLayout();
  return {
    ...L,
    id: 'tutorial',
    nameKey: 'layout.tutorial.name',
    descKey: 'layout.tutorial.desc',
    zones: [L.zones[0]],
    spawns: [L.spawns[0]],
    banks: [L.banks[0]],
    safes: [L.safes[4]],
    fences: [L.fences[0]],
  };
}

/** Minimap model mid-match: bank A carried by team 1, a large safe pulled out, one opponent visible. */
export function mockMinimap(layout: LayoutDef, t = 0): MinimapModel {
  const wob = Math.sin(t / 900);
  return {
    banks: [
      { id: 5, x: layout.banks[0].pos.x - 6 + wob, y: layout.banks[0].pos.y + 1, angle: 0.25 + wob * 0.05, recovered: false, carriedBy: 1 },
      { id: 6, x: layout.banks[1]?.pos.x ?? 42, y: layout.banks[1]?.pos.y ?? 41, angle: 0, recovered: false, carriedBy: null },
    ],
    safes: [
      ...layout.safes.map((s, i) => ({ id: 20 + i, kind: s.kind, x: s.pos.x, y: s.pos.y, angle: s.angle, recovered: i === 0 })),
      { id: 40, kind: 'largeSafe' as const, x: 36 + wob, y: 21, angle: 0.4, recovered: false, heldBy: 0 as const },
    ],
    characters: [
      { id: 1, team: 0, x: 37 + wob, y: 22.5, facing: -0.6, isMe: true, visible: true },
      { id: 2, team: 0, x: 20, y: 40, facing: 1.2, visible: true },
      { id: 3, team: 1, x: 31 + wob, y: 16, facing: 2.6, visible: true },
      { id: 4, team: 1, x: 66, y: 44, facing: 3.0, visible: false },
    ],
    pings: [{ id: 1, team: 0, x: 42, y: 41.5, kind: 'grabTogether' }],
    brokenFences: [],
  };
}

export function mockHudModel(layout: LayoutDef, variant: 'match' | 'final' | 'practice' | 'bank'): HudModel {
  const base: HudModel = {
    mode: 'match',
    myTeam: 0,
    scores: [900, 600],
    timeLeftSec: 142.3,
    finalCountdown: false,
    banks: [
      { id: 5, recovered: false, recoveredBy: null, carriedBy: 1 },
      { id: 6, recovered: false, recoveredBy: null, carriedBy: null },
    ],
    lastBankWarning: false,
    carry: { kind: 'largeSafe', value: 300 },
    grab: { action: 'release', target: 'largeSafe', value: 300 },
    dashCooldown: 0.35,
    minimap: mockMinimap(layout),
  };
  switch (variant) {
    case 'final':
      return {
        ...base,
        scores: [1600, 1500],
        timeLeftSec: 21.4,
        finalCountdown: true,
        banks: [
          { id: 5, recovered: true, recoveredBy: 1 },
          { id: 6, recovered: true, recoveredBy: 0 },
        ],
        carry: { kind: 'smallSafe', value: 100, recovering: 0.62 },
        grab: { action: 'release', target: 'smallSafe', value: 100 },
        dashCooldown: 0,
      };
    case 'bank':
      return {
        ...base,
        scores: [400, 1200],
        timeLeftSec: 64,
        banks: [
          { id: 5, recovered: true, recoveredBy: 1 },
          { id: 6, recovered: false, recoveredBy: null, carriedBy: 0 },
        ],
        lastBankWarning: true,
        carry: { kind: 'bank', value: 700, building: 500, safes: 200 },
        grab: { action: 'release', target: 'bankWall', value: 700 },
        dashCooldown: 0.8,
      };
    case 'practice':
      return {
        ...base,
        mode: 'practice',
        scores: [100, 0],
        timeLeftSec: null,
        banks: [{ id: 5, recovered: false, recoveredBy: null }],
        carry: null,
        grab: { action: 'grab', target: 'bankWall', value: 1000, anchored: true, unanchorSec: 3, unanchorProgress: 0.45 },
        dashCooldown: 0,
        minimap: null,
      };
    default:
      return base;
  }
}

/** World labels placed over the fake gallery scene (1920x1080 reference, scaled by viewport). */
export function mockLabels(w: number, h: number, variant: string): WorldLabelModel[] {
  const sx = w / 1920;
  const sy = h / 1080;
  const P = (x: number, y: number): { x: number; y: number } => ({ x: x * sx, y: y * sy });
  const labels: WorldLabelModel[] = [
    { kind: 'value', id: 21, ...P(610, 520), loot: 'smallSafe', value: 100 },
    { kind: 'value', id: 26, ...P(1260, 610), loot: 'largeSafe', value: 300, focus: true },
    { kind: 'bank', id: 5, ...P(960, 330), value: 1000, building: 500, safes: 500, showBreakdown: true, carriedBy: 1 },
    { kind: 'ping', id: 1, ...P(1500, 420), ping: 'grabTogether', team: 0 },
    { kind: 'name', id: 2, ...P(760, 700), text: '동료 봇', team: 0 },
    { kind: 'name', id: 3, ...P(1100, 470), text: '호다닥', team: 1 },
  ];
  if (variant === 'final' || variant === 'bank') {
    labels.push({ kind: 'recovery', id: 30, ...P(420, 640), progress: 0.62, team: 0 });
  }
  if (variant === 'bank') {
    labels.push({ kind: 'value', id: 40, ...P(990, 600), loot: 'smallSafe', value: 100, loaded: true });
  }
  return labels;
}
