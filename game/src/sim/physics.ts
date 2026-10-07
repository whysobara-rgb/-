/**
 * Small deterministic 2D rigid-body engine tailored to 뿌리째 털어라.
 *
 * - Shapes: circles (characters, trees...) and oriented boxes (safes, bank walls, statics).
 *   A body may own several shapes (the bank is a compound of its six wall boxes).
 * - Motion types: 'dynamic' (integrated), 'kinematic' (pose driven by a weld parent, e.g. an
 *   anchored interior safe riding its bank), 'static' (anchored loot; infinite mass, v = 0).
 *   World statics (buildings, vans, fences, arena boundary) are lightweight StaticShapes in a
 *   uniform grid, not bodies.
 * - Solver: sequential impulses with speculative contacts (no tunnelling at dash speed),
 *   Baumgarte position bias, Coulomb friction, and bilateral point-distance joints for grabs
 *   with an impulse limit (grip break).
 * - Game specifics baked in on purpose (they live in the solver loop):
 *   * viscous ground drag relative to the floor under the body (moving bank floors);
 *   * moving-floor carry: when a bank's velocity changes during a substep, riders receive the
 *     same change of floor velocity at their position (so loaded safes and characters move
 *     with the bank while drag acts only on their floor-relative velocity);
 *   * soft push: character-vs-loot contacts scale the loot's inverse mass;
 *   * riders never push their own floor: a contact between a rider and the bank it rides
 *     treats the bank as immovable (no self-propulsion from inside);
 *   * breakable fences: bank-vs-fence contacts have a capped normal impulse and report their
 *     approach speed so the rules layer can break the fence.
 * - Content 2.0 (C3; every field neutral in classic, which stays bit-identical):
 *   * ground fields per body: field velocity (belts) added to the floor velocity drag pulls
 *     toward, drag / drive scales (slick, soap);
 *   * kickable bodies (the piggy): a dashing character hits them at full mass (no soft push);
 *   * kinematic bodies posed by setKinematicPose (teacups, truck, crane load) carry their riders
 *     like a moving bank floor, rotation included;
 *   * impacts without a character are reported through PhysicsHooks.onBodyImpact.
 *
 * Determinism: fixed iteration order everywhere (bodies by index, statics by index, contacts
 * in generation order), no randomness, no time sources.
 */

export const SHAPE_BOX = 0;
export const SHAPE_CIRCLE = 1;

export const CAT_CHARACTER = 1;
export const CAT_SAFE = 2;
export const CAT_BANK = 4;
/** Police officers (owner addition): walk like characters (soft push on loot, low friction). */
export const CAT_POLICE = 8;
/** Bodies that walk on their own (characters, officers). */
const CAT_WALKER = CAT_CHARACTER | CAT_POLICE;

export type Motion = 'dynamic' | 'kinematic' | 'static';

/** Shared world-space geometry for narrowphase: box (center, x-axis, half extents) or circle. */
export class Geom {
  type = SHAPE_BOX;
  x = 0;
  y = 0;
  /** Box local x-axis in world space (unit). The y-axis is (-uy, ux). */
  ux = 1;
  uy = 0;
  hx = 0;
  hy = 0;
  r = 0;
  minX = 0;
  minY = 0;
  maxX = 0;
  maxY = 0;

  updateAABB(margin: number): void {
    let ex: number;
    let ey: number;
    if (this.type === SHAPE_CIRCLE) {
      ex = this.r;
      ey = this.r;
    } else {
      const ax = Math.abs(this.ux);
      const ay = Math.abs(this.uy);
      ex = ax * this.hx + ay * this.hy;
      ey = ay * this.hx + ax * this.hy;
    }
    this.minX = this.x - ex - margin;
    this.maxX = this.x + ex + margin;
    this.minY = this.y - ey - margin;
    this.maxY = this.y + ey + margin;
  }
}

export class BodyShape extends Geom {
  /** Local center in the body frame (local rotation is always 0 for our shapes). */
  lx = 0;
  ly = 0;
  constructor(
    readonly body: Body,
    type: number,
    lx: number,
    ly: number,
    hx: number,
    hy: number,
    r: number,
  ) {
    super();
    this.type = type;
    this.lx = lx;
    this.ly = ly;
    this.hx = hx;
    this.hy = hy;
    this.r = r;
  }
}

export class StaticShape extends Geom {
  index = -1;
  enabled = true;
  /** Blocks line of sight (buildings, walls, kiosks, vans, boundary). */
  blocksLOS = false;
  /** Index into the fence table, or -1. */
  fenceIndex = -1;
  /** Query de-duplication stamp. */
  stamp = 0;
  /** Debug / lookup tag (layout id, 'boundary', 'van0', ...). */
  tag = '';
}

export class Body {
  readonly shapes: BodyShape[] = [];
  motion: Motion = 'dynamic';
  enabled = true;
  x = 0;
  y = 0;
  a = 0;
  vx = 0;
  vy = 0;
  w = 0;
  mass = 1;
  invMass = 1;
  inertia = 1;
  invI = 1;
  /** Viscous ground drag coefficient (1/s); angular drag uses the same coefficient. */
  linDrag = 0;
  fixedRotation = false;
  /**
   * Passes through other dynamic bodies (still collides with statics). Only used for a police
   * officer whose way back to its car is sealed off by a bank / bodies (police.ts).
   */
  ghost = false;
  /** Drive force applied this tick (world space, N). */
  fx = 0;
  fy = 0;
  /** Disable ground drag (active dash burst). */
  noDrag = false;
  /** Bank body whose moving floor carries this body (null = ground). */
  floor: Body | null = null;
  /** Kinematic weld: parent body and pose in the parent's frame. */
  weldParent: Body | null = null;
  weldLx = 0;
  weldLy = 0;
  weldLa = 0;
  /** Body-level AABB (union of shapes incl. speculative margin). */
  minX = 0;
  minY = 0;
  maxX = 0;
  maxY = 0;
  margin = 0;
  /** Deepest real penetration seen in the last substep (for anti-pin). */
  maxPen = 0;
  /** Velocity at the start of the current substep (moving-floor carry reference). */
  pvx = 0;
  pvy = 0;
  pw = 0;
  /** Floor velocity under this rider at the start of the substep. */
  fvx = 0;
  fvy = 0;
  fw = 0;
  // --- Content 2.0 (C0 contract, content-plan §4.5; read by the solver, C3) ---
  // Neutral values = classic behaviour. ContentSystems.prePhysics (v2 only) resets every body to
  // neutral each tick, then systems combine their contributions: field velocities ADD (belts,
  // fountain push), scales MULTIPLY (slick gimmicks, soap hazards). Classic never writes them.
  /** Ground-field velocity (m/s, world): drag pulls the body toward it instead of toward 0 (belts). */
  fieldVx = 0;
  fieldVy = 0;
  /** Ground drag multiplier (slick / soap < 1). */
  dragScale = 1;
  /** Drive-force multiplier (slick / soap < 1). */
  driveScale = 1;
  /**
   * Extra angular ground drag (1/s) for this tick, on top of linDrag ("yaw grip" of a hauled
   * bank, set each tick by the game). 0 keeps the plain drag path bit-exact.
   */
  yawDragExtra = 0;
  /** A world static or fence pushed on this body (normal impulse > 0) during the last step. */
  staticPush = false;
  /** Kickable (the piggy): a dashing character skips softPushFactor against it. */
  kickable = false;
  /** (C3) Kickable only: restitution of a dashing character's kick (the ball springs off the foot). */
  kickRestitution = 0;
  /**
   * (C3) Kinematic floor bookkeeping for setKinematicPose bodies: the velocity the body had at the
   * end of the previous substep (riders inherit the change, see step 7) and whether a pose was ever
   * set (the first pose seeds it, so a body that starts moving does not kick its riders).
   */
  kpvx = 0;
  kpvy = 0;
  kpw = 0;
  kinPosed = false;

  constructor(
    readonly index: number,
    readonly entityId: number,
    readonly cat: number,
  ) {}

  addBox(lx: number, ly: number, hx: number, hy: number): BodyShape {
    const s = new BodyShape(this, SHAPE_BOX, lx, ly, hx, hy, 0);
    this.shapes.push(s);
    return s;
  }

  addCircle(lx: number, ly: number, r: number): BodyShape {
    const s = new BodyShape(this, SHAPE_CIRCLE, lx, ly, 0, 0, r);
    this.shapes.push(s);
    return s;
  }

  setMass(mass: number, inertia: number): void {
    this.mass = mass;
    this.inertia = inertia;
    this.invMass = mass > 0 ? 1 / mass : 0;
    this.invI = !this.fixedRotation && inertia > 0 ? 1 / inertia : 0;
  }

  /** Effective inverse mass in the solver (0 for static/kinematic). */
  get solverInvMass(): number {
    return this.motion === 'dynamic' ? this.invMass : 0;
  }

  get solverInvI(): number {
    return this.motion === 'dynamic' ? this.invI : 0;
  }

  /** Recompute world geometry of all shapes and the body AABB. */
  updateShapes(margin: number): void {
    const c = Math.cos(this.a);
    const s = Math.sin(this.a);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < this.shapes.length; i++) {
      const sh = this.shapes[i]!;
      sh.x = this.x + sh.lx * c - sh.ly * s;
      sh.y = this.y + sh.lx * s + sh.ly * c;
      sh.ux = c;
      sh.uy = s;
      sh.updateAABB(margin);
      if (sh.minX < minX) minX = sh.minX;
      if (sh.minY < minY) minY = sh.minY;
      if (sh.maxX > maxX) maxX = sh.maxX;
      if (sh.maxY > maxY) maxY = sh.maxY;
    }
    this.minX = minX;
    this.minY = minY;
    this.maxX = maxX;
    this.maxY = maxY;
    this.margin = margin;
  }

  /** Velocity of the material point at world (px, py). */
  pointVelX(py: number): number {
    return this.vx - this.w * (py - this.y);
  }
  pointVelY(px: number): number {
    return this.vy + this.w * (px - this.x);
  }
}

/** Grab: rigid point-distance joint between a character's center and an anchor on a target. */
export class GrabJoint {
  /** Current rest length; eases from the grab distance down to holdDistance. */
  rest: number;
  /** Accumulated |impulse| over the current tick. */
  tickImpulse = 0;
  /** Set when the grip limit was exceeded during the tick. */
  broke = false;
  /**
   * Separating speed (m/s) of the anchor away from the holder at the start of the substep.
   * Only a real yank (fast separation) can break the grip: a holder pinned against the
   * target's side while the rest length settles makes the joint fight the contact, which
   * must never count as a yank (walking sideways with an anchored safe broke the grip).
   */
  private sepSpeed = 0;
  static readonly YANK_SEP_SPEED = 1.5;
  // solver scratch
  private nx = 1;
  private ny = 0;
  private rbx = 0;
  private rby = 0;
  private emass = 0;
  private target = 0;
  private acc = 0;
  private limit = 0;
  // bearing ("grip friction") scratch
  private tx = 0;
  private ty = 1;
  private rtx = 0;
  /**
   * Lever of the bearing's reaction on the target: target centre -> holder centre. The reaction
   * acts on the target's material point under the holder, on the same line as the action on the
   * holder (applied at the anchor, 0.55 m away across the handle line, the pair was a free couple:
   * holders never rotate, so a saturated bearing - two holders shoulder to shoulder blocking each
   * other's grab line - spun a held safe forever with idle sticks).
   */
  private rcx = 0;
  private rcy = 0;
  private emassT = 0;
  private targetT = 0;
  private accT = 0;
  private limitT = 0;
  // push steering motor scratch
  private steerW = 0;
  private steerAcc = 0;
  private steerLimit = 0;
  // push "wheel" scratch (see prepare)
  private emassW = 0;
  private rtw = 0;
  private accW = 0;
  private limitW = 0;
  private fvxW = 0;
  private fvyW = 0;
  /**
   * Push / pull mode of the previous tick (hysteresis of the push cone, kept by the game:
   * entering push needs the stick closer to the push line than staying in push).
   */
  pushing = false;
  /**
   * World heading the holder is pushing toward this tick (set by the game when the stick
   * points at the anchor), or null when pulling / idle.
   */
  pushHeading: number | null = null;

  /**
   * @param hlx,hly unit direction from the anchor to the holder, in the target's local frame,
   *   captured at grab time. The bearing term keeps the holder on that side of the anchor.
   */
  constructor(
    readonly char: Body,
    public targetBody: Body,
    public alx: number,
    public aly: number,
    rest: number,
    public hlx = 1,
    public hly = 0,
  ) {
    this.rest = rest;
  }

  anchorWorldX(): number {
    const b = this.targetBody;
    return b.x + this.alx * Math.cos(b.a) - this.aly * Math.sin(b.a);
  }
  anchorWorldY(): number {
    const b = this.targetBody;
    return b.y + this.alx * Math.sin(b.a) + this.aly * Math.cos(b.a);
  }

  /**
   * @param lateralLimit max bearing impulse per substep (N*s). The bearing term is a bounded
   *   "grip friction": it keeps the holder on its grab side so pushing (rod in compression,
   *   unstable for a pure distance joint) stays controllable, while a deliberate sideways walk
   *   saturates it and swings around the target. It never breaks the grip.
   */
  prepare(h: number, limitPerSubstep: number, beta: number, maxCorr: number, lateralLimit = 0): void {
    const b = this.targetBody;
    const c = this.char;
    const cs = Math.cos(b.a);
    const sn = Math.sin(b.a);
    this.rbx = this.alx * cs - this.aly * sn;
    this.rby = this.alx * sn + this.aly * cs;
    const dx = b.x + this.rbx - c.x;
    const dy = b.y + this.rby - c.y;
    const d = Math.hypot(dx, dy);
    if (d > 1e-6) {
      this.nx = dx / d;
      this.ny = dy / d;
    } else {
      this.nx = 1;
      this.ny = 0;
    }
    const rn = this.rbx * this.ny - this.rby * this.nx;
    const k = c.solverInvMass + b.solverInvMass + b.solverInvI * rn * rn;
    this.emass = k > 0 ? 1 / k : 0;
    let corr = (-beta * (d - this.rest)) / h;
    if (corr > maxCorr) corr = maxCorr;
    else if (corr < -maxCorr) corr = -maxCorr;
    this.target = corr;
    this.acc = 0;
    this.limit = limitPerSubstep;
    this.sepSpeed = (b.vx - b.w * this.rby - c.vx) * this.nx + (b.vy + b.w * this.rbx - c.vy) * this.ny;
    // bearing: lateral offset of the holder from the anchor's handle direction
    const hx = this.hlx * cs - this.hly * sn;
    const hy = this.hlx * sn + this.hly * cs;
    this.tx = -hy;
    this.ty = hx;
    this.rcx = c.x - b.x;
    this.rcy = c.y - b.y;
    this.rtx = this.rcx * this.ty - this.rcy * this.tx;
    const kt = c.solverInvMass + b.solverInvMass + b.solverInvI * this.rtx * this.rtx;
    this.emassT = kt > 0 && lateralLimit > 0 ? 1 / kt : 0;
    const lat = (c.x - (b.x + this.rbx)) * this.tx + (c.y - (b.y + this.rby)) * this.ty;
    let ct = (-beta * lat) / h;
    if (ct > maxCorr) ct = maxCorr;
    else if (ct < -maxCorr) ct = -maxCorr;
    this.targetT = ct;
    this.accT = 0;
    this.limitT = lateralLimit;
    // push steering: turn the target so the push line (holder -> anchor) follows the stick.
    // A force applied behind the drag center is unstable (jackknife); a person pushing a
    // box or cart steers it with their hands. Bounded torque = lateral grip x lever arm.
    this.steerLimit = 0;
    const lever = Math.max(0.5, Math.hypot(this.alx, this.aly));
    // "cart" steering for long levers (a bank's grip is ~4 m from its centre; safes and props are
    // under 1.3 m and keep the plain assist, which already tracks the stick within ~1 degree)
    const cart = lever >= GrabJoint.CART_MIN_LEVER;
    if (this.pushHeading !== null && b.motion === 'dynamic' && b.solverInvI > 0 && lateralLimit > 0) {
      const pushAng = Math.atan2(-hy, -hx); // holder -> anchor along the handle line
      let err = this.pushHeading - pushAng;
      err = Math.atan2(Math.sin(err), Math.cos(err));
      let w = GrabJoint.STEER_GAIN * err;
      // cart: yaw-rate cap by lever, so the swing of the load about the push point stays slow
      // (it adds to the load's speed) and the far end of a bank never whips
      const wMax = cart ? Math.min(GrabJoint.STEER_MAX_W, GrabJoint.CART_MAX_SWING_SPEED / lever) : GrabJoint.STEER_MAX_W;
      if (w > wMax) w = wMax;
      else if (w < -wMax) w = -wMax;
      this.steerW = w;
      this.steerAcc = 0;
      this.steerLimit = (cart ? GrabJoint.CART_TORQUE_SCALE : 1) * lateralLimit * lever;
    }
    // cart push "wheel": while pushed, the gripped point does not skid along the face (sideways to
    // the handle line) relative to the ground, so the load turns about the push point like a
    // cart instead of spinning about its centre - a pure steering torque swung the grip point (and
    // the pusher) of a bank 1 m/s against the stick for seconds. A bounded, workless velocity
    // constraint between the target and the ground: it never adds speed along the push.
    this.emassW = 0;
    if (cart && this.pushHeading !== null && b.motion === 'dynamic' && b.solverInvMass > 0) {
      this.rtw = this.rbx * this.ty - this.rby * this.tx;
      const kw = b.solverInvMass + b.solverInvI * this.rtw * this.rtw;
      this.emassW = kw > 0 ? 1 / kw : 0;
      this.accW = 0;
      this.limitW = (GrabJoint.WHEEL_ACCEL / b.solverInvMass) * h;
      this.fvxW = b.fvx;
      this.fvyW = b.fvy;
    }
  }

  static readonly STEER_GAIN = 6;
  static readonly STEER_MAX_W = 2.5;
  /** Grip lever (m, anchor to target centre) from which a pushed load steers like a cart. */
  static readonly CART_MIN_LEVER = 2;
  /** Cart: max swing speed (m/s) of the load about the push point from the steering yaw rate. */
  static readonly CART_MAX_SWING_SPEED = 0.4;
  /** Cart: steering torque budget, in units of (lateral grip x lever). */
  static readonly CART_TORQUE_SCALE = 3;
  /** Cart wheel: max sideways grip of the pushed point (m/s^2 times the target's mass). */
  static readonly WHEEL_ACCEL = 30;

  solve(): void {
    if (this.emass === 0) return;
    const b = this.targetBody;
    const c = this.char;
    const vax = b.vx - b.w * this.rby;
    const vay = b.vy + b.w * this.rbx;
    const vn = (vax - c.vx) * this.nx + (vay - c.vy) * this.ny;
    let lambda = this.emass * (this.target - vn);
    let next = this.acc + lambda;
    if (next > this.limit) {
      // Compression (holder pushing into its own grip point, e.g. walking into a safe while
      // holding grab): the rod yields but the grip never breaks — contacts take over. Only a
      // violent yank (tension) breaks the grip.
      next = this.limit;
    } else if (next < -this.limit) {
      next = -this.limit;
      if (this.sepSpeed > GrabJoint.YANK_SEP_SPEED) this.broke = true;
    }
    lambda = next - this.acc;
    this.acc = next;
    const px = lambda * this.nx;
    const py = lambda * this.ny;
    const imc = c.solverInvMass;
    c.vx -= px * imc;
    c.vy -= py * imc;
    const imb = b.solverInvMass;
    if (imb > 0) {
      b.vx += px * imb;
      b.vy += py * imb;
      b.w += b.solverInvI * (this.rbx * py - this.rby * px);
    }
    if (this.steerLimit > 0) {
      const I = 1 / b.solverInvI;
      let ls = I * (this.steerW - b.w);
      let ns = this.steerAcc + ls;
      if (ns > this.steerLimit) ns = this.steerLimit;
      else if (ns < -this.steerLimit) ns = -this.steerLimit;
      ls = ns - this.steerAcc;
      this.steerAcc = ns;
      b.w += ls * b.solverInvI;
    }
    if (this.emassW > 0) {
      const vw = (b.vx - b.w * this.rby - this.fvxW) * this.tx + (b.vy + b.w * this.rbx - this.fvyW) * this.ty;
      let lw = -this.emassW * vw;
      let nw = this.accW + lw;
      if (nw > this.limitW) nw = this.limitW;
      else if (nw < -this.limitW) nw = -this.limitW;
      lw = nw - this.accW;
      this.accW = nw;
      b.vx += lw * this.tx * b.solverInvMass;
      b.vy += lw * this.ty * b.solverInvMass;
      b.w += b.solverInvI * this.rtw * lw;
    }
    if (this.emassT === 0) return;
    // bearing (bounded)
    const wax = b.vx - b.w * this.rcy;
    const way = b.vy + b.w * this.rcx;
    const vt = (c.vx - wax) * this.tx + (c.vy - way) * this.ty;
    let lt = this.emassT * (this.targetT - vt);
    let nt = this.accT + lt;
    if (nt > this.limitT) nt = this.limitT;
    else if (nt < -this.limitT) nt = -this.limitT;
    lt = nt - this.accT;
    this.accT = nt;
    const qx = lt * this.tx;
    const qy = lt * this.ty;
    c.vx += qx * imc;
    c.vy += qy * imc;
    if (imb > 0) {
      b.vx -= qx * imb;
      b.vy -= qy * imb;
      b.w -= b.solverInvI * (this.rcx * qy - this.rcy * qx);
    }
  }

  /** Called after the substep's iterations. */
  finishSubstep(): void {
    // Only tension counts toward the grip limit (see solve()).
    if (this.acc < 0 && this.sepSpeed > GrabJoint.YANK_SEP_SPEED) this.tickImpulse -= this.acc;
  }
}

class ContactPoint {
  px = 0;
  py = 0;
  sep = 0;
  rax = 0;
  ray = 0;
  rbx = 0;
  rby = 0;
  nMass = 0;
  tMass = 0;
  pn = 0;
  pt = 0;
  target = 0;
}

export class Contact {
  a!: Body;
  /** Second body, or null for a world static. */
  b: Body | null = null;
  st: StaticShape | null = null;
  nx = 0;
  ny = 0;
  count = 0;
  readonly p0 = new ContactPoint();
  readonly p1 = new ContactPoint();
  friction = 0;
  invMA = 0;
  invIA = 0;
  invMB = 0;
  invIB = 0;
  maxPn = Infinity;
  slop = 0;
  /** Bank pressing a fence (impulse-capped, reported to the rules). */
  fence = false;
}

export interface PhysicsHooks {
  /** A dynamic bank touches an intact fence with `approach` m/s normal speed (pre-solve). */
  onFenceContact?(fenceIndex: number, bank: Body, approach: number, px: number, py: number): void;
  /** A contact involving a character is about to resolve an impact faster than the threshold. */
  onImpact?(a: Body, b: Body | null, approach: number): void;
  /** After every substep (positions integrated). */
  afterSubstep?(substep: number): void;
  /**
   * (Content 2.0, C0 skeleton) Before every substep, before kinematic welds follow their parents:
   * kinematic gimmick poses = f(tick, substep) so nothing drifts.
   */
  beforeSubstep?(substep: number, substeps: number): void;
  /**
   * (Content 2.0, C0 contract; C3 makes the solver call it) An impact faster than the threshold
   * that involves NO character (loot vs wall / loot vs loot: piggy cracks, 돈나무 sheds). The
   * Simulation routes it only to the content systems' `onImpact` (a no-op in classic, where
   * `ctx.content` is null), never to the classic `bump` logic. Character impacts keep `onImpact`.
   */
  onBodyImpact?(a: Body, b: Body | null, approach: number): void;
}

/**
 * (Content 2.0, C0 contract; owner C3) Drive a kinematic body (teacup floor, bumper car, truck,
 * crane load) to a pose computed as a pure function of (tick, substep), with the matching
 * velocities so riders and contacts see the motion. Call from `beforeSubstep` with the pose at
 * the START of that substep (every substep while it accelerates; between calls the body moves
 * on at its velocity, so set v = 0 to park it). The body becomes `motion = 'kinematic'` without a weld parent; its own children may still weld
 * to it. Riders (`b.floor === body`) are carried rigidly (step 7, incl. the centripetal term of
 * a turning floor), contacts treat it as an immovable moving wall.
 */
export function setKinematicPose(b: Body, x: number, y: number, a: number, vx: number, vy: number, w: number): void {
  if (!b.kinPosed) {
    // the first pose is measured against the velocity it had before (a body at rest: 0), so a
    // truck whose first pose is already moving carries its riders from the start, like a stop
    b.kinPosed = true;
    b.kpvx = b.motion === 'static' ? 0 : b.vx;
    b.kpvy = b.motion === 'static' ? 0 : b.vy;
    b.kpw = b.motion === 'static' ? 0 : b.w;
  }
  b.motion = 'kinematic';
  b.weldParent = null;
  b.x = x;
  b.y = y;
  b.a = a;
  b.vx = vx;
  b.vy = vy;
  b.w = w;
}

export interface PhysicsParams {
  iterations: number;
  /** Baumgarte factor for contacts. */
  beta: number;
  slop: number;
  maxBias: number;
  /** Extra detection margin beyond velocity-based speculative margin. */
  baseMargin: number;
  softPushFactor: number;
  fenceResistForce: number;
  fenceGive: number;
  jointBeta: number;
  jointMaxCorr: number;
  /** Grip break force (N): per-tick impulse budget = force * tickDt. */
  gripBreakForce: number;
  /** Bounded lateral "grip friction" force keeping a holder on its grab side (N). */
  gripLateralForce: number;
  impactThreshold: number;
}

/** Uniform grid over world statics. */
class StaticGrid {
  readonly cells: StaticShape[][];
  readonly nx: number;
  readonly ny: number;
  constructor(
    readonly ox: number,
    readonly oy: number,
    readonly cell: number,
    w: number,
    h: number,
  ) {
    this.nx = Math.max(1, Math.ceil(w / cell));
    this.ny = Math.max(1, Math.ceil(h / cell));
    this.cells = [];
    for (let i = 0; i < this.nx * this.ny; i++) this.cells.push([]);
  }
  private cx(x: number): number {
    const i = Math.floor((x - this.ox) / this.cell);
    return i < 0 ? 0 : i >= this.nx ? this.nx - 1 : i;
  }
  private cy(y: number): number {
    const i = Math.floor((y - this.oy) / this.cell);
    return i < 0 ? 0 : i >= this.ny ? this.ny - 1 : i;
  }
  insert(s: StaticShape): void {
    const x0 = this.cx(s.minX);
    const x1 = this.cx(s.maxX);
    const y0 = this.cy(s.minY);
    const y1 = this.cy(s.maxY);
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) this.cells[j * this.nx + i]!.push(s);
  }
  /** Calls fn for each static whose AABB overlaps; each shape at most once per query. */
  query(minX: number, minY: number, maxX: number, maxY: number, stamp: number, out: StaticShape[]): void {
    const x0 = this.cx(minX);
    const x1 = this.cx(maxX);
    const y0 = this.cy(minY);
    const y1 = this.cy(maxY);
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        const cell = this.cells[j * this.nx + i]!;
        for (let k = 0; k < cell.length; k++) {
          const s = cell[k]!;
          if (s.stamp === stamp) continue;
          s.stamp = stamp;
          if (s.maxX < minX || s.minX > maxX || s.maxY < minY || s.minY > maxY) continue;
          out.push(s);
        }
      }
    }
  }
}

export class PhysicsWorld {
  readonly bodies: Body[] = [];
  readonly statics: StaticShape[] = [];
  readonly joints: GrabJoint[] = [];
  private grid: StaticGrid | null = null;
  private stamp = 1;
  private readonly contacts: Contact[] = [];
  private contactCount = 0;
  private readonly sorted: Body[] = [];
  private readonly scratchStatics: StaticShape[] = [];
  private readonly fencePoints = new Map<number, number>();
  /** Next body index (monotonic; never reused after removeBody). */
  private nextBodyIndex = 0;

  constructor(
    readonly params: PhysicsParams,
    readonly bounds: { minX: number; minY: number; maxX: number; maxY: number },
  ) {}

  createBody(entityId: number, cat: number): Body {
    const b = new Body(this.nextBodyIndex++, entityId, cat);
    this.bodies.push(b);
    this.sorted.push(b);
    return b;
  }

  /**
   * Remove a body for good (police officers boarding their car). Body indices are never
   * reused, so the remaining bodies keep their canonical (index) order. The body must not be
   * a weld parent, a floor or part of a grab joint.
   */
  removeBody(b: Body): void {
    const i = this.bodies.indexOf(b);
    if (i < 0) return;
    this.bodies.splice(i, 1);
    const k = this.sorted.indexOf(b);
    if (k >= 0) this.sorted.splice(k, 1);
    b.enabled = false;
  }

  addStaticBox(x: number, y: number, hx: number, hy: number, angle: number, tag: string): StaticShape {
    const s = new StaticShape();
    s.type = SHAPE_BOX;
    s.x = x;
    s.y = y;
    s.ux = Math.cos(angle);
    s.uy = Math.sin(angle);
    s.hx = hx;
    s.hy = hy;
    s.tag = tag;
    s.updateAABB(0);
    s.index = this.statics.length;
    this.statics.push(s);
    this.grid = null;
    return s;
  }

  addStaticCircle(x: number, y: number, r: number, tag: string): StaticShape {
    const s = new StaticShape();
    s.type = SHAPE_CIRCLE;
    s.x = x;
    s.y = y;
    s.r = r;
    s.tag = tag;
    s.updateAABB(0);
    s.index = this.statics.length;
    this.statics.push(s);
    this.grid = null;
    return s;
  }

  private ensureGrid(): StaticGrid {
    if (!this.grid) {
      const pad = 8;
      const g = new StaticGrid(
        this.bounds.minX - pad,
        this.bounds.minY - pad,
        4,
        this.bounds.maxX - this.bounds.minX + 2 * pad,
        this.bounds.maxY - this.bounds.minY + 2 * pad,
      );
      for (const s of this.statics) g.insert(s);
      this.grid = g;
    }
    return this.grid;
  }

  /** Statics (enabled or not) whose AABB overlaps the query box, in index order. */
  queryStatics(minX: number, minY: number, maxX: number, maxY: number): StaticShape[] {
    const out: StaticShape[] = [];
    this.ensureGrid().query(minX, minY, maxX, maxY, ++this.stamp, out);
    out.sort((p, q) => p.index - q.index);
    return out;
  }

  addJoint(j: GrabJoint): void {
    this.joints.push(j);
  }

  removeJoint(j: GrabJoint): void {
    const i = this.joints.indexOf(j);
    if (i >= 0) this.joints.splice(i, 1);
  }

  /** Synchronise a kinematic body's pose/velocity from its weld parent. */
  static syncWeld(b: Body): void {
    const p = b.weldParent;
    if (!p) return;
    const c = Math.cos(p.a);
    const s = Math.sin(p.a);
    const rx = b.weldLx * c - b.weldLy * s;
    const ry = b.weldLx * s + b.weldLy * c;
    b.x = p.x + rx;
    b.y = p.y + ry;
    b.a = p.a + b.weldLa;
    b.vx = p.vx - p.w * ry;
    b.vy = p.vy + p.w * rx;
    b.w = p.w;
  }

  /**
   * Advance one tick of `dt` seconds in `substeps` equal substeps.
   * Bodies' drive forces, floors, motion types, masses and joints must be prepared by the caller.
   */
  step(dt: number, substeps: number, hooks: PhysicsHooks): void {
    const h = dt / substeps;
    const P = this.params;
    for (const j of this.joints) {
      j.tickImpulse = 0;
      j.broke = false;
    }
    const gripTick = P.gripBreakForce * dt;
    for (const b of this.bodies) b.staticPush = false;
    for (let sub = 0; sub < substeps; sub++) {
      hooks.beforeSubstep?.(sub, substeps);
      const bodies = this.bodies;
      // 1. kinematic welds follow their parents; remember pre-substep velocities.
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i]!;
        if (!b.enabled) continue;
        if (b.motion === 'kinematic') PhysicsWorld.syncWeld(b);
        else if (b.motion === 'static') {
          b.vx = 0;
          b.vy = 0;
          b.w = 0;
        }
        b.pvx = b.vx;
        b.pvy = b.vy;
        b.pw = b.w;
      }
      // 2. forces + floor-relative drag (implicit, unconditionally stable).
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i]!;
        if (!b.enabled || b.motion !== 'dynamic') continue;
        let fvx = 0;
        let fvy = 0;
        let fw = 0;
        const f = b.floor;
        if (f && f.enabled) {
          const rx = b.x - f.x;
          const ry = b.y - f.y;
          fvx = f.vx - f.w * ry;
          fvy = f.vy + f.w * rx;
          fw = f.w;
          if (f.motion === 'kinematic' && f.kinPosed) {
            // (C3) rider of a posed kinematic floor (teacup, truck bed): its pose was set before
            // this substep, so inherit the change of floor velocity HERE, before drag pulls toward
            // the new floor velocity (carrying it after drag would count the change twice and walk
            // riders outward on every turn). Welded floors keep the post-solve carry of step 7.
            b.vx += fvx - (f.kpvx - f.kpw * ry);
            b.vy += fvy - (f.kpvy + f.kpw * rx);
            if (!b.fixedRotation) b.w += f.w - f.kpw;
          }
        }
        // Content 2.0 ground fields (neutral in classic, so classic is bit-identical): a belt /
        // fountain field velocity adds to the floor velocity drag pulls toward; slick / soap scale
        // the drag and the drive.
        if (b.fieldVx !== 0 || b.fieldVy !== 0) {
          fvx += b.fieldVx;
          fvy += b.fieldVy;
        }
        b.fvx = fvx;
        b.fvy = fvy;
        b.fw = fw;
        b.vx += b.fx * b.driveScale * b.invMass * h;
        b.vy += b.fy * b.driveScale * b.invMass * h;
        if (!b.noDrag) {
          const k = 1 / (1 + b.linDrag * b.dragScale * h);
          b.vx = fvx + (b.vx - fvx) * k;
          b.vy = fvy + (b.vy - fvy) * k;
          if (!b.fixedRotation) {
            const kw = b.yawDragExtra === 0 ? k : 1 / (1 + (b.linDrag * b.dragScale + b.yawDragExtra) * h);
            b.w = fw + (b.w - fw) * kw;
          }
        }
        if (b.fixedRotation) b.w = 0;
      }
      // 3. geometry with speculative margins.
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i]!;
        if (!b.enabled) continue;
        let m = P.baseMargin;
        if (b.motion !== 'static') {
          let ext = 0;
          for (const s of b.shapes) {
            const e = Math.hypot(s.lx, s.ly) + Math.max(s.r, Math.hypot(s.hx, s.hy));
            if (e > ext) ext = e;
          }
          m += (Math.hypot(b.vx, b.vy) + Math.abs(b.w) * ext) * h;
        }
        b.updateShapes(m);
      }
      // 4. collision detection.
      this.detect();
      // 5. prepare constraints.
      const n = this.contactCount;
      // a fence resists a bank with one shared force budget, however many points touch it
      this.fencePoints.clear();
      for (let i = 0; i < n; i++) {
        const c = this.contacts[i]!;
        if (c.st && c.st.fenceIndex >= 0 && c.a.cat === CAT_BANK) {
          const key = c.st.fenceIndex * 65536 + c.a.index;
          this.fencePoints.set(key, (this.fencePoints.get(key) ?? 0) + c.count);
        }
      }
      for (let i = 0; i < n; i++) this.prepareContact(this.contacts[i]!, h, hooks);
      for (const j of this.joints) j.prepare(h, gripTick, P.jointBeta, P.jointMaxCorr, P.gripLateralForce * h);
      // 6. iterate.
      for (let it = 0; it < P.iterations; it++) {
        for (const j of this.joints) j.solve();
        for (let i = 0; i < n; i++) this.solveContact(this.contacts[i]!);
      }
      for (const j of this.joints) {
        j.finishSubstep();
        if (j.tickImpulse > gripTick * 1.0001) j.broke = true;
      }
      // 7. moving-floor carry: riders inherit this substep's change of floor velocity.
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i]!;
        const f = b.floor;
        if (!b.enabled || b.motion !== 'dynamic' || !f || !f.enabled || f.motion === 'static') continue;
        const rx = b.x - f.x;
        const ry = b.y - f.y;
        // (C3) a posed kinematic floor's change was carried in step 2 (the turn itself is
        // integrated rigidly in step 8)
        if (f.motion === 'kinematic' && f.kinPosed) continue;
        const dvx = f.vx - f.w * ry - (f.pvx - f.pw * ry);
        const dvy = f.vy + f.w * rx - (f.pvy + f.pw * rx);
        b.vx += dvx;
        b.vy += dvy;
        if (!b.fixedRotation) b.w += f.w - f.pw;
      }
      // 8. integrate.
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i]!;
        if (!b.enabled || b.motion !== 'dynamic') continue;
        const f = b.floor;
        if (f && f.enabled && f.motion === 'kinematic') {
          // (C3) rider of a kinematic floor: turn with it rigidly over the substep (pose and
          // floor-relative velocity), so a teacup carries its riders round without drifting out.
          const rx = b.x - f.x;
          const ry = b.y - f.y;
          const relx = b.vx - (f.vx - f.w * ry);
          const rely = b.vy - (f.vy + f.w * rx);
          const c = Math.cos(f.w * h);
          const s = Math.sin(f.w * h);
          const nrx = rx * c - ry * s;
          const nry = rx * s + ry * c;
          const rvx = relx * c - rely * s;
          const rvy = relx * s + rely * c;
          b.x = f.x + f.vx * h + nrx + rvx * h;
          b.y = f.y + f.vy * h + nry + rvy * h;
          b.vx = f.vx - f.w * nry + rvx;
          b.vy = f.vy + f.w * nrx + rvy;
          if (!b.fixedRotation) b.a += b.w * h;
          continue;
        }
        b.x += b.vx * h;
        b.y += b.vy * h;
        if (!b.fixedRotation) b.a += b.w * h;
      }
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i]!;
        if (!b.enabled || b.motion !== 'kinematic') continue;
        PhysicsWorld.syncWeld(b);
        if (b.kinPosed && !b.weldParent) {
          // (C3) a posed kinematic body moves on with its velocity (the next setKinematicPose
          // snaps it to its exact pose), so at the end of the tick it agrees with its riders
          b.x += b.vx * h;
          b.y += b.vy * h;
          b.a += b.w * h;
          b.kpvx = b.vx;
          b.kpvy = b.vy;
          b.kpw = b.w;
        }
      }
      // 9. penetration bookkeeping (pre-integration depths of real, non-fence contacts).
      for (let i = 0; i < bodies.length; i++) bodies[i]!.maxPen = 0;
      for (let i = 0; i < n; i++) {
        const c = this.contacts[i]!;
        if (!c.b && ((c.count > 0 && c.p0.pn > 0) || (c.count > 1 && c.p1.pn > 0))) c.a.staticPush = true;
        if (c.fence) continue;
        let pen = 0;
        if (c.count > 0 && -c.p0.sep > pen) pen = -c.p0.sep;
        if (c.count > 1 && -c.p1.sep > pen) pen = -c.p1.sep;
        if (pen <= 0) continue;
        if (pen > c.a.maxPen) c.a.maxPen = pen;
        if (c.b && pen > c.b.maxPen) c.b.maxPen = pen;
      }
      hooks.afterSubstep?.(sub);
    }
  }

  /** Contacts from the most recent substep (valid until the next step). */
  lastContacts(): readonly Contact[] {
    return this.contacts.slice(0, this.contactCount);
  }

  // -------------------------------------------------------------------------
  // Broadphase + narrowphase
  // -------------------------------------------------------------------------

  private allocContact(): Contact {
    if (this.contactCount === this.contacts.length) this.contacts.push(new Contact());
    const c = this.contacts[this.contactCount]!;
    c.count = 0;
    c.st = null;
    c.b = null;
    c.fence = false;
    c.maxPn = Infinity;
    return c;
  }

  private detect(): void {
    this.contactCount = 0;
    const sorted = this.sorted;
    // insertion sort by minX (nearly sorted frame to frame), ties by index -> deterministic
    for (let i = 1; i < sorted.length; i++) {
      const b = sorted[i]!;
      let j = i - 1;
      while (j >= 0 && (sorted[j]!.minX > b.minX || (sorted[j]!.minX === b.minX && sorted[j]!.index > b.index))) {
        sorted[j + 1] = sorted[j]!;
        j--;
      }
      sorted[j + 1] = b;
    }
    // body-body sweep
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i]!;
      if (!a.enabled) continue;
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j]!;
        if (b.minX > a.maxX) break;
        if (!b.enabled) continue;
        if (b.maxY < a.minY || b.minY > a.maxY) continue;
        if (a.motion !== 'dynamic' && b.motion !== 'dynamic') continue;
        if (a.weldParent === b || b.weldParent === a) continue;
        if (a.ghost || b.ghost) continue;
        // keep pair order canonical by body index (determinism independent of sort position)
        if (a.index < b.index) this.bodyPair(a, b);
        else this.bodyPair(b, a);
      }
    }
    // body-static
    const grid = this.ensureGrid();
    const bodies = this.bodies;
    const scratch = this.scratchStatics;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!;
      if (!b.enabled || b.motion !== 'dynamic') continue;
      scratch.length = 0;
      grid.query(b.minX, b.minY, b.maxX, b.maxY, ++this.stamp, scratch);
      if (scratch.length > 1) scratch.sort((p, q) => p.index - q.index);
      for (let k = 0; k < scratch.length; k++) {
        const st = scratch[k]!;
        if (!st.enabled) continue;
        for (let s = 0; s < b.shapes.length; s++) {
          const sh = b.shapes[s]!;
          if (sh.maxX < st.minX || sh.minX > st.maxX || sh.maxY < st.minY || sh.minY > st.maxY) continue;
          const c = this.allocContact();
          if (collide(c, sh, st, b.margin)) {
            c.a = b;
            c.b = null;
            c.st = st;
            this.contactCount++;
          }
        }
      }
    }
  }

  private bodyPair(a: Body, b: Body): void {
    const margin = a.margin + b.margin;
    for (let i = 0; i < a.shapes.length; i++) {
      const sa = a.shapes[i]!;
      if (sa.maxX < b.minX || sa.minX > b.maxX || sa.maxY < b.minY || sa.minY > b.maxY) continue;
      for (let j = 0; j < b.shapes.length; j++) {
        const sb = b.shapes[j]!;
        if (sa.maxX < sb.minX || sa.minX > sb.maxX || sa.maxY < sb.minY || sa.minY > sb.maxY) continue;
        const c = this.allocContact();
        if (collide(c, sa, sb, margin)) {
          c.a = a;
          c.b = b;
          this.contactCount++;
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Solver
  // -------------------------------------------------------------------------

  /** True if a grab joint links the two bodies (a holder and the target it holds). */
  private gripPair(a: Body, b: Body): boolean {
    const js = this.joints;
    for (let i = 0; i < js.length; i++) {
      const j = js[i]!;
      if ((j.char === a && j.targetBody === b) || (j.char === b && j.targetBody === a)) return true;
    }
    return false;
  }

  private prepareContact(c: Contact, h: number, hooks: PhysicsHooks): void {
    const P = this.params;
    const a = c.a;
    const b = c.b;
    let imA = a.solverInvMass;
    let iiA = a.solverInvI;
    let imB = b ? b.solverInvMass : 0;
    let iiB = b ? b.solverInvI : 0;
    // soft push: a character (or officer) shoving loot moves it as if it were much heavier
    // (C3) except a dashing character against a kickable body (the piggy): a full-mass kick
    let kick = 0;
    // ... but never between a holder and the body its own grab joint holds. The joint couples
    // that pair at full mass, so a soft (non momentum-conserving) contact in the same loop turns
    // joint tension into free thrust: a holder pressed against the face it holds (two raccoons on
    // one face, a tug-of-war along a wall, a load spinning into its holder) made the load and
    // holder run away together toward the holder's side - 10-200 m/s loads, a bank dragged at
    // 3-10 m/s with idle sticks, the haul ignoring the stick (owner report: sudden speed-ups,
    // buildings dragged very fast, drag direction veering).
    if (b && ((a.cat ^ b.cat) & CAT_WALKER) !== 0 && !this.gripPair(a, b)) {
      if ((a.cat & CAT_WALKER) !== 0 && (b.cat & CAT_WALKER) === 0) {
        if (b.kickable && a.cat === CAT_CHARACTER && a.noDrag) kick = b.kickRestitution;
        else {
          imB *= P.softPushFactor;
          iiB *= P.softPushFactor;
        }
      } else if ((b.cat & CAT_WALKER) !== 0 && (a.cat & CAT_WALKER) === 0) {
        if (a.kickable && b.cat === CAT_CHARACTER && b.noDrag) kick = a.kickRestitution;
        else {
          imA *= P.softPushFactor;
          iiA *= P.softPushFactor;
        }
      }
    }
    // A rider cannot propel the floor it stands on: contacts between a body and the walls of
    // its own moving floor treat that floor as immovable. Otherwise a raccoon sheltering inside
    // an unanchored bank could walk into the inner wall (or shove cargo into it) and drive the
    // whole bank, bypassing "a character on a bank's floor cannot grab that bank" (doc §4).
    // Riders still feel the walls fully and are carried by the floor (moving-floor carry).
    if (b) {
      if (a.floor === b) {
        imB = 0;
        iiB = 0;
      } else if (b.floor === a) {
        imA = 0;
        iiA = 0;
      }
    }
    c.invMA = imA;
    c.invIA = iiA;
    c.invMB = imB;
    c.invIB = iiB;
    const charInvolved = a.cat === CAT_CHARACTER || (b !== null && b.cat === CAT_CHARACTER);
    const walkerInvolved = (a.cat & CAT_WALKER) !== 0 || (b !== null && (b.cat & CAT_WALKER) !== 0);
    c.friction = walkerInvolved ? 0.05 : 0.3;
    c.slop = P.slop;
    const st = c.st;
    if (st && st.fenceIndex >= 0 && a.cat === CAT_BANK) {
      c.fence = true;
      c.maxPn = (P.fenceResistForce * h) / (this.fencePoints.get(st.fenceIndex * 65536 + a.index) ?? 1);
      c.slop = P.fenceGive;
      c.friction = 0.1;
    }
    const nx = c.nx;
    const ny = c.ny;
    const tx = -ny;
    const ty = nx;
    for (let k = 0; k < c.count; k++) {
      const p = k === 0 ? c.p0 : c.p1;
      p.rax = p.px - a.x;
      p.ray = p.py - a.y;
      const rnA = p.rax * ny - p.ray * nx;
      const rtA = p.rax * ty - p.ray * tx;
      let kn = imA + iiA * rnA * rnA;
      let kt = imA + iiA * rtA * rtA;
      let vrx = -(a.vx - a.w * p.ray);
      let vry = -(a.vy + a.w * p.rax);
      if (b) {
        p.rbx = p.px - b.x;
        p.rby = p.py - b.y;
        const rnB = p.rbx * ny - p.rby * nx;
        const rtB = p.rbx * ty - p.rby * tx;
        kn += imB + iiB * rnB * rnB;
        kt += imB + iiB * rtB * rtB;
        vrx += b.vx - b.w * p.rby;
        vry += b.vy + b.w * p.rbx;
      }
      p.nMass = kn > 0 ? 1 / kn : 0;
      p.tMass = kt > 0 ? 1 / kt : 0;
      p.pn = 0;
      p.pt = 0;
      if (p.sep > 0) p.target = -p.sep / h;
      else {
        const pen = -p.sep - c.slop;
        p.target = pen > 0 ? Math.min((P.beta * pen) / h, P.maxBias) : 0;
      }
      const vn = vrx * nx + vry * ny;
      const approach = -vn;
      // (C3) a kick springs the ball off the foot (restitution on the closing speed)
      if (kick > 0 && approach > 0 && p.sep - approach * h < 0) p.target = Math.max(p.target, kick * approach);
      if (approach > 0 && p.sep - approach * h < 0) {
        if (c.fence && hooks.onFenceContact) hooks.onFenceContact(st!.fenceIndex, a, approach, p.px, p.py);
        else if (approach > P.impactThreshold && k === 0) {
          if (charInvolved) hooks.onImpact?.(a, b, approach);
          // (C3) impacts without a character (loot vs wall / loot / officer): content only
          else hooks.onBodyImpact?.(a, b, approach);
        }
      } else if (c.fence && hooks.onFenceContact && p.sep <= 0.02) {
        // resting press: report actual (non-approaching) speed so press timers reset correctly
        hooks.onFenceContact(st!.fenceIndex, a, Math.max(0, approach), p.px, p.py);
      }
    }
  }

  private solveContact(c: Contact): void {
    const a = c.a;
    const b = c.b;
    const nx = c.nx;
    const ny = c.ny;
    const tx = -ny;
    const ty = nx;
    const imA = c.invMA;
    const iiA = c.invIA;
    const imB = c.invMB;
    const iiB = c.invIB;
    for (let k = 0; k < c.count; k++) {
      const p = k === 0 ? c.p0 : c.p1;
      // normal
      let vrx = -(a.vx - a.w * p.ray);
      let vry = -(a.vy + a.w * p.rax);
      if (b) {
        vrx += b.vx - b.w * p.rby;
        vry += b.vy + b.w * p.rbx;
      }
      const vn = vrx * nx + vry * ny;
      let lambda = p.nMass * (p.target - vn);
      let next = p.pn + lambda;
      if (next < 0) next = 0;
      else if (next > c.maxPn) next = c.maxPn;
      lambda = next - p.pn;
      p.pn = next;
      let px = lambda * nx;
      let py = lambda * ny;
      a.vx -= px * imA;
      a.vy -= py * imA;
      a.w -= iiA * (p.rax * py - p.ray * px);
      if (b) {
        b.vx += px * imB;
        b.vy += py * imB;
        b.w += iiB * (p.rbx * py - p.rby * px);
      }
      // friction
      if (c.friction > 0 && p.tMass > 0) {
        vrx = -(a.vx - a.w * p.ray);
        vry = -(a.vy + a.w * p.rax);
        if (b) {
          vrx += b.vx - b.w * p.rby;
          vry += b.vy + b.w * p.rbx;
        }
        const vt = vrx * tx + vry * ty;
        let lt = -p.tMass * vt;
        const maxF = c.friction * p.pn;
        let nt = p.pt + lt;
        if (nt > maxF) nt = maxF;
        else if (nt < -maxF) nt = -maxF;
        lt = nt - p.pt;
        p.pt = nt;
        px = lt * tx;
        py = lt * ty;
        a.vx -= px * imA;
        a.vy -= py * imA;
        a.w -= iiA * (p.rax * py - p.ray * px);
        if (b) {
          b.vx += px * imB;
          b.vy += py * imB;
          b.w += iiB * (p.rbx * py - p.rby * px);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Narrowphase. Normal always points from geometry A to geometry B; sep < 0 = penetration.
// ---------------------------------------------------------------------------

function collide(c: Contact, A: Geom, B: Geom, margin: number): boolean {
  if (A.type === SHAPE_CIRCLE) {
    if (B.type === SHAPE_CIRCLE) return circleCircle(c, A, B, margin);
    return circleBox(c, A, B, margin, false);
  }
  if (B.type === SHAPE_CIRCLE) return circleBox(c, B, A, margin, true);
  return boxBox(c, A, B, margin);
}

function circleCircle(c: Contact, A: Geom, B: Geom, margin: number): boolean {
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const d = Math.hypot(dx, dy);
  const sep = d - A.r - B.r;
  if (sep > margin) return false;
  let nx = 1;
  let ny = 0;
  if (d > 1e-9) {
    nx = dx / d;
    ny = dy / d;
  }
  c.nx = nx;
  c.ny = ny;
  c.count = 1;
  const p = c.p0;
  const off = A.r + sep * 0.5;
  p.px = A.x + nx * off;
  p.py = A.y + ny * off;
  p.sep = sep;
  return true;
}

/** Circle `C` vs box `X`. Normal from circle to box, negated when `flip` (box is geometry A). */
function circleBox(c: Contact, C: Geom, X: Geom, margin: number, flip: boolean): boolean {
  const ux = X.ux;
  const uy = X.uy;
  const vx = -uy;
  const vy = ux;
  const dx = C.x - X.x;
  const dy = C.y - X.y;
  const lx = dx * ux + dy * uy;
  const ly = dx * vx + dy * vy;
  const hx = X.hx;
  const hy = X.hy;
  let nlx: number; // normal from circle to box, local
  let nly: number;
  let sep: number;
  let qx: number;
  let qy: number;
  if (Math.abs(lx) <= hx && Math.abs(ly) <= hy) {
    const ex = hx - Math.abs(lx);
    const ey = hy - Math.abs(ly);
    if (ex < ey) {
      const sx = lx >= 0 ? 1 : -1;
      nlx = -sx;
      nly = 0;
      sep = -ex - C.r;
      qx = sx * hx;
      qy = ly;
    } else {
      const sy = ly >= 0 ? 1 : -1;
      nlx = 0;
      nly = -sy;
      sep = -ey - C.r;
      qx = lx;
      qy = sy * hy;
    }
  } else {
    qx = lx < -hx ? -hx : lx > hx ? hx : lx;
    qy = ly < -hy ? -hy : ly > hy ? hy : ly;
    const ddx = lx - qx;
    const ddy = ly - qy;
    const dist = Math.hypot(ddx, ddy);
    sep = dist - C.r;
    if (sep > margin) return false;
    nlx = -ddx / dist;
    nly = -ddy / dist;
  }
  if (sep > margin) return false;
  let nx = nlx * ux + nly * vx;
  let ny = nlx * uy + nly * vy;
  if (flip) {
    nx = -nx;
    ny = -ny;
  }
  c.nx = nx;
  c.ny = ny;
  c.count = 1;
  const p = c.p0;
  p.px = X.x + qx * ux + qy * vx;
  p.py = X.y + qx * uy + qy * vy;
  p.sep = sep;
  return true;
}

function boxBox(c: Contact, A: Geom, B: Geom, margin: number): boolean {
  const aux = A.ux;
  const auy = A.uy;
  const avx = -auy;
  const avy = aux;
  const bux = B.ux;
  const buy = B.uy;
  const bvx = -buy;
  const bvy = bux;
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const c00 = Math.abs(aux * bux + auy * buy);
  const c01 = Math.abs(aux * bvx + auy * bvy);
  const c10 = Math.abs(avx * bux + avy * buy);
  const c11 = Math.abs(avx * bvx + avy * bvy);
  const dAu = dx * aux + dy * auy;
  const dAv = dx * avx + dy * avy;
  const dBu = dx * bux + dy * buy;
  const dBv = dx * bvx + dy * bvy;
  const sAu = Math.abs(dAu) - A.hx - (B.hx * c00 + B.hy * c01);
  if (sAu > margin) return false;
  const sAv = Math.abs(dAv) - A.hy - (B.hx * c10 + B.hy * c11);
  if (sAv > margin) return false;
  const sBu = Math.abs(dBu) - B.hx - (A.hx * c00 + A.hy * c10);
  if (sBu > margin) return false;
  const sBv = Math.abs(dBv) - B.hy - (A.hx * c01 + A.hy * c11);
  if (sBv > margin) return false;

  // choose the reference face (prefer A's faces, then B's, with hysteresis-free tolerance)
  let axis = 0;
  let best = sAu;
  if (sAv > 0.95 * best + 0.01 * A.hy) {
    axis = 1;
    best = sAv;
  }
  if (sBu > 0.95 * best + 0.01 * B.hx) {
    axis = 2;
    best = sBu;
  }
  if (sBv > 0.95 * best + 0.01 * B.hy) {
    axis = 3;
    best = sBv;
  }

  let R: Geom;
  let I: Geom;
  let nx: number;
  let ny: number;
  let refN: number; // ref half extent along normal
  let refT: number; // ref half extent along tangent
  let flip: boolean;
  if (axis === 0) {
    R = A;
    I = B;
    const sg = dAu >= 0 ? 1 : -1;
    nx = aux * sg;
    ny = auy * sg;
    refN = A.hx;
    refT = A.hy;
    flip = false;
  } else if (axis === 1) {
    R = A;
    I = B;
    const sg = dAv >= 0 ? 1 : -1;
    nx = avx * sg;
    ny = avy * sg;
    refN = A.hy;
    refT = A.hx;
    flip = false;
  } else if (axis === 2) {
    R = B;
    I = A;
    const sg = dBu >= 0 ? -1 : 1; // from B toward A
    nx = bux * sg;
    ny = buy * sg;
    refN = B.hx;
    refT = B.hy;
    flip = true;
  } else {
    R = B;
    I = A;
    const sg = dBv >= 0 ? -1 : 1;
    nx = bvx * sg;
    ny = bvy * sg;
    refN = B.hy;
    refT = B.hx;
    flip = true;
  }
  const tx = -ny;
  const ty = nx;
  const rfx = R.x + nx * refN;
  const rfy = R.y + ny * refN;
  const rtx = R.x; // tangent coordinate origin = ref center projected
  const rty = R.y;
  // incident face: the I face whose normal is most anti-parallel to n
  const iux = I.ux;
  const iuy = I.uy;
  const ivx = -iuy;
  const ivy = iux;
  const du = iux * nx + iuy * ny;
  const dv = ivx * nx + ivy * ny;
  let fnx: number;
  let fny: number;
  let fh: number; // half extent along face normal
  let ftx: number;
  let fty: number;
  let fth: number; // half length of the face
  if (Math.abs(du) >= Math.abs(dv)) {
    const sg = du > 0 ? -1 : 1;
    fnx = iux * sg;
    fny = iuy * sg;
    fh = I.hx;
    ftx = ivx;
    fty = ivy;
    fth = I.hy;
  } else {
    const sg = dv > 0 ? -1 : 1;
    fnx = ivx * sg;
    fny = ivy * sg;
    fh = I.hy;
    ftx = iux;
    fty = iuy;
    fth = I.hx;
  }
  const fcx = I.x + fnx * fh;
  const fcy = I.y + fny * fh;
  let v1x = fcx + ftx * fth;
  let v1y = fcy + fty * fth;
  let v2x = fcx - ftx * fth;
  let v2y = fcy - fty * fth;
  // clip against the reference face side planes (tangent range [-refT, refT] around ref center)
  let s1 = (v1x - rtx) * tx + (v1y - rty) * ty;
  let s2 = (v2x - rtx) * tx + (v2y - rty) * ty;
  // lower bound
  if (s1 < -refT && s2 < -refT) return false;
  if (s1 < -refT) {
    const t = (-refT - s1) / (s2 - s1);
    v1x += (v2x - v1x) * t;
    v1y += (v2y - v1y) * t;
    s1 = -refT;
  } else if (s2 < -refT) {
    const t = (-refT - s2) / (s1 - s2);
    v2x += (v1x - v2x) * t;
    v2y += (v1y - v2y) * t;
    s2 = -refT;
  }
  // upper bound
  if (s1 > refT && s2 > refT) return false;
  if (s1 > refT) {
    const t = (s1 - refT) / (s1 - s2);
    v1x += (v2x - v1x) * t;
    v1y += (v2y - v1y) * t;
  } else if (s2 > refT) {
    const t = (s2 - refT) / (s2 - s1);
    v2x += (v1x - v2x) * t;
    v2y += (v1y - v2y) * t;
  }
  const sep1 = (v1x - rfx) * nx + (v1y - rfy) * ny;
  const sep2 = (v2x - rfx) * nx + (v2y - rfy) * ny;
  let count = 0;
  if (sep1 <= margin) {
    const p = c.p0;
    p.px = v1x - nx * sep1 * 0.5;
    p.py = v1y - ny * sep1 * 0.5;
    p.sep = sep1;
    count = 1;
  }
  if (sep2 <= margin) {
    const p = count === 0 ? c.p0 : c.p1;
    p.px = v2x - nx * sep2 * 0.5;
    p.py = v2y - ny * sep2 * 0.5;
    p.sep = sep2;
    count++;
  }
  if (count === 0) return false;
  c.count = count;
  c.nx = flip ? -nx : nx;
  c.ny = flip ? -ny : ny;
  return true;
}
