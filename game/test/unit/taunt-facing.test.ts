/**
 * Taunt facing vs the camera (pose review: a 메롱 aimed at a rival "up" the screen showed only the
 * back of the head and the hat). With `TauntWorld.cameraDir`, the face taunts turn toward the
 * rival but never more than TAUNT_FACE_MAX_OFF away from the camera; the wiggle keeps its back to
 * a rival and, alone, wiggles at the camera. Without a camera the old rules hold.
 */
import { describe, expect, it } from 'vitest';
import { TAUNT_FACE_MAX_OFF, TauntTracker, type TauntWorld } from '../../src/render/taunts';
import { EMOTE } from '../../src/sim/config';
import type { CharacterState, EmoteId, Vec2 } from '../../src/sim/types';

function char(id: number, team: 0 | 1, pos: Vec2, facing = 0): CharacterState {
  return {
    id, slot: id - 1, team, name: `c${id}`, isBot: id !== 1, look: { hat: 'none' }, pos, vel: { x: 0, y: 0 }, facing,
    moveIntent: { x: 0, y: 0 }, grab: null, straining: false, dashTicks: 0, dashCooldown: 0, boostTicks: 0,
    knockdownTicks: 0, protectTicks: 0, floorOf: null, emote: null,
  };
}

/** Camera "south" of everyone (+y), like the match camera looking up the screen. */
function world(chars: CharacterState[], cam: Vec2 | null = { x: 0, y: 1 }): TauntWorld {
  return {
    posOf: (id) => chars.find((c) => c.id === id)?.pos ?? null,
    nearestOpponent: (c) => chars.find((o) => o.team !== c.team && Math.hypot(o.pos.x - c.pos.x, o.pos.y - c.pos.y) <= EMOTE.nearOpponentRadius)?.id ?? null,
    cameraDir: cam ? () => cam : undefined,
  };
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const angleTo = (a: number, b: number) => Math.abs(wrap(a - b));
const CAM = Math.PI / 2; // atan2(1, 0)

function sample(id: EmoteId, me: CharacterState, w: TauntWorld) {
  const tr = new TauntTracker();
  me.emote = { id, startTick: 10, endTick: 10 + EMOTE.durationTicks[id] };
  return tr.update(me, 20, w)!;
}

describe('taunt facing keeps the face readable from the camera', () => {
  const faceIds: EmoteId[] = ['bleh', 'fanCash', 'squatBounce', 'hodadakZoom', 'tongkeunFlex', 'nunchiShrug'];

  it('a rival up the screen (away from the camera): face taunts turn a 3/4 view toward it, not their back', () => {
    for (const id of faceIds) {
      for (const rx of [3, -3, 0.5]) {
        const me = char(1, 0, { x: 0, y: 0 });
        const rival = char(3, 1, { x: rx, y: -3 });
        const s = sample(id, me, world([me, rival]));
        expect(angleTo(s.facing!, CAM)).toBeLessThanOrEqual(TAUNT_FACE_MAX_OFF + 1e-9);
        // still turned toward the rival's side
        expect(Math.sign(Math.cos(s.facing!))).toBe(Math.sign(rx));
      }
    }
  });

  it('a rival behind the taunter is mirrored to the camera side: straight up -> at the camera, never an arbitrary side', () => {
    for (const id of faceIds) {
      const me = char(1, 0, { x: 0, y: 0 });
      const up = sample(id, me, world([me, char(3, 1, { x: 0, y: -2.4 })]));
      expect(angleTo(up.facing!, CAM)).toBeLessThan(1e-9);
      // straight right stays a bounded turn to the right; up-right is the mirror of down-right
      const right = sample(id, me, world([me, char(3, 1, { x: 2.4, y: 0 })])).facing!;
      expect(angleTo(right, CAM)).toBeCloseTo(TAUNT_FACE_MAX_OFF);
      expect(Math.cos(right)).toBeGreaterThan(0);
      const upRight = sample(id, me, world([me, char(3, 1, { x: 2, y: -2 })])).facing!;
      const downRight = sample(id, me, world([me, char(3, 1, { x: 2, y: 2 })])).facing!;
      expect(upRight).toBeCloseTo(downRight);
      expect(angleTo(up.facing!, right)).toBeGreaterThan(0.5); // "up" no longer looks like "right"
      // continuous as the rival walks around behind: no jump across straight-up
      const l = sample(id, me, world([me, char(3, 1, { x: -0.05, y: -2.4 })])).facing!;
      const r = sample(id, me, world([me, char(3, 1, { x: 0.05, y: -2.4 })])).facing!;
      expect(angleTo(l, r)).toBeLessThan(0.05);
    }
  });

  it('a rival toward the camera or beside: faces it exactly', () => {
    const me = char(1, 0, { x: 0, y: 0 });
    const rival = char(3, 1, { x: 2, y: 3 });
    const s = sample('bleh', me, world([me, rival]));
    expect(s.facing).toBeCloseTo(Math.atan2(3, 2));
  });

  it('nobody in front: a face taunt turns from its own facing toward the camera (bounded)', () => {
    const me = char(1, 0, { x: 0, y: 0 }, -Math.PI / 2); // walked up the screen
    const s = sample('fanCash', me, world([me]));
    expect(angleTo(s.facing!, CAM)).toBeCloseTo(TAUNT_FACE_MAX_OFF);
    const side = char(1, 0, { x: 0, y: 0 }, Math.PI / 2 - 0.3); // already 3/4 to the camera
    expect(sample('fanCash', side, world([side])).facing).toBeCloseTo(Math.PI / 2 - 0.3);
  });

  it('the wiggle keeps its back to a rival anywhere; alone it wiggles its bottom at the camera', () => {
    const me = char(1, 0, { x: 0, y: 0 });
    const north = char(3, 1, { x: 0, y: -3 });
    expect(angleTo(sample('wiggle', me, world([me, north])).facing!, Math.PI / 2)).toBeLessThan(1e-9); // back to the rival up the screen
    const alone = char(1, 0, { x: 0, y: 0 }, Math.PI / 2); // facing the camera
    const s = sample('wiggle', alone, world([alone]));
    expect(angleTo(s.facing!, CAM + Math.PI)).toBeLessThanOrEqual(TAUNT_FACE_MAX_OFF + 1e-9);
  });

  it('without a camera direction the old rules hold', () => {
    const me = char(1, 0, { x: 0, y: 0 });
    const rival = char(3, 1, { x: 0, y: -3 });
    expect(sample('bleh', me, world([me, rival], null)).facing).toBeCloseTo(-Math.PI / 2);
    const alone = char(1, 0, { x: 0, y: 0 });
    expect(sample('bleh', alone, world([alone], null)).facing).toBeNull();
  });
});
