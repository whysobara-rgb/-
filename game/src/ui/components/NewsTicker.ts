/**
 * Front-door news strip: an LED ticker of in-world headlines in the game's voice
 * ('news.h01'..'news.h40') plus honest update notes from the bundled `public/news.json`.
 *
 * Offline only: the JSON is bundled at build time and never fetched. A note shows only when its
 * `requires` gate is true of this build (the caller decides: 'v2', 'layout:<id>'), so the strip
 * never announces content that is not in the game. NEW marks notes newer than the player's
 * `lastSeenVersion`. No timers, no countdowns, no "limited time": the strip just scrolls (and
 * stands still with reduced motion).
 */
import newsData from '../../../public/news.json';
import { getLanguage, t, tr, type TextRef } from '../i18n';
import { h, svgFromMarkup } from '../core/dom';
import { icon } from '../core/icons';

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

/** Number of in-world headlines in the string tables (news.h01 .. news.hNN). */
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
    heads.push({ kind: 'headline', text: `news.h${String(n).padStart(2, '0')}` });
  }
  // updates first, then one more update every few headlines so they keep coming round
  const out: NewsItem[] = [...items];
  heads.forEach((hd, i) => {
    out.push(hd);
    if (items.length && i % 4 === 3) out.push(items[(i >> 2) % items.length]!);
  });
  return out;
}

/** Newest note version in the bundled feed (game flow stores it as lastSeenVersion). */
export function newestNewsVersion(): string | null {
  const notes = (newsData as { notes?: NewsNote[] }).notes ?? [];
  let best: string | null = null;
  for (const n of notes) if (typeof n.version === 'string' && (best === null || compareVersions(n.version, best) > 0)) best = n.version;
  return best;
}

const PAW = '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><ellipse cx="12" cy="15.5" rx="5" ry="4.3"/><ellipse cx="5.6" cy="9.6" rx="2" ry="2.5"/><ellipse cx="9.6" cy="6" rx="2" ry="2.5"/><ellipse cx="14.4" cy="6" rx="2" ry="2.5"/><ellipse cx="18.4" cy="9.6" rx="2" ry="2.5"/></g></svg>';

export interface NewsTicker {
  el: HTMLElement;
  /** Size the scroll speed to the content (call once mounted; returns a cleanup). */
  start(): () => void;
}

/** The LED strip. Content is doubled so the CSS scroll loops seamlessly (-50 %). */
export function newsTicker(items: readonly NewsItem[], label: TextRef = 'front.news.label'): NewsTicker {
  const one = (): HTMLElement[] =>
    items.map((it) =>
      h(
        'span',
        { class: ['uh-news__item', `uh-news__item--${it.kind}`] },
        svgFromMarkup(PAW, 'uh-news__sep'),
        it.isNew ? h('span', { class: 'uh-news__new' }, t('common.new')) : null,
        tr(it.text),
      ),
    );
  const track = h('div', { class: 'uh-news__track' }, one(), h('span', { 'aria-hidden': 'true', style: { display: 'contents' } }, one()));
  const el = h(
    'aside',
    { class: 'uh-news', 'aria-label': tr(label) },
    h('div', { class: 'uh-news__label' }, icon('megaphone'), tr(label)),
    h('div', { class: 'uh-news__viewport' }, track),
  );
  return {
    el,
    start: () => {
      let raf = requestAnimationFrame(() => {
        raf = 0;
        // ~70 px/s at 1080p (scaled with the UI rem) whatever the content length
        const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
        const half = track.scrollWidth / 2;
        const secs = Math.max(20, half / (rem * 4.4));
        track.style.setProperty('--news-dur', `${secs.toFixed(1)}s`);
      });
      return () => {
        if (raf) cancelAnimationFrame(raf);
      };
    },
  };
}
