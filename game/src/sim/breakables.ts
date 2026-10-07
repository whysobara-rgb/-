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

/**
 * [C1] Apply `damage` HP to breakable `id`: emits `breakableHit`, pops coins (via
 * CoinSystem.spawnCoins, toward the hitter for a non-breaking hit, radial on the break), and on
 * 0 HP removes the static, pops the rest and emits `breakableBroken`. `dir` = hit direction
 * (from the hitter toward the breakable, radians). No-op on a broken / unknown id or damage ≤ 0.
 */
export function damageBreakable(ctx: SimContext, id: string, damage: number, byCharId: EntityId | null, dir: number): void {
  const st = ctx.state;
  const b = st.breakables.find((x) => x.id === id);
  const coins = ctx.content?.coins;
  if (!b || b.broken || !(damage > 0) || !coins) return;
  const hp = Math.max(0, b.hp - Math.ceil(damage));
  const lost = b.hp - hp;
  b.hp = hp;
  emit(ctx, { type: 'breakableHit', tick: st.tick, id: b.id, hp, byCharId });
  if (hp > 0) {
    // one coin per HP lost, out of the face toward the hitter
    const n = Math.min(lost, Math.floor(b.innerValue / COINS.coin));
    if (n > 0) {
      b.innerValue -= n * COINS.coin;
      const back = dir + Math.PI;
      const c = Math.cos(b.angle);
      const s = Math.sin(b.angle);
      const ux = Math.cos(back);
      const uy = Math.sin(back);
      const lx = ux * c + uy * s;
      const ly = -ux * s + uy * c;
      const t = Math.min(Math.abs(lx) > 1e-9 ? b.half.x / Math.abs(lx) : Infinity, Math.abs(ly) > 1e-9 ? b.half.y / Math.abs(ly) : Infinity);
      const reach = t + COINS.popMargin;
      coins.spawnCoins({
        pos: { x: b.center.x + ux * reach, y: b.center.y + uy * reach },
        dir: back,
        values: new Array<10>(n).fill(10),
        pattern: 'fan',
        source: 'break',
        sourceId: b.id,
        byCharId,
      });
    }
    return;
  }
  b.broken = true;
  const sh = breakableShape(ctx, b.id);
  if (sh) {
    sh.enabled = false;
    sh.blocksLOS = false;
  }
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
      byCharId,
    });
  }
  emit(ctx, { type: 'breakableBroken', tick: st.tick, id: b.id, byCharId });
}
