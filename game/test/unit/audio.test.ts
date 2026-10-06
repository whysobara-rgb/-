/**
 * Audio engine contract tests (docs/ARCHITECTURE.md "Audio API").
 * Runs in Node: without WebAudio everything must be a safe no-op; with the strict mock context
 * every recipe, loop and track must build a valid graph (finite automation, legal starts/stops).
 */
import { describe, expect, it } from 'vitest';
import {
  AudioEngine,
  CAPTION_FALLBACK,
  LOOP_CAPTION_KEYS,
  LOOP_IDS,
  MUSIC_IDS,
  SFX_CAPTION_KEYS,
  SFX_IDS,
  getAudioEngine,
  type CaptionEvent,
  type SfxId,
} from '../../src/audio';
import { MockAudioContext, mockContext } from '../../src/audio/dev/mockAudioContext';
import { createMixer, volumeToGain } from '../../src/audio/mixer';
import { makeRng } from '../../src/audio/rng';
import { SFX_RECIPES, RECOVERY_SECONDS, VariantPicker } from '../../src/audio/sfx';
import { spatialMix } from '../../src/audio/spatial';
import { spawnSfx } from '../../src/audio/voice';
import { DEFAULT_RULES, TICK_RATE } from '../../src/sim/config';
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
  it('every caption key has fallback text and exists in the UI string tables', () => {
    const keys = [...Object.values(SFX_CAPTION_KEYS), ...Object.values(LOOP_CAPTION_KEYS)] as string[];
    expect(keys.length).toBeGreaterThan(10);
    const ui = { ko: ko as Record<string, string>, en: en as Record<string, string> };
    for (const k of keys) {
      expect(k.startsWith('caption.')).toBe(true);
      expect(CAPTION_FALLBACK.ko[k], k).toBeTruthy();
      expect(CAPTION_FALLBACK.en[k], k).toBeTruthy();
      expect(ui.ko[k], `ui ko ${k}`).toBeTruthy();
      expect(ui.en[k], `ui en ${k}`).toBeTruthy();
    }
    for (const k of ['caption.siren', 'caption.unanchorBank', 'caption.fenceBreak', 'caption.scoreBank', 'caption.dashHit', 'caption.unanchorSafe', 'caption.whistleStart', 'caption.hornEnd']) {
      expect(keys).toContain(k);
    }
  });
});

describe('recipes (strict mock context)', () => {
  it('every SfxId has 1-4 variations; gameplay sounds have at least 2', () => {
    for (const id of SFX_IDS) {
      const r = SFX_RECIPES[id];
      expect(r, id).toBeDefined();
      expect(r.variants).toBeGreaterThanOrEqual(1);
      expect(r.variants).toBeLessThanOrEqual(4);
      if (!['victory', 'defeat', 'draw'].includes(id)) expect(r.variants, id).toBeGreaterThanOrEqual(2);
      expect(r.length).toBeGreaterThan(0);
      expect(r.gain).toBeGreaterThan(0);
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
});

describe('variation picker', () => {
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
