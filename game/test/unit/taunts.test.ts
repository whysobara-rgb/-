/**
 * Taunt emotes (owner addition), everything outside the sim: bindings (Ctrl chords, optional
 * actions, conflicts), InputManager chord handling and capture, the wheel's slot picking and state
 * machine, owned taunts from the save, the view's taunt state machine on mocked character states,
 * the taunt poses, and the audio director's mapping.
 */
import { describe, expect, it } from 'vitest';
import {
  CHORD_ACTIONS,
  DEFAULT_BINDINGS,
  EMOTE_ACTIONS,
  MATCH_ACTIONS,
  OPTIONAL_ACTIONS,
  assignBinding,
  chordBase,
  defaultBindings,
  isBindable,
  listDuplicateBindings,
  sanitizeBindings,
} from '../../src/platform/bindings';
import { bindingGlyph } from '../../src/platform/glyphs';
import { InputManager } from '../../src/platform/input';
import { EMOTE_IDS, EmoteWheelController, RIVAL_EMOTES, unlockedEmotes, wheelSlotAt, wheelSlotAngle, type WheelInput } from '../../src/platform/emotes';
import { createDefaultSaveData, sanitizeSaveData } from '../../src/platform/save';
import { createDefaultSettings, sanitizeSettings } from '../../src/platform/settings';
import { TauntTracker, tauntBlocked, type TauntWorld } from '../../src/render/taunts';
import { TAUNT_FACES, TAUNT_SECONDS, neutralTauntPose, tauntPose } from '../../src/render/models/tauntPoses';
import { MatchAudioDirector, SFX_CAPTION_KEYS, SFX_IDS, TAUNT_SFX, tauntTag, type AudioEngine, type AudioSimView, type PlayOptions, type SfxId } from '../../src/audio';
import { SFX_RECIPES } from '../../src/audio/sfx';
import { BASE_EMOTES, type CharacterState, type EmoteId, type SimEvent, type SimState, type Vec2 } from '../../src/sim/types';
import { EMOTE } from '../../src/sim/config';
import { ko } from '../../src/ui/strings/ko';
import { en } from '../../src/ui/strings/en';

// ---------------------------------------------------------------------------------------------
// Bindings
// ---------------------------------------------------------------------------------------------

describe('taunt bindings', () => {
  it('defaults: Ctrl+1..4 and plain 1..4 on the keyboard, T and LB for the wheel, no pad direct taunts', () => {
    const b = defaultBindings();
    EMOTE_ACTIONS.forEach((a, i) => {
      expect(b.keyboard[a]).toEqual([`Ctrl+Digit${i + 1}`, `Digit${i + 1}`]);
      expect(b.gamepad[a]).toEqual([]);
    });
    expect(b.keyboard.emoteWheel).toEqual(['KeyT']);
    expect(b.gamepad.emoteWheel).toEqual(['button:4']);
    expect(listDuplicateBindings(b)).toEqual([]);
    for (const a of ['emote1', 'emote2', 'emote3', 'emote4', 'emoteWheel'] as const) expect(MATCH_ACTIONS).toContain(a);
  });

  it('chords are valid only for the direct taunts, never with a modifier or Esc as the main key', () => {
    expect(chordBase('Ctrl+Digit1')).toBe('Digit1');
    expect(chordBase('Digit1')).toBeNull();
    expect(isBindable('emote1', 'keyboard', 'Ctrl+Digit1')).toBe(true);
    expect(isBindable('emote2', 'keyboard', 'Ctrl+KeyG')).toBe(true);
    expect(isBindable('grab', 'keyboard', 'Ctrl+Digit1')).toBe(false);
    expect(isBindable('emoteWheel', 'keyboard', 'Ctrl+KeyT')).toBe(false);
    expect(isBindable('emote1', 'keyboard', 'Ctrl+ControlLeft')).toBe(false);
    expect(isBindable('emote1', 'keyboard', 'Ctrl+Escape')).toBe(false);
    expect(isBindable('emote1', 'keyboard', 'Ctrl+F11')).toBe(false);
    expect(isBindable('emote1', 'gamepad', 'Ctrl+Digit1')).toBe(false);
    expect([...CHORD_ACTIONS].sort()).toEqual([...EMOTE_ACTIONS].sort());
  });

  it('rebinding a taunt key onto grab swaps; a taunt may be left without a key, grab never', () => {
    // Digit1 to grab: grab's previous primary (Space) moves to emote1.
    const r = assignBinding(defaultBindings(), 'grab', 'keyboard', 'Digit1');
    expect(r.ok).toBe(true);
    expect(r.bindings.keyboard.grab[0]).toBe('Digit1');
    expect(r.bindings.keyboard.emote1).toContain('Space');
    expect(listDuplicateBindings(r.bindings)).toEqual([]);
    // Taking LB (the wheel's only pad button) for dash without a swap partner leaves the wheel empty.
    const w = assignBinding(defaultBindings(), 'dash', 'gamepad', 'button:4', 3);
    expect(w.bindings.gamepad.dash).toContain('button:4');
    expect(w.bindings.gamepad.emoteWheel).toEqual([]);
    expect(w.swaps).toEqual([{ action: 'emoteWheel', replacement: null }]);
    // Every REQUIRED action still has a code after any rebind onto a taunt code.
    for (const code of ['Digit1', 'Digit2', 'KeyT', 'Ctrl+Digit3']) {
      for (const action of MATCH_ACTIONS) {
        const res = assignBinding(defaultBindings(), action, 'keyboard', code);
        for (const a of MATCH_ACTIONS) if (!OPTIONAL_ACTIONS.has(a)) expect(res.bindings.keyboard[a].length, `${action} ${code} -> ${a}`).toBeGreaterThan(0);
        expect(listDuplicateBindings(res.bindings)).toEqual([]);
      }
    }
  });

  it('a chord on one taunt moves off the other taunt that had it', () => {
    const r = assignBinding(defaultBindings(), 'emote2', 'keyboard', 'Ctrl+Digit1');
    expect(r.bindings.keyboard.emote2[0]).toBe('Ctrl+Digit1');
    expect(r.bindings.keyboard.emote1).not.toContain('Ctrl+Digit1');
    expect(r.bindings.keyboard.emote1).toContain('Ctrl+Digit2'); // swapped
  });

  it('sanitize: old saves get the taunt defaults, an explicitly empty taunt stays empty, conflicts resolve', () => {
    const old = sanitizeBindings({ keyboard: { grab: ['Space'] } });
    expect(old.keyboard.emote1).toEqual(DEFAULT_BINDINGS.keyboard.emote1);
    expect(old.gamepad.emoteWheel).toEqual(['button:4']);
    const cleared = sanitizeBindings({ keyboard: { emote3: [] }, gamepad: { emoteWheel: [] } });
    expect(cleared.keyboard.emote3).toEqual([]);
    expect(cleared.gamepad.emoteWheel).toEqual([]);
    // A required action claiming Digit1 keeps it; the taunt keeps its chord.
    const clash = sanitizeBindings({ keyboard: { dash: ['Digit1'] } });
    expect(clash.keyboard.dash).toEqual(['Digit1']);
    expect(clash.keyboard.emote1).toEqual(['Ctrl+Digit1']);
    // Chords on a non-taunt action are dropped.
    expect(sanitizeBindings({ keyboard: { ping: ['Ctrl+KeyE'] } }).keyboard.ping).toEqual(DEFAULT_BINDINGS.keyboard.ping);
    expect(listDuplicateBindings(clash)).toEqual([]);
  });

  it('chord labels read "Ctrl+1"', () => {
    expect(bindingGlyph('keyboard', 'Ctrl+Digit1').label).toBe('Ctrl+1');
    expect(bindingGlyph('keyboard', 'Ctrl+KeyG').label).toBe('Ctrl+G');
  });
});

// ---------------------------------------------------------------------------------------------
// InputManager
// ---------------------------------------------------------------------------------------------

function keyEvent(type: 'keydown' | 'keyup', code: string, mods: { ctrl?: boolean; repeat?: boolean } = {}): Event {
  return Object.assign(new Event(type, { cancelable: true }), { code, repeat: !!mods.repeat, ctrlKey: !!mods.ctrl, metaKey: false, altKey: false, shiftKey: false, key: '' });
}

function setup() {
  let t = 1000;
  const target = new EventTarget();
  const input = new InputManager({ target, doc: null, now: () => t, getGamepads: () => [], keyboard: null });
  const send = (type: 'keydown' | 'keyup', code: string, ctrl = false): boolean => target.dispatchEvent(keyEvent(type, code, { ctrl }));
  return { input, target, send, advance: (ms: number) => (t += ms) };
}

describe('InputManager taunts', () => {
  it('plain digits and Ctrl chords both fire the direct taunt once', () => {
    const s = setup();
    s.input.pollMatch();
    s.send('keydown', 'Digit2');
    expect(s.input.pollMatch().emotePressed).toBe(1);
    expect(s.input.pollMatch().emotePressed).toBeNull();
    s.send('keyup', 'Digit2');
    s.send('keydown', 'ControlLeft', true);
    const notCancelled = s.send('keydown', 'Digit1', true);
    expect(notCancelled).toBe(false); // the bound chord's default action is prevented (desktop build)
    expect(s.input.pollMatch().emotePressed).toBe(0);
    s.send('keyup', 'Digit1', true);
    s.send('keyup', 'ControlLeft');
    expect(s.input.pollMatch().emotePressed).toBeNull();
  });

  it('a chord releases cleanly even when Ctrl goes up first', () => {
    const s = setup();
    s.input.pollMatch();
    s.send('keydown', 'ControlLeft', true);
    s.send('keydown', 'Digit3', true);
    s.input.pollMatch();
    s.send('keyup', 'ControlLeft');
    s.send('keyup', 'Digit3');
    // Pressing Digit3 again (no Ctrl) is a fresh plain press.
    s.send('keydown', 'Digit3');
    expect(s.input.pollMatch().emotePressed).toBe(2);
  });

  it('Ctrl + an unbound chord registers the plain key (movement keeps working with Ctrl held)', () => {
    const s = setup();
    s.input.pollMatch();
    s.send('keydown', 'KeyW', true);
    expect(s.input.pollMatch().move).toEqual({ x: 0, y: -1 });
  });

  it('wheel: held state, keys and neutral aim', () => {
    const s = setup();
    s.input.pollMatch();
    s.send('keydown', 'KeyT');
    s.send('keydown', 'KeyD');
    const f = s.input.pollMatch();
    expect(f.emoteWheelDown).toBe(true);
    expect(f.wheelKeys).toEqual({ x: 1, y: 0 });
    expect(f.wheelStick).toEqual({ x: 0, y: 0 });
    s.send('keyup', 'KeyT');
    expect(s.input.pollMatch().emoteWheelDown).toBe(false);
  });

  it('rebind capture: Ctrl+key binds a chord on taunts, Ctrl alone binds Control', async () => {
    const s = setup();
    const p = s.input.startRebind('emote3', 'keyboard', { timeoutMs: 0 });
    s.send('keydown', 'ControlLeft', true);
    s.send('keydown', 'KeyG', true);
    expect(await p).toBe('Ctrl+KeyG');
    expect(s.input.getBindings().keyboard.emote3[0]).toBe('Ctrl+KeyG');
    const q = s.input.startRebind('emote4', 'keyboard', { timeoutMs: 0 });
    s.send('keydown', 'ControlRight', true);
    s.send('keyup', 'ControlRight');
    expect(await q).toBe('ControlRight');
    // Non-taunt actions ignore the chord and take the plain key.
    const r = s.input.startRebind('ping', 'keyboard', { timeoutMs: 0 });
    s.send('keydown', 'KeyH', true);
    expect(await r).toBe('KeyH');
    expect(listDuplicateBindings(s.input.getBindings())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Wheel
// ---------------------------------------------------------------------------------------------

describe('taunt wheel picking', () => {
  it('slot 0 is straight up, then clockwise; inside the deadzone picks nothing', () => {
    expect(wheelSlotAt({ x: 0, y: -1 }, 7)).toBe(0);
    expect(wheelSlotAt({ x: 1, y: 0 }, 7)).toBe(2); // 90° / (360/7) ≈ 1.75 -> 2
    expect(wheelSlotAt({ x: 0, y: 1 }, 7)).toBe(4); // 180° -> 3.5 rounds to 4 (half-open sectors)
    expect(wheelSlotAt({ x: -1, y: 0 }, 7)).toBe(5);
    expect(wheelSlotAt({ x: -0.05, y: -1 }, 7)).toBe(0);
    expect(wheelSlotAt({ x: 0.1, y: 0.1 }, 7)).toBeNull();
    expect(wheelSlotAt({ x: Number.NaN, y: 1 }, 7)).toBe(4);
    for (let i = 0; i < 7; i++) {
      const a = wheelSlotAngle(i, 7);
      expect(wheelSlotAt({ x: Math.sin(a), y: -Math.cos(a) }, 7)).toBe(i);
    }
  });

  const idle: WheelInput = { held: false, stick: { x: 0, y: 0 }, keys: { x: 0, y: 0 }, pointer: null, cancel: false };

  it('open, flick the stick, let it spring back, release: confirms the last pick', () => {
    const w = new EmoteWheelController(BASE_EMOTES);
    expect(w.update({ ...idle, held: true }).justOpened).toBe(true);
    expect(w.update({ ...idle, held: true, stick: { x: 1, y: 0 } }).hover).toBe(2);
    expect(w.update({ ...idle, held: true }).hover).toBe(2); // sticky
    const out = w.update(idle);
    expect(out.confirmed).toBe(EMOTE_IDS[2]);
    expect(out.justClosed).toBe(true);
    expect(w.open).toBe(false);
  });

  it('locked slots never fire; cancel closes without a taunt; no pick = nothing', () => {
    const w = new EmoteWheelController(BASE_EMOTES);
    w.update({ ...idle, held: true });
    w.update({ ...idle, held: true, keys: { x: -1, y: 0 } }); // index 5 = tongkeunFlex (locked)
    const out = w.update(idle);
    expect(out.confirmed).toBeNull();
    expect(out.lockedPick).toBe('tongkeunFlex');
    w.update({ ...idle, held: true });
    w.update({ ...idle, held: true, stick: { x: 0, y: -1 } });
    const c = w.update({ ...idle, held: true, cancel: true });
    expect(c.justClosed).toBe(true);
    expect(c.confirmed).toBeNull();
    // Still holding after the cancel: no reopen until released.
    expect(w.update({ ...idle, held: true }).open).toBe(false);
    w.update(idle);
    w.update({ ...idle, held: true });
    expect(w.update(idle).confirmed).toBeNull();
  });

  it('mouse picks once it moved far enough from where the wheel opened', () => {
    const w = new EmoteWheelController([...BASE_EMOTES, 'nunchiShrug']);
    w.update({ ...idle, held: true, pointer: { x: 500, y: 300 } });
    expect(w.update({ ...idle, held: true, pointer: { x: 510, y: 300 } }).hover).toBeNull();
    expect(w.update({ ...idle, held: true, pointer: { x: 470, y: 270 } }).hover).toBe(6);
    expect(w.update(idle).confirmed).toBe('nunchiShrug');
  });

  it('owned taunts: base four always; rival taunts only when the save lists them (missing field = none)', () => {
    expect(unlockedEmotes(undefined)).toEqual([...BASE_EMOTES]);
    expect(unlockedEmotes({})).toEqual([...BASE_EMOTES]);
    expect(unlockedEmotes({ unlockedEmotes: ['tongkeunFlex', 'bogus'] })).toEqual([...BASE_EMOTES, 'tongkeunFlex']);
    expect(EMOTE_IDS.slice(4)).toEqual([...RIVAL_EMOTES]);
  });

  it('save keeps a valid unlockedEmotes list and leaves it out when absent; settings default to showing taunts', () => {
    const d = sanitizeSaveData({ cosmetics: { unlockedEmotes: ['nunchiShrug', 'nope', 'hodadakZoom', 'nunchiShrug'] } });
    expect(d.cosmetics.unlockedEmotes).toEqual(['hodadakZoom', 'nunchiShrug']);
    expect(sanitizeSaveData({}).cosmetics.unlockedEmotes).toBeUndefined();
    expect(createDefaultSaveData().cosmetics.unlockedEmotes).toBeUndefined();
    expect(createDefaultSettings().showOthersTaunts).toBe(true);
    expect(sanitizeSettings({ showOthersTaunts: false }).showOthersTaunts).toBe(false);
    expect(sanitizeSettings({ showOthersTaunts: 'no' }).showOthersTaunts).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// View taunt state machine (mocked CharacterState.emote)
// ---------------------------------------------------------------------------------------------

function char(id: number, team: 0 | 1, pos: Vec2, extra: Partial<CharacterState> = {}): CharacterState {
  return {
    id, slot: id - 1, team, name: `c${id}`, isBot: id !== 1, look: { hat: 'none' }, pos, vel: { x: 0, y: 0 }, facing: 0,
    moveIntent: { x: 0, y: 0 }, grab: null, straining: false, dashTicks: 0, dashCooldown: 0, boostTicks: 0,
    knockdownTicks: 0, protectTicks: 0, floorOf: null, ...extra,
  };
}

function worldOf(chars: CharacterState[]): TauntWorld {
  return {
    posOf: (id) => chars.find((c) => c.id === id)?.pos ?? null,
    nearestOpponent: (c) => {
      let best: number | null = null;
      let bd = EMOTE.nearOpponentRadius;
      for (const o of chars) {
        if (o.team === c.team) continue;
        const d = Math.hypot(o.pos.x - c.pos.x, o.pos.y - c.pos.y);
        if (d <= bd) {
          bd = d;
          best = o.id;
        }
      }
      return best;
    },
  };
}

describe('TauntTracker', () => {
  const dur = (id: EmoteId) => EMOTE.durationTicks[id];

  it('plays a state taunt to its end, facing the rival the event names', () => {
    const me = char(1, 0, { x: 0, y: 0 });
    const rival = char(3, 1, { x: 0, y: 4 });
    const w = worldOf([me, rival]);
    const tr = new TauntTracker();
    me.emote = { id: 'bleh', startTick: 100, endTick: 100 + dur('bleh') };
    tr.onEvent({ type: 'emote', tick: 100, charId: 1, emoteId: 'bleh', nearOpponentId: 3 });
    const s = tr.update(me, 100.5, w)!;
    expect(s.id).toBe('bleh');
    expect(s.t).toBeCloseTo(0.5 / 60);
    expect(s.facing).toBeCloseTo(Math.PI / 2);
    expect(tr.takeChanges()).toEqual([{ charId: 1, id: 'bleh', kind: 'start' }]);
    expect(tr.update(me, 130, w)!.t).toBeCloseTo(0.5);
    expect(tr.update(me, 100 + dur('bleh'), w)).toBeNull();
    expect(tr.takeChanges()).toEqual([{ charId: 1, id: 'bleh', kind: 'stop', cancelled: false }]);
    // The stale state never restarts it.
    expect(tr.update(me, 100 + dur('bleh') + 5, w)).toBeNull();
    expect(tr.takeChanges()).toEqual([]);
  });

  it('the wiggle turns its back on the rival; no rival in front keeps the own facing', () => {
    const me = char(1, 0, { x: 0, y: 0 });
    const rival = char(3, 1, { x: 3, y: 0 });
    const tr = new TauntTracker();
    me.emote = { id: 'wiggle', startTick: 10, endTick: 10 + dur('wiggle') };
    // No event: the view looks for the nearest opponent itself.
    expect(tr.update(me, 12, worldOf([me, rival]))!.facing).toBeCloseTo(Math.PI);
    const alone = char(2, 0, { x: 0, y: 0 }, { emote: { id: 'fanCash', startTick: 10, endTick: 10 + dur('fanCash') } });
    expect(tr.update(alone, 12, worldOf([alone]))!.facing).toBeNull();
  });

  it('cancels: state cleared early, emoteCancel, or the raccoon grabs / dashes / gets knocked / moves', () => {
    const w = worldOf([]);
    const tr = new TauntTracker();
    const a = char(1, 0, { x: 0, y: 0 }, { emote: { id: 'squatBounce', startTick: 0, endTick: dur('squatBounce') } });
    expect(tr.update(a, 1, w)).not.toBeNull();
    a.emote = null;
    expect(tr.update(a, 2, w)).toBeNull();
    const b = char(2, 0, { x: 0, y: 0 }, { emote: { id: 'bleh', startTick: 0, endTick: dur('bleh') } });
    tr.update(b, 1, w);
    tr.onEvent({ type: 'emoteCancel', tick: 2, charId: 2, emoteId: 'bleh' });
    expect(tr.update(b, 2, w)).toBeNull();
    for (const extra of [{ dashTicks: 5 }, { knockdownTicks: 30 }, { moveIntent: { x: 0.5, y: 0 } }, { grab: { targetId: 9, part: 'safe' as const, anchorLocal: { x: 0, y: 0 } } }]) {
      const c = char(3, 0, { x: 0, y: 0 }, { emote: { id: 'wiggle', startTick: 0, endTick: dur('wiggle') } });
      const t2 = new TauntTracker();
      expect(t2.update(c, 1, w)).not.toBeNull();
      Object.assign(c, extra);
      expect(tauntBlocked(c)).toBe(true);
      expect(t2.update(c, 2, w)).toBeNull();
      expect(t2.takeChanges().at(-1)).toEqual({ charId: 3, id: 'wiggle', kind: 'stop', cancelled: true });
    }
  });

  it('a new taunt replaces the playing one; event-only (no state field) plays the nominal length', () => {
    const w = worldOf([]);
    const tr = new TauntTracker();
    const me = char(1, 0, { x: 0, y: 0 }, { emote: { id: 'bleh', startTick: 0, endTick: dur('bleh') } });
    tr.update(me, 1, w);
    me.emote = { id: 'fanCash', startTick: 20, endTick: 20 + dur('fanCash') };
    expect(tr.update(me, 21, w)!.id).toBe('fanCash');
    expect(tr.takeChanges().map((c) => `${c.kind}:${c.id}`)).toEqual(['start:bleh', 'stop:bleh', 'start:fanCash']);
    const legacy = char(2, 1, { x: 0, y: 0 });
    delete (legacy as Partial<CharacterState>).emote;
    tr.onEvent({ type: 'emote', tick: 50, charId: 2, emoteId: 'tongkeunFlex', nearOpponentId: null });
    expect(tr.update(legacy, 51, w)!.dur).toBeCloseTo(TAUNT_SECONDS.tongkeunFlex);
    expect(tr.update(legacy, 50 + dur('tongkeunFlex'), w)).toBeNull();
  });
});

describe('taunt poses', () => {
  const ids = Object.keys(TAUNT_SECONDS) as EmoteId[];

  it('every taunt starts and ends near neutral and moves a lot in the middle', () => {
    const n = neutralTauntPose();
    const dist = (p: ReturnType<typeof tauntPose>): number =>
      Math.abs(p.lean - n.lean) + Math.abs(p.roll - n.roll) + Math.abs(p.pivotY - n.pivotY) * 4 +
      Math.abs(p.armL.fwd - n.armL.fwd) + Math.abs(p.armR.fwd - n.armR.fwd) + Math.abs(p.armL.out - n.armL.out) + Math.abs(p.armR.out - n.armR.out) +
      Math.abs(p.legL.fwd - n.legL.fwd) + Math.abs(p.legR.fwd - n.legR.fwd) + Math.abs(p.headYaw) + Math.abs(p.headRoll) + Math.abs(p.sy - 1) * 3;
    for (const id of ids) {
      const d = TAUNT_SECONDS[id];
      expect(dist(tauntPose(id, 0)), `${id} start`).toBeLessThan(0.05);
      expect(dist(tauntPose(id, d)), `${id} end`).toBeLessThan(0.12);
      let peak = 0;
      for (let t = 0; t <= d; t += 1 / 30) peak = Math.max(peak, dist(tauntPose(id, t)));
      expect(peak, `${id} peak`).toBeGreaterThan(1);
      for (let t = 0; t <= d; t += 1 / 30) {
        const p = tauntPose(id, t);
        for (const v of [p.lean, p.roll, p.pivotY, p.armL.fwd, p.armR.out, p.headYaw, p.fan, p.tongue]) expect(Number.isFinite(v)).toBe(true);
        expect(TAUNT_FACES[id]).toContain(p.face);
      }
    }
  });

  it('time-scales to the duration it is given, and props show only in their taunts', () => {
    const a = tauntPose('fanCash', 0.9);
    const b = tauntPose('fanCash', 0.45, 0.9);
    expect(b.armR.fwd).toBeCloseTo(a.armR.fwd);
    expect(tauntPose('fanCash', 0.9).fan).toBeGreaterThan(0.9);
    expect(tauntPose('bleh', 0.6).tongue).toBeGreaterThan(0.9);
    expect(tauntPose('hodadakZoom', 0.4).speed).toBeGreaterThan(0.9);
    expect(Math.max(...[0.64, 0.66, 0.68, 0.7].map((t) => tauntPose('tongkeunFlex', t).glint))).toBeGreaterThan(0.5);
    expect(tauntPose('wiggle', 0.8).fan + tauntPose('wiggle', 0.8).tongue + tauntPose('wiggle', 0.8).glint).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Audio director
// ---------------------------------------------------------------------------------------------

class RecordingEngine {
  calls: { fn: string; id: string; o?: PlayOptions; tag?: string | number }[] = [];
  play(id: SfxId, o: PlayOptions = {}): void {
    this.calls.push({ fn: 'play', id, o });
  }
  stop(id: SfxId, tag?: string | number): void {
    this.calls.push({ fn: 'stop', id, tag });
  }
  setLoop(): void {}
  playMusic(): void {}
  setMusicIntensity(): void {}
  setMusicTension(): void {}
  duckMusic(): void {}
  setListener(): void {}
}

function simView(chars: CharacterState[]): AudioSimView {
  const state = { tick: 600, characters: chars, loot: [], pings: [], police: [] } as unknown as SimState;
  return { state, getLoot: () => undefined, getCharacter: (id) => chars.find((c) => c.id === id) };
}

describe('taunt sounds', () => {
  it('every taunt has a recipe, a caption key and ko/en caption text', () => {
    for (const [emote, sfx] of Object.entries(TAUNT_SFX)) {
      expect(SFX_IDS, emote).toContain(sfx);
      expect(SFX_RECIPES[sfx], emote).toBeDefined();
      const key = SFX_CAPTION_KEYS[sfx]!;
      expect(key, emote).toMatch(/^caption\.taunt/);
      expect((ko as Record<string, string>)[key]).toBeTruthy();
      expect((en as Record<string, string>)[key]).toBeTruthy();
      expect(SFX_RECIPES[sfx].global).not.toBe(true); // positional
    }
    expect(Object.keys(TAUNT_SFX).sort()).toEqual(Object.keys(EMOTE.durationTicks).sort());
  });

  it("plays at the raccoon on 'emote', cuts it on 'emoteCancel', and honours the others' taunts filter", () => {
    const eng = new RecordingEngine();
    let showOthers = true;
    const dir = new MatchAudioDirector(eng as unknown as AudioEngine, { localTeam: 0, listenerCharId: 1, driveMusic: false, tauntFilter: () => showOthers });
    const chars = [char(1, 0, { x: 1, y: 2 }), char(3, 1, { x: 6, y: 2 })];
    const v = simView(chars);
    const ev = (e: SimEvent): void => dir.onEvents([e], v);
    ev({ type: 'emote', tick: 600, charId: 3, emoteId: 'wiggle', nearOpponentId: 1 });
    const play = eng.calls.find((c) => c.fn === 'play')!;
    expect(play.id).toBe('tauntWiggle');
    expect(play.o?.pos).toEqual({ x: 6, y: 2 });
    expect(play.o?.tag).toBe(tauntTag(3));
    ev({ type: 'emoteCancel', tick: 610, charId: 3, emoteId: 'wiggle' });
    expect(eng.calls.at(-1)).toEqual({ fn: 'stop', id: 'tauntWiggle', tag: tauntTag(3) });
    showOthers = false;
    eng.calls.length = 0;
    ev({ type: 'emote', tick: 620, charId: 3, emoteId: 'bleh', nearOpponentId: 1 });
    expect(eng.calls.filter((c) => c.fn === 'play')).toEqual([]);
    // Our own taunt always plays.
    ev({ type: 'emote', tick: 620, charId: 1, emoteId: 'squatBounce', nearOpponentId: null });
    expect(eng.calls.filter((c) => c.fn === 'play').map((c) => c.id)).toEqual(['tauntSquat']);
  });
});
