/**
 * 연습 (doc §3 처음 5분): a ~50 s guided practice on the tutorial layout, no time limit, no
 * opponent. Beats (HUD prompt card + highlight + off-screen arrow):
 *   1 find the 100-pt small safe and our van      4 grab the bank wall
 *   2 grab it                                     5 strain until the roots snap
 *   3 bring it into the zone -> +100 (확정)       6 push the bank from BEHIND through the fence
 *                                                 7 recover the whole bank (+ breakdown)
 * then "연습 완료!" and the flow offers the first match vs the 입문 bot (or the menu).
 * Prompts adapt: wandering away from the objective adds a "follow the arrows" hint, letting go
 * steps back to the grab prompt, and pulling the bank from the fence side explains why it
 * stalls. Any order of real progress is accepted (beats only move forward on real events).
 *
 * TutorialDriver is the autotest stand-in for the player: a scripted waypoint follower that
 * plays the practice exactly as the prompts describe (used by the e2e test).
 */
import type { Command, EntityId, LootState, SimEvent, Simulation, Vec2 } from '../sim';
import type { Hud, TutorialPromptModel } from '../ui';
import type { MatchScript } from './match';

export type TutorialBeat = 'find' | 'grabSafe' | 'bring' | 'recovered' | 'bankGrab' | 'uproot' | 'fence' | 'bankRecover' | 'done';

interface BeatDef {
  text: string;
  sub: string | null;
  actions: ('move' | 'grab' | 'dash' | 'ping')[];
  step: number | null;
  done?: boolean;
}

export const TUTORIAL_STEPS = 7;

const BEATS: Record<TutorialBeat, BeatDef> = {
  find: { text: 'tutorial.find', sub: 'tutorial.find.sub', actions: ['move'], step: 1 },
  grabSafe: { text: 'tutorial.grabSafe', sub: 'tutorial.grabSafe.sub', actions: ['grab'], step: 2 },
  bring: { text: 'tutorial.bring', sub: 'tutorial.bring.sub', actions: ['move', 'dash'], step: 3 },
  recovered: { text: 'tutorial.recovered', sub: 'tutorial.recovered.sub', actions: [], step: 3, done: true },
  bankGrab: { text: 'tutorial.bankGrab', sub: 'tutorial.bankGrab.sub', actions: ['grab'], step: 4 },
  uproot: { text: 'tutorial.uproot', sub: 'tutorial.uproot.sub', actions: ['grab', 'move'], step: 5 },
  fence: { text: 'tutorial.fence', sub: 'tutorial.fence.sub', actions: ['move', 'dash'], step: 6 },
  bankRecover: { text: 'tutorial.bankRecover', sub: 'tutorial.bankRecover.sub', actions: ['move'], step: 7 },
  done: { text: 'tutorial.done', sub: 'tutorial.done.sub', actions: [], step: null, done: true },
};

const ORDER: readonly TutorialBeat[] = ['find', 'grabSafe', 'bring', 'recovered', 'bankGrab', 'uproot', 'fence', 'bankRecover', 'done'];

/** Seconds the '+100' celebration stays before the bank beat. */
const RECOVERED_HOLD = 2.6;
/** Seconds the final card stays before the session ends. */
const DONE_HOLD = 3.2;
/** Wandering: this much farther than the best distance this beat, for this long. */
const WANDER_DIST = 7;
const WANDER_SECONDS = 4;
const IDLE_SECONDS = 9;

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Fixed points of the practice yard, derived from the layout (never hard-coded ids). */
export interface TutorialMarks {
  firstSafe: EntityId;
  bank: EntityId;
  zoneCenter: Vec2;
  fence: Vec2 | null;
  /** Where to stand to push the bank home from behind (first back-wall segment). */
  behindBank: Vec2;
  /** Point the push should aim at. */
  pushDir: Vec2;
}

export function tutorialMarks(sim: Simulation): TutorialMarks {
  const st = sim.state;
  const me = st.characters[0]!;
  const bank = st.loot.find((l) => l.kind === 'bank')!;
  const zone = sim.layout.zones.find((z) => z.team === me.team) ?? sim.layout.zones[0]!;
  const outdoor = st.loot.filter((l) => l.kind === 'smallSafe' && l.homeBank === null);
  outdoor.sort((a, b) => dist(a.pos, me.pos) - dist(b.pos, me.pos));
  const toZone = { x: zone.center.x - bank.pos.x, y: zone.center.y - bank.pos.y };
  const l = Math.hypot(toZone.x, toZone.y) || 1;
  const dir = { x: toZone.x / l, y: toZone.y / l };
  // The wall opposite the zone, offset sideways off the door gap (doors are wall centers).
  const side = { x: -dir.y, y: dir.x };
  const back = { x: bank.pos.x - dir.x * (bank.half.y + 0.85), y: bank.pos.y - dir.y * (bank.half.y + 0.85) };
  const f = sim.state.fences[0];
  return {
    firstSafe: (outdoor[0] ?? st.loot.find((x) => x.kind !== 'bank')!).id,
    bank: bank.id,
    zoneCenter: { ...zone.center },
    fence: f ? { ...f.center } : null,
    behindBank: { x: back.x + side.x * 2.4, y: back.y + side.y * 2.4 },
    pushDir: dir,
  };
}

export interface TutorialEvents {
  /** The practice is over (bank recovered and the final card shown). */
  onComplete?(): void;
}

export class TutorialDirector implements MatchScript {
  private beat: TutorialBeat = 'find';
  private beatTime = 0;
  private bestDist = Infinity;
  private farTime = 0;
  private idleTime = 0;
  private notHolding = 0;
  private wander = false;
  private frontPull = false;
  private regrab = false;
  private lastPrompt = '';
  private finishedFlag = false;
  private readonly marks: TutorialMarks;
  private readonly driver: TutorialDriver | null;
  private lastPos: Vec2;

  constructor(
    private readonly sim: Simulation,
    private readonly meId: EntityId,
    private readonly hud: Hud,
    opts: { autopilot?: boolean; events?: TutorialEvents } = {},
  ) {
    this.marks = tutorialMarks(sim);
    this.driver = opts.autopilot ? new TutorialDriver(sim, meId, this.marks) : null;
    this.events = opts.events ?? {};
    this.lastPos = { ...sim.getCharacter(meId)!.pos };
    this.paint();
  }

  private readonly events: TutorialEvents;

  get finished(): boolean {
    return this.finishedFlag;
  }

  get currentBeat(): TutorialBeat {
    return this.beat;
  }

  get marksRef(): TutorialMarks {
    return this.marks;
  }

  autopilot(sim: Simulation): Command | null {
    return this.driver ? this.driver.command(sim) : null;
  }

  private go(b: TutorialBeat): void {
    if (ORDER.indexOf(b) < ORDER.indexOf(this.beat) && !(b === 'grabSafe' && this.beat === 'bring') && !(b === 'bankGrab' && (this.beat === 'uproot' || this.beat === 'fence' || this.beat === 'bankRecover'))) return;
    if (b === this.beat) return;
    this.beat = b;
    this.beatTime = 0;
    this.bestDist = Infinity;
    this.farTime = 0;
    this.wander = false;
    this.frontPull = false;
    this.regrab = false;
    this.notHolding = 0;
    if (b === 'done') this.hud.banner('practiceDone', undefined, 2600);
    this.paint();
  }

  onEvents(events: readonly SimEvent[], sim: Simulation): void {
    for (const e of events) {
      switch (e.type) {
        case 'grab':
          if (e.charId !== this.meId) break;
          if (e.part === 'safe' && (this.beat === 'find' || this.beat === 'grabSafe')) this.go('bring');
          else if (e.part === 'bankWall' && ORDER.indexOf(this.beat) <= ORDER.indexOf('bankGrab')) {
            const bank = sim.getLoot(e.targetId);
            this.go(bank && bank.anchored ? 'uproot' : 'fence');
          } else if (e.part === 'bankWall' && this.regrab) {
            this.regrab = false;
            this.paint();
          }
          break;
        case 'unanchored':
          if (e.kind === 'bank' && ORDER.indexOf(this.beat) < ORDER.indexOf('fence')) this.go('fence');
          break;
        case 'fenceBroken':
          if (ORDER.indexOf(this.beat) < ORDER.indexOf('bankRecover')) this.go('bankRecover');
          break;
        case 'recovered':
          if (e.kind === 'bank') this.go('done');
          else if (ORDER.indexOf(this.beat) < ORDER.indexOf('recovered')) this.go('recovered');
          break;
        default:
          break;
      }
    }
  }

  update(dt: number, sim: Simulation): void {
    if (this.finishedFlag) return;
    this.beatTime += dt;
    const me = sim.getCharacter(this.meId);
    if (!me) return;
    const moved = dist(me.pos, this.lastPos);
    this.lastPos = { ...me.pos };
    this.idleTime = moved > 0.01 ? 0 : this.idleTime + dt;

    if (this.beat === 'find') {
      const safe = sim.getLoot(this.marks.firstSafe);
      if (safe && !safe.recovered && dist(me.pos, safe.pos) < 3.2 && this.beatTime > 1.2) this.go('grabSafe');
    } else if (this.beat === 'recovered' && this.beatTime > RECOVERED_HOLD) {
      this.go('bankGrab');
    } else if (this.beat === 'done' && this.beatTime > DONE_HOLD) {
      this.finishedFlag = true;
      this.events.onComplete?.();
      return;
    }

    // Letting go steps back to the grab prompt (after a short grace).
    const holding = me.grab !== null;
    if (this.beat === 'bring' || this.beat === 'uproot' || this.beat === 'fence' || this.beat === 'bankRecover') {
      this.notHolding = holding ? 0 : this.notHolding + dt;
      if (this.beat === 'bring' && this.notHolding > 1.5) this.go('grabSafe');
      else if (this.beat === 'uproot' && this.notHolding > 1.5) this.go('bankGrab');
      const needRegrab = (this.beat === 'fence' || this.beat === 'bankRecover') && this.notHolding > 2;
      if (needRegrab !== this.regrab) {
        this.regrab = needRegrab;
        this.paint();
      }
    }

    // Pulling from the fence side stalls (layout note): explain once it happens.
    if (this.beat === 'fence' || this.beat === 'uproot') {
      const bank = sim.getLoot(this.marks.bank);
      const front = !!bank && holding && me.grab?.targetId === bank.id && this.sideOf(me.pos, bank) > 0.5;
      if (front !== this.frontPull) {
        this.frontPull = front;
        this.paint();
      }
    }

    // Wandering away from the objective -> "follow the arrows" hint.
    const goal = this.objectivePoint(sim);
    if (goal) {
      const d = dist(me.pos, goal);
      this.bestDist = Math.min(this.bestDist, d);
      this.farTime = d > this.bestDist + WANDER_DIST ? this.farTime + dt : 0;
      const w = this.farTime > WANDER_SECONDS || (this.idleTime > IDLE_SECONDS && d > 4);
      if (w !== this.wander) {
        this.wander = w;
        if (!w) this.bestDist = d;
        this.paint();
      }
    }
  }

  /** >0: the point is on the zone side of the bank (in front, where pulling stalls). */
  private sideOf(p: Vec2, bank: LootState): number {
    const d = this.marks.pushDir;
    return (p.x - bank.pos.x) * d.x + (p.y - bank.pos.y) * d.y - bank.half.y;
  }

  private objectivePoint(sim: Simulation): Vec2 | null {
    switch (this.beat) {
      case 'find':
      case 'grabSafe': {
        const s = sim.getLoot(this.marks.firstSafe);
        if (s && !s.recovered) return s.pos;
        const any = sim.state.loot.find((l) => l.kind !== 'bank' && !l.recovered && l.homeBank === null);
        return any ? any.pos : null;
      }
      case 'bring':
      case 'bankRecover':
        return this.marks.zoneCenter;
      case 'bankGrab':
      case 'uproot':
        return this.marks.behindBank;
      case 'fence':
        return this.marks.fence ?? this.marks.zoneCenter;
      default:
        return null;
    }
  }

  focusTargets(): readonly EntityId[] {
    switch (this.beat) {
      case 'find':
      case 'grabSafe': {
        const s = this.sim.getLoot(this.marks.firstSafe);
        if (s && !s.recovered) return [s.id];
        const any = this.sim.state.loot.find((l) => l.kind !== 'bank' && !l.recovered && l.homeBank === null);
        return any ? [any.id] : [];
      }
      case 'bankGrab':
      case 'uproot':
        return [this.marks.bank];
      default:
        return [];
    }
  }

  focusPoint(): Vec2 | null {
    if (this.beat === 'bring' || this.beat === 'bankRecover' || this.beat === 'find') return this.marks.zoneCenter;
    if (this.beat === 'bankGrab' || this.beat === 'uproot') return this.marks.behindBank;
    return null;
  }

  private paint(): void {
    const def = BEATS[this.beat];
    let sub: string | null = def.sub;
    if (this.regrab) sub = 'tutorial.regrab';
    else if (this.frontPull) sub = 'tutorial.frontPull';
    else if (this.wander) sub = this.beat === 'bankGrab' || this.beat === 'uproot' ? 'tutorial.wanderBank' : 'tutorial.wander';
    const model: TutorialPromptModel = {
      text: def.text,
      sub,
      actions: def.actions,
      step: def.step ?? undefined,
      total: def.step ? TUTORIAL_STEPS : undefined,
      skipAction: this.beat === 'done' ? null : 'pause',
      done: def.done ?? false,
    };
    const key = JSON.stringify(model);
    if (key === this.lastPrompt) return;
    this.lastPrompt = key;
    this.hud.setTutorialPrompt(model);
  }

  dispose(): void {
    this.hud.setTutorialPrompt(null);
  }
}

// ---------------------------------------------------------------------------------------------
// Autotest driver
// ---------------------------------------------------------------------------------------------

const toward = (from: Vec2, to: Vec2): Vec2 => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return { x: 0, y: 0 };
  const k = Math.min(1, d / 0.5);
  return { x: (dx / d) * k, y: (dy / d) * k };
};

/**
 * Scripted player for the practice (autotest only): carries the first small safe home, walks
 * round to the back of the bank along the arrows, uproots it and pushes it home through the
 * fence — exactly what the prompts ask for.
 */
export class TutorialDriver {
  private phase: 'toSafe' | 'carry' | 'toBank' | 'push' | 'idle' = 'toSafe';
  private wp = 0;
  private readonly route: Vec2[];

  constructor(
    sim: Simulation,
    private readonly meId: EntityId,
    private readonly marks: TutorialMarks,
  ) {
    // Arrows of the practice yard: north gate, along the hedge, round to the back of the bank.
    const L = sim.layout;
    const gate = L.chokepoints.find((c) => c.id.toLowerCase().includes('north'))?.pos ?? { x: L.size.x / 2, y: 2.75 };
    const b = marks.behindBank;
    this.route = [
      { x: gate.x - 4, y: gate.y + 1.2 },
      { x: gate.x, y: gate.y },
      { x: gate.x + 4, y: gate.y },
      { x: b.x - 1.5, y: gate.y + 2.6 },
      { x: b.x + 0.4, y: gate.y + 4.8 },
      { x: b.x, y: b.y },
    ];
  }

  command(sim: Simulation): Command {
    const me = sim.getCharacter(this.meId)!;
    const none: Command = { move: { x: 0, y: 0 }, grab: false, dash: false, aim: null, ping: null };
    if (me.knockdownTicks > 0) return none;
    const safe = sim.getLoot(this.marks.firstSafe);
    const bank = sim.getLoot(this.marks.bank);
    if (this.phase === 'toSafe') {
      if (!safe || safe.recovered) {
        this.phase = 'toBank';
        return none;
      }
      const cand = sim.getGrabCandidate(this.meId);
      if (me.grab && me.grab.targetId === safe.id) this.phase = 'carry';
      else if (cand && cand.targetId === safe.id) return { move: { x: 0, y: 0 }, grab: true, dash: false, aim: { x: safe.pos.x - me.pos.x, y: safe.pos.y - me.pos.y }, ping: null };
      else return { move: dist(me.pos, safe.pos) > 1.25 ? toward(me.pos, safe.pos) : { x: 0, y: 0 }, grab: false, dash: false, aim: { x: safe.pos.x - me.pos.x, y: safe.pos.y - me.pos.y }, ping: null };
    }
    if (this.phase === 'carry') {
      if (!safe || safe.recovered) {
        this.phase = 'toBank';
        return none;
      }
      if (!me.grab) {
        this.phase = 'toSafe';
        return none;
      }
      // Walk so the safe (trailing behind) ends inside the zone, then wait for the dwell.
      const z = this.marks.zoneCenter;
      const inZone = safe.recovery !== null;
      const target = { x: z.x + (z.x - safe.pos.x) * 0.2, y: z.y + (z.y - safe.pos.y) * 0.2 };
      return { move: inZone ? { x: 0, y: 0 } : toward(me.pos, target), grab: true, dash: false, aim: null, ping: null };
    }
    if (this.phase === 'toBank') {
      if (!bank || bank.recovered) {
        this.phase = 'idle';
        return none;
      }
      const p = this.route[this.wp]!;
      if (dist(me.pos, p) < (this.wp === this.route.length - 1 ? 0.35 : 0.9)) {
        if (this.wp < this.route.length - 1) this.wp++;
        else this.phase = 'push';
      }
      return { move: toward(me.pos, this.route[this.wp]!), grab: false, dash: false, aim: null, ping: null };
    }
    if (this.phase === 'push') {
      if (!bank || bank.recovered) {
        this.phase = 'idle';
        return none;
      }
      const d = this.marks.pushDir;
      const holdingBank = me.grab?.targetId === bank.id;
      if (!holdingBank) {
        // Face the back wall and grab it.
        return { move: { x: 0, y: 0 }, grab: true, dash: false, aim: { x: d.x, y: d.y }, ping: null };
      }
      // Push toward the zone (steer the bank's center onto the zone center).
      const z = this.marks.zoneCenter;
      const toZ = { x: z.x - bank.pos.x, y: z.y - bank.pos.y };
      const l = Math.hypot(toZ.x, toZ.y);
      const inZone = bank.recovery !== null;
      const mv = inZone || l < 0.3 ? { x: 0, y: 0 } : { x: toZ.x / l, y: toZ.y / l };
      return { move: mv, grab: true, dash: false, aim: null, ping: null };
    }
    return none;
  }
}
