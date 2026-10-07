/**
 * Command log (fun-plan WP5 / content-plan F5): the exact per-tick commands of every slot, so a
 * match can be replayed bit-exact in a fresh `Simulation(sim.setup)` — bug reports, the
 * determinism CI test (test/unit/replay*.test.ts) and round 2's instant replay build on it.
 *
 *   const log = new CommandLog(sim.state.characters.length);
 *   // every tick, BEFORE sim.step:  canonicalizeCommands(cmds)   (match.ts stepOnce)
 *   const events = sim.step(cmds);
 *   log.record(cmds);                                              (match.ts funObserve)
 *   ...
 *   const again = replayCommandLog(sim.setup, log);               // same eventLog, same state
 *
 * Lossless by construction. A raw stick / bot direction is an arbitrary float64 that changes on
 * almost every tick (measured: ~88 % of bot ticks), so storing it exactly would cost 16 bytes per
 * slot-tick (~460 KB for a 4-minute 1:1) — over the 150 KB budget. Instead game flow puts every
 * slot's `move` on the log's int16 grid (`MOVE_STEPS` = 32767 steps per unit, ≤ 1.5e-5 per axis:
 * far below anything a stick, a bot or the physics can tell apart) BEFORE the sim sees it. The
 * log then stores exactly the commands the sim consumed: nothing is rounded after the fact, and
 * a replay feeds back the identical numbers. `aim` and `ping` positions are rare and kept as raw
 * float64; flags, grab / dash levels and taunts are kept as-is.
 *
 * Storage (compact typed arrays, grown by doubling):
 * - one flag byte per slot-tick (present / grab / dash / move changed / aim / ping / emote);
 * - an int16 pair only when a slot's move differs from its previous move;
 * - side tables for aim (float64 pair), ping (float64 pair + target id) and emote (string).
 * A 4-minute 1:1 with a keyboard human and one bot is ~80 KB; two bots ~130 KB (see tests).
 *
 * Pure TS (no DOM / Node APIs), deterministic, no wall clock.
 */
import { Simulation } from '../sim/sim';
import type { Command, EmoteId, EntityId, MatchSetup, SimEvent } from '../sim/types';

/** int16 steps per unit of `Command.move` (the sim clamps |move| to 1, so |x|, |y| ≤ 1). */
export const MOVE_STEPS = 32767;

const F_PRESENT = 1;
const F_GRAB = 2;
const F_DASH = 4;
const F_MOVE = 8;
const F_AIM = 16;
const F_PING = 32;
const F_EMOTE = 64;

/** One move component on the log's grid (finite, clamped to [-1, 1]). Idempotent. */
export function quantizeAxis(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const c = v > 1 ? 1 : v < -1 ? -1 : v;
  const r = Math.round(c * MOVE_STEPS);
  // -0 becomes +0: the int16 store cannot hold a signed zero (and atan2 tells them apart)
  return r === 0 ? 0 : r / MOVE_STEPS;
}

function axisToInt(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const c = v > 1 ? 1 : v < -1 ? -1 : v;
  const r = Math.round(c * MOVE_STEPS);
  return r === 0 ? 0 : r;
}

/**
 * Put every present command's `move` on the log grid, in place (a new move object, so a bot's
 * cached vector is never mutated). Call right before `sim.step(cmds)` so the sim consumes exactly
 * what the log stores. Idempotent; leaves `undefined` slots alone.
 */
export function canonicalizeCommands(cmds: (Command | undefined)[]): void {
  for (let i = 0; i < cmds.length; i++) {
    const c = cmds[i];
    if (!c) continue;
    const x = quantizeAxis(c.move.x);
    const y = quantizeAxis(c.move.y);
    if (Object.is(x, c.move.x) && Object.is(y, c.move.y)) continue;
    cmds[i] = { ...c, move: { x, y } };
  }
}

function growI16(a: Int16Array, need: number): Int16Array {
  if (need <= a.length) return a;
  const b = new Int16Array(Math.max(need, a.length * 2));
  b.set(a);
  return b;
}

function growF64(a: Float64Array, need: number): Float64Array {
  if (need <= a.length) return a;
  const b = new Float64Array(Math.max(need, a.length * 2));
  b.set(a);
  return b;
}

function growU8(a: Uint8Array, need: number): Uint8Array {
  if (need <= a.length) return a;
  const b = new Uint8Array(Math.max(need, a.length * 2));
  b.set(a);
  return b;
}

function growI32(a: Int32Array, need: number): Int32Array {
  if (need <= a.length) return a;
  const b = new Int32Array(Math.max(need, a.length * 2));
  b.set(a);
  return b;
}

/** Serializable form of a CommandLog (bug reports): typed arrays as plain number arrays. */
export interface CommandLogJSON {
  v: 1;
  slots: number;
  ticks: number;
  flags: number[];
  moves: number[];
  aims: number[];
  pings: number[];
  pingTargets: number[];
  emotes: string[];
}

export class CommandLog {
  readonly slots: number;
  private nTicks = 0;
  private flags: Uint8Array;
  private moves: Int16Array;
  private nMoves = 0;
  private aims: Float64Array;
  private nAims = 0;
  private pings: Float64Array;
  private pingTargets: Int32Array;
  private nPings = 0;
  private emotes: string[] = [];
  /** Last recorded move per slot (int16 grid), for change detection. */
  private readonly lastX: Int16Array;
  private readonly lastY: Int16Array;
  // decoding cursor (sequential reads are O(1) per tick)
  private cur = { tick: 0, move: 0, aim: 0, ping: 0, emote: 0 };
  private readonly curX: Int16Array;
  private readonly curY: Int16Array;

  constructor(slots: number, expectedTicks = 4 * 60 * 60) {
    if (!(slots >= 1 && slots <= 255)) throw new RangeError(`CommandLog: bad slot count ${slots}`);
    this.slots = slots;
    this.flags = new Uint8Array(Math.max(64, expectedTicks * slots));
    this.moves = new Int16Array(Math.max(64, expectedTicks * slots));
    this.aims = new Float64Array(64);
    this.pings = new Float64Array(16);
    this.pingTargets = new Int32Array(8);
    this.lastX = new Int16Array(slots);
    this.lastY = new Int16Array(slots);
    this.curX = new Int16Array(slots);
    this.curY = new Int16Array(slots);
  }

  /** Ticks recorded so far (tick i of the log = the i-th `sim.step`). */
  get ticks(): number {
    return this.nTicks;
  }

  /**
   * Append one tick: exactly the commands passed to that `sim.step` (after
   * `canonicalizeCommands`). A move off the int16 grid is a programming error (the replay would
   * not be exact) and throws.
   */
  record(cmds: ReadonlyArray<Command | undefined>): void {
    const n = this.slots;
    const base = this.nTicks * n;
    this.flags = growU8(this.flags, base + n);
    for (let s = 0; s < n; s++) {
      const c = cmds[s];
      if (!c) {
        this.flags[base + s] = 0;
        continue;
      }
      let f = F_PRESENT;
      if (c.grab) f |= F_GRAB;
      if (c.dash) f |= F_DASH;
      const xi = axisToInt(c.move.x);
      const yi = axisToInt(c.move.y);
      if (!Object.is(xi === 0 ? 0 : xi / MOVE_STEPS, c.move.x) || !Object.is(yi === 0 ? 0 : yi / MOVE_STEPS, c.move.y)) {
        throw new RangeError(`CommandLog: slot ${s} move (${c.move.x}, ${c.move.y}) is not on the log grid; call canonicalizeCommands before sim.step`);
      }
      if (xi !== this.lastX[s] || yi !== this.lastY[s]) {
        f |= F_MOVE;
        this.moves = growI16(this.moves, this.nMoves + 2);
        this.moves[this.nMoves++] = xi;
        this.moves[this.nMoves++] = yi;
        this.lastX[s] = xi;
        this.lastY[s] = yi;
      }
      if (c.aim) {
        f |= F_AIM;
        this.aims = growF64(this.aims, this.nAims + 2);
        this.aims[this.nAims++] = c.aim.x;
        this.aims[this.nAims++] = c.aim.y;
      }
      if (c.ping) {
        f |= F_PING;
        this.pings = growF64(this.pings, this.nPings * 2 + 2);
        this.pingTargets = growI32(this.pingTargets, this.nPings + 1);
        this.pings[this.nPings * 2] = c.ping.pos.x;
        this.pings[this.nPings * 2 + 1] = c.ping.pos.y;
        this.pingTargets[this.nPings] = c.ping.targetId === null ? -1 : c.ping.targetId;
        this.nPings++;
      }
      if (c.emote) {
        f |= F_EMOTE;
        this.emotes.push(c.emote);
      }
      this.flags[base + s] = f;
    }
    this.nTicks++;
  }

  /**
   * Commands of log tick `tick` (fresh objects; `undefined` for an absent slot). Sequential reads
   * (0, 1, 2, ...) are O(slots); a backwards jump rescans from the start.
   */
  commandsAt(tick: number): (Command | undefined)[] {
    if (!(tick >= 0 && tick < this.nTicks)) throw new RangeError(`CommandLog: tick ${tick} outside 0..${this.nTicks - 1}`);
    if (tick < this.cur.tick) this.rewind();
    while (this.cur.tick < tick) this.decodeTick(null);
    const out: (Command | undefined)[] = new Array(this.slots);
    this.decodeTick(out);
    return out;
  }

  private rewind(): void {
    this.cur = { tick: 0, move: 0, aim: 0, ping: 0, emote: 0 };
    this.curX.fill(0);
    this.curY.fill(0);
  }

  private decodeTick(out: (Command | undefined)[] | null): void {
    const n = this.slots;
    const base = this.cur.tick * n;
    for (let s = 0; s < n; s++) {
      const f = this.flags[base + s]!;
      if (!(f & F_PRESENT)) {
        if (out) out[s] = undefined;
        continue;
      }
      if (f & F_MOVE) {
        this.curX[s] = this.moves[this.cur.move++]!;
        this.curY[s] = this.moves[this.cur.move++]!;
      }
      let aim: { x: number; y: number } | null = null;
      if (f & F_AIM) {
        aim = { x: this.aims[this.cur.aim++]!, y: this.aims[this.cur.aim++]! };
      }
      let ping: { pos: { x: number; y: number }; targetId: EntityId | null } | null = null;
      if (f & F_PING) {
        const i = this.cur.ping++;
        const t = this.pingTargets[i]!;
        ping = { pos: { x: this.pings[i * 2]!, y: this.pings[i * 2 + 1]! }, targetId: t < 0 ? null : t };
      }
      let emote: EmoteId | null = null;
      if (f & F_EMOTE) emote = this.emotes[this.cur.emote++] as EmoteId;
      if (out) {
        const mx = this.curX[s]!;
        const my = this.curY[s]!;
        const cmd: Command = { move: { x: mx === 0 ? 0 : mx / MOVE_STEPS, y: my === 0 ? 0 : my / MOVE_STEPS }, grab: (f & F_GRAB) !== 0, dash: (f & F_DASH) !== 0, aim, ping };
        if (emote) cmd.emote = emote;
        out[s] = cmd;
      }
    }
    this.cur.tick++;
  }

  /** Bytes held by the recorded data (typed-array payload actually used + taunt strings). */
  byteSize(): number {
    let emoteBytes = 0;
    for (const e of this.emotes) emoteBytes += e.length * 2 + 8;
    return this.nTicks * this.slots + this.nMoves * 2 + this.nAims * 8 + this.nPings * (16 + 4) + emoteBytes;
  }

  /** Bytes currently reserved by the backing typed arrays (capacity, incl. headroom). */
  capacityBytes(): number {
    return this.flags.byteLength + this.moves.byteLength + this.aims.byteLength + this.pings.byteLength + this.pingTargets.byteLength;
  }

  toJSON(): CommandLogJSON {
    return {
      v: 1,
      slots: this.slots,
      ticks: this.nTicks,
      flags: Array.from(this.flags.subarray(0, this.nTicks * this.slots)),
      moves: Array.from(this.moves.subarray(0, this.nMoves)),
      aims: Array.from(this.aims.subarray(0, this.nAims)),
      pings: Array.from(this.pings.subarray(0, this.nPings * 2)),
      pingTargets: Array.from(this.pingTargets.subarray(0, this.nPings)),
      emotes: [...this.emotes],
    };
  }

  static fromJSON(j: CommandLogJSON): CommandLog {
    if (j.v !== 1) throw new RangeError(`CommandLog: unknown version ${String(j.v)}`);
    const log = new CommandLog(j.slots, Math.max(1, j.ticks));
    log.nTicks = j.ticks;
    log.flags = Uint8Array.from(j.flags);
    log.moves = Int16Array.from(j.moves);
    log.nMoves = j.moves.length;
    log.aims = Float64Array.from(j.aims);
    log.nAims = j.aims.length;
    log.pings = Float64Array.from(j.pings);
    log.pingTargets = Int32Array.from(j.pingTargets);
    log.nPings = j.pingTargets.length;
    log.emotes = [...j.emotes];
    // restore the change-detection state so recording can continue after a load
    for (let t = 0; t < j.ticks; t++) log.decodeTick(null);
    for (let s = 0; s < log.slots; s++) {
      log.lastX[s] = log.curX[s]!;
      log.lastY[s] = log.curY[s]!;
    }
    log.rewind();
    return log;
  }
}

/**
 * Replay `log` in a fresh `Simulation(setup)` for `ticks` steps (default: all of them; a step
 * after the match is over is a no-op in the sim). Returns the replayed simulation (its
 * `eventLog` / `state` are what the original match produced).
 */
export function replayCommandLog(setup: MatchSetup, log: CommandLog, ticks: number = log.ticks, onTick?: (sim: Simulation, events: SimEvent[]) => void): Simulation {
  const sim = new Simulation(setup);
  const n = Math.min(ticks, log.ticks);
  for (let t = 0; t < n; t++) {
    const ev = sim.step(log.commandsAt(t));
    onTick?.(sim, ev);
  }
  return sim;
}

/**
 * 32-bit FNV-1a over a JSON rendering (non-finite numbers -> null, like JSON). Pure and stable
 * across runs and platforms: compare `hashJSON(sim.state)` / `hashJSON(sim.eventLog)` of a match
 * and its replay.
 */
export function hashJSON(value: unknown): string {
  const s = JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
