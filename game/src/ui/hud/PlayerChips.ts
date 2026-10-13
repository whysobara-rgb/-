/**
 * Local multiplayer: one compact chip per human player in the screen corners (P1 / P3 top-left,
 * P2 / P4 top-right, away from the scoreboard in the middle). Each chip: the P-number in the
 * player's colour, a dash ring (fills as the dash recharges), what they carry (safe / bank
 * icon) and their item pocket. Knocked down = a dizzy tint. Pooled, change-only DOM writes.
 */
import type { ItemKind, LootKind, TeamId } from '../../sim/types';
import { playerColor, playerInk, playerTag } from '../../shared/players';
import { h, setClass } from '../core/dom';
import { icon, lootIcon } from '../core/icons';
import { itemGlyph } from './contentIcons';

export interface PlayerChipModel {
  /** 0..3 = P1..P4. */
  index: number;
  team: TeamId;
  /** Dash recharge left: 1 = just used .. 0 = ready. */
  dashCooldown: number;
  dashing: boolean;
  carry: LootKind | null;
  item: ItemKind | null;
  down: boolean;
}

interface Chip {
  root: HTMLElement;
  ring: SVGCircleElement;
  carry: HTMLElement;
  item: HTMLElement;
  key: string;
  carryKey: string;
  itemKey: string;
  cool: number;
}

const R = 15;
const C = 2 * Math.PI * R;

export class PlayerChips {
  readonly el: HTMLDivElement;
  private readonly left: HTMLDivElement;
  private readonly right: HTMLDivElement;
  private readonly chips = new Map<number, Chip>();

  constructor() {
    this.left = h('div', { class: 'uh-pchips__col uh-pchips__col--l' });
    this.right = h('div', { class: 'uh-pchips__col uh-pchips__col--r' });
    this.el = h('div', { class: 'uh-pchips', 'aria-hidden': 'true' }, this.left, this.right);
    this.el.hidden = true;
  }

  update(list: readonly PlayerChipModel[] | null): void {
    if (!list || !list.length) {
      if (!this.el.hidden) this.el.hidden = true;
      return;
    }
    this.el.hidden = false;
    const seen = new Set<number>();
    for (const m of list) {
      seen.add(m.index);
      let c = this.chips.get(m.index);
      if (!c) {
        c = this.make(m.index);
        this.chips.set(m.index, c);
        (m.index % 2 === 0 ? this.left : this.right).appendChild(c.root);
      }
      this.paint(c, m);
    }
    for (const [i, c] of this.chips) {
      if (seen.has(i)) continue;
      c.root.remove();
      this.chips.delete(i);
    }
  }

  clear(): void {
    for (const c of this.chips.values()) c.root.remove();
    this.chips.clear();
    this.el.hidden = true;
  }

  private make(index: number): Chip {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 36 36');
    svg.setAttribute('class', 'uh-pchip__ringSvg');
    const bg = document.createElementNS(ns, 'circle');
    bg.setAttribute('cx', '18');
    bg.setAttribute('cy', '18');
    bg.setAttribute('r', String(R));
    bg.setAttribute('class', 'uh-pchip__ringBg');
    const ring = document.createElementNS(ns, 'circle');
    ring.setAttribute('cx', '18');
    ring.setAttribute('cy', '18');
    ring.setAttribute('r', String(R));
    ring.setAttribute('class', 'uh-pchip__ringFg');
    ring.setAttribute('stroke-dasharray', `${C} ${C}`);
    svg.append(bg, ring);
    const carry = h('span', { class: 'uh-pchip__carry' });
    const item = h('span', { class: 'uh-pchip__item' });
    const root = h(
      'div',
      { class: 'uh-pchip', 'data-player': String(index + 1), style: `--p:${playerColor(index)};--p-ink:${playerInk(index)}` },
      h('span', { class: 'uh-pchip__tag' }, playerTag(index)),
      h('span', { class: 'uh-pchip__dash' }, svg, h('span', { class: 'uh-pchip__bolt' }, icon('bolt'))),
      carry,
      item,
    );
    return { root, ring, carry, item, key: '', carryKey: '-', itemKey: '-', cool: -1 };
  }

  private paint(c: Chip, m: PlayerChipModel): void {
    const key = `${m.team}:${m.down ? 1 : 0}:${m.dashing ? 1 : 0}`;
    if (key !== c.key) {
      c.key = key;
      c.root.dataset.team = String(m.team);
      setClass(c.root, 'is-down', m.down);
      setClass(c.root, 'is-dashing', m.dashing);
    }
    const cool = Math.round(Math.max(0, Math.min(1, m.dashCooldown)) * 40) / 40;
    if (cool !== c.cool) {
      c.cool = cool;
      c.ring.setAttribute('stroke-dashoffset', String(C * cool));
      setClass(c.root, 'is-ready', cool === 0);
    }
    const ck = m.carry ?? '';
    if (ck !== c.carryKey) {
      c.carryKey = ck;
      c.carry.replaceChildren(...(m.carry ? [lootIcon(m.carry)] : []));
      c.carry.hidden = !m.carry;
    }
    const ik = m.item ?? '';
    if (ik !== c.itemKey) {
      c.itemKey = ik;
      c.item.replaceChildren(...(m.item ? [itemGlyph(m.item)] : []));
      c.item.hidden = !m.item;
    }
  }
}
