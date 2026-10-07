/**
 * [F4] Tension HUD logic (src/ui/hud/tension.ts): decisive-load prompt (never "win" wording for a
 * 'tie' load, against the conservation invariant), swing readout visibility / modes, moment ->
 * stamp mapping (merges, "involved" filter, cap), the banner priority queue, and recorded bot
 * matches: every stamp corresponds to a real happening on that tick (no stamp for an event that
 * did not happen) and the prompt agrees with the sim's own end check.
 */
import { describe, expect, it } from 'vitest';
import { runMatch } from '../../src/ai/harness';
import { MomentTracker, type Moment } from '../../src/game/moments';
import { matchPointInfo, type MatchPointInfo } from '../../src/sim/queries';
import type { SimState, TeamId } from '../../src/sim/types';
import { en } from '../../src/ui/strings/en';
import { ko } from '../../src/ui/strings/ko';
import {
  BANNER_MAX_WAIT_MS,
  BannerQueue,
  CLIMAX_PLATE_MS,
  MOMENT_STAMP_COOLDOWN_TICKS,
  MOMENT_STAMP_LOOK,
  MomentStamper,
  LOOSE_HOLD_TICKS,
  PromptLatch,
  PROMPT_SEEN_TICKS,
  STOP_AFTER_PROMPT_TICKS,
  stampEviction,
  hudMatchPoint,
  hudSwing,
  matchPointText,
  momentStamps,
  type HudMatchPoint,
} from '../../src/ui/hud/tension';

const mp = (o: Partial<MatchPointInfo>): MatchPointInfo => ({ team: 0, kind: 'win', value: 300, lootIds: [10], carrierIds: [1], ...o });
const st = (o: Partial<SimState> = {}): SimState =>
  ({
    loot: [{ id: 10, kind: 'largeSafe', baseValue: 300, recovered: false }],
    characters: [
      { id: 1, team: 0, bag: 0 },
      { id: 2, team: 1, bag: 120 },
    ],
    scores: [0, 0],
    remainingValue: 3200,
    totalValue: 3200,
    banksRecovered: 0,
    over: false,
    coins: [],
    breakables: [],
    matchEvents: [],
    ...o,
  }) as unknown as SimState;

describe('decisive-load prompt', () => {
  it('ours / theirs, win / tie; a tie never uses the "it is over" (win) wording', () => {
    const s = st();
    const a = hudMatchPoint(mp({}), s, 0)!;
    expect(a).toEqual({ side: 'ours', kind: 'win', value: 300, what: 'largeSafe', bag: 0 });
    expect(matchPointText(a)).toEqual({ title: 'hud.mp.ours', sub: 'hud.mp.sub' });
    const b = hudMatchPoint(mp({ team: 1, kind: 'tie' }), s, 0)!;
    expect(b.side).toBe('theirs');
    expect(matchPointText(b).title).toBe('hud.mp.theirsTie');
    const c = hudMatchPoint(mp({ kind: 'tie' }), s, 0)!;
    expect(matchPointText(c).title).toBe('hud.mp.oursTie');
    for (const lang of [ko, en] as Record<string, string>[]) {
      // the tie wording says draw; the win wording is only ever used for kind 'win'
      expect(lang['hud.mp.oursTie']).toMatch(/무승부|draw/);
      expect(lang['hud.mp.theirsTie']).toMatch(/무승부|draw/);
    }
    expect(hudMatchPoint(null, s, 0)).toBeNull();
  });

  it('a bag load reads as the bag (no loot ids), a carried load with bags notes the bag part', () => {
    const s = st();
    const bag = hudMatchPoint(mp({ team: 1, value: 120, lootIds: [], carrierIds: [2], bagCharIds: [2] }), s, 1)!;
    expect(bag).toEqual({ side: 'ours', kind: 'win', value: 120, what: 'bag', bag: 120 });
    expect(matchPointText(bag).sub).toBe('hud.mp.subBag');
    const both = hudMatchPoint(mp({ team: 1, value: 420, lootIds: [10], carrierIds: [2], bagCharIds: [2] }), s, 0)!;
    expect(both).toMatchObject({ side: 'theirs', what: 'largeSafe', bag: 120, value: 420 });
    expect(matchPointText(both).sub).toBe('hud.mp.subWithBag');
  });

  it('on real states, kind tie <=> the load is the last value and leaves the score level (3200 invariant)', () => {
    let ties = 0;
    let wins = 0;
    runMatch({
      layout: 'counter',
      seed: 3,
      team0: [{ personality: 'hodadak', difficulty: 'normal', humanProxy: true }],
      team1: [{ personality: 'nunchi', difficulty: 'normal' }],
      rules: { police: true },
      onTick: (sim) => {
        const s = sim.state;
        expect(s.scores[0] + s.scores[1] + s.remainingValue).toBe(s.totalValue);
        const info = matchPointInfo(s);
        const p = hudMatchPoint(info, s, 0);
        if (!info || !p) return;
        const after: [number, number] = [s.scores[0], s.scores[1]];
        after[info.team] += info.value;
        if (p.kind === 'tie') {
          ties++;
          expect(s.remainingValue - info.value).toBe(0);
          expect(after[0]).toBe(after[1]);
          expect(matchPointText(p).title).not.toMatch(/^hud\.mp\.(ours|theirs)$/);
        } else {
          wins++;
          expect(after[info.team]).toBeGreaterThan(after[info.team === 0 ? 1 : 0]);
        }
      },
    });
    expect(ties + wins).toBeGreaterThan(0);
  });
});

describe('prompt latch (a dropped decisive load keeps its prompt)', () => {
  const loose = (o: Record<string, unknown> = {}) => ({ id: 10, kind: 'largeSafe', baseValue: 300, estimatedValue: 300, recovered: false, anchored: false, loadedIn: null, grabbedBy: [], recovery: null, ...o });
  const at = (tick: number, o: Partial<SimState> = {}, l: Record<string, unknown> = {}): SimState =>
    st({ tick, scores: [1500, 1400], remainingValue: 300, loot: [loose(l)] as unknown as SimState['loot'], ...o });
  const info = mp({ team: 0, kind: 'win', value: 300, lootIds: [10], carrierIds: [1] });

  it('holds the last loot load while it lies loose, for at most LOOSE_HOLD_TICKS', () => {
    const p = new PromptLatch();
    expect(p.update(info, at(100, {}, { grabbedBy: [1] }))).toBe(info);
    expect(p.update(null, at(101))).toMatchObject({ team: 0, kind: 'win', value: 300, lootIds: [10], carrierIds: [] });
    expect(p.update(null, at(100 + LOOSE_HOLD_TICKS))).not.toBeNull();
    expect(p.update(null, at(101 + LOOSE_HOLD_TICKS))).toBeNull();
    // and once dropped it stays dropped
    expect(p.update(null, at(102 + LOOSE_HOLD_TICKS))).toBeNull();
  });

  it('lets go as soon as anything changes the arithmetic or the other team takes over', () => {
    const cases: [string, SimState][] = [
      ['opponent grabs it', at(110, {}, { grabbedBy: [2] })],
      ['opponent zone recovery', at(110, {}, { recovery: { team: 1, ticks: 3 } })],
      ['a score changed', at(110, { scores: [1500, 1500], remainingValue: 200 })],
      ['load value changed', at(110, {}, { estimatedValue: 200 })],
      ['recovered', at(110, {}, { recovered: true })],
      ['anchored again', at(110, {}, { anchored: true })],
      ['loaded into a bank', at(110, {}, { loadedIn: 7 })],
      ['match over', at(110, { over: true })],
    ];
    for (const [why, s] of cases) {
      const p = new PromptLatch();
      p.update(info, at(100, {}, { grabbedBy: [1] }));
      expect(p.update(null, s), why).toBeNull();
    }
    // a coin-bag load is never held (a bag that stops counting has spilled)
    const p = new PromptLatch();
    p.update(mp({ lootIds: [10], bagCharIds: [1] }), at(100));
    expect(p.update(null, at(101))).toBeNull();
    const q = new PromptLatch();
    q.update(mp({ lootIds: [], carrierIds: [2], bagCharIds: [2], team: 1 }), at(100));
    expect(q.update(null, at(101))).toBeNull();
  });

  it('on a real match the prompt (held, uprooting or carried) is always true: that team scoring the load ends it', () => {
    let held = 0;
    let uprooting = 0;
    // play matches until both a held and an uprooting prompt were checked (bots change; at most 8)
    let played = 0;
    for (const [layout, seed] of [
      ['plaza', 83433],
      ['counter', 5],
      ['plaza', 146785],
      ['counter', 4243],
      ['shortcut', 123028],
      ['counter', 67595],
      ['plaza', 43838],
      ['shortcut', 3017],
    ] as const) {
      if (played >= 2 && held > 0 && uprooting > 0) break;
      played++;
      const p = new PromptLatch();
      runMatch({
        layout,
        seed,
        team0: [{ personality: 'hodadak', difficulty: 'normal', humanProxy: true }],
        team1: [{ personality: 'hodadak', difficulty: 'normal' }],
        rules: { police: true },
        onTick: (sim) => {
          const s = sim.state;
          const raw = matchPointInfo(s, { uprooting: true });
          const shown = p.update(raw, s);
          if (!shown) return;
          if (!raw) held++;
          if (shown.uprooting) uprooting++;
          const l = s.loot.find((x) => x.id === shown.lootIds[0])!;
          expect(l.recovered).toBe(false);
          expect(l.estimatedValue).toBe(shown.value);
          const after: [number, number] = [s.scores[0], s.scores[1]];
          after[shown.team] += l.estimatedValue;
          const rem = s.remainingValue - l.estimatedValue;
          const other = shown.team === 0 ? 1 : 0;
          if (shown.kind === 'tie') expect(rem === 0 && after[0] === after[1]).toBe(true);
          else expect(rem <= 0 ? after[shown.team] > after[other] : after[shown.team] > after[other] + rem).toBe(true);
        },
      });
    }
    expect(held).toBeGreaterThan(0);
    expect(uprooting).toBeGreaterThan(0);
  });
});

describe('swing readout', () => {
  it('hidden early; after the first bank (or <= 31.25 % left) shows behind / level / ahead', () => {
    expect(hudSwing(st({ scores: [300, 0], remainingValue: 2900 }), 0)).toBeNull();
    const noBags = [
      { id: 1, team: 0, bag: 0 },
      { id: 2, team: 1, bag: 0 },
    ] as SimState['characters'];
    expect(hudSwing(st({ scores: [1100, 1200], remainingValue: 900, characters: noBags, loot: [{ id: 3, kind: 'largeSafe', baseValue: 300, recovered: false }, { id: 4, kind: 'smallSafe', baseValue: 100, recovered: false }] as SimState['loot'] }), 0)).toEqual({ mode: 'behind', n: 200, remaining: 900 });
    const lv = hudSwing(st({ scores: [1000, 1000], remainingValue: 1200, banksRecovered: 1, characters: noBags, loot: [{ id: 1, kind: 'bank', baseValue: 500, recovered: false }, { id: 2, kind: 'smallSafe', baseValue: 100, recovered: false }] as SimState['loot'] }), 1)!;
    expect(lv).toEqual({ mode: 'level', n: 100, remaining: 1200 });
    expect(hudSwing(st({ scores: [1600, 1000], remainingValue: 600, banksRecovered: 1 }), 0)).toEqual({ mode: 'ahead', n: 600, remaining: 600 });
    expect(hudSwing(st({ scores: [1600, 1000], remainingValue: 600, banksRecovered: 1, over: true }), 0)).toBeNull();
  });

  it('counts coins: a bag on the field makes the step 10', () => {
    const s = st({ scores: [1230, 1200], remainingValue: 770, banksRecovered: 1, loot: [{ id: 10, kind: 'largeSafe', baseValue: 300, recovered: false }] as SimState['loot'] });
    s.characters[1]!.bag = 470;
    expect(hudSwing(s, 1)).toEqual({ mode: 'behind', n: 40, remaining: 770 });
  });
});

describe('moment stamps', () => {
  const ctx = { myTeam: 0 as TeamId, meId: 1 };
  const teamOf = (id: number): TeamId | undefined => (id === 1 ? 0 : id === 2 ? 1 : undefined);
  const m = (kind: Moment['kind'], team: TeamId, extra: Partial<Moment> = {}): Moment => ({ kind, tick: 10, team, ...extra });

  it('maps each kind to its text, with the acting team and ours / theirs wording', () => {
    expect(momentStamps([m('leadTaken', 1, { value: 300 })], ctx)).toMatchObject([{ kind: 'leadTaken', team: 1, key: 'hud.moment.leadTaken' }]);
    // matchPointStopped.team = whose match point was stopped -> the stopper is the other team
    expect(momentStamps([m('matchPointStopped', 1)], ctx)).toMatchObject([{ kind: 'mpStopped', team: 0, key: 'hud.moment.mpStopped' }]);
    expect(momentStamps([m('matchPointStopped', 0)], ctx)).toMatchObject([{ kind: 'mpStopped', team: 1, key: 'hud.moment.mpStoppedTheirs' }]);
    expect(momentStamps([m('streakTier', 0, { value: 1000, tier: 2 })], ctx)).toMatchObject([{ kind: 'streak', params: { value: 1000 }, sub: 'hud.moment.sub.streak2' }]);
    expect(momentStamps([m('streakBroken', 0)], ctx)).toMatchObject([{ kind: 'streakBroken', team: 1, key: 'hud.moment.streakBrokenTheirs' }]);
    expect(momentStamps([m('jackpot', 1, { value: 300, ids: [2] })], ctx)).toMatchObject([{ kind: 'jackpot', team: 1, params: { value: 300 } }]);
    // never stamped: the prompt / marker / camera carry these
    expect(momentStamps([m('matchPointOn', 0), m('stealChance', 0), m('bigPlay', 0, { score: 7 })], ctx)).toEqual([]);
  });

  it('"역전!" on a bank recovery carries the "은행째!" sub-line and folds the run it broke', () => {
    const out = momentStamps([m('leadTaken', 0, { lootKind: 'bank', value: 1000 }), m('streakBroken', 1, { value: 800 })], ctx);
    expect(out).toEqual([{ kind: 'leadTaken', team: 0, key: 'hud.moment.leadTaken', params: { value: 1000 }, sub: 'hud.moment.sub.bankWhole', priority: 10 }]);
  });

  it('"involved" stamps need the local team as actor or victim; at most 2 per tick by priority', () => {
    expect(momentStamps([m('hammerBonk', 1, { ids: [2, 3] })], ctx, teamOf)).toEqual([]); // victim 3: not ours
    expect(momentStamps([m('hammerBonk', 1, { ids: [2, 1] })], ctx, teamOf)).toMatchObject([{ key: 'hud.moment.hammerBonkTheirs', team: 1 }]);
    expect(momentStamps([m('coinSplash', 0, { ids: [1, 2], value: 80 })], ctx, teamOf)).toMatchObject([{ key: 'hud.moment.coinSplash', params: { value: 80 } }]);
    const many = momentStamps([m('dodged', 0), m('counterDash', 0), m('equalized', 1), m('goldHammer', 1)], ctx, teamOf);
    expect(many.map((x) => x.kind)).toEqual(['equalized', 'goldHammer']);
  });

  it('MomentStamper: a tug-of-war over one load stamps "막았다!" once per cooldown window', () => {
    const sp = new MomentStamper(ctx);
    const cd = MOMENT_STAMP_COOLDOWN_TICKS.mpStopped!;
    // both teams' match points were prompted (the stop gate is its own test below)
    const prompt = (team: TeamId, at: number): void => {
      for (let i = 0; i < PROMPT_SEEN_TICKS; i++) sp.notePrompt(team, at - PROMPT_SEEN_TICKS + 1 + i);
    };
    prompt(1, 99);
    prompt(0, 199);
    expect(sp.next([m('matchPointStopped', 1)], 100)).toHaveLength(1);
    prompt(1, 100 + cd - 2);
    expect(sp.next([m('matchPointStopped', 1)], 100 + cd - 1)).toHaveLength(0);
    // the other team's stop is its own window
    expect(sp.next([m('matchPointStopped', 0)], 200)).toHaveLength(1);
    expect(sp.next([m('matchPointStopped', 1)], 100 + cd)).toHaveLength(1);
    // a golden hammer re-picked by the same team is silent; the other team taking it is news
    expect(sp.next([m('goldHammer', 0)], 400)).toHaveLength(1);
    expect(sp.next([m('goldHammer', 0)], 500)).toHaveLength(0);
    expect(sp.next([m('goldHammer', 1)], 510)).toHaveLength(1);
    // lead changes never cool down
    expect(sp.next([m('leadTaken', 0)], 300)).toHaveLength(1);
    expect(sp.next([m('leadTaken', 1)], 301)).toHaveLength(1);
    sp.reset();
    prompt(1, 301);
    expect(sp.next([m('matchPointStopped', 1)], 302)).toHaveLength(1);
  });

  it('MomentStamper: "막았다!" / "막혔다!" only for a match point the prompt showed', () => {
    const sp = new MomentStamper(ctx);
    // never prompted (the tracker followed team 1's own load behind a bigger team-0 prompt)
    for (let t = 0; t < 100; t++) sp.notePrompt(0, t);
    expect(sp.next([m('matchPointStopped', 1)], 200)).toEqual([]);
    // a flicker shorter than PROMPT_SEEN_TICKS does not count as shown
    for (let t = 300; t < 300 + PROMPT_SEEN_TICKS - 1; t++) sp.notePrompt(1, t);
    sp.notePrompt(null, 300 + PROMPT_SEEN_TICKS);
    expect(sp.next([m('matchPointStopped', 1)], 400)).toEqual([]);
    // shown long enough, stop confirmed within the window -> stamped (other moments unaffected)
    for (let t = 500; t < 560; t++) sp.notePrompt(1, t);
    for (let t = 560; t < 680; t++) sp.notePrompt(null, t);
    expect(sp.next([m('matchPointStopped', 1), m('equalized', 0)], 559 + STOP_AFTER_PROMPT_TICKS).map((x) => x.kind)).toEqual(['mpStopped', 'equalized']);
    // too long after the prompt went away -> silent
    const sp2 = new MomentStamper(ctx);
    for (let t = 0; t < 60; t++) sp2.notePrompt(0, t);
    expect(sp2.next([m('matchPointStopped', 0)], 59 + STOP_AFTER_PROMPT_TICKS + 1)).toEqual([]);
    expect(sp2.next([m('leadTaken', 1)], 400)).toHaveLength(1);
  });

  it('stamp column: a small callout never evicts a big stamp; big evicts the oldest small first', () => {
    expect(stampEviction([], false)).toEqual({ evict: null, drop: false });
    expect(stampEviction([true], false)).toEqual({ evict: null, drop: false });
    // 역전! (big) + 잭팟 (big) live, 뽑았다! (small) arrives -> dropped, 역전! stays
    expect(stampEviction([true, true], false)).toEqual({ evict: null, drop: true });
    // big + small live, small arrives -> the small one goes, the big one stays
    expect(stampEviction([true, false], false)).toEqual({ evict: 1, drop: false });
    expect(stampEviction([false, true], false)).toEqual({ evict: 0, drop: false });
    expect(stampEviction([false, false], false)).toEqual({ evict: 0, drop: false });
    // big arrives: oldest small first, else the oldest big
    expect(stampEviction([true, false], true)).toEqual({ evict: 1, drop: false });
    expect(stampEviction([true, true], true)).toEqual({ evict: 0, drop: false });
  });

  it('every stamp text key exists in ko and en', () => {
    const keys = new Set<string>();
    for (const l of Object.values(MOMENT_STAMP_LOOK)) {
      keys.add(l.key);
      if (l.theirsKey) keys.add(l.theirsKey);
    }
    for (const k of ['hud.moment.sub.bankWhole', 'hud.moment.sub.streak2', 'hud.moment.climaxBadge', 'hud.moment.stealChance', 'hud.mp.ours', 'hud.mp.theirs', 'hud.mp.oursTie', 'hud.mp.theirsTie', 'hud.mp.sub', 'hud.mp.subBag', 'hud.mp.subWithBag', 'hud.mp.swing.behind', 'hud.mp.swing.level', 'hud.mp.swing.ahead', 'hud.mp.swing.remaining']) keys.add(k);
    for (const k of keys) {
      expect((ko as Record<string, string>)[k], k).toBeTruthy();
      expect((en as Record<string, string>)[k], k).toBeTruthy();
    }
  });
});

describe('banner queue', () => {
  it('one plate at a time: higher preempts, equal replaces, lower waits, stale ones drop', () => {
    const q = new BannerQueue<string>();
    expect(q.push({ item: 'police1', priority: 'police', durationMs: 2800 }, 0).show?.item).toBe('police1');
    // climax preempts police (police has life left -> it goes back in the queue)
    expect(q.push({ item: 'escape', priority: 'climax', durationMs: 3200 }, 500).show?.item).toBe('escape');
    expect(q.pending).toBe(1);
    // a police banner during the climax plate waits
    expect(q.push({ item: 'police2', priority: 'police', durationMs: 2000 }, 600).show).toBeNull();
    // climax plate turns into the badge after CLIMAX_PLATE_MS -> the oldest waiting police plate
    expect(q.update(500 + CLIMAX_PLATE_MS - 1)).toEqual({ show: null, hide: false });
    const r = q.update(500 + CLIMAX_PLATE_MS);
    expect(r.show?.item).toBe('police1');
    // same priority replaces
    expect(q.push({ item: 'police3', priority: 'police', durationMs: 2000 }, 1400).show?.item).toBe('police3');
    // final clears the waiting list and takes over
    expect(q.push({ item: 'end', priority: 'final', durationMs: 2200 }, 1500).show?.item).toBe('end');
    expect(q.pending).toBe(0);
    expect(q.push({ item: 'late', priority: 'event', durationMs: 2000 }, 1600).show).toBeNull();
    expect(q.update(1500 + 2200).show?.item).toBe('late');
    expect(q.update(1500 + 2200 + 2000)).toEqual({ show: null, hide: true });
  });

  it('a waiting banner older than the max wait is dropped; event outranks police', () => {
    const q = new BannerQueue<string>();
    q.push({ item: 'end', priority: 'final', durationMs: 2000 }, 0);
    q.push({ item: 'police', priority: 'police', durationMs: 2000 }, 100);
    q.push({ item: 'event', priority: 'event', durationMs: 2000 }, 200);
    expect(q.update(2000).show?.item).toBe('event'); // both still fresh: the event goes first
    expect(q.update(4000)).toEqual({ show: null, hide: true }); // the police one went stale
    const q2 = new BannerQueue<string>();
    q2.push({ item: 'a', priority: 'event', durationMs: 4000 }, 0);
    q2.push({ item: 'b', priority: 'other', durationMs: 1000 }, 0);
    expect(q2.update(4000).show).toBeNull();
    expect(BANNER_MAX_WAIT_MS).toBeLessThan(4000);
  });
});

// ---------------------------------------------------------------------------------------------
// Recorded matches: no stamp without a real happening on that tick
// ---------------------------------------------------------------------------------------------

describe('stamps against recorded bot matches', () => {
  it('lead change / equalizer / stopped match point / runs stamp only on ticks where it really happened', () => {
    let stamps = 0;
    for (const [layout, seed] of [
      ['plaza', 11],
      ['shortcut', 12],
      ['counter', 13],
    ] as const) {
      const tr = new MomentTracker({ localTeam: 0, localCharId: 1 });
      let prevScores: [number, number] = [0, 0];
      let prevLeader: TeamId | null = null;
      const mpSeen: [number, number] = [-1e9, -1e9];
      runMatch({
        layout,
        seed,
        team0: [{ personality: 'hodadak', difficulty: 'normal', humanProxy: true }],
        team1: [{ personality: 'tongkeun', difficulty: 'normal' }],
        rules: { police: true },
        onTick: (sim, events, bots) => {
          const s = sim.state;
          const samples = bots.map((b) => ({ charId: sim.characterBySlot(b.slot).id, intent: b.intent() }));
          const moments = tr.observe(s, events, samples);
          const out = momentStamps(moments, { myTeam: 0, meId: 1 }, (id) => sim.getCharacter(id)?.team);
          const [a, b] = s.scores;
          const leader: TeamId | null = a > b ? 0 : b > a ? 1 : null;
          const scored = a !== prevScores[0] || b !== prevScores[1];
          for (const x of out) {
            stamps++;
            switch (x.kind) {
              case 'leadTaken':
                expect(scored).toBe(true);
                expect(leader).toBe(x.team);
                expect(prevLeader).not.toBe(x.team);
                break;
              case 'equalized':
                expect(scored).toBe(true);
                expect(a).toBe(b);
                break;
              case 'mpStopped': {
                const stoppedTeam = x.team === 0 ? 1 : 0;
                expect(s.tick - mpSeen[stoppedTeam]!).toBeLessThan(10 * 60); // that team really had match point
                break;
              }
              case 'streak':
              case 'streakBroken':
                expect(events.some((e) => e.type === 'recovered' || e.type === 'coinsBanked') || x.kind === 'streak').toBe(true);
                break;
              default:
                break;
            }
          }
          // each team's own match point, as the tracker computes it (its holders and zone only)
          for (const t of [0, 1] as TeamId[]) {
            const own = matchPointInfo({
              ...s,
              characters: s.characters.filter((c) => c.team === t),
              loot: s.loot.map((l) => (l.recovery && l.recovery.team !== t ? { ...l, recovery: null } : l)),
            });
            if (own && own.team === t) mpSeen[t] = s.tick;
          }
          if (leader !== null) prevLeader = leader;
          prevScores = [a, b];
        },
      });
    }
    expect(stamps).toBeGreaterThan(0);
  });
});

// the HudMatchPoint type is part of the public surface (HudModel.matchPoint)
const _typeCheck: HudMatchPoint = { side: 'ours', kind: 'win', value: 0, what: 'bag', bag: 0 };
void _typeCheck;
