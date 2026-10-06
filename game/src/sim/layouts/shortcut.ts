/**
 * 지름길 상가 (Shortcut Arcade) — match layout.
 *
 * Identity (doc §9 table): weak fences a bank can bust open connect to the safe-carry
 * paths. Each bank sits in a walled "bank court" that opens only onto a narrow back
 * street; the court's mouth toward the central crossing is closed by a weak fence ON
 * the mirror axis. The only way to roll a bank out is to bust that fence — and once it
 * is open, BOTH teams get a wide shortcut between the back street (two large safes,
 * a pair of small safes) and the main boulevard. Before that, large safes must take
 * the long 2.5 m edge lanes and small safes the 1.1 m arcade alleys.
 * Decision: open the shortcut yourself (and share it), or wait and use the opponent's.
 * Pocket gardens (kiosk, bench, tree, planter) beside each zone and courtyard trees keep the
 * shared plaza asset vocabulary.
 *
 * West half authored; mirrored east by the builder. North/south symmetric bands via `ns`.
 */
import { LayoutBuilder } from './builder';
import type { LayoutDesignMeta } from './meta';
import type { LayoutDef } from '../types';

const W = 70;
const H = 50;
const PI = Math.PI;
const AX = W / 2;
const ZONE = { x: 10, y: 25 };
/** Where the outer corner shop ends and the pocket garden by the zone begins. */
const POCKET_Y = 15.5;

function build(): { def: LayoutDef; meta: LayoutDesignMeta } {
  const b = new LayoutBuilder({
    id: 'shortcut',
    size: { x: W, y: H },
    nameKey: 'layout.shortcut.name',
    descKey: 'layout.shortcut.desc',
    groundStyle: 'arcade',
  });
  const ns = (fn: (y: (v: number) => number, side: 'n' | 's') => void): void => {
    fn((v) => v, 'n');
    fn((v) => H - v, 's');
  };

  // --- teams ----------------------------------------------------------------------
  b.zone(ZONE, { x: 1.6, y: 25 }, -PI / 2);
  b.spawn(6, 21.75, 0);
  b.spawn(6, 28.25, 0);

  // --- banks, weak fences (on the axis), routes ----------------------------------------
  const bn = b.bank(AX, 10, PI / 2);
  const bs = b.bank(AX, H - 10, PI / 2);
  const fn = b.fence('fence.north', AX, 15.5, 5.25, 0.15);
  const fs = b.fence('fence.south', AX, H - 15.5, 5.25, 0.15);
  b.route(bn, [{ x: AX, y: 10 }, { x: AX, y: 22 }, { x: AX - 3, y: 25 }, ZONE], [fn]);
  b.route(bs, [{ x: AX, y: H - 10 }, { x: AX, y: H - 22 }, { x: AX - 3, y: H - 25 }, ZONE], [fs]);

  // Shop signs: [west style, west sign, east style, east sign]. Every sign appears once per
  // layout so chokepoint names ("오락실 골목") point at exactly one landmark.
  const signs = {
    n: {
      cornerA: ['laundry', 'sign.laundry', 'bike', 'sign.bike'],
      cornerB: ['ramen', 'sign.ramen', 'icecream', 'sign.icecream'],
      arcadeNW: ['bakery', 'sign.bakery', 'bakery', 'sign.donut'],
      arcadeNE: ['cafe', 'sign.cafe', 'tea', 'sign.tea'],
      arcadeSE: ['arcade', 'sign.arcade', 'arcade', 'sign.boardgame'],
      arcadeSW: ['toy', 'sign.toy', 'toy', 'sign.candy'],
    },
    s: {
      cornerA: ['grocery', 'sign.grocery', 'pharmacy', 'sign.pharmacy'],
      cornerB: ['hanok', 'sign.tteok', 'music', 'sign.music'],
      arcadeNW: ['books', 'sign.books', 'glass', 'sign.photo'],
      arcadeNE: ['flower', 'sign.flower', 'flower', 'sign.plant'],
      arcadeSE: ['glass', 'sign.mall', 'glass', 'sign.barber'],
      arcadeSW: ['books', 'sign.comics', 'ramen', 'sign.kimbap'],
    },
  } as const;
  ns((y, side) => {
    const n = side === 'n';
    const sg = signs[side];
    const shop = (id: keyof typeof sg, x0: number, y0: number, x1: number, y1: number, h: number): void => {
      const [style, signKey, eStyle, eSign] = sg[id];
      b.rect(`${id}.${side}`, 'building', x0, y(y0), x1, y(y1), h, { style, signKey, east: { style: eStyle, signKey: eSign } });
    };
    // Corner block (between edge lane and arcade), split by a 1.1 m alley at x = 10. The outer
    // half stops short of the boulevard to leave a pocket garden next to the zone.
    shop('cornerA', 2.5, 4, 9.45, POCKET_Y, 6);
    shop('cornerB', 10.55, 4, 17, 19.25, 6.5);
    // Arcade block: four shops around a 1.1 m cross of alleys and a small courtyard.
    shop('arcadeNW', 17, 4, 24.45, 8.9, 5.5);
    shop('arcadeNE', 25.55, 4, AX - 5.25, 9.45, 6);
    shop('arcadeSE', 25.55, 10.55, AX - 5.25, 19.75, 7);
    shop('arcadeSW', 17, 13, 24.45, 19.75, 6.5);
    // Declared paths (the edge lane and corner alley are measured where they run between shops).
    b.path(`edge.${side}`, 'medium', { x: 1.25, y: y(4.5) }, { x: 1.25, y: y(POCKET_Y - 0.5) });
    b.path(`cornerAlley.${side}`, 'narrow', { x: 10, y: y(4.5) }, { x: 10, y: y(POCKET_Y - 0.5) });
    b.path(`arcadeAlley.${side}a`, 'narrow', { x: 25, y: y(4.5) }, { x: 25, y: y(8.4) });
    b.path(`arcadeAlley.${side}b`, 'narrow', { x: 25, y: y(13.5) }, { x: 25, y: y(19.25) });
    b.path(`doorAlley.${side}`, 'narrow', { x: 26, y: y(10) }, { x: AX - 5.75, y: y(10) });
    // Pocket garden by the zone: snack kiosk, bench against the shop wall, tree and a planter.
    b.box(`kiosk.${side}`, 'kiosk', 3.7, y(16.7), 0.9, 0.8, 2.6, { style: n ? 'tteokbokki' : 'lemonade', east: { style: 'tea' } });
    b.box(`bench.${side}`, 'bench', 6.4, y(POCKET_Y + 0.35), 0.8, 0.25, 0.5);
    b.circle(`tree.${side}pocket`, 'tree', 8.5, y(16.6), 0.55, 4.5);
    b.box(`bed.${side}pocket`, 'planter', 6.6, y(18.5), 0.9, 0.35, 0.8);
    // Arcade courtyard tree (in the dead-end corner, clear of the small safe).
    b.circle(`tree.${side}court`, 'tree', 17.8, y(11.0), 0.45, 4);
    // Back street lamps against the shop walls (keep the 4 m street clear for carrying).
    b.circle(`lamp.${side}a`, 'lamp', 13.5, y(4.25), 0.2, 3.2);
    b.circle(`lamp.${side}b`, 'lamp', 21, y(4.25), 0.2, 3.2);
    // Boulevard lamps on the curb.
    b.circle(`lamp.${side}c`, 'lamp', 20, y(19.75), 0.15, 3.2);
    b.circle(`lamp.${side}d`, 'lamp', 27.75, y(19.75), 0.15, 3.2);
  });

  // --- loot ----------------------------------------------------------------------------------
  b.safe('largeSafe', AX, 2.0); // north back street, right behind the court
  b.safe('largeSafe', AX, H - 2.0); // south back street
  b.safe('smallSafe', 20.5, 11.0); // north arcade courtyard
  b.safe('smallSafe', 20.5, H - 11.0); // south arcade courtyard
  b.safe('smallSafe', 27.5, 2.0); // north back street market

  // --- chokepoints ------------------------------------------------------------------------------
  // Named after the shop beside each alley: the arcade (west) and the board-game cafe (east).
  b.choke('choke.shortcut.arcadeAlley', 'choke.shortcut.arcadeAlley', 25, 16, 2, { id: 'choke.shortcut.boardgameAlley', nameKey: 'choke.shortcut.boardgameAlley' });
  b.choke('choke.shortcut.doorAlleyW', 'choke.shortcut.doorAlleyW', 27.75, 10, 1.75, { id: 'choke.shortcut.doorAlleyE', nameKey: 'choke.shortcut.doorAlleyE' });
  b.choke('choke.shortcut.edgeLaneW', 'choke.shortcut.edgeLaneW', 1.25, 12, 2.5, { id: 'choke.shortcut.edgeLaneE', nameKey: 'choke.shortcut.edgeLaneE' });
  b.choke('choke.shortcut.crossing', 'choke.shortcut.crossing', AX, 25, 5);
  // Court mouth on the back street: overlooks the large safe and the bank's rear.
  b.choke('choke.shortcut.backStreet', 'choke.shortcut.backStreet', AX, 4.9, 3);

  // --- decor --------------------------------------------------------------------------------------
  ns((y, side) => {
    const n = side === 'n';
    // Back street market stalls (umbrellas and crates hug the walls).
    b.decor('umbrella', 15.5, y(1.0), 0, { color: n ? '#F25C54' : '#4FB0C6', east: { color: '#F7B32B' } });
    b.decor('crate', 6.0, y(0.6), 0.2);
    b.decor('crate', 7.0, y(0.6), 0);
    b.decor('flowers', 30.5, y(0.6), 0, { color: '#F28DB2' });
    b.decor('sign', 3.5, y(3.4), 0);
    // Bank court: cones and caution signs by the weak fence.
    b.decor('cone', AX - 4.4, y(16.2), 0);
    b.decor('sign', AX - 3.4, y(16.4), 0);
    // Shop fronts on the boulevard.
    b.decor('flowers', 18.0, y(20.5), 0, { color: '#FFD166' });
    b.decor('umbrella', 22.5, y(21.0), 0, { color: n ? '#7BDFF2' : '#F28DB2', east: { color: '#C3A6F2' } });
    b.decor('balloon', 27.0, y(20.6), 0, { color: '#FF6FA5', east: { color: '#7BDFF2' } });
    b.decor('trash', 29.0, y(20.4), 0);
    b.decor('puddle', AX - 2, y(19.0), 0, { scale: 1.1 });
    // Edge lane dressing near the corner.
    b.decor('bush', 0.6, y(0.6), 0);
    // Courtyard and back-street charm (medium spaces only; alleys stay clear).
    b.decor('flowers', 17.6, y(9.6), 0, { color: '#F7B6D2' });
    b.decor('flowers', 17.6, y(12.4), 0, { color: '#FFD166' });
    b.decor('trash', 23.6, y(12.4), 0);
    b.decor('balloon', 24.0, y(1.2), 0, { color: n ? '#FF6FA5' : '#C3A6F2', east: { color: '#7BDFF2' } });
    b.decor('crate', 19.0, y(3.4), 0.2);
    b.decor('flowers', 12.5, y(3.5), 0, { color: '#C3A6F2' });
    // Crossing-side dressing.
    b.decor('flowers', 30.4, y(18.9), 0, { color: '#FF8FAB' });
    b.decor('puddle', 24.5, y(23.0), 0, { scale: 0.9 });
    b.decor('umbrella', 19.4, y(21.3), 0, { color: n ? '#F25C54' : '#4FB0C6', east: { color: '#F7B32B' } });
  });
  b.decor('arrow', 18.5, 23.5, PI);
  b.decor('arrow', 18.5, 26.5, PI);
  b.decor('arrow', 1.25, 19.0, PI / 2);
  b.decor('sign', AX, 25, 0, { scale: 1.6 });

  return b.build(
    'Shortcut arcade: each bank sits in a court whose only bank-wide exit is a weak fence on the axis facing the central crossing. ' +
      'Busting it opens a shared shortcut between the back street (large safes, market small safes) and the boulevard; until then ' +
      'large safes take the 2.5 m edge lanes and small safes the 1.1 m arcade alleys.',
  );
}

const built = build();
export const SHORTCUT: LayoutDef = built.def;
export const SHORTCUT_META: LayoutDesignMeta = built.meta;
