/**
 * Scripted audio scenes (dev only): a fake simulation view plus the events the real sim would
 * emit, tick by tick, so the REAL MatchAudioDirector + AudioEngine can be heard live in the
 * gallery and rendered offline for QA (src/audio/dev/directorRender.ts).
 *
 *   policeChase  20 s: a car drives in with its siren (doppler), skids, doors; two officers spot
 *                and chase the player (whistles, "멈춰!", chase music) while a bank alarm rings
 *                nearby; recoveries (coins must stay clear), a dodged tackle, a raccoon dash
 *                stuns an officer, a tackle lands on the player, a steal, the officers walk back
 *                and the car leaves ("phew").
 *   uproot       13 s: small safe, large safe and bank uproot choreographies (strain build-up,
 *                POP, landing, callouts) ending with the bank's alarm.
 */
import type { AudioSimView } from '../director';
import type { CharacterState, EntityId, LootState, PoliceCarState, PoliceOfficerState, SimEvent, SimState, Vec2 } from '../../sim/types';

export interface ScriptedScene {
  readonly name: string;
  readonly seconds: number;
  readonly view: AudioSimView;
  /** Character id of the local player (listener). */
  readonly listenerId: EntityId;
  /** Advance one 60 Hz tick: mutates the view's state and returns that tick's events. */
  step(): SimEvent[];
}

const T = 60;

function char(id: number, team: 0 | 1, pos: Vec2): CharacterState {
  return {
    id, slot: id - 1, team, name: `c${id}`, isBot: id !== 1, look: { hat: 'none' }, pos: { ...pos }, vel: { x: 0, y: 0 }, facing: 0,
    moveIntent: { x: 0, y: 0 }, grab: null, straining: false, dashTicks: 0, dashCooldown: 0, boostTicks: 0,
    knockdownTicks: 0, protectTicks: 0, floorOf: null,
  };
}

function loot(id: number, kind: LootState['kind'], pos: Vec2, extra: Partial<LootState> = {}): LootState {
  return {
    id, kind, baseValue: kind === 'bank' ? 500 : kind === 'largeSafe' ? 300 : 100, pos: { ...pos }, angle: 0, vel: { x: 0, y: 0 }, angVel: 0,
    half: kind === 'bank' ? { x: 3, y: 2.5 } : { x: 0.4, y: 0.4 }, anchored: false, unanchorProgress: 1, recovered: false, recoveredBy: null,
    recoveredTick: null, grabbedBy: [], recovery: null, floorOf: null, loadedIn: null, homeBank: null, loadedSafes: [],
    estimatedValue: kind === 'bank' ? 500 : kind === 'largeSafe' ? 300 : 100, lastHolder: null, ...extra,
  };
}

function baseState(chars: CharacterState[], loots: LootState[]): SimState {
  return {
    layoutId: 'plaza', tick: 0, endTick: 240 * T, over: false, result: null, scores: [0, 0], characters: chars, loot: loots, fences: [],
    banksRecovered: 0, finalCountdown: false, finalCountdownTick: null, remainingValue: 3200, totalValue: 3200, pings: [], police: [],
    policeCars: [], alarm: { ringing: [], dispatchTick: null, waves: 0 },
    coins: [], breakables: [], items: [], hazards: [], projectiles: [], gimmicks: [], matchEvents: [], eventPlan: null,
  };
}

function viewOf(state: SimState): AudioSimView {
  return {
    state,
    getLoot: (id) => state.loot.find((l) => l.id === id),
    getCharacter: (id) => state.characters.find((c) => c.id === id),
  };
}

/** Move a body toward a point at `speed` (m/s), stopping `keep` m short; updates vel/facing. */
function chase(p: { pos: Vec2; vel: Vec2; facing: number }, to: Vec2, speed: number, keep = 0): void {
  const dx = to.x - p.pos.x;
  const dy = to.y - p.pos.y;
  const d = Math.hypot(dx, dy);
  const stepLen = Math.max(0, Math.min(speed / T, d - keep));
  const nx = d > 1e-6 ? dx / d : 0;
  const ny = d > 1e-6 ? dy / d : 0;
  p.pos = { x: p.pos.x + nx * stepLen, y: p.pos.y + ny * stepLen };
  p.vel = { x: nx * stepLen * T, y: ny * stepLen * T };
  if (stepLen > 0) p.facing = Math.atan2(ny, nx);
}

const easeOut = (u: number): number => 1 - (1 - u) * (1 - u);
const easeIn = (u: number): number => u * u;

export function policeChaseScene(): ScriptedScene {
  const me = char(1, 0, { x: 3, y: 2 });
  const rival = char(2, 1, { x: 16, y: 10 });
  const mate = char(3, 0, { x: -8, y: 6 });
  const carried = loot(30, 'smallSafe', { x: 3, y: 2 }, { grabbedBy: [1] });
  const dragged = loot(32, 'largeSafe', { x: -8, y: 6 }, { grabbedBy: [3] });
  const rivalSafe = loot(31, 'smallSafe', { x: 12, y: 9 }, { anchored: true, unanchorProgress: 0.6, grabbedBy: [2] });
  const bank = loot(20, 'bank', { x: 11, y: -5 });
  const stolen = loot(33, 'largeSafe', { x: 8, y: -4 }, { loadedIn: 20, floorOf: 20 });
  const state = baseState([me, rival, mate], [carried, dragged, rivalSafe, bank, stolen]);
  state.alarm.ringing = [20];
  me.grab = { targetId: 30, part: 'safe', anchorLocal: { x: 0, y: 0 } };
  mate.grab = { targetId: 32, part: 'safe', anchorLocal: { x: 0, y: 0 } };
  rival.grab = { targetId: 31, part: 'safe', anchorLocal: { x: 0, y: 0 } };
  rival.straining = true;
  const view = viewOf(state);
  const entry = { from: { x: 4, y: -30 }, park: { x: 4, y: -16 } };
  let carState: PoliceCarState | null = null;
  const off: PoliceOfficerState[] = [];
  const officerAt = (id: number): PoliceOfficerState | undefined => off.find((o) => o.id === id);
  let tick = 0;
  return {
    name: 'policeChase',
    seconds: 20,
    view,
    listenerId: 1,
    step(): SimEvent[] {
      tick++;
      state.tick = tick;
      const t = tick / T;
      const ev: SimEvent[] = [];
      const at = (s: number): boolean => tick === Math.round(s * T);
      // --- the player weaves around (footsteps), knocked down at 13.15 s ---
      if (me.knockdownTicks > 0) {
        me.knockdownTicks--;
        me.vel = { x: 0, y: 0 };
        me.moveIntent = { x: 0, y: 0 };
      } else {
        const prev = me.pos;
        me.pos = { x: 3 + 5 * Math.sin(0.35 * t), y: 2 + 3 * Math.sin(0.5 * t) };
        me.vel = { x: (me.pos.x - prev.x) * T, y: (me.pos.y - prev.y) * T };
        me.moveIntent = { x: Math.sign(me.vel.x) * 0.9, y: 0.3 };
      }
      if (me.grab) carried.pos = { ...me.pos };
      mate.pos = { x: -8 + 0.8 * t, y: 6 };
      mate.vel = { x: 0.8, y: 0 };
      mate.moveIntent = { x: 0.6, y: 0 };
      if (mate.grab) {
        dragged.pos = { x: mate.pos.x - 0.6, y: 6 };
        dragged.vel = { x: 0.8, y: 0 };
      }
      // Rival straining a safe out (strain loop), pops at 9.5 s.
      if (rivalSafe.anchored) rivalSafe.unanchorProgress = Math.min(1, 0.6 + 0.4 * (t / 9.5));
      if (at(9.5)) {
        rivalSafe.anchored = false;
        rival.straining = false;
        ev.push({ type: 'unanchored', tick, lootId: 31, kind: 'smallSafe', byTeam: 1 });
      }
      // --- the bank alarm has been ringing for 14 s ---
      if (tick === 1) ev.push({ type: 'alarm', tick: -14 * T, bankId: 20, dispatchTick: 0 });
      // --- police car ---
      if (tick === 1) {
        carState = { id: 1, entryIndex: 0, pos: { ...entry.from }, angle: Math.PI / 2, phase: 'arriving', sirenOn: true, wave: 1 };
        state.policeCars.push(carState);
        ev.push({ type: 'policeDispatched', tick, carId: 1, wave: 1, officerIds: [1001, 1002], entryIndex: 0 });
      }
      const c = carState;
      if (c && c.phase === 'arriving') {
        const u = Math.min(1, t / 2);
        const k = easeOut(u);
        c.pos = { x: entry.from.x + (entry.park.x - entry.from.x) * k, y: entry.from.y + (entry.park.y - entry.from.y) * k };
        if (u >= 1) {
          c.phase = 'parked';
          ev.push({ type: 'policeArrived', tick, carId: 1, pos: { ...c.pos } });
          for (const [id, x] of [[1001, 3.4], [1002, 4.6]] as const) {
            off.push({ id, carId: 1, pos: { x, y: -13.5 }, vel: { x: 0, y: 0 }, facing: Math.PI / 2, phase: 'arriving', targetCharId: null, tackleTicks: 0, stunTicks: 0, tiredTicks: 0, activeTicks: 0 });
          }
          state.police = off;
        }
      }
      // --- officers ---
      const o1 = officerAt(1001);
      const o2 = officerAt(1002);
      if (o1 && o2) {
        if (at(2.6)) o1.phase = o2.phase = 'patrol';
        if (at(3)) {
          o1.phase = 'chase';
          o1.targetCharId = 1;
          ev.push({ type: 'policeSpotted', tick, officerId: 1001, charId: 1 });
        }
        if (at(4.5)) {
          o2.phase = 'chase';
          o2.targetCharId = 3;
          ev.push({ type: 'policeSpotted', tick, officerId: 1002, charId: 3 });
        }
        if (at(9)) {
          o2.targetCharId = 1;
          ev.push({ type: 'policeSpotted', tick, officerId: 1002, charId: 1 });
        }
        // 1001: lunge at 8.5 s (misses), tired, chase, stunned by the player's dash at 12.1 s.
        if (at(8.5)) {
          o1.phase = 'tackle';
          o1.tackleTicks = 13;
        }
        if (at(8.72)) {
          o1.phase = 'tired';
          o1.tackleTicks = 0;
          ev.push({ type: 'policeTackle', tick, officerId: 1001, victimId: 1, hit: false });
        }
        if (at(10.3)) o1.phase = 'chase';
        if (at(12)) ev.push({ type: 'dash', tick, charId: 1, carrying: true });
        if (at(12.1)) {
          o1.phase = 'stunned';
          ev.push({ type: 'policeStunned', tick, officerId: 1001, byCharId: 1 });
        }
        if (at(13.9)) o1.phase = 'chase';
        // 1002: lunge at 13 s, lands at 13.15 s.
        if (at(13)) {
          o2.phase = 'tackle';
          o2.tackleTicks = 13;
        }
        if (at(13.15)) {
          o2.phase = 'tired';
          o2.targetCharId = null;
          me.grab = null;
          me.knockdownTicks = 90;
          ev.push({ type: 'release', tick, charId: 1, targetId: 30, forced: true });
          ev.push({ type: 'policeTackle', tick, officerId: 1002, victimId: 1, hit: true });
        }
        if (at(16)) {
          o1.phase = o2.phase = 'leaving';
          o1.targetCharId = o2.targetCharId = null;
        }
        for (const o of [o1, o2]) {
          if (o.phase === 'chase' && o.targetCharId !== null) {
            const target = state.characters.find((x) => x.id === o.targetCharId)!;
            chase(o, target.pos, 4.4, 2.6);
          } else if (o.phase === 'tackle') {
            chase(o, me.pos, 8.5, 0.6);
          } else if (o.phase === 'leaving') {
            chase(o, { x: o.id === 1001 ? 3.4 : 4.6, y: -13.5 }, 3.5);
          } else {
            o.vel = { x: 0, y: 0 };
          }
        }
        if (at(17.4)) {
          o1.phase = o2.phase = 'gone';
          state.police = [];
        }
      }
      if (c && at(17.5)) {
        c.phase = 'leaving';
        c.sirenOn = false;
        ev.push({ type: 'policeLeaving', tick, carId: 1 });
      }
      if (c && c.phase === 'leaving') {
        const u = Math.min(1, (t - 17.5) / 2);
        const k = easeIn(u);
        c.pos = { x: entry.park.x + (entry.from.x - entry.park.x) * k, y: entry.park.y + (entry.from.y - entry.park.y) * k };
        if (u >= 1) {
          c.phase = 'gone';
          state.policeCars = [];
          ev.push({ type: 'policeGone', tick, carId: 1 });
        }
      }
      // --- scoring: coins must stay clear over sirens, bells and whistles ---
      if (at(6)) {
        carried.recovered = true;
        me.grab = null;
        state.scores[0] += 100;
        ev.push({ type: 'recovered', tick, lootId: 30, kind: 'smallSafe', team: 0, value: 100, safeIds: [], safesValue: 0, holders: [1] });
        // ...and the player picks up another one right away.
        carried.recovered = false;
        me.grab = { targetId: 30, part: 'safe', anchorLocal: { x: 0, y: 0 } };
      }
      if (at(7.5)) {
        dragged.recovered = true;
        mate.grab = null;
        state.scores[0] += 300;
        ev.push({ type: 'recovered', tick, lootId: 32, kind: 'largeSafe', team: 0, value: 300, safeIds: [], safesValue: 0, holders: [3] });
      }
      if (at(15)) ev.push({ type: 'safeUnloaded', tick, safeId: 33, bankId: 20, bankValue: 500, byCharId: 1, bankCarrierTeam: 1 });
      if (at(18)) {
        state.scores[0] += 100;
        ev.push({ type: 'recovered', tick, lootId: 30, kind: 'smallSafe', team: 0, value: 100, safeIds: [], safesValue: 0, holders: [1] });
      }
      return ev;
    },
  };
}

export function uprootScene(): ScriptedScene {
  const me = char(1, 0, { x: 0, y: 0 });
  const mate = char(3, 0, { x: 1, y: 0 });
  const small = loot(30, 'smallSafe', { x: 1.2, y: 0.5 }, { anchored: true, unanchorProgress: 0 });
  const large = loot(31, 'largeSafe', { x: -1.5, y: 1 }, { anchored: true, unanchorProgress: 0 });
  const bank = loot(20, 'bank', { x: 4, y: -4 }, { anchored: true, unanchorProgress: 0 });
  const state = baseState([me, mate], [small, large, bank]);
  const view = viewOf(state);
  // [loot, start s, seconds of pulling]
  const pulls: [LootState, number, number][] = [
    [small, 0.3, 1],
    [large, 2.2, 2],
    [bank, 5.2, 3],
  ];
  let tick = 0;
  return {
    name: 'uproot',
    seconds: 13,
    view,
    listenerId: 1,
    step(): SimEvent[] {
      tick++;
      state.tick = tick;
      const t = tick / T;
      const ev: SimEvent[] = [];
      for (const [l, start, dur] of pulls) {
        if (!l.anchored) continue;
        const u = (t - start) / dur;
        const holders = l.kind === 'bank' ? [1, 3] : [1];
        if (u >= 0 && u < 1) {
          l.unanchorProgress = u;
          l.grabbedBy = holders;
          for (const id of holders) state.characters.find((c) => c.id === id)!.straining = true;
        } else if (u >= 1) {
          l.anchored = false;
          l.unanchorProgress = 1;
          for (const id of holders) state.characters.find((c) => c.id === id)!.straining = false;
          ev.push({ type: 'unanchored', tick, lootId: l.id, kind: l.kind, byTeam: 0 });
          if (l.kind === 'bank') {
            state.alarm.ringing.push(l.id);
            ev.push({ type: 'alarm', tick, bankId: l.id, dispatchTick: tick + 12 * T });
          }
        }
      }
      return ev;
    },
  };
}

export const SCENES = { policeChase: policeChaseScene, uproot: uprootScene } as const;
export type SceneId = keyof typeof SCENES;
