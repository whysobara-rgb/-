/**
 * Wardrobe: cosmetic hats only (doc §12 "장식은 능력치를 바꾸지 않는다").
 * Left: big preview of the focused hat on the player's raccoon (with the team badge, which
 * always stays — doc §13). Right: hat grid with locked / unlocked / equipped states.
 */
import type { HatId, TeamId } from '../../sim/types';
import { t } from '../i18n';
import { h, setText } from '../core/dom';
import { icon, raccoon } from '../core/icons';
import { navigable } from '../core/nav';
import { UiScreen } from '../core/screen';
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
}

export class WardrobeScreen extends UiScreen<WardrobeScreenProps> {
  private preview: HTMLElement | null = null;
  private infoName: HTMLElement | null = null;
  private infoDesc: HTMLElement | null = null;
  private infoUnlock: HTMLElement | null = null;
  private infoState: HTMLElement | null = null;

  constructor(props: WardrobeScreenProps) {
    super(props, { name: 'wardrobe' });
  }

  protected override defaultFocus(): string {
    return `hat:${this.props.equipped}`;
  }

  protected override onBack(): boolean {
    this.props.onBack();
    return true;
  }

  protected override onFocusChanged(el: HTMLElement | null): void {
    const id = el?.dataset.nav?.replace('hat:', '') as HatId | undefined;
    if (id) this.paintInfo(id);
  }

  protected render(): void {
    const p = this.props;
    const owned = p.hats.filter((x) => x.unlocked).length;
    const grid = h(
      'div',
      { class: 'uh-ward__grid' },
      p.hats.map((hat) => {
        const equipped = hat.id === p.equipped;
        const card = h(
          'div',
          {
            class: ['uh-hatcard', hat.unlocked ? '' : 'is-locked', equipped ? 'is-equipped' : ''],
            role: 'button',
            'aria-disabled': hat.unlocked ? null : 'true',
            'aria-pressed': equipped ? 'true' : 'false',
          },
          h('div', { class: 'uh-hatcard__art' }, raccoon({ hat: hat.id, silhouette: !hat.unlocked, expression: equipped ? 'happy' : 'neutral' })),
          h('div', { class: 'uh-hatcard__name' }, t(`hat.${hat.id}.name`)),
          equipped
            ? h('span', { class: 'uh-hatcard__tag uh-hatcard__tag--on' }, icon('check'), t('wardrobe.equipped'))
            : hat.unlocked
              ? null
              : h('span', { class: 'uh-hatcard__tag uh-hatcard__tag--lock' }, icon('lock'), t('wardrobe.locked')),
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

    this.preview = h('div', { class: 'uh-ward__preview' });
    this.infoState = h('div', { class: 'uh-ward__state' });
    this.infoName = h('h2', { class: 'uh-ward__name' });
    this.infoDesc = h('p', { class: 'uh-ward__desc' });
    this.infoUnlock = h('p', { class: 'uh-ward__unlock' });

    this.el.append(
      h(
        'div',
        { class: 'uh-frame uh-ward' },
        screenHeader('wardrobe.title', 'wardrobe.subtitle', 'wardrobe', h('div', { class: 'uh-ward__count' }, chip({ key: 'wardrobe.collected', params: { n: owned, total: p.hats.length } }, 'gold', 'hat'))),
        h(
          'div',
          { class: 'uh-ward__body' },
          h(
            'section',
            { class: 'uh-ward__stage uh-panel' },
            h('div', { class: 'uh-ward__spot' }, this.preview),
            h('div', { class: 'uh-ward__info' }, this.infoState, this.infoName, this.infoDesc, this.infoUnlock),
            h('p', { class: 'uh-ward__note' }, icon('sparkle'), t('wardrobe.teamNote')),
          ),
          h('section', { class: 'uh-ward__list uh-panel uh-panel--night' }, h('div', { class: 'uh-scroll uh-ward__scroll' }, grid)),
        ),
        promptBar([
          { action: 'navigate', label: 'prompt.navigate' },
          { action: 'confirm', label: 'prompt.equip' },
          { action: 'back', label: 'prompt.back', onClick: () => this.props.onBack() },
        ]),
      ),
    );
    this.paintInfo((this.focus.focusedId?.replace('hat:', '') as HatId | undefined) ?? p.equipped);
  }

  private paintInfo(id: HatId): void {
    const hat = this.props.hats.find((x) => x.id === id);
    if (!hat || !this.preview || !this.infoName || !this.infoDesc || !this.infoUnlock || !this.infoState) return;
    const equipped = id === this.props.equipped;
    this.preview.replaceChildren(
      raccoon({ hat: id, team: this.props.team, silhouette: !hat.unlocked, expression: hat.unlocked ? 'happy' : 'neutral' }, 'uh-raccoon uh-ward__raccoon'),
    );
    setText(this.infoName, t(`hat.${id}.name`));
    setText(this.infoDesc, hat.unlocked ? t(`hat.${id}.desc`) : '');
    setText(this.infoUnlock, hat.unlocked ? '' : t(`hat.${id}.unlock`));
    this.infoState.replaceChildren(
      equipped ? chip('wardrobe.equipped', 'mint', 'check') : hat.unlocked ? chip('wardrobe.equip', 'gold', 'hat') : chip('wardrobe.locked', 'night', 'lock'),
    );
  }
}
