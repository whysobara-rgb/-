/**
 * C10 front-door news strip: update notes must be honest. A note shows only when its `requires`
 * gate is true, and the "seen" version only counts notes the player could actually see, so a
 * note that goes live later is still NEW when it first appears.
 */
import { describe, expect, it } from 'vitest';
import newsData from '../../public/news.json';
import { buildNewsFeed, compareVersions, newestNewsVersion, NEWS_HEADLINES } from '../../src/ui/components/NewsTicker';
import { ko } from '../../src/ui/strings/ko';
import { en } from '../../src/ui/strings/en';

interface Note {
  id: string;
  version: string;
  requires: string | null;
  ko: string;
  en: string;
}
const notes = (newsData as { notes: Note[] }).notes;

describe('news.json', () => {
  it('uses only gates game flow understands', () => {
    for (const n of notes) {
      const r = n.requires;
      const ok = r === null || r === 'v2' || r === 'items' || /^props:[a-zA-Z]+(,[a-zA-Z]+)*$/.test(r) || /^layout:[a-z0-9]+$/.test(r);
      expect(ok, `${n.id}: ${String(r)}`).toBe(true);
      expect(n.ko.length).toBeGreaterThan(0);
      expect(n.en.length).toBeGreaterThan(0);
    }
  });

  it('gates Content 2.0 notes on the rules matches run, the hammer on items and uprootables on placed props', () => {
    const byId = new Map(notes.map((n) => [n.id, n]));
    expect(byId.get('coins')?.requires).toBe('v2');
    expect(byId.get('hammer')?.requires).toBe('items');
    expect(byId.get('uprootables')?.requires).toBe('props:atm,piggy,moneyTree');
  });

  it('has front.news.hNN headlines in both languages', () => {
    for (let i = 1; i <= NEWS_HEADLINES; i++) {
      const k = `front.news.h${String(i).padStart(2, '0')}`;
      expect((ko as Record<string, string>)[k], k).toBeTruthy();
      expect((en as Record<string, string>)[k], k).toBeTruthy();
    }
  });
});

describe('buildNewsFeed', () => {
  it('shows only notes whose gate is open', () => {
    const closed = buildNewsFeed({ available: () => false, lastSeenVersion: '0.5.0', start: 0 });
    const ungated = notes.filter((n) => n.requires === null).length;
    expect(new Set(closed.filter((i) => i.kind === 'update').map((i) => JSON.stringify(i.text))).size).toBe(ungated);
    const open = buildNewsFeed({ available: () => true, lastSeenVersion: '0.5.0', start: 0 });
    expect(new Set(open.filter((i) => i.kind === 'update').map((i) => JSON.stringify(i.text))).size).toBe(notes.length);
  });

  it('marks nothing NEW for an unknown lastSeenVersion', () => {
    const feed = buildNewsFeed({ available: () => true, lastSeenVersion: null, start: 3 });
    expect(feed.some((i) => i.isNew)).toBe(false);
  });
});

describe('newestNewsVersion', () => {
  it('only counts notes the player can see', () => {
    const all = newestNewsVersion(() => true);
    const ungated = notes.filter((n) => n.requires === null).map((n) => n.version);
    const expected = ungated.reduce<string | null>((b, v) => (b === null || compareVersions(v, b) > 0 ? v : b), null);
    expect(newestNewsVersion(() => false)).toBe(expected);
    expect(all).not.toBeNull();
    expect(compareVersions(all!, expected ?? '0.0.0')).toBeGreaterThanOrEqual(0);
  });
});
