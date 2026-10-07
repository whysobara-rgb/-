/**
 * Front-door news feed: in-world headlines in the game's voice ('front.news.h01'..'front.news.h40')
 * plus honest update notes from the bundled `public/news.json`. The calm front door does not
 * scroll a ticker any more; the feed rules stay here (tested) for any page that lists the notes.
 *
 * Offline only: the JSON is bundled at build time and never fetched. A note shows only when its
 * `requires` gate is true of this build (the caller decides: 'v2', 'layout:<id>'), so the feed
 * never announces content that is not in the game. NEW marks notes newer than the player's
 * `lastSeenVersion`. No countdowns, no "limited time".
 */
import newsData from '../../../public/news.json';
import { getLanguage, type TextRef } from '../i18n';

export interface NewsItem {
  text: TextRef;
  kind: 'headline' | 'update';
  isNew?: boolean;
}

interface NewsNote {
  id: string;
  version: string;
  requires: string | null;
  ko: string;
  en: string;
}

/** Number of in-world headlines in the string tables (front.news.h01 .. front.news.hNN). */
export const NEWS_HEADLINES = 40;

/** -1 / 0 / 1 for dotted numeric versions ('0.6.0' > '0.5.12'). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export interface NewsFeedOptions {
  /** Is this `requires` gate true of the running build? */
  available: (requires: string) => boolean;
  /** Version whose news the player already saw (null = unknown: nothing is marked NEW). */
  lastSeenVersion: string | null;
  /** First headline index (rotates the strip between sessions). */
  start: number;
  /** Headlines to show (default 12). */
  headlines?: number;
}

/** Update notes that are true of this build (newest first), then a rotating slice of headlines. */
export function buildNewsFeed(o: NewsFeedOptions): NewsItem[] {
  const notes = ((newsData as { notes?: NewsNote[] }).notes ?? []).filter((n) => n && typeof n.ko === 'string' && (n.requires === null || o.available(n.requires)));
  const lang = getLanguage();
  const items: NewsItem[] = notes.map((n) => ({
    kind: 'update',
    text: { text: lang === 'en' ? n.en : n.ko },
    isNew: o.lastSeenVersion !== null && compareVersions(n.version, o.lastSeenVersion) > 0,
  }));
  const count = Math.min(NEWS_HEADLINES, o.headlines ?? 12);
  const start = ((Math.floor(o.start) % NEWS_HEADLINES) + NEWS_HEADLINES) % NEWS_HEADLINES;
  const heads: NewsItem[] = [];
  for (let i = 0; i < count; i++) {
    const n = ((start + i * 7) % NEWS_HEADLINES) + 1; // stride 7 (coprime with 40): every headline once per cycle
    heads.push({ kind: 'headline', text: `front.news.h${String(n).padStart(2, '0')}` });
  }
  // updates first, then one more update every few headlines so they keep coming round
  const out: NewsItem[] = [...items];
  heads.forEach((hd, i) => {
    out.push(hd);
    if (items.length && i % 4 === 3) out.push(items[(i >> 2) % items.length]!);
  });
  return out;
}

/**
 * Newest version among the notes the player can actually see (game flow stores it as
 * lastSeenVersion). Notes whose gate is still closed do not count, so a note that goes live in a
 * later build is still NEW when it first shows.
 */
export function newestNewsVersion(available: (requires: string) => boolean = () => false): string | null {
  const notes = (newsData as { notes?: NewsNote[] }).notes ?? [];
  let best: string | null = null;
  for (const n of notes) {
    if (!n || typeof n.version !== 'string' || !(n.requires === null || available(n.requires))) continue;
    if (best === null || compareVersions(n.version, best) > 0) best = n.version;
  }
  return best;
}
