import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BINDINGS,
  MATCH_ACTIONS,
  assignBinding,
  defaultBindings,
  findBindingConflicts,
  isBindable,
  listDuplicateBindings,
  sanitizeBindings,
} from '../../src/platform/bindings';
import {
  DEFAULT_SETTINGS,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  createDefaultSettings,
  detectLanguage,
  sanitizeSettings,
} from '../../src/platform/settings';
import { actionGlyph, bindingGlyph, detectPadFamily, isLayoutDependentCode, normalizeKeyLabel } from '../../src/platform/glyphs';

describe('detectLanguage', () => {
  it('prefers the Steam game language', () => {
    expect(detectLanguage({ steamLanguage: 'koreana', languages: ['en-US'] })).toBe('ko');
    expect(detectLanguage({ steamLanguage: 'english', languages: ['ko-KR'] })).toBe('en');
    expect(detectLanguage({ steamLanguage: 'german' })).toBe('en');
  });
  it('uses the first supported navigator language', () => {
    expect(detectLanguage({ languages: ['ko-KR', 'en-US'] })).toBe('ko');
    expect(detectLanguage({ languages: ['ja-JP', 'en-GB', 'ko'] })).toBe('en');
    expect(detectLanguage({ languages: ['fr-FR'] })).toBe('en');
  });
  it('falls back to Korean without any locale information', () => {
    expect(detectLanguage({})).toBe('ko');
    expect(detectLanguage({ languages: [] })).toBe('ko');
  });
});

describe('sanitizeSettings', () => {
  it('returns complete defaults for garbage input', () => {
    for (const raw of [undefined, null, 42, 'x', [], { bogus: true }]) {
      const s = sanitizeSettings(raw);
      expect(s).toEqual(sanitizeSettings({}));
      expect(s.grabMode).toBe(DEFAULT_SETTINGS.grabMode);
      expect(s.bindings).toEqual(defaultBindings());
    }
  });

  it('keeps valid values and clamps / rejects invalid ones', () => {
    const s = sanitizeSettings({
      language: 'en',
      grabMode: 'toggle',
      volumes: { master: 2, music: -1, sfx: 0.333333, ui: 'loud' },
      subtitles: true,
      screenShake: 7,
      vibration: false,
      reducedMotion: 'yes',
      quality: 'ultra',
      fullscreen: false,
      uiScale: 9,
      showTutorialHints: false,
    });
    expect(s.language).toBe('en');
    expect(s.grabMode).toBe('toggle');
    expect(s.volumes).toEqual({ master: 1, music: 0, sfx: 0.33, ui: DEFAULT_SETTINGS.volumes.ui });
    expect(s.subtitles).toBe(true);
    expect(s.screenShake).toBe(1);
    expect(s.vibration).toBe(false);
    expect(s.reducedMotion).toBe(DEFAULT_SETTINGS.reducedMotion);
    expect(s.quality).toBe(DEFAULT_SETTINGS.quality);
    expect(s.fullscreen).toBe(false);
    expect(s.uiScale).toBe(UI_SCALE_MAX);
    expect(sanitizeSettings({ uiScale: 0.1 }).uiScale).toBe(UI_SCALE_MIN);
    expect(sanitizeSettings({ uiScale: Number.NaN }).uiScale).toBe(DEFAULT_SETTINGS.uiScale);
    expect(s.showTutorialHints).toBe(false);
    expect('bogus' in s).toBe(false);
  });

  it('falls back to a supplied base for missing fields', () => {
    const base = { ...createDefaultSettings({ languages: ['en'] }), grabMode: 'toggle' as const };
    expect(sanitizeSettings({ quality: 'low' }, base)).toMatchObject({ language: 'en', grabMode: 'toggle', quality: 'low' });
  });

  it('round-trips through JSON', () => {
    const s = sanitizeSettings({ language: 'ko', grabMode: 'toggle', uiScale: 1.2 });
    expect(sanitizeSettings(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it('DEFAULT_SETTINGS is immutable', () => {
    expect(() => {
      (DEFAULT_SETTINGS.volumes as { master: number }).master = 0;
    }).toThrow();
    expect(() => {
      DEFAULT_SETTINGS.bindings.keyboard.grab.push('KeyZ');
    }).toThrow();
  });
});

describe('bindings', () => {
  it('defaults follow the spec and have no duplicates', () => {
    const b = DEFAULT_BINDINGS;
    expect(b.keyboard.moveUp).toEqual(['KeyW', 'ArrowUp']);
    expect(b.keyboard.grab).toEqual(['Space', 'KeyJ']);
    expect(b.keyboard.dash.slice(0, 2)).toEqual(['ShiftLeft', 'KeyK']);
    expect(b.keyboard.ping).toEqual(['KeyE', 'KeyL', 'Mouse2']);
    expect(b.keyboard.pause).toEqual(['Escape', 'KeyP']);
    expect(b.gamepad.grab).toEqual(['button:0']);
    expect(b.gamepad.dash).toEqual(['button:2', 'button:5']);
    expect(b.gamepad.ping).toEqual(['button:3']);
    expect(b.gamepad.pause).toEqual(['button:9']);
    expect(b.gamepad.moveLeft).toEqual(['axis:0:-', 'button:14']);
    expect(listDuplicateBindings(b)).toEqual([]);
  });

  it('detects conflicts', () => {
    const b = defaultBindings();
    expect(findBindingConflicts(b, 'keyboard', 'Space')).toEqual([{ action: 'grab', device: 'keyboard', slot: 0, code: 'Space' }]);
    expect(findBindingConflicts(b, 'keyboard', 'Space', 'grab')).toEqual([]);
    expect(findBindingConflicts(b, 'gamepad', 'button:5')).toEqual([{ action: 'dash', device: 'gamepad', slot: 1, code: 'button:5' }]);
    expect(findBindingConflicts(b, 'keyboard', 'KeyZ')).toEqual([]);
  });

  it('swaps on conflict instead of leaving duplicates', () => {
    const r = assignBinding(defaultBindings(), 'grab', 'keyboard', 'KeyK');
    expect(r.ok).toBe(true);
    expect(r.previous).toBe('Space');
    expect(r.conflicts).toEqual([{ action: 'dash', device: 'keyboard', slot: 1, code: 'KeyK' }]);
    expect(r.swaps).toEqual([{ action: 'dash', replacement: 'Space' }]);
    expect(r.bindings.keyboard.grab).toEqual(['KeyK', 'KeyJ']);
    expect(r.bindings.keyboard.dash).toEqual(['ShiftLeft', 'Space', 'ShiftRight']);
    expect(listDuplicateBindings(r.bindings)).toEqual([]);
  });

  it('removes the code from the other action when a swap is impossible', () => {
    // Pause's previous primary (Escape) cannot move to grab, so grab just loses Space.
    const r = assignBinding(defaultBindings(), 'pause', 'keyboard', 'Space');
    expect(r.ok).toBe(true);
    expect(r.bindings.keyboard.pause).toEqual(['Space', 'KeyP']);
    expect(r.bindings.keyboard.grab).toEqual(['KeyJ']);
    expect(r.swaps).toEqual([{ action: 'grab', replacement: null }]);
    expect(listDuplicateBindings(r.bindings)).toEqual([]);
  });

  it('never leaves another action unbound: an empty alternate slot takes the only binding', () => {
    // Ping adds A as an alternate (slot 1 was empty): grab cannot receive anything back by swap.
    const r = assignBinding(defaultBindings(), 'ping', 'gamepad', 'button:0', 1);
    expect(r.ok).toBe(true);
    expect(r.bindings.gamepad.ping).toEqual(['button:3', 'button:0']);
    expect(r.bindings.gamepad.grab.length).toBe(1);
    expect(r.bindings.gamepad.grab[0]).not.toBe('button:0');
    expect(r.swaps).toEqual([{ action: 'grab', replacement: r.bindings.gamepad.grab[0] }]);
    expect(listDuplicateBindings(r.bindings)).toEqual([]);
  });

  it('never leaves another action unbound: the previous code is hard-wired pause', () => {
    // Pause's previous primary is Start, which grab may not hold.
    const r = assignBinding(defaultBindings(), 'pause', 'gamepad', 'button:0');
    expect(r.ok).toBe(true);
    expect(r.bindings.gamepad.pause).toEqual(['button:0']);
    expect(r.bindings.gamepad.grab).toHaveLength(1);
    expect(isBindable('grab', 'gamepad', r.bindings.gamepad.grab[0])).toBe(true);
    expect(listDuplicateBindings(r.bindings)).toEqual([]);
    // Taking pause's only button back is a plain swap (pause receives grab's replacement).
    const back = assignBinding(r.bindings, 'grab', 'gamepad', 'button:0');
    expect(back.bindings.gamepad.grab).toEqual(['button:0']);
    expect(back.bindings.gamepad.pause).toEqual(r.bindings.gamepad.grab);
    // With no swap possible (alternate slot), pause falls back to its hard-wired Start.
    const alt = assignBinding(r.bindings, 'dash', 'gamepad', 'button:0', 2);
    expect(alt.bindings.gamepad.pause).toEqual(['button:9']);
  });

  it('every action keeps a code after any single rebind (exhaustive over defaults)', () => {
    const codes = {
      keyboard: ['KeyW', 'Space', 'KeyK', 'KeyE', 'KeyP', 'Escape', 'Mouse2', 'KeyZ', 'ArrowDown'],
      gamepad: ['button:0', 'button:1', 'button:2', 'button:3', 'button:5', 'button:9', 'axis:1:-', 'button:12'],
    } as const;
    for (const device of ['keyboard', 'gamepad'] as const)
      for (const action of MATCH_ACTIONS)
        for (const code of codes[device])
          for (const slot of [0, 1, 3, 9]) {
            const r = assignBinding(defaultBindings(), action, device, code, slot);
            for (const a of MATCH_ACTIONS) expect(r.bindings[device][a].length, `${action} ${code} ${slot} -> ${a}`).toBeGreaterThan(0);
            expect(listDuplicateBindings(r.bindings)).toEqual([]);
            if (r.ok) expect(r.bindings[device][action]).toContain(code);
          }
  });

  it('moves a code inside the same action instead of duplicating it', () => {
    const r = assignBinding(defaultBindings(), 'moveUp', 'keyboard', 'ArrowUp');
    expect(r.bindings.keyboard.moveUp).toEqual(['ArrowUp']);
    expect(r.conflicts).toEqual([]);
  });

  it('rejects reserved and malformed codes', () => {
    expect(isBindable('grab', 'keyboard', 'Escape')).toBe(false);
    expect(isBindable('pause', 'keyboard', 'Escape')).toBe(true);
    expect(isBindable('grab', 'keyboard', 'F11')).toBe(false);
    expect(isBindable('grab', 'gamepad', 'button:9')).toBe(false);
    expect(isBindable('grab', 'gamepad', 'button:16')).toBe(false);
    expect(isBindable('grab', 'gamepad', 'KeyA')).toBe(false);
    expect(isBindable('grab', 'keyboard', 'button:0')).toBe(false);
    expect(isBindable('grab', 'keyboard', 'Mouse0')).toBe(true);
    expect(isBindable('moveUp', 'gamepad', 'axis:3:-')).toBe(true);
    expect(isBindable('moveUp', 'gamepad', 'axis:3:x')).toBe(false);
    const r = assignBinding(defaultBindings(), 'dash', 'keyboard', 'Escape');
    expect(r.ok).toBe(false);
    expect(r.bindings).toEqual(defaultBindings());
  });

  it('sanitizes stored tables: invalid codes, empties and duplicates', () => {
    const b = sanitizeBindings({
      keyboard: {
        moveUp: ['KeyI', 'KeyI', 42, '../etc'],
        grab: ['KeyI', 'Escape'], // KeyI already taken by moveUp, Escape reserved -> defaults
        dash: [],
        ping: 'KeyE',
      },
      gamepad: { grab: ['button:99', 'axis:1:+'] },
    });
    expect(b.keyboard.moveUp).toEqual(['KeyI']);
    expect(b.keyboard.grab).toEqual(['Space', 'KeyJ']);
    expect(b.keyboard.dash).toEqual(DEFAULT_BINDINGS.keyboard.dash);
    expect(b.keyboard.ping).toEqual(DEFAULT_BINDINGS.keyboard.ping);
    // axis:1:+ on grab steals it from moveDown (grab comes later in action order -> moveDown keeps it)
    expect(b.gamepad.moveDown).toContain('axis:1:+');
    expect(b.gamepad.grab).toEqual(['button:0']);
    for (const a of MATCH_ACTIONS) {
      expect(b.keyboard[a].length).toBeGreaterThan(0);
      expect(b.gamepad[a].length).toBeGreaterThan(0);
    }
    expect(listDuplicateBindings(b)).toEqual([]);
  });

  it('gives an action a free code when earlier actions claimed all of its codes and defaults', () => {
    const b = sanitizeBindings({ keyboard: { moveUp: ['KeyS', 'ArrowDown'] } });
    expect(b.keyboard.moveUp).toEqual(['KeyS', 'ArrowDown']);
    expect(b.keyboard.moveDown).toHaveLength(1);
    expect(isBindable('moveDown', 'keyboard', b.keyboard.moveDown[0])).toBe(true);
    expect(listDuplicateBindings(b)).toEqual([]);
    // A later action that explicitly claims a code keeps it; the empty action gets another one.
    const c = sanitizeBindings({ keyboard: { moveUp: ['KeyS', 'ArrowDown'], grab: ['KeyF'] } });
    expect(c.keyboard.grab).toEqual(['KeyF']);
    expect(c.keyboard.moveDown).not.toContain('KeyF');
    expect(listDuplicateBindings(c)).toEqual([]);
    // Sanitizing a valid table is the identity.
    expect(sanitizeBindings(b)).toEqual(b);
  });
});

describe('glyphs', () => {
  it('labels keys, mouse buttons and pad inputs', () => {
    expect(bindingGlyph('keyboard', 'KeyW').label).toBe('W');
    expect(bindingGlyph('keyboard', 'Space')).toEqual({ label: 'Space', variant: 'wide' });
    expect(bindingGlyph('keyboard', 'Mouse2').variant).toBe('mouse');
    expect(bindingGlyph('gamepad', 'button:0').label).toBe('A');
    expect(bindingGlyph('gamepad', 'button:0', 'playstation').label).toBe('✕');
    expect(bindingGlyph('gamepad', 'button:0', 'nintendo').label).toBe('B');
    expect(bindingGlyph('gamepad', 'axis:1:-').label).toBe('LS↑');
    expect(bindingGlyph('keyboard', null).label).toBe('—');
  });

  it('builds action prompts from bindings', () => {
    const b = defaultBindings();
    expect(actionGlyph('move', 'keyboard', b).label).toBe('WASD');
    expect(actionGlyph('move', 'gamepad', b).label).toBe('LS');
    expect(actionGlyph('grab', 'keyboard', b).label).toBe('Space');
    expect(actionGlyph('grab', 'gamepad', b).label).toBe('A');
    expect(actionGlyph('pause', 'keyboard', b).label).toBe('Esc');
    expect(actionGlyph('confirm', 'gamepad', b).label).toBe('A');
    expect(actionGlyph('back', 'gamepad', b).label).toBe('B');
    const rebound = assignBinding(b, 'moveUp', 'keyboard', 'KeyI').bindings;
    expect(actionGlyph('move', 'keyboard', rebound).label).toBe('IASD');
  });

  it('follows the keyboard layout when a layout map is given', () => {
    const azerty = new Map([
      ['KeyW', 'Z'],
      ['KeyA', 'Q'],
      ['KeyQ', 'A'],
    ]);
    expect(bindingGlyph('keyboard', 'KeyW', 'xbox', azerty).label).toBe('Z');
    expect(bindingGlyph('keyboard', 'KeyS', 'xbox', azerty).label).toBe('S'); // not in the map: physical
    expect(bindingGlyph('keyboard', 'Space', 'xbox', azerty).label).toBe('Space');
    expect(actionGlyph('move', 'keyboard', defaultBindings(), 'xbox', azerty).label).toBe('ZQSD');
    expect(actionGlyph('tabPrev', 'keyboard', defaultBindings(), 'xbox', azerty).label).toBe('A');
    expect(isLayoutDependentCode('KeyQ')).toBe(true);
    expect(isLayoutDependentCode('Digit7')).toBe(true);
    expect(isLayoutDependentCode('Semicolon')).toBe(true);
    expect(isLayoutDependentCode('ShiftLeft')).toBe(false);
    expect(isLayoutDependentCode('Numpad1')).toBe(false);
    expect(normalizeKeyLabel('z')).toBe('Z');
    expect(normalizeKeyLabel('é')).toBe('É');
    expect(normalizeKeyLabel('ß')).toBe('ß');
    expect(normalizeKeyLabel(';')).toBe(';');
    expect(normalizeKeyLabel('ㅈ')).toBeNull();
    expect(normalizeKeyLabel('ц')).toBeNull();
    expect(normalizeKeyLabel('Dead')).toBeNull();
    expect(normalizeKeyLabel(' ')).toBeNull();
    expect(normalizeKeyLabel(7)).toBeNull();
  });

  it('detects pad families', () => {
    expect(detectPadFamily('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)')).toBe('xbox');
    expect(detectPadFamily('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)')).toBe('playstation');
    expect(detectPadFamily('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)')).toBe('nintendo');
    expect(detectPadFamily('Steam Virtual Gamepad')).toBe('xbox');
    expect(detectPadFamily(undefined)).toBe('xbox');
  });
});
