/**
 * Launch / test hooks read from the URL (docs: integration spec §9).
 *
 *   ?autotest=1          the human slot is driven by a bot (Playwright, soak tests)
 *   ?speed=N             sim runs N x faster (1..32)
 *   ?render=N            draw the 3D view every N-th frame (software GL is slow)
 *   ?layout=plaza|shortcut|counter|tutorial
 *   ?mode=1v1|2v2
 *   ?rival=hodadak|tongkeun|nunchi   ?difficulty=novice|normal|challenge
 *   ?skipIntro=1         skip title + layout preview hold
 *   ?flow=quick|tutorial|tournament   jump straight into that flow
 *   ?seed=N              base seed      ?matchSeconds=N   shorter matches (tests)
 *   ?lang=ko|en          ?fresh=1 (ignore the save: in-memory only)   ?quality=low|medium|high
 * window.__uproot is exposed only with autotest or in dev builds.
 */
import type { Difficulty, RivalId } from '../ai';
import type { LayoutId } from '../sim/types';

export interface LaunchParams {
  autotest: boolean;
  speed: number;
  renderEvery: number;
  layout: LayoutId | null;
  mode: '1v1' | '2v2' | null;
  rival: RivalId | null;
  difficulty: Difficulty | null;
  skipIntro: boolean;
  flow: 'quick' | 'tutorial' | 'tournament' | null;
  seed: number | null;
  matchSeconds: number | null;
  lang: 'ko' | 'en' | null;
  /** Test hook: render quality override for this session (not saved). */
  quality: 'low' | 'medium' | 'high' | null;
  fresh: boolean;
  /** Expose window.__uproot. */
  hooks: boolean;
}

function oneOf<T extends string>(v: string | null, opts: readonly T[]): T | null {
  return v !== null && (opts as readonly string[]).includes(v) ? (v as T) : null;
}

function num(v: string | null, lo: number, hi: number): number | null {
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
}

export function parseLaunchParams(search: string, dev: boolean): LaunchParams {
  const q = new URLSearchParams(search);
  const flag = (k: string): boolean => {
    const v = q.get(k);
    return v !== null && v !== '0' && v !== 'false';
  };
  const autotest = flag('autotest');
  return {
    autotest,
    speed: num(q.get('speed'), 0.25, 32) ?? 1,
    renderEvery: Math.round(num(q.get('render'), 1, 120) ?? 1),
    layout: oneOf(q.get('layout'), ['plaza', 'shortcut', 'counter', 'tutorial'] as const),
    mode: oneOf(q.get('mode'), ['1v1', '2v2'] as const),
    rival: oneOf(q.get('rival'), ['hodadak', 'tongkeun', 'nunchi'] as const),
    difficulty: oneOf(q.get('difficulty'), ['novice', 'normal', 'challenge'] as const),
    skipIntro: flag('skipIntro'),
    flow: oneOf(q.get('flow'), ['quick', 'tutorial', 'tournament'] as const),
    seed: num(q.get('seed'), 0, 0xffffffff),
    matchSeconds: num(q.get('matchSeconds'), 5, 240),
    lang: oneOf(q.get('lang'), ['ko', 'en'] as const),
    quality: oneOf(q.get('quality'), ['low', 'medium', 'high'] as const),
    fresh: flag('fresh'),
    hooks: autotest || dev,
  };
}
