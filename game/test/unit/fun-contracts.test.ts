/**
 * Fun round contracts (docs/ARCHITECTURE.md "Fun round contracts"): the day-0 stubs exist with
 * their frozen shapes and are harmless until their owner packages implement them. Owners update
 * the "stub" expectations here when they land (WP5 moments, WP9 save v2).
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_MOMENT_SNAPSHOT, MOMENT_KINDS, MomentTracker } from '../../src/game/moments';
import { buildMatch, type MatchConfig } from '../../src/game/setup';
import { matchChallengeDeltas, nextChallenge } from '../../src/game/challenges';
import {
  CUP_IDS,
  FUNNEL_KEYS,
  RECENT_MAX,
  bumpFunnel,
  createDefaultProgressV2,
  grantRivalReward,
  cupProgress,
  recordMatchOutcome,
  rivalRecord,
  type MatchOutcomeSummary,
} from '../../src/platform/progress';
import { MemorySaveBackend, RIVAL_REWARD_HAT, SAVE_VERSION, SaveManager } from '../../src/platform/save';
import { BARK_KEYS } from '../../src/ai';
import { makeSim, fullLayout } from '../sim/fixtures/layouts';

describe('fun round contracts (day-0 stubs)', () => {
  it('Moment kinds are exactly the plan list', () => {
    expect([...MOMENT_KINDS].sort()).toEqual(
      [
        'leadTaken',
        'equalized',
        'matchPointOn',
        'matchPointStopped',
        'streakTier',
        'streakBroken',
        'bigPlay',
        'stealChance',
        'tauntPunished',
        'dodged',
        'counterDash',
        // Content 2.0 add-only kinds (content-plan §4.5)
        'coinSplash',
        'jackpot',
        'hammerBonk',
        'homeRun',
        'goldHammer',
        'tossScore',
        'craneDrop',
        'eventHaul',
      ].sort(),
    );
  });

  it('MomentTracker.observe is pure and returns an array (stub: empty)', () => {
    const sim = makeSim(fullLayout(), [0, 1]);
    const tr = new MomentTracker({ localTeam: 0, localCharId: 1 });
    const ev = sim.step([undefined, undefined]);
    expect(Array.isArray(tr.observe(sim.state, ev, []))).toBe(true);
    expect(tr.snapshot()).toEqual(EMPTY_MOMENT_SNAPSHOT); // stub (WP5 updates)
    tr.reset();
  });

  it('MatchConfig.botParams reaches the rival bots only (never the 2:2 teammate)', () => {
    const base: MatchConfig = { kind: 'tournament', layoutId: 'plaza', mode: '2v2', rival: 'hodadak', difficulty: 'normal', adaptation: null, seed: 7, humanHat: 'none', cup: 'novice', botParams: { dashWindupTicks: 9 } };
    const built = buildMatch(base);
    for (const b of built.bots) {
      if (b.slot === 1) expect(b.params).toBeUndefined();
      else expect(b.params).toEqual({ dashWindupTicks: 9 });
    }
    expect(buildMatch({ ...base, botParams: null }).bots.every((b) => b.params === undefined)).toBe(true);
  });

  it('grantRivalReward unlocks the rival hat (stub: no taunt until WP9)', () => {
    const save = new SaveManager(new MemorySaveBackend(), { flushOnHide: false });
    const c = structuredClone(save.data.cosmetics);
    const r = grantRivalReward(c, 'tongkeun');
    expect(r.hatNew).toBe(true);
    expect(c.unlocked).toContain(RIVAL_REWARD_HAT.tongkeun);
    expect(grantRivalReward(c, 'tongkeun').hatNew).toBe(false);
    expect(r.emoteNew).toBe(false); // stub (WP9 updates)
    save.dispose();
  });

  it('save v2 helpers never write the live v1 save before WP9', () => {
    expect(SAVE_VERSION).toBe(1);
    const backend = new MemorySaveBackend();
    const save = new SaveManager(backend, { flushOnHide: false });
    const before = JSON.stringify(save.data);
    const summary: MatchOutcomeSummary = {
      matchId: '1:0',
      layoutId: 'plaza',
      rival: 'hodadak',
      mode: 'quick',
      teamMode: '1v1',
      difficulty: 'normal',
      cup: null,
      outcome: 'win',
      myScore: 1700,
      theirScore: 1500,
      endReason: 'time',
      ticks: 14400,
      biggestHaul: 1000,
      firstRecoveryTick: 900,
      maxDeficit: 300,
      finishedAt: 0,
    };
    expect(recordMatchOutcome(summary, save)).toEqual({ newRecord: null });
    expect(rivalRecord('hodadak', 'quick.normal', save)).toEqual({ wins: 0, losses: 0, draws: 0, streak: 0, lastScore: 0, bestMargin: 0 });
    for (const cup of CUP_IDS) expect(cupProgress(cup, save)).toMatchObject({ cup, cleared: false });
    for (const k of FUNNEL_KEYS) bumpFunnel(k, save);
    expect(JSON.stringify(save.data)).toBe(before);
    save.dispose();
  });

  it('default v2 progress covers every cup, rival, layout and funnel key', () => {
    const p = createDefaultProgressV2();
    expect(Object.keys(p.cups).sort()).toEqual([...CUP_IDS].sort());
    expect(Object.keys(p.rivals).sort()).toEqual(['hodadak', 'nunchi', 'tongkeun']);
    expect(Object.keys(p.records).sort()).toEqual(['counter', 'plaza', 'shortcut']);
    expect(Object.keys(p.funnel.counts).sort()).toEqual([...FUNNEL_KEYS].sort());
    expect(p.recent.length).toBeLessThanOrEqual(RECENT_MAX);
  });

  it('challenge book stubs are neutral until WP10', () => {
    const p = createDefaultProgressV2();
    expect(nextChallenge(p.challenges)).toBeNull();
    expect(
      matchChallengeDeltas({ events: [], result: { reason: 'time', winner: null, scores: [0, 0], endTick: 0 }, humanCharId: 1, humanTeam: 0, layoutId: 'plaza', characters: [], loot: [], rules: { matchTicks: 14400, timeLimit: true } }),
    ).toEqual({});
  });

  it('bark keys are namespaced by rival', () => {
    for (const k of BARK_KEYS) expect(k).toMatch(/^(hodadak|tongkeun|nunchi)\.[a-zA-Z]+$/);
  });
});
