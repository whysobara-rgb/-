/**
 * LayoutBuilder: authoring helper that guarantees mirror symmetry.
 *
 * Match layouts are authored for the WEST half (team 0) plus elements that sit on
 * the mirror axis x = size.x / 2. Every off-axis call automatically emits the
 * mirrored twin on the east half (team 1), so gameplay geometry is symmetric by
 * construction (doc §9: "양 진영에서 각 목표까지의 기회는 대칭"). Shops may differ in
 * style/sign between the two halves (pure render flavor) via the `east` option.
 *
 * The validator re-checks symmetry independently, so authoring mistakes such as
 * an asymmetric on-axis box are still caught.
 */
import type {
  BankPlacementDef,
  BankRouteDef,
  BreakableDef,
  BreakableKind,
  ChokepointDef,
  DecorDef,
  DecorKind,
  FenceDef,
  ItemPadDef,
  LayoutDef,
  LayoutV2Def,
  PoliceEntryDef,
  PropPlacementDef,
  PropVariant,
  LayoutId,
  SafeKind,
  SafePlacementDef,
  SpawnDef,
  StaticBoxDef,
  StaticBoxKind,
  StaticCircleDef,
  StaticCircleKind,
  TeamId,
  Vec2,
  ZoneDef,
} from '../types';
import { BREAKABLE_SPECS, POLICE_CAR, ZONE_DEFAULT_HALF } from '../config';
import { EPS, mirrorAngle, mirrorPoint, normAngle } from './geometry';
import type { LayoutDesignMeta, PathClass, PathSpec, RuleWaiver } from './meta';

export interface BuilderOptions {
  id: LayoutId;
  size: Vec2;
  nameKey: string;
  descKey: string;
  groundStyle: NonNullable<LayoutDef['groundStyle']>;
  /** Tutorial-style layouts are single-team and skip automatic mirroring. */
  mirror?: boolean;
}

export interface BoxOptions {
  angle?: number;
  style?: string;
  signKey?: string;
  /** Render-only overrides for the east (team 1) twin. */
  east?: { style?: string; signKey?: string; height?: number };
}

export interface DecorOptions {
  scale?: number;
  color?: string;
  /** Render-only overrides for the east twin. */
  east?: { kind?: DecorKind; color?: string; scale?: number };
}

const idW = (id: string): string => `${id}.w`;
const idE = (id: string): string => `${id}.e`;

export class LayoutBuilder {
  readonly axis: number;
  private readonly mirror: boolean;
  private readonly statics: StaticBoxDef[] = [];
  private readonly circles: StaticCircleDef[] = [];
  private readonly fences: FenceDef[] = [];
  private readonly zones: ZoneDef[] = [];
  private readonly spawns: SpawnDef[] = [];
  private readonly banks: BankPlacementDef[] = [];
  private readonly safes: SafePlacementDef[] = [];
  private readonly routes: BankRouteDef[] = [];
  private readonly chokes: ChokepointDef[] = [];
  private readonly decorList: DecorDef[] = [];
  private readonly pathList: PathSpec[] = [];
  private readonly policeList: PoliceEntryDef[] = [];
  /** west fence id -> east fence id (identity for on-axis fences). */
  private readonly fenceMirror = new Map<string, string>();
  private readonly usedIds = new Set<string>();
  // Content 2.0 composition (LayoutDef.v2): emitted only when at least one v2 call was made.
  private v2Used = false;
  private readonly v2Safes: SafePlacementDef[] = [];
  private readonly v2Props: PropPlacementDef[] = [];
  private readonly v2Breakables: BreakableDef[] = [];
  private readonly v2Pads: ItemPadDef[] = [];
  private readonly v2Spots: Vec2[] = [];
  private readonly waiverList: RuleWaiver[] = [];

  constructor(private readonly opts: BuilderOptions) {
    this.axis = opts.size.x / 2;
    this.mirror = opts.mirror ?? true;
  }

  /** x of the mirror twin of a west-half coordinate. */
  mx(x: number): number {
    return 2 * this.axis - x;
  }

  private onAxis(x: number): boolean {
    return Math.abs(x - this.axis) < EPS;
  }

  private claim(id: string): string {
    if (this.usedIds.has(id)) throw new Error(`layout ${this.opts.id}: duplicate id "${id}"`);
    this.usedIds.add(id);
    return id;
  }

  /** True when this element must be emitted twice (west + east). */
  private twin(x: number): boolean {
    return this.mirror && !this.onAxis(x);
  }

  // -------------------------------------------------------------------------
  // Collidable statics
  // -------------------------------------------------------------------------

  box(
    id: string,
    kind: StaticBoxKind,
    x: number,
    y: number,
    hw: number,
    hh: number,
    height: number,
    o: BoxOptions = {},
  ): this {
    const angle = normAngle(o.angle ?? 0);
    if (!this.twin(x)) {
      this.statics.push({
        id: this.claim(id),
        kind,
        center: { x, y },
        half: { x: hw, y: hh },
        angle,
        height,
        style: o.style,
        signKey: o.signKey,
      });
      return this;
    }
    this.statics.push({
      id: this.claim(idW(id)),
      kind,
      center: { x, y },
      half: { x: hw, y: hh },
      angle,
      height,
      style: o.style,
      signKey: o.signKey,
    });
    this.statics.push({
      id: this.claim(idE(id)),
      kind,
      center: { x: this.mx(x), y },
      half: { x: hw, y: hh },
      angle: mirrorAngle(angle),
      height: o.east?.height ?? height,
      style: o.east?.style ?? o.style,
      signKey: o.east?.signKey ?? o.signKey,
    });
    return this;
  }

  /** Box given by its min/max corners (axis aligned). */
  rect(
    id: string,
    kind: StaticBoxKind,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    height: number,
    o: Omit<BoxOptions, 'angle'> = {},
  ): this {
    return this.box(id, kind, (x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, height, o);
  }

  circle(id: string, kind: StaticCircleKind, x: number, y: number, radius: number, height: number): this {
    if (!this.twin(x)) {
      this.circles.push({ id: this.claim(id), kind, center: { x, y }, radius, height });
      return this;
    }
    this.circles.push({ id: this.claim(idW(id)), kind, center: { x, y }, radius, height });
    this.circles.push({ id: this.claim(idE(id)), kind, center: { x: this.mx(x), y }, radius, height });
    return this;
  }

  /**
   * Weak fence. Returns the west (or on-axis) fence id; the east twin is resolved
   * automatically when a route lists the west id in breaksFences.
   */
  fence(id: string, x: number, y: number, hw: number, hh: number, angle = 0): string {
    const a = normAngle(angle);
    if (!this.twin(x)) {
      this.fences.push({ id: this.claim(id), center: { x, y }, half: { x: hw, y: hh }, angle: a });
      this.fenceMirror.set(id, id);
      return id;
    }
    const w = this.claim(idW(id));
    const e = this.claim(idE(id));
    this.fences.push({ id: w, center: { x, y }, half: { x: hw, y: hh }, angle: a });
    this.fences.push({ id: e, center: { x: this.mx(x), y }, half: { x: hw, y: hh }, angle: mirrorAngle(a) });
    this.fenceMirror.set(w, e);
    return w;
  }

  // -------------------------------------------------------------------------
  // Teams, loot
  // -------------------------------------------------------------------------

  /** Team 0 zone + van; the team 1 twin is mirrored. */
  zone(center: Vec2, vanPos: Vec2, vanAngle: number): this {
    const z0: ZoneDef = { team: 0, center: { ...center }, half: { ...ZONE_DEFAULT_HALF }, angle: 0, vanPos: { ...vanPos }, vanAngle: normAngle(vanAngle) };
    this.zones.push(z0);
    if (this.mirror) {
      this.zones.push({
        team: 1,
        center: mirrorPoint(center, this.axis),
        half: { ...ZONE_DEFAULT_HALF },
        angle: 0,
        vanPos: mirrorPoint(vanPos, this.axis),
        vanAngle: mirrorAngle(vanAngle),
      });
    }
    return this;
  }

  /** Team 0 spawn; the team 1 twin is mirrored and emitted after all team 0 spawns. */
  spawn(x: number, y: number, facing: number): this {
    this.spawns.push({ team: 0, pos: { x, y }, facing: normAngle(facing) });
    return this;
  }

  bank(x: number, y: number, angle: number): number {
    if (this.mirror && !this.onAxis(x)) throw new Error(`layout ${this.opts.id}: banks must sit on the mirror axis`);
    this.banks.push({ pos: { x, y }, angle: normAngle(angle) });
    return this.banks.length - 1;
  }

  safe(kind: SafeKind, x: number, y: number, angle = 0): this {
    const a = normAngle(angle);
    this.safes.push({ kind, pos: { x, y }, angle: a });
    if (this.twin(x)) this.safes.push({ kind, pos: { x: this.mx(x), y }, angle: mirrorAngle(a) });
    return this;
  }

  /**
   * Bank route for team 0 (polyline from the bank start to the team 0 zone center);
   * the team 1 route is mirrored with fence ids translated. Several routes for the
   * same (bank, team) pair are allowed: list the preferred (shortest) one first.
   */
  route(bankIndex: number, points: Vec2[], breaksFences: string[] = []): this {
    this.routes.push({ bankIndex, team: 0, points: points.map((p) => ({ ...p })), breaksFences: [...breaksFences] });
    if (this.mirror) {
      const mapped = breaksFences.map((f) => {
        const m = this.fenceMirror.get(f);
        if (!m) throw new Error(`layout ${this.opts.id}: route references unknown fence "${f}"`);
        return m;
      });
      this.routes.push({ bankIndex, team: 1, points: points.map((p) => mirrorPoint(p, this.axis)), breaksFences: mapped });
    }
    return this;
  }

  /** Named chokepoint; off-axis ones need an east id + name (shops differ per side). */
  choke(id: string, nameKey: string, x: number, y: number, radius: number, east?: { id: string; nameKey: string }): this {
    this.chokes.push({ id: this.claim(id), nameKey, pos: { x, y }, radius });
    if (this.twin(x)) {
      if (!east) throw new Error(`layout ${this.opts.id}: off-axis chokepoint "${id}" needs an east twin`);
      this.chokes.push({ id: this.claim(east.id), nameKey: east.nameKey, pos: { x: this.mx(x), y }, radius });
    }
    return this;
  }

  decor(kind: DecorKind, x: number, y: number, angle = 0, o: DecorOptions = {}): this {
    this.decorList.push({ kind, pos: { x, y }, angle: normAngle(angle), scale: o.scale, color: o.color });
    if (this.twin(x)) {
      this.decorList.push({
        kind: o.east?.kind ?? kind,
        pos: { x: this.mx(x), y },
        angle: mirrorAngle(angle),
        scale: o.east?.scale ?? o.scale,
        color: o.east?.color ?? o.color,
      });
    }
    return this;
  }

  /**
   * Police car entry (owner addition): the car drives in from `from` (on/outside the arena
   * edge) and parks at `park`. Mirrored layouts need both points on the mirror axis, so police
   * reach both teams equally. Add them in wave order (north first, then south).
   */
  police(park: Vec2, angle: number, from: Vec2): this {
    if (this.mirror && (!this.onAxis(park.x) || !this.onAxis(from.x))) {
      throw new Error(`layout ${this.opts.id}: police entries must sit on the mirror axis`);
    }
    this.policeList.push({ from: { ...from }, park: { ...park }, angle: normAngle(angle) });
    return this;
  }

  /**
   * The standard police entries: the car pulls up at the curb OUTSIDE the north edge (wave 1)
   * and the south edge (wave 2) at `x` (default: the mirror axis), driving in on that line from
   * off-screen, so it never sits on a lane. Officers hop the fence just inside the edge, so the
   * arena needs free ground there (validated).
   */
  policeCurbs(x = this.opts.size.x / 2): this {
    const h = this.opts.size.y;
    this.police({ x, y: -POLICE_CAR.curb }, 0, { x, y: -POLICE_CAR.approach });
    this.police({ x, y: h + POLICE_CAR.curb }, 0, { x, y: h + POLICE_CAR.approach });
    return this;
  }

  /** Declares a narrow alley / medium lane stretch for width validation (mirrored). */
  path(id: string, cls: PathClass, a: Vec2, b: Vec2): this {
    this.pathList.push({ id: this.twin(a.x) || this.twin(b.x) ? idW(id) : id, cls, a: { ...a }, b: { ...b } });
    if (this.twin(a.x) || this.twin(b.x)) {
      this.pathList.push({ id: idE(id), cls, a: mirrorPoint(a, this.axis), b: mirrorPoint(b, this.axis) });
    }
    return this;
  }

  // -------------------------------------------------------------------------
  // Content 2.0 composition (content-plan §3.2; LayoutDef.v2). Like everything else, every
  // off-axis call also emits the mirrored east twin. The classic fields are never touched, so a
  // map's classic definition stays byte-identical when it gains a v2 composition.
  // -------------------------------------------------------------------------

  /** v2 outdoor safe (`LayoutV2Def.safes` replaces `LayoutDef.safes` under `content: 'v2'`). */
  v2Safe(kind: SafeKind, x: number, y: number, angle = 0): this {
    this.v2Used = true;
    const a = normAngle(angle);
    this.v2Safes.push({ kind, pos: { x, y }, angle: a });
    if (this.twin(x)) this.v2Safes.push({ kind, pos: { x: this.mx(x), y }, angle: mirrorAngle(a) });
    return this;
  }

  /** Prop loot (ATM / 돼지저금통 / 돈나무 / 황금 금고). A single prop must sit on the axis. */
  prop(variant: PropVariant, x: number, y: number, angle = 0): this {
    this.v2Used = true;
    const a = normAngle(angle);
    this.v2Props.push({ variant, pos: { x, y }, angle: a });
    if (this.twin(x)) this.v2Props.push({ variant, pos: { x: this.mx(x), y }, angle: mirrorAngle(a) });
    return this;
  }

  /** Breakable (나무 상자 / 자판기); its size comes from BREAKABLE_SPECS. Ids get `.w` / `.e` twins. */
  breakable(id: string, kind: BreakableKind, x: number, y: number, angle = 0): this {
    this.v2Used = true;
    const a = normAngle(angle);
    const half = BREAKABLE_SPECS[kind].half;
    if (!this.twin(x)) {
      this.v2Breakables.push({ id: this.claim(id), kind, center: { x, y }, half: { ...half }, angle: a });
      return this;
    }
    this.v2Breakables.push({ id: this.claim(idW(id)), kind, center: { x, y }, half: { ...half }, angle: a });
    this.v2Breakables.push({ id: this.claim(idE(id)), kind, center: { x: this.mx(x), y }, half: { ...half }, angle: mirrorAngle(a) });
    return this;
  }

  /**
   * Supply-balloon item pad. Off the axis it emits the mirrored pair `${id}.w` / `${id}.e`, each
   * naming the other as its twin (the drop schedule always gives twins the same item); on the
   * axis it is the single axis pad (`twin: null`, the 황금 뿅망치 pad).
   */
  itemPad(id: string, x: number, y: number): this {
    this.v2Used = true;
    if (!this.twin(x)) {
      this.v2Pads.push({ id: this.claim(id), pos: { x, y }, twin: null });
      return this;
    }
    const w = this.claim(idW(id));
    const e = this.claim(idE(id));
    this.v2Pads.push({ id: w, pos: { x, y }, twin: e });
    this.v2Pads.push({ id: e, pos: { x: this.mx(x), y }, twin: w });
    return this;
  }

  /**
   * Event spot (index order matters: index 0 is the axis spot every loot event uses). Off-axis
   * spots are added as a west / east pair.
   */
  eventSpot(x: number, y: number): this {
    this.v2Used = true;
    if (this.v2Spots.length === 0 && this.mirror && !this.onAxis(x)) {
      throw new Error(`layout ${this.opts.id}: event spot 0 must sit on the mirror axis`);
    }
    this.v2Spots.push({ x, y });
    if (this.twin(x)) this.v2Spots.push({ x: this.mx(x), y });
    return this;
  }

  /**
   * Waives one Content 2.0 rule for one subject (see RuleWaiver): the validator reports it as a
   * warning with `reason`, and fails if nothing matches it. Off-axis subjects name the west
   * element; its mirror twin (`spawn 2`, `pad x.e`) is covered automatically.
   */
  waive(rule: RuleWaiver['rule'], subject: string, reason: string): this {
    this.waiverList.push({ rule, subject, reason });
    return this;
  }

  build(intent: string): { def: LayoutDef; meta: LayoutDesignMeta } {
    const spawns: SpawnDef[] = [...this.spawns];
    if (this.mirror) {
      for (const s of this.spawns) {
        spawns.push({ team: 1 as TeamId, pos: mirrorPoint(s.pos, this.axis), facing: mirrorAngle(s.facing) });
      }
    }
    // Routes: group by bank, then team (stable, readable order for AI/debug tools).
    const routes = [...this.routes].sort((a, b) => a.bankIndex - b.bankIndex || a.team - b.team);
    const def: LayoutDef = {
      id: this.opts.id,
      nameKey: this.opts.nameKey,
      descKey: this.opts.descKey,
      size: { ...this.opts.size },
      statics: this.statics,
      circles: this.circles,
      fences: this.fences,
      zones: this.zones,
      spawns,
      banks: this.banks,
      safes: this.safes,
      bankRoutes: routes,
      chokepoints: this.chokes,
      decor: this.decorList,
      groundStyle: this.opts.groundStyle,
    };
    if (this.policeList.length > 0) {
      def.policeEntries = this.policeList;
      def.policeDispatch = 'nearestAlarm';
    }
    if (this.v2Used) {
      const v2: LayoutV2Def = {
        safes: this.v2Safes,
        props: this.v2Props,
        breakables: this.v2Breakables,
        gimmicks: [],
        itemPads: this.v2Pads,
        eventSpots: this.v2Spots,
      };
      def.v2 = v2;
    }
    const meta: LayoutDesignMeta = { paths: this.pathList, intent };
    if (this.waiverList.length > 0) meta.waivers = this.waiverList.map((w) => ({ ...w }));
    return { def, meta };
  }
}
