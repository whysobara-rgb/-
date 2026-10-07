/**
 * Rival tournament (doc §12 라이벌 대회, §11 라이벌전의 다음 판).
 *
 * 호다닥 (수집 광장) -> 통큰이 (지름길 상가) -> 눈치왕 (열린 창구); each a best-of-3 1:1 series on
 * that rival's fixed layout.
 *  - Draws are replayed and never counted; three draws in a row log a stalemate warning
 *    (doc §12: 무승부가 반복되면 교착 결함으로 검토).
 *  - Between games the bot strengthens ONE counter chosen from what it really observed in the
 *    previous game (RivalObserver.summary() -> chooseAdaptation); no observation -> no
 *    adaptation and the neutral line. A new series starts with empty memory.
 *  - Progress (beaten rivals + the series in progress, adaptation included) is written after
 *    every game. Losing a series only retries that rival; beating one unlocks its hat.
 * Pure logic over the save's TournamentProgress: the caller persists `progress` after
 * each mutation (see TournamentFlow.onChange).
 */
import { RIVALS, chooseAdaptation, type Adaptation, type ObservationSummary, type RivalId } from '../ai';
import { getLayout } from '../sim/layouts';
import type { HatId, LayoutId } from '../sim/types';
import type { SeriesProgress, TournamentProgress } from '../platform/save';

export const TOURNAMENT_ORDER: readonly RivalId[] = ['hodadak', 'tongkeun', 'nunchi'];
export const WINS_NEEDED = 2;
export const STALEMATE_DRAWS = 3;

export type CardState = 'locked' | 'available' | 'inProgress' | 'cleared';

export interface RivalCardInfo {
  rival: RivalId;
  state: CardState;
  playerWins: number;
  rivalWins: number;
  layoutId: LayoutId;
  layoutNameKey: string;
  rewardHat: HatId;
}

export type GameOutcome = 'win' | 'loss' | 'draw';

export interface GameRecord {
  rival: RivalId;
  /** 1-based number of the game just played (draws replay the same number). */
  gameNumber: number;
  outcome: GameOutcome;
  playerWins: number;
  rivalWins: number;
  seriesState: 'ongoing' | 'won' | 'lost';
  /** Rival beaten for the first time with this game. */
  newlyBeaten: boolean;
  /** Hat unlocked by this game (first win of the series against this rival). */
  rewardHat: HatId | null;
  /** All three rivals beaten (first time). */
  tournamentCleared: boolean;
  /** Adaptation chosen for the next game (ongoing series only). */
  nextAdaptation: Adaptation | null;
  /** The previous game was a draw. */
  afterDraw: boolean;
  /** Consecutive draws in this series so far. */
  drawStreak: number;
}

export function cloneProgress(p: Readonly<TournamentProgress>): TournamentProgress {
  return {
    beaten: [...p.beaten],
    series: p.series ? { ...p.series, adaptation: p.series.adaptation ? { ...p.series.adaptation, lineParams: p.series.adaptation.lineParams ? { ...p.series.adaptation.lineParams } : undefined } : null } : null,
  };
}

/** Layout of a rival's series (fixed for the whole series). */
export function seriesLayout(rival: RivalId): LayoutId {
  return RIVALS[rival].preferredLayout;
}

/** The next rival to beat (first not beaten in order), or null when all are beaten. */
export function nextRival(p: Readonly<TournamentProgress>): RivalId | null {
  return TOURNAMENT_ORDER.find((r) => !p.beaten.includes(r)) ?? null;
}

export function isComplete(p: Readonly<TournamentProgress>): boolean {
  return TOURNAMENT_ORDER.every((r) => p.beaten.includes(r));
}

/** Whether a rival can be challenged: beaten ones (re-challenge) and the next one. */
export function isSelectable(p: Readonly<TournamentProgress>, rival: RivalId): boolean {
  return p.beaten.includes(rival) || nextRival(p) === rival;
}

export function rivalCards(p: Readonly<TournamentProgress>): RivalCardInfo[] {
  const next = nextRival(p);
  return TOURNAMENT_ORDER.map((rival) => {
    const s = p.series && p.series.rival === rival ? p.series : null;
    let state: CardState;
    if (s) state = 'inProgress';
    else if (p.beaten.includes(rival)) state = 'cleared';
    else if (rival === next) state = 'available';
    else state = 'locked';
    const layoutId = (s?.layoutId as LayoutId | null | undefined) ?? seriesLayout(rival);
    return {
      rival,
      state,
      playerWins: s ? s.wins : p.beaten.includes(rival) ? WINS_NEEDED : 0,
      rivalWins: s ? s.losses : 0,
      layoutId,
      layoutNameKey: getLayout(layoutId).nameKey,
      rewardHat: RIVALS[rival].rewardHat,
    };
  });
}

/**
 * Start (or resume) the series against `rival`. A series in progress against another rival is
 * abandoned (the player chose a different card); memory always starts empty for a new series.
 */
export function startSeries(p: TournamentProgress, rival: RivalId): SeriesProgress {
  if (p.series && p.series.rival === rival) return p.series;
  const s: SeriesProgress = { rival, wins: 0, losses: 0, draws: 0, gameIndex: 0, layoutId: seriesLayout(rival), adaptation: null };
  p.series = s;
  return s;
}

/** 1-based number of the next game of the series (draws replay the same number). */
export function nextGameNumber(s: Readonly<SeriesProgress>): number {
  return s.wins + s.losses + 1;
}

/** The adaptation the rival plays the next game with (null = none). */
export function seriesAdaptation(s: Readonly<SeriesProgress>): Adaptation | null {
  const a = s.adaptation;
  if (!a) return null;
  return { kind: a.kind, chokepointId: a.chokepointId, lineKey: a.lineKey, lineParams: a.lineParams ? { ...a.lineParams } : undefined };
}

/**
 * Record a finished game of the current series. `summary` is the RivalObserver summary of THAT
 * game (only real observations); the adaptation for the next game is chosen from it.
 * `drawStreak` is the number of consecutive draws before this game (runtime only).
 */
export function recordGame(
  p: TournamentProgress,
  outcome: GameOutcome,
  summary: ObservationSummary | null,
  drawStreak: number,
  log: (msg: string) => void = (m) => console.warn(m),
): GameRecord {
  const s = p.series;
  if (!s) throw new Error('recordGame: no series in progress');
  const rival = s.rival;
  const gameNumber = nextGameNumber(s);
  if (outcome === 'win') s.wins++;
  else if (outcome === 'loss') s.losses++;
  else s.draws++;
  s.gameIndex++;
  const streak = outcome === 'draw' ? drawStreak + 1 : 0;
  if (streak >= STALEMATE_DRAWS) {
    log(`[tournament] stalemate: ${streak} draws in a row vs ${rival} on ${s.layoutId ?? seriesLayout(rival)} (doc §12: 교착 결함으로 검토)`);
  }
  let seriesState: GameRecord['seriesState'] = 'ongoing';
  let newlyBeaten = false;
  let rewardHat: HatId | null = null;
  let tournamentCleared = false;
  let nextAdaptation: Adaptation | null = null;
  const playerWins = s.wins;
  const rivalWins = s.losses;
  if (s.wins >= WINS_NEEDED) {
    seriesState = 'won';
    const wasComplete = isComplete(p);
    if (!p.beaten.includes(rival)) {
      p.beaten = TOURNAMENT_ORDER.filter((r) => r === rival || p.beaten.includes(r));
      newlyBeaten = true;
      rewardHat = RIVALS[rival].rewardHat;
    }
    tournamentCleared = !wasComplete && isComplete(p);
    p.series = null;
  } else if (s.losses >= WINS_NEEDED) {
    seriesState = 'lost';
    p.series = null;
  } else {
    // doc §11: one counter from what was actually observed in the game just played.
    const layout = getLayout(s.layoutId ?? seriesLayout(rival));
    nextAdaptation = summary ? chooseAdaptation(summary, layout, rival) : null;
    s.adaptation = nextAdaptation
      ? { kind: nextAdaptation.kind, chokepointId: nextAdaptation.chokepointId, lineKey: nextAdaptation.lineKey, lineParams: nextAdaptation.lineParams ? { ...nextAdaptation.lineParams } : undefined }
      : null;
  }
  return {
    rival,
    gameNumber,
    outcome,
    playerWins,
    rivalWins,
    seriesState,
    newlyBeaten,
    rewardHat,
    tournamentCleared,
    nextAdaptation,
    afterDraw: outcome === 'draw',
    drawStreak: streak,
  };
}
