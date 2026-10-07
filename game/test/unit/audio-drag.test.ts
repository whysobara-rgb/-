/**
 * The soft haul loops (owner feedback: dragging an uprooted object sounded too rough): the drag and
 * bank rumble voices are built from band-limited textures (./src/audio/dsp.ts rollBuffer /
 * heaveBuffer / groanBuffer) and must stay hiss-free, click-free and seamless, yet audible on
 * small laptop speakers (the bumps' fundamental never sinks below ~265 Hz at a real carry speed,
 * and slow / heavy hauls get a presence lift). Node has no OfflineAudioContext, so the drag voice
 * is also rendered here in plain JS (texture at its playback rate through the same RBJ presence
 * peak + brown thrum through the same RBJ lowpasses) to bound its spectrum and level.
 */
import { describe, expect, it } from 'vitest';
import { MatchAudioDirector, type AudioEngine, type AudioSimView } from '../../src/audio';
import { MockBufferSource, MockFilter, mockContext } from '../../src/audio/dev/mockAudioContext';
import { DRAG_PITCH } from '../../src/audio/director';
import { GROAN_NOTES_HZ, ROLL_BUMP_HZ, groanBuffer, heaveBuffer, noiseBuffer, rollBuffer } from '../../src/audio/dsp';
import type { LoopId } from '../../src/audio/ids';
import { LOOP_GAIN, bankParams, createLoop, dragParams } from '../../src/audio/loops';
import { makeRng } from '../../src/audio/rng';
import type { CharacterState, LootState, SimState, Vec2 } from '../../src/sim/types';

const SR = 48000;

const twCache = new Map<number, { re: Float64Array; im: Float64Array }>();
function twiddles(n: number): { re: Float64Array; im: Float64Array } {
  let t = twCache.get(n);
  if (!t) {
    t = { re: new Float64Array(n / 2), im: new Float64Array(n / 2) };
    for (let k = 0; k < n / 2; k++) {
      t.re[k] = Math.cos((-2 * Math.PI * k) / n);
      t.im[k] = Math.sin((-2 * Math.PI * k) / n);
    }
    twCache.set(n, t);
  }
  return t;
}

/** In-place radix-2 FFT (re, im of length 2^k). */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  const tw = twiddles(n);
  for (let len = 2; len <= n; len <<= 1) {
    const step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = tw.re[k * step];
        const wi = tw.im[k * step];
        const xr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const xi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k + len / 2] = re[i + k] - xr;
        im[i + k + len / 2] = im[i + k] - xi;
        re[i + k] += xr;
        im[i + k] += xi;
      }
    }
  }
}

/** Energy above `hz` relative to the total (dB), up to 24 Hann-windowed 4096-point frames. */
function energyAboveDb(x: Float32Array, hz: number): number {
  return energyBandDb(x, hz, SR / 2);
}

/** Energy in [lo, hi) Hz relative to the total (dB), up to 24 Hann-windowed 4096-point frames. */
function energyBandDb(x: Float32Array, lo: number, hiHz: number): number {
  const N = 4096;
  let hi = 0;
  let all = 0;
  const hop = Math.max(N, Math.floor((x.length - N) / 24));
  for (let s = 0; s + N <= x.length; s += hop) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      all += p;
      const f = (k * SR) / N;
      if (f >= lo && f < hiHz) hi += p;
    }
  }
  return 10 * Math.log10(hi / all);
}

/** RBJ lowpass biquad with a per-sample-constant cutoff (what BiquadFilterNode 'lowpass' does). */
function lowpass(x: Float32Array, f: number, q: number): Float32Array {
  const w = (2 * Math.PI * f) / SR;
  const al = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  const a0 = 1 + al;
  const b0 = (1 - c) / 2 / a0;
  const b1 = (1 - c) / a0;
  const a1 = (-2 * c) / a0;
  const a2 = (1 - al) / a0;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/** RBJ peaking biquad (what BiquadFilterNode 'peaking' does), constant settings. */
function peaking(x: Float32Array, f: number, q: number, gainDb: number): Float32Array {
  const A = Math.pow(10, gainDb / 40);
  const w = (2 * Math.PI * f) / SR;
  const al = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  const a0 = 1 + al / A;
  const b0 = (1 + al * A) / a0;
  const b1 = (-2 * c) / a0;
  const b2 = (1 - al * A) / a0;
  const a2 = (1 - al / A) / a0;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - b1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/**
 * Long-term spectrum "pitch line" prominence of x in [lo, hi] Hz: the highest level (dB) of an
 * 8192-point averaged spectrum over the median of its flanks half an octave either side (a fixed
 * pitch repeated over a long haul stands out as a line: the "bloop" risk).
 */
function lineProminenceDb(x: Float32Array, lo: number, hi: number): number {
  const N = 8192;
  const P = new Float64Array(N / 2);
  for (let s = 0; s + N <= x.length; s += N / 2) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
    fft(re, im);
    for (let k = 0; k < N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k];
  }
  const L = Array.from(P, (p) => 10 * Math.log10(p + 1e-30));
  const df = SR / N;
  const median = (a: number, b: number): number => {
    const v = L.slice(Math.ceil(a / df), Math.floor(b / df) + 1).sort((u, w) => u - w);
    return v[v.length >> 1];
  };
  let best = -Infinity;
  for (let k = Math.ceil(lo / df); k <= hi / df; k++) {
    const f = k * df;
    best = Math.max(best, L[k] - 0.5 * (median(f / Math.SQRT2, f / 2 ** 0.25) + median(f * 2 ** 0.25, f * Math.SQRT2)));
  }
  return best;
}

/** A looped buffer read at `rate` with linear interpolation (AudioBufferSourceNode loop). */
function playLooped(d: Float32Array, rate: number, n: number): Float32Array {
  const y = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const j = Math.floor(ph);
    y[i] = d[j % d.length] + (d[(j + 1) % d.length] - d[j % d.length]) * (ph - j);
    ph = (ph + rate) % d.length;
  }
  return y;
}

/** The drag voice's steady-state output at intensity i / pitch p (before the spatial chain). */
function renderDrag(i: number, p: number, seconds: number): Float32Array {
  const ctx = mockContext();
  const d = dragParams(i, p);
  const n = Math.floor(SR * seconds);
  const roll = peaking(playLooped(rollBuffer(ctx).getChannelData(0), d.rate, n), d.presHz, 0.55, d.presDb);
  // Two reads of the brown loop (rate 1 and 0.77, as in createLoop), summed into the thrum filter.
  const brown = noiseBuffer(ctx, 'brown').getChannelData(0);
  const b1 = playLooped(brown, 1, n);
  const b2 = playLooped(brown.subarray(Math.floor(brown.length / 3)), 0.77, n);
  for (let k = 0; k < n; k++) b1[k] += b2[k];
  const thrum = lowpass(b1, d.thrumHz, 1.5);
  const mix = new Float32Array(n);
  for (let k = 0; k < n; k++) mix[k] = roll[k] * d.bumps + thrum[k] * d.thrum;
  const out = lowpass(mix, d.toneHz, 0.5);
  for (let k = 0; k < n; k++) out[k] *= LOOP_GAIN.drag;
  return out.subarray(SR * 0.2); // skip the filters' settling
}

const rms = (x: Float32Array): number => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);

describe('soft haul textures', () => {
  it('roll and heave textures are finite, bounded, DC-free, seamless and click-free', () => {
    const ctx = mockContext();
    for (const make of [rollBuffer, heaveBuffer, groanBuffer]) {
      const d = make(ctx).getChannelData(0);
      let peak = 0;
      let sum = 0;
      let maxStep = 0;
      let bad = 0;
      for (let i = 0; i < d.length; i++) {
        if (!Number.isFinite(d[i])) bad++;
        peak = Math.max(peak, Math.abs(d[i]));
        sum += d[i];
        if (i > 0) maxStep = Math.max(maxStep, Math.abs(d[i] - d[i - 1]));
      }
      expect(bad).toBe(0);
      // Normalized to a peak, never clamped.
      expect(peak).toBeLessThanOrEqual(0.9 + 1e-6);
      expect(peak).toBeGreaterThan(0.85);
      expect(Math.abs(sum / d.length)).toBeLessThan(1e-3);
      // Band-limited: no sample-to-sample jump anywhere (a click or a cut-off bump would be one).
      expect(maxStep).toBeLessThan(0.1);
      // The loop wrap is no bigger than a typical step.
      expect(Math.abs(d[0] - d[d.length - 1])).toBeLessThanOrEqual(maxStep);
      // Long enough not to repeat audibly (>= 5 s).
      expect(d.length / SR).toBeGreaterThan(5);
      // Essentially nothing above 3 kHz (the old scrape had 40 % of its energy there).
      expect(energyAboveDb(d, 3000)).toBeLessThan(-50);
    }
  });

  it('the bumps have no fixed pitch lines (wooden knocks, not "bloops")', () => {
    // Every bump has its own pitch, overtone tuning and noise-rung knock: over the whole texture
    // no line stands far out of its flanks (the sine-partial bumps of the first redesign: ~22 dB
    // at the fundamentals, ~23 dB at a fixed 1.4 kHz overtone).
    const d = rollBuffer(mockContext()).getChannelData(0);
    expect(lineProminenceDb(d, 250, 700)).toBeLessThan(18);
    expect(lineProminenceDb(d, 700, 2000)).toBeLessThan(10);
  });

  it("the bank's groan is a steady, smooth presence, not a peaky on-off", () => {
    const g = groanBuffer(mockContext()).getChannelData(0);
    let e = 0;
    let peak = 0;
    for (const v of g) {
      e += v * v;
      peak = Math.max(peak, Math.abs(v));
    }
    expect(20 * Math.log10(peak / Math.sqrt(e / g.length))).toBeLessThan(11);
    // Sounding (within 20 dB of its peak) most of the time.
    const F = 2400;
    let on = 0;
    let all = 0;
    for (let s = 0; s + F <= g.length; s += F, all++) {
      let q = 0;
      for (let i = s; i < s + F; i++) q += g[i] * g[i];
      if (Math.sqrt(q / F) > 0.1 * peak) on++;
    }
    expect(on / all).toBeGreaterThan(0.5);
    // Long, and its note figure does not cycle every three notes.
    expect(g.length / SR).toBeGreaterThan(12);
    expect(GROAN_NOTES_HZ.length).toBeGreaterThan(4);
  });
});

describe('drag voice (rendered in JS)', () => {
  it('stays soft and unclipped at every intensity and size, and grows with speed', () => {
    let last = -Infinity;
    for (const i of [0.25, 0.5, 0.75, 1]) {
      const y = renderDrag(i, 1, 3);
      const r = rms(y);
      const peak = y.reduce((a, v) => Math.max(a, Math.abs(v)), 0);
      expect(peak).toBeLessThan(0.5);
      expect(20 * Math.log10(peak / r)).toBeLessThan(14); // rounded bumps, no spikes
      expect(energyAboveDb(y, 3000)).toBeLessThan(-40);
      expect(r).toBeGreaterThan(last);
      last = r;
    }
    for (const p of Object.values(DRAG_PITCH)) {
      const y = renderDrag(1, p, 2);
      expect(energyAboveDb(y, 3000)).toBeLessThan(-40);
      expect(y.reduce((a, v) => Math.max(a, Math.abs(v)), 0)).toBeLessThan(0.5);
    }
    // Heavy objects at a slow carry: still a real 300-800 Hz presence (small speakers) and a soft
    // wooden definition at 0.8-2.5 kHz (not muffled; more of it the faster the haul), with no hiss
    // above it. [intensity, size, minimum definition dB]
    for (const [i, p, minDef] of [[0.35, DRAG_PITCH.largeSafe, -35], [0.6, DRAG_PITCH.goldSafe, -32], [1, DRAG_PITCH.smallSafe, -26]] as const) {
      const y = renderDrag(i, p, 4);
      expect(energyBandDb(y, 300, 800)).toBeGreaterThan(-9);
      // What a 400-500 Hz-highpass laptop speaker plays: the knock's presence band.
      expect(energyBandDb(y, 400, 1600)).toBeGreaterThan(-11);
      const def = energyBandDb(y, 800, 2500);
      expect(def).toBeGreaterThan(minDef);
      expect(def).toBeLessThan(-14);
      expect(energyAboveDb(y, 2500)).toBeLessThan(-45);
    }
  });

  it('starts from silence (no level floor at the speed gate) and follows size', () => {
    expect(dragParams(0).bumps).toBe(0);
    expect(dragParams(0).thrum).toBe(0);
    // Just past the director's 0.15 m/s gate the haul is >= 20 dB under full speed (no sputter).
    const gate = dragParams(0.15 / 3.5);
    expect(20 * Math.log10(gate.bumps / dragParams(1).bumps)).toBeLessThan(-20);
    // The final lowpass never opens into the hiss range.
    expect(dragParams(1, 1.15).toneHz).toBeLessThan(2200);
    // Small safe: quicker, higher bumps than a gold safe (~3 semitones), but the gold safe gets
    // the heavier thrum.
    expect(dragParams(0.8, DRAG_PITCH.smallSafe).rate).toBeGreaterThan(dragParams(0.8, DRAG_PITCH.goldSafe).rate * 1.15);
    expect(dragParams(0.8, DRAG_PITCH.goldSafe).thrum).toBeGreaterThan(dragParams(0.8, DRAG_PITCH.smallSafe).thrum * 1.2);
    // Slow / heavy hauls get the presence lift and a more open final lowpass (small speakers
    // under the music); a fast small safe gets neither (it would only get brighter).
    const slowGold = dragParams(0.6, DRAG_PITCH.goldSafe);
    const fastSmall = dragParams(1, DRAG_PITCH.smallSafe);
    expect(slowGold.presDb).toBeGreaterThan(4);
    expect(fastSmall.presDb).toBe(0);
    expect(slowGold.toneHz).toBeGreaterThan(fastSmall.toneHz);
    expect(slowGold.presHz).toBeGreaterThan(500);
    // Small-speaker floor: at any real carry speed (>= ~1 m/s) every size's "du" stays >= 265 Hz.
    for (const p of Object.values(DRAG_PITCH)) {
      for (const i of [0.3, 0.6, 1]) expect(ROLL_BUMP_HZ * dragParams(i, p).rate).toBeGreaterThanOrEqual(265);
    }
    expect(bankParams(0).heave).toBe(0);
    expect(bankParams(1).heaveHz).toBeLessThan(1000);
  });
});

describe('drag / bank graphs', () => {
  it('stay within the node budget, fade to 0 and take a size pitch', () => {
    // Budget: the previous recipes' node counts (drag 7, bank 14) + 4.
    for (const [id, budget] of [['drag', 11], ['bankRumble', 18]] as const) {
      const ctx = mockContext();
      const before = ctx.nodesCreated;
      const v = createLoop(ctx as unknown as BaseAudioContext, id, 0, makeRng(3));
      expect(ctx.nodesCreated - before).toBeLessThanOrEqual(budget);
      v.set(1, 0.1);
      v.set(0, 0.5);
      // Every level-carrying gain is sent to exactly 0 (no floor), smoothly (setTargetAtTime).
      // (Gain nodes only: the drag's presence peaking filter has a dB 'gain' too.)
      const gains = ctx.nodes.filter((n) => 'gain' in n && !(n instanceof MockFilter) && n !== (v.output as unknown)) as unknown as { gain: { events: { kind: string; value: number; time: number }[] } }[];
      const levels = gains.filter((g) => g.gain.events.some((e) => e.kind === 'target' && e.value > 0));
      expect(levels.length).toBeGreaterThanOrEqual(2);
      for (const g of levels) {
        const last = g.gain.events.at(-1)!;
        expect(last.kind).toBe('target');
        expect(last.value).toBe(0);
      }
      // Every filter stays below ~2 kHz.
      for (const f of ctx.nodes.filter((n) => n instanceof MockFilter) as MockFilter[]) {
        for (const e of f.frequency.events) expect(e.value).toBeLessThan(2200);
      }
      v.stop(1);
    }
    const ctx = mockContext();
    const v = createLoop(ctx as unknown as BaseAudioContext, 'drag', 0, makeRng(3));
    v.set(0.8, 0.1);
    const src = ctx.nodes.find((n) => n instanceof MockBufferSource && n.loop) as MockBufferSource;
    const rateAt = (): number => src.playbackRate.events.at(-1)!.value;
    const mid = rateAt();
    v.setPitch(DRAG_PITCH.smallSafe, 0.2);
    expect(rateAt()).toBeGreaterThan(mid * 1.05);
    v.setPitch(DRAG_PITCH.goldSafe, 0.3);
    expect(rateAt()).toBeLessThan(mid * 0.92);
  });

  it("the bank's groan plays at a fixed rate, so it stays on the songs' D-minor chord tones", () => {
    const ctx = mockContext();
    const v = createLoop(ctx as unknown as BaseAudioContext, 'bankRumble', 0, makeRng(3));
    for (const i of [0.2, 0.6, 1]) v.set(i, i);
    const groan = ctx.nodes.find((n) => n instanceof MockBufferSource && n.buffer === (groanBuffer(ctx) as unknown)) as MockBufferSource;
    expect(groan).toBeTruthy();
    expect(groan.playbackRate.events.length).toBe(0);
    expect(groan.playbackRate.value).toBe(1);
    // The thunks' texture still follows the speed.
    const heave = ctx.nodes.find((n) => n instanceof MockBufferSource && n.buffer === (heaveBuffer(ctx) as unknown)) as MockBufferSource;
    expect(heave.playbackRate.events.length).toBeGreaterThan(0);
    // D2 / F2 / A2 (+- 1 cent).
    for (const f of GROAN_NOTES_HZ) {
      const m = 69 + 12 * Math.log2(f / 440);
      expect(Math.abs(m - Math.round(m))).toBeLessThan(0.01);
      expect([2, 5, 9]).toContain(((Math.round(m) % 12) + 12) % 12);
    }
    expect(bankParams(0).groan).toBe(0);
    expect(bankParams(1).groan).toBeGreaterThan(bankParams(0.3).groan);
    v.stop(2);
  });

  it('the director passes a size pitch for every dragged kind and prop', () => {
    const calls: { id: LoopId; key: string | number; pitch: number }[] = [];
    const eng = {
      listener: { x: 0, y: 0 },
      setLoop: (id: LoopId, _i: number, _p?: Vec2, key: string | number = 0, pitch = 1) => calls.push({ id, key, pitch }),
      setListener: () => undefined,
      play: () => undefined,
      stop: () => undefined,
      playMusic: () => undefined,
      setMusicIntensity: () => undefined,
      setMusicTension: () => undefined,
      duckMusic: () => undefined,
    };
    const dir = new MatchAudioDirector(eng as unknown as AudioEngine, { localTeam: 0, footsteps: false, driveMusic: false });
    const holder = { id: 1, slot: 0, team: 0, name: 'c1', isBot: false, look: { hat: 'none' }, pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, facing: 0, moveIntent: { x: 0, y: 0 }, grab: null, straining: false, dashTicks: 0, dashCooldown: 0, boostTicks: 0, knockdownTicks: 0, protectTicks: 0, floorOf: null } as unknown as CharacterState;
    const mk = (id: number, kind: LootState['kind'], variant: LootState['variant']): LootState =>
      ({
        id, kind, variant, baseValue: 100, pos: { x: id, y: 0 }, angle: 0, vel: { x: 2, y: 0 }, angVel: 0, half: { x: 0.4, y: 0.4 }, anchored: false,
        unanchorProgress: 1, recovered: false, recoveredBy: null, recoveredTick: null, grabbedBy: [1], recovery: null, floorOf: null, loadedIn: null,
        homeBank: null, loadedSafes: [], estimatedValue: 100, lastHolder: null,
      }) as LootState;
    const loots = [mk(10, 'smallSafe', null), mk(11, 'largeSafe', null), mk(12, 'largeSafe', 'atm'), mk(13, 'largeSafe', 'piggy'), mk(14, 'largeSafe', 'moneyTree'), mk(15, 'largeSafe', 'goldSafe')];
    const state = { layoutId: 'plaza', tick: 600, endTick: 14400, over: false, result: null, scores: [0, 0], characters: [holder], loot: loots, fences: [], banksRecovered: 0, finalCountdown: false, finalCountdownTick: null, remainingValue: 3200, totalValue: 3200, pings: [] } as unknown as SimState;
    const sim: AudioSimView = { state, getLoot: (id) => loots.find((l) => l.id === id), getCharacter: (id) => (id === 1 ? holder : undefined) };
    dir.update(sim, 1 / 60);
    const pitch = (key: number): number | undefined => calls.find((c) => c.id === 'drag' && c.key === key)?.pitch;
    expect(pitch(10)).toBe(DRAG_PITCH.smallSafe);
    expect(pitch(11)).toBe(DRAG_PITCH.largeSafe);
    expect(pitch(12)).toBe(DRAG_PITCH.atm);
    expect(pitch(13)).toBe(DRAG_PITCH.piggy);
    expect(pitch(14)).toBe(DRAG_PITCH.moneyTree);
    expect(pitch(15)).toBe(DRAG_PITCH.goldSafe);
    expect(DRAG_PITCH.goldSafe).toBeLessThan(DRAG_PITCH.largeSafe);
    expect(DRAG_PITCH.smallSafe).toBeGreaterThan(DRAG_PITCH.largeSafe);
  });
});
