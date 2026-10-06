/**
 * AudioEngine — procedural WebAudio sound for 뿌리째 털어라 (docs/ARCHITECTURE.md "Audio API").
 *
 * No audio files: every effect, loop and music track is synthesized at runtime.
 *
 *   const audio = getAudioEngine();
 *   window.addEventListener('pointerdown', () => audio.unlock(), { once: true });
 *   audio.setVolumes(settings.volumes);
 *   audio.playMusic('title');
 *   audio.setListener(player.pos);
 *   audio.play('grab', { pos: char.pos });
 *   audio.setLoop('drag', speed / 4, safe.pos, safe.id);      // every frame; 0 = silent
 *
 * Safe everywhere: before unlock(), without WebAudio (Node, tests, old browsers) or after
 * dispose() every call is a cheap no-op. Requested music and volumes are remembered and applied
 * on unlock. Captions are reported even without audio (deaf / muted players).
 */
import type { Vec2 } from '../sim/types';
import { LOOP_CAPTION_KEYS, SFX_CAPTION_KEYS } from './captions';
import type { LoopId, MusicId, SfxId } from './ids';
import { createMixer, DEFAULT_VOLUMES, type Mixer, type Volumes } from './mixer';
import { makeRng, type Rng } from './rng';
import { MusicPlayer } from './sequencer';
import { SFX_RECIPES, VariantPicker } from './sfx';
import { captionSide, spatialMix, type SpatialMix } from './spatial';
import { SFX_KEY_ROOT } from './theory';
import { disconnectAll, spawnLoop, spawnSfx, updateLoopSpatial, type SpawnedLoop, type SpawnedVoice } from './voice';

export type { LoopId, MusicId, SfxId } from './ids';
export { LOOP_IDS, MUSIC_IDS, SFX_IDS, UI_SOUND_SFX } from './ids';
export { CAPTION_FALLBACK, LOOP_CAPTION_KEYS, SFX_CAPTION_KEYS, captionText } from './captions';
export type { Volumes } from './mixer';

export interface PlayOptions {
  /** World position (sim meters). Omit for a centered, non-attenuated sound. */
  pos?: Vec2 | null;
  /** Linear multiplier 0..1+ (default 1). */
  volume?: number;
  /** Frequency multiplier (default 1). */
  pitch?: number;
  /** (addition) Force a variation index instead of a random one. */
  variant?: number;
  /** (addition) Pentatonic steps up for tonal sounds (combo climb on consecutive recoveries). */
  step?: number;
  /** (addition) Start delay in seconds. */
  delay?: number;
  /** (addition) Identify this voice so stop(id, tag) can cut it (e.g. a riser per loot id). */
  tag?: string | number;
}

export interface CaptionEvent {
  /** i18n key, e.g. 'caption.siren'. */
  key: string;
  source: SfxId | LoopId;
  /** Direction relative to the listener (null = center / global). */
  side: 'left' | 'right' | null;
  distance: number;
}
export type CaptionListener = (e: CaptionEvent) => void;

export interface AudioEngineOptions {
  /** Context factory (tests inject a mock). Default: window.AudioContext / webkitAudioContext. */
  createContext?: () => AudioContext | null;
  /** Run the scheduling timer automatically (default true). Tests call pump() manually. */
  autoPump?: boolean;
  /** Seed for variation randomness (default random). */
  seed?: number;
}

/** Global voice budget: low-priority sounds are dropped / stolen beyond this. */
const MAX_VOICES = 48;
/** Seconds of music scheduled ahead (visible / hidden tab). */
const LOOKAHEAD = 0.25;
const LOOKAHEAD_HIDDEN = 1.6;
const PUMP_MS = 40;
/** Loops silent for this long are destroyed. */
const LOOP_IDLE_SECONDS = 1.5;
/** Minimum ms between two captions with the same key. */
const CAPTION_REPEAT_MS = 450;
const LOOP_CAPTION_REFRESH_MS = 2200;

interface LoopState {
  spawned: SpawnedLoop | null;
  intensity: number;
  silentSince: number;
  captionAt: number;
}

interface ActiveVoice extends SpawnedVoice {
  tag?: string | number;
}

type AudioContextCtor = new (opts?: AudioContextOptions) => AudioContext;

function defaultContextFactory(): AudioContext | null {
  const g = globalThis as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor({ latencyHint: 'interactive' });
  } catch {
    return null;
  }
}

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);
const wallMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private mixer: Mixer | null = null;
  private music: MusicPlayer | null = null;
  private unlocking: Promise<void> | null = null;
  private disposed = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  private volumes: Volumes = { ...DEFAULT_VOLUMES };
  private listener: Vec2 = { x: 0, y: 0 };
  private wantedMusic: MusicId = 'none';
  private musicIntensity = 0.5;
  private muffled = false;

  private readonly voices: ActiveVoice[] = [];
  private readonly loops = new Map<string, LoopState>();
  private readonly lastPlay = new Map<SfxId, number>();
  private readonly lastCaption = new Map<string, number>();
  private readonly picker = new VariantPicker();
  private readonly rnd: Rng;
  private readonly opts: AudioEngineOptions;
  private captionFn: CaptionListener | null = null;

  constructor(opts: AudioEngineOptions = {}) {
    this.opts = opts;
    this.rnd = makeRng(opts.seed ?? Math.floor(Math.random() * 0xffffffff));
  }

  // -------------------------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------------------------

  /** True once an AudioContext exists and is running. */
  get unlocked(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** The live AudioContext (null before unlock / without WebAudio). */
  get context(): AudioContext | null {
    return this.ctx;
  }

  /**
   * Create / resume the AudioContext. Call from a user gesture (click, key, touch). Safe to call
   * repeatedly; resolves once the context is running (or immediately when WebAudio is missing).
   */
  unlock(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.ctx) {
      if (this.ctx.state === 'running') return Promise.resolve();
      return this.ctx.resume().catch(() => undefined);
    }
    if (this.unlocking) return this.unlocking;
    // The context is created synchronously inside the gesture handler (autoplay policy).
    const ctx = (this.opts.createContext ?? defaultContextFactory)();
    if (!ctx) return Promise.resolve();
    this.ctx = ctx;
    try {
      this.mixer = createMixer(ctx);
      this.mixer.setVolumes(this.volumes, false);
      if (this.muffled) this.mixer.setMuffle(true);
      this.music = new MusicPlayer({ ctx, input: this.mixer.inputs.music, reverb: this.mixer.musicReverb }, this.rnd() * 0xffffffff);
      this.music.setIntensity(this.musicIntensity, ctx.currentTime);
    } catch (err) {
      console.error('[audio] failed to build the audio graph', err);
      this.ctx = null;
      this.mixer = null;
      this.music = null;
      try {
        void ctx.close();
      } catch {
        /* ignore */
      }
      return Promise.resolve();
    }
    if (this.opts.autoPump !== false) this.timer = setInterval(() => this.pump(), PUMP_MS);
    this.unlocking = ctx
      .resume()
      .catch(() => undefined)
      .then(() => {
        this.unlocking = null;
        if (this.wantedMusic !== 'none') this.music?.play(this.wantedMusic, ctx.currentTime);
        this.pump();
      });
    return this.unlocking;
  }

  /** Pause all audio processing (e.g. app minimized). */
  suspend(): Promise<void> {
    return this.ctx && this.ctx.state === 'running' ? this.ctx.suspend().catch(() => undefined) : Promise.resolve();
  }

  /** Resume after suspend(). */
  resume(): Promise<void> {
    return this.ctx && this.ctx.state !== 'closed' ? this.ctx.resume().catch(() => undefined) : Promise.resolve();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    const ctx = this.ctx;
    this.ctx = null;
    this.mixer = null;
    this.music = null;
    this.voices.length = 0;
    this.loops.clear();
    if (ctx) void ctx.close().catch(() => undefined);
  }

  /**
   * Scheduler tick: music lookahead + cleanup of finished voices and idle loops. Runs on an
   * internal timer; exposed for tests and for hosts that prefer to drive it from their frame loop.
   */
  pump(): void {
    const ctx = this.ctx;
    if (!ctx || !this.music) return;
    const now = ctx.currentTime;
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    this.music.schedule(now + (hidden ? LOOKAHEAD_HIDDEN : LOOKAHEAD), now);
    for (let i = this.voices.length - 1; i >= 0; i--) {
      if (this.voices[i].end < now) {
        disconnectAll(this.voices[i].nodes);
        this.voices.splice(i, 1);
      }
    }
    for (const [key, l] of this.loops) {
      if (l.spawned && l.intensity <= 0 && now - l.silentSince > LOOP_IDLE_SECONDS) {
        l.spawned.voice.stop(now + 0.05);
        disconnectAll(l.spawned.nodes);
        l.spawned = null;
      }
      if (!l.spawned && l.intensity <= 0) this.loops.delete(key);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Mix
  // -------------------------------------------------------------------------------------------

  /** Settings sliders, each 0..1 (square-law mapped to gain). */
  setVolumes(v: { master: number; music: number; sfx: number; ui: number }): void {
    this.volumes = { master: clamp01(v.master), music: clamp01(v.music), sfx: clamp01(v.sfx), ui: clamp01(v.ui) };
    this.mixer?.setVolumes(this.volumes, true);
  }

  getVolumes(): Volumes {
    return { ...this.volumes };
  }

  /** Listener position in sim meters (usually the local player's raccoon). */
  setListener(p: Vec2): void {
    if (Number.isFinite(p.x) && Number.isFinite(p.y)) this.listener = { x: p.x, y: p.y };
  }

  /** Pause-menu muffle (lowpass + slight duck of music and sfx; UI stays clear). */
  setMuffled(on: boolean): void {
    this.muffled = on;
    this.mixer?.setMuffle(on);
  }

  /** Receive caption events (works without audio). Pass null to stop. */
  setCaptionListener(fn: CaptionListener | null): void {
    this.captionFn = fn;
  }

  // -------------------------------------------------------------------------------------------
  // One-shots
  // -------------------------------------------------------------------------------------------

  play(id: SfxId, o: PlayOptions = {}): void {
    if (this.disposed) return;
    const r = SFX_RECIPES[id];
    if (!r) return;
    const mix = r.global ? spatialMix(this.listener, null) : spatialMix(this.listener, o.pos);
    const volume = Math.max(0, Number.isFinite(o.volume) ? (o.volume as number) : 1);
    if (mix.gain * volume < 0.003) return; // inaudible: no sound, no caption
    const capKey = SFX_CAPTION_KEYS[id];
    if (capKey && mix.gain * Math.min(1, volume) > 0.08) this.caption(capKey, id, mix);

    const ctx = this.ctx;
    const mixer = this.mixer;
    if (!ctx || !mixer || ctx.state === 'closed') return;
    const now = ctx.currentTime;
    const t = now + 0.005 + Math.max(0, Number.isFinite(o.delay) ? (o.delay as number) : 0);

    const last = this.lastPlay.get(id) ?? -Infinity;
    if (t - last < r.minInterval) return;

    // Per-id polyphony: fade the oldest instance.
    let same = 0;
    let oldest: ActiveVoice | null = null;
    let active = 0;
    for (const v of this.voices) {
      if (v.end <= now) continue;
      active++;
      if (v.id === id) {
        same++;
        if (!oldest || v.start < oldest.start) oldest = v;
      }
    }
    if (same >= r.maxVoices && oldest) this.fadeVoice(oldest, now);
    // Global budget: steal the least important voice, or drop this one.
    if (active >= MAX_VOICES) {
      let victim: ActiveVoice | null = null;
      for (const v of this.voices) {
        if (v.end <= now || v.priority >= r.priority) continue;
        if (!victim || v.priority < victim.priority || (v.priority === victim.priority && v.start < victim.start)) victim = v;
      }
      if (!victim) return;
      this.fadeVoice(victim, now);
    }
    this.lastPlay.set(id, t);

    try {
      const pitch = Number.isFinite(o.pitch) && (o.pitch as number) > 0 ? (o.pitch as number) : 1;
      const variant = o.variant !== undefined ? Math.abs(Math.floor(o.variant)) % r.variants : this.picker.next(id, this.rnd);
      const voice = spawnSfx(ctx, mixer, id, {
        t,
        mix,
        volume,
        pitch,
        variant,
        step: Math.floor(o.step ?? 0),
        key: this.music?.keyRoot ?? SFX_KEY_ROOT,
        rnd: this.rnd,
      });
      this.voices.push({ ...voice, tag: o.tag });
    } catch (err) {
      console.error(`[audio] sfx ${id} failed`, err);
    }
  }

  /** Quickly fade out playing instances of `id` (optionally only those with `tag`). */
  stop(id: SfxId, tag?: string | number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const v of this.voices) {
      if (v.id === id && v.end > now && (tag === undefined || v.tag === tag)) this.fadeVoice(v, now);
    }
  }

  private fadeVoice(v: ActiveVoice, now: number): void {
    const g = v.out.gain;
    try {
      if (typeof g.cancelAndHoldAtTime === 'function') g.cancelAndHoldAtTime(now);
      else {
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
      }
      g.linearRampToValueAtTime(0, now + 0.04);
    } catch {
      /* node already gone */
    }
    v.end = Math.min(v.end, now + 0.06);
    v.priority = -1;
  }

  // -------------------------------------------------------------------------------------------
  // Loops
  // -------------------------------------------------------------------------------------------

  /**
   * Continuous sound with intensity 0..1 (0 = silent). Call every frame while it applies; the
   * optional `key` (addition) runs several instances of the same loop, e.g. one per dragged safe.
   */
  setLoop(id: LoopId, intensity: number, pos?: Vec2, key: string | number = 0): void {
    if (this.disposed) return;
    const k = `${id}:${key}`;
    const i = clamp01(intensity);
    let l = this.loops.get(k);
    if (!l) {
      if (i <= 0) return;
      l = { spawned: null, intensity: 0, silentSince: -Infinity, captionAt: -Infinity };
      this.loops.set(k, l);
    }
    const mix = spatialMix(this.listener, pos);
    const capKey = LOOP_CAPTION_KEYS[id];
    if (capKey && i > 0.05 && mix.gain > 0.08) {
      const ms = wallMs();
      if (ms - l.captionAt > LOOP_CAPTION_REFRESH_MS) {
        l.captionAt = ms;
        this.caption(capKey, id, mix, true);
      }
    } else if (i <= 0) {
      l.captionAt = -Infinity;
    }

    const ctx = this.ctx;
    const mixer = this.mixer;
    const prev = l.intensity;
    l.intensity = i;
    if (!ctx || !mixer || ctx.state === 'closed') return;
    const now = ctx.currentTime;
    if (i > 0) l.silentSince = Infinity;
    else if (prev > 0) l.silentSince = now;
    if (!l.spawned) {
      if (i <= 0) return;
      try {
        l.spawned = spawnLoop(ctx, mixer, id, now, this.rnd, mix);
        l.spawned.voice.set(i, now);
      } catch (err) {
        console.error(`[audio] loop ${id} failed`, err);
      }
      return;
    }
    if (Math.abs(i - prev) > 0.004 || (i === 0 && prev !== 0)) l.spawned.voice.set(i, now);
    updateLoopSpatial(ctx, l.spawned, mix, now);
  }

  /** Silence every loop (match end, pause, scene change). */
  stopAllLoops(): void {
    for (const [k, l] of this.loops) {
      if (l.intensity > 0) {
        const sep = k.indexOf(':');
        this.setLoop(k.slice(0, sep) as LoopId, 0, undefined, k.slice(sep + 1));
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Music
  // -------------------------------------------------------------------------------------------

  /** Crossfade to a track ('none' fades out). Remembered until unlock. */
  playMusic(id: MusicId): void {
    if (this.disposed) return;
    this.wantedMusic = id;
    const ctx = this.ctx;
    if (!ctx || !this.music || this.unlocking) return;
    this.music.play(id, ctx.currentTime);
    this.pump();
  }

  /** 0..1: 'match' adds drums, lead, then extra percussion/brass layers as it rises. */
  setMusicIntensity(x: number): void {
    this.musicIntensity = clamp01(x);
    if (this.ctx && this.music) this.music.setIntensity(this.musicIntensity, this.ctx.currentTime);
  }

  get currentMusic(): MusicId {
    return this.music?.currentId ?? 'none';
  }

  /** Tonic (MIDI) that tonal SFX are tuned to. */
  get musicKey(): number {
    return this.music?.keyRoot ?? SFX_KEY_ROOT;
  }

  /** Debug snapshot (gallery / tests). */
  stats(): { voices: number; loops: number; music: MusicId; state: string } {
    const now = this.ctx?.currentTime ?? 0;
    return {
      voices: this.voices.filter((v) => v.end > now).length,
      loops: [...this.loops.values()].filter((l) => l.spawned).length,
      music: this.currentMusic,
      state: this.ctx?.state ?? 'none',
    };
  }

  /** Last node of the master chain (for analysers / meters in dev tools). */
  get outputNode(): AudioNode | null {
    return this.mixer?.output ?? null;
  }

  private caption(key: string, source: SfxId | LoopId, mix: SpatialMix, force = false): void {
    if (!this.captionFn) return;
    const ms = wallMs();
    const side = captionSide(mix);
    const ck = `${key}|${side ?? ''}`;
    if (!force && ms - (this.lastCaption.get(ck) ?? -Infinity) < CAPTION_REPEAT_MS) return;
    this.lastCaption.set(ck, ms);
    try {
      this.captionFn({ key, source, side, distance: mix.distance });
    } catch (err) {
      console.error('[audio] caption listener failed', err);
    }
  }
}

let shared: AudioEngine | null = null;

/** The game-wide engine (created lazily; constructing it touches no browser APIs). */
export function getAudioEngine(): AudioEngine {
  if (!shared) shared = new AudioEngine();
  return shared;
}

/**
 * Unlock audio on the first user gesture (pointer, key or touch) on `target` (default window).
 * Returns a function that removes the listeners.
 */
export function unlockOnFirstGesture(engine: AudioEngine, target?: EventTarget): () => void {
  const t = target ?? (typeof window !== 'undefined' ? window : null);
  if (!t) return () => undefined;
  const events = ['pointerdown', 'keydown', 'touchend', 'mousedown'];
  const handler = (): void => {
    void engine.unlock().then(() => {
      if (engine.unlocked) remove();
    });
  };
  const remove = (): void => {
    for (const e of events) t.removeEventListener(e, handler, true);
  };
  for (const e of events) t.addEventListener(e, handler, true);
  return remove;
}
