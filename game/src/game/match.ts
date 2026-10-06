/**
 * MatchController (docs/ARCHITECTURE.md "Game flow"): owns one Simulation, its bots, the human's
 * input, the fixed 60 Hz accumulator, and drives GameView, the HUD and audio from sim events.
 *
 * Frame order (integration notes):
 *   sim.step -> view.captureTick -> view.onEvents -> setBotTelegraph -> view.render(sim, alpha,
 *   frameDt, focus); view.takeHitstop() after each fed batch -> TimeScale.hitstop.
 *
 * - Start countdown 3-2-1-출발 before the first step (the sim does not tick during it).
 * - Fixed step with at most 5 steps per frame; a hidden tab / long hitch never fast-forwards
 *   (realDt is clamped); pause stops the accumulator.
 * - Input: exactly one InputManager.pollMatch() per sim tick (edges latch between polls, so a
 *   press during hit-stop is buffered, not lost); GrabLatch turns hold/toggle into Command.grab.
 * - Hit-stop / slow-mo only change wall-clock pacing (deterministic ticks).
 */
import { Bot, RivalObserver, createBot, type BotController, type ObservationSummary } from '../ai';
import { MatchAudioDirector, type AudioEngine } from '../audio';
import { DT, TICK_RATE, VISION, Simulation, type CharacterState, type Command, type EntityId, type MatchResult, type SimEvent, type TeamId, type Vec2 } from '../sim';
import type { GameView, ViewFocus } from '../render';
import { GrabLatch, buildCommand, type InputManager, type MatchFrame } from '../platform/input';
import type { Settings } from '../platform/settings';
import { unlockAchievement } from '../platform/steam';
import { hudModelFromSim, type Hud, type HudModel, type OffscreenTarget, type Toasts } from '../ui';
import { evaluateMatchAchievements } from './achievements';
import { RUMBLE, TimeScale, rumbleFor, type RumbleName } from './feel';
import type { LaunchParams } from './params';
import { pickBiggestEvent, type BiggestEvent } from './results';
import { buildMatch, type MatchConfig } from './setup';

export const MAX_STEPS_PER_FRAME = 5;
/** Real-time clamp for one frame (hidden tab, debugger, long GC). */
const MAX_FRAME_DT = 0.1;
/** Seconds between "출발!" and handing control over is 0; each count lasts this long. */
const COUNT_SECONDS = 0.8;
/** Wall-clock pause between the end horn and the results screen. */
const END_HOLD_SECONDS = 2.4;
/** HUD score roll-up duration (s). */
const ROLLUP_SECONDS = 0.45;
/** Value tags for safes within this radius (doc §4: never every number at once). */
const NEAR_LABEL_RADIUS = 8;

export type MatchOutcome = 'win' | 'lose' | 'draw';

export interface MatchSummary {
  config: MatchConfig;
  result: MatchResult;
  outcome: MatchOutcome;
  biggest: BiggestEvent | null;
  observation: ObservationSummary | null;
  /** Ticks played. */
  ticks: number;
}

/** Scripted layer on top of a match (the tutorial). */
export interface MatchScript {
  /** Optional autopilot for the human slot (autotest). */
  autopilot?(sim: Simulation): Command | null;
  onEvents(events: readonly SimEvent[], sim: Simulation): void;
  /** Per rendered frame (dt = wall seconds). */
  update(dt: number, sim: Simulation): void;
  /** Ids to highlight (ping pulse in the view, arrows in the HUD). */
  focusTargets(): readonly EntityId[];
  /** World point the player should head to when no entity is targeted. */
  focusPoint?(): Vec2 | null;
  /** The script decided the session is over (tutorial completed). */
  readonly finished: boolean;
  dispose(): void;
}

export interface MatchServices {
  view: GameView;
  hud: Hud;
  input: InputManager;
  audio: AudioEngine;
  toasts: Toasts;
  settings: () => Readonly<Settings>;
  params: LaunchParams;
  /** Logged instead of thrown for non-fatal problems. */
  log?: (msg: string) => void;
}

export interface MatchHooks {
  /** The player pressed pause (Esc / Start). */
  onPauseRequest(): void;
  /** Match finished (after the end hold): show results. */
  onFinished(summary: MatchSummary): void;
}

type Phase = 'loaded' | 'countdown' | 'playing' | 'ending' | 'done';

export class MatchController {
  readonly config: MatchConfig;
  readonly sim: Simulation;
  readonly bots: BotController[];
  readonly meId: EntityId;
  readonly myTeam: TeamId = 0;
  readonly observer: RivalObserver | null;
  private readonly proxy: Bot | null;
  private script: MatchScript | null = null;
  private readonly svc: MatchServices;
  private readonly hooks: MatchHooks;
  private readonly director: MatchAudioDirector;
  private readonly latch: GrabLatch;
  readonly time = new TimeScale();

  private phase: Phase = 'loaded';
  private paused = false;
  private acc = 0;
  private countLeft = 0;
  private countShown = -1;
  private endHold = 0;
  private frameNo = 0;
  private disposed = false;
  private readonly cmds: (Command | undefined)[] = [];
  private pendingPing: { pos: Vec2; targetId: EntityId | null } | null = null;
  private earned = new Set<string>();
  private dispScores: [number, number] = [0, 0];
  private rollFrom: [number, number] = [0, 0];
  private rollT: [number, number] = [1, 1];
  private readonly rumbleTimers: number[] = [];
  /** The first police dispatch of this match was explained to the player. */
  private policeExplained = false;
  private lastFrame: MatchFrame | null = null;
  private forcedResult: MatchResult | null = null;
  private summaryCache: MatchSummary | null = null;
  private pauseRequested = false;
  private skipView = 0;
  private skipReal = 0;
  /** Counts of steps/frames (autotest diagnostics). */
  readonly stats = { steps: 0, frames: 0, renders: 0, hitstops: 0, slowmos: 0, maxStepsHit: 0 };

  constructor(svc: MatchServices, config: MatchConfig, hooks: MatchHooks) {
    this.svc = svc;
    this.config = config;
    this.hooks = hooks;
    const built = buildMatch(config);
    this.sim = new Simulation(built.setup);
    this.meId = this.sim.characterBySlot(built.humanSlot).id;
    // createBot warms the shared nav caches (10-40 ms): this runs behind the loading screen.
    this.bots = built.bots.map((b) => createBot(this.sim, { slot: b.slot, personality: b.personality, difficulty: b.difficulty, adaptation: b.adaptation, seed: b.seed }));
    this.proxy =
      svc.params.autotest && config.kind !== 'tutorial'
        ? new Bot(this.sim, { slot: 0, personality: 'hodadak', difficulty: 'challenge', seed: (config.seed ^ 0x5eed) >>> 0, humanProxy: true })
        : null;
    this.observer = config.kind === 'tournament' ? new RivalObserver(this.sim, this.myTeam) : null;
    this.director = new MatchAudioDirector(svc.audio, { localTeam: this.myTeam, listenerCharId: this.meId });
    this.latch = new GrabLatch(svc.settings().grabMode);
    this.time.setEnabled(!svc.settings().reducedMotion);
  }

  attachScript(script: MatchScript): void {
    this.script = script;
  }

  get scriptRef(): MatchScript | null {
    return this.script;
  }

  get state(): Phase {
    return this.phase;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get isPractice(): boolean {
    return this.config.kind === 'tutorial';
  }

  /** Build the 3D scene and the HUD for this match (call behind the loading screen). */
  load(): void {
    const { view, hud } = this.svc;
    view.load(this.sim);
    view.setMode('preview');
    hud.reset();
    hud.setLayout(this.sim.layout);
    const rivalBot = this.sim.state.characters.find((c) => c.team === 1 && c.look.rival);
    hud.setTeamLabels(this.sim.state.characters.length === 2 && rivalBot ? [null, `rival.${rivalBot.look.rival}.name`] : null);
    hud.setCaptionsEnabled(this.svc.settings().subtitles);
  }

  /** In-world 3-2-1-출발 (no sim steps until it ends). */
  beginCountdown(): void {
    if (this.disposed) return;
    this.svc.view.setMode('match');
    this.svc.hud.show();
    this.phase = 'countdown';
    this.countLeft = 3 * COUNT_SECONDS + 0.05;
    this.countShown = -1;
    this.svc.audio.playMusic('none');
  }

  // ------------------------------------------------------------------------------------------
  // Per animation frame
  // ------------------------------------------------------------------------------------------

  frame(realDtIn: number): void {
    if (this.disposed || this.phase === 'done') return;
    const realDt = Math.min(MAX_FRAME_DT, Math.max(0, Number.isFinite(realDtIn) ? realDtIn : 0));
    this.stats.frames++;
    this.frameNo++;
    const { view } = this.svc;

    if (this.paused) {
      this.renderView(0, 1);
      return;
    }

    let viewDt = realDt;
    if (this.phase === 'countdown') {
      this.countdownFrame(realDt);
    } else if (this.phase === 'playing') {
      const scaled = this.time.advance(realDt);
      viewDt = scaled;
      this.acc += scaled * this.svc.params.speed;
      const maxSteps = MAX_STEPS_PER_FRAME * Math.max(1, Math.ceil(this.svc.params.speed));
      let steps = 0;
      while (this.acc >= DT && steps < maxSteps && this.phase === 'playing' && !this.paused && !this.pauseRequested && !this.time.frozen) {
        this.acc -= DT;
        steps++;
        this.stepOnce();
        const hs = view.takeHitstop();
        if (hs > 0 && this.svc.params.speed <= 1) {
          this.time.hitstop(hs);
          this.stats.hitstops++;
          break; // freeze now; the remaining accumulator waits for the hit-stop to pass
        }
      }
      if (steps >= maxSteps && this.acc >= DT && !this.time.frozen) {
        this.stats.maxStepsHit++;
        this.acc = Math.min(this.acc, DT); // never spiral: drop the backlog
      }
      if (this.time.frozen) viewDt = 0;
      if (this.pauseRequested) {
        this.pauseRequested = false;
        this.hooks.onPauseRequest();
      }
    } else if (this.phase === 'ending') {
      viewDt = this.time.advance(realDt);
      this.endHold -= realDt;
      if (this.endHold <= 0) this.finish();
    }

    if (this.disposed || (this.phase as Phase) === 'done') return;
    this.script?.update(realDt, this.sim);
    if (this.script?.finished && this.phase === 'playing') this.endNow('script');
    const alpha = this.phase === 'playing' ? Math.min(1, this.acc / DT) : 1;
    // With ?render=N (software GL tests) the skipped frames' time is handed to the next draw so
    // camera smoothing and HUD animations keep up with the sim.
    this.skipView += viewDt;
    this.skipReal += realDt;
    if (this.renderView(this.skipView, alpha)) {
      this.updateHud(this.skipReal);
      this.skipView = 0;
      this.skipReal = 0;
    }
    this.director.update(this.sim, viewDt, this.sim.getCharacter(this.meId)?.pos);
  }

  private countdownFrame(realDt: number): void {
    // Watch for pause during the countdown (the match consumer owns input in this context).
    const f = this.svc.input.pollMatch();
    if (f.pausePressed) {
      this.hooks.onPauseRequest();
      return;
    }
    this.countLeft -= realDt * Math.max(1, this.svc.params.speed);
    const n = Math.max(0, Math.ceil(this.countLeft / COUNT_SECONDS));
    if (n !== this.countShown) {
      this.countShown = n;
      this.svc.hud.countdown(n);
      this.director.countdown(n);
      if (n === 0) {
        this.phase = 'playing';
        this.acc = 0;
        this.latch.reset();
      }
    }
  }

  private renderView(viewDt: number, alpha: number): boolean {
    const every = this.svc.params.renderEvery;
    if (every > 1 && this.frameNo % every !== 0 && this.phase !== 'loaded') return false;
    this.stats.renders++;
    // A hit-stop freeze-frame is drawn with frameDt = 0 (every view animation holds still).
    this.svc.view.render(this.sim, alpha, this.time.frozen ? 0 : Math.min(0.1, viewDt), this.focus());
    return true;
  }

  focus(): ViewFocus {
    const me = this.sim.getCharacter(this.meId);
    const pingTargetIds: EntityId[] = [];
    for (const p of this.sim.state.pings) if (p.team === this.myTeam && p.targetId !== null) pingTargetIds.push(p.targetId);
    if (this.script) for (const id of this.script.focusTargets()) if (!pingTargetIds.includes(id)) pingTargetIds.push(id);
    return { charId: this.meId, grabCandidate: me && !me.grab ? this.sim.getGrabCandidate(this.meId) : null, pingTargetIds };
  }

  // ------------------------------------------------------------------------------------------
  // One sim tick
  // ------------------------------------------------------------------------------------------

  private stepOnce(): void {
    const sim = this.sim;
    const cmds = this.cmds;
    cmds.length = sim.state.characters.length;
    cmds[0] = this.humanCommand();
    for (const b of this.bots) cmds[b.slot] = b.update(sim);
    const events = sim.step(cmds);
    this.stats.steps++;
    const { view } = this.svc;
    view.captureTick(sim);
    view.onEvents(events, sim);
    for (const b of this.bots) {
      const it = b.intent?.();
      if (it) view.setBotTelegraph(sim.characterBySlot(b.slot).id, it.telegraph, it.goal);
    }
    this.observer?.observe(sim, events);
    if (events.length) {
      this.director.onEvents(events, sim);
      this.script?.onEvents(events, sim);
      this.handleEvents(events);
    }
    if (sim.state.over && this.phase === 'playing') this.beginEnding();
  }

  private humanCommand(): Command {
    const sim = this.sim;
    const me = sim.getCharacter(this.meId)!;
    // Exactly one match poll per tick, also under autotest (pause must keep working).
    const f = this.svc.input.pollMatch();
    this.lastFrame = f;
    // Pause after this tick (the command still applies so nothing is dropped).
    if (f.pausePressed) this.pauseRequested = true;
    if (this.proxy) return this.proxy.update(sim);
    const auto = this.script?.autopilot?.(sim);
    if (auto) return auto;
    const grab = this.latch.update(f, me.grab !== null);
    let ping = this.pendingPing;
    this.pendingPing = null;
    if (!ping && f.pingPressed) ping = this.resolvePing(me, f);
    return buildCommand(f, grab, ping);
  }

  /** Key ping: at the grab candidate, else the ground ahead. Mouse ping: the cursor. */
  private resolvePing(me: CharacterState, f: MatchFrame): { pos: Vec2; targetId: EntityId | null } | null {
    const sim = this.sim;
    if (f.pingAtPointer) {
      const p = this.svc.view.pickGround(f.pingAtPointer.clientX, f.pingAtPointer.clientY);
      if (!p) return null;
      return { pos: p, targetId: this.lootAt(p) };
    }
    const cand = me.grab ? null : sim.getGrabCandidate(me.id);
    if (cand) return { pos: { ...cand.anchorWorld }, targetId: cand.targetId };
    return { pos: { x: me.pos.x + Math.cos(me.facing) * 4, y: me.pos.y + Math.sin(me.facing) * 4 }, targetId: null };
  }

  /** Loot under a ground point (safes first: they sit on top of bank floors). */
  private lootAt(p: Vec2): EntityId | null {
    let bank: EntityId | null = null;
    for (const l of this.sim.state.loot) {
      if (l.recovered) continue;
      const o = this.sim.lootOBB(l.id);
      const dx = p.x - o.center.x;
      const dy = p.y - o.center.y;
      const c = Math.cos(o.angle);
      const s = Math.sin(o.angle);
      const lx = dx * c + dy * s;
      const ly = -dx * s + dy * c;
      const pad = l.kind === 'bank' ? 0 : 0.35;
      if (Math.abs(lx) <= o.half.x + pad && Math.abs(ly) <= o.half.y + pad) {
        if (l.kind !== 'bank') return l.id;
        bank = l.id;
      }
    }
    return bank;
  }

  // ------------------------------------------------------------------------------------------
  // Events -> HUD, rumble, achievements, feel
  // ------------------------------------------------------------------------------------------

  private handleEvents(events: readonly SimEvent[]): void {
    const sim = this.sim;
    const { hud } = this.svc;
    let checkAch = false;
    for (const e of events) {
      const r = rumbleFor(e, sim, this.meId, this.myTeam);
      if (r) this.rumble(r);
      switch (e.type) {
        case 'recovered': {
          checkAch = true;
          const zone = sim.layout.zones.find((z) => z.team === e.team);
          const p = zone ? this.svc.view.project(zone.center, 2.2) : null;
          hud.popScore({
            team: e.team,
            kind: e.kind,
            value: e.value,
            building: e.kind === 'bank' ? e.value - e.safesValue : undefined,
            safes: e.kind === 'bank' ? e.safesValue : undefined,
            x: p && p.onScreen ? p.x : undefined,
            y: p && p.onScreen ? p.y : undefined,
          });
          this.juiceScore(e.team, e.kind === 'bank' ? 1 : e.kind === 'largeSafe' ? 0.6 : 0.35);
          // Slow-mo when a recovery lands in the last 3 s of the clock (the deciding one is
          // handled by matchEnd below).
          const left = sim.ticksLeft();
          if (Number.isFinite(left) && left <= 3 * TICK_RATE) this.slowmo();
          break;
        }
        case 'fenceBroken':
          checkAch = true;
          break;
        case 'policeDispatched':
          // Police (owner addition beyond doc v0.5): tell the player what the car is and what
          // the officers do, once in full, then a short notice per later wave.
          this.svc.toasts.show({
            kicker: 'police.dispatched.kicker',
            title: 'police.dispatched.title',
            body: this.policeExplained ? null : 'police.dispatched.body',
            icon: 'siren',
            durationMs: this.policeExplained ? 2200 : 4200,
          });
          this.policeExplained = true;
          break;
        case 'finalCountdown': {
          const sec = Math.max(1, Math.round((e.endTick - e.tick) / TICK_RATE));
          hud.banner('escape', { sec });
          this.svc.view.cameraKick({ shake: 0.25 });
          this.hudSlam(1);
          break;
        }
        case 'matchEnd':
          break;
        default:
          break;
      }
    }
    if (checkAch && !this.isPractice) this.checkAchievements(null);
  }

  private juiceScore(team: TeamId, strength: number): void {
    const s = this.svc.settings();
    if (s.reducedMotion) return;
    const el = this.svc.hud.el.querySelector<HTMLElement>(`.uh-sb__team--${team}`) ?? this.svc.hud.el.querySelector<HTMLElement>('.uh-practice');
    if (!el || typeof el.animate !== 'function') return;
    const k = 1 + 0.18 * strength;
    // Individual `translate`/`scale` properties compose with any layout `transform` the HUD CSS
    // sets on the element, so the juice never displaces it.
    el.animate(
      [
        { translate: '0 0', scale: '1' },
        { translate: `0 ${(-6 * strength).toFixed(1)}px`, scale: k.toFixed(3), offset: 0.35 },
        { translate: '0 0', scale: '0.97', offset: 0.7 },
        { translate: '0 0', scale: '1' },
      ],
      { duration: 420 + 200 * strength, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
    );
  }

  /** Banner slam: the scoreboard jolts down and settles as a big banner lands. */
  private hudSlam(strength: number): void {
    if (this.svc.settings().reducedMotion) return;
    const el = this.svc.hud.el.querySelector<HTMLElement>('.uh-hud__topWrap');
    if (!el || typeof el.animate !== 'function') return;
    const d = (10 * strength).toFixed(1);
    // `.uh-hud__topWrap` is centred with `transform: translateX(-50%)` in hud.css: animate the
    // individual `translate`/`scale` properties (they compose with it) instead of replacing it.
    el.animate(
      [
        { translate: '0 0', scale: '1' },
        { translate: `0 ${d}px`, scale: '1.04', offset: 0.18 },
        { translate: `0 ${(-3 * strength).toFixed(1)}px`, scale: '1', offset: 0.5 },
        { translate: '0 0', scale: '1' },
      ],
      { duration: 460, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
  }

  private slowmo(): void {
    if (this.svc.params.speed > 1) return;
    if (!this.time.slow) this.stats.slowmos++;
    this.time.slowmo();
  }

  private rumble(name: RumbleName): void {
    const s = this.svc.settings();
    if (!s.vibration) return;
    let at = 0;
    for (const p of RUMBLE[name]) {
      at += p.delayMs ?? 0;
      if (at === 0) this.svc.input.vibrate(p.strength, p.ms);
      else this.rumbleTimers.push(window.setTimeout(() => !this.disposed && this.svc.input.vibrate(p.strength, p.ms), at));
    }
  }

  private checkAchievements(result: MatchResult | null): void {
    const sim = this.sim;
    const ids = evaluateMatchAchievements({
      events: sim.eventLog,
      result,
      humanCharId: this.meId,
      humanTeam: this.myTeam,
      characters: sim.state.characters,
      loot: sim.state.loot,
      rules: sim.rules,
    });
    for (const id of ids) {
      if (this.earned.has(id)) continue;
      this.earned.add(id);
      try {
        unlockAchievement(id);
      } catch (err) {
        this.svc.log?.(`[match] achievement ${id} failed: ${String(err)}`);
      }
    }
  }

  // ------------------------------------------------------------------------------------------
  // HUD
  // ------------------------------------------------------------------------------------------

  private isOpponentVisible = (c: CharacterState): boolean => {
    const st = this.sim.state;
    const r2 = VISION.radius * VISION.radius;
    for (const t of st.characters) {
      if (t.team !== this.myTeam) continue;
      const dx = c.pos.x - t.pos.x;
      const dy = c.pos.y - t.pos.y;
      if (dx * dx + dy * dy > r2) continue;
      if (this.sim.lineOfSight(t.pos, c.pos)) return true;
    }
    return false;
  };

  private updateHud(realDt: number): void {
    const { view, hud } = this.svc;
    const sim = this.sim;
    const m: HudModel = hudModelFromSim(sim, {
      meId: this.meId,
      myTeam: this.myTeam,
      mode: this.isPractice ? 'practice' : 'match',
      project: (p, h) => view.project(p, h),
      isOpponentVisible: this.isOpponentVisible,
      nearRadius: NEAR_LABEL_RADIUS,
    });
    // Score roll-up (presentation only: the confirmed score is already final in the sim).
    const reduced = this.svc.settings().reducedMotion;
    const shown: [number, number] = [0, 0];
    for (const t of [0, 1] as const) {
      const target = sim.state.scores[t];
      if (target !== this.dispScores[t] && this.rollT[t] >= 1) {
        this.rollFrom[t] = this.dispScores[t];
        this.rollT[t] = 0;
      }
      if (reduced || this.rollT[t] >= 1) {
        this.dispScores[t] = target;
        this.rollT[t] = 1;
      } else {
        this.rollT[t] = Math.min(1, this.rollT[t] + realDt / ROLLUP_SECONDS);
        const k = 1 - Math.pow(1 - this.rollT[t], 3);
        const v = this.rollFrom[t] + (target - this.rollFrom[t]) * k;
        this.dispScores[t] = this.rollT[t] >= 1 ? target : Math.min(target, Math.round(v / 10) * 10);
      }
      shown[t] = this.dispScores[t];
    }
    const model: HudModel = { ...m, scores: shown, timeLeftSec: this.phase === 'countdown' || this.phase === 'loaded' ? (this.sim.rules.timeLimit ? this.sim.rules.matchTicks / TICK_RATE : null) : m.timeLeftSec };
    const extra = this.scriptArrows();
    if (extra.length) model.arrows = [...(model.arrows ?? []), ...extra];
    if (this.phase === 'ending') {
      model.grab = null;
      model.carry = null;
    }
    hud.update(model);
  }

  private scriptArrows(): OffscreenTarget[] {
    if (!this.script) return [];
    const out: OffscreenTarget[] = [];
    for (const id of this.script.focusTargets()) {
      const l = this.sim.getLoot(id);
      if (!l || l.recovered) continue;
      const p = this.svc.view.project(l.pos, 1);
      if (!p.onScreen) out.push({ id: `tut:${id}`, x: p.x, y: p.y, kind: l.kind === 'bank' ? 'bank' : 'safe', team: this.myTeam, value: l.estimatedValue });
    }
    const fp = this.script.focusPoint?.();
    if (fp) {
      const p = this.svc.view.project(fp, 0.5);
      if (!p.onScreen) out.push({ id: 'tut:point', x: p.x, y: p.y, kind: 'zone', team: this.myTeam });
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------
  // End of match
  // ------------------------------------------------------------------------------------------

  private beginEnding(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'ending';
    this.endHold = END_HOLD_SECONDS;
    const res = this.sim.state.result;
    const { hud } = this.svc;
    if (res) {
      hud.banner(res.reason === 'time' ? 'timeUp' : res.reason === 'decided' ? 'decided' : 'allRecovered', undefined, 2200);
      this.hudSlam(0.8);
      // A recovery that decides the match (or the clock running out) gets a brief slow-mo.
      this.slowmo();
      if (res.winner === this.myTeam) this.svc.view.cameraKick({ zoom: 0.06 });
    }
    if (!this.isPractice && res) this.checkAchievements(res);
  }

  /** End right now (script finished / test hook). */
  endNow(reason: 'script' | 'test' = 'test'): void {
    if (this.phase === 'done' || this.phase === 'loaded' || this.disposed) return;
    if (reason === 'script') {
      this.phase = 'ending';
      this.endHold = 0.01;
      return;
    }
    if (!this.sim.state.over) {
      const st = this.sim.state;
      const [a, b] = st.scores;
      this.forcedResult = { reason: 'time', winner: a === b ? null : a > b ? 0 : 1, scores: [a, b], endTick: st.tick };
    }
    this.finish();
  }

  /** Test hook: finish with a fabricated result (results-screen testing only). */
  forceResult(r: Partial<MatchResult>): boolean {
    if (this.disposed || (this.phase !== 'countdown' && this.phase !== 'playing' && this.phase !== 'ending')) return false;
    const st = this.sim.state;
    this.forcedResult = {
      reason: r.reason ?? 'time',
      scores: r.scores ?? [st.scores[0], st.scores[1]],
      winner: r.winner === undefined ? null : r.winner,
      endTick: st.tick,
    };
    this.finish();
    return true;
  }

  private finish(): void {
    if (this.phase === 'done') return;
    this.phase = 'done';
    this.director.stop();
    const summary = this.summary();
    this.hooks.onFinished(summary);
  }

  summary(): MatchSummary {
    if (this.summaryCache) return this.summaryCache;
    const sim = this.sim;
    const st = sim.state;
    const result: MatchResult = this.forcedResult ?? st.result ?? { reason: 'time', winner: st.scores[0] === st.scores[1] ? null : st.scores[0] > st.scores[1] ? 0 : 1, scores: [st.scores[0], st.scores[1]], endTick: st.tick };
    const outcome: MatchOutcome = result.winner === null ? 'draw' : result.winner === this.myTeam ? 'win' : 'lose';
    const biggest = pickBiggestEvent({ events: sim.eventLog, characters: st.characters, loot: st.loot, rules: sim.rules });
    this.summaryCache = { config: this.config, result, outcome, biggest, observation: this.observer ? this.observer.summary() : null, ticks: st.tick };
    return this.summaryCache;
  }

  // ------------------------------------------------------------------------------------------
  // Pause / settings
  // ------------------------------------------------------------------------------------------

  pause(): void {
    if (this.paused || this.disposed) return;
    this.paused = true;
    this.director.stop();
    this.svc.audio.setMuffled(true);
    this.svc.hud.hide();
  }

  /** Resume (never flushes input: held grabs stay held — integration notes). */
  resume(): void {
    if (!this.paused || this.disposed) return;
    this.paused = false;
    this.acc = 0;
    this.svc.audio.setMuffled(false);
    this.svc.hud.show();
  }

  applySettings(s: Readonly<Settings>): void {
    this.latch.setMode(s.grabMode);
    this.time.setEnabled(!s.reducedMotion);
    this.svc.hud.setCaptionsEnabled(s.subtitles);
  }

  /** Queue a ping for the next tick (tests / UI). */
  ping(pos: Vec2, targetId: EntityId | null): void {
    this.pendingPing = { pos, targetId };
  }

  debugInfo(): Record<string, unknown> {
    return {
      phase: this.phase,
      paused: this.paused,
      tick: this.sim.state.tick,
      over: this.sim.state.over,
      scores: [...this.sim.state.scores],
      ticksLeft: this.sim.ticksLeft(),
      timeScale: this.time.scale,
      stats: { ...this.stats },
      lastFrame: this.lastFrame ? { move: this.lastFrame.move, grab: this.lastFrame.grabDown } : null,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.phase = 'done';
    for (const t of this.rumbleTimers) window.clearTimeout(t);
    this.director.stop();
    this.svc.audio.setMuffled(false);
    this.script?.dispose();
    this.script = null;
  }
}
