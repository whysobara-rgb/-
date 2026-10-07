/**
 * The uproot tug ('strain') and the bank's chord-following groan (owner feedback: pulling an object
 * out and hauling it away sounded too harsh). The strain is a warm creaky rope / root over a hollow
 * tension hum, built from band-limited wooden textures (./src/audio/dsp.ts ropeCreakBuffer /
 * rootPopBuffer) under one 24 dB/oct lowpass: no grit shaper, nothing bright, yet still rising in
 * pitch and level with progress. The bank's groan sits on the root of the chord the music is
 * playing (only root / octave / fifth partials), so it never rubs a semitone against A7 or C7.
 */
import { describe, expect, it } from 'vitest';
import { MockBufferSource, MockFilter, MockOscillator, MockParam, mockContext } from '../../src/audio/dev/mockAudioContext';
import { STRAIN_PITCH } from '../../src/audio/director';
import { ROPE_CREAK_HZ, ropeCreakBuffer, rootPopBuffer } from '../../src/audio/dsp';
import { GROAN_PARTIALS, GROAN_ROOT_HZ, createLoop, groanRootHz, strainParams, type BarGrid } from '../../src/audio/loops';
import { makeRng } from '../../src/audio/rng';
import { MusicPlayer } from '../../src/audio/sequencer';
import { SONG_CHORDS, SONGS, barSeconds } from '../../src/audio/songs';
import { chord } from '../../src/audio/theory';

const SR = 48000;

/** Energy in [lo, hi) Hz relative to the total (dB): plain DFT bins of Hann-windowed 2048-pt frames. */
function bandDb(x: Float32Array, lo: number, hi: number): number {
  const N = 2048;
  const cos = new Float64Array(N);
  const sin = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / N);
    sin[i] = Math.sin((2 * Math.PI * i) / N);
  }
  let inBand = 0;
  let all = 0;
  const hop = Math.max(N, Math.floor((x.length - N) / 12));
  const w = new Float64Array(N);
  for (let s = 0; s + N <= x.length; s += hop) {
    for (let i = 0; i < N; i++) w[i] = x[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
    // Every 4th bin is enough to weigh the bands (the textures are broadband within them).
    for (let k = 1; k < N / 2; k += 4) {
      let re = 0;
      let im = 0;
      for (let i = 0, j = 0; i < N; i++, j = (j + k) % N) {
        re += w[i] * cos[j];
        im -= w[i] * sin[j];
      }
      const p = re * re + im * im;
      const f = (k * SR) / N;
      all += p;
      if (f >= lo && f < hi) inBand += p;
    }
  }
  return 10 * Math.log10(inBand / all);
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

/** RBJ lowpass biquad, constant settings (what BiquadFilterNode 'lowpass' does). */
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

/** The strain voice without the ground shake (creak + toks + hum through the final lowpasses). */
function renderStrain(i: number, p: number, seconds: number): Float32Array {
  const ctx = mockContext();
  const s = strainParams(i, p);
  const n = Math.floor(SR * seconds);
  const creak = playLooped(ropeCreakBuffer(ctx).getChannelData(0), s.creakRate, n);
  const pops = playLooped(rootPopBuffer(ctx).getChannelData(0), s.popRate, n);
  const humRaw = new Float32Array(n);
  const parts = [1, 0.6, 0.4, 0.25, 0.15, 0.1];
  for (let k = 0; k < n; k++) {
    let v = 0;
    for (let h = 0; h < parts.length; h++) v += parts[h] * Math.sin((2 * Math.PI * (h + 1) * s.humHz * k) / SR);
    humRaw[k] = v / 2;
  }
  const hum = lowpass(humRaw, s.humLpHz, 0.7);
  const mix = new Float32Array(n);
  for (let k = 0; k < n; k++) mix[k] = creak[k] * s.creak + pops[k] * s.pops + hum[k] * s.hum;
  return lowpass(lowpass(mix, s.toneHz, 0.6), s.toneHz, 0.6).subarray(SR * 0.1);
}

const rms = (x: Float32Array): number => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);

describe('strain (uproot tug) textures', () => {
  it('are finite, bounded, DC-free, seamless, click-free and dark', () => {
    const ctx = mockContext();
    for (const make of [ropeCreakBuffer, rootPopBuffer]) {
      const d = make(ctx).getChannelData(0);
      let peak = 0;
      let sum = 0;
      let maxStep = 0;
      for (let i = 0; i < d.length; i++) {
        expect(Number.isFinite(d[i])).toBe(true);
        peak = Math.max(peak, Math.abs(d[i]));
        sum += d[i];
        if (i > 0) maxStep = Math.max(maxStep, Math.abs(d[i] - d[i - 1]));
      }
      expect(peak).toBeLessThanOrEqual(0.9 + 1e-6);
      expect(peak).toBeGreaterThan(0.85);
      expect(Math.abs(sum / d.length)).toBeLessThan(1e-3);
      // Soft attacks only: no sample-to-sample jump (the old crackle's noisy onsets were clicks).
      expect(maxStep).toBeLessThan(0.15);
      expect(Math.abs(d[0] - d[d.length - 1])).toBeLessThanOrEqual(maxStep);
      expect(d.length / SR).toBeGreaterThan(2);
      // Nothing bright: the old creak / crackle put their resonances at 1-3.7 kHz.
      expect(bandDb(d, 2500, SR / 2)).toBeLessThan(-40);
    }
    // The creak's woody body sits low (warm), at the rope-creak rate.
    expect(ROPE_CREAK_HZ).toBeLessThan(600);
  });
});

describe('strain voice', () => {
  it('rises in pitch, quiver and level with progress, for every size', () => {
    for (const p of Object.values(STRAIN_PITCH)) {
      const lo = strainParams(0.15, p);
      const hi = strainParams(1, p);
      // The hum climbs about an octave over the tug; the creak gets higher and denser.
      expect(hi.humHz / lo.humHz).toBeGreaterThan(1.75);
      expect(hi.creakRate).toBeGreaterThan(lo.creakRate * 1.4);
      expect(hi.quiverHz).toBeGreaterThan(lo.quiverHz);
      expect(hi.quiverCents).toBeGreaterThan(lo.quiverCents);
      expect(hi.hum).toBeGreaterThan(lo.hum);
      // The final lowpass never opens into the bright range.
      expect(hi.toneHz).toBeLessThan(2100);
    }
    // Roots give way past ~40 %, the ground shakes past 80 %.
    expect(strainParams(0.35).pops).toBe(0);
    expect(strainParams(0.9).pops).toBeGreaterThan(0);
    expect(strainParams(0.75).shake).toBe(0);
    expect(strainParams(1).shake).toBe(1);
    // Size: small safe higher than a bank.
    expect(strainParams(0.6, STRAIN_PITCH.smallSafe).humHz).toBeGreaterThan(strainParams(0.6, STRAIN_PITCH.bank).humHz * 1.5);
  });

  it('rendered in JS: soft, dark at every progress and size, louder as it builds', () => {
    for (const p of Object.values(STRAIN_PITCH)) {
      let last = 0;
      for (const i of [0.25, 0.5, 0.75, 1]) {
        const y = renderStrain(i, p, 1.2);
        expect(bandDb(y, 2500, SR / 2)).toBeLessThan(-40);
        const r = rms(y);
        expect(r).toBeGreaterThan(last);
        last = r;
        expect(y.reduce((a, v) => Math.max(a, Math.abs(v)), 0)).toBeLessThan(1);
      }
    }
  });

  it('has no grit shaper, stays in budget, fades to 0 and takes a size pitch', () => {
    const ctx = mockContext();
    const before = ctx.nodesCreated;
    const v = createLoop(ctx as unknown as BaseAudioContext, 'strain', 0, makeRng(3));
    // The previous recipe's 23 nodes, minus its saw / grit / whine chain.
    expect(ctx.nodesCreated - before).toBeLessThanOrEqual(20);
    expect(ctx.nodes.some((n) => n.constructor.name === 'MockShaper')).toBe(false);
    v.setPitch(STRAIN_PITCH.smallSafe, 0);
    v.set(1, 0.1);
    for (const f of ctx.nodes.filter((n) => n instanceof MockFilter) as MockFilter[]) {
      for (const e of f.frequency.events) expect(e.value).toBeLessThan(2100);
    }
    const hum = ctx.nodes.find((n) => n instanceof MockOscillator && n.type === 'custom') as MockOscillator;
    const humAt = (): number => hum.frequency.events.at(-1)!.value;
    const small = humAt();
    v.setPitch(STRAIN_PITCH.bank, 0.2);
    expect(humAt()).toBeLessThan(small * 0.6);
    v.set(0, 0.3);
    // Level gains (not the quiver / tremolo depths, which feed a param).
    const gains = ctx.nodes.filter((n) => 'gain' in n && !(n instanceof MockFilter) && n !== (v.output as unknown) && n.outputs.every((o) => !(o instanceof MockParam))) as unknown as {
      gain: { events: { kind: string; value: number }[] };
    }[];
    const levels = gains.filter((g) => g.gain.events.some((e) => e.kind === 'target' && e.value > 0));
    expect(levels.length).toBeGreaterThanOrEqual(4);
    for (const g of levels) expect(g.gain.events.at(-1)!.value).toBe(0);
    // The creak and toks are the new soft textures.
    for (const make of [ropeCreakBuffer, rootPopBuffer]) {
      expect(ctx.nodes.some((n) => n instanceof MockBufferSource && n.buffer === (make(ctx) as unknown))).toBe(true);
    }
    v.stop(1);
  });
});

describe("bank groan follows the music's chord", () => {
  const pcOf = (hz: number): number => (((Math.round(69 + 12 * Math.log2(hz / 440)) % 12) + 12) % 12);
  const centsOff = (hz: number): number => {
    const m = 69 + 12 * Math.log2(hz / 440);
    return 100 * Math.abs(m - Math.round(m));
  };
  const groanOsc = (ctx: ReturnType<typeof mockContext>): MockOscillator =>
    ctx.nodes.find((n) => n instanceof MockOscillator && n.type === 'custom') as MockOscillator;

  it('has only root / octave / fifth partials, and every song chord has a perfect fifth', () => {
    for (const [h] of GROAN_PARTIALS) {
      const iv = (12 * Math.log2(h)) % 12;
      const d = Math.min(Math.abs(iv), Math.abs(iv - 7), Math.abs(iv - 12));
      expect(d).toBeLessThan(0.03);
    }
    for (const id of ['match', 'final'] as const) {
      for (const bar of SONG_CHORDS[id]) for (const sym of bar.split(' ')) expect(chord(sym).tones).toContain(7);
    }
    // Without music: D2, the songs' tonic.
    expect(pcOf(GROAN_ROOT_HZ)).toBe(2);
    expect(centsOff(GROAN_ROOT_HZ)).toBeLessThan(1);
  });

  it('picks the octave of the new root nearest the current pitch, inside ~62-131 Hz', () => {
    for (let pc = 0; pc < 12; pc++) {
      for (const near of [65, 90, 125]) {
        const f = groanRootHz(pc, near);
        expect(pcOf(f)).toBe(pc);
        expect(centsOff(f)).toBeLessThan(1);
        expect(f).toBeGreaterThanOrEqual(61);
        expect(f).toBeLessThanOrEqual(131);
      }
    }
    expect(groanRootHz(0, 125)).toBeCloseTo(130.81, 1);
    expect(groanRootHz(0, 66)).toBeCloseTo(65.41, 1);
  });

  it('schedules the chord root of every bar of the match form, on the bar line', () => {
    const chords = SONG_CHORDS.match;
    const bar = barSeconds(SONGS.match);
    const origin = 1;
    const rootAt = (t: number): number | null => (t < origin ? null : chord(chords[Math.floor((t - origin) / bar) % chords.length]).root);
    const grid: BarGrid = { origin, bar, rootAt };
    const ctx = mockContext();
    const v = createLoop(ctx as unknown as BaseAudioContext, 'bankRumble', 1.2, makeRng(3), grid);
    v.set(0.8, 1.2);
    const ev = groanOsc(ctx).frequency.events.filter((e) => e.kind === 'target');
    // A change at most every bar for >= 40 bars ahead (a steady haul sends no updates).
    expect(ev.length).toBeGreaterThan(20);
    expect(ev.at(-1)!.time - 1.2).toBeGreaterThan(40 * bar);
    for (const e of ev) {
      // Each glide starts just before its bar line and lands on that bar's chord root.
      expect(pcOf(e.value)).toBe(rootAt(e.time + 0.05));
      expect(centsOff(e.value)).toBeLessThan(1);
    }
    // The A7 and C7 bars get A and C (no D / F / A over them as before).
    const a7 = chords.indexOf('A7');
    expect(ev.some((e) => Math.abs(e.time + 0.03 - (origin + a7 * bar)) < 1e-6 && pcOf(e.value) === 9)).toBe(true);
    v.stop(3);
  });

  it('without music stays on D2; with a live grid it follows a track change', () => {
    const quiet = mockContext();
    const q = createLoop(quiet as unknown as BaseAudioContext, 'bankRumble', 0, makeRng(3), null);
    q.set(1, 0.1);
    expect(groanOsc(quiet).frequency.events.length).toBe(0);
    expect(groanOsc(quiet).frequency.value).toBe(GROAN_ROOT_HZ);
    q.stop(1);

    const ctx = mockContext();
    const player = new MusicPlayer({ ctx: ctx as unknown as BaseAudioContext, input: ctx.createGain() as unknown as AudioNode, reverb: ctx.createGain() as unknown as AudioNode }, 1);
    player.play('match', 0);
    const grid = player.barGrid()!;
    const mb = barSeconds(SONGS.match);
    for (let k = 0; k < 32; k++) expect(grid.rootAt!(grid.origin + (k + 0.5) * mb)).toBe(chord(SONG_CHORDS.match[k]).root);
    const v = createLoop(ctx as unknown as BaseAudioContext, 'bankRumble', 1, makeRng(3), grid);
    v.set(0.8, 1);
    // The final countdown starts while the bank is still hauled: the same grid now reads 'final'.
    player.play('final', 20);
    expect(grid.bar).toBeCloseTo(barSeconds(SONGS.final), 9);
    expect(grid.origin).toBeGreaterThanOrEqual(20);
    const n0 = groanOsc(ctx).frequency.events.length;
    v.set(0.7, 21);
    const later = groanOsc(ctx).frequency.events.slice(n0).filter((e) => e.kind === 'target' && e.time > 21);
    expect(later.length).toBeGreaterThan(5);
    for (const e of later) expect(pcOf(e.value)).toBe(grid.rootAt!(e.time + 0.05));
    player.play('none', 30);
    expect(player.barGrid()).toBeNull();
    expect(grid.rootAt!(31)).toBeNull();
    v.stop(32);
  });
});
