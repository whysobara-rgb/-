/**
 * Audio engine contract tests (docs/ARCHITECTURE.md "Audio API").
 * Runs in Node: without WebAudio everything must be a safe no-op; with the strict mock context
 * every recipe, loop and track must build a valid graph (finite automation, legal starts/stops).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  AudioEngine,
  CAPTION_FALLBACK,
  LOOP_CAPTION_KEYS,
  LOOP_CAPTION_ONSET,
  installCaptionFallbacks,
  LOOP_IDS,
  MUSIC_IDS,
  POLICE_CAPTION_KEYS,
  SFX_CAPTION_KEYS,
  SFX_IDS,
  getAudioEngine,
  type CaptionEvent,
  type SfxId,
} from '../../src/audio';
import { MockAudioContext, MockGain, graphFingerprint, mockContext } from '../../src/audio/dev/mockAudioContext';
import { JINGLES, type JingleNote } from '../../src/audio/jingles';
import {
  LOOP_GAIN,
  POLICE_SIREN_HI_HZ,
  POLICE_SIREN_LO_HZ,
  POLICE_SIREN_RATE,
  SIREN_HIGH_HZ,
  SIREN_PHRASE_BARS,
  alarmBellLevel,
  createLoop,
  policeSirenLevel,
  sirenGapFill,
  sirenLevel,
  sirenPhraseStart,
} from '../../src/audio/loops';
import { BUS_TRIM, DEFAULT_VOLUMES, MASTER_TRIM, busGains, createMixer, makeDucker, sliderGain, volumeToGain } from '../../src/audio/mixer';
import { ALARM_STRIKE_HZ, ALARM_SWELL_SECONDS, alarmBellBuffer, crackleBuffer } from '../../src/audio/dsp';
import { AMBIENCE_LOOPS } from '../../src/audio/ids';
import { makeRng } from '../../src/audio/rng';
import { MusicPlayer } from '../../src/audio/sequencer';
import { CLIMB_LIFT_DB, SFX_RECIPES, RECOVERY_SECONDS, VariantPicker } from '../../src/audio/sfx';
import { SONGS, barSeconds } from '../../src/audio/songs';
import { chord } from '../../src/audio/theory';
import { DEFAULT_SETTINGS } from '../../src/platform/settings';
import { spatialMix } from '../../src/audio/spatial';
import { spawnLoop, spawnSfx } from '../../src/audio/voice';
import { POLICE_AUDIO } from '../../src/audio/director';
import { DEFAULT_RULES, TICK_RATE } from '../../src/sim/config';
import { configureI18n, getLanguage, setLanguage, t } from '../../src/ui/i18n';
import { ko } from '../../src/ui/strings/ko';
import { en } from '../../src/ui/strings/en';

function engineWithMock(): { engine: AudioEngine; ctx: MockAudioContext & AudioContext } {
  const ctx = mockContext();
  const engine = new AudioEngine({ createContext: () => ctx, autoPump: false, seed: 1 });
  return { engine, ctx };
}

describe('without WebAudio (Node)', () => {
  it('imports and every call is a safe no-op', async () => {
    const a = getAudioEngine();
    expect(getAudioEngine()).toBe(a);
    await a.unlock();
    expect(a.unlocked).toBe(false);
    expect(a.context).toBeNull();
    a.setVolumes({ master: 0.5, music: 0.5, sfx: 0.5, ui: 0.5 });
    a.setListener({ x: 3, y: 4 });
    for (const id of SFX_IDS) a.play(id, { pos: { x: 1, y: 1 }, volume: 0.5, pitch: 1.1 });
    for (const id of LOOP_IDS) a.setLoop(id, 0.7, { x: 2, y: 2 });
    for (const id of MUSIC_IDS) a.playMusic(id);
    a.setMusicIntensity(0.8);
    a.stop('recoverStart', 5);
    a.stopAllLoops();
    a.setMuffled(true);
    a.pump();
    expect(a.currentMusic).toBe('none');
  });

  it('still reports captions (deaf / muted players)', () => {
    const a = new AudioEngine({ seed: 3 });
    const got: CaptionEvent[] = [];
    a.setCaptionListener((e) => got.push(e));
    a.setListener({ x: 0, y: 0 });
    a.play('fenceBreak', { pos: { x: -10, y: 0 } });
    a.play('siren');
    a.play('grab', { pos: { x: 0, y: 0 } }); // not captioned (constant feedback)
    a.play('dashHit', { pos: { x: 100, y: 0 } }); // inaudible: no caption
    expect(got.map((e) => e.key)).toEqual(['caption.fenceBreak', 'caption.siren']);
    expect(got[0].side).toBe('left');
    expect(got[1].side).toBeNull();
    // Same caption again immediately is throttled.
    a.play('siren');
    expect(got.length).toBe(2);
    // Loops caption when they become audible.
    a.setLoop('bankRumble', 0.8, { x: 9, y: 0 }, 7);
    expect(got.at(-1)?.key).toBe('caption.bankRumble');
    expect(got.at(-1)?.side).toBe('right');
  });
});

describe('captions', () => {
  it('every caption key has fallback text, and the HUD (i18n t) shows text for it, never a raw key', () => {
    const keys = [...Object.values(SFX_CAPTION_KEYS), ...Object.values(LOOP_CAPTION_KEYS)] as string[];
    expect(keys.length).toBeGreaterThan(10);
    const ui = { ko: ko as Record<string, string>, en: en as Record<string, string> };
    for (const k of keys) {
      expect(k.startsWith('caption.')).toBe(true);
      expect(CAPTION_FALLBACK.ko[k], k).toBeTruthy();
      expect(CAPTION_FALLBACK.en[k], k).toBeTruthy();
    }
    // The HUD resolves captions with the UI's t(key) (src/ui/hud/Effects.ts). Installing a caption
    // listener registers the fallback of every key the UI tables lack, so even before the UI merges
    // new keys no raw "caption.xxx" (or the dev marker) ever reaches the screen.
    configureI18n({ dev: true });
    const lang = getLanguage();
    try {
      new AudioEngine({ seed: 1 }).setCaptionListener(() => undefined);
      for (const l of ['ko', 'en'] as const) {
        setLanguage(l);
        for (const k of keys) {
          const shown = t(k);
          expect(shown, `${l} ${k}`).toBe(ui[l][k] ?? CAPTION_FALLBACK[l][k]);
          expect(shown).not.toContain('caption.');
        }
      }
      // UI strings are never overridden: registering again adds nothing.
      expect(installCaptionFallbacks()).toEqual({ ko: [], en: [] });
    } finally {
      setLanguage(lang);
      configureI18n({ dev: false });
    }
    for (const k of ['caption.siren', 'caption.unanchorBank', 'caption.fenceBreak', 'caption.scoreBank', 'caption.dashHit', 'caption.uprootPop', 'caption.whistleStart', 'caption.hornEnd']) {
      expect(keys).toContain(k);
    }
    // Police / presentation captions (doc §13): siren, whistle, alarm bell, tackle, uproot pop.
    for (const k of ['caption.policeSiren', 'caption.policeWhistle', 'caption.alarmBell', 'caption.tackle', 'caption.uprootPop']) {
      expect(keys).toContain(k);
      expect(POLICE_CAPTION_KEYS).toContain(k);
    }
    expect(CAPTION_FALLBACK.ko['caption.policeSiren']).toBe('[경찰 사이렌]');
    expect(CAPTION_FALLBACK.ko['caption.policeWhistle']).toBe('[호루라기]');
    expect(CAPTION_FALLBACK.ko['caption.alarmBell']).toBe('[은행 경보]');
    // Every new key is actually used by a sound (no orphan strings for the UI to merge).
    for (const k of POLICE_CAPTION_KEYS) expect(keys, k).toContain(k);
  });
});

describe('recipes (strict mock context)', () => {
  it('every SfxId has 2-4 variations', () => {
    for (const id of SFX_IDS) {
      const r = SFX_RECIPES[id];
      expect(r, id).toBeDefined();
      expect(r.variants, id).toBeGreaterThanOrEqual(2);
      expect(r.variants, id).toBeLessThanOrEqual(4);
      expect(r.length).toBeGreaterThan(0);
      expect(r.gain).toBeGreaterThan(0);
    }
  });

  // Signals and menu sounds are recognized by their exact shape, so each of their variations is
  // played identically; everything else also jitters within a variation.
  const CONSISTENT = new Set<SfxId>(['siren', 'countdownBeep', 'whistleStart', 'hornEnd', 'uiMove', 'uiConfirm', 'uiBack', 'uiError', 'uiTab', 'uiAdjust']);

  it('gameplay sounds, pings and jingles differ between plays of the same variation', () => {
    for (const id of SFX_IDS) {
      if (CONSISTENT.has(id)) continue;
      const r = SFX_RECIPES[id];
      for (let v = 0; v < r.variants; v++) {
        const prints = [11, 22, 33].map((seed) => {
          const ctx = mockContext();
          const mixer = createMixer(ctx);
          const from = (ctx as unknown as MockAudioContext).nodes.length;
          spawnSfx(ctx, mixer, id, { t: 0.5, mix: spatialMix({ x: 0, y: 0 }, null), volume: 1, pitch: 1, variant: v, step: 0, key: 65, rnd: makeRng(seed) });
          return graphFingerprint(ctx as unknown as MockAudioContext, from);
        });
        expect(new Set(prints).size, `${id} v${v}`).toBeGreaterThan(1);
      }
    }
  });

  it('every variation builds a legal graph with a sane duration', () => {
    for (const id of SFX_IDS) {
      const r = SFX_RECIPES[id];
      for (let v = 0; v < r.variants; v++) {
        for (const pitch of [0.8, 1, 1.25]) {
          const ctx = mockContext();
          const mixer = createMixer(ctx);
          const before = ctx.nodesCreated;
          const voice = spawnSfx(ctx, mixer, id, {
            t: 0.5,
            mix: spatialMix({ x: 0, y: 0 }, { x: 4, y: 3 }),
            volume: 1,
            pitch,
            variant: v,
            step: 2,
            key: 65,
            rnd: makeRng(v + 1),
          });
          const dur = voice.end - voice.start;
          expect(dur, `${id} v${v}`).toBeGreaterThan(0.02);
          expect(dur, `${id} v${v}`).toBeLessThanOrEqual(r.length + 0.1);
          // Node budget: even the biggest event stays within a few hundred nodes (result
          // jingles, once per match and spread over ~4 s, get a larger allowance).
          expect(ctx.nodesCreated - before, `${id} nodes`).toBeLessThan(r.bus === 'music' ? 600 : 400);
        }
      }
    }
  });

  it('the recovery riser lasts exactly the recovery dwell', () => {
    expect(RECOVERY_SECONDS).toBeCloseTo(DEFAULT_RULES.recoveryTicks / TICK_RATE, 6);
    expect(RECOVERY_SECONDS).toBeCloseTo(1.5, 6);
  });
});

describe('engine with a (mock) AudioContext', () => {
  it('unlock builds the graph, starts wanted music and keeps volumes', async () => {
    const { engine, ctx } = engineWithMock();
    engine.setVolumes({ master: 0.5, music: 2, sfx: -1, ui: Number.NaN });
    expect(engine.getVolumes()).toEqual({ master: 0.5, music: 1, sfx: 0, ui: 0 });
    engine.playMusic('title');
    await engine.unlock();
    expect(engine.unlocked).toBe(true);
    expect(ctx.state).toBe('running');
    expect(engine.currentMusic).toBe('title');
    // Run 40 s of the scheduler: notes get created, nothing throws.
    const started0 = ctx.sourcesStarted;
    for (let t = 0; t < 40; t += 0.04) {
      ctx.currentTime = t;
      engine.pump();
    }
    expect(ctx.sourcesStarted - started0).toBeGreaterThan(200);
  });

  it('plays every sound, enforces polyphony and cleans finished voices', async () => {
    const { engine, ctx } = engineWithMock();
    await engine.unlock();
    ctx.currentTime = 1;
    for (const id of SFX_IDS) engine.play(id, { pos: { x: 2, y: 1 } });
    expect(engine.stats().voices).toBe(SFX_IDS.length);
    // Retrigger guard: the same footstep twice in the same instant only plays once.
    ctx.currentTime = 10;
    engine.pump();
    expect(engine.stats().voices).toBe(0);
    engine.play('footstep');
    engine.play('footstep');
    expect(engine.stats().voices).toBe(1);
    // Per-id cap: many grabs over time never exceed maxVoices active.
    for (let i = 0; i < 20; i++) {
      ctx.currentTime += 0.05;
      engine.play('grab');
    }
    const st = engine.stats();
    expect(st.voices).toBeLessThanOrEqual(SFX_RECIPES.grab.maxVoices + 2);
  });

  it('stop(id, tag) cuts only the tagged riser', async () => {
    const { engine, ctx } = engineWithMock();
    await engine.unlock();
    ctx.currentTime = 2;
    engine.play('recoverStart', { tag: 11 });
    ctx.currentTime = 2.1;
    engine.play('recoverStart', { tag: 12 });
    engine.stop('recoverStart', 11);
    ctx.currentTime = 2.3;
    engine.pump();
    expect(engine.stats().voices).toBe(1);
  });

  it('loops start on demand, follow intensity and are released when silent', async () => {
    const { engine, ctx } = engineWithMock();
    await engine.unlock();
    ctx.currentTime = 1;
    for (const id of LOOP_IDS) engine.setLoop(id, 0.6, { x: 3, y: 0 });
    engine.setLoop('drag', 0.4, { x: -3, y: 0 }, 99);
    expect(engine.stats().loops).toBe(LOOP_IDS.length + 1);
    for (let i = 0; i < 30; i++) {
      ctx.currentTime += 1 / 60;
      engine.setLoop('drag', 0.2 + i / 60, { x: i * 0.1, y: 0 });
    }
    engine.stopAllLoops();
    ctx.currentTime += 0.5;
    engine.pump();
    expect(engine.stats().loops).toBe(LOOP_IDS.length + 1); // still fading
    ctx.currentTime += 2;
    engine.pump();
    expect(engine.stats().loops).toBe(0);
  });

  it('crossfades between tracks and releases the old one', async () => {
    const { engine, ctx } = engineWithMock();
    await engine.unlock();
    engine.playMusic('match');
    for (const x of [0, 0.3, 0.6, 1]) {
      engine.setMusicIntensity(x);
      for (let i = 0; i < 50; i++) {
        ctx.currentTime += 0.04;
        engine.pump();
      }
    }
    engine.playMusic('final');
    expect(engine.currentMusic).toBe('final');
    for (let i = 0; i < 200; i++) {
      ctx.currentTime += 0.04;
      engine.pump();
    }
    engine.playMusic('results');
    engine.playMusic('none');
    expect(engine.currentMusic).toBe('none');
    for (let i = 0; i < 200; i++) {
      ctx.currentTime += 0.04;
      engine.pump();
    }
  });

  it('dispose closes the context and further calls are no-ops', async () => {
    const { engine, ctx } = engineWithMock();
    await engine.unlock();
    engine.dispose();
    expect(ctx.state).toBe('closed');
    engine.play('grab');
    engine.setLoop('drag', 1);
    engine.playMusic('match');
    await engine.unlock();
    expect(engine.context).toBeNull();
  });
});

describe('mixer', () => {
  it('volume sliders map with a square law and clamp', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBe(1);
    expect(volumeToGain(0.5)).toBeCloseTo(0.25);
    expect(volumeToGain(2)).toBe(1);
    expect(volumeToGain(Number.NaN)).toBe(0);
  });

  it('is calibrated at the shipped default sliders (same defaults as the settings module)', () => {
    expect(DEFAULT_VOLUMES).toEqual(DEFAULT_SETTINGS.volumes);
    // Untouched settings -> exactly the measured balance.
    expect(busGains(DEFAULT_VOLUMES)).toEqual({ master: MASTER_TRIM, ...BUS_TRIM });
    // Music sits ~6 dB under the sfx bus at defaults (the remaining ~1 dB comes from the songs).
    const g = busGains(DEFAULT_VOLUMES);
    expect(20 * Math.log10(g.music / g.sfx)).toBeCloseTo(-6.02, 1);
    // Sliders scale around the default with the square law; 0 is silence.
    expect(sliderGain(0.7, 0.7)).toBe(1);
    expect(sliderGain(1, 0.7)).toBeCloseTo(1 / 0.49, 6);
    expect(sliderGain(0, 0.7)).toBe(0);
    const full = busGains({ master: 1, music: 1, sfx: 1, ui: 1 });
    expect(full.music).toBeGreaterThan(g.music);
    expect(full.master).toBeGreaterThan(g.master);
    expect(busGains({ master: 0, music: 1, sfx: 1, ui: 1 }).master).toBe(0);
  });

  it('applies the calibrated gains to its bus nodes', () => {
    const ctx = mockContext();
    const before = (ctx as unknown as MockAudioContext).nodes.length;
    const mixer = createMixer(ctx);
    mixer.setVolumes(DEFAULT_VOLUMES, false);
    const gains = (ctx as unknown as MockAudioContext).nodes.slice(before).filter((n): n is MockGain => n instanceof MockGain);
    const values = gains.map((g) => g.gain.value);
    for (const want of [MASTER_TRIM, BUS_TRIM.music, BUS_TRIM.sfx, BUS_TRIM.ui]) expect(values).toContain(want);
  });
});

describe('siren loop', () => {
  it('phrases on the music bar grid: one wail every 4 bars from the track start', () => {
    const bar = barSeconds(SONGS.final);
    // Final track started at t = 10 s; the loop asks at 12 s -> first phrase at bar 4.
    expect(sirenPhraseStart({ origin: 10, bar }, 12)).toEqual({ start: 10 + SIREN_PHRASE_BARS * bar, bar });
    // Exactly on a boundary (minus scheduling margin) -> the following one.
    expect(sirenPhraseStart({ origin: 10, bar }, 10).start).toBeCloseTo(10 + SIREN_PHRASE_BARS * bar, 9);
    // Track starting in the future -> its bar 0.
    expect(sirenPhraseStart({ origin: 20, bar }, 12).start).toBe(20);
    // No (or a broken) grid -> right away at the fallback tempo.
    for (const g of [null, undefined, { origin: Number.NaN, bar }, { origin: 0, bar: 0 }]) {
      const s = sirenPhraseStart(g, 5);
      expect(s.start).toBeCloseTo(5.05, 9);
      expect(s.bar).toBeCloseTo(240 / 148, 9);
    }
  });

  it('stays well under the music and only fills the gaps in the last seconds', () => {
    // The old continuous wail ran at 0.15 by the end; the phrased one stays far below that.
    expect(sirenLevel(1) * LOOP_GAIN.sirenLoop).toBeLessThan(0.08);
    expect(sirenLevel(0.25)).toBeLessThan(sirenLevel(1) * 0.6);
    expect(sirenGapFill(0.25)).toBe(0);
    expect(sirenGapFill(0.8)).toBe(0);
    expect(sirenGapFill(1)).toBeGreaterThan(0.3);
    expect(sirenGapFill(1)).toBeLessThan(1);
  });

  it('builds a legal graph with and without a music grid, and starts its phase on the boundary', () => {
    for (const grid of [null, { origin: 3, bar: barSeconds(SONGS.final) }]) {
      const ctx = mockContext();
      const m = ctx as unknown as MockAudioContext;
      const from = m.nodes.length;
      const l = createLoop(ctx, 'sirenLoop', 4, makeRng(1), grid);
      for (let t = 4; t < 40; t += 0.25) l.set(Math.min(1, 0.25 + (t - 4) / 36), t);
      l.set(0, 40);
      l.stop(41);
      const starts = m.nodes.slice(from).flatMap((n) => ('startTime' in n ? [(n as unknown as { startTime: number }).startTime] : []));
      const want = sirenPhraseStart(grid, 4).start;
      expect(starts).toContain(want);
      expect(Math.max(...starts)).toBeCloseTo(want, 9);
    }
  });

  it('the music player reports the current bar grid', () => {
    const ctx: AudioContext = mockContext();
    const player = new MusicPlayer({ ctx, input: ctx.createGain(), reverb: ctx.createGain() }, 1);
    expect(player.barGrid()).toBeNull();
    player.play('final', 2);
    const g = player.barGrid();
    expect(g?.bar).toBeCloseTo(barSeconds(SONGS.final), 9);
    expect(g?.origin).toBeGreaterThanOrEqual(2);
    player.play('none', 3);
    expect(player.barGrid()).toBeNull();
  });
});

describe('result jingles', () => {
  const pcs = (sym: string): number[] => {
    const c = chord(sym);
    return c.tones.map((iv) => (c.root + iv) % 12);
  };
  const KEY = 65; // chord symbols are spelled in F major

  for (const [id, scores] of Object.entries(JINGLES)) {
    it(`${id}: ${scores.length} variations, harmony consistent (voicings, bass, no avoid notes)`, () => {
      expect(scores.length).toBe(SFX_RECIPES[id as SfxId].variants);
      scores.forEach((s, k) => {
        const tag = `${id} v${k}`;
        const at = (i: number): string | undefined => s.chords.find((c) => i >= c.at - 1e-9 && i < c.at + c.len - 1e-9)?.sym;
        // Every voicing note belongs to its chord.
        for (const c of s.chords) for (const n of c.notes) expect(pcs(c.sym), `${tag} chord ${c.sym} note ${n}`).toContain((KEY + n) % 12);
        // Harmony covers the whole melody, and the bass only plays chord tones.
        const check = (notes: readonly JingleNote[], what: string, strict: boolean): void => {
          for (const [i, st, len] of notes) {
            const sym = at(i);
            expect(sym, `${tag} ${what} at ${i}: no chord`).toBeDefined();
            const tones = pcs(sym!);
            const pc = (KEY + st + 120) % 12;
            if (strict) {
              expect(tones, `${tag} ${what} at ${i} vs ${sym}`).toContain(pc);
            } else if ((len >= 2 || Math.abs(i % 4) < 1e-9) && !tones.includes(pc)) {
              // Sustained or downbeat melody notes never sit a half step above a chord tone.
              for (const t of tones) expect((pc - t + 12) % 12, `${tag} melody ${st} at ${i} vs ${sym}`).not.toBe(1);
            }
          }
        };
        check(s.bass, 'bass', true);
        check(s.melody, 'melody', false);
        const end = Math.max(...s.melody.map(([i, , len]) => i + len));
        expect(end, tag).toBeLessThanOrEqual(s.eighths + 6.01);
        expect(s.eighths * s.unit + s.tail, tag).toBeLessThanOrEqual(SFX_RECIPES[id as SfxId].length);
      });
    });
  }
});

describe('variation picker', () => {
  it('keeps one countdown timbre for a whole "3, 2, 1, GO" and may switch for the next one', () => {
    const picker = new VariantPicker();
    const rnd = makeRng(4);
    const seen = new Set<number>();
    let t = 0;
    for (let round = 0; round < 12; round++) {
      const first = picker.next('countdownBeep', rnd, t);
      for (let k = 1; k <= 3; k++) expect(picker.next('countdownBeep', rnd, t + k)).toBe(first);
      seen.add(first);
      t += 60;
    }
    expect(seen.size).toBe(SFX_RECIPES.countdownBeep.variants);
    // Unknown time (no clock) never holds.
    const p2 = new VariantPicker();
    expect(p2.next('countdownBeep', rnd)).not.toBe(p2.next('countdownBeep', rnd));
  });

  it('never repeats the same variation twice in a row and uses all of them', () => {
    const picker = new VariantPicker();
    const rnd = makeRng(9);
    for (const id of ['dash', 'footstep', 'grab', 'siren'] as SfxId[]) {
      const seen = new Set<number>();
      let prev = -1;
      for (let i = 0; i < 200; i++) {
        const k = picker.next(id, rnd);
        expect(k).not.toBe(prev);
        expect(k).toBeLessThan(SFX_RECIPES[id].variants);
        seen.add(k);
        prev = k;
      }
      expect(seen.size).toBe(SFX_RECIPES[id].variants);
    }
  });
});

describe('police / presentation plumbing', () => {
  it('ducks merge: a shallow duck never lifts a deeper one early', () => {
    const ctx = mockContext();
    const g = ctx.createGain() as unknown as MockGain;
    const duck = makeDucker(ctx, g.gain as unknown as AudioParam);
    ctx.currentTime = 1;
    duck(1, -10, 2);
    const n = g.gain.events.length;
    duck(1.2, -3, 0.5); // inside the deep duck: nothing changes
    expect(g.gain.events.length).toBe(n);
    duck(1.5, -14, 0.3); // deeper: re-targets, keeps the later end
    const targets = g.gain.events.slice(n).filter((e) => e.kind === 'target');
    expect(targets[0].value).toBeCloseTo(Math.pow(10, -14 / 20), 6);
    expect(targets[1]).toMatchObject({ value: 1, time: 3 });
    // After it ended a new shallow duck applies normally.
    duck(5, -3, 0.5);
    expect(g.gain.events.at(-2)?.value).toBeCloseTo(Math.pow(10, -3 / 20), 6);
  });

  it('sirens and alarm bells run through the ambience bus; scoring sounds duck it', () => {
    const ctx = mockContext();
    const m = ctx as unknown as MockAudioContext;
    const mixer = createMixer(ctx);
    for (const id of LOOP_IDS) {
      const l = spawnLoop(ctx, mixer, id, 0.5, makeRng(1), spatialMix({ x: 0, y: 0 }, { x: 3, y: 0 }));
      const last = l.nodes.at(-1) as unknown as MockGain;
      const ambience = AMBIENCE_LOOPS.includes(id);
      expect(last.outputs.includes(mixer.inputs.ambience as unknown as MockGain), id).toBe(ambience);
      expect(last.outputs.includes(mixer.inputs.sfx as unknown as MockGain), id).toBe(!ambience);
    }
    for (const id of ['scoreSmall', 'scoreLarge', 'scoreBank'] as SfxId[]) expect(SFX_RECIPES[id].duckAmbience?.db, id).toBeLessThanOrEqual(-6);
    // The biggest moments duck the music.
    for (const id of ['unanchorBank', 'scoreBank'] as SfxId[]) expect(SFX_RECIPES[id].duck?.db, id).toBeLessThanOrEqual(-8);
    void m;
  });

  it('police chatter one-shots run through the ambience bus (dry and reverb send); tackles stay on sfx', () => {
    const ctx = mockContext();
    const mixer = createMixer(ctx);
    const chatter: SfxId[] = ['policeWhistle', 'policeBark', 'policeSkid', 'carDoor', 'carVroom'];
    const feedback: SfxId[] = ['tackleHit', 'tackleMiss', 'tackleWhoosh', 'policeStun', 'scoreSmall', 'dashHit'];
    for (const id of [...chatter, ...feedback]) {
      const before = (ctx as unknown as MockAudioContext).nodes.length;
      const v = spawnSfx(ctx, mixer, id, { t: 0.5, mix: spatialMix({ x: 0, y: 0 }, { x: 4, y: 0 }), volume: 1, pitch: 1, variant: 0, step: 0, key: 65, rnd: makeRng(1) });
      const own = (ctx as unknown as MockAudioContext).nodes.slice(before) as unknown as MockGain[];
      const reaches = (dest: AudioNode): boolean => own.some((n) => n.outputs.includes(dest as unknown as MockGain));
      const amb = chatter.includes(id);
      expect(reaches(mixer.inputs.ambience), id).toBe(amb);
      expect(reaches(mixer.inputs.sfx), id).toBe(!amb);
      if (SFX_RECIPES[id].reverb) {
        expect(reaches(mixer.ambienceReverb), `${id} reverb`).toBe(amb);
        expect(reaches(mixer.sfxReverb), `${id} reverb`).toBe(!amb);
      }
      void v;
    }
    // The ambience duck moves the ambience reverb send with it.
    const m = ctx as unknown as MockAudioContext;
    const ambRev = mixer.ambienceReverb as unknown as MockGain;
    const n = ambRev.gain.events.length;
    m.currentTime = 2;
    mixer.duckAmbience(2, -8, 1);
    expect(ambRev.gain.events.length).toBeGreaterThan(n);
    expect(ambRev.gain.events[n].value).toBeCloseTo(Math.pow(10, -8 / 20), 6);
  });

  it('prewarm builds the loop textures in idle steps after unlock, so a first alarm bell is cheap', async () => {
    vi.useFakeTimers();
    try {
      const ctx = mockContext();
      let buffers = 0;
      let waves = 0;
      const createBuffer = ctx.createBuffer.bind(ctx);
      const createWave = ctx.createPeriodicWave.bind(ctx);
      ctx.createBuffer = ((...a: Parameters<typeof createBuffer>) => (buffers++, createBuffer(...a))) as typeof ctx.createBuffer;
      ctx.createPeriodicWave = ((...a: Parameters<typeof createWave>) => (waves++, createWave(...a))) as typeof ctx.createPeriodicWave;
      const engine = new AudioEngine({ createContext: () => ctx, autoPump: false, prewarm: true, seed: 1 });
      void engine.unlock();
      const afterUnlock = buffers;
      // One step per idle slot (no requestIdleCallback in Node: short timeouts).
      await vi.advanceTimersByTimeAsync(31);
      expect(buffers).toBe(afterUnlock + 1);
      await vi.advanceTimersByTimeAsync(2000);
      const warmed = buffers;
      expect(warmed - afterUnlock).toBe(10); // 3 noise colors, scrape, roll, heave, groan, creak, crackle, alarm bell
      expect(waves).toBeGreaterThanOrEqual(2); // the siren's two wave tables
      const w = waves;
      for (const id of ['alarmBell', 'policeSiren', 'strain', 'drag', 'bankRumble'] as const) createLoop(ctx, id, 1, makeRng(2)).stop(2);
      expect(buffers).toBe(warmed);
      expect(waves).toBe(w);
      engine.dispose();
      // Off by default for manual-pump engines (tests, offline renders).
      const ctx2 = mockContext();
      let b2 = 0;
      const cb2 = ctx2.createBuffer.bind(ctx2);
      ctx2.createBuffer = ((...a: Parameters<typeof cb2>) => (b2++, cb2(...a))) as typeof ctx2.createBuffer;
      const e2 = new AudioEngine({ createContext: () => ctx2, autoPump: false, seed: 1 });
      void e2.unlock();
      const b2u = b2;
      await vi.advanceTimersByTimeAsync(2000);
      expect(b2).toBe(b2u);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the combo climb is lifted step by step (higher coins read softer; measured offline)', () => {
    expect(CLIMB_LIFT_DB.length).toBeGreaterThanOrEqual(7);
    expect(CLIMB_LIFT_DB[0]).toBe(0);
    for (let i = 1; i < CLIMB_LIFT_DB.length; i++) expect(CLIMB_LIFT_DB[i]).toBeGreaterThan(CLIMB_LIFT_DB[i - 1]);
    // Step 6 stays a small-safe sound: under ~+5 dB (a large-safe recovery is ~3 LU louder).
    expect(CLIMB_LIFT_DB.at(-1)!).toBeLessThan(5);
  });

  it('setLoop pitch reaches the voice (doppler / size) and the engine exposes duckMusic + tension', async () => {
    const { engine, ctx } = engineWithMock();
    await engine.unlock();
    ctx.currentTime = 1;
    const before = ctx.nodes.length;
    engine.setLoop('policeSiren', 1, { x: 3, y: 0 }, 'car1', 1.06);
    const oscs = ctx.nodes.slice(before).filter((n) => n.constructor.name === 'MockOscillator') as unknown as { detune: { events: { value: number }[] } }[];
    const bent = oscs.filter((o) => o.detune.events.some((e) => Math.abs(e.value - 1200 * Math.log2(1.06)) < 0.01));
    expect(bent.length).toBe(3);
    // Unchanged pitch is not re-sent; a new one is.
    const count = (): number => oscs.reduce((a, o) => a + o.detune.events.length, 0);
    const c0 = count();
    engine.setLoop('policeSiren', 1, { x: 3, y: 0 }, 'car1', 1.06);
    expect(count()).toBe(c0);
    engine.setLoop('policeSiren', 1, { x: 3, y: 0 }, 'car1', 1.0);
    expect(count()).toBe(c0 + 3);
    engine.duckMusic(-8, 0.8);
    engine.setMusicTension(0.7);
    engine.playMusic('match');
    for (let i = 0; i < 100; i++) {
      ctx.currentTime += 0.04;
      engine.pump();
    }
  });

  it('police siren tones are chord tones of the D minor tonic, in the light-bar rhythm', () => {
    const pc = (hz: number): number => ((Math.round(12 * Math.log2(hz / 440)) % 12) + 12 + 9) % 12;
    expect(pc(POLICE_SIREN_HI_HZ)).toBe(2); // D
    expect(pc(POLICE_SIREN_LO_HZ)).toBe(9); // A
    expect(POLICE_SIREN_RATE).toBeCloseTo(2.2, 6);
    // Clearly different from the getaway wail (which sweeps A4..A5).
    expect(POLICE_SIREN_HI_HZ).toBeGreaterThan(SIREN_HIGH_HZ);
    // Loop ceilings (measured offline at 0 m, default volumes: siren -20.6 LUFS, bell -24.9 LUFS
    // momentary max, both under the scoring sounds); the director runs them well below 1.
    expect(policeSirenLevel(1) * LOOP_GAIN.policeSiren).toBeLessThan(0.2);
    expect(alarmBellLevel(1) * LOOP_GAIN.alarmBell).toBeLessThan(0.3);
    expect(policeSirenLevel(POLICE_AUDIO.sirenParkedLevel)).toBeLessThan(policeSirenLevel(1) * 0.25);
    expect(alarmBellLevel(POLICE_AUDIO.alarmSettledLevel)).toBeLessThan(alarmBellLevel(1) * 0.5);
  });

  it('alarm bell and crackle textures are finite, bounded and loop without a seam', () => {
    const ctx = mockContext();
    for (const make of [alarmBellBuffer, crackleBuffer]) {
      const b = make(ctx);
      const d = b.getChannelData(0);
      let peak = 0;
      for (const x of d) {
        expect(Number.isFinite(x)).toBe(true);
        peak = Math.max(peak, Math.abs(x));
      }
      expect(peak).toBeLessThanOrEqual(0.9 + 1e-6);
      expect(peak).toBeGreaterThan(0.5);
      // The wrap-around step is no bigger than a typical sample-to-sample step.
      let maxStep = 0;
      for (let i = 1; i < d.length; i++) maxStep = Math.max(maxStep, Math.abs(d[i] - d[i - 1]));
      expect(Math.abs(d[0] - d[d.length - 1])).toBeLessThanOrEqual(maxStep);
    }
    // The bell rings for 2 swells (~4 s) at the clapper rate.
    expect(alarmBellBuffer(ctx).duration).toBeCloseTo(ALARM_SWELL_SECONDS * 2, 2);
    expect(ALARM_STRIKE_HZ).toBeGreaterThan(8);
  });
});

describe('police captions', () => {
  it('whistles / barks keep a long per-key throttle; other captions keep the normal one', () => {
    let ms = 1000;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => ms);
    try {
      const a = new AudioEngine({ seed: 3 });
      const got: CaptionEvent[] = [];
      a.setCaptionListener((e) => got.push(e));
      a.setListener({ x: 0, y: 0 });
      // Whistles in quick succession from the same side: one caption.
      for (let i = 0; i < 5; i++) a.play('policeWhistle', { pos: { x: 1, y: 0 } });
      a.play('tackleHit', { pos: { x: 1, y: 0 } });
      expect(got.map((e) => e.key)).toEqual(['caption.policeWhistle', 'caption.tackle']);
      ms += 3000;
      a.play('policeWhistle', { pos: { x: 1, y: 0 } });
      a.play('tackleHit', { pos: { x: 1, y: 0 } });
      expect(got.map((e) => e.key)).toEqual(['caption.policeWhistle', 'caption.tackle', 'caption.tackle']);
      ms += 3100;
      a.play('policeWhistle', { pos: { x: 1, y: 0 } });
      expect(got.at(-1)?.key).toBe('caption.policeWhistle');
    } finally {
      spy.mockRestore();
    }
  });

  it('sirens and alarm bells caption once when they become audible, not for as long as they ring', () => {
    let ms = 1000;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => ms);
    try {
      const a = new AudioEngine({ seed: 3 });
      const got: CaptionEvent[] = [];
      a.setCaptionListener((e) => got.push(e));
      a.setListener({ x: 0, y: 0 });
      a.setLoop('policeSiren', 1, { x: -8, y: 0 }, 'car1');
      a.setLoop('alarmBell', 1, { x: 8, y: 0 }, 'bank20');
      expect(got.map((e) => [e.key, e.side])).toEqual([
        ['caption.policeSiren', 'left'],
        ['caption.alarmBell', 'right'],
      ]);
      // A minute of ringing (frames every 50 ms), plus a second bank and a second car: nothing more.
      for (let i = 0; i < 1200; i++) {
        ms += 50;
        a.setLoop('policeSiren', 1, { x: -8, y: 0 }, 'car1');
        a.setLoop('alarmBell', 1, { x: 8, y: 0 }, 'bank20');
        if (i === 100) {
          a.setLoop('alarmBell', 1, { x: -6, y: 0 }, 'bank21');
          a.setLoop('policeSiren', 1, { x: 6, y: 0 }, 'car2');
        }
      }
      expect(got.length).toBe(2);
      // The bell goes out of earshot and comes back: captioned again (LOOP_CAPTION_ONSET apart).
      a.setLoop('alarmBell', 1, { x: 80, y: 0 }, 'bank20');
      ms += 200;
      a.setLoop('alarmBell', 1, { x: 8, y: 0 }, 'bank20');
      expect(got.at(-1)?.key).toBe('caption.alarmBell');
      expect(got.length).toBe(3);
      // A hauled bank's rumble still refreshes while it moves (continuous information).
      a.setLoop('bankRumble', 0.8, { x: 3, y: 0 }, 21);
      ms += 2300;
      a.setLoop('bankRumble', 0.8, { x: 3, y: 0 }, 21);
      expect(got.filter((e) => e.key === 'caption.bankRumble').length).toBe(2);
      expect(LOOP_CAPTION_ONSET.alarmBell).toBeGreaterThanOrEqual(10000);
    } finally {
      spy.mockRestore();
    }
  });
});
