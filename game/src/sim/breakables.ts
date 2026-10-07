/**
 * [C1] Breakables (나무 상자 / 자판기): removable statics that pop coins (content-plan §3.1).
 * Day-0 skeleton by C0: `buildBreakables` is the buildV2 callback (world.ts) and `damageBreakable`
 * the frozen entry point for dash (C1), hammer (C2), stomper (C4) and quake (C5) damage.
 */
import type { SimContext } from './context';
import type { EntityId, LayoutV2Def } from './types';

/**
 * buildV2 callback [C1]: one BreakableState per LayoutV2Def.breakables entry (layout order) in
 * ctx.state.breakables, hp / innerValue from BREAKABLE_SPECS, plus a static shape (fence-style
 * removable). Runs after props, before gimmicks.
 */
export function buildBreakables(_ctx: SimContext, _v2: LayoutV2Def): void {
  // C1
}

/**
 * [C1] Apply `damage` HP to breakable `id`: emits `breakableHit`, pops coins (via
 * CoinSystem.spawnCoins, fanned around `dir`), and on 0 HP removes the static, pops the rest and
 * emits `breakableBroken`. No-op on a broken / unknown id.
 */
export function damageBreakable(_ctx: SimContext, _id: string, _damage: number, _byCharId: EntityId | null, _dir: number): void {
  // C1
}
