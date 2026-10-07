/**
 * Credits (opened from Settings → 게임 → 크레딧): the title sticker, what the game is made with,
 * the fonts and their license, the "everything is made in code" note and a thanks line — then a
 * "라이선스 보기" view with every third-party notice in full.
 *
 * The notices are LICENSES/THIRD_PARTY_NOTICES.txt itself (generated from node_modules by
 * tools/steam-assets/notices.mjs and also shipped next to the executable), imported as text so
 * the screen and the shipped file can never disagree. Each license is split into short
 * navigable blocks so up/down (keyboard or pad) walks through the whole text; Esc / B backs out
 * of the licenses to the credits, and out of the credits to wherever they were opened from.
 */
import NOTICES from '../../../LICENSES/THIRD_PARTY_NOTICES.txt?raw';
import { t } from '../i18n';
import { h } from '../core/dom';
import { icon, type IconName } from '../core/icons';
import { navigable, uiSound } from '../core/nav';
import { UiScreen } from '../core/screen';
import { chunky } from '../core/juice';
import { button, chip, promptBar, screenHeader, stagger } from '../components/controls';

export interface CreditsScreenProps {
  /** Shown as a chip under the title, e.g. '0.5.0'. */
  version?: string;
  /** Start on the licenses view. */
  view?: CreditsView;
  onBack: () => void;
}

export type CreditsView = 'credits' | 'licenses';

/** One component of the notices file. */
export interface NoticeSection {
  name: string;
  license: string;
  website: string;
  usedFor: string;
  /** Full license text, split into readable blocks (paragraph boundaries, ~14 lines max). */
  blocks: string[];
}

const RULE = /^={20,}$/m;
const BLOCK_LINES = 14;

/** Parse THIRD_PARTY_NOTICES.txt (format written by tools/steam-assets/notices.mjs). */
export function parseNotices(text: string): { intro: string; sections: NoticeSection[] } {
  const parts = text.replace(/\r\n/g, '\n').split(RULE).map((p) => p.trim());
  const intro = parts.shift() ?? '';
  const sections: NoticeSection[] = [];
  for (const part of parts) {
    const sep = part.search(/^-{20,}$/m);
    if (sep < 0) continue;
    const head = part.slice(0, sep).trim().split('\n');
    const body = part.slice(sep).replace(/^-{20,}\n?/, '').trim();
    const field = (k: string): string => (head.find((l) => l.startsWith(`${k}:`)) ?? '').slice(k.length + 1).trim();
    const blocks: string[] = [];
    let cur: string[] = [];
    for (const para of body.split(/\n\s*\n/)) {
      const lines = para.split('\n');
      if (cur.length && cur.length + lines.length > BLOCK_LINES) {
        blocks.push(cur.join('\n'));
        cur = [];
      }
      for (let i = 0; i < lines.length; i += BLOCK_LINES) {
        const chunk = lines.slice(i, i + BLOCK_LINES);
        if (cur.length + chunk.length > BLOCK_LINES && cur.length) {
          blocks.push(cur.join('\n'));
          cur = [];
        }
        if (cur.length) cur.push('');
        cur.push(...chunk);
      }
    }
    if (cur.length) blocks.push(cur.join('\n'));
    sections.push({ name: head[0] ?? '', license: field('License'), website: field('Website'), usedFor: field('Used for'), blocks });
  }
  return { intro, sections };
}

const CREDIT_CARDS: readonly { id: string; icon: IconName; tone: string }[] = [
  { id: 'made', icon: 'wrench', tone: 'sky' },
  { id: 'fonts', icon: 'sparkle', tone: 'sun' },
  { id: 'art', icon: 'speaker', tone: 'mint' },
  { id: 'team', icon: 'paw', tone: 'grape' },
  { id: 'thanks', icon: 'star', tone: 'tomato' },
];

/** Screen-local styles (sticker cards on the shared tokens), injected once. */
const STYLE_ID = 'uh-credits-style';
const CSS = `
.uh-credits { gap: 1rem; }
/* The panel is a bounded, clipping box: only the inner .uh-scroll ever holds the long text, so
   the shrink-to-fit check (UiScreen.fitToViewport) never sees the notices as overflow. */
.uh-credits__panel { --tilt: 0deg; flex: 0 1 auto; min-height: 0; overflow: hidden; width: min(72rem, 100%); margin: 0 auto; padding: 1.25rem; display: flex; flex-direction: column; }
.uh-credits__scroll { flex: 0 1 auto; min-height: 0; padding: 0.75rem 1rem 1rem; }
.uh-credits .uh-promptbar { margin-top: auto; padding-top: 1rem; }
.uh-credits__hero { display: flex; flex-direction: column; align-items: center; gap: 0.5rem; margin: 0.25rem 0 1.5rem; }
.uh-credits__logo { font-size: var(--uh-fs-3xl); }
.uh-credits__ribbon { font-family: var(--uh-font-display); font-size: var(--uh-fs-sm); letter-spacing: 0.32em; padding: 0.2rem 1rem 0.25rem 1.3rem; color: var(--pop-cream); background: var(--pop-tomato); border: var(--pop-line-thin) solid var(--pop-ink); box-shadow: 0.1875rem 0.1875rem 0 var(--pop-ink); }
.uh-credits__cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem 1.25rem; }
.uh-credits__card[data-nav='credits:thanks'] { grid-column: span 2; }
.uh-credits__card { position: relative; display: flex; gap: 0.875rem; align-items: flex-start; padding: 1rem 1.125rem; border: var(--pop-line) solid var(--pop-ink); border-radius: var(--uh-r-md, 1rem); background: var(--pop-paper); box-shadow: var(--pop-shadow); transition: translate 0.15s, box-shadow 0.15s, background-color 0.15s; }
.uh-credits__card.is-focused { background: var(--pop-sun-l); translate: 0.25rem -0.25rem; box-shadow: 0.5rem 0.5rem 0 var(--pop-ink); }
.uh-credits__badge { flex: none; display: grid; place-items: center; width: 3rem; height: 3rem; border-radius: 50%; border: var(--pop-line-thin) solid var(--pop-ink); color: var(--pop-ink); }
.uh-credits__badge .uh-icon { width: 1.75rem; height: 1.75rem; }
.uh-credits__badge[data-tone='sky'] { background: var(--pop-sky-l); }
.uh-credits__badge[data-tone='sun'] { background: var(--pop-sun); }
.uh-credits__badge[data-tone='mint'] { background: var(--pop-mint-l); }
.uh-credits__badge[data-tone='grape'] { background: var(--pop-grape-l); }
.uh-credits__badge[data-tone='tomato'] { background: var(--pop-tomato-l); }
.uh-credits__cardTitle { margin: 0 0 0.25rem; font-family: var(--uh-font-display); font-size: var(--uh-fs-lg); font-weight: 400; }
.uh-credits__cardBody { margin: 0; font-size: var(--uh-fs-sm); font-weight: 700; line-height: 1.5; }
.uh-credits__actions { display: flex; justify-content: center; margin-top: 1.5rem; }
.uh-credits__intro { margin: 0 0 1rem; font-size: var(--uh-fs-xs); font-weight: 700; line-height: 1.55; white-space: pre-line; }
.uh-credits__lic { margin: 0 0 1.25rem; }
.uh-credits__licHead { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.75rem; padding: 0.75rem 1rem; border: var(--pop-line-thin) solid var(--pop-ink); border-radius: 0.875rem; background: var(--pop-paper); box-shadow: 0.25rem 0.25rem 0 var(--pop-ink); }
.uh-credits__licHead.is-focused { background: var(--pop-sun-l); }
.uh-credits__licName { font-family: var(--uh-font-display); font-size: var(--uh-fs-lg); }
.uh-credits__licUse { flex-basis: 100%; margin: 0; font-size: var(--uh-fs-2xs); font-weight: 700; line-height: 1.45; opacity: 0.85; }
.uh-credits__licUrl { font-size: var(--uh-fs-2xs); font-weight: 700; opacity: 0.75; }
.uh-credits__text { margin: 0.5rem 0 0; padding: 0.625rem 0.875rem; border-radius: 0.625rem; border: 0.125rem dashed transparent; font-family: 'Noto Sans KR', sans-serif; font-size: var(--uh-fs-2xs); line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.uh-credits__text.is-focused { border-color: var(--pop-ink); background: rgba(255, 210, 63, 0.22); }
`;

function ensureStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

export class CreditsScreen extends UiScreen<CreditsScreenProps> {
  private view: CreditsView;
  private readonly notices = parseNotices(NOTICES);

  constructor(props: CreditsScreenProps) {
    super(props, { name: 'credits' });
    this.view = props.view ?? 'credits';
    ensureStyle();
  }

  get currentView(): CreditsView {
    return this.view;
  }

  /** Switch between the credits and the full license notices. */
  setView(view: CreditsView): void {
    if (view === this.view) return;
    this.view = view;
    uiSound(view === 'licenses' ? 'confirm' : 'back');
    this.rerender();
    this.el.querySelectorAll<HTMLElement>('.uh-scroll').forEach((s) => (s.scrollTop = 0));
    this.focus.focus(view === 'licenses' ? 'lic:0' : 'credits:licenses', { sound: false });
  }

  protected override defaultFocus(): string {
    return this.view === 'licenses' ? 'lic:0' : 'credits:made';
  }

  protected override onBack(): boolean {
    if (this.view === 'licenses') {
      this.setView('credits');
      return true;
    }
    this.leave(this.props.onBack);
    return true;
  }

  private back = (): void => {
    if (this.view === 'licenses') this.setView('credits');
    else this.leave(this.props.onBack);
  };

  protected render(): void {
    const licenses = this.view === 'licenses';
    this.el.append(
      h(
        'div',
        { class: 'uh-frame uh-credits' },
        licenses
          ? screenHeader('credits.licenses.title', 'credits.licenses.sub', 'shield', null, 'grape')
          : screenHeader('credits.title', 'credits.sub', 'star', null, 'grape'),
        h('div', { class: 'uh-credits__panel uh-panel' }, h('div', { class: 'uh-scroll uh-credits__scroll' }, licenses ? this.renderLicenses() : this.renderCredits())),
        promptBar([
          { action: 'navigate', label: licenses ? 'credits.prompt.read' : 'prompt.navigate' },
          { action: 'confirm', label: 'prompt.select' },
          { action: 'back', label: 'prompt.back', onClick: this.back },
        ]),
      ),
    );
  }

  private renderCredits(): HTMLElement {
    const cards = h(
      'div',
      { class: 'uh-credits__cards' },
      CREDIT_CARDS.map((c) =>
        navigable(
          h(
            'article',
            { class: 'uh-credits__card' },
            h('span', { class: 'uh-credits__badge', 'data-tone': c.tone, 'aria-hidden': 'true' }, icon(c.icon)),
            h('div', null, h('h2', { class: 'uh-credits__cardTitle' }, t(`credits.${c.id}.title`)), h('p', { class: 'uh-credits__cardBody' }, t(`credits.${c.id}.body`))),
          ),
          `credits:${c.id}`,
        ),
      ),
    );
    return h(
      'div',
      null,
      h(
        'div',
        { class: 'uh-credits__hero' },
        chunky(t('game.title'), { tag: 'div', cls: 'uh-credits__logo', tone: 'sun', seed: 2 }),
        h('span', { class: 'uh-credits__ribbon' }, t('game.titleEn')),
        this.props.version ? chip({ key: 'credits.version', params: { version: this.props.version } }, 'night') : null,
      ),
      stagger(cards),
      h(
        'div',
        { class: 'uh-credits__actions' },
        button({ id: 'credits:licenses', label: 'credits.licenses', icon: 'shield', variant: 'grape', glyph: 'confirm', onActivate: () => this.setView('licenses') }),
      ),
    );
  }

  private renderLicenses(): HTMLElement {
    let n = 0;
    const blocks = this.notices.sections.map((s) =>
      h(
        'section',
        { class: 'uh-credits__lic' },
        navigable(
          h(
            'header',
            { class: 'uh-credits__licHead' },
            h('span', { class: 'uh-credits__licName' }, s.name),
            chip({ text: s.license }, /font license/i.test(s.license) ? 'mint' : 'sky'),
            h('span', { class: 'uh-credits__licUrl' }, s.website),
            s.usedFor ? h('p', { class: 'uh-credits__licUse' }, s.usedFor) : null,
          ),
          `lic:${n++}`,
        ),
        s.blocks.map((b) => navigable(h('pre', { class: 'uh-credits__text' }, b), `lic:${n++}`)),
      ),
    );
    return h('div', null, h('p', { class: 'uh-credits__intro' }, this.notices.intro), blocks);
  }

  /** For tests / tools: the notice sections the view lists. */
  get sections(): readonly NoticeSection[] {
    return this.notices.sections;
  }

  override update(patch: Partial<CreditsScreenProps>): this {
    if (patch.view) this.view = patch.view;
    return super.update(patch);
  }
}
