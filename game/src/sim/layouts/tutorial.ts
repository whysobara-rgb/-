/**
 * 연습 (Practice) — the ~50 s tutorial yard (doc §3 "처음 5분").
 *
 * Beats the layout supports, in order:
 *  0–10 s  spawn next to the van; a 100-point small safe sits a few steps away with the
 *          van and zone in plain view ("무엇을 어디로 가져오는가").
 *  10–25 s carry that safe into the zone (+100).
 *  25–50 s go through the north side gate and follow the arrows along the hedge to the
 *          BACK of the bank, unanchor it and push it straight west: the only bank-wide way
 *          home is a weak fence on the short path, which the moving bank busts
 *          ("짧은 길의 펜스를 뚫고 통째 회수").
 *
 * Why the back: a character pulling the bank from its front face walks into the fence
 * first and gets pinned between fence and bank, so the fence never breaks; a side pull from
 * the 1.1 m hedge alleys yaws the bank and stalls too. Hedges along the bank yard therefore
 * make the natural approach (north gate -> along the hedge) end BEHIND the bank, where a push
 * west unanchors it and busts the fence. Verified in the real sim: pushing from anywhere on
 * the back wall breaks the fence ~7 s after unanchoring and the bank reaches the zone ~23 s
 * after grabbing. The tutorial UI should say "은행 뒤에서 밀어요" at this step.
 * Two more small safes in the side strips let curious players keep practicing.
 *
 * Single team, not mirrored.
 */
import { LayoutBuilder } from './builder';
import type { LayoutDesignMeta } from './meta';
import type { LayoutDef } from '../types';

const W = 40;
const H = 28;
const PI = Math.PI;
const ZONE = { x: 10, y: 14 };
const BANK = { x: 29.5, y: 14 };

function build(): { def: LayoutDef; meta: LayoutDesignMeta } {
  const b = new LayoutBuilder({
    id: 'tutorial',
    size: { x: W, y: H },
    nameKey: 'layout.tutorial.name',
    descKey: 'layout.tutorial.desc',
    groundStyle: 'practice',
    mirror: false,
  });

  b.zone(ZONE, { x: 1.6, y: 14 }, -PI / 2);
  b.spawn(6, 5.5, 0);

  const bank = b.bank(BANK.x, BANK.y, PI / 2);
  // Divider between the van yard and the bank yard: low walls with two 2.5 m side gates, and
  // the weak fence spanning the bank-wide gap on the short path (overlapping the wall ends).
  const fence = b.fence('fence.practice', 20, 14, 0.15, 5.2);
  b.route(bank, [BANK, ZONE], [fence]);

  b.rect('wall.n', 'wall', 19.5, 0, 20.5, 1.5, 1.2);
  b.rect('wall.nm', 'wall', 19.5, 4.0, 20.5, 8.9, 1.2);
  b.rect('wall.sm', 'wall', 19.5, 19.1, 20.5, 24.0, 1.2);
  b.rect('wall.s', 'wall', 19.5, 26.5, 20.5, 28, 1.2);
  b.path('gate.n', 'medium', { x: 19.6, y: 2.75 }, { x: 20.4, y: 2.75 });
  b.path('gate.s', 'medium', { x: 19.6, y: 25.25 }, { x: 20.4, y: 25.25 });
  // Hedges frame the bank's 10 m lane (5.1 m from its centerline) and steer the gate paths
  // around to the back of the bank; 1.1 m alleys remain between hedge and bank sides.
  b.rect('hedge.n', 'planter', 20.5, 7.8, 31.0, 8.9, 0.9);
  b.rect('hedge.s', 'planter', 20.5, 19.1, 31.0, 20.2, 0.9);
  b.path('bankside.n', 'narrow', { x: 27.0, y: 9.45 }, { x: 30.5, y: 9.45 });
  b.path('bankside.s', 'narrow', { x: 27.0, y: 18.55 }, { x: 30.5, y: 18.55 });

  // Shops framing the bank yard (east) and the van yard (north/south edges).
  b.rect('shop.e1', 'building', 36.5, 8, 40, 20, 6, { style: 'brick', signKey: 'sign.practice' });
  b.rect('shop.n1', 'building', 24, 0, 33, 2.5, 5, { style: 'cafe', signKey: 'sign.cafe' });
  b.rect('shop.s1', 'building', 24, 25.5, 33, 28, 5, { style: 'bakery', signKey: 'sign.bakery' });
  b.rect('shop.nw', 'building', 3, 0, 12, 2, 4.5, { style: 'toy', signKey: 'sign.toy' });
  b.rect('shop.sw', 'building', 3, 26, 12, 28, 4.5, { style: 'flower', signKey: 'sign.flower' });
  b.circle('tree.ne', 'tree', 38.2, 3.5, 0.9, 5);
  b.circle('tree.se', 'tree', 38.2, 24.5, 0.9, 5);
  b.circle('lamp.a', 'lamp', 15.5, 2.5, 0.15, 3.2);
  b.circle('lamp.b', 'lamp', 15.5, 25.5, 0.15, 3.2);
  b.box('bench.a', 'bench', 26, 4.2, 0.9, 0.3, 0.5);
  b.box('planter.a', 'planter', 34.5, 24.2, 1.0, 0.6, 0.8);

  // Loot: one right by the spawn, two in the bank yard's side strips.
  b.safe('smallSafe', 11.5, 5.0);
  b.safe('smallSafe', 34.5, 4.5);
  b.safe('smallSafe', 30.0, 22.5);

  b.choke('choke.tutorial.northGate', 'choke.tutorial.northGate', 20, 2.75, 2);
  b.choke('choke.tutorial.southGate', 'choke.tutorial.southGate', 20, 25.25, 2);

  // Guidance: van yard -> north gate -> along the hedge -> round the corner -> behind the
  // bank, where a "push" arrow points home through the fence.
  b.decor('arrow', 8.5, 5.0, 0);
  b.decor('arrow', 13.0, 7.2, PI / 2);
  b.decor('arrow', 17.0, 2.75, 0);
  b.decor('arrow', 23.0, 2.75, 0);
  b.decor('arrow', 29.0, 6.4, 0);
  b.decor('arrow', 33.8, 8.6, PI / 2);
  b.decor('arrow', 34.6, 12.0, PI, { scale: 1.4 });
  b.decor('arrow', 34.6, 16.0, PI, { scale: 1.4 });
  b.decor('sign', 35.8, 9.2, 0); // "밀어요!" practice sign behind the bank
  b.decor('cone', 21.0, 9.5, 0);
  b.decor('cone', 21.0, 18.5, 0);
  b.decor('flowers', 2.0, 3.0, 0, { color: '#F28DB2' });
  b.decor('flowers', 2.0, 25.0, 0, { color: '#FFD166' });
  b.decor('flowers', 22.5, 7.4, 0, { color: '#F7B6D2' });
  b.decor('flowers', 22.5, 20.6, 0, { color: '#C3A6F2' });
  b.decor('balloon', 13.0, 2.6, 0, { color: '#FF6FA5' });
  b.decor('balloon', 35.5, 6.5, 0, { color: '#7BDFF2' });
  b.decor('umbrella', 27.5, 2.8, 0, { color: '#F25C54' });
  b.decor('crate', 35.5, 21.5, 0.3);
  b.decor('puddle', 25.0, 22.0, 0);

  return b.build(
    'Practice yard: spawn by the van, carry the nearby 100 safe, then follow the arrows through the north gate and along the ' +
      'hedge to the back of the bank, uproot it and push it straight home, busting the weak fence on the short path.',
  );
}

const built = build();
export const TUTORIAL: LayoutDef = built.def;
export const TUTORIAL_META: LayoutDesignMeta = built.meta;
