/**
 * Rival tournament flow (doc §12): order, best-of-3, draws replayed, adaptation only from real
 * observations, memory reset per series, lost series retries that rival only.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  STALEMATE_DRAWS,
  cloneProgress,
  isComplete,
  isSelectable,
  nextGameNumber,
  nextRival,
  recordGame,
  rivalCards,
  seriesAdaptation,
  startSeries,
} from '../../src/game/tournament';
import type { ObservationSummary } from '../../src/ai';
import type { TournamentProgress } from '../../src/platform/save';
import { sanitizeSaveData } from '../../src/platform/save';

const fresh = (): TournamentProgress => ({ beaten: [], series: null });

function summary(o: Partial<ObservationSummary> = {}): ObservationSummary {
  return {
    humanTeam: 0,
    botTeam: 1,
    layoutId: 'plaza',
    ticks: 14400,
    smallRecoveries: 0,
    smallRecoveryValue: 0,
    chokeSightings: {},
    chokeValue: {},
    bankRecoveries: 0,
    bankRecoveryValue: 0,
    thefts: 0,
    theftValue: 0,
    ...o,
  };
}

describe('tournament ladder', () => {
  it('starts with 호다닥 available and the others locked, on their fixed layouts', () => {
    const cards = rivalCards(fresh());
    expect(cards.map((c) => [c.rival, c.state, c.layoutId])).toEqual([
      ['hodadak', 'available', 'plaza'],
      ['tongkeun', 'locked', 'shortcut'],
      ['nunchi', 'locked', 'counter'],
    ]);
    expect(nextRival(fresh())).toBe('hodadak');
    expect(isSelectable(fresh(), 'tongkeun')).toBe(false);
  });

  it('a won best-of-3 beats the rival, unlocks its hat and opens the next one', () => {
    const p = fresh();
    startSeries(p, 'hodadak');
    expect(nextGameNumber(p.series!)).toBe(1);
    const r1 = recordGame(p, 'win', summary(), 0);
    expect(r1).toMatchObject({ seriesState: 'ongoing', playerWins: 1, rivalWins: 0, gameNumber: 1 });
    expect(nextGameNumber(p.series!)).toBe(2);
    const r2 = recordGame(p, 'win', summary(), 0);
    expect(r2).toMatchObject({ seriesState: 'won', newlyBeaten: true, rewardHat: 'hodadakBand', tournamentCleared: false, gameNumber: 2 });
    expect(p.beaten).toEqual(['hodadak']);
    expect(p.series).toBeNull();
    expect(rivalCards(p).map((c) => c.state)).toEqual(['cleared', 'available', 'locked']);
  });

  it('a lost series retries that rival only (beaten rivals stay beaten)', () => {
    const p: TournamentProgress = { beaten: ['hodadak'], series: null };
    startSeries(p, 'tongkeun');
    recordGame(p, 'loss', summary({ layoutId: 'shortcut' }), 0);
    const r = recordGame(p, 'loss', summary({ layoutId: 'shortcut' }), 0);
    expect(r.seriesState).toBe('lost');
    expect(p.beaten).toEqual(['hodadak']);
    expect(p.series).toBeNull();
    expect(nextRival(p)).toBe('tongkeun');
    expect(rivalCards(p)[1]!.state).toBe('available');
  });

  it('draws are replayed and never counted; three in a row log a stalemate', () => {
    const p = fresh();
    startSeries(p, 'hodadak');
    const log = vi.fn();
    let streak = 0;
    for (let i = 0; i < STALEMATE_DRAWS; i++) {
      const r = recordGame(p, 'draw', summary(), streak, log);
      streak = r.drawStreak;
      expect(r).toMatchObject({ seriesState: 'ongoing', playerWins: 0, rivalWins: 0, afterDraw: true, gameNumber: 1 });
    }
    expect(nextGameNumber(p.series!)).toBe(1);
    expect(p.series!.draws).toBe(3);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]![0])).toContain('stalemate');
    const r = recordGame(p, 'win', summary(), streak, log);
    expect(r.drawStreak).toBe(0);
  });

  it('adaptation comes only from real observations; none -> neutral (null)', () => {
    const p = fresh();
    startSeries(p, 'hodadak');
    const quiet = recordGame(p, 'win', summary(), 0);
    expect(quiet.nextAdaptation).toBeNull();
    expect(seriesAdaptation(p.series!)).toBeNull();
    const seen = recordGame(p, 'loss', summary({ bankRecoveries: 1, bankRecoveryValue: 1000 }), 0);
    expect(seen.nextAdaptation?.kind).toBe('stripBank');
    expect(seen.nextAdaptation?.lineKey).toMatch(/^adapt\.hodadak\.stripBank\.[123]$/);
    expect(seriesAdaptation(p.series!)?.kind).toBe('stripBank');
  });

  it('a new series starts with empty memory; resuming keeps the saved series', () => {
    const p = fresh();
    startSeries(p, 'hodadak');
    recordGame(p, 'win', summary({ thefts: 2, theftValue: 600 }), 0);
    expect(p.series!.adaptation?.kind).toBe('guardDoors');
    // resume: same series object, same adaptation
    expect(startSeries(p, 'hodadak').adaptation?.kind).toBe('guardDoors');
    recordGame(p, 'loss', summary(), 0);
    recordGame(p, 'loss', summary(), 0);
    const again = startSeries(p, 'hodadak');
    expect(again).toMatchObject({ wins: 0, losses: 0, draws: 0, gameIndex: 0, adaptation: null });
  });

  it('beating all three clears the tournament once; progress survives the save round-trip', () => {
    const p: TournamentProgress = { beaten: ['hodadak', 'tongkeun'], series: null };
    startSeries(p, 'nunchi');
    recordGame(p, 'win', summary({ layoutId: 'counter' }), 0);
    const r = recordGame(p, 'win', summary({ layoutId: 'counter' }), 0);
    expect(r.tournamentCleared).toBe(true);
    expect(isComplete(p)).toBe(true);
    // re-challenging a cleared rival never "clears" again
    startSeries(p, 'hodadak');
    recordGame(p, 'win', summary(), 0);
    const again = recordGame(p, 'win', summary(), 0);
    expect(again).toMatchObject({ tournamentCleared: false, newlyBeaten: false, rewardHat: null });
    const saved = sanitizeSaveData(JSON.parse(JSON.stringify({ tournament: cloneProgress(p) })));
    expect(saved.tournament.beaten).toEqual(['hodadak', 'tongkeun', 'nunchi']);
  });

  it('an in-progress series round-trips through the save with its adaptation', () => {
    const p = fresh();
    startSeries(p, 'hodadak');
    recordGame(p, 'win', summary({ chokeSightings: { 'choke.plaza.flowerRoadW': 3 }, chokeValue: { 'choke.plaza.flowerRoadW': 300 } }), 0);
    const saved = sanitizeSaveData(JSON.parse(JSON.stringify({ tournament: p })));
    expect(saved.tournament.series).toMatchObject({ rival: 'hodadak', wins: 1, losses: 0, layoutId: 'plaza' });
    expect(saved.tournament.series!.adaptation?.kind).toBe(p.series!.adaptation?.kind ?? undefined);
  });
});
