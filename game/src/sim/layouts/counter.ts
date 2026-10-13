/**
 * 열린 창구 (Open Counter) — match layout.
 *
 * Identity (doc §9 table): the bank doors face a shared central crossing that both
 * teams reach easily. The two banks sit north and south on the axis with their front
 * doors looking at a clock-tower square that also holds both large safes. Bank routes
 * are short straight diagonals across an open square (25 m to the near south bank, 32 m to the
 * north one: the zones sit 7 m south of the middle), so the decision is "move the bank fast,
 * guard its door, or strip it first" — and the near bank is the one both teams race for.
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
import { BREAKABLE_SPECS, PROP_SPECS } from '../config';
import { LayoutBuilder } from './builder';
import type { LayoutDesignMeta } from './meta';
import type { LayoutDef } from '../types';

const W = 68;
const H = 48;
const PI = Math.PI;
const AX = W / 2;
/**
 * (balance pass) The zones sit 7 m south of the middle line: the south bank is the near,
 * contested one for BOTH teams (~25 m) and the north bank the long haul (~32 m). With both banks
 * equally far, mirrored bots and players hauled one bank each at the same moment (1v1 draws
 * ~25 %, matches over in ~110 s); a near / far pair makes them race for one bank and leaves the
 * other for the mid-game. Mirror symmetry (x) is untouched.
 */
const ZONE_DY = 7;
const ZONE = { x: 10, y: 24 + ZONE_DY };
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
  b.zone(ZONE, { x: 1.6, y: ZONE.y }, -PI / 2);
  b.spawn(6, ZONE.y - 3.75, 0);
  b.spawn(6, ZONE.y + 3.75, 0);

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
    if (side === 'n') {
      shop('r0a', 0, 0, 8, 4.75, 5.5);
      shop('r0b', 8, 0, 17, 4.75, 6);
      shop('r0c', 17, 0, 26, 4.75, 6.5);
    } else {
      // south edge row: four narrower shops (the corner shop by the zone moved out here)
      shop('r0a', 0, 0, 6.5, 4.75, 5.5);
      shop('r0b', 6.5, 0, 13, 4.75, 6);
      shop('r0c', 13, 0, 19.5, 4.75, 6.5);
      shop('r2', 19.5, 0, 26, 4.75, 5);
    }
    b.rect(`axis.${side}`, 'building', 26, y(0), AX - POLICE_GATE_HALF, y(4.75), 7.5, {
      style: side === 'n' ? 'brick' : 'glass',
      signKey: side === 'n' ? 'sign.post' : 'sign.mall',
      east: { signKey: side === 'n' ? 'sign.policeBoxN' : 'sign.policeBoxS' },
    });
    if (side === 'n') {
      // Row 1 (between terrace lane A and B), split by the 1.1 m alley at x = 10.
      shop('r1a', 2.5, 7.25, 9.45, 11, 5);
      shop('r1b', 10.55, 7.25, 20.5, 11, 5.5);
      // Row 2 (corner by the far end of the zone).
      shop('r2', 2.5, 13.5, 10, 17, 5);
      b.path(`edgeLane2.${side}`, 'medium', { x: 1.25, y: y(14) }, { x: 1.25, y: y(16.5) });
      b.path(`laneB.${side}`, 'medium', { x: 3, y: y(12.25) }, { x: 9, y: y(12.25) });
      b.circle(`lamp.${side}b`, 'lamp', 10.75, y(13.25), 0.15, 3.2);
      b.path(`alley.${side}`, 'narrow', { x: 10, y: y(7.75) }, { x: 10, y: y(10.5) });
    } else {
      // South row 1 right behind the zone: shallower, and its east shop ends short of the
      // south bank's diagonal sweep.
      shop('r1a', 2.5, 7.25, 9.45, 10.0, 5);
      shop('r1b', 10.55, 7.25, 15.5, 10.0, 5.5);
      b.path(`alley.${side}`, 'narrow', { x: 10, y: y(7.75) }, { x: 10, y: y(9.75) });
    }
    // Paths.
    b.path(`edgeLane.${side}`, 'medium', { x: 1.25, y: y(8) }, { x: 1.25, y: y(side === 'n' ? 10.5 : 9.75) });
    b.path(`laneA.${side}`, 'medium', { x: 3, y: y(6) }, { x: 9, y: y(6) });
    b.path(`laneA2.${side}`, 'medium', { x: 11, y: y(6) }, { x: side === 'n' ? 20 : 15, y: y(6) });
    // Lamps on the terrace corners (outside the diagonal sweep).
    b.circle(`lamp.${side}a`, 'lamp', 21.0, y(7.0), 0.15, 3.2);
    b.circle(`tree.${side}a`, 'tree', 24.5, y(5.6), 0.6, 4.5);
  });

  // --- central square: clock tower, benches, large safes in front of the doors ---------------
  b.circle('clock', 'statue', AX, 24, 1.2, 6);
  b.box('bench.c', 'bench', 30.5, 24, 0.3, 0.9, 0.5);
  b.circle('lamp.c', 'lamp', 29.5, 21.0, 0.15, 3.2);
  b.circle('lamp.c2', 'lamp', 29.5, 27.0, 0.15, 3.2);
  // Tea kiosk at the square's west tip: splits the zone approach into two lanes and
  // breaks the long zone-to-zone sightline without touching the bank diagonals.
  b.box('kiosk.tip', 'kiosk', 23.5, 27.9, 0.9, 0.9, 2.6, { style: 'tea' });
  ns((y, side) => {
    // Planter beds flanking the bank fronts and back yards (outside the diagonals).
    b.box(`bed.front.${side}`, 'planter', 26.2, y(5.25), 1.2, 0.5, 0.8);
    if (side === 'n') b.circle(`tree.${side}b`, 'tree', 13.0, y(15.6), 0.5, 4);
  });

  // --- loot -------------------------------------------------------------------------------------
  b.safe('largeSafe', AX, 19.5); // in front of the north bank's door
  b.safe('largeSafe', AX, H - 19.5); // in front of the south bank's door
  // terrace lane B, a short walk from the van; flush against the north row (centered in the
  // 2.5 m lane it left a 0.85 m pocket on each side, where a raccoon could wedge)
  b.safe('smallSafe', 6, 11.46);
  b.safe('smallSafe', 1.5, ZONE.y + 5.2); // edge nook below the van
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
    // (south side: the zones moved south, so dressing that would sit on their paint is left out)
    const d = (kind: Parameters<typeof b.decor>[0], x: number, yy: number, a: number, o?: Parameters<typeof b.decor>[4]): void => {
      if (!n && x > 3.4 && x < 16.6 && yy > ZONE.y - 7.6 && yy < ZONE.y + 7.6) return;
      b.decor(kind, x, yy, a, o);
    };
    d('umbrella', 22.5, y(9.0), 0, { color: n ? '#F25C54' : '#7BDFF2', east: { color: '#F7B32B' } });
    d('flowers', 14.0, y(11.6), 0, { color: '#F28DB2' });
    d('flowers', 4.0, y(17.6), 0, { color: '#FFD166' });
    d('crate', 4.0, y(5.4), 0.2);
    d('trash', 19.5, y(5.4), 0);
    d('balloon', 28.0, y(6.0), 0, { color: '#FF6FA5', east: { color: '#7BDFF2' } });
    d('sign', 31.0, y(15.6), 0); // "창구" sign at the bank front
    d('puddle', 16.0, y(15.5), 0, { scale: 1.1 });
  });
  ns((y, side) => {
    const n = side === 'n';
    // (south side: the zones moved south, so dressing that would sit on their paint is left out)
    const d = (kind: Parameters<typeof b.decor>[0], x: number, yy: number, a: number, o?: Parameters<typeof b.decor>[4]): void => {
      if (!n && x > 3.4 && x < 16.6 && yy > ZONE.y - 7.6 && yy < ZONE.y + 7.6) return;
      b.decor(kind, x, yy, a, o);
    };
    // Terrace dressing: flower pots by the shops, a balloon cart by the toy store/arcade.
    d('flowers', 5.5, y(6.4), 0, { color: '#FFD166' });
    d('flowers', 13.0, y(6.4), 0, { color: '#F7B6D2' });
    d('balloon', 17.5, y(11.8), 0, { color: n ? '#FF6FA5' : '#7BDFF2', east: { color: '#FFD166' } });
    d('balloon', 18.3, y(12.0), 0, { color: '#C3A6F2' });
    d('umbrella', 7.5, y(18.0), 0, { color: n ? '#F7B32B' : '#4FB0C6', east: { color: '#F25C54' } });
    d('cone', 30.6, y(6.6), 0);
    d('cone', 37.4 - 4.8, y(5.3), 0);
    d('crate', 21.8, y(5.3), 0.4);
    d('flowers', 25.5, y(5.25), 0, { color: '#F28DB2' });
    d('flowers', 26.9, y(5.25), 0, { color: '#FFD166' });
    // Cafe tables outside the bank fronts (the "counter" queue).
    d('umbrella', 30.0, y(16.6), 0, { color: n ? '#F25C54' : '#7BDFF2', east: { color: '#F7B32B' } });
    d('sign', 32.2, y(17.6), 0);
  });
  b.decor('flowers', 31.6, 22.0, 0, { color: '#C3A6F2' });
  b.decor('flowers', 31.6, 26.0, 0, { color: '#F7B6D2' });
  b.decor('arrow', 18.0, ZONE.y, PI);
  b.decor('arrow', 1.25, ZONE.y - 8.5, PI / 2);
  b.decor('arrow', 1.25, ZONE.y + 3.6, -PI / 2);

  // --- police (owner addition) --------------------------------------------------------------
  // Cars pull up at the curb outside the north edge (wave 1) and the south edge (wave 2) on the
  // mirror axis; officers hop the fence into the police gate and come out at the bank's back lane.
  b.policeCurbs();

  // --- Content 2.0 composition (content-plan §3.2; LayoutDef.v2, 4,000) -----------------------
  // The two square large safes stay (1 m further toward their bank doors, out of the diagonals'
  // sweeps) and the edge-nook small safe per side; the terrace and square small safes make way.
  // 돼지 and 돈나무 flank the clock tower on the axis. The ATM starter socket stands on the row-2
  // shop front north of the zone; crates on each spawn's first path, the vending machine on the
  // terrace by the toy shop.
  b.v2Safe('largeSafe', AX, 18.5);
  b.v2Safe('largeSafe', AX, H - 18.5);
  b.v2Safe('smallSafe', 1.5, ZONE.y + 5.2); // edge nook below the van (kept)
  b.prop('piggy', AX, 21.0); // north of the clock tower
  b.prop('moneyTree', AX, 27.0); // south of the clock tower
  // row-2 ramen shop front, facing the zone (east of its cafe umbrella); the crate a step closer
  b.prop('atm', 9.35, 17 + 0.06 + PROP_SPECS.atm.half.y, 0);
  b.breakable('crate.north', 'crate', 10.6, 19.0); // spawn 0's first hit, on the way to the ATM (footprint 6.05 m off the zone)
  // south terrace lane, below the laundry alley: spawn 1's way to the near (south) bank's back door
  // (its first target after the edge-nook small safe, which sits inside the zone's 6 m crate-free ring)
  b.breakable('crate.south', 'crate', 10.9, H - 4.75 - 0.06 - BREAKABLE_SPECS.crate.half.y);
  b.breakable('vending', 'vending', 12.6, 11 + 0.06 + BREAKABLE_SPECS.vending.half.y, 0); // terrace, on the toy shop's back wall
  // south yard past the laundry row: 12-18 m from both spawns (the terrace corners are 23 m from the far one)
  b.itemPad('pad.yard', 17.5, H - 8.5);
  b.itemPad('pad.axis', AX, H - 15.5); // south counter (in front of the south bank)
  // north counter (시계탑 cuckoo announces it). The cash truck can only drive in from the north curb
  // (through the police gate): the clock tower walls the other approach for any spot on the axis.
  b.eventSpot(AX, 15.5);

  return b.build(
    'Open counter: both bank fronts face a shared clock-tower crossing that also holds the two large safes. Bank routes are short ' +
      'straight diagonals across the open square (the south bank is the near one for both teams), so the fight is about moving fast, ' +
      'guarding the door, or stripping the bank first. ' +
      'Terraced side blocks give small-safe alleys and back-door lanes.',
  );
}

const built = build();
export const COUNTER: LayoutDef = built.def;
export const COUNTER_META: LayoutDesignMeta = built.meta;
