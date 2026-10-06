/**
 * Lookahead music sequencer.
 *
 * Songs (./songs.ts) compose one bar of note events at a time; a TrackPlayer converts steps to
 * context time (with swing), queues the events and creates the synth nodes only shortly before
 * they sound (`schedule(until)`, called from the engine's timer every ~40 ms with a ~250 ms
 * window). Offline renders call the same `schedule` in slices, so a QA render is exactly what the
 * game plays.
 *
 * Each track has four layer gains (base / drums / lead / extra) driven by the music intensity,
 * a fade gain for crossfades, and per-instrument buses with pan and a reverb send.
 */
import type { MusicId, TrackId } from './ids';
import { INSTRUMENTS, type InstId } from './instruments';
import type { BarGrid } from './loops';
import { makeRng, type Rng } from './rng';
import { LAYERS, SONGS, barSeconds, type LayerId, type NoteEvent, type SongDef } from './songs';
import { SFX_KEY_ROOT } from './theory';

export interface MusicHost {
  ctx: BaseAudioContext;
  /** Track output destination (mixer music input, ducked). */
  input: AudioNode;
  /** Reverb send destination. */
  reverb: AudioNode;
}

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Layer levels for a dynamic track at music intensity x (0..1). */
export function layerLevels(x: number): Record<LayerId, number> {
  const i = Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0;
  return {
    base: 1,
    drums: smoothstep(0.1, 0.3, i),
    lead: smoothstep(0.35, 0.5, i),
    extra: smoothstep(0.65, 0.85, i),
  };
}

/** Map a 16th-step position to swung position (in steps). */
export function swingStep(step: number, swing: number, unit: 8 | 16): number {
  if (swing <= 0) return step;
  const seg = unit === 8 ? 4 : 2;
  const half = seg / 2;
  const base = Math.floor(step / seg) * seg;
  const p = step - base;
  const mid = half * (1 + swing);
  return base + (p <= half ? p * (mid / half) : mid + ((p - half) * (seg - mid)) / half);
}

/** Freeze a param at its automated value at time t, dropping later events. */
export function holdAt(p: AudioParam, t: number): void {
  if (typeof p.cancelAndHoldAtTime === 'function') {
    p.cancelAndHoldAtTime(t);
  } else {
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
  }
}

interface Queued {
  time: number;
  ev: NoteEvent;
}

interface InstBus {
  dry: GainNode;
}

export class TrackPlayer {
  readonly def: SongDef;
  readonly startTime: number;
  private readonly ctx: BaseAudioContext;
  private readonly out: GainNode;
  private readonly send: GainNode;
  private readonly layers = new Map<LayerId, { dry: GainNode; wet: GainNode }>();
  private readonly buses = new Map<string, InstBus>();
  private readonly rnd: Rng;
  private queue: Queued[] = [];
  private bar = 0;
  private barStart: number;
  private intensity: number;
  /** No events start at or after this time (set by fadeOut). */
  stopAt = Infinity;
  disposed = false;

  /** Optional event filter (QA solo renders). */
  private readonly filter: ((ev: NoteEvent) => boolean) | null;

  constructor(
    host: MusicHost,
    def: SongDef,
    startTime: number,
    seed: number,
    intensity: number,
    fadeIn: number,
    filter: ((ev: NoteEvent) => boolean) | null = null,
  ) {
    this.filter = filter;
    this.ctx = host.ctx;
    this.def = def;
    this.startTime = startTime;
    this.barStart = startTime;
    this.rnd = makeRng(seed);
    this.intensity = intensity;
    this.out = this.ctx.createGain();
    this.send = this.ctx.createGain();
    for (const g of [this.out, this.send]) {
      g.gain.value = 0;
      g.gain.setValueAtTime(0, startTime);
      if (fadeIn > 0) g.gain.linearRampToValueAtTime(def.gain, startTime + fadeIn);
      else g.gain.setValueAtTime(def.gain, startTime);
    }
    this.out.connect(host.input);
    this.send.connect(host.reverb);
    const lv = def.dynamic ? layerLevels(intensity) : null;
    for (const id of LAYERS) {
      const dry = this.ctx.createGain();
      const wet = this.ctx.createGain();
      const v = lv ? lv[id] : 1;
      dry.gain.value = v;
      wet.gain.value = v;
      dry.connect(this.out);
      wet.connect(this.send);
      this.layers.set(id, { dry, wet });
    }
  }

  get id(): TrackId {
    return this.def.id;
  }

  setIntensity(x: number, at: number): void {
    this.intensity = x;
    if (!this.def.dynamic) return;
    const lv = layerLevels(x);
    for (const id of LAYERS) {
      const l = this.layers.get(id)!;
      // ~1 s time constant: layers swell in musically rather than snapping.
      l.dry.gain.setTargetAtTime(lv[id], at, 0.9);
      l.wet.gain.setTargetAtTime(lv[id], at, 0.9);
    }
  }

  /** Time of the next beat at or after t (for musically aligned transitions). */
  nextBeat(t: number): number {
    const beat = 60 / this.def.bpm;
    const n = Math.ceil((t - this.startTime) / beat - 1e-6);
    return this.startTime + Math.max(0, n) * beat;
  }

  fadeOut(at: number, dur: number): void {
    const end = at + Math.max(0.01, dur);
    for (const g of [this.out, this.send]) {
      holdAt(g.gain, at);
      g.gain.linearRampToValueAtTime(0, end);
    }
    this.stopAt = Math.min(this.stopAt, end);
  }

  /** Compose bars and create nodes for every event that starts before `until`. */
  schedule(until: number, now: number): void {
    if (this.disposed) return;
    const barDur = barSeconds(this.def);
    // Timer starvation (hidden tab): skip whole bars instead of bursting late notes.
    if (this.barStart < now - barDur) {
      const skip = Math.floor((now - this.barStart) / barDur);
      this.bar += skip;
      this.barStart += skip * barDur;
      this.queue = this.queue.filter((q) => q.time >= now - 0.05);
    }
    // Compose a quarter bar early so grace notes before the downbeat are never late.
    let composed = false;
    while (this.barStart - barDur * 0.25 < until && this.barStart < this.stopAt) {
      const stepDur = barDur / 16;
      const evs = this.def.compose({ bar: this.bar, intensity: this.intensity, rnd: this.rnd });
      for (const ev of evs) {
        if (this.filter && !this.filter(ev)) continue;
        const time = this.barStart + swingStep(ev.step, this.def.swing, this.def.swingUnit) * stepDur;
        this.queue.push({ time, ev });
      }
      this.bar++;
      this.barStart += barDur;
      composed = true;
    }
    if (composed) this.queue.sort((a, b) => a.time - b.time);
    let n = 0;
    while (n < this.queue.length && this.queue[n].time < until) {
      const q = this.queue[n++];
      if (q.time >= this.stopAt || q.time < now - 0.05) continue;
      this.playEvent(q);
    }
    if (n) this.queue.splice(0, n);
  }

  private bus(inst: InstId, layer: LayerId): InstBus {
    const key = `${inst}|${layer}`;
    let b = this.buses.get(key);
    if (b) return b;
    const mix = this.def.mix[inst] ?? {};
    const dry = this.ctx.createGain();
    dry.gain.value = mix.gain ?? 1;
    const l = this.layers.get(layer)!;
    if (mix.pan && typeof this.ctx.createStereoPanner === 'function') {
      const p = this.ctx.createStereoPanner();
      p.pan.value = mix.pan;
      dry.connect(p);
      p.connect(l.dry);
    } else {
      dry.connect(l.dry);
    }
    const sendAmt = mix.reverb ?? this.def.reverb;
    if (sendAmt > 0) {
      const s = this.ctx.createGain();
      s.gain.value = sendAmt;
      dry.connect(s);
      s.connect(l.wet);
    }
    b = { dry };
    this.buses.set(key, b);
    return b;
  }

  private playEvent(q: Queued): void {
    const { ev } = q;
    const fn = INSTRUMENTS[ev.inst];
    const stepDur = barSeconds(this.def) / 16;
    // Light humanization: velocity +-8 %, melodic timing +-4 ms (drums stay tight).
    const vel = ev.vel * (0.92 + this.rnd() * 0.16);
    const loose = ev.layer === 'lead' || ev.inst === 'marimba' ? (this.rnd() * 2 - 1) * 0.004 : 0;
    const t = Math.max(this.ctx.currentTime, q.time + loose);
    fn({ ctx: this.ctx, out: this.bus(ev.inst, ev.layer).dry, t, rnd: this.rnd }, 0, ev.midi, ev.dur * stepDur, vel);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.queue = [];
    try {
      this.out.disconnect();
      this.send.disconnect();
    } catch {
      /* already disconnected */
    }
  }
}

/** Crossfade times (s) for transitions; key = `${from}>${to}` or `*>${to}`. */
const FADES: Record<string, { out: number; in: number }> = {
  'match>final': { out: 0.6, in: 0.25 },
  '*>none': { out: 1.6, in: 0 },
  '*>title': { out: 1.2, in: 1.5 },
  '*>results': { out: 0.8, in: 1.2 },
  '*>match': { out: 1.0, in: 0.8 },
  '*>final': { out: 0.6, in: 0.3 },
};

export class MusicPlayer {
  private readonly host: MusicHost;
  private readonly tracks: TrackPlayer[] = [];
  private current: TrackPlayer | null = null;
  private intensity = 0.5;
  private seed: number;
  /** QA only: keep just the events this predicate accepts (solo / mute instruments). */
  eventFilter: ((ev: NoteEvent) => boolean) | null = null;

  constructor(host: MusicHost, seed = 1) {
    this.host = host;
    this.seed = seed >>> 0;
  }

  get currentId(): MusicId {
    return this.current ? this.current.id : 'none';
  }

  /** Bar grid of the current track (time of its bar 0, bar length), or null when silent. */
  barGrid(): BarGrid | null {
    const tr = this.current;
    return tr ? { origin: tr.startTime, bar: barSeconds(tr.def) } : null;
  }

  /** Tonic for tonal SFX (all tracks share F major / D minor). */
  get keyRoot(): number {
    return this.current?.def.sfxKey ?? SFX_KEY_ROOT;
  }

  play(id: MusicId, at: number): void {
    const from = this.currentId;
    if (id === from) return;
    const fade = FADES[`${from}>${id}`] ?? FADES[`*>${id}`] ?? { out: 1, in: 0.8 };
    let start = at + 0.03;
    if (this.current) {
      // Land the new track on a beat of the old one so the handover feels intentional.
      if (id !== 'none') start = Math.min(this.current.nextBeat(at + 0.03), at + 0.5);
      this.current.fadeOut(at, fade.out);
    }
    this.current = null;
    if (id === 'none') return;
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    const tr = new TrackPlayer(this.host, SONGS[id], start, this.seed, this.intensity, fade.in, this.eventFilter);
    this.tracks.push(tr);
    this.current = tr;
  }

  setIntensity(x: number, at: number): void {
    const v = Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0;
    if (Math.abs(v - this.intensity) < 0.005) return;
    this.intensity = v;
    this.current?.setIntensity(v, at);
  }

  getIntensity(): number {
    return this.intensity;
  }

  schedule(until: number, now: number): void {
    for (let i = this.tracks.length - 1; i >= 0; i--) {
      const tr = this.tracks[i];
      tr.schedule(until, now);
      // Disconnect faded tracks once their last notes and reverb tails are done.
      if (tr !== this.current && now > tr.stopAt + 4) {
        tr.dispose();
        this.tracks.splice(i, 1);
      }
    }
  }

  stopAll(at: number): void {
    for (const tr of this.tracks) tr.fadeOut(at, 0.3);
    this.current = null;
  }
}
