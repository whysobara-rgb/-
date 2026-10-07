/**
 * i18n + formatting contract tests (node environment, no DOM).
 * Run: npx vitest run src/ui  (needs 'src/ui/**\/*.test.ts' in vitest include, see report).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ko } from './strings/ko';
import { en } from './strings/en';
import { configureI18n, getLanguage, hasKey, onLanguageChange, setLanguage, t, tr } from './i18n';
import { fmtClock, fmtDelta, fmtScore } from './core/format';
import { ACHIEVEMENT_IDS, ALL_HATS, RIVAL_ORDER, adaptationLineKey } from './types';

const PARAM = /\{(\w+)\}/g;
const paramsOf = (s: string): string[] => Array.from(s.matchAll(PARAM), (m) => m[1]).sort();

afterEach(() => {
  setLanguage('ko');
  configureI18n({ dev: true });
});

describe('dictionaries', () => {
  it('ko and en have exactly the same keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ko).sort());
  });

  it('every key uses the same placeholders in both languages', () => {
    for (const key of Object.keys(ko) as (keyof typeof ko)[]) {
      expect(paramsOf(en[key]), key).toEqual(paramsOf(ko[key]));
    }
  });

  it('no empty strings', () => {
    for (const [k, v] of [...Object.entries(ko), ...Object.entries(en)]) expect(v.trim().length, k).toBeGreaterThan(0);
  });

  it('no Korean particle glued directly to a placeholder (names vary in 받침)', () => {
    const glued = /\}(은|는|이|가|을|를|와|과|로|으로)(?=[\s.,!?…~]|$)/;
    for (const [k, v] of Object.entries(ko)) expect(glued.test(v), `${k}: ${v}`).toBe(false);
  });

  it('covers the required families', () => {
    for (const id of ACHIEVEMENT_IDS) {
      expect(hasKey(`ach.${id}.name`), id).toBe(true);
      expect(hasKey(`ach.${id}.desc`), id).toBe(true);
    }
    for (const hat of ALL_HATS) for (const f of ['name', 'desc', 'unlock']) expect(hasKey(`hat.${hat}.${f}`), `${hat}.${f}`).toBe(true);
    for (const r of RIVAL_ORDER) {
      for (const f of ['name', 'title', 'personality', 'weakness', 'intro']) expect(hasKey(`rival.${r}.${f}`), `${r}.${f}`).toBe(true);
      for (const kind of ['ambushChoke', 'stripBank', 'guardDoors'] as const) {
        for (const v of [1, 2, 3] as const) expect(hasKey(adaptationLineKey(r, kind, v)), `${r}.${kind}.${v}`).toBe(true);
        expect(ko[adaptationLineKey(r, kind, 1) as keyof typeof ko]).toBeTruthy();
      }
    }
    for (const c of ['siren', 'unanchorBank', 'fenceBreak', 'scoreBank', 'dashHit', 'unanchorSafe', 'whistleStart', 'hornEnd']) {
      expect(hasKey(`caption.${c}`), c).toBe(true);
    }
    for (const d of ['novice', 'normal', 'challenge']) expect(hasKey(`difficulty.${d}`)).toBe(true);
  });

  it('practice fence beat tells the player to push the bank from behind (ARCHITECTURE.md)', () => {
    expect(ko['tutorial.fence']).toContain('은행 뒤에서 밀어요');
    expect(en['tutorial.fence'].toLowerCase()).toContain('from behind');
  });

  it('English follows the ART_DIRECTION glossary (확정 = Banked, 큰 금고 = Big safe)', () => {
    expect(en['hud.confirmed']).toBe('Banked');
    expect(en['loot.largeSafe.name']).toBe('Big safe');
    expect(en['loot.smallSafe.name']).toBe('Small safe');
    for (const [k, v] of Object.entries(en)) {
      expect(/\bsecured?\b/i.test(v), `${k}: ${v}`).toBe(false);
      expect(/\blarge safe/i.test(v), `${k}: ${v}`).toBe(false);
    }
  });

  it('ambushChoke lines all take the {choke} param', () => {
    for (const r of RIVAL_ORDER) for (const v of [1, 2, 3] as const) {
      expect(ko[adaptationLineKey(r, 'ambushChoke', v) as keyof typeof ko]).toContain('{choke}');
    }
  });
});

describe('t()', () => {
  it('substitutes params and groups numbers', () => {
    expect(t('banner.escape', { sec: 30 })).toBe('30초 뒤 출발!');
    expect(t('event.bankWhole', { building: 500, safes: 500, total: 1000 })).toBe('은행째 회수! 건물 500 + 금고 500 = +1,000');
    expect(t('event.lastSecondsSmall', { sec: 12 })).toBe('마지막 12초에 작은 금고 회수');
    expect(t('event.largePulled', { value: 300 })).toBe('은행에서 큰 금고 300점이 빠짐');
    expect(t('hud.estimate', { value: 1000 })).toBe('예상 1,000');
    expect(t('caption.siren')).toBe('[사이렌]');
    expect(t('caption.unanchorBank')).toBe('[기초가 끊기는 소리]');
    expect(t('team.star')).toBe('별 팀');
  });

  it('resolves params that are themselves keys', () => {
    expect(t('adapt.nunchi.ambushChoke.2', { choke: 'loot.bank.name' })).toContain('은행');
    expect(t('adapt.nunchi.ambushChoke.2', { choke: '북쪽 골목' })).toContain('북쪽 골목');
  });

  it('switches language and notifies listeners', () => {
    const seen: string[] = [];
    const off = onLanguageChange((l) => seen.push(l));
    setLanguage('en');
    expect(getLanguage()).toBe('en');
    expect(t('team.moon')).toBe('Moon Crew');
    expect(t('hud.estimate', { value: 1000 })).toBe('Est. 1,000');
    setLanguage('en'); // no-op
    off();
    setLanguage('ko');
    expect(seen).toEqual(['en']);
  });

  it('missing keys: visible marker + one warning in dev, key text in prod', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    configureI18n({ dev: true });
    expect(t('no.such.key')).toBe('⟦no.such.key⟧');
    t('no.such.key');
    expect(warn).toHaveBeenCalledTimes(1);
    configureI18n({ dev: false });
    expect(t('no.such.key2')).toBe('no.such.key2');
    warn.mockRestore();
  });

  it('tr() handles keys, key+params and literal text', () => {
    expect(tr('common.back')).toBe('뒤로');
    expect(tr({ key: 'series.game', params: { n: 2 } })).toBe('2번째 판');
    expect(tr({ text: 'Player<1>' })).toBe('Player<1>');
    expect(tr(null)).toBe('');
  });
});

describe('format', () => {
  it('fmtClock never shows 0:00 before time is really up', () => {
    expect(fmtClock(240)).toBe('4:00');
    expect(fmtClock(59.5)).toBe('1:00');
    expect(fmtClock(30)).toBe('0:30');
    expect(fmtClock(0.2)).toBe('0:01');
    expect(fmtClock(0)).toBe('0:00');
    expect(fmtClock(-3)).toBe('0:00');
  });

  it('scores', () => {
    expect(fmtScore(3200)).toBe('3,200');
    expect(fmtDelta(300)).toBe('+300');
  });

  it('never renders NaN / Infinity garbage', () => {
    expect(fmtClock(NaN)).toBe('–:––');
    expect(fmtClock(Infinity)).toBe('∞');
    expect(fmtClock(-Infinity)).toBe('0:00');
    expect(fmtClock(1e9)).toBe('99:59');
    expect(fmtScore(NaN)).toBe('–');
    expect(fmtScore(Infinity)).toBe('–');
    expect(fmtDelta(NaN)).toBe('–');
    expect(t('hud.estimate', { value: NaN })).toBe('예상 –');
  });
});
