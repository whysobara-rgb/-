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
 * slot-tick (~460 KB for a 4-minute 1:1) — far over the 150 KB budget. Instead game flow puts
 * every slot's `move` on the log's grid (`MOVE_STEPS` = 8191 steps per unit, <= 6.2e-5 per axis:
 * far below anything a stick, a bot or the physics can tell apart) BEFORE the sim sees it. The
 * log then stores exactly the commands the sim consumed: nothing is rounded after the fact, and a
 * replay feeds back the identical numbers. `aim` only sets a facing direction (the sim reads it
 * through atan2), so it is put on the same grid after scaling it to max-norm 1 (direction error
 * <= 1e-4 rad; a zero / non-finite aim, which the sim ignores, becomes null). Ping positions are
 * rare and kept as raw float64; flags, grab / dash levels and taunts are kept as-is.
 *
 * Encoding: one byte stream, per tick
 * - a slot mask (ceil(slots / 8) bytes): bit s clear = slot s repeats its previous command
 *   (same presence, grab, dash and move; no aim / ping / taunt) and costs nothing more;
 * - per masked slot a header byte (present / grab / dash / extra + a 2-bit aim code + a 2-bit
 *   move code), an extra byte only for a ping / taunt, then the move as a delta from that slot's
 *   previous move: unchanged (0 B), two 4-bit deltas (1 B, |d| <= 7), two int8 deltas (2 B) or
 *   the absolute int16 pair (4 B); then the aim: none, same as the slot's last aim (0 B), two
 *   int8 deltas from it (2 B) or absolute (4 B);
 * - side tables for ping (float64 pair + target id) and taunt (string).
 * Bot steering moves a little on most ticks (median change 3e-4), so most changes take 1-2 bytes.
 * Measured per 4 minutes (police on, classic and v2): 1:1 50-74 KiB; 2:2 with three bots
 * 104-138 KiB (n = 14; test/unit/replay.test.ts asserts <= 150 KiB on real matches). A human
 * stick never at rest costs ~2-3 bytes per tick; the adversarial bound (every slot jumping to a
 * random move and aim each tick) is mask + 10 bytes per slot-tick.
 *
 * Pure TS (no DOM / Node APIs), deterministic, no wall clock.
 */
import { Simulation } from '../sim/sim';
import type { Command, EmoteId, EntityId, MatchSetup, SimEvent } from '../sim/types';

/** Grid steps per unit of `Command.move` (the sim clamps |move| to 1, so |x|, |y| <= 1). */
export const MOVE_STEPS = 8191;

const H_PRESENT = 1;
const H_GRAB = 2;
const H_DASH = 4;
/** An extra byte follows the header (X_PING / X_EMOTE). */
const H_EXTRA = 8;
const H_AIM_SHIFT = 4;
const H_MOVE_SHIFT = 6;
const X_PING = 1;
const X_EMOTE = 2;
/** Move codes (header bits 6-7). */
const M_SAME = 0;
const M_NIBBLE = 1;
const M_INT8 = 2;
const M_ABS = 3;
/** Aim codes (header bits 4-5). */
const A_NONE = 0;
const A_SAME = 1;
const A_INT8 = 2;
const A_ABS = 3;

/** One move component on the log's grid (finite, clamped to [-1, 1]). Idempotent. */
export function quantizeAxis(v: number): number {
  const r = axisToInt(v);
  // -0 becomes +0: the integer store cannot hold a signed zero (and atan2 tells them apart)
  return r === 0 ? 0 : r / MOVE_STEPS;
}

function axisToInt(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const c = v > 1 ? 1 : v < -1 ? -1 : v;
  const r = Math.round(c * MOVE_STEPS);
  return r === 0 ? 0 : r;
}

function intToAxis(i: number): number {
  return i === 0 ? 0 : i / MOVE_STEPS;
}

/**
 * An aim direction on the log grid: scaled to max-norm 1 (same direction; the sim only reads its
 * angle) and quantized. null for a missing, non-finite or near-zero aim (the sim ignores those).
 * Idempotent.
 */
export function quantizeAim(aim: { x: number; y: number } | null | undefined): { x: number; y: number } | null {
  if (!aim || !Number.isFinite(aim.x) || !Number.isFinite(aim.y) || Math.hypot(aim.x, aim.y) <= 1e-6) return null;
  const m = Math.max(Math.abs(aim.x), Math.abs(aim.y));
  const x = quantizeAxis(aim.x / m);
  const y = quantizeAxis(aim.y / m);
  return x === 0 && y === 0 ? null : { x, y };
}

/**
 * Put every present command's `move` and `aim` on the log grid, in place (new objects, so a bot's
 * cached vectors are never mutated). Call right before `sim.step(cmds)` so the sim consumes
 * exactly what the log stores. Idempotent; leaves `undefined` slots alone.
 */
export function canonicalizeCommands(cmds: (Command | undefined)[]): void {
  for (let i = 0; i < cmds.length; i++) {
    const c = cmds[i];
    if (!c) continue;
    const x = quantizeAxis(c.move.x);
    const y = quantizeAxis(c.move.y);
    const moveOk = Object.is(x, c.move.x) && Object.is(y, c.move.y);
    const aim = quantizeAim(c.aim);
    const aimOk = aim === null ? c.aim == null : !!c.aim && Object.is(aim.x, c.aim.x) && Object.is(aim.y, c.aim.y);
    if (moveOk && aimOk) continue;
    cmds[i] = { ...c, move: moveOk ? c.move : { x, y }, aim: aimOk ? c.aim : aim };
  }
}

/** Grow by 1.25x (keeps the reserved capacity close to the payload for long matches). */
function growU8(a: Uint8Array, need: number): Uint8Array {
  if (need <= a.length) return a;
  const b = new Uint8Array(Math.max(need, Math.ceil(a.length * 1.25)));
  b.set(a);
  return b;
}

function growF64(a: Float64Array, need: number): Float64Array {
  if (need <= a.length) return a;
  const b = new Float64Array(Math.max(need, a.length * 2));
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
  v: 2;
  slots: number;
  ticks: number;
  /** Grid of the stored moves (`MOVE_STEPS` when recorded). */
  steps: number;
  bytes: number[];
  pings: number[];
  pingTargets: number[];
  emotes: string[];
}

/** Per-slot running state of the encoder / decoder. */
interface SlotRun {
  /** Header of the last recorded command (presence / grab / dash bits only). */
  base: Uint8Array;
  x: Int16Array;
  y: Int16Array;
  /** Last aim sent (grid ints; 0, 0 before the first). */
  ax: Int16Array;
  ay: Int16Array;
}

function newRun(slots: number): SlotRun {
  return { base: new Uint8Array(slots), x: new Int16Array(slots), y: new Int16Array(slots), ax: new Int16Array(slots), ay: new Int16Array(slots) };
}

function isInt8(d: number): boolean {
  return d >= -128 && d <= 127;
}

function putI16(buf: Uint8Array, at: number, v: number): void {
  buf[at] = v & 0xff;
  buf[at + 1] = (v >> 8) & 0xff;
}

function getI16(buf: Uint8Array, at: number): number {
  return ((buf[at]! | (buf[at + 1]! << 8)) << 16) >> 16;
}

function getI8(buf: Uint8Array, at: number): number {
  return (buf[at]! << 24) >> 24;
}

export class CommandLog {
  readonly slots: number;
  private readonly maskBytes: number;
  private nTicks = 0;
  private buf: Uint8Array;
  private nBytes = 0;
  private pings: Float64Array;
  private pingTargets: Int32Array;
  private nPings = 0;
  private emotes: string[] = [];
  /** Encoder state (what the last recorded tick left per slot). */
  private enc: SlotRun;
  /** Decoder state + cursor (sequential reads are O(slots) per tick). */
  private dec: SlotRun;
  private cur = { tick: 0, byte: 0, ping: 0, emote: 0 };

  constructor(slots: number, expectedTicks = 4 * 60 * 60) {
    if (!(slots >= 1 && slots <= 255)) throw new RangeError(`CommandLog: bad slot count ${slots}`);
    this.slots = slots;
    this.maskBytes = Math.ceil(slots / 8);
    // measured payload is ~1.5-2 bytes per slot-tick (+ the mask): reserve 2 per slot-tick for
    // the expected length (2:2, 4 min: 127 KiB), grow by 1.25x past that
    this.buf = new Uint8Array(Math.max(64, expectedTicks * (this.maskBytes + 2 * slots)));
    this.pings = new Float64Array(16);
    this.pingTargets = new Int32Array(8);
    this.enc = newRun(slots);
    this.dec = newRun(slots);
  }

  /** Ticks recorded so far (tick i of the log = the i-th `sim.step`). */
  get ticks(): number {
    return this.nTicks;
  }

  /**
   * Append one tick: exactly the commands passed to that `sim.step` (after
   * `canonicalizeCommands`). A move off the grid is a programming error (the replay would not be
   * exact) and throws.
   */
  record(cmds: ReadonlyArray<Command | undefined>): void {
    const n = this.slots;
    const mb = this.maskBytes;
    // worst case: mask + per slot header + extra + 4 move bytes + 4 aim bytes
    this.buf = growU8(this.buf, this.nBytes + mb + n * 10);
    const buf = this.buf;
    const maskAt = this.nBytes;
    for (let i = 0; i < mb; i++) buf[maskAt + i] = 0;
    let at = maskAt + mb;
    const run = this.enc;
    for (let s = 0; s < n; s++) {
      const c = cmds[s];
      if (!c) {
        if (run.base[s] === 0) continue; // still absent
        buf[maskAt + (s >> 3)] = buf[maskAt + (s >> 3)]! | (1 << (s & 7));
        buf[at++] = 0;
        run.base[s] = 0;
        continue;
      }
      let h = H_PRESENT;
      if (c.grab) h |= H_GRAB;
      if (c.dash) h |= H_DASH;
      const xi = axisToInt(c.move.x);
      const yi = axisToInt(c.move.y);
      if (!Object.is(intToAxis(xi), c.move.x) || !Object.is(intToAxis(yi), c.move.y)) {
        throw new RangeError(`CommandLog: slot ${s} move (${c.move.x}, ${c.move.y}) is not on the log grid; call canonicalizeCommands before sim.step`);
      }
      const dx = xi - run.x[s]!;
      const dy = yi - run.y[s]!;
      let code = M_SAME;
      if (dx === 0 && dy === 0) code = M_SAME;
      else if (dx >= -8 && dx <= 7 && dy >= -8 && dy <= 7) code = M_NIBBLE;
      else if (isInt8(dx) && isInt8(dy)) code = M_INT8;
      else code = M_ABS;
      let aCode = A_NONE;
      let axi = 0;
      let ayi = 0;
      if (c.aim) {
        axi = axisToInt(c.aim.x);
        ayi = axisToInt(c.aim.y);
        if (!Object.is(intToAxis(axi), c.aim.x) || !Object.is(intToAxis(ayi), c.aim.y) || (axi === 0 && ayi === 0)) {
          throw new RangeError(`CommandLog: slot ${s} aim (${c.aim.x}, ${c.aim.y}) is not on the log grid; call canonicalizeCommands before sim.step`);
        }
        const ex = axi - run.ax[s]!;
        const ey = ayi - run.ay[s]!;
        aCode = ex === 0 && ey === 0 ? A_SAME : isInt8(ex) && isInt8(ey) ? A_INT8 : A_ABS;
      }
      const x = (c.ping ? X_PING : 0) | (c.emote ? X_EMOTE : 0);
      if (x) h |= H_EXTRA;
      if (h === run.base[s] && code === M_SAME && aCode === A_NONE) continue; // repeat: mask bit stays clear
      buf[maskAt + (s >> 3)] = buf[maskAt + (s >> 3)]! | (1 << (s & 7));
      buf[at++] = h | (aCode << H_AIM_SHIFT) | (code << H_MOVE_SHIFT);
      if (x) buf[at++] = x;
      if (code === M_NIBBLE) {
        buf[at++] = ((dx + 8) << 4) | (dy + 8);
      } else if (code === M_INT8) {
        buf[at++] = dx & 0xff;
        buf[at++] = dy & 0xff;
      } else if (code === M_ABS) {
        putI16(buf, at, xi);
        putI16(buf, at + 2, yi);
        at += 4;
      }
      if (aCode === A_INT8) {
        buf[at++] = (axi - run.ax[s]!) & 0xff;
        buf[at++] = (ayi - run.ay[s]!) & 0xff;
      } else if (aCode === A_ABS) {
        putI16(buf, at, axi);
        putI16(buf, at + 2, ayi);
        at += 4;
      }
      run.base[s] = h & (H_PRESENT | H_GRAB | H_DASH);
      run.x[s] = xi;
      run.y[s] = yi;
      if (aCode !== A_NONE) {
        run.ax[s] = axi;
        run.ay[s] = ayi;
      }
      if (c.ping) {
        this.pings = growF64(this.pings, this.nPings * 2 + 2);
        this.pingTargets = growI32(this.pingTargets, this.nPings + 1);
        this.pings[this.nPings * 2] = c.ping.pos.x;
        this.pings[this.nPings * 2 + 1] = c.ping.pos.y;
        this.pingTargets[this.nPings] = c.ping.targetId === null ? -1 : c.ping.targetId;
        this.nPings++;
      }
      if (c.emote) this.emotes.push(c.emote);
    }
    this.nBytes = at;
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
    this.cur = { tick: 0, byte: 0, ping: 0, emote: 0 };
    this.dec = newRun(this.slots);
  }

  private decodeTick(out: (Command | undefined)[] | null): void {
    const n = this.slots;
    const buf = this.buf;
    const run = this.dec;
    const maskAt = this.cur.byte;
    let at = maskAt + this.maskBytes;
    for (let s = 0; s < n; s++) {
      let h = run.base[s]!;
      let x = 0;
      let aim: { x: number; y: number } | null = null;
      if (buf[maskAt + (s >> 3)]! & (1 << (s & 7))) {
        h = buf[at++]!;
        if (h & H_EXTRA) x = buf[at++]!;
        const code = h >> H_MOVE_SHIFT;
        if (code === M_NIBBLE) {
          const b = buf[at++]!;
          run.x[s] = run.x[s]! + ((b >> 4) - 8);
          run.y[s] = run.y[s]! + ((b & 15) - 8);
        } else if (code === M_INT8) {
          run.x[s] = run.x[s]! + getI8(buf, at);
          run.y[s] = run.y[s]! + getI8(buf, at + 1);
          at += 2;
        } else if (code === M_ABS) {
          run.x[s] = getI16(buf, at);
          run.y[s] = getI16(buf, at + 2);
          at += 4;
        }
        const aCode = (h >> H_AIM_SHIFT) & 3;
        if (aCode === A_INT8) {
          run.ax[s] = run.ax[s]! + getI8(buf, at);
          run.ay[s] = run.ay[s]! + getI8(buf, at + 1);
          at += 2;
        } else if (aCode === A_ABS) {
          run.ax[s] = getI16(buf, at);
          run.ay[s] = getI16(buf, at + 2);
          at += 4;
        }
        if (aCode !== A_NONE) aim = { x: intToAxis(run.ax[s]!), y: intToAxis(run.ay[s]!) };
        run.base[s] = h & (H_PRESENT | H_GRAB | H_DASH);
      }
      if (!(h & H_PRESENT)) {
        if (out) out[s] = undefined;
        continue;
      }
      let ping: { pos: { x: number; y: number }; targetId: EntityId | null } | null = null;
      if (x & X_PING) {
        const i = this.cur.ping++;
        const t = this.pingTargets[i]!;
        ping = { pos: { x: this.pings[i * 2]!, y: this.pings[i * 2 + 1]! }, targetId: t < 0 ? null : t };
      }
      let emote: EmoteId | null = null;
      if (x & X_EMOTE) emote = this.emotes[this.cur.emote++] as EmoteId;
      if (out) {
        const cmd: Command = { move: { x: intToAxis(run.x[s]!), y: intToAxis(run.y[s]!) }, grab: (h & H_GRAB) !== 0, dash: (h & H_DASH) !== 0, aim, ping };
        if (emote) cmd.emote = emote;
        out[s] = cmd;
      }
    }
    this.cur.byte = at;
    this.cur.tick++;
  }

  /** Bytes held by the recorded data (stream + side tables actually used + taunt strings). */
  byteSize(): number {
    let emoteBytes = 0;
    for (const e of this.emotes) emoteBytes += e.length * 2 + 8;
    return this.nBytes + this.nPings * (16 + 4) + emoteBytes;
  }

  /** Bytes currently reserved by the backing typed arrays (capacity, incl. headroom). */
  capacityBytes(): number {
    return this.buf.byteLength + this.pings.byteLength + this.pingTargets.byteLength;
  }

  toJSON(): CommandLogJSON {
    return {
      v: 2,
      slots: this.slots,
      ticks: this.nTicks,
      steps: MOVE_STEPS,
      bytes: Array.from(this.buf.subarray(0, this.nBytes)),
      pings: Array.from(this.pings.subarray(0, this.nPings * 2)),
      pingTargets: Array.from(this.pingTargets.subarray(0, this.nPings)),
      emotes: [...this.emotes],
    };
  }

  static fromJSON(j: CommandLogJSON): CommandLog {
    if (j.v !== 2) throw new RangeError(`CommandLog: unknown version ${String(j.v)}`);
    if (j.steps !== MOVE_STEPS) throw new RangeError(`CommandLog: recorded on a ${j.steps}-step grid, this build uses ${MOVE_STEPS}`);
    const log = new CommandLog(j.slots, 1);
    log.nTicks = j.ticks;
    log.buf = Uint8Array.from(j.bytes);
    log.nBytes = j.bytes.length;
    log.pings = Float64Array.from(j.pings);
    log.pingTargets = Int32Array.from(j.pingTargets);
    log.nPings = j.pingTargets.length;
    log.emotes = [...j.emotes];
    // restore the encoder state so recording can continue after a load
    for (let t = 0; t < j.ticks; t++) log.decodeTick(null);
    if (log.cur.byte !== log.nBytes) throw new RangeError('CommandLog: corrupt stream (length mismatch)');
    log.enc = log.dec;
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
