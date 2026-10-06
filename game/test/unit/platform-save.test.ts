import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LocalStorageSaveBackend,
  MemorySaveBackend,
  SAVE_VERSION,
  SaveManager,
  applyMatchStats,
  createDefaultSaveData,
  createDefaultStats,
  migrateSave,
  newHats,
  parseSaveText,
  sanitizeSaveData,
  unlockHat,
  type SaveData,
  type SaveMigration,
  type StorageLike,
} from '../../src/platform/save';
import { createDefaultSettings } from '../../src/platform/settings';

const defaults = (): SaveData => createDefaultSaveData(createDefaultSettings({ languages: ['ko-KR'] }));
const manager = (backend: MemorySaveBackend, debounceMs = 50): SaveManager =>
  new SaveManager(backend, { debounceMs, retryMs: 100, defaults, flushOnHide: false });

function validSave(patch: Partial<SaveData> = {}): SaveData {
  return { ...defaults(), ...patch };
}

describe('sanitizeSaveData', () => {
  it('fills a complete object from nothing', () => {
    const d = sanitizeSaveData(undefined, defaults());
    expect(d.version).toBe(SAVE_VERSION);
    expect(d.tournament).toEqual({ beaten: [], series: null });
    expect(d.cosmetics.unlocked).toEqual(['none', 'teamCapA', 'teamCapB']);
    expect(d.cosmetics.equipped).toBe('teamCapA');
    expect(d.stats).toEqual(createDefaultStats());
    expect(d.achievements).toEqual([]);
    expect(d.settings.language).toBe('ko');
  });

  it('repairs inconsistent progress', () => {
    const d = sanitizeSaveData(
      {
        tournament: {
          beaten: ['nunchi', 'hodadak', 'hodadak', 'boss'],
          series: { rival: 'tongkeun', wins: 5, losses: -2, draws: 1.7, gameIndex: 0, layoutId: 'plaza', adaptation: { kind: 'guardDoors', lineKey: 'adapt.tongkeun.guardDoors.1' } },
        },
        cosmetics: { unlocked: ['tongkeunHat', 'crown'], equipped: 'nunchiMask', seen: ['tongkeunHat'] },
        stats: { matches: 3.9, wins: -1, bestScore: 'lots' },
        achievements: ['FIRST_RECOVERY', 'FIRST_RECOVERY', 'lower', 'FUTURE_ONE', 7],
      },
      defaults(),
    );
    expect(d.tournament.beaten).toEqual(['hodadak', 'nunchi']);
    expect(d.tournament.series).toEqual({
      rival: 'tongkeun',
      wins: 2,
      losses: 0,
      draws: 1,
      gameIndex: 3,
      layoutId: 'plaza',
      adaptation: { kind: 'guardDoors', lineKey: 'adapt.tongkeun.guardDoors.1' },
    });
    // Beaten rivals always grant their hat; unknown hats are dropped.
    expect(d.cosmetics.unlocked).toEqual(['none', 'teamCapA', 'teamCapB', 'hodadakBand', 'tongkeunHat', 'nunchiMask']);
    expect(d.cosmetics.equipped).toBe('nunchiMask');
    expect(newHats(d.cosmetics)).toEqual(['hodadakBand', 'nunchiMask']);
    expect(d.stats).toMatchObject({ matches: 3, wins: 0, bestScore: 0 });
    // Unknown-but-well-formed ids survive (a newer version may have added them).
    expect(d.achievements).toEqual(['FIRST_RECOVERY', 'FUTURE_ONE']);
  });

  it('rejects an equipped hat that is not unlocked', () => {
    const d = sanitizeSaveData({ cosmetics: { unlocked: [], equipped: 'nunchiMask' } }, defaults());
    expect(d.cosmetics.equipped).toBe('teamCapA');
  });
});

describe('migrateSave', () => {
  it('migrates unversioned (v0) data', () => {
    const r = migrateSave({ stats: { wins: 2 }, settings: { grabMode: 'toggle' } }, undefined, undefined, defaults());
    expect(r.fromVersion).toBe(0);
    expect(r.migrated).toBe(true);
    expect(r.newer).toBe(false);
    expect(r.data.version).toBe(SAVE_VERSION);
    expect(r.data.stats.wins).toBe(2);
    expect(r.data.settings.grabMode).toBe('toggle');
  });

  it('leaves current data alone', () => {
    const r = migrateSave(validSave(), undefined, undefined, defaults());
    expect(r.migrated).toBe(false);
    expect(r.fromVersion).toBe(SAVE_VERSION);
  });

  it('runs a chain of steps in order', () => {
    const calls: string[] = [];
    const chain: SaveMigration[] = [
      { from: 2, to: 3, migrate: (d) => (calls.push('2->3'), { ...d, stats: { ...(d.stats as object), wins: 30 } }) },
      { from: 0, to: 1, migrate: (d) => (calls.push('0->1'), { ...d, version: 1 }) },
      { from: 1, to: 2, migrate: (d) => (calls.push('1->2'), { ...d, version: 2, legacy: undefined, stats: { matches: Number(d.legacyMatches) } }) },
    ];
    const r = migrateSave({ legacyMatches: 9 }, chain, 3, defaults());
    expect(calls).toEqual(['0->1', '1->2', '2->3']);
    expect(r.data.stats.matches).toBe(9);
    expect(r.data.stats.wins).toBe(30);
  });

  it('survives a throwing migration step', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const chain: SaveMigration[] = [{ from: 0, to: 1, migrate: () => { throw new Error('boom'); } }];
    const r = migrateSave({ stats: { wins: 4 } }, chain, 1, defaults());
    expect(r.data.stats.wins).toBe(4);
    err.mockRestore();
  });

  it('flags saves from a newer version', () => {
    const r = migrateSave({ ...validSave(), version: SAVE_VERSION + 5, stats: { wins: 7 } }, undefined, undefined, defaults());
    expect(r.newer).toBe(true);
    expect(r.data.version).toBe(SAVE_VERSION);
    expect(r.data.stats.wins).toBe(7);
  });
});

describe('parseSaveText', () => {
  it('accepts objects only', () => {
    expect(parseSaveText('{"a":1}')).toEqual({ a: 1 });
    expect(parseSaveText('﻿{"a":1}')).toEqual({ a: 1 });
    for (const bad of [null, '', '   ', '{"a":', '[]', '42', 'null', 'garbage']) expect(parseSaveText(bad)).toBeNull();
  });
});

describe('SaveManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts from defaults without writing anything', () => {
    const b = new MemorySaveBackend();
    const m = manager(b);
    const r = m.load();
    expect(r).toMatchObject({ source: 'default', fromVersion: null, recoveredFromCorruption: false, backend: 'memory' });
    vi.advanceTimersByTime(1000);
    expect(b.writes).toBe(0);
  });

  it('debounces writes and rotates the backup', () => {
    const b = new MemorySaveBackend();
    const m = manager(b, 50);
    m.load();
    m.update((d) => (d.stats.matches = 1));
    m.update((d) => (d.stats.matches = 2));
    expect(b.writes).toBe(0);
    vi.advanceTimersByTime(49);
    expect(b.writes).toBe(0);
    vi.advanceTimersByTime(1);
    expect(b.writes).toBe(1);
    expect(JSON.parse(b.read('main')!).stats.matches).toBe(2);
    m.update((d) => (d.stats.matches = 3));
    expect(m.flush()).toBe(true);
    expect(b.writes).toBe(2);
    expect(JSON.parse(b.read('backup')!).stats.matches).toBe(2);
    expect(JSON.parse(b.read('main')!).stats.matches).toBe(3);
    // Nothing dirty: flush is a no-op.
    m.flush();
    expect(b.writes).toBe(2);
  });

  it('reloads what it wrote', () => {
    const b = new MemorySaveBackend();
    const m = manager(b);
    m.load();
    m.update((d) => {
      d.tournament.beaten.push('hodadak');
      unlockHat(d.cosmetics, 'hodadakBand');
      d.settings.grabMode = 'toggle';
      d.achievements.push('BEAT_HODADAK');
    }, { immediate: true });
    const m2 = manager(b);
    const r = m2.load();
    expect(r.source).toBe('main');
    expect(m2.data).toEqual(m.data);
  });

  it('recovers from a corrupt main save using the backup and keeps a quarantined copy', () => {
    const b = new MemorySaveBackend();
    b.slots.set('backup', JSON.stringify(validSave({ stats: { ...createDefaultStats(), wins: 11 } })));
    b.slots.set('main', '{"version":1,"stats":{"wins":12'); // truncated write
    const m = manager(b);
    const r = m.load();
    expect(r).toMatchObject({ source: 'backup', recoveredFromCorruption: true });
    expect(m.data.stats.wins).toBe(11);
    expect(b.quarantined).toEqual([{ text: '{"version":1,"stats":{"wins":12', reason: 'corrupt' }]);
    // The repaired data was written back immediately and the good backup was not overwritten.
    expect(JSON.parse(b.read('main')!).stats.wins).toBe(11);
    expect(JSON.parse(b.read('backup')!).stats.wins).toBe(11);
    expect(m.dirty).toBe(false);
  });

  it('falls back to defaults when both slots are corrupt', () => {
    const b = new MemorySaveBackend();
    b.slots.set('main', 'not json');
    b.slots.set('backup', '[1,2,3]');
    const m = manager(b);
    const r = m.load();
    expect(r).toMatchObject({ source: 'default', recoveredFromCorruption: true });
    expect(m.data.stats).toEqual(createDefaultStats());
    expect(b.quarantined.map((q) => q.reason)).toEqual(['corrupt', 'corrupt-backup']);
    expect(parseSaveText(b.read('main'))).not.toBeNull();
  });

  it('quarantines a newer-version save before overwriting it', () => {
    const b = new MemorySaveBackend();
    const future = JSON.stringify({ ...validSave(), version: SAVE_VERSION + 1, futureField: { x: 1 } });
    b.slots.set('main', future);
    const m = manager(b);
    const r = m.load();
    expect(r.newerVersion).toBe(true);
    expect(b.quarantined).toEqual([{ text: future, reason: `newer-v${SAVE_VERSION + 1}` }]);
  });

  it('persists migrated data after the debounce', () => {
    const b = new MemorySaveBackend();
    b.slots.set('main', JSON.stringify({ stats: { wins: 3 } }));
    const m = manager(b);
    const r = m.load();
    expect(r).toMatchObject({ source: 'main', fromVersion: 0, migrated: true });
    vi.advanceTimersByTime(100);
    expect(JSON.parse(b.read('main')!).version).toBe(SAVE_VERSION);
    // The pre-migration file is kept as the backup.
    expect(JSON.parse(b.read('backup')!)).toEqual({ stats: { wins: 3 } });
  });

  it('retries failed writes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const b = new MemorySaveBackend();
    const m = manager(b);
    m.load();
    b.failWrites = true;
    m.update((d) => (d.stats.wins = 1));
    vi.advanceTimersByTime(60);
    expect(m.dirty).toBe(true);
    expect(m.lastError).not.toBeNull();
    b.failWrites = false;
    vi.advanceTimersByTime(100);
    expect(m.dirty).toBe(false);
    expect(JSON.parse(b.read('main')!).stats.wins).toBe(1);
    warn.mockRestore();
  });

  it('survives a backend that throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const throwing = {
      kind: 'memory' as const,
      read: () => {
        throw new Error('EACCES');
      },
      write: () => {
        throw new Error('EROFS');
      },
      quarantine: () => {
        throw new Error('nope');
      },
    };
    const m = new SaveManager(throwing, { defaults, flushOnHide: false });
    expect(m.load().source).toBe('default');
    m.update((d) => (d.stats.wins = 1));
    expect(m.flush()).toBe(false);
    expect(m.lastError).toBe('EROFS');
    m.dispose();
    warn.mockRestore();
  });
});

describe('LocalStorageSaveBackend', () => {
  function fakeStorage(): StorageLike & { map: Map<string, string> } {
    const map = new Map<string, string>();
    return {
      map,
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
      removeItem: (k) => void map.delete(k),
    };
  }

  it('rotates only valid saves into the backup', () => {
    const s = fakeStorage();
    const b = new LocalStorageSaveBackend(s, 'test.save');
    expect(b.write('{"n":1}')).toBe(true);
    expect(b.write('{"n":2}')).toBe(true);
    expect(b.read('backup')).toBe('{"n":1}');
    s.map.set('test.save', 'corrupt');
    b.write('{"n":3}');
    expect(b.read('backup')).toBe('{"n":1}');
    expect(b.read('main')).toBe('{"n":3}');
    b.quarantine('corrupt', 'corrupt');
    expect(s.map.get('test.save.quarantine.corrupt')).toBe('corrupt');
  });

  it('reports quota errors instead of throwing', () => {
    const s = fakeStorage();
    s.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    const b = new LocalStorageSaveBackend(s);
    expect(b.write('{}')).toBe(false);
  });
});

describe('progress helpers', () => {
  it('applies match stats', () => {
    let s = createDefaultStats();
    s = applyMatchStats(s, { outcome: 'win', teamScore: 1700, banksRecovered: 1, safesRecovered: 4 });
    s = applyMatchStats(s, { outcome: 'draw', teamScore: 900, banksRecovered: 0, safesRecovered: 2 });
    s = applyMatchStats(s, { outcome: 'loss', teamScore: 100, banksRecovered: 0, safesRecovered: 1 });
    expect(s).toEqual({ matches: 3, wins: 1, draws: 1, losses: 1, banksRecovered: 1, safesRecovered: 7, bestScore: 1700 });
  });

  it('unlocks hats once, in catalogue order', () => {
    const c = createDefaultSaveData().cosmetics;
    expect(unlockHat(c, 'nunchiMask')).toBe(true);
    expect(unlockHat(c, 'nunchiMask')).toBe(false);
    expect(unlockHat(c, 'hodadakBand')).toBe(true);
    expect(c.unlocked).toEqual(['none', 'teamCapA', 'teamCapB', 'hodadakBand', 'nunchiMask']);
    expect(newHats(c)).toEqual(['hodadakBand', 'nunchiMask']);
  });
});
