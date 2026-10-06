/**
 * Wardrobe: cosmetic hats only (doc §12 "장식은 능력치를 바꾸지 않는다").
 * Left: the player's 3D raccoon on a dressing-room turntable (menu3d WardrobeScene) — the
 * highlighted hat pops on with a bounce and a sparkle (game flow forwards `onPreviewHat`); a
 * locked hat shows as a wrapped gift box. Right: the hat shelf (3D portraits, gift boxes for
 * locked ones) with locked / unlocked / equipped states. The team badge always stays (doc §13).
 */
import type { HatId, TeamId } from '../../sim/types';
import { t } from '../i18n';
import { h, setText } from '../core/dom';
import { icon } from '../core/icons';
import { objectPortrait, portrait } from '../core/portrait';
import { navigable } from '../core/nav';
import { UiScreen } from '../core/screen';
import { chunky } from '../core/juice';
import { chip, promptBar, screenHeader, stagger } from '../components/controls';

export interface WardrobeHat {
  id: HatId;
  unlocked: boolean;
  /** Recently unlocked: shows a NEW badge until the player views it. */
  isNew?: boolean;
}

export interface WardrobeScreenProps {
  hats: readonly WardrobeHat[];
  equipped: HatId;
  team: TeamId;
  onEquip: (hat: HatId) => void;
  onBack: () => void;
  /** The highlighted hat changed (the 3D raccoon tries it on, or a gift box shows). */
  onPreviewHat?: (hat: HatId, unlocked: boolean) => void;
}

export class WardrobeScreen extends UiScreen<WardrobeScreenProps> {
  private infoName: HTMLElement | null = null;
  private infoDesc: HTMLElement | null = null;
  private infoUnlock: HTMLElement | null = null;
  private infoState: HTMLElement | null = null;
  private lastHat: HatId | null = null;

  constructor(props: WardrobeScreenProps) {
    super(props, { name: 'wardrobe' });
  }

  protected override defaultFocus(): string {
    return `hat:${this.props.equipped}`;
  }

  protected override onBack(): boolean {
    this.leave(this.props.onBack);
    return true;
  }

  protected override onFocusChanged(el: HTMLElement | null): void {
    const id = el?.dataset.nav?.replace('hat:', '') as HatId | undefined;
    if (id) this.paintInfo(id);
  }

  protected override onShow(): void {
    const id = (this.focus.focusedId?.replace('hat:', '') as HatId | undefined) ?? this.props.equipped;
    this.lastHat = null;
    this.paintInfo(id);
  }

  protected render(): void {
    const p = this.props;
    const owned = p.hats.filter((x) => x.unlocked).length;
    const grid = h(
      'div',
      { class: 'uh-ward__grid' },
      p.hats.map((hat, i) => {
        const equipped = hat.id === p.equipped;
        const card = h(
          'div',
          {
            class: ['uh-hatcard', hat.unlocked ? '' : 'is-locked', equipped ? 'is-equipped' : ''],
            role: 'button',
            'aria-disabled': hat.unlocked ? null : 'true',
            'aria-pressed': equipped ? 'true' : 'false',
            'data-paw': 'top',
            style: { '--tilt': `${[-1.6, 1.2, -0.8, 1.8, -1.2, 0.9][i % 6]}deg` },
          },
          hat.unlocked ? portrait({ hat: hat.id, team: p.team, expression: equipped ? 'happy' : 'neutral' }, 'uh-hatcard__art') : objectPortrait('gift', 'uh-hatcard__art'),
          h('div', { class: 'uh-hatcard__name' }, hat.unlocked ? t(`hat.${hat.id}.name`) : '???'),
          equipped
            ? h('span', { class: 'uh-hatcard__tag uh-hatcard__tag--on' }, icon('check'), t('wardrobe.equipped'))
            : hat.unlocked
              ? null
              : h('span', { class: 'uh-hatcard__tag uh-hatcard__tag--lock' }, icon('gift'), t('wardrobe.locked')),
          hat.isNew && hat.unlocked ? h('span', { class: 'uh-hatcard__new' }, t('common.new')) : null,
        );
        return navigable(card, `hat:${hat.id}`, {
          onActivate: () => {
            if (!hat.unlocked) return;
            if (hat.id !== this.props.equipped) {
              this.props.onEquip(hat.id);
              this.update({ equipped: hat.id });
            }
          },
        });
      }),
    );
    stagger(grid);

    this.infoState = h('div', { class: 'uh-ward__state' });
    this.infoName = h('div', { class: 'uh-ward__name' });
    this.infoDesc = h('p', { class: 'uh-ward__desc' });
    this.infoUnlock = h('p', { class: 'uh-ward__unlock' });

    this.el.append(
      h(
        'div',
        { class: 'uh-frame uh-ward' },
        screenHeader('wardrobe.title', 'wardrobe.subtitle', 'wardrobe', h('div', { class: 'uh-ward__count' }, chip({ key: 'wardrobe.collected', params: { n: owned, total: p.hats.length } }, 'gold', 'hat')), 'grape'),
        h(
          'div',
          { class: 'uh-ward__body' },
          h(
            'section',
            { class: 'uh-ward__stage' },
            h('div', { class: 'uh-ward__spot', 'aria-hidden': 'true' }),
            h('div', { class: 'uh-ward__info uh-panel' }, this.infoState, this.infoName, this.infoDesc, this.infoUnlock, h('p', { class: 'uh-ward__note' }, icon('shield'), t('wardrobe.teamNote'))),
          ),
          h('section', { class: 'uh-ward__list uh-panel' }, h('div', { class: 'uh-scroll uh-ward__scroll' }, grid)),
        ),
        promptBar([
          { action: 'navigate', label: 'prompt.navigate' },
          { action: 'confirm', label: 'prompt.equip' },
          { action: 'back', label: 'prompt.back', onClick: () => this.leave(this.props.onBack) },
        ]),
      ),
    );
    this.paintInfo((this.focus.focusedId?.replace('hat:', '') as HatId | undefined) ?? p.equipped);
  }

  private paintInfo(id: HatId): void {
    const hat = this.props.hats.find((x) => x.id === id);
    if (!hat || !this.infoName || !this.infoDesc || !this.infoUnlock || !this.infoState) return;
    const equipped = id === this.props.equipped;
    this.infoName.replaceChildren(chunky(hat.unlocked ? t(`hat.${id}.name`) : '???', { tone: 'cream' }));
    setText(this.infoDesc, hat.unlocked ? t(`hat.${id}.desc`) : '');
    setText(this.infoUnlock, hat.unlocked ? '' : t(`hat.${id}.unlock`));
    this.infoState.replaceChildren(
      equipped ? chip('wardrobe.equipped', 'mint', 'check') : hat.unlocked ? chip('wardrobe.equip', 'gold', 'hat') : chip('wardrobe.locked', 'night', 'gift'),
    );
    if (id !== this.lastHat) {
      this.lastHat = id;
      this.props.onPreviewHat?.(id, hat.unlocked);
    }
  }
}
