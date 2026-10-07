/**
 * [C4/C4b] Map gimmicks: belt, fountainShow, tube, catapult (C4); crane, stomper, teacup, slick,
 * bumperCar, wheel (C4b) (content-plan §5.3). Day-0 skeleton by C0: no-op GimmickSystem hooks and
 * the `buildGimmicks` buildV2 callback. Kinematic poses are a pure function of (tick, substep).
 */
import type { SimContext } from './context';
import { ContentSystemBase } from './systemBase';
import type { LayoutV2Def } from './types';

/**
 * buildV2 callback [C4]: one GimmickState per LayoutV2Def.gimmicks entry (same order and id) in
 * ctx.state.gimmicks, plus any kinematic bodies, unless rules.gimmicks is false.
 * Runs after breakables, before item pads.
 */
export function buildGimmicks(_ctx: SimContext, _v2: LayoutV2Def): void {
  // C4
}

export class GimmickSystem extends ContentSystemBase {
  readonly name = 'gimmicks' as const;
}
