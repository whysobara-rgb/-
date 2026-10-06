/**
 * In-match HUD (doc §4, §8, §10).
 *
 *   const hud = new Hud(); hud.setLayout(sim.layout); hud.show();
 *   every frame: hud.update(model)            // diffed; DOM touched only on change
 *   on events:   hud.popScore(...), hud.banner('escape', { sec: 30 }), hud.countdown(3),
 *                hud.caption('caption.siren'), hud.setTutorialPrompt(...)
 *
 * Layout (16:9 safe area): scoreboard top-center (both confirmed scores with emblem + name +
 * '확정', one mm:ss timer, two bank icons), carry estimate '운반 중' + grab prompt
 * bottom-center (position + label distinguish it from confirmed scores), minimap bottom-left,
 * dash cooldown ring bottom-right, tutorial card left, banners center, captions above the
 * carry panel. World labels / arrows / popups live on the full-size 'world' layer.
 */
import type { LayoutDef, LootKind, TeamId } from '../../sim/types';
import { TEAM_STYLES } from '../../shared/teams';
import { onLanguageChange, t, tr, type TextRef, type TParams } from '../i18n';
import { animateEl, h, setChildren, setClass, setText } from '../core/dom';
import { icon, lootIcon, teamEmblem } from '../core/icons';
import { fmtClock, fmtScore } from '../core/format';
import { glyphChip, type PromptAction } from '../core/prompts';
import { getUiRoot, type UiRoot } from '../core/root';
import { Minimap } from './Minimap';
import { WorldLabels } from './WorldLabels';
import { OffscreenArrows } from './OffscreenArrows';
import { Banners, Captions, ScorePopups } from './Effects';
import type { BannerKind, CaptionOptions, HudBank, HudModel, ScorePopupOptions, TutorialPromptModel } from './types';

const DASH_R = 26;
const DASH_C = 2 * Math.PI * DASH_R;
const URGENT_SEC = 30;

/** Label shown next to an action glyph in the tutorial card. */
const ACTION_HINT: Partial<Record<PromptAction, string>> = {
  grab: 'hint.grab',
  dash: 'hint.dash',
  ping: 'hint.ping',
  move: 'hint.move',
  pause: 'hint.pause',
};

interface TeamPanel {
  root: HTMLElement;
  score: HTMLElement;
  name: HTMLElement;
}

interface BankIcon {
  root: HTMLElement;
  badge: HTMLElement;
  key: string;
}

export class Hud {
  readonly el: HTMLDivElement;
  readonly worldEl: HTMLDivElement;
  readonly minimap: Minimap;
  readonly labels: WorldLabels;
  readonly arrows: OffscreenArrows;
  readonly popups: ScorePopups;
  readonly banners: Banners;
  readonly captions: Captions;

  private readonly root: UiRoot;
  private readonly top: HTMLElement;
  private readonly lastBankEl: HTMLElement;
  private readonly tutorialEl: HTMLElement;
  private readonly carryEl: HTMLElement;
  private readonly grabEl: HTMLElement;
  private readonly dashEl: HTMLElement;
  private readonly dashRing: SVGCircleElement;
  private readonly dashLabel: HTMLElement;
  private readonly ro: ResizeObserver | null;
  private readonly unsubLang: () => void;

  private teams: TeamPanel[] = [];
  private timerEl: HTMLElement | null = null;
  private timerText: HTMLElement | null = null;
  private banksEl: HTMLElement | null = null;
  private bankIcons: BankIcon[] = [];
  private practiceScore: HTMLElement | null = null;

  private teamLabels: readonly [TextRef | null, TextRef | null] = [null, null];
  private tutorial: TutorialPromptModel | null = null;
  private remPx = 16;

  // diff cache
  private cMode: HudModel['mode'] | null = null;
  private cMyTeam: TeamId | null = null;
  private cScores: [number, number] = [NaN, NaN];
  private cClock = '';
  private cTimerState = '';
  private cBanksLen = -1;
  private cTimed: boolean | null = null;
  private cLastBank: boolean | null = null;
  private cCarry = '';
  private cCarryProg = -1;
  private cGrab = '';
  private cGrabProg = -1;
  private cDash = -1;
  private cMap: boolean | null = null;
  private model: HudModel | null = null;

  constructor(root: UiRoot = getUiRoot()) {
    this.root = root;
    this.minimap = new Minimap();
    this.labels = new WorldLabels();
    this.arrows = new OffscreenArrows();
    this.popups = new ScorePopups();
    this.banners = new Banners();
    this.captions = new Captions();

    this.top = h('div', { class: 'uh-hud__top' });
    this.lastBankEl = h('div', { class: 'uh-lastbank', role: 'status' });
    this.lastBankEl.hidden = true;
    this.tutorialEl = h('div', { class: 'uh-tut' });
    this.tutorialEl.hidden = true;
    this.carryEl = h('div', { class: 'uh-carry' });
    this.carryEl.hidden = true;
    this.grabEl = h('div', { class: 'uh-grab' });
    this.grabEl.hidden = true;

    const svgNS = 'http://www.w3.org/2000/svg';
    const ringSvg = document.createElementNS(svgNS, 'svg');
    ringSvg.setAttribute('viewBox', '0 0 64 64');
    ringSvg.setAttribute('class', 'uh-dash__ring');
    const bg = document.createElementNS(svgNS, 'circle');
    bg.setAttribute('cx', '32');
    bg.setAttribute('cy', '32');
    bg.setAttribute('r', String(DASH_R));
    bg.setAttribute('class', 'uh-dash__ringBg');
    this.dashRing = document.createElementNS(svgNS, 'circle');
    this.dashRing.setAttribute('cx', '32');
    this.dashRing.setAttribute('cy', '32');
    this.dashRing.setAttribute('r', String(DASH_R));
    this.dashRing.setAttribute('class', 'uh-dash__ringFg');
    this.dashRing.setAttribute('stroke-dasharray', String(DASH_C));
    ringSvg.append(bg, this.dashRing);
    this.dashLabel = h('span', { class: 'uh-dash__label' });
    this.dashEl = h('div', { class: 'uh-dash' }, h('div', { class: 'uh-dash__btn' }, ringSvg, h('span', { class: 'uh-dash__icon' }, icon('bolt'))), glyphChip('dash'), this.dashLabel);

    const actions = h(
      'div',
      { class: 'uh-actions' },
      h('div', { class: 'uh-actions__ping' }, glyphChip('ping'), h('span', { class: 'uh-actions__pingLabel' }, icon('ping'))),
      this.dashEl,
    );

    this.el = h(
      'div',
      { class: 'uh-hud', 'aria-hidden': 'true' },
      h(
        'div',
        { class: 'uh-hud__safe' },
        h('div', { class: 'uh-hud__topWrap' }, this.top, this.lastBankEl),
        h('div', { class: 'uh-hud__left' }, this.tutorialEl),
        h('div', { class: 'uh-hud__bl' }, this.minimap.el),
        h('div', { class: 'uh-hud__bc' }, this.captions.el, this.carryEl, this.grabEl),
        h('div', { class: 'uh-hud__br' }, actions),
        this.banners.el,
      ),
    );
    this.el.hidden = true;
    this.worldEl = h('div', { class: 'uh-world' }, this.labels.el, this.arrows.el, this.popups.el);
    this.worldEl.hidden = true;
    root.layer('hud').appendChild(this.el);
    root.layer('world').appendChild(this.worldEl);

    this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.measure()) : null;
    this.ro?.observe(root.el);
    this.measure();
    this.unsubLang = onLanguageChange(() => this.relabel());
  }

  // --- lifecycle -------------------------------------------------------------------------

  show(): this {
    this.el.hidden = false;
    this.worldEl.hidden = false;
    this.measure();
    return this;
  }

  hide(): this {
    this.el.hidden = true;
    this.worldEl.hidden = true;
    return this;
  }

  /** Clear transient effects and cached state between matches. */
  reset(): void {
    this.popups.clear();
    this.banners.dismiss();
    this.captions.clear();
    this.labels.clear();
    this.arrows.update(undefined, this.remPx);
    this.setTutorialPrompt(null);
    this.cMode = null;
    this.model = null;
  }

  destroy(): void {
    this.ro?.disconnect();
    this.unsubLang();
    this.minimap.destroy();
    this.el.remove();
    this.worldEl.remove();
  }

  setLayout(layout: LayoutDef | null): void {
    this.minimap.setLayout(layout);
  }

  /** Override team labels (e.g. a rival's name) — not per frame. */
  setTeamLabels(labels: readonly [TextRef | null, TextRef | null] | null): void {
    this.teamLabels = labels ?? [null, null];
    for (const id of [0, 1] as const) {
      const p = this.teams[id];
      if (p) setText(p.name, this.teamName(id));
    }
  }

  setCaptionsEnabled(on: boolean): void {
    this.captions.setEnabled(on);
  }

  // --- events ------------------------------------------------------------------------------

  popScore(o: ScorePopupOptions): void {
    this.popups.pop(o, this.model?.myTeam ?? 0);
  }

  banner(kind: BannerKind, params?: TParams, durationMs?: number): void {
    this.banners.show(kind, params, durationMs);
  }

  /** 3, 2, 1, then 0 = '출발!'. */
  countdown(n: number): void {
    this.banners.countdown(n);
  }

  caption(key: string, o?: CaptionOptions): void {
    this.captions.show(key, o);
  }

  setTutorialPrompt(p: TutorialPromptModel | null): void {
    this.tutorial = p;
    this.paintTutorial();
  }

  // --- per frame -----------------------------------------------------------------------------

  update(m: HudModel): void {
    this.model = m;
    const timed = m.timeLeftSec !== null;
    if (m.mode !== this.cMode || m.myTeam !== this.cMyTeam || m.banks.length !== this.cBanksLen || timed !== this.cTimed) {
      this.buildTop(m);
    }

    // Scores
    if (m.mode === 'match') {
      for (const id of [0, 1] as const) {
        const v = m.scores[id];
        if (v !== this.cScores[id]) {
          const grew = v > this.cScores[id];
          this.cScores[id] = v;
          const el = this.teams[id].score;
          setText(el, fmtScore(v));
          if (grew) animateEl(el, [{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
        }
      }
    } else if (this.practiceScore) {
      const v = m.scores[m.myTeam];
      if (v !== this.cScores[m.myTeam]) {
        this.cScores[m.myTeam] = v;
        setText(this.practiceScore, fmtScore(v));
        animateEl(this.practiceScore, [{ transform: 'scale(1.3)' }, { transform: 'scale(1)' }], 360);
      }
    }

    // Timer
    if (this.timerEl && this.timerText) {
      const sec = m.timeLeftSec;
      const clock = sec === null ? '∞' : fmtClock(sec);
      const state = sec === null ? 'none' : m.finalCountdown ? 'final' : sec <= URGENT_SEC ? 'urgent' : 'normal';
      if (clock !== this.cClock) {
        this.cClock = clock;
        setText(this.timerText, clock);
        if (state === 'urgent' || state === 'final') {
          animateEl(this.timerEl, [{ transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'ease-out' });
        }
      }
      if (state !== this.cTimerState) {
        this.cTimerState = state;
        this.timerEl.dataset.state = state;
      }
    }

    // Banks
    for (let i = 0; i < this.bankIcons.length; i++) this.paintBank(this.bankIcons[i], m.banks[i]);

    if (m.lastBankWarning !== this.cLastBank) {
      this.cLastBank = m.lastBankWarning;
      this.lastBankEl.hidden = !m.lastBankWarning;
    }

    this.paintCarry(m);
    this.paintGrab(m);

    // Dash cooldown ring (quantized to 1/120 to limit writes)
    const d = Math.round(Math.max(0, Math.min(1, m.dashCooldown)) * 120) / 120;
    if (d !== this.cDash) {
      const wasReady = this.cDash === 0;
      this.cDash = d;
      this.dashRing.setAttribute('stroke-dashoffset', (DASH_C * d).toFixed(2));
      const ready = d === 0;
      setClass(this.dashEl, 'is-ready', ready);
      setText(this.dashLabel, ready ? t('hud.dashReady') : t('hud.dash'));
      if (ready && !wasReady) animateEl(this.dashEl, [{ transform: 'scale(1.2)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
    }

    const now = performance.now();
    const hasMap = !!m.minimap;
    if (hasMap !== this.cMap) {
      this.cMap = hasMap;
      this.minimap.el.hidden = !hasMap;
    }
    if (m.minimap) this.minimap.update(m.minimap, m.myTeam, now);
    this.labels.update(m.labels);
    this.arrows.update(m.arrows, this.remPx);
  }

  // --- internals -------------------------------------------------------------------------------

  private measure(): void {
    this.remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    this.arrows.setViewport(this.root.el.clientWidth, this.root.el.clientHeight);
  }

  private teamName(id: TeamId): string {
    const o = this.teamLabels[id];
    return o ? tr(o) : t(TEAM_STYLES[id].nameKey);
  }

  private buildTop(m: HudModel): void {
    this.cMode = m.mode;
    this.cMyTeam = m.myTeam;
    this.cBanksLen = m.banks.length;
    this.cTimed = m.timeLeftSec !== null;
    this.cScores = [NaN, NaN];
    this.cClock = '';
    this.cTimerState = '';
    this.teams = [];
    this.practiceScore = null;

    this.timerText = h('span', { class: 'uh-timer__text uh-num' });
    this.timerEl = h('div', { class: 'uh-timer', role: 'timer' }, h('span', { class: 'uh-timer__icon' }, icon('clock')), this.timerText);
    this.bankIcons = m.banks.map(() => {
      const badge = h('span', { class: 'uh-bankicon__badge' });
      const root = h('span', { class: 'uh-bankicon' }, lootIcon('bank', 'uh-bankicon__art'), badge);
      return { root, badge, key: '' };
    });
    this.banksEl = h('div', { class: 'uh-banks', title: t('hud.banks') }, this.bankIcons.map((b) => b.root));
    const center = h('div', { class: 'uh-sb__center' }, this.timerEl, this.bankIcons.length ? this.banksEl : null);

    if (m.mode === 'practice') {
      this.practiceScore = h('span', { class: 'uh-practice__score uh-num' }, '0');
      const panel = h(
        'div',
        { class: 'uh-sb uh-sb--practice' },
        h(
          'div',
          { class: 'uh-practice' },
          h('span', { class: 'uh-practice__ribbon' }, icon('practice'), t('hud.practice')),
          h(
            'div',
            { class: 'uh-practice__body' },
            h('span', { class: 'uh-practice__label' }, t('hud.practiceScore')),
            this.practiceScore,
          ),
          h('span', { class: 'uh-practice__note' }, t('hud.practiceNote')),
        ),
        m.timeLeftSec === null ? (this.bankIcons.length ? h('div', { class: 'uh-sb__center' }, this.banksEl) : null) : center,
      );
      if (m.timeLeftSec === null) {
        this.timerEl = null;
        this.timerText = null;
      }
      this.top.replaceChildren(panel);
    } else {
      const team = (id: TeamId): HTMLElement => {
        const score = h('span', { class: 'uh-sb__score uh-num' }, '0');
        const name = h('span', { class: 'uh-sb__name' }, this.teamName(id));
        const root = h(
          'div',
          { class: ['uh-sb__team', `uh-sb__team--${id}`, id === m.myTeam ? 'is-mine' : ''] },
          h('span', { class: 'uh-sb__emblem' }, teamEmblem(id, 'uh-emblem', 'light')),
          h('span', { class: 'uh-sb__info' }, name, h('span', { class: 'uh-sb__tag' }, icon('check'), t('hud.confirmed'))),
          score,
          id === m.myTeam ? h('span', { class: 'uh-sb__mine' }, t('hud.ours')) : null,
        );
        this.teams[id] = { root, score, name };
        return root;
      };
      this.top.replaceChildren(h('div', { class: 'uh-sb' }, team(0), center, team(1)));
    }
    this.lastBankEl.replaceChildren(icon('siren'), h('span', null, t('banner.lastBank')));
    for (const b of this.bankIcons) b.key = '';
  }

  private paintBank(b: BankIcon, s: HudBank | undefined): void {
    const key = s ? `${s.recovered ? 1 : 0}${s.recoveredBy ?? '-'}${s.carriedBy ?? '-'}` : 'x';
    if (key === b.key) return;
    const wasRecovered = b.key.startsWith('1');
    b.key = key;
    const recovered = !!s?.recovered;
    b.root.dataset.state = recovered ? 'recovered' : s?.carriedBy !== null && s?.carriedBy !== undefined ? 'carried' : 'free';
    if (recovered && s && s.recoveredBy !== null) {
      b.root.dataset.team = String(s.recoveredBy);
      b.badge.replaceChildren(teamEmblem(s.recoveredBy));
      b.root.title = t('hud.bankTaken', { team: this.teamName(s.recoveredBy) });
      if (!wasRecovered) animateEl(b.root, [{ transform: 'scale(1.6) rotate(-12deg)' }, { transform: 'scale(1) rotate(0)' }], { duration: 480, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
    } else if (s?.carriedBy !== null && s?.carriedBy !== undefined) {
      b.root.dataset.team = String(s.carriedBy);
      b.badge.replaceChildren(teamEmblem(s.carriedBy));
      b.root.title = t('hud.bankInPlay');
    } else {
      delete b.root.dataset.team;
      b.badge.replaceChildren();
      b.root.title = t('hud.bankInPlay');
    }
  }

  private paintCarry(m: HudModel): void {
    const c = m.carry;
    const key = c ? `${c.kind}|${c.value}|${c.building ?? ''}|${c.safes ?? ''}` : '';
    if (key !== this.cCarry) {
      this.cCarry = key;
      this.cCarryProg = -1;
      if (!c) {
        this.carryEl.hidden = true;
      } else {
        this.carryEl.hidden = false;
        this.carryEl.dataset.kind = c.kind;
        const showBreakdown = c.kind === 'bank' && c.building !== undefined;
        this.carryEl.replaceChildren(
          h('span', { class: 'uh-carry__tag' }, icon('hand'), t('hud.carrying')),
          h(
            'div',
            { class: 'uh-carry__main' },
            lootIcon(c.kind as LootKind, 'uh-loot-icon uh-carry__icon'),
            h(
              'div',
              { class: 'uh-carry__text' },
              h('span', { class: 'uh-carry__value uh-num' }, t('hud.estimate', { value: c.value })),
              showBreakdown
                ? h('span', { class: 'uh-carry__breakdown' }, t('hud.bankBreakdown', { building: c.building ?? 0, safes: c.safes ?? 0 }))
                : h('span', { class: 'uh-carry__breakdown' }, t(`loot.${c.kind}.name`)),
            ),
          ),
          h('div', { class: 'uh-carry__foot' }, h('span', { class: 'uh-carry__note' }, t('hud.carryNote')), h('div', { class: 'uh-carry__bar' }, h('i'))),
        );
      }
    }
    if (c) {
      const p = c.recovering === null || c.recovering === undefined ? -1 : Math.round(c.recovering * 100) / 100;
      if (p !== this.cCarryProg) {
        this.cCarryProg = p;
        setClass(this.carryEl, 'is-recovering', p >= 0);
        const bar = this.carryEl.querySelector<HTMLElement>('.uh-carry__bar i');
        if (bar) bar.style.transform = `scaleX(${Math.max(0, p)})`;
        const note = this.carryEl.querySelector<HTMLElement>('.uh-carry__note');
        if (note) setText(note, p >= 0 ? t('hud.recovering') : t('hud.carryNote'));
      }
    }
  }

  private paintGrab(m: HudModel): void {
    const g = m.grab;
    const key = g ? `${g.action}|${g.target}|${g.value}|${g.anchored ? 1 : 0}|${g.unanchorSec ?? ''}` : '';
    if (key !== this.cGrab) {
      this.cGrab = key;
      this.cGrabProg = -1;
      if (!g) {
        this.grabEl.hidden = true;
      } else {
        this.grabEl.hidden = false;
        this.grabEl.dataset.action = g.action;
        const lootKind: LootKind = g.target === 'bankWall' ? 'bank' : g.target;
        const name = g.target === 'bankWall' ? t('loot.bankWall') : t(`loot.${g.target}.name`);
        setChildren(this.grabEl,
          h(
            'div',
            { class: 'uh-grab__main' },
            glyphChip('grab'),
            h('span', { class: 'uh-grab__verb' }, t(g.action === 'grab' ? 'hud.grab' : 'hud.release')),
            lootIcon(lootKind, 'uh-loot-icon uh-grab__icon'),
            h('span', { class: 'uh-grab__name' }, name),
            h('span', { class: 'uh-grab__value uh-num' }, fmtScore(g.value)),
          ),
          g.anchored && g.action === 'grab'
            ? h('span', { class: 'uh-grab__anchor' }, h('span', { class: 'uh-grab__anchorText' }, t('hud.anchored', { sec: g.unanchorSec ?? 1 })), h('span', { class: 'uh-grab__anchorBar' }, h('i')))
            : null,
        );
      }
    }
    if (g && g.anchored) {
      const p = g.unanchorProgress === null || g.unanchorProgress === undefined ? -1 : Math.round(g.unanchorProgress * 100) / 100;
      if (p !== this.cGrabProg) {
        this.cGrabProg = p;
        setClass(this.grabEl, 'is-straining', p >= 0);
        const bar = this.grabEl.querySelector<HTMLElement>('.uh-grab__anchorBar i');
        if (bar) bar.style.transform = `scaleX(${Math.max(0, p)})`;
        const txt = this.grabEl.querySelector<HTMLElement>('.uh-grab__anchorText');
        if (txt) setText(txt, p >= 0 ? t('hud.uprooting') : t('hud.anchored', { sec: g.unanchorSec ?? 1 }));
      }
    }
  }

  private paintTutorial(): void {
    const p = this.tutorial;
    if (!p) {
      this.tutorialEl.hidden = true;
      this.tutorialEl.replaceChildren();
      return;
    }
    this.tutorialEl.hidden = false;
    setClass(this.tutorialEl, 'is-done', !!p.done);
    setChildren(this.tutorialEl,
      h(
        'div',
        { class: 'uh-tut__head' },
        h('span', { class: 'uh-tut__label' }, icon('practice'), t('tutorial.label')),
        p.step !== undefined && p.total !== undefined ? h('span', { class: 'uh-tut__step uh-num' }, t('tutorial.step', { step: p.step, total: p.total })) : null,
      ),
      h('p', { class: 'uh-tut__text' }, p.done ? icon('check', 'uh-icon uh-tut__check') : null, tr(p.text)),
      p.sub ? h('p', { class: 'uh-tut__sub' }, tr(p.sub)) : null,
      p.actions && p.actions.length
        ? h('div', { class: 'uh-tut__actions' }, p.actions.map((a) => h('span', { class: 'uh-tut__action' }, glyphChip(a), ACTION_HINT[a] ? t(ACTION_HINT[a]!) : null)))
        : null,
      p.skipAction ? h('div', { class: 'uh-tut__skip' }, glyphChip(p.skipAction), t('tutorial.skip')) : null,
    );
    animateEl(this.tutorialEl, [{ transform: 'translateX(-1.5rem)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 320, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
  }

  /** Language changed: rebuild labels and force a full refresh on the next update. */
  private relabel(): void {
    this.cMode = null;
    this.cCarry = '';
    this.cGrab = '';
    this.cDash = -1;
    this.labels.invalidate();
    this.paintTutorial();
    if (this.model) this.update(this.model);
  }
}
