/**
 * Mood director: turns sim events and state into emotes (emotes.ts) and face overrides so every
 * raccoon (and puppy officer) visibly reacts — docs/ART_DIRECTION.md §1 "모든 것이 반응".
 *
 *   grabbing something big ............ determination flame
 *   straining (unanchor progress) ..... flame -> sweat -> panic lines + >_<
 *   uproot pop ........................ holders tumble onto their bottoms, spring up ^^ +
 *                                       sparkles; bystanders "!"
 *   knocked down ...................... dizzy swirl (attacker: smug note)
 *   forced release / loot stolen ...... !? / anger vein (thief: coin)
 *   scoring ........................... hearts for the team, tears / anger for the rivals
 *   police spotted / tackled .......... "!" + panic lines / dizzy (officer: whistle)
 *   alarm, final countdown ............ "!" then nervous sweat in the last 10 s
 *   idle ............................... a whistled note now and then
 *
 * Officers (state.police): "!" on spotting, "stop" paw while chasing, breath puffs when tired,
 * dizzy swirl when stunned, whistle when arriving / after a tackle.
 *
 * Pure presentation: reads public state only, never touches the sim.
 */
import type { EntityId, PoliceOfficerState, SimEvent, Simulation, TeamId, Vec2 } from '../sim';
import { TICK_RATE } from '../sim';
import type { RaccoonExpression } from './models';
import { POLICE_OWNER, type EmoteKind, type EmoteOptions, type EmoteSystem } from './emotes';

interface CharMood {
  stage: number;
  idleFor: number;
  nextIdle: number;
  face: RaccoonExpression | null;
  faceUntil: number;
  tumbleStart: number;
  nextNervous: number;
  sparkleAt: number;
}

interface CopMood {
  phase: string;
  nextStop: number;
  nextPuff: number;
}

export type EmoteListener = (owner: number, kind: EmoteKind, pos: Vec2) => void;

export class MoodDirector {
  private readonly chars = new Map<EntityId, CharMood>();
  private readonly cops = new Map<EntityId, CopMood>();
  private time = 0;
  private rand = 12345;
  /** Called whenever an emote actually pops (HUD / audio hook). */
  listener: EmoteListener | null = null;

  constructor(private readonly emotes: EmoteSystem) {}

  reset(): void {
    this.chars.clear();
    this.cops.clear();
    this.emotes.clear();
  }

  private rnd(): number {
    this.rand = (this.rand * 16807) % 2147483647;
    return this.rand / 2147483647;
  }

  private mood(id: EntityId): CharMood {
    let m = this.chars.get(id);
    if (!m) {
      m = { stage: 0, idleFor: 0, nextIdle: 5 + this.rnd() * 5, face: null, faceUntil: 0, tumbleStart: -1, nextNervous: 0, sparkleAt: -1 };
      this.chars.set(id, m);
    }
    return m;
  }

  private emit(sim: Simulation, owner: number, kind: EmoteKind, o?: EmoteOptions): void {
    if (!this.emotes.show(owner, kind, o)) return;
    if (!this.listener) return;
    let pos: Vec2 | undefined;
    if (owner >= POLICE_OWNER) pos = sim.state.police.find((p) => p.id === owner - POLICE_OWNER)?.pos;
    else pos = sim.getCharacter(owner)?.pos;
    if (pos) this.listener(owner, kind, { x: pos.x, y: pos.y });
  }

  private setFace(id: EntityId, face: RaccoonExpression, seconds: number): void {
    const m = this.mood(id);
    m.face = face;
    m.faceUntil = this.time + seconds;
  }

  /** Face override for a character right now (null = let the rig decide). */
  expression(id: EntityId): RaccoonExpression | null {
    const m = this.chars.get(id);
    if (!m || !m.face || this.time >= m.faceUntil) return null;
    return m.face;
  }

  /** Seconds since this raccoon's uproot tumble started (undefined when none). */
  tumble(id: EntityId): number | undefined {
    const m = this.chars.get(id);
    if (!m || m.tumbleStart < 0) return undefined;
    const t = this.time - m.tumbleStart;
    return t < 1.2 ? t : undefined;
  }

  private near(sim: Simulation, p: Vec2, r: number, fn: (id: EntityId, team: TeamId) => void, except?: Set<EntityId>): void {
    for (const c of sim.state.characters) {
      if (except?.has(c.id)) continue;
      if (Math.hypot(c.pos.x - p.x, c.pos.y - p.y) <= r) fn(c.id, c.team);
    }
  }

  onEvent(e: SimEvent, sim: Simulation): void {
    switch (e.type) {
      case 'grab': {
        const l = sim.getLoot(e.targetId);
        if (l && l.anchored && (l.kind !== 'smallSafe' || e.part === 'bankWall')) this.emit(sim, e.charId, 'flame', { duration: 1.4, priority: 2 });
        break;
      }
      case 'unanchored': {
        const l = sim.getLoot(e.lootId);
        if (!l) break;
        const holders = new Set(l.grabbedBy);
        for (const id of holders) {
          const m = this.mood(id);
          m.tumbleStart = this.time;
          m.sparkleAt = this.time + 0.55;
          m.stage = 0;
          this.emotes.hide(id);
        }
        const r = l.kind === 'bank' ? 16 : l.kind === 'largeSafe' ? 9 : 6;
        this.near(
          sim,
          l.pos,
          r,
          (id, team) => {
            const rival = e.byTeam !== null && team !== e.byTeam;
            this.emit(sim, id, rival && l.kind !== 'smallSafe' ? 'shock' : 'exclaim', { priority: 2 });
            if (rival && l.kind === 'bank') this.setFace(id, 'shock', 1.2);
          },
          holders,
        );
        break;
      }
      case 'dashHit': {
        if (!e.knockdown) break;
        this.emit(sim, e.victimId, 'dizzy', { duration: 1.4, priority: 4 });
        this.emit(sim, e.attackerId, this.rnd() < 0.5 ? 'note' : 'sparkle', { duration: 1.2, priority: 2 });
        break;
      }
      case 'release': {
        if (e.forced) {
          this.emit(sim, e.charId, 'shock', { priority: 3 });
          this.setFace(e.charId, 'shock', 0.9);
        }
        break;
      }
      case 'safeUnloaded': {
        if (e.byCharId === null || e.bankCarrierTeam === null) break;
        const thief = sim.getCharacter(e.byCharId);
        if (!thief || thief.team === e.bankCarrierTeam) break;
        this.emit(sim, thief.id, 'coin', { priority: 2 });
        const bank = sim.getLoot(e.bankId);
        for (const c of sim.state.characters) {
          if (c.team !== e.bankCarrierTeam) continue;
          const near = bank ? Math.hypot(c.pos.x - bank.pos.x, c.pos.y - bank.pos.y) < 14 : false;
          if (bank?.grabbedBy.includes(c.id) || near) {
            this.emit(sim, c.id, 'angry', { priority: 3 });
            this.setFace(c.id, 'angry', 1.6);
          }
        }
        break;
      }
      case 'recovered': {
        const l = sim.getLoot(e.lootId);
        const at = l?.pos ?? null;
        for (const c of sim.state.characters) {
          const d = at ? Math.hypot(c.pos.x - at.x, c.pos.y - at.y) : 0;
          if (c.team === e.team) {
            if (e.holders.includes(c.id) || d < 20) this.emit(sim, c.id, 'heart', { priority: 3, scale: e.kind === 'bank' ? 1.2 : 1 });
          } else if (d < 20) {
            this.emit(sim, c.id, e.kind === 'bank' ? 'tear' : 'angry', { priority: 2 });
            if (e.kind === 'bank') this.setFace(c.id, 'sad', 1.8);
          }
        }
        break;
      }
      case 'alarm': {
        const b = sim.getLoot(e.bankId);
        if (b) this.near(sim, b.pos, 18, (id) => this.emit(sim, id, 'exclaim', { priority: 2 }));
        break;
      }
      case 'policeSpotted': {
        this.emit(sim, e.charId, 'exclaim', { priority: 4 });
        this.emit(sim, e.charId, 'panic', { duration: 1.4, priority: 3 });
        this.setFace(e.charId, 'panic', 1.2);
        this.emit(sim, POLICE_OWNER + e.officerId, 'exclaim', { priority: 3 });
        break;
      }
      case 'policeTackle': {
        if (e.hit) {
          this.emit(sim, e.victimId, 'dizzy', { duration: 1.5, priority: 5 });
          this.emit(sim, POLICE_OWNER + e.officerId, 'whistle', { priority: 3 });
        } else {
          this.emit(sim, POLICE_OWNER + e.officerId, 'question', { priority: 2 });
          this.emit(sim, e.victimId, 'note', { priority: 2 });
        }
        break;
      }
      case 'policeStunned': {
        this.emit(sim, POLICE_OWNER + e.officerId, 'dizzy', { duration: 1.8, priority: 5 });
        this.emit(sim, e.byCharId, 'sparkle', { priority: 2 });
        break;
      }
      case 'policeArrived': {
        for (const o of sim.state.police) if (Math.hypot(o.pos.x - e.pos.x, o.pos.y - e.pos.y) < 6) this.emit(sim, POLICE_OWNER + o.id, 'whistle', { priority: 2 });
        this.near(sim, e.pos, 22, (id) => this.emit(sim, id, 'exclaim', { priority: 2 }));
        break;
      }
      case 'finalCountdown': {
        for (const c of sim.state.characters) {
          this.emit(sim, c.id, 'exclaim', { priority: 2 });
          this.mood(c.id).nextNervous = this.time + 1.5 + this.rnd() * 2;
        }
        break;
      }
      default:
        break;
    }
  }

  /**
   * Per-frame state-driven emotes. `active` = match mode (no idle / nervous emotes in menus).
   */
  update(sim: Simulation, dt: number, active: boolean, calm: boolean): void {
    this.time += dt;
    this.emotes.calm = calm;
    const st = sim.state;
    const ticksLeft = Number.isFinite(st.endTick) ? st.endTick - st.tick : Infinity;
    for (const c of st.characters) {
      const m = this.mood(c.id);
      // Uproot strain stages (by the grabbed target's progress).
      let stage = 0;
      if (c.straining && c.grab) {
        const l = sim.getLoot(c.grab.targetId);
        const p = l ? l.unanchorProgress : 0;
        stage = p < 0.4 ? 1 : p < 0.8 ? 2 : 3;
      }
      if (stage !== m.stage) {
        if (stage === 1) this.emit(sim, c.id, 'flame', { loop: true, priority: 2 });
        else if (stage === 2) this.emit(sim, c.id, 'sweat', { loop: true, priority: 2 });
        else if (stage === 3) {
          this.emit(sim, c.id, 'panic', { loop: true, priority: 3 });
          this.emit(sim, c.id, 'strain', { duration: 1.0, priority: 2 });
        } else if (m.stage > 0) this.emotes.hide(c.id);
        m.stage = stage;
      }
      // Sparkles + ^^ when the tumble springs up.
      if (m.sparkleAt >= 0 && this.time >= m.sparkleAt) {
        m.sparkleAt = -1;
        this.emit(sim, c.id, 'sparkle', { priority: 3 });
        this.emit(sim, c.id, 'happy', { priority: 3 });
        this.setFace(c.id, 'happy', 1.0);
      }
      if (!active) continue;
      // Idle whistle.
      const idle = Math.hypot(c.vel.x, c.vel.y) < 0.25 && !c.grab && c.knockdownTicks <= 0;
      m.idleFor = idle ? m.idleFor + dt : 0;
      if (idle && m.idleFor > m.nextIdle) {
        this.emit(sim, c.id, 'note', { priority: 0 });
        m.idleFor = 0;
        m.nextIdle = 6 + this.rnd() * 5;
      }
      // Nervous sweat in the last 10 s.
      if (ticksLeft < 10 * TICK_RATE && ticksLeft > 0 && this.time >= m.nextNervous) {
        this.emit(sim, c.id, 'sweat', { duration: 1.2, priority: 0 });
        m.nextNervous = this.time + 2.5 + this.rnd() * 2.5;
      }
    }
    // Officers.
    const seen = new Set<EntityId>();
    for (const o of st.police) {
      seen.add(o.id);
      this.updateCop(sim, o);
    }
    for (const id of [...this.cops.keys()]) {
      if (!seen.has(id)) {
        this.cops.delete(id);
        this.emotes.hide(POLICE_OWNER + id);
      }
    }
  }

  private updateCop(sim: Simulation, o: PoliceOfficerState): void {
    let m = this.cops.get(o.id);
    const owner = POLICE_OWNER + o.id;
    if (!m) {
      m = { phase: '', nextStop: this.time + 1.5, nextPuff: 0 };
      this.cops.set(o.id, m);
    }
    if (o.phase !== m.phase) {
      if (o.phase === 'tired') this.emit(sim, owner, 'puff', { duration: 0.9, priority: 1 });
      else if (o.phase === 'stunned') this.emit(sim, owner, 'dizzy', { loop: true, priority: 4 });
      else if (o.phase === 'arriving') this.emit(sim, owner, 'whistle', { priority: 2 });
      else if (o.phase === 'leaving') this.emit(sim, owner, 'zzz', { priority: 1 });
      if (m.phase === 'stunned') this.emotes.hide(owner, 'dizzy');
      m.phase = o.phase;
    }
    if (o.phase === 'tired' && this.time >= m.nextPuff) {
      this.emit(sim, owner, 'puff', { duration: 0.8, priority: 1 });
      m.nextPuff = this.time + 0.55;
    }
    if (o.phase === 'chase' && this.time >= m.nextStop) {
      this.emit(sim, owner, this.rnd() < 0.6 ? 'stop' : 'whistle', { priority: 1 });
      m.nextStop = this.time + 3 + this.rnd() * 2;
    }
  }
}
