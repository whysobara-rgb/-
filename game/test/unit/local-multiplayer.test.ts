/**
 * Local multiplayer ("같이 하기"): device -> player routing, join / leave / team logic,
 * multi-human match building and determinism with several human slots.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS, MATCH_ACTIONS, cloneBindings } from '../../src/platform/bindings';
import type { GamepadLike } from '../../src/platform/input';
import { LocalInputRouter, keySetsFor, keyboardDeviceOf, type LocalDeviceId } from '../../src/platform/localInput';
import { allReady, allowedModes, emptyLobby, join, lobbyStep, lobbyStyle, localSetupFromLobby, resolveMode, type LobbyState } from '../../src/game/local';
import { buildMatch, type MatchConfig } from '../../src/game/setup';
import { Simulation } from '../../src/sim/sim';
import { canonicalizeCommands, hashJSON } from '../../src/game/replay';
import type { Command } from '../../src/sim/types';

function pad(index: number, pressed: number[] = [], axes: number[] = [0, 0, 0, 0]): GamepadLike {
  return {
    index,
    id: `Pad ${index} (STANDARD GAMEPAD)`,
    connected: true,
    mapping: 'standard',
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })),
    axes,
  };
}

describe('keyboard key sets', () => {
  it('splits one keyboard into two players without any shared key', () => {
    const sets = keySetsFor(DEFAULT_BINDINGS);
    const a = new Set(MATCH_ACTIONS.flatMap((x) => sets.kbA[x]));
    for (const x of MATCH_ACTIONS) for (const c of sets.kbB[x]) expect(a.has(c)).toBe(false);
    expect(sets.kbA.moveUp).toEqual(['KeyW']);
    expect(sets.kbA.grab).toContain('Space');
    expect(sets.kbA.dash).toContain('ShiftLeft');
    expect(sets.kbB.moveUp).toEqual(['ArrowUp']);
    expect(sets.kbB.grab).toContain('Period');
    expect(sets.kbB.dash).toContain('Slash');
    // every required action has a key on both sides
    for (const x of ['moveUp', 'moveDown', 'moveLeft', 'moveRight', 'grab', 'dash', 'pause'] as const) {
      expect(sets.kbA[x].length).toBeGreaterThan(0);
      expect(sets.kbB[x].length).toBeGreaterThan(0);
    }
  });

  it('routes codes to the right keyboard player (mouse = player A)', () => {
    const sets = keySetsFor(DEFAULT_BINDINGS);
    expect(keyboardDeviceOf('KeyW', sets)).toBe('kbA');
    expect(keyboardDeviceOf('Space', sets)).toBe('kbA');
    expect(keyboardDeviceOf('Mouse0', sets)).toBe('kbA');
    // Enter is decided by the router (A alone, B once B has joined)
    expect(keyboardDeviceOf('Enter', sets)).toBeNull();
    expect(keyboardDeviceOf('ArrowLeft', sets)).toBe('kbB');
    expect(keyboardDeviceOf('Period', sets)).toBe('kbB');
    expect(keyboardDeviceOf('KeyZ', sets)).toBeNull();
  });

  it("player A's rebinds win; B falls back to its numpad keys", () => {
    const b = cloneBindings(DEFAULT_BINDINGS);
    b.keyboard.grab = ['Period'];
    const sets = keySetsFor(b);
    // Period is reserved for B, so A falls back to its default grab keys
    expect(sets.kbA.grab).toContain('Space');
    expect(sets.kbB.grab).toContain('Period');
    const b2 = cloneBindings(DEFAULT_BINDINGS);
    b2.keyboard.dash = ['Numpad2'];
    const s2 = keySetsFor(b2);
    expect(s2.kbA.dash).toEqual(['Numpad2']);
    expect(s2.kbB.dash).not.toContain('Numpad2');
  });
});

describe('LocalInputRouter', () => {
  it('gives each device its own frame', () => {
    const pads: (GamepadLike | null)[] = [null, pad(1, [0], [0.9, 0, 0, 0])];
    const r = new LocalInputRouter({ target: null, getGamepads: () => pads });
    r.keyDown({ code: 'KeyW' });
    r.keyDown({ code: 'ArrowRight' });
    r.keyDown({ code: 'Period' });
    const a = r.matchFrame('kbA');
    const b = r.matchFrame('kbB');
    const p = r.matchFrame('pad:1');
    expect(a.move).toEqual({ x: 0, y: -1 });
    expect(a.grabDown).toBe(false);
    expect(b.move).toEqual({ x: 1, y: 0 });
    expect(b.grabPressed).toBe(true);
    expect(b.grabDown).toBe(true);
    expect(p.move.x).toBeGreaterThan(0.8);
    expect(p.grabPressed).toBe(true);
    // edges are consumed per device
    expect(r.matchFrame('kbB').grabPressed).toBe(false);
    expect(r.matchFrame('pad:1').grabPressed).toBe(false);
    expect(r.matchFrame('pad:1').grabDown).toBe(true);
    expect(r.connectedPads()).toEqual([1]);
  });

  it('reports join-screen presses per device', () => {
    const pads: (GamepadLike | null)[] = [pad(0)];
    const r = new LocalInputRouter({ target: null, getGamepads: () => pads });
    r.pollLobby();
    r.keyDown({ code: 'Space' });
    r.keyDown({ code: 'ArrowLeft' });
    pads[0] = pad(0, [0]);
    const got = r.pollLobby();
    const by = (d: LocalDeviceId) => got.find((g) => g.device === d)?.frame;
    expect(by('kbA')?.confirm).toBe(true);
    expect(by('kbB')?.left).toBe(true);
    expect(by('pad:0')?.confirm).toBe(true);
    expect(r.pollLobby()).toEqual([]);
  });

  it("Enter confirms for A while A is alone, for B once B has joined; B's grab confirms in the pause menu", () => {
    const r = new LocalInputRouter({ target: null, getGamepads: () => [] });
    r.keyDown({ code: 'Enter' });
    let got = r.pollLobby();
    expect(got.map((g) => [g.device, g.frame.confirm])).toEqual([['kbA', true]]);
    r.enterOwner = 'kbB';
    r.keyDown({ code: 'Enter' });
    got = r.pollLobby();
    expect(got.map((g) => [g.device, g.frame.confirm])).toEqual([['kbB', true]]);
    // pause menu: B's '.' confirms, '/' backs out; Enter / Esc are left to the menu input
    r.keyDown({ code: 'Period' });
    expect(r.pauseMenuFrame()).toEqual({ confirm: true, back: false });
    r.keyDown({ code: 'Slash' });
    expect(r.pauseMenuFrame()).toEqual({ confirm: false, back: true });
    r.keyDown({ code: 'Enter' });
    expect(r.pauseMenuFrame()).toEqual({ confirm: false, back: false });
  });

  it('keeps two quick taps inside one slow frame as two join-screen presses', () => {
    const r = new LocalInputRouter({ target: null, getGamepads: () => [] });
    r.keyDown({ code: 'Space' });
    r.keyUp('Space');
    r.keyDown({ code: 'Space' });
    r.keyUp('Space');
    r.keyDown({ code: 'ArrowRight' });
    const got = r.pollLobby();
    expect(got.filter((g) => g.device === 'kbA' && g.frame.confirm)).toHaveLength(2);
    expect(got.filter((g) => g.device === 'kbB' && g.frame.right)).toHaveLength(1);
  });

  it('ignores keys held through a pause until released', () => {
    const r = new LocalInputRouter({ target: null, getGamepads: () => [] });
    r.matchFrame('kbA');
    r.keyDown({ code: 'Space' }); // pressed while the pause menu owned input
    r.resume();
    expect(r.matchFrame('kbA').grabDown).toBe(false);
    r.keyUp('Space');
    r.keyDown({ code: 'Space' });
    expect(r.matchFrame('kbA').grabDown).toBe(true);
  });
});

describe('join screen logic', () => {
  const step = (s: LobbyState, d: LocalDeviceId, a: 'confirm' | 'back' | 'left' | 'right') => lobbyStep(s, d, a);

  it('joins with P-numbers, balances teams, readies and leaves', () => {
    let s = emptyLobby();
    let r = step(s, 'kbA', 'confirm');
    expect(r.event).toBe('joined');
    s = r.state;
    s = step(s, 'kbB', 'confirm').state;
    s = step(s, 'pad:0', 'confirm').state;
    expect(s.players.map((p) => [p.device, p.index, p.team])).toEqual([
      ['kbA', 0, 0],
      ['kbB', 1, 1],
      ['pad:0', 2, 0],
    ]);
    expect(lobbyStyle(s)).toBe('versus');
    // left team is full (2): kbB cannot move there
    r = step(s, 'kbB', 'left');
    expect(r.event).toBe('blocked');
    // P2 leaves -> P-number 1 is free again for the next one
    s = step(s, 'kbB', 'back').state;
    s = step(s, 'pad:1', 'confirm').state;
    expect(s.players.find((p) => p.device === 'pad:1')?.index).toBe(1);
    // ready, un-ready, leave
    s = step(s, 'kbA', 'confirm').state;
    expect(s.players[0]!.ready).toBe(true);
    expect(step(s, 'kbA', 'right').event).toBe(null); // ready players stay put
    s = step(s, 'kbA', 'back').state;
    expect(s.players[0]!.ready).toBe(false);
    s = step(s, 'kbA', 'back').state;
    expect(s.players.some((p) => p.device === 'kbA')).toBe(false);
  });

  it('caps at four players and exits only when nobody is in', () => {
    let s = emptyLobby();
    for (const d of ['kbA', 'kbB', 'pad:0', 'pad:1'] as const) s = step(s, d, 'confirm').state;
    expect(s.players).toHaveLength(4);
    expect(join(s, 'pad:2')).toBeNull();
    expect(step(s, 'pad:2', 'confirm').event).toBe('blocked');
    expect(step(s, 'pad:2', 'back').event).toBe(null);
    expect(step(emptyLobby(), 'kbA', 'back').event).toBe('exit');
  });

  it('derives style, modes and readiness', () => {
    let s = emptyLobby();
    s = step(s, 'kbA', 'confirm').state;
    expect(lobbyStyle(s)).toBe('coop');
    expect(allowedModes(s)).toEqual(['1v1', '2v2']);
    s = step(s, 'kbB', 'confirm').state; // goes right
    s = step(s, 'kbB', 'left').state; // both left: co-op 2:2 only
    expect(lobbyStyle(s)).toBe('coop');
    expect(allowedModes(s)).toEqual(['2v2']);
    expect(resolveMode(s, '1v1')).toBe('2v2');
    expect(allReady(s)).toBe(false);
    s = step(step(s, 'kbA', 'confirm').state, 'kbB', 'confirm').state;
    expect(allReady(s)).toBe(true);
  });
});

describe('multi-human match setup', () => {
  const base: MatchConfig = { kind: 'quick', layoutId: 'plaza', mode: '2v2', rival: 'hodadak', difficulty: 'normal', adaptation: null, seed: 1234, humanHat: 'tongkeunHat' };

  function lobbyOf(devs: Array<[LocalDeviceId, 0 | 1]>): LobbyState {
    let s = emptyLobby();
    for (const [d, t] of devs) {
      s = lobbyStep(s, d, 'confirm').state;
      s = lobbyStep(s, d, t === 0 ? 'left' : 'right').state;
    }
    return s;
  }

  it('2:2 versus with two humans: one human per team, bots fill the rest', () => {
    const local = localSetupFromLobby(lobbyOf([['kbA', 0], ['kbB', 1]]));
    expect(local.style).toBe('versus');
    const b = buildMatch({ ...base, local });
    expect(b.setup.roster.map((r) => [r.team, r.isBot])).toEqual([
      [0, false],
      [0, true],
      [1, false],
      [1, true],
    ]);
    expect(b.humans.map((h) => [h.slot, h.seat?.device])).toEqual([
      [0, 'kbA'],
      [2, 'kbB'],
    ]);
    expect(b.humanSlot).toBe(0);
    expect(b.bots.map((x) => x.slot)).toEqual([1, 3]);
    // helpers on human teams, never weaker than normal
    expect(b.bots.every((x) => x.personality === 'tongkeun' && x.difficulty !== 'novice')).toBe(true);
    expect(b.setup.roster[0]!.look.hat).toBe('tongkeunHat'); // P1 wears the wardrobe hat
    expect(b.setup.roster[2]!.name).toBe('P2');
  });

  it('1:1 versus has no bots; co-op faces a bot team at the chosen difficulty', () => {
    const vs = buildMatch({ ...base, mode: '1v1', local: localSetupFromLobby(lobbyOf([['kbA', 0], ['pad:0', 1]])) });
    expect(vs.bots).toEqual([]);
    expect(vs.setup.roster).toHaveLength(2);
    const coop = buildMatch({ ...base, difficulty: 'challenge', local: localSetupFromLobby(lobbyOf([['kbA', 0], ['kbB', 0]])) });
    expect(coop.humans.map((h) => h.slot)).toEqual([0, 1]);
    expect(coop.bots.map((x) => [x.slot, x.personality, x.difficulty])).toEqual([
      [2, 'hodadak', 'challenge'],
      [3, 'hodadak', 'challenge'],
    ]);
    // co-op on the right team: the bot team takes the left slots
    const right = buildMatch({ ...base, local: localSetupFromLobby(lobbyOf([['kbA', 1], ['kbB', 1]])) });
    expect(right.humans.map((h) => h.slot)).toEqual([2, 3]);
    expect(right.humanSlot).toBe(2);
  });

  it('four humans: no bots; 1:1 request with two humans per team becomes 2:2', () => {
    const local = localSetupFromLobby(lobbyOf([['kbA', 0], ['kbB', 1], ['pad:0', 0], ['pad:1', 1]]));
    const b = buildMatch({ ...base, mode: '1v1', local });
    expect(b.bots).toEqual([]);
    expect(b.setup.roster.every((r) => !r.isBot)).toBe(true);
    expect(b.humans).toHaveLength(4);
  });

  it('single-player stays exactly as before', () => {
    const b = buildMatch({ ...base });
    expect(b.humanSlot).toBe(0);
    expect(b.humans).toEqual([{ slot: 0, seat: null }]);
    expect(b.setup.roster[0]).toEqual({ team: 0, isBot: false, name: 'name.you', look: { hat: 'tongkeunHat', furTint: 0.5 } });
  });

  it('is deterministic with several human slots (same command streams -> same hashes)', () => {
    const local = localSetupFromLobby(lobbyOf([['kbA', 0], ['kbB', 1], ['pad:0', 0], ['pad:1', 1]]));
    const built = buildMatch({ ...base, local, seed: 77 });
    const run = (): { state: string; events: string } => {
      const sim = new Simulation(built.setup);
      for (let t = 0; t < 600; t++) {
        const cmds: Command[] = built.humans.map((h, i) => {
          const a = (t * 0.05 + i * 1.7) % (Math.PI * 2);
          return { move: { x: Math.cos(a), y: Math.sin(a) }, grab: (t + i * 37) % 90 < 40, dash: (t + i * 13) % 150 === 0, aim: null, ping: null };
        });
        const ordered: (Command | undefined)[] = [];
        built.humans.forEach((h, i) => (ordered[h.slot] = cmds[i]));
        canonicalizeCommands(ordered);
        sim.step(ordered);
      }
      return { state: hashJSON(sim.state), events: hashJSON(sim.eventLog) };
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
  });
});

describe('shared camera framing', () => {
  it('stays at the single-player distance for a tight group, zooms out smoothly, caps at the max', async () => {
    const { sharedFraming, SHARED_MAX_DIST, visibleExtents } = await import('../../src/render/sharedCamera');
    const { MATCH_DIST } = await import('../../src/render/camera');
    const aspect = 16 / 9;
    const tight = sharedFraming([{ x: 10, y: 10, r: 2 }, { x: 12, y: 11, r: 2 }], aspect);
    expect(tight.dist).toBe(MATCH_DIST.walk);
    expect(tight.fits).toBe(true);
    const dists = [8, 16, 24, 32].map((gap) => sharedFraming([{ x: 0, y: 0, r: 2 }, { x: gap, y: 0, r: 2 }], aspect).dist);
    for (let i = 1; i < dists.length; i++) expect(dists[i]!).toBeGreaterThanOrEqual(dists[i - 1]!);
    const wide = sharedFraming([{ x: 0, y: 0, r: 2 }, { x: 120, y: 60, r: 2 }], aspect);
    expect(wide.dist).toBe(SHARED_MAX_DIST);
    expect(wide.fits).toBe(false);
    // too far apart: one player stays fully on screen (not an empty middle), leaning toward the other
    const we = visibleExtents(wide.dist, aspect);
    const onScreen = (q: { x: number; y: number }, f: { x: number; y: number }) =>
      Math.abs(q.x - f.x) + 2 <= we.half && q.y - 2 >= f.y - we.north && q.y + 2 <= f.y + we.south;
    expect(onScreen({ x: 0, y: 0 }, wide)).toBe(true);
    expect(wide.x).toBeGreaterThan(2);
    // everything that fits is inside the visible extents around the target
    const mid = sharedFraming([{ x: 0, y: 0, r: 2 }, { x: 18, y: 9, r: 2 }], aspect);
    const e = visibleExtents(mid.dist, aspect);
    expect(mid.fits).toBe(true);
    expect(Math.abs(18 - mid.x) + 2).toBeLessThanOrEqual(e.half);
    expect(mid.y - (0 - 2)).toBeLessThanOrEqual(e.north);
    expect(9 + 2 - mid.y).toBeLessThanOrEqual(e.south);
  });

  it('versus kickoff (spawns ~69 m apart): keeps a whole pair on screen and sticks to it', async () => {
    const { sharedFraming, visibleExtents, SHARED_MAX_DIST } = await import('../../src/render/sharedCamera');
    const aspect = 16 / 9;
    // P1, P3 at the star van (owners 0, 2); P2, P4 at the moon van (owners 1, 3)
    const pts = [
      { x: 5.5, y: 30, r: 2.2, owner: 0 },
      { x: 74.5, y: 30, r: 2.2, owner: 1 },
      { x: 5.5, y: 33, r: 2.2, owner: 2 },
      { x: 74.5, y: 33, r: 2.2, owner: 3 },
    ];
    const e = visibleExtents(SHARED_MAX_DIST, aspect);
    const shown = (f: { x: number; y: number }, list = pts) => list.filter((q) => Math.abs(q.x - f.x) + q.r <= e.half && q.y - q.r >= f.y - e.north && q.y + q.r <= f.y + e.south).map((q) => q.owner);
    const first = sharedFraming(pts, aspect);
    expect(first.fits).toBe(false);
    // the old midpoint framing showed nobody; now P1's pair (lowest owner on a tie)
    expect(shown(first)).toEqual([0, 2]);
    // with the moon pair framed last time, an equal tie keeps the moon pair (no flip-flop)
    const moon = sharedFraming(pts, aspect, undefined, undefined, { x: 60, y: 31 });
    expect(shown(moon)).toEqual([1, 3]);
    // a third player crossing toward the middle wins the larger group
    const moved = pts.map((q) => (q.owner === 1 ? { ...q, x: 30 } : q));
    const f3 = sharedFraming(moved, aspect, undefined, undefined, { x: 60, y: 31 });
    expect(shown(f3, moved).sort()).toEqual([0, 1, 2]);
    // a player's loot (same owner) moves in and out of frame with them
    const withBank = [...pts, { x: 9, y: 31, r: 4.5, owner: 0 }];
    const fb = sharedFraming(withBank, aspect);
    expect(Math.abs(9 - fb.x) + 4.5).toBeLessThanOrEqual(e.half);
  });
});

describe('local results highlights', () => {
  it('credits uproots, steals and recoveries from the event log; ties are shared', async () => {
    const { LocalStatsTracker, pickHighlights } = await import('../../src/game/localStats');
    const tr = new LocalStatsTracker([
      { charId: 1, index: 0, team: 0 },
      { charId: 3, index: 1, team: 1 },
    ]);
    const grabbed = new Map<number, number[]>([[10, [1]], [11, [3, 1]]]);
    const sim = { getLoot: (id: number) => ({ grabbedBy: grabbed.get(id) ?? [] }), getCharacter: (id: number) => ({ team: (id === 1 ? 0 : 1) as 0 | 1 }) };
    tr.observe(
      [
        { type: 'unanchored', tick: 1, lootId: 10, kind: 'smallSafe', byTeam: 0 },
        { type: 'unanchored', tick: 2, lootId: 11, kind: 'largeSafe', byTeam: null },
        { type: 'safeUnloaded', tick: 3, safeId: 12, bankId: 20, bankValue: 500, byCharId: 3, bankCarrierTeam: 0 },
        { type: 'safeUnloaded', tick: 4, safeId: 13, bankId: 20, bankValue: 500, byCharId: 1, bankCarrierTeam: 0 }, // own team: not a steal
        { type: 'recovered', tick: 5, lootId: 10, kind: 'smallSafe', team: 0, value: 300, safeIds: [], safesValue: 0, holders: [1] },
      ] as never,
      sim,
    );
    const lines = tr.snapshot();
    expect(lines.map((l) => [l.index, l.uproots, l.steals, l.recovered])).toEqual([
      [0, 2, 0, 300],
      [1, 1, 1, 0],
    ]);
    expect(pickHighlights(lines)).toEqual([
      { kind: 'uproots', players: [0], value: 2 },
      { kind: 'steals', players: [1], value: 1 },
      { kind: 'recovered', players: [0], value: 300 },
    ]);
    const tie = pickHighlights([
      { charId: 1, index: 0, team: 0, uproots: 1, steals: 0, recovered: 0 },
      { charId: 2, index: 1, team: 1, uproots: 1, steals: 0, recovered: 0 },
    ]);
    expect(tie).toEqual([{ kind: 'uproots', players: [0, 1], value: 1 }]);
  });
});
