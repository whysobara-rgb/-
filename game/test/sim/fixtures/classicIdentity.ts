/**
 * Classic-identity fixture format (Content 2.0, package C0).
 *
 * `content: 'classic'` must stay byte-identical to the pre-Content-2.0 sim. The fixture pins the
 * full event log of 30 seeded bot matches recorded from the tree right before the Content 2.0
 * contracts landed (HEAD 1250caa):
 *
 * - AI matches: real `src/ai` bots played every match once at record time; their commands were
 *   quantized (move / aim to 1/1024, ping positions to 1/64) and the QUANTIZED commands drove the
 *   sim, so the stored command streams replay the recorded match exactly without running any bot.
 *   The identity test therefore does not depend on `src/ai` (bots may keep changing).
 * - Fuzz matches: the seeded `FuzzDriver` (test fixture, independent of `src/ai`) replays live.
 *
 * Every match stores the sha256 of `JSON.stringify(sim.eventLog)` plus a digest of the classic
 * state fields (characters, loot, scores) at the end.
 *
 * Regenerate ONLY when a change to classic behaviour is intended and agreed (e.g. C11 tuning of
 * POLICE values, WP2's emote step) — never to make a failing identity test pass:
 *   npx tsx tools/record-classic-identity.ts
 */
import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import type { Command, EmoteId, RosterEntry, RuleConfig, SimState } from '../../../src/sim/types';

export const MOVE_Q = 1024;
export const PING_Q = 64;

/** One encoded command stream per slot. */
export interface SlotStream {
  /** Delta-encoded quantized move x / y (ints). */
  mx: number[];
  my: number[];
  /** Bit flags per tick: 1 grab, 2 dash. */
  fl: number[];
  /** Sparse aim: [tickIndex, ax, ay] (quantized ints). */
  aim: number[][];
  /** Sparse ping: [tickIndex, px, py, targetId | -1]. */
  ping: number[][];
  /** Sparse emote: [tickIndex, emoteId]. */
  emote: [number, string][];
}

export interface IdentityExpect {
  ticks: number;
  events: number;
  logSha: string;
  stateSha: string;
  scores: [number, number];
  reason: string | null;
}

export interface AiMatchFixture {
  name: string;
  layout: string;
  seed: number;
  roster: RosterEntry[];
  rules: Partial<RuleConfig>;
  /** base64(deflate(JSON(SlotStream[]))). */
  commands: string;
  expect: IdentityExpect;
}

export interface FuzzMatchFixture {
  name: string;
  layout: string;
  teams: (0 | 1)[];
  seed: number;
  ticks: number;
  assistEvery: number;
  rules: Partial<RuleConfig>;
  expect: IdentityExpect;
}

export interface IdentityFixture {
  recordedAt: string;
  ai: AiMatchFixture[];
  fuzz: FuzzMatchFixture[];
}

const q = (v: number, s: number): number => Math.round(v * s);

/** Encoder for one slot; `push` returns the exact command the sim must be fed. */
export class StreamEncoder {
  readonly s: SlotStream = { mx: [], my: [], fl: [], aim: [], ping: [], emote: [] };
  private lx = 0;
  private ly = 0;
  private t = 0;

  push(c: Command): Command {
    const mx = Number.isFinite(c.move.x) ? q(c.move.x, MOVE_Q) : 0;
    const my = Number.isFinite(c.move.y) ? q(c.move.y, MOVE_Q) : 0;
    this.s.mx.push(mx - this.lx);
    this.s.my.push(my - this.ly);
    this.lx = mx;
    this.ly = my;
    this.s.fl.push((c.grab ? 1 : 0) | (c.dash ? 2 : 0));
    let aim: number[] | undefined;
    let ping: number[] | undefined;
    let emote: [number, string] | undefined;
    if (c.aim && Number.isFinite(c.aim.x) && Number.isFinite(c.aim.y)) this.s.aim.push((aim = [this.t, q(c.aim.x, MOVE_Q), q(c.aim.y, MOVE_Q)]));
    if (c.ping && Number.isFinite(c.ping.pos.x) && Number.isFinite(c.ping.pos.y)) {
      this.s.ping.push((ping = [this.t, q(c.ping.pos.x, PING_Q), q(c.ping.pos.y, PING_Q), c.ping.targetId ?? -1]));
    }
    if (c.emote) this.s.emote.push((emote = [this.t, c.emote]));
    const fl = this.s.fl[this.t]!;
    this.t++;
    return decode(mx, my, fl, aim, ping, emote);
  }
}

function decode(mx: number, my: number, fl: number, aim: number[] | undefined, ping: number[] | undefined, emote: [number, string] | undefined): Command {
  return {
    move: { x: mx / MOVE_Q, y: my / MOVE_Q },
    grab: (fl & 1) !== 0,
    dash: (fl & 2) !== 0,
    aim: aim ? { x: aim[1]! / MOVE_Q, y: aim[2]! / MOVE_Q } : null,
    ping: ping ? { pos: { x: ping[1]! / PING_Q, y: ping[2]! / PING_Q }, targetId: ping[3]! < 0 ? null : ping[3]! } : null,
    emote: emote ? (emote[1] as EmoteId) : null,
  };
}

/** Sequential decoder (O(1) per tick). */
export class StreamDecoder {
  private t = 0;
  private x = 0;
  private y = 0;
  private ai = 0;
  private pi = 0;
  private ei = 0;
  constructor(private readonly s: SlotStream) {}
  get length(): number {
    return this.s.fl.length;
  }
  next(): Command {
    const s = this.s;
    const t = this.t++;
    this.x += s.mx[t]!;
    this.y += s.my[t]!;
    const aim = s.aim[this.ai]?.[0] === t ? s.aim[this.ai++] : undefined;
    const ping = s.ping[this.pi]?.[0] === t ? s.ping[this.pi++] : undefined;
    const emote = s.emote[this.ei]?.[0] === t ? s.emote[this.ei++] : undefined;
    return decode(this.x, this.y, s.fl[t]!, aim, ping, emote);
  }
}

export function packStreams(streams: SlotStream[]): string {
  return deflateSync(Buffer.from(JSON.stringify(streams)), { level: 9 }).toString('base64');
}

export function unpackStreams(b64: string): SlotStream[] {
  return JSON.parse(inflateSync(Buffer.from(b64, 'base64')).toString('utf8')) as SlotStream[];
}

export const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

/** Digest of the classic (pre-Content-2.0) state fields only. */
export function classicStateDigest(st: SimState): string {
  return sha(
    JSON.stringify({
      tick: st.tick,
      endTick: st.endTick,
      scores: st.scores,
      remaining: st.remainingValue,
      total: st.totalValue,
      ch: st.characters.map((c) => [c.pos.x, c.pos.y, c.vel.x, c.vel.y, c.facing, c.grab?.targetId ?? null, c.dashCooldown, c.knockdownTicks, c.protectTicks]),
      loot: st.loot.map((l) => [l.id, l.pos.x, l.pos.y, l.angle, l.anchored, l.unanchorProgress, l.recovered, l.recoveredBy, l.estimatedValue]),
      fences: st.fences.map((f) => f.broken),
      police: st.police.map((o) => [o.id, o.pos.x, o.pos.y, o.phase]),
    }),
  );
}
