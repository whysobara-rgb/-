/**
 * 열린 창구 (Open Counter) — match layout.
 *
 * Identity (doc §9 table): the bank doors face a shared central crossing that both
 * teams reach easily. The two banks sit north and south on the axis with their front
 * doors looking at a clock-tower square that also holds both large safes. Bank routes
 * are short straight diagonals (~27 m) across an open square, so the decision is
 * "move the bank fast, guard its door, or strip it first".
 *
 * The north bank faces south (angle 0) and the south bank faces north (angle PI). Door
 * direction is this layout's identity (doc §9: "출입문이 공용 교차로를 향해"), and with the doors
 * on the bank model's local ±y walls only 0 / PI can point them at the crossing. The shared
 * model's interior is not mirror-symmetric in local x (large safe at -x), so:
 *  - each bank on its own is still fair: walls block grabbing, every interior safe is reached
 *    and carried out only through the on-axis doors, so its walk-in and carry-home distances
 *    are identical for both teams (validate.ts interiorFairness measures this);
 *  - the 0 / PI pairing balances the sides: the north bank's large safe is on the west, the
 *    south bank's on the east (both banks at 0 would put both on team 0's side — rejected).
 * Angle PI/2 would make each interior a mirror image of itself but turn the doors toward the
 * vans, which is what 수집 광장 and 지름길 상가 already do.
 *
 * Sides: terraced shop blocks whose stepped corners stay out of the bank diagonals, with
 * a 2.5 m edge lane, two 2.5 m terrace lanes (one leads straight to the bank's back door)
 * and a 1.1 m alley between them.
 */
import { LayoutBuilder } from './builder';
import type { LayoutDesignMeta } from './meta';
import type { LayoutDef } from '../types';

const W = 68;
const H = 48;
const PI = Math.PI;
const AX = W / 2;
const ZONE = { x: 10, y: 24 };
/**
 * Bank centers sit 14 m from the middle: the front-door steps are then ~10 m from the clock
 * tower, the closest any spot gets to a door of both banks (doc §6: no easy one-spot defense).
 */
const BANK_Y = 10;
/** Half width of the on-axis police gate through the edge buildings behind each bank. */
const POLICE_GATE_HALF = 1.5;

function build(): { def: LayoutDef; meta: LayoutDesignMeta } {
  const b = new LayoutBuilder({
    id: 'counter',
    size: { x: W, y: H },
    nameKey: 'layout.counter.name',
    descKey: 'layout.counter.desc',
    groundStyle: 'square',
  });
  const ns = (fn: (y: (v: number) => number, side: 'n' | 's') => void): void => {
    fn((v) => v, 'n');
    fn((v) => H - v, 's');
  };

  // --- teams -----------------------------------------------------------------------
  b.zone(ZONE, { x: 1.6, y: 24 }, -PI / 2);
  b.spawn(6, 20.25, 0);
  b.spawn(6, 27.75, 0);

  // --- banks: front doors face the central crossing ------------------------------------
  const bn = b.bank(AX, BANK_Y, 0);
  const bs = b.bank(AX, H - BANK_Y, PI);
  b.route(bn, [{ x: AX, y: BANK_Y }, ZONE]);
  b.route(bs, [{ x: AX, y: H - BANK_Y }, ZONE]);

  // --- terraced side blocks ----------------------------------------------------------------
  // Stepped corners satisfy 0.476 x + 0.879 y <= 20.45 (>= 5.4 m from the bank diagonal).
  // [west style, west sign, east style, east sign]; every sign appears once per layout so the
  // alley chokepoints ("빵집 골목", "빨래방 골목") name exactly one landmark.
  const signs = {
    n: {
      r0a: ['icecream', 'sign.icecream', 'grocery', 'sign.grocery'],
      r0b: ['cafe', 'sign.cafe', 'tea', 'sign.tea'],
      r0c: ['books', 'sign.books', 'music', 'sign.music'],
      r1a: ['bakery', 'sign.bakery', 'bakery', 'sign.donut'],
      r1b: ['toy', 'sign.toy', 'arcade', 'sign.arcade'],
      r2: ['ramen', 'sign.ramen', 'hanok', 'sign.dumpling'],
    },
    s: {
      r0a: ['bike', 'sign.bike', 'pharmacy', 'sign.pharmacy'],
      r0b: ['glass', 'sign.photo', 'brick', 'sign.stationery'],
      r0c: ['hanok', 'sign.tteok', 'tea', 'sign.bubbletea'],
      r1a: ['laundry', 'sign.laundry', 'flower', 'sign.flower'],
      r1b: ['arcade', 'sign.boardgame', 'toy', 'sign.candy'],
      r2: ['bakery', 'sign.toast', 'flower', 'sign.plant'],
    },
  } as const;
  ns((y, side) => {
    const sg = signs[side];
    const shop = (id: keyof typeof sg, x0: number, y0: number, x1: number, y1: number, h: number): void => {
      const [style, signKey, eStyle, eSign] = sg[id];
      b.rect(`${id}.${side}`, 'building', x0, y(y0), x1, y(y1), h, { style, signKey, east: { style: eStyle, signKey: eSign } });
    };
    // Row 0 along the outer edge; behind the bank, two on-axis blocks (post office / mall and a
    // police box) flank the 3 m police gate the officers hop in through (dead end at the edge).
    shop('r0a', 0, 0, 8, 4.75, 5.5);
    shop('r0b', 8, 0, 17, 4.75, 6);
    shop('r0c', 17, 0, 26, 4.75, 6.5);
    b.rect(`axis.${side}`, 'building', 26, y(0), AX - POLICE_GATE_HALF, y(4.75), 7.5, {
      style: side === 'n' ? 'brick' : 'glass',
      signKey: side === 'n' ? 'sign.post' : 'sign.mall',
      east: { signKey: side === 'n' ? 'sign.policeBoxN' : 'sign.policeBoxS' },
    });
    // Row 1 (between terrace lane A and B), split by the 1.1 m alley at x = 10.
    shop('r1a', 2.5, 7.25, 9.45, 11, 5);
    shop('r1b', 10.55, 7.25, 20.5, 11, 5.5);
    // Row 2 (corner by the zone).
    shop('r2', 2.5, 13.5, 10, 17, 5);
    // Paths.
    b.path(`edgeLane.${side}`, 'medium', { x: 1.25, y: y(8) }, { x: 1.25, y: y(10.5) });
    b.path(`edgeLane2.${side}`, 'medium', { x: 1.25, y: y(14) }, { x: 1.25, y: y(16.5) });
    b.path(`laneA.${side}`, 'medium', { x: 3, y: y(6) }, { x: 9, y: y(6) });
    b.path(`laneA2.${side}`, 'medium', { x: 11, y: y(6) }, { x: 20, y: y(6) });
    b.path(`laneB.${side}`, 'medium', { x: 3, y: y(12.25) }, { x: 9, y: y(12.25) });
    b.path(`alley.${side}`, 'narrow', { x: 10, y: y(7.75) }, { x: 10, y: y(10.5) });
    // Lamps on the terrace corners (outside the diagonal sweep).
    b.circle(`lamp.${side}a`, 'lamp', 21.0, y(7.0), 0.15, 3.2);
    b.circle(`lamp.${side}b`, 'lamp', 10.75, y(13.25), 0.15, 3.2);
    b.circle(`tree.${side}a`, 'tree', 24.5, y(5.6), 0.6, 4.5);
  });

  // --- central square: clock tower, benches, large safes in front of the doors ---------------
  b.circle('clock', 'statue', AX, 24, 1.2, 6);
  b.box('bench.c', 'bench', 30.5, 24, 0.3, 0.9, 0.5);
  b.circle('lamp.c', 'lamp', 29.5, 21.0, 0.15, 3.2);
  b.circle('lamp.c2', 'lamp', 29.5, 27.0, 0.15, 3.2);
  // Tea kiosk at the square's west tip: splits the zone approach into two lanes and
  // breaks the long zone-to-zone sightline without touching the bank diagonals.
  b.box('kiosk.tip', 'kiosk', 23.5, 24, 0.9, 0.9, 2.6, { style: 'tea' });
  ns((y, side) => {
    // Planter beds flanking the bank fronts and back yards (outside the diagonals).
    b.box(`bed.front.${side}`, 'planter', 26.2, y(5.25), 1.2, 0.5, 0.8);
    b.circle(`tree.${side}b`, 'tree', 13.0, y(15.6), 0.5, 4);
  });

  // --- loot -------------------------------------------------------------------------------------
  b.safe('largeSafe', AX, 19.5); // in front of the north bank's door
  b.safe('largeSafe', AX, H - 19.5); // in front of the south bank's door
  b.safe('smallSafe', 6, 12.25); // terrace lane B, a short walk from the van
  b.safe('smallSafe', 6, H - 12.25);
  b.safe('smallSafe', 26, 24); // west edge of the square
  // --- chokepoints ------------------------------------------------------------------------------
  // Door-side watch spots: the counter in front of each bank (front door + its large safe)
  // and the back-door lanes. North and south twins so guarding never favors one bank.
  b.choke('choke.counter.northCounter', 'choke.counter.northCounter', AX, 15.6, 3.5);
  b.choke('choke.counter.southCounter', 'choke.counter.southCounter', AX, H - 15.6, 3.5);
  b.choke('choke.counter.northBackDoor', 'choke.counter.northBackDoor', AX, 5.9, 2.5);
  b.choke('choke.counter.southBackDoor', 'choke.counter.southBackDoor', AX, H - 5.9, 2.5);
  b.choke('choke.counter.bakeryAlley', 'choke.counter.bakeryAlley', 10, 9, 2, { id: 'choke.counter.donutAlley', nameKey: 'choke.counter.donutAlley' });
  b.choke('choke.counter.laundryAlley', 'choke.counter.laundryAlley', 10, H - 9, 2, { id: 'choke.counter.flowerAlley', nameKey: 'choke.counter.flowerAlley' });

  // --- decor --------------------------------------------------------------------------------------
  ns((y, side) => {
    const n = side === 'n';
    b.decor('umbrella', 22.5, y(9.0), 0, { color: n ? '#F25C54' : '#7BDFF2', east: { color: '#F7B32B' } });
    b.decor('flowers', 14.0, y(11.6), 0, { color: '#F28DB2' });
    b.decor('flowers', 4.0, y(17.6), 0, { color: '#FFD166' });
    b.decor('crate', 4.0, y(5.4), 0.2);
    b.decor('trash', 19.5, y(5.4), 0);
    b.decor('balloon', 28.0, y(6.0), 0, { color: '#FF6FA5', east: { color: '#7BDFF2' } });
    b.decor('sign', 31.0, y(15.6), 0); // "창구" sign at the bank front
    b.decor('puddle', 16.0, y(15.5), 0, { scale: 1.1 });
  });
  ns((y, side) => {
    const n = side === 'n';
    // Terrace dressing: flower pots by the shops, a balloon cart by the toy store/arcade.
    b.decor('flowers', 5.5, y(6.4), 0, { color: '#FFD166' });
    b.decor('flowers', 13.0, y(6.4), 0, { color: '#F7B6D2' });
    b.decor('balloon', 17.5, y(11.8), 0, { color: n ? '#FF6FA5' : '#7BDFF2', east: { color: '#FFD166' } });
    b.decor('balloon', 18.3, y(12.0), 0, { color: '#C3A6F2' });
    b.decor('umbrella', 7.5, y(18.0), 0, { color: n ? '#F7B32B' : '#4FB0C6', east: { color: '#F25C54' } });
    b.decor('cone', 30.6, y(6.6), 0);
    b.decor('cone', 37.4 - 4.8, y(5.3), 0);
    b.decor('crate', 21.8, y(5.3), 0.4);
    b.decor('flowers', 25.5, y(5.25), 0, { color: '#F28DB2' });
    b.decor('flowers', 26.9, y(5.25), 0, { color: '#FFD166' });
    // Cafe tables outside the bank fronts (the "counter" queue).
    b.decor('umbrella', 30.0, y(16.6), 0, { color: n ? '#F25C54' : '#7BDFF2', east: { color: '#F7B32B' } });
    b.decor('sign', 32.2, y(17.6), 0);
  });
  b.decor('flowers', 31.6, 22.0, 0, { color: '#C3A6F2' });
  b.decor('flowers', 31.6, 26.0, 0, { color: '#F7B6D2' });
  b.decor('arrow', 18.0, 24.0, PI);
  b.decor('arrow', 1.25, 19.0, PI / 2);
  b.decor('arrow', 1.25, H - 19.0, -PI / 2);

  // --- police (owner addition) --------------------------------------------------------------
  // Cars pull up at the curb outside the north edge (wave 1) and the south edge (wave 2) on the
  // mirror axis; officers hop the fence into the police gate and come out at the bank's back lane.
  b.policeCurbs();

  return b.build(
    'Open counter: both bank fronts face a shared clock-tower crossing that also holds the two large safes. Bank routes are short ' +
      'straight diagonals across the open square, so the fight is about moving fast, guarding the door, or stripping the bank first. ' +
      'Terraced side blocks give small-safe alleys and back-door lanes.',
  );
}

const built = build();
export const COUNTER: LayoutDef = built.def;
export const COUNTER_META: LayoutDesignMeta = built.meta;
