/**
 * [C1] Breakables (나무 상자 / 자판기): removable statics that pop coins (content-plan §3.1).
 * `buildBreakables` is the buildV2 callback (world.ts) and `damageBreakable` the frozen entry point
 * for dash (C1, CoinSystem.afterSubstep), hammer (C2), stomper (C4) and quake (C5) damage.
 *
 * - Each breakable is a static box (tag = its id) built at match start; breaking it disables the
 *   shape exactly like a broken fence (physics, isFree, nav statics and line of sight all skip it).
 * - HP and coins inside come from BREAKABLE_SPECS (crate 1 HP / 20, vending 3 HP / 60). A hit that
 *   does not break it pops one 동전 10 per HP lost out of the face toward the hitter ("the vending
 *   machine coughs coins"); the breaking hit pops everything left in a radial burst. innerValue
 *   always drops by exactly the popped value (conservation).
 */
import { BREAKABLE_SPECS, COINS } from './config';
import { coinDir } from './coins';
import { emit, type SimContext } from './context';
import type { StaticShape } from './physics';
import type { BreakableState, EntityId, LayoutV2Def } from './types';

/** Static shape of every breakable of a match (by id), filled at build. */
const SHAPES = new WeakMap<SimContext, Map<string, StaticShape>>();

/**
 * buildV2 callback [C1]: one BreakableState per LayoutV2Def.breakables entry (layout order) in
 * ctx.state.breakables, hp / innerValue from BREAKABLE_SPECS, plus a static shape (fence-style
 * removable). Runs after props, before gimmicks.
 */
export function buildBreakables(ctx: SimContext, v2: LayoutV2Def): void {
  const shapes = new Map<string, StaticShape>();
  SHAPES.set(ctx, shapes);
  for (const def of v2.breakables) {
    if (shapes.has(def.id)) throw new Error(`duplicate breakable id ${def.id}`);
    const spec = BREAKABLE_SPECS[def.kind];
    const sh = ctx.physics.addStaticBox(def.center.x, def.center.y, def.half.x, def.half.y, def.angle, def.id);
    // the tall vending machine hides raccoons like a kiosk; a crate does not
    sh.blocksLOS = def.kind === 'vending';
    shapes.set(def.id, sh);
    const st: BreakableState = {
      id: def.id,
      kind: def.kind,
      center: { x: def.center.x, y: def.center.y },
      half: { x: def.half.x, y: def.half.y },
      angle: def.angle,
      hp: spec.hp,
      innerValue: spec.inner,
      broken: false,
    };
    ctx.state.breakables.push(st);
  }
}

/** The static shape of breakable `id` (null if unknown). */
export function breakableShape(ctx: SimContext, id: string): StaticShape | null {
  return SHAPES.get(ctx)?.get(id) ?? null;
}

/** One hit on a breakable (see damageBreakableShared). */
export interface BreakableHit {
  damage: number;
  byCharId: EntityId | null;
  /** Hit direction (from the hitter toward the breakable, radians). */
  dir: number;
}

/**
 * [C1] Apply `damage` HP to breakable `id`: emits `breakableHit`, pops coins (via
 * CoinSystem.spawnCoins, toward the hitter for a non-breaking hit, radial on the break), and on
 * 0 HP removes the static, pops the rest and emits `breakableBroken`. `dir` = hit direction
 * (from the hitter toward the breakable, radians). No-op on a broken / unknown id or damage ≤ 0.
 * Several hits on the same breakable in the same substep go through damageBreakableShared.
 */
export function damageBreakable(ctx: SimContext, id: string, damage: number, byCharId: EntityId | null, dir: number): void {
  damageBreakableShared(ctx, id, [{ damage, byCharId, dir }]);
}

/**
 * [C1] Simultaneous hits on breakable `id` (same substep), resolved order-independently (never
 * slot order, content-plan §4.4 / §10):
 * - the damage is summed and applied once; one `breakableHit` per hitter (ascending charId,
 *   null last) carrying the final hp;
 * - not broken: each hitter gets the coins for its own HP lost out of the face toward it (if the
 *   coins inside cannot cover every hitter, each gets an equal share and the remainder stays inside);
 * - broken: one radial burst of everything left. With one hitter it is centred on the hit
 *   direction; with several on their summed (mirror-exact table) directions, or π/2 when those
 *   cancel. A shared break credits nobody (`byCharId: null` on the burst and `breakableBroken`).
 * A single hit is exactly damageBreakable. Hits with damage ≤ 0 are ignored.
 */
export function damageBreakableShared(ctx: SimContext, id: string, hitsIn: ReadonlyArray<BreakableHit>): void {
  const st = ctx.state;
  const b = st.breakables.find((x) => x.id === id);
  const coins = ctx.content?.coins;
  if (!b || b.broken || !coins) return;
  const hits = hitsIn
    .filter((h) => h.damage > 0)
    .map((h) => ({ dmg: Math.ceil(h.damage), byCharId: h.byCharId, dir: h.dir }))
    .sort((a, c) => (a.byCharId ?? 0x7fffffff) - (c.byCharId ?? 0x7fffffff));
  if (hits.length === 0) return;
  let total = 0;
  for (const h of hits) total += h.dmg;
  const hp = Math.max(0, b.hp - total);
  b.hp = hp;
  for (const h of hits) emit(ctx, { type: 'breakableHit', tick: st.tick, id: b.id, hp, byCharId: h.byCharId });
  if (hp > 0) {
    // not broken: every hitter lost exactly its own damage in HP
    const avail = Math.floor(b.innerValue / COINS.coin);
    const share = total <= avail ? Infinity : Math.floor(avail / hits.length);
    for (const h of hits) {
      const n = Math.min(h.dmg, share);
      if (n > 0) popFace(ctx, b, n, h.byCharId, h.dir);
    }
    return;
  }
  b.broken = true;
  const sh = breakableShape(ctx, b.id);
  if (sh) {
    sh.enabled = false;
    sh.blocksLOS = false;
  }
  const shared = hits.length > 1;
  let dir = hits[0]!.dir;
  if (shared) {
    let sx = 0;
    let sy = 0;
    for (const h of hits) {
      const u = coinDir(h.dir);
      sx += u.x;
      sy += u.y;
    }
    dir = Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9 ? Math.PI / 2 : Math.atan2(sy, sx);
  }
  const by = shared ? null : hits[0]!.byCharId;
  const rest = b.innerValue;
  const n10 = Math.floor(rest / COINS.coin);
  if (n10 > 0) {
    b.innerValue = rest - n10 * COINS.coin;
    coins.spawnCoins({
      pos: { x: b.center.x, y: b.center.y },
      dir,
      values: new Array<10>(n10).fill(10),
      pattern: 'radial',
      source: 'break',
      sourceId: b.id,
      byCharId: by,
    });
  }
  emit(ctx, { type: 'breakableBroken', tick: st.tick, id: b.id, byCharId: by });
}

/** Pop `n` 동전 10 out of the face of `b` toward a hitter coming from direction `dir`. */
function popFace(ctx: SimContext, b: BreakableState, n: number, byCharId: EntityId | null, dir: number): void {
  b.innerValue -= n * COINS.coin;
  const back = dir + Math.PI;
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  // mirror-exact table direction (mirrored hitters -> mirrored pop spots)
  const u = coinDir(back);
  const ux = u.x;
  const uy = u.y;
  const lx = ux * c + uy * s;
  const ly = -ux * s + uy * c;
  const t = Math.min(Math.abs(lx) > 1e-9 ? b.half.x / Math.abs(lx) : Infinity, Math.abs(ly) > 1e-9 ? b.half.y / Math.abs(ly) : Infinity);
  const reach = t + COINS.popMargin;
  ctx.content!.coins.spawnCoins({
    pos: { x: b.center.x + ux * reach, y: b.center.y + uy * reach },
    dir: back,
    values: new Array<10>(n).fill(10),
    pattern: 'fan',
    source: 'break',
    sourceId: b.id,
    byCharId,
  });
}
