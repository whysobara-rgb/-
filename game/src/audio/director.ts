/**
 * MatchAudioDirector: turns simulation events and state into sound, so game flow only needs
 *
 *   const dir = new MatchAudioDirector(getAudioEngine(), { localTeam: 0, listenerCharId: 1 });
 *   const events = sim.step(cmds);  dir.onEvents(events, sim);      // every tick
 *   dir.update(sim, frameDt);                                       // every rendered frame
 *   dir.stop();                                                      // leaving / pausing
 *
 * Event sounds are positional (listener = the local raccoon). Continuous loops follow state:
 * scraping safes, grinding banks, creaking unanchors and the final-countdown siren. Music
 * intensity rises with moving banks, recoveries in progress, close scores and little time left.
 * Consecutive recoveries by the local team climb the pentatonic scale (ART_DIRECTION §1).
 */
import type { CharacterState, EntityId, LootState, SimEvent, SimState, TeamId, Vec2 } from '../sim/types';
import { TICK_RATE } from '../sim/config';
import type { AudioEngine } from './audio';
import type { LoopId } from './ids';

/** The subset of `Simulation` the director reads (structural, so tests can fake it). */
export interface AudioSimView {
  readonly state: SimState;
  getLoot(id: EntityId): LootState | undefined;
  getCharacter(id: EntityId): CharacterState | undefined;
}

export interface DirectorOptions {
  /** Team of the local human (own scores sound brighter and climb in combo; team pings). */
  localTeam: TeamId;
  /** Character whose position is the listener (default: first human of localTeam, else slot 0). */
  listenerCharId?: EntityId | null;
  /** Switch tracks and drive setMusicIntensity from match state (default true). */
  driveMusic?: boolean;
  /** Play the victory / defeat / draw stinger after the end horn (default true). */
  resultJingle?: boolean;
  /** Footsteps on/off (default true). */
  footsteps?: boolean;
}

/** Seconds within which another recovery continues the combo climb. */
const COMBO_WINDOW = 8;
const COMBO_MAX = 6;
/** Bump impulse (N*s) mapped to full volume; the sim only reports approaches > 2.5 m/s. */
const BUMP_FULL_IMPULSE = 400;
const FINAL_COUNTDOWN_SECONDS = 30;

const len = (v: Vec2): number => Math.hypot(v.x, v.y);
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export class MatchAudioDirector {
  private readonly engine: AudioEngine;
  private readonly opts: Required<Omit<DirectorOptions, 'listenerCharId'>> & { listenerCharId: EntityId | null };
  /** Distance walked since the last footstep, per character. */
  private readonly stride = new Map<EntityId, number>();
  private activeLoops = new Set<string>();
  private combo = 0;
  private lastOwnScoreTime = -Infinity;
  private time = 0;
  private intensity = 0.4;
  private ended = false;

  constructor(engine: AudioEngine, opts: DirectorOptions) {
    this.engine = engine;
    this.opts = {
      localTeam: opts.localTeam,
      listenerCharId: opts.listenerCharId ?? null,
      driveMusic: opts.driveMusic ?? true,
      resultJingle: opts.resultJingle ?? true,
      footsteps: opts.footsteps ?? true,
    };
  }

  /** Change which character the listener follows (e.g. spectating after a series). */
  setListenerChar(id: EntityId | null): void {
    this.opts.listenerCharId = id;
  }

  /** Pre-match "3, 2, 1, GO": call with 3, 2, 1, 0. */
  countdown(remaining: number): void {
    this.engine.play('countdownBeep', { pitch: remaining > 0 ? 1 : 2 });
  }

  // -------------------------------------------------------------------------------------------

  onEvents(events: readonly SimEvent[], sim: AudioSimView): void {
    for (const e of events) this.onEvent(e, sim);
  }

  private charPos(sim: AudioSimView, id: EntityId): Vec2 | undefined {
    return sim.getCharacter(id)?.pos;
  }

  private entityPos(sim: AudioSimView, id: EntityId): Vec2 | undefined {
    return sim.getCharacter(id)?.pos ?? sim.getLoot(id)?.pos;
  }

  private onEvent(e: SimEvent, sim: AudioSimView): void {
    const a = this.engine;
    switch (e.type) {
      case 'matchStart':
        this.ended = false;
        a.play('whistleStart');
        if (this.opts.driveMusic) a.playMusic('match');
        break;
      case 'grab':
        a.play('grab', { pos: this.charPos(sim, e.charId), volume: e.part === 'bankWall' ? 1 : 0.9 });
        break;
      case 'release':
        // Forced releases come with a dash hit, which already makes the noise.
        if (!e.forced) a.play('release', { pos: this.charPos(sim, e.charId), volume: 0.85 });
        break;
      case 'unanchored': {
        const pos = sim.getLoot(e.lootId)?.pos;
        a.play(e.kind === 'bank' ? 'unanchorBank' : 'unanchorSafe', { pos, pitch: e.kind === 'largeSafe' ? 0.85 : 1 });
        break;
      }
      case 'dash':
        a.play('dash', { pos: this.charPos(sim, e.charId), pitch: e.carrying ? 0.8 : 1 });
        break;
      case 'dashHit': {
        const pos = this.charPos(sim, e.victimId);
        a.play('dashHit', { pos, volume: e.knockdown ? 1 : 0.85 });
        if (e.knockdown) a.play('knockdown', { pos, delay: 0.04 });
        break;
      }
      case 'bump': {
        const pa = this.entityPos(sim, e.aId);
        const pb = e.bId ? this.entityPos(sim, e.bId) : undefined;
        const pos = pa && pb ? { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 } : pa ?? pb;
        const heavy = !e.bId || !!sim.getLoot(e.bId) || !!sim.getLoot(e.aId);
        a.play('bump', { pos, volume: 0.25 + 0.75 * clamp01(e.impulse / BUMP_FULL_IMPULSE), pitch: heavy ? 0.8 : 1 });
        break;
      }
      case 'fenceBroken':
        a.play('fenceBreak', { pos: e.pos });
        break;
      case 'safeLoaded':
        a.play('safeLoad', { pos: sim.getLoot(e.bankId)?.pos ?? sim.getLoot(e.safeId)?.pos });
        break;
      case 'safeUnloaded':
        a.play('safeUnload', { pos: sim.getLoot(e.safeId)?.pos });
        break;
      case 'recoveryStart': {
        const own = e.team === this.opts.localTeam;
        a.play('recoverStart', { pos: sim.getLoot(e.lootId)?.pos, tag: e.lootId, volume: own ? 0.9 : 0.65, step: own ? 0 : -2 });
        break;
      }
      case 'recoveryCancel':
        a.stop('recoverStart', e.lootId);
        a.play('recoverCancel', { pos: sim.getLoot(e.lootId)?.pos, volume: e.team === this.opts.localTeam ? 1 : 0.7 });
        break;
      case 'recovered': {
        a.stop('recoverStart', e.lootId);
        const own = e.team === this.opts.localTeam;
        let step = -2;
        if (own) {
          this.combo = this.time - this.lastOwnScoreTime <= COMBO_WINDOW ? Math.min(COMBO_MAX, this.combo + 1) : 0;
          this.lastOwnScoreTime = this.time;
          step = this.combo;
        }
        const id = e.kind === 'bank' ? 'scoreBank' : e.kind === 'largeSafe' ? 'scoreLarge' : 'scoreSmall';
        a.play(id, { volume: own ? 1 : 0.7, step });
        break;
      }
      case 'finalCountdown':
        a.play('siren');
        if (this.opts.driveMusic) a.playMusic('final');
        break;
      case 'ejected':
        a.play('eject', { pos: e.pos });
        break;
      case 'unstuck':
        a.play('eject', { pos: e.pos, volume: 0.5, pitch: 1.2 });
        break;
      case 'ping':
        // Pings are team call-outs: opponents never hear them.
        if (e.team === this.opts.localTeam) a.play('ping', { variant: e.kind === 'grabTogether' ? 0 : 1 });
        break;
      case 'matchEnd': {
        this.ended = true;
        this.stop();
        a.play('hornEnd');
        if (this.opts.driveMusic) a.playMusic('none');
        if (this.opts.resultJingle) {
          const w = e.result.winner;
          a.play(w === null ? 'draw' : w === this.opts.localTeam ? 'victory' : 'defeat', { delay: 1.4 });
        }
        break;
      }
      case 'bankBodyRecovered':
        break;
    }
  }

  // -------------------------------------------------------------------------------------------

  /** Per rendered frame: listener, loops, footsteps and music intensity. */
  update(sim: AudioSimView, dt: number, listenerPos?: Vec2): void {
    const st = sim.state;
    const step = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
    this.time += step;
    const listener = listenerPos ?? this.listenerChar(st)?.pos;
    if (listener) this.engine.setListener(listener);
    if (st.over || this.ended) {
      this.silenceLoops(new Set());
      return;
    }

    const live = new Set<string>();
    const loop = (id: LoopId, i: number, pos: Vec2 | undefined, key: EntityId | string): void => {
      if (i <= 0) return;
      this.engine.setLoop(id, i, pos, key);
      live.add(`${id}|${key}`);
    };

    let bankMoving = false;
    let recovering = false;
    for (const l of st.loot) {
      if (l.recovered) continue;
      if (l.recovery) recovering = true;
      if (l.anchored) {
        if (l.grabbedBy.some((id) => sim.getCharacter(id)?.straining)) loop('strain', 0.15 + 0.85 * clamp01(l.unanchorProgress), l.pos, l.id);
        continue;
      }
      const speed = len(l.vel);
      if (l.kind === 'bank') {
        const s = speed + Math.abs(l.angVel) * 3;
        if (s > 0.06) {
          loop('bankRumble', clamp01(s / 1.4), l.pos, l.id);
          if (s > 0.3) bankMoving = true;
        }
      } else if (l.grabbedBy.length > 0 && l.floorOf === null && speed > 0.15) {
        loop('drag', clamp01(speed / 3.5), l.pos, l.id);
      }
    }

    if (st.finalCountdown && st.finalCountdownTick !== null) {
      const since = (st.tick - st.finalCountdownTick) / TICK_RATE;
      if (since > 2) {
        const left = Number.isFinite(st.endTick) ? (st.endTick - st.tick) / TICK_RATE : FINAL_COUNTDOWN_SECONDS;
        loop('sirenLoop', 0.15 + 0.35 * clamp01(1 - left / FINAL_COUNTDOWN_SECONDS), undefined, 'final');
      }
    }
    this.silenceLoops(live);

    if (this.opts.footsteps) this.footsteps(st, step);
    if (this.opts.driveMusic && !st.finalCountdown) this.driveMusic(st, step, bankMoving, recovering);
  }

  /** Silence every loop this director started (pause menu, leaving the match). */
  stop(): void {
    this.silenceLoops(new Set());
  }

  private silenceLoops(live: Set<string>): void {
    for (const k of this.activeLoops) {
      if (live.has(k)) continue;
      const sep = k.indexOf('|');
      this.engine.setLoop(k.slice(0, sep) as LoopId, 0, undefined, k.slice(sep + 1));
    }
    this.activeLoops = live;
  }

  private listenerChar(st: SimState): CharacterState | undefined {
    const id = this.opts.listenerCharId;
    if (id !== null) return st.characters.find((c) => c.id === id);
    return st.characters.find((c) => !c.isBot && c.team === this.opts.localTeam) ?? st.characters[0];
  }

  private footsteps(st: SimState, dt: number): void {
    const listenerId = this.listenerChar(st)?.id;
    for (const c of st.characters) {
      const intent = len(c.moveIntent);
      const speed = len(c.vel);
      if (c.knockdownTicks > 0 || intent < 0.2 || speed < 0.6 || c.dashTicks > 0) {
        this.stride.set(c.id, Math.min(this.stride.get(c.id) ?? 0, 0.3));
        continue;
      }
      // Short raccoon legs: stride grows a little with speed.
      const strideLen = 0.42 + 0.06 * speed;
      const d = (this.stride.get(c.id) ?? 0) + speed * dt;
      if (d >= strideLen) {
        this.stride.set(c.id, d - strideLen);
        const own = c.id === listenerId;
        this.engine.play('footstep', {
          pos: c.pos,
          volume: (own ? 0.55 : 0.7) * (0.6 + 0.4 * clamp01(speed / 5)),
          pitch: 1 + ((c.slot % 4) - 1.5) * 0.04,
        });
      } else {
        this.stride.set(c.id, d);
      }
    }
  }

  private driveMusic(st: SimState, dt: number, bankMoving: boolean, recovering: boolean): void {
    const diff = Math.abs(st.scores[0] - st.scores[1]);
    const close = 1 - clamp01(diff / 1000);
    const secondsLeft = Number.isFinite(st.endTick) ? (st.endTick - st.tick) / TICK_RATE : Infinity;
    let target = 0.42;
    if (bankMoving) target += 0.2;
    if (recovering) target += 0.15;
    if (st.scores[0] + st.scores[1] > 0) target += 0.15 * close;
    if (secondsLeft < 60) target += 0.15;
    target = Math.max(0.3, Math.min(1, target));
    // Slow exponential smoothing (~3 s) so layers don't flicker with every event.
    const k = 1 - Math.exp(-dt / 3);
    const next = this.intensity + (target - this.intensity) * k;
    if (Math.abs(next - this.intensity) > 0.002 || dt === 0) this.engine.setMusicIntensity(next);
    this.intensity = next;
  }
}
