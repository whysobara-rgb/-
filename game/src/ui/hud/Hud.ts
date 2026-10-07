/**
 * In-match HUD (doc §4, §8, §10) — chunky sticker style.
 *
 *   const hud = new Hud(); hud.setLayout(sim.layout); hud.show();
 *   every frame: hud.update(model)            // diffed; DOM touched only on change
 *   on events:   hud.popScore(...), hud.banner('escape', { sec: 30 }), hud.countdown(3),
 *                hud.stamp('uproot', { team, x, y }), hud.caption('caption.siren'), ...
 *
 * Layout (16:9 safe area): scoreboard top-center (team stickers with the lead's 3D portrait,
 * rolling '확정' scores with a coin burst on gain, a timer bubble that wobbles in the final 30 s,
 * two bank icons), police chip under it, stamp callouts, the '운반 중' luggage tag + grab
 * prompt with the target's 3D card bottom-center (position + label distinguish it from the
 * confirmed scores), minimap bottom-left, dash button bottom-right, tutorial card left,
 * banners center, captions above the carry tag. World labels / arrows / popups live on the
 * full-size 'world' layer. Taunts (owner addition): a small taunt chip beside the ping button and
 * the radial taunt wheel in the middle while it is held (setTauntWheel).
 *
 * [F4] Tension HUD: the decisive-load prompt ("이게 들어가면 끝!" / "막아야 해!", from
 * HudModel.matchPoint; it outranks the last-bank warning in the same slot), the swing readout
 * "역전까지 N · 남은 M" under the scoreboard (HudModel.swing), a crown that hops to the leading
 * team's sticker (setLeader), moment stamps (stamp(kind, { key, sub })), the banner queue
 * (banner() / queueBanner(), one centre plate at a time; the climax plate shrinks into the
 * "도주 준비!" badge) and the final-10 s digit slam on the timer.
 */
import type { LayoutDef, LootKind, TeamId } from '../../sim/types';
import { TEAM_STYLES } from '../../shared/teams';
import { onLanguageChange, t, tr, type TextRef, type TParams } from '../i18n';
import { animateEl, h, setChildren, setClass, setText } from '../core/dom';
import { icon, lootIcon, teamEmblem } from '../core/icons';
import { objectPortrait, portrait } from '../core/portrait';
import { clamp01, fmtClock, fmtScore, finiteOrNull } from '../core/format';
import { glyphChip, type PromptAction } from '../core/prompts';
import { getUiRoot, type UiRoot } from '../core/root';
import { RollingNumber, burst } from '../core/juice';
import { uiSound } from '../core/nav';
import { Minimap } from './Minimap';
import { WorldLabels } from './WorldLabels';
import { OffscreenArrows } from './OffscreenArrows';
import { Banners, Captions, ScorePopups, Stamps } from './Effects';
import { EmoteWheel, type EmoteWheelModel } from './EmoteWheel';
import type { BannerKind, CaptionOptions, HudBank, HudFace, HudModel, HudStampKind, HudStampOptions, ScorePopupOptions, TutorialPromptModel } from './types';
// [F4] tension HUD
import type { HudBannerSpec } from './types';
import { matchPointText, type HudMatchPoint, type HudSwing } from './tension';
import '../styles/hud-tension.css';
// [C8] Content 2.0 HUD (item slot, bag chip, deposit ring, prop / item tags): one mount point
import { ContentHud } from './ContentHud';
import { propGlyph, propNameKey } from './contentIcons';

const DASH_R = 26;
const DASH_C = 2 * Math.PI * DASH_R;
const URGENT_SEC = 30;
/** [F4] Final seconds whose digits slam (scale pulse only). */
const SLAM_SEC = 10;
/**
 * [F4] A match-point prompt that drops for less than this (ms) stays up: a carrier re-gripping or
 * knocked down for a moment (knockdown 0.7 s) is still the same decisive load, not a new prompt.
 */
const MP_HOLD_MS = 750;
/** [F4] Crown (same line weight / caps as the icon set; drawn here, the shared set has none). */
const CROWN_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M3.5 17.5L2.8 7.6l5 3.9L12 4.5l4.2 7 5-3.9-.7 9.9z" fill="currentColor" stroke="#2A2131" stroke-width="2.2" stroke-linejoin="round"/><path d="M4 20.5h16" fill="none" stroke="#2A2131" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="13.4" r="1.4" fill="#2A2131"/></svg>';

/** Label shown next to an action glyph in the tutorial card. */
const ACTION_HINT: Partial<Record<PromptAction, string>> = {
  grab: 'hint.grab',
  dash: 'hint.dash',
  ping: 'hint.ping',
  move: 'hint.move',
  pause: 'hint.pause',
  emoteWheel: 'hint.emoteWheel',
};

interface TeamPanel {
  root: HTMLElement;
  score: RollingNumber;
  name: HTMLElement;
  face: HTMLElement;
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
  readonly stamps: Stamps;
  /** Taunt wheel + taunt chip (owner addition). */
  readonly taunts: EmoteWheel;
  /** [C8] Content 2.0 HUD parts (item slot in the dash button, bag chip, deposit ring, world tags). */
  readonly content: ContentHud;

  private readonly root: UiRoot;
  private readonly top: HTMLElement;
  private readonly lastBankEl: HTMLElement;
  private readonly policeEl: HTMLElement;
  private readonly tutorialEl: HTMLElement;
  private readonly carryEl: HTMLElement;
  private readonly grabEl: HTMLElement;
  private readonly dashEl: HTMLElement;
  private readonly dashRing: SVGCircleElement;
  private readonly dashLabel: HTMLElement;
  private readonly fxEl: HTMLElement;
  // --- [F4] tension HUD ---
  private readonly swingEl: HTMLElement;
  private readonly crownEl: HTMLElement;
  private topWrapEl: HTMLElement | null = null;
  private leader: TeamId | null = null;
  private cSwing = '';
  private cMp = '';
  private mpShown: HudMatchPoint | null = null;
  private mpSeenAt = 0;
  private readonly ro: ResizeObserver | null;
  private readonly unsubLang: () => void;

  private teams: TeamPanel[] = [];
  private timerEl: HTMLElement | null = null;
  private timerText: HTMLElement | null = null;
  private banksEl: HTMLElement | null = null;
  private banksCountEl: HTMLElement | null = null;
  private bankIcons: BankIcon[] = [];
  private practiceScore: RollingNumber | null = null;

  private teamLabels: readonly [TextRef | null, TextRef | null] = [null, null];
  private faces: readonly [HudFace | null, HudFace | null] = [null, null];
  private tutorial: TutorialPromptModel | null = null;
  private remPx = 16;

  // diff cache
  private cMode: HudModel['mode'] | null = null;
  private cMyTeam: TeamId | null = null;
  /** undefined = not painted yet; null = invalid value (shown as "–"). */
  private cScores: (number | null | undefined)[] = [undefined, undefined];
  private cClock = '';
  private cTimerState = '';
  private cBanksLen = -1;
  private cBanksDone = -1;
  private cTimed: boolean | null = null;
  private cLastBank: boolean | null = null;
  private cPolice = '';
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
    this.stamps = new Stamps();
    this.taunts = new EmoteWheel();

    this.top = h('div', { class: 'uh-hud__top' });
    this.lastBankEl = h('div', { class: 'uh-lastbank', role: 'status' });
    this.lastBankEl.hidden = true;
    this.policeEl = h('div', { class: 'uh-police', role: 'status' });
    this.policeEl.hidden = true;
    this.tutorialEl = h('div', { class: 'uh-tut' });
    this.tutorialEl.hidden = true;
    this.carryEl = h('div', { class: 'uh-carry' });
    this.carryEl.hidden = true;
    this.grabEl = h('div', { class: 'uh-grab' });
    this.grabEl.hidden = true;
    this.fxEl = h('div', { class: 'uh-hud__fx', 'aria-hidden': 'true' });
    this.swingEl = h('div', { class: 'uh-swing', role: 'status' });
    this.swingEl.hidden = true;
    this.crownEl = h('span', { class: 'uh-crown', 'aria-hidden': 'true' });
    this.crownEl.innerHTML = CROWN_SVG;
    this.crownEl.hidden = true;

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
      this.taunts.chipEl,
      h('div', { class: 'uh-actions__ping' }, glyphChip('ping'), h('span', { class: 'uh-actions__pingLabel' }, icon('ping'))),
      this.dashEl,
    );

    this.el = h(
      'div',
      { class: 'uh-hud', 'aria-hidden': 'true' },
      h(
        'div',
        { class: 'uh-hud__safe' },
        (this.topWrapEl = h('div', { class: 'uh-hud__topWrap' }, this.top, h('div', { class: 'uh-tensionrow' }, this.banners.badgeEl, this.swingEl), this.lastBankEl, this.policeEl)),
        this.stamps.el,
        this.banners.topEl,
        h('div', { class: 'uh-hud__left' }, this.tutorialEl),
        h('div', { class: 'uh-hud__bl' }, this.minimap.el),
        h('div', { class: 'uh-hud__bc' }, this.captions.el, this.carryEl, this.grabEl),
        h('div', { class: 'uh-hud__br' }, actions),
        this.taunts.el,
        this.banners.el,
      ),
      this.fxEl,
    );
    this.el.hidden = true;
    this.banners.onTopPlate = (up) => setClass(this.el, 'has-topplate', up);
    this.worldEl = h('div', { class: 'uh-world' }, this.labels.el, this.arrows.el, this.popups.el, this.stamps.worldEl);
    this.worldEl.hidden = true;
    root.layer('hud').appendChild(this.el);
    root.layer('world').appendChild(this.worldEl);
    // [C8] mount point
    this.content = new ContentHud({ dash: this.dashEl, bottom: this.carryEl.parentElement as HTMLElement, before: this.carryEl, world: this.worldEl });

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
    this.stamps.clear();
    this.labels.clear();
    this.arrows.update(undefined, this.remPx);
    this.setTutorialPrompt(null);
    this.fxEl.replaceChildren();
    this.cMode = null;
    this.cPolice = '';
    this.model = null;
    this.setLeader(null);
    this.cSwing = '';
    this.cMp = '';
    this.mpShown = null;
    this.swingEl.hidden = true;
    setClass(this.el, 'has-topplate', false);
    this.content.reset(); // [C8]
  }

  destroy(): void {
    this.ro?.disconnect();
    this.unsubLang();
    this.content.destroy(); // [C8]
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

  /** The lead character of each team for the scoreboard portraits (3D snapshots). */
  setTeamFaces(faces: readonly [HudFace | null, HudFace | null] | null): void {
    this.faces = faces ?? [null, null];
    this.cMode = null;
  }

  setCaptionsEnabled(on: boolean): void {
    this.captions.setEnabled(on);
  }

  // --- events ------------------------------------------------------------------------------

  popScore(o: ScorePopupOptions): void {
    this.popups.pop(o, this.model?.myTeam ?? 0);
  }

  /** Built-in banner, queued by its priority (final > climax > event > police > other). */
  banner(kind: BannerKind, params?: TParams, durationMs?: number): void {
    this.banners.show(kind, params, durationMs);
  }

  /** [F4] Any banner with an explicit priority (C8 event banners go through here). */
  queueBanner(spec: HudBannerSpec): void {
    this.banners.queueSpec(spec);
  }

  /**
   * [F4] Crown on the leading team's sticker (null = level / none). Fed every tick from
   * `MomentTracker.snapshot().leader`; hops over when the lead changes. Shape + emblem, never
   * colour alone.
   */
  setLeader(team: TeamId | null): void {
    if (team === this.leader && (team === null || this.crownEl.parentElement === this.teams[team]?.root)) return;
    const prev = this.leader;
    this.leader = team;
    this.placeCrown(prev);
  }

  private placeCrown(prev: TeamId | null): void {
    const team = this.leader;
    const panel = team === null ? undefined : this.teams[team];
    if (team === null || !panel || this.cMode !== 'match') {
      this.crownEl.hidden = true;
      this.crownEl.remove();
      return;
    }
    const moved = this.crownEl.parentElement !== panel.root;
    panel.root.appendChild(this.crownEl);
    this.crownEl.hidden = false;
    this.crownEl.dataset.team = String(team);
    if (moved) {
      // hop: from the other sticker's side when the lead flips, a drop-in when it is new
      const from = prev !== null && prev !== team ? (team === 0 ? '6rem' : '-6rem') : '0';
      animateEl(this.crownEl, [{ transform: `translate(${from}, -3.5rem) rotate(${team === 0 ? 30 : -30}deg) scale(0.7)`, opacity: 0.4 }, { transform: 'translate(0, -1.2rem) rotate(0deg) scale(1.15)', opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 520, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
    }
  }

  /** 3, 2, 1, then 0 = '출발!'. */
  countdown(n: number): void {
    this.banners.countdown(n);
  }

  /** Stamp callout for a big moment ("뽑았다!", "가로채기!", "은행째!", "태클 피했다!", "경찰이다!"). */
  stamp(kind: HudStampKind, o: HudStampOptions = {}): void {
    // [F4] a world-anchored stamp never lands on the scoreboard / prompt column: anchors above
    // its bottom (plus the stamp's own height, it is drawn above the anchor) are pushed down
    if (o.y !== undefined && Number.isFinite(o.y) && this.topWrapEl && !this.el.hidden) {
      const host = this.root.el.getBoundingClientRect();
      const minY = this.topWrapEl.getBoundingClientRect().bottom - host.top + 6 * this.remPx;
      if (o.y < minY) o = { ...o, y: minY };
    }
    this.stamps.show(kind, o, this.model?.myTeam ?? 0);
  }

  caption(key: string, o?: CaptionOptions): void {
    this.captions.show(key, o);
  }

  /** Taunt wheel state (open / hover / cooldown); null hides the wheel. */
  setTauntWheel(m: EmoteWheelModel | null): void {
    if (m) this.taunts.update(m);
    else if (!this.taunts.el.hidden) this.taunts.update({ open: false, hover: null, slots: [], cooldown: 0, blocked: false, showKeys: false });
  }

  setTutorialPrompt(p: TutorialPromptModel | null): void {
    this.tutorial = p;
    this.paintTutorial();
  }

  // --- per frame -----------------------------------------------------------------------------

  update(m: HudModel): void {
    this.model = m;
    // +Infinity behaves like "no limit"; NaN shows "–:––" (see fmtClock).
    const timeLeft = m.timeLeftSec === Infinity ? null : m.timeLeftSec;
    const timed = timeLeft !== null;
    if (m.mode !== this.cMode || m.myTeam !== this.cMyTeam || m.banks.length !== this.cBanksLen || timed !== this.cTimed) {
      this.buildTop(m);
    }

    // Scores (non-finite values show "–" and never re-write every frame)
    if (m.mode === 'match') {
      for (const id of [0, 1] as const) {
        const v = finiteOrNull(m.scores[id]);
        const prev = this.cScores[id];
        if (v !== prev) {
          const grew = v !== null && typeof prev === 'number' && v > prev;
          this.cScores[id] = v;
          const panel = this.teams[id]!;
          // Gains tally up (no zero-padded strips); anything else (reset, "–") snaps.
          if (grew) panel.score.countTo(v, 520);
          else {
            panel.score.stop();
            panel.score.set(v, prev === undefined);
          }
          if (grew) this.gain(panel.root, id === m.myTeam, v - (prev as number));
        }
      }
    } else if (this.practiceScore) {
      const v = finiteOrNull(m.scores[m.myTeam]);
      const prev = this.cScores[m.myTeam];
      if (v !== prev) {
        this.cScores[m.myTeam] = v;
        if (v !== null && typeof prev === 'number' && v > prev) this.practiceScore.countTo(v, 520);
        else {
          this.practiceScore.stop();
          this.practiceScore.set(v, prev === undefined);
        }
        if (v !== null && typeof prev === 'number' && v > prev) {
          const panel = this.top.querySelector<HTMLElement>('.uh-practice');
          if (panel) this.gain(panel, true, v - prev);
        }
      }
    }

    // Timer
    if (this.timerEl && this.timerText) {
      const sec = timeLeft;
      const clock = sec === null ? '∞' : fmtClock(sec);
      const state = sec === null ? 'none' : m.finalCountdown ? 'final' : sec <= URGENT_SEC ? 'urgent' : 'normal';
      if (clock !== this.cClock) {
        this.cClock = clock;
        setText(this.timerText, clock);
        if (sec !== null && sec <= SLAM_SEC && sec > 0 && m.mode === 'match') {
          // [F4] final 10 s: the digits slam each second (a scale pulse only, no shake / flash)
          animateEl(this.timerText, [{ scale: '1.7' }, { scale: '0.9', offset: 0.45 }, { scale: '1.04', offset: 0.75 }, { scale: '1' }], { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
          uiSound('tick', { pitch: 1 + (10 - sec) * 0.03, volume: 0.6 });
        } else if (state === 'urgent' || state === 'final') {
          animateEl(this.timerEl, [{ scale: '1.18' }, { scale: '0.94', offset: 0.5 }, { scale: '1' }], { duration: 360, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
          if (sec !== null && sec <= 10 && sec > 0) uiSound('tick', { pitch: 1 + (10 - sec) * 0.03, volume: 0.6 });
        }
      }
      setClass(this.timerEl, 'is-slam', sec !== null && sec <= SLAM_SEC && sec > 0 && m.mode === 'match');
      if (state !== this.cTimerState) {
        this.cTimerState = state;
        this.timerEl.dataset.state = state;
      }
    }

    // Banks (doc §8: the recovered count is always readable — icons + "회수 n/2")
    let done = 0;
    for (let i = 0; i < this.bankIcons.length; i++) {
      this.paintBank(this.bankIcons[i]!, m.banks[i]);
      if (m.banks[i]?.recovered) done++;
    }
    if (done !== this.cBanksDone && this.banksCountEl && this.banksEl) {
      this.cBanksDone = done;
      setText(this.banksCountEl, t('hud.banksCount', { n: done, total: this.bankIcons.length }));
      setClass(this.banksEl, 'is-all', done > 0 && done === this.bankIcons.length);
    }

    // [F4] decisive-load prompt (outranks the last-bank warning in the same slot) + swing readout
    this.paintPrompt(m);
    this.paintSwing(m);
    this.banners.setFinalCountdown(m.mode === 'match' && m.finalCountdown);

    this.paintPolice(m);
    this.paintCarry(m);
    this.paintGrab(m);

    // Dash cooldown ring (quantized to 1/120 to limit writes; bad input reads as ready)
    const d = Math.round(clamp01(m.dashCooldown) * 120) / 120;
    if (d !== this.cDash) {
      const wasReady = this.cDash === 0;
      this.cDash = d;
      this.dashRing.setAttribute('stroke-dashoffset', (DASH_C * d).toFixed(2));
      const ready = d === 0;
      setClass(this.dashEl, 'is-ready', ready);
      setText(this.dashLabel, ready ? t('hud.dashReady') : t('hud.dash'));
      if (ready && !wasReady) animateEl(this.dashEl, [{ scale: '1.25' }, { scale: '0.92', offset: 0.5 }, { scale: '1' }], { duration: 380, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
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
    this.content.update(m.content ?? null, now); // [C8]
  }

  // --- internals -------------------------------------------------------------------------------

  /** Score went up: the sticker bounces and coins burst out of it. */
  private gain(panel: HTMLElement, mine: boolean, amount: number): void {
    animateEl(panel, [{ scale: '1' }, { scale: '1.16 0.88', offset: 0.25 }, { scale: '0.95 1.06', offset: 0.55 }, { scale: '1' }], { duration: 520, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
    const host = this.fxEl.getBoundingClientRect();
    const r = panel.getBoundingClientRect();
    burst(this.fxEl, r.left - host.left + r.width / 2, r.top - host.top + r.height * 0.6, { kind: 'coins', count: Math.min(16, 3 + Math.round(amount / 100)), power: mine ? 1 : 0.8, spread: 2.8, up: 1 });
  }

  private measure(): void {
    this.remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    this.arrows.setViewport(this.root.el.clientWidth, this.root.el.clientHeight);
  }

  private teamName(id: TeamId): string {
    const o = this.teamLabels[id];
    return o ? tr(o) : t(TEAM_STYLES[id].nameKey);
  }

  private faceFor(id: TeamId): HTMLElement {
    const f = this.faces[id];
    if (!f) return h('div', { class: 'uh-sb__face uh-sb__face--emblem' }, teamEmblem(id, 'uh-emblem', 'light'));
    return h('div', { class: 'uh-sb__face' }, portrait({ hat: f.hat ?? TEAM_STYLES[id].hat, rival: f.rival ?? null, team: id }, 'uh-sb__portrait'), h('span', { class: 'uh-sb__badge' }, teamEmblem(id, 'uh-emblem', 'light')));
  }

  private buildTop(m: HudModel): void {
    this.cMode = m.mode;
    this.cMyTeam = m.myTeam;
    this.cBanksLen = m.banks.length;
    this.cTimed = m.timeLeftSec !== null && m.timeLeftSec !== Infinity;
    this.cScores = [undefined, undefined];
    this.cClock = '';
    this.cTimerState = '';
    this.teams = [];
    this.practiceScore = null;

    this.timerText = h('span', { class: 'uh-timer__text uh-num' });
    this.timerEl = h('div', { class: 'uh-timer', role: 'timer' }, h('span', { class: 'uh-timer__icon' }, icon('clock')), this.timerText);
    this.bankIcons = m.banks.map(() => {
      const badge = h('span', { class: 'uh-bankicon__badge' });
      const root = h(
        'span',
        { class: 'uh-bankicon' },
        lootIcon('bank', 'uh-bankicon__art'),
        // Recovered = a check stamp (shape, not just color) + the team that took it.
        h('span', { class: 'uh-bankicon__check' }, icon('check')),
        badge,
      );
      return { root, badge, key: '' };
    });
    this.cBanksDone = -1;
    this.banksCountEl = h('span', { class: 'uh-banks__count uh-num' });
    this.banksEl = h('div', { class: 'uh-banks', title: t('hud.banks') }, h('span', { class: 'uh-banks__icons' }, this.bankIcons.map((b) => b.root)), this.banksCountEl);
    const center = h('div', { class: 'uh-sb__center' }, this.timerEl, this.bankIcons.length ? this.banksEl : null);

    if (m.mode === 'practice') {
      this.practiceScore = new RollingNumber('uh-practice__score uh-num', 0);
      const panel = h(
        'div',
        { class: 'uh-sb uh-sb--practice' },
        h(
          'div',
          { class: 'uh-practice' },
          h('span', { class: 'uh-practice__ribbon' }, icon('practice'), t('hud.practice')),
          h('div', { class: 'uh-practice__body' }, h('span', { class: 'uh-practice__label' }, t('hud.practiceScore')), this.practiceScore.el),
          h('span', { class: 'uh-practice__note' }, t('hud.practiceNote')),
        ),
        !this.cTimed ? (this.bankIcons.length ? h('div', { class: 'uh-sb__center' }, this.banksEl) : null) : center,
      );
      if (!this.cTimed) {
        this.timerEl = null;
        this.timerText = null;
      }
      this.top.replaceChildren(panel);
    } else {
      const team = (id: TeamId): HTMLElement => {
        const score = new RollingNumber('uh-sb__score uh-num', 0);
        const name = h('span', { class: 'uh-sb__name' }, this.teamName(id));
        const face = this.faceFor(id);
        const root = h(
          'div',
          { class: ['uh-sb__team', `uh-sb__team--${id}`, id === m.myTeam ? 'is-mine' : ''] },
          face,
          h('span', { class: 'uh-sb__info' }, name, h('span', { class: 'uh-sb__tag' }, icon('check'), t('hud.confirmed'))),
          score.el,
          id === m.myTeam ? h('span', { class: 'uh-sb__mine' }, t('hud.ours')) : null,
        );
        this.teams[id] = { root, score, name, face };
        return root;
      };
      this.top.replaceChildren(h('div', { class: 'uh-sb' }, team(0), center, team(1)));
    }
    this.cLastBank = null;
    this.cMp = '';
    for (const b of this.bankIcons) b.key = '';
    this.crownEl.remove();
    this.placeCrown(null);
  }

  /**
   * [F4] The slot under the scoreboard: the decisive-load prompt while a match point is on (held
   * MP_HOLD_MS through one-tick blinks), else the last-bank warning, else hidden. 'tie' loads say
   * "무승부" — never a win.
   */
  private paintPrompt(m: HudModel): void {
    const now = performance.now();
    const mp = m.mode === 'match' ? m.matchPoint ?? null : null;
    if (mp) {
      this.mpShown = mp;
      this.mpSeenAt = now;
    } else if (this.mpShown && now - this.mpSeenAt > MP_HOLD_MS) this.mpShown = null;
    const show = this.mpShown;
    const key = show ? `mp|${show.side}|${show.kind}|${show.value}|${show.what}|${show.bag}` : m.lastBankWarning ? 'last' : '';
    if (key === this.cMp) return;
    const before = this.cMp;
    this.cMp = key;
    this.cLastBank = m.lastBankWarning;
    if (!key) {
      this.lastBankEl.hidden = true;
      delete this.lastBankEl.dataset.side;
      return;
    }
    this.lastBankEl.hidden = false;
    if (!show) {
      delete this.lastBankEl.dataset.side;
      delete this.lastBankEl.dataset.kind;
      this.lastBankEl.replaceChildren(icon('siren'), h('span', null, t('banner.lastBank')));
      return;
    }
    const txt = matchPointText(show);
    this.lastBankEl.dataset.side = show.side;
    this.lastBankEl.dataset.kind = show.kind;
    this.lastBankEl.replaceChildren(
      h('span', { class: 'uh-mp__icon' }, icon(show.side === 'ours' ? 'flag' : 'shield')),
      h('span', { class: 'uh-mp__title' }, t(txt.title)),
      h('span', { class: 'uh-mp__sub uh-num' }, t(txt.sub, { value: fmtScore(show.value), bag: fmtScore(show.bag) })),
    );
    // a new prompt (or a flip to the other side) slams in; a value change just nudges
    const flipped = !before.startsWith(`mp|${show.side}|`);
    if (flipped) animateEl(this.lastBankEl, [{ transform: 'translateY(-1.5rem) scale(1.6)', opacity: 0 }, { transform: 'scale(0.94, 1.06)', opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
    else animateEl(this.lastBankEl, [{ scale: '1.08' }, { scale: '1' }], { duration: 240, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
  }

  /** [F4] "역전까지 N · 남은 M" / "N점 앞서요 · 남은 M" / "앞서려면 N · 남은 M". */
  private paintSwing(m: HudModel): void {
    const s: HudSwing | null = m.mode === 'match' ? m.swing ?? null : null;
    const key = s ? `${s.mode}|${s.n}|${s.remaining}` : '';
    if (key === this.cSwing) return;
    const was = this.cSwing;
    this.cSwing = key;
    if (!s) {
      this.swingEl.hidden = true;
      return;
    }
    this.swingEl.hidden = false;
    this.swingEl.dataset.mode = s.mode;
    setChildren(
      this.swingEl,
      h('span', { class: 'uh-swing__lead uh-num' }, t(`hud.mp.swing.${s.mode}`, { n: fmtScore(s.n) })),
      h('span', { class: 'uh-swing__dot', 'aria-hidden': 'true' }),
      h('span', { class: 'uh-swing__left uh-num' }, t('hud.mp.swing.remaining', { m: fmtScore(s.remaining) })),
    );
    if (!was) animateEl(this.swingEl, [{ transform: 'translateY(-0.75rem) scale(0.7)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 320, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
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
      if (!wasRecovered) animateEl(b.root, [{ transform: 'scale(1.9) rotate(-16deg)' }, { transform: 'scale(0.9) rotate(4deg)', offset: 0.6 }, { transform: 'scale(1) rotate(0)' }], { duration: 560, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
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

  /** "경찰 출동까지 N초" while a dispatch is pending; "경찰 N명 출동 중" while officers roam. */
  private paintPolice(m: HudModel): void {
    const p = m.police ?? null;
    const sec = p && p.dispatchInSec !== null ? Math.ceil(p.dispatchInSec) : null;
    const key = p ? `${sec ?? '-'}|${p.officers}|${p.alarms}` : '';
    if (key === this.cPolice) return;
    const was = this.cPolice;
    this.cPolice = key;
    if (!p || (sec === null && p.officers === 0)) {
      this.policeEl.hidden = true;
      return;
    }
    this.policeEl.hidden = false;
    const pending = sec !== null;
    this.policeEl.dataset.state = pending ? 'pending' : 'active';
    setChildren(
      this.policeEl,
      h('span', { class: 'uh-police__lights', 'aria-hidden': 'true' }, h('i'), h('i')),
      h('span', { class: 'uh-police__icon' }, icon(pending ? 'siren' : 'police')),
      h('span', { class: 'uh-police__text' }, pending ? t('hud.policeIn', { sec: Math.max(0, sec!) }) : t('hud.policeOn', { n: p.officers })),
    );
    if (!was) animateEl(this.policeEl, [{ transform: 'translateY(-1rem) scale(0.6)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
  }

  private paintCarry(m: HudModel): void {
    const c = m.carry;
    const key = c ? `${c.kind}|${c.value}|${c.building ?? ''}|${c.safes ?? ''}|${c.variant ?? ''}` : '';
    if (key !== this.cCarry) {
      const before = this.cCarry;
      this.cCarry = key;
      this.cCarryProg = -1;
      if (!c) {
        this.carryEl.hidden = true;
      } else {
        this.carryEl.hidden = false;
        this.carryEl.dataset.kind = c.kind;
        const showBreakdown = c.kind === 'bank' && c.building !== undefined;
        this.carryEl.replaceChildren(
          h('span', { class: 'uh-carry__hole', 'aria-hidden': 'true' }),
          h('span', { class: 'uh-carry__tag' }, icon('hand'), t('hud.carrying')),
          h(
            'div',
            { class: 'uh-carry__main' },
            c.variant ? propGlyph(c.variant, 'uh-cglyph uh-carry__art') : objectPortrait(c.kind as LootKind, 'uh-carry__art'), // [C8]
            h(
              'div',
              { class: 'uh-carry__text' },
              h('span', { class: 'uh-carry__value uh-num' }, t('hud.estimate', { value: c.value })),
              showBreakdown
                ? h('span', { class: 'uh-carry__breakdown' }, t('hud.bankBreakdown', { building: c.building ?? 0, safes: c.safes ?? 0 }))
                : h('span', { class: 'uh-carry__breakdown' }, c.variant ? t(propNameKey(c.variant)) : t(`loot.${c.kind}.name`)), // [C8]
            ),
          ),
          h('div', { class: 'uh-carry__foot' }, h('span', { class: 'uh-carry__note' }, t('hud.carryNote')), h('div', { class: 'uh-carry__bar' }, h('i'))),
        );
        if (!before) animateEl(this.carryEl, [{ transform: 'translateY(2rem) rotate(-14deg) scale(0.6)', opacity: 0 }, { transform: 'rotate(-3deg)', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
        else animateEl(this.carryEl, [{ scale: '1.08' }, { scale: '1' }], { duration: 260, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
      }
    }
    if (c) {
      const p = c.recovering === null || c.recovering === undefined ? -1 : Math.round(clamp01(c.recovering) * 100) / 100;
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
    const key = g ? `${g.action}|${g.target}|${g.value}|${g.anchored ? 1 : 0}|${g.unanchorSec ?? ''}|${g.variant ?? ''}` : '';
    if (key !== this.cGrab) {
      const before = this.cGrab;
      this.cGrab = key;
      this.cGrabProg = -1;
      if (!g) {
        this.grabEl.hidden = true;
      } else {
        this.grabEl.hidden = false;
        this.grabEl.dataset.action = g.action;
        const lootKind: LootKind = g.target === 'bankWall' ? 'bank' : g.target;
        const name = g.variant ? t(propNameKey(g.variant)) : g.target === 'bankWall' ? t('loot.bankWall') : t(`loot.${g.target}.name`); // [C8] props by name
        setChildren(
          this.grabEl,
          h(
            'div',
            { class: 'uh-grab__main' },
            glyphChip('grab'),
            h('span', { class: 'uh-grab__verb' }, t(g.action === 'grab' ? 'hud.grab' : 'hud.release')),
            g.variant ? propGlyph(g.variant, 'uh-cglyph uh-grab__art') : objectPortrait(lootKind, 'uh-grab__art'), // [C8]
            h('span', { class: 'uh-grab__name' }, name),
            h('span', { class: 'uh-grab__value uh-num' }, fmtScore(g.value)),
          ),
          g.anchored && g.action === 'grab'
            ? h('span', { class: 'uh-grab__anchor' }, h('span', { class: 'uh-grab__anchorText' }, t('hud.anchored', { sec: g.unanchorSec ?? 1 })), h('span', { class: 'uh-grab__anchorBar' }, h('i')))
            : null,
        );
        if (!before) animateEl(this.grabEl, [{ transform: 'translateY(1rem) scale(0.7)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
      }
    }
    if (g && g.anchored) {
      const p = g.unanchorProgress === null || g.unanchorProgress === undefined ? -1 : Math.round(clamp01(g.unanchorProgress) * 100) / 100;
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
    setChildren(
      this.tutorialEl,
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
    animateEl(this.tutorialEl, [{ transform: 'translateX(-2rem) rotate(-4deg)', opacity: 0 }, { transform: 'rotate(-1deg)', opacity: 1 }], { duration: 380, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
  }

  /** Language changed: rebuild labels and force a full refresh on the next update. */
  private relabel(): void {
    this.cMode = null;
    this.cSwing = '';
    this.cMp = '';
    this.cCarry = '';
    this.cGrab = '';
    this.cPolice = '';
    this.cDash = -1;
    this.labels.invalidate();
    this.paintTutorial();
    this.taunts.relabel();
    if (this.model) this.update(this.model);
  }
}
