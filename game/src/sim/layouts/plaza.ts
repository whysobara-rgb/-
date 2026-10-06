/**
 * 수집 광장 (Collection Plaza) — the first-playable match layout (doc §9, §16).
 *
 * Identity (doc §9 table): outer small safes are easy to reach, while the banks'
 * wide recovery paths are relatively long. A central park (flower beds, kiosks and
 * a round fountain plaza) sits between the two banks and both zones, so a bank can
 * never cut across: it has to roll along the north or south boulevard and swing
 * down into the zone (~41 m vs ~33 m straight). Small safes tucked in the corners
 * next to each van reward steady early collecting; the two large safes wait on the
 * loading docks behind the on-axis stores (reached through the service lanes), and two small
 * safes guard the fountain.
 *
 * Paths: shop rows have 1.1 m alleys (small safes) and one 2.5 m gate lane each
 * (large safes) into a 2.5 m service lane; the park has a 2.5 m flower road from
 * the fountain to each zone and 1.1 m hedge alleys from the boulevards.
 *
 * Authored for the west half; the builder mirrors everything to the east half.
 * The layout is also north/south symmetric (helper `ns`), with different shops.
 */
import { LayoutBuilder } from './builder';
import type { LayoutDesignMeta } from './meta';
import type { LayoutDef } from '../types';

const W = 80;
const H = 52;
const AX = W / 2;
const PI = Math.PI;

const BANK_N = { x: AX, y: 12.5 };
const BANK_S = { x: AX, y: H - 12.5 };
const ZONE = { x: 10, y: 26 };
/** Loading dock in the back of each on-axis store (half width, depth from the service lane). */
const DOCK_HALF = 1.5;
const DOCK_DEPTH = 2;

function build(): { def: LayoutDef; meta: LayoutDesignMeta } {
  const b = new LayoutBuilder({
    id: 'plaza',
    size: { x: W, y: H },
    nameKey: 'layout.plaza.name',
    descKey: 'layout.plaza.desc',
    groundStyle: 'plaza',
  });

  /** Runs `fn` for the north band (y as given) and the south band (y mirrored). */
  const ns = (fn: (y: (v: number) => number, side: 'n' | 's') => void): void => {
    fn((v) => v, 'n');
    fn((v) => H - v, 's');
  };

  // --- teams ---------------------------------------------------------------------
  b.zone(ZONE, { x: 1.6, y: 26 }, -PI / 2);
  b.spawn(5.5, 22.25, 0);
  b.spawn(5.5, 29.75, 0);

  // --- banks + routes ----------------------------------------------------------------
  const bn = b.bank(BANK_N.x, BANK_N.y, PI / 2);
  const bs = b.bank(BANK_S.x, BANK_S.y, PI / 2);
  // Along the boulevard, then swing down/up into the zone (the park blocks the diagonal).
  b.route(bn, [BANK_N, { x: 14, y: 12.5 }, { x: 10.5, y: 16.5 }, ZONE]);
  b.route(bs, [BANK_S, { x: 14, y: H - 12.5 }, { x: 10.5, y: H - 16.5 }, ZONE]);

  // --- shop rows (north + south) with a service lane behind ------------------------------
  // Service lane y 0..2.5; shops y 2.5..6.5; boulevard below (banks roll at y = 12.5).
  // x: 4..11.45 | alley 11.45..12.55 | 12.55..20.75 | gate lane 20.75..23.25 |
  //    23.25..AX-8.55 | alley AX-8.55..AX-7.45 | on-axis store AX-7.45..AX+7.45
  type Shop = [style: string, sign: string, eastStyle: string, eastSign: string, height: number];
  const rows: Record<'n' | 's', Shop[]> = {
    n: [
      ['cafe', 'sign.cafe', 'tea', 'sign.tea', 6],
      ['bakery', 'sign.bakery', 'bakery', 'sign.donut', 6.5],
      ['toy', 'sign.toy', 'arcade', 'sign.arcade', 7],
    ],
    s: [
      ['flower', 'sign.flower', 'icecream', 'sign.icecream', 6],
      ['books', 'sign.books', 'music', 'sign.music', 6.5],
      ['ramen', 'sign.ramen', 'laundry', 'sign.laundry', 7],
    ],
  };
  ns((y, side) => {
    const spans: [number, number][] = [
      [4, 11.45],
      [12.55, 20.75],
      [23.25, AX - 8.55],
    ];
    spans.forEach(([x0, x1], i) => {
      const [style, signKey, eStyle, eSign, h] = rows[side][i];
      b.rect(`shop.${side}${i}`, 'building', x0, y(2.5), x1, y(6.5), h, { style, signKey, east: { style: eStyle, signKey: eSign } });
    });
    // On-axis block behind each bank: two shops (post office | photo studio north, pharmacy |
    // greengrocer south) joined by a low loading-dock gate set back 2 m, so the large safe
    // waits in a 3 x 2 m dock off the service lane and the lane itself stays clear.
    b.rect(`store.${side}`, 'building', AX - 7.45, y(2.5), AX - DOCK_HALF, y(6.5), 7.5, {
      style: side === 'n' ? 'brick' : 'pharmacy',
      signKey: side === 'n' ? 'sign.post' : 'sign.pharmacy',
      east: side === 'n' ? { style: 'glass', signKey: 'sign.photo' } : { style: 'grocery', signKey: 'sign.grocery' },
    });
    b.rect(`dock.${side}`, 'wall', AX - DOCK_HALF, y(2.5 + DOCK_DEPTH), AX + DOCK_HALF, y(6.5), 3.2);
    // Declared paths.
    b.path(`alley.${side}1`, 'narrow', { x: 12, y: y(3) }, { x: 12, y: y(6) });
    b.path(`alley.${side}2`, 'narrow', { x: AX - 8, y: y(3) }, { x: AX - 8, y: y(6) });
    b.path(`gate.${side}`, 'medium', { x: 22, y: y(3) }, { x: 22, y: y(6) });
    b.path(`service.${side}a`, 'medium', { x: 5, y: y(1.25) }, { x: 10.5, y: y(1.25) });
    b.path(`service.${side}b`, 'medium', { x: 13.5, y: y(1.25) }, { x: 19.5, y: y(1.25) });
    b.path(`service.${side}c`, 'medium', { x: 24.5, y: y(1.25) }, { x: AX - 9.5, y: y(1.25) });
    b.path(`service.${side}d`, 'medium', { x: AX - 6.5, y: y(1.25) }, { x: AX - DOCK_HALF - 0.5, y: y(1.25) });
    // Street lamps on the shop-front curb (thin poles keep the boulevard clear for banks).
    for (const lx of [8, 16.5, 27.5, AX - 4]) b.circle(`lamp.${side}${lx}`, 'lamp', lx, y(7.0), 0.15, 3.2);
    // Corner tree in the outer nook (leaves a 2.5 m path between lane and boulevard).
    b.circle(`tree.${side}corner`, 'tree', 0.9, y(6.2), 0.6, 4.5);
    b.circle(`tree.${side}west`, 'tree', 1.4, y(17.6), 0.6, 4.5);
  });

  // --- central park ----------------------------------------------------------------------
  b.circle('fountain', 'fountain', AX, 26, 2.6, 1.2);
  ns((y, side) => {
    // Hedge/kiosk blocks between boulevard and flower road, split by a 1.1 m hedge alley at x = 25.
    b.rect(`bed.${side}a`, 'planter', 18, y(18.5), 24.45, y(24.75), 0.9);
    b.rect(`kiosk.${side}`, 'kiosk', 25.55, y(18.5), AX - 6, y(21), 2.6, { style: side === 'n' ? 'tteokbokki' : 'lemonade' });
    b.rect(`bed.${side}b`, 'planter', 25.55, y(21), AX - 6, y(24.75), 0.9);
    b.path(`hedge.${side}`, 'narrow', { x: 25, y: y(19) }, { x: 25, y: y(24.25) });
    // Trees growing in the beds.
    b.circle(`tree.${side}a`, 'tree', 20.5, y(20.75), 0.9, 5);
    b.circle(`tree.${side}b`, 'tree', 22.75, y(23.0), 0.7, 4.5);
    b.circle(`tree.${side}c`, 'tree', AX - 7.75, y(23.0), 0.7, 4.5);
    // Fountain-plaza benches (facing the fountain) and lamps.
    b.box(`bench.${side}`, 'bench', AX - 3, y(21.5), 0.9, 0.3, 0.5, { angle: side === 'n' ? -PI / 5 : PI / 5 });
    b.circle(`lamp.f${side}`, 'lamp', AX - 4.75, y(19.25), 0.15, 3.2);
  });
  b.path('flower.a', 'medium', { x: 18.5, y: 26 }, { x: 24, y: 26 });
  b.path('flower.b', 'medium', { x: 26, y: 26 }, { x: AX - 6.5, y: 26 });

  // --- loot ---------------------------------------------------------------------------------
  b.safe('smallSafe', 3.0, 10.0); // NW corner nook, a short jog from the van
  b.safe('smallSafe', 3.0, H - 10.0); // SW corner nook
  b.safe('smallSafe', AX, 21.0); // fountain north (contested, on axis)
  b.safe('smallSafe', AX, H - 21.0); // fountain south
  b.safe('largeSafe', AX, 3.4); // loading dock behind the post office
  b.safe('largeSafe', AX, H - 3.4); // loading dock behind the pharmacy

  // --- chokepoints ----------------------------------------------------------------------------
  b.choke('choke.plaza.flowerRoadW', 'choke.plaza.flowerRoadW', 21, 26, 2.5, { id: 'choke.plaza.flowerRoadE', nameKey: 'choke.plaza.flowerRoadE' });
  b.choke('choke.plaza.bakeryAlley', 'choke.plaza.bakeryAlley', 12, 7.5, 2, { id: 'choke.plaza.donutAlley', nameKey: 'choke.plaza.donutAlley' });
  b.choke('choke.plaza.bookAlley', 'choke.plaza.bookAlley', 12, H - 7.5, 2, { id: 'choke.plaza.musicAlley', nameKey: 'choke.plaza.musicAlley' });
  b.choke('choke.plaza.fountain', 'choke.plaza.fountain', AX, 22.6, 4);
  b.choke('choke.plaza.postLane', 'choke.plaza.postLane', AX, 1.25, 3);

  // --- decor (visual only) ----------------------------------------------------------------------
  ns((y, side) => {
    const n = side === 'n';
    // Shop-front terraces: umbrellas, flower pots, balloons by the toy store / arcade.
    b.decor('umbrella', 7.0, y(8.2), 0, { color: n ? '#F25C54' : '#4FB0C6', east: { color: '#F7B32B' } });
    b.decor('umbrella', 9.6, y(8.4), 0, { color: n ? '#FFD166' : '#F7B6D2', east: { color: '#7BDFF2' } });
    b.decor('flowers', 15.0, y(7.3), 0, { color: '#F28DB2' });
    b.decor('flowers', 18.5, y(7.3), 0, { color: '#FFD166' });
    b.decor('balloon', 26.0, y(7.6), 0, { color: '#FF6FA5', east: { color: '#7BDFF2' } });
    b.decor('balloon', 27.0, y(7.4), 0, { color: '#FFD166' });
    b.decor('sign', AX - 6, y(7.6), 0);
    b.decor('flowers', AX - 2.5, y(7.3), 0, { color: '#C3A6F2' });
    // Service lane clutter (medium lanes only; narrow alleys stay clean).
    b.decor('crate', 6.0, y(0.6), 0);
    b.decor('crate', 6.9, y(0.6), 0.4);
    b.decor('trash', 15.5, y(0.6), 0);
    b.decor('crate', 26.5, y(0.6), 0.3);
    b.decor('trash', AX - 4.5, y(0.6), 0);
    // Park edges and beds.
    b.decor('flowers', 19.0, y(18.0), 0, { color: '#F7B6D2' });
    b.decor('flowers', 23.5, y(18.0), 0, { color: '#C3A6F2' });
    b.decor('bush', AX - 6.5, y(18.0), 0);
    b.decor('flowers', 19.2, y(23.4), 0, { color: '#FF8FAB' });
    b.decor('flowers', 27.5, y(23.6), 0, { color: '#FFD166' });
    b.decor('flowers', 31.0, y(22.0), 0, { color: '#F28DB2' });
    b.decor('flowers', AX - 4, y(23.5), 0, { color: '#FFD166' });
    // Corner nook + boulevard dressing.
    b.decor('bush', 1.0, y(0.9), 0);
    b.decor('flowers', 2.4, y(7.5), 0, { color: '#F28DB2' });
    b.decor('cone', 1.0, y(13.5), 0);
    b.decor('puddle', 13.5, y(10.0), 0, { scale: 1.2 });
    b.decor('puddle', 30.0, y(14.5), 0, { scale: 0.9 });
    b.decor('sign', 17.0, y(17.6), 0); // bus-stop style post at the park corner
  });
  // Arrows toward the van on the flower road and the boulevard exits.
  b.decor('arrow', 17.5, 25.0, PI);
  b.decor('arrow', 17.5, 27.0, PI);
  b.decor('arrow', 3.0, 18.5, PI / 2);
  b.decor('arrow', 3.0, H - 18.5, -PI / 2);
  b.decor('balloon', AX - 6.6, 24.2, 0, { color: '#FFD166' });
  b.decor('balloon', AX - 6.6, 27.8, 0, { color: '#7BDFF2' });
  b.decor('umbrella', AX - 4.2, 26.0, 0, { color: '#F25C54', east: { color: '#4FB0C6' } });

  return b.build(
    'Collection plaza: banks north/south of a central park must roll the long way along the boulevards and swing into the zones; ' +
      'corner small safes near each van reward steady early collecting; large safes in the service lanes need the 2.5 m gate lanes; ' +
      'fountain small safes are the contested middle.',
  );
}

const built = build();
export const PLAZA: LayoutDef = built.def;
export const PLAZA_META: LayoutDesignMeta = built.meta;
