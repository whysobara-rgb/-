/**
 * Off-screen attention markers (screen-edge stickers): "something important is happening over
 * there" — the police car arriving with its siren behind the shop row, or an officer chasing
 * the player from outside the frame. Each marker is a hand-drawn sticker from the emote atlas
 * (siren dome / "!") pinned to the screen edge, with a flashing red / blue halo and a fat arrow
 * pointing at the target.
 *
 * Rendering: ONE instanced draw call in clip space (constant pixel size, crisp at any zoom),
 * drawn last with no depth test. Positions come from projecting the world target and clamping
 * the direction to an inset screen box.
 */
import * as THREE from 'three';
import { EMOTE_ATLAS, EMOTE_CELLS, emoteAtlasTexture, type EmoteKind } from './models/art';

export interface MarkerRequest {
  /** World (three) point of the target. */
  x: number;
  y: number;
  z: number;
  icon: EmoteKind;
  /** Size multiplier (1 = ~64 px icon). */
  scale?: number;
  /** 0..1 opacity. */
  alpha?: number;
  /** Flashing red / blue halo behind the icon. */
  siren?: boolean;
  /**
   * The target is hidden behind scenery: when it projects on screen, the icon hovers over it
   * (no arrow) instead of disappearing.
   */
  occluded?: boolean;
}

/** Inset of the marker box from the screen edge (CSS px). */
const INSET = 60;
const ICON_PX = 78;

const _v = new THREE.Vector3();

export class OffscreenMarkers {
  readonly mesh: THREE.InstancedMesh;
  private readonly geo: THREE.PlaneGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly a: THREE.InstancedBufferAttribute;
  private readonly b: THREE.InstancedBufferAttribute;
  private readonly cap: number;
  private width = 1;
  private height = 1;
  private n = 0;
  /** Drop the pulse / halo flashing (reduced motion). */
  calm = false;

  constructor(capacity = 8) {
    this.cap = capacity * 3;
    this.geo = new THREE.PlaneGeometry(1, 1);
    const { cols, rows } = EMOTE_ATLAS;
    this.a = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 4), 4);
    this.b = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 4), 4);
    this.a.setUsage(THREE.DynamicDrawUsage);
    this.b.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iA', this.a);
    this.geo.setAttribute('iB', this.b);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: emoteAtlasTexture() }, uViewport: { value: new THREE.Vector2(1, 1) } },
      defines: { COLS: `${cols}.0`, ROWS: `${rows}.0` },
      vertexShader: /* glsl */ `
        attribute vec4 iA; // ndc x, ndc y, size px, rotation
        attribute vec4 iB; // cell (-1 = halo), alpha, halo color (0 red .. 1 blue), -
        uniform vec2 uViewport;
        varying vec2 vUv;
        varying vec2 vLocal;
        varying vec4 vB;
        void main() {
          float c = cos(iA.w);
          float s = sin(iA.w);
          vec2 p = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
          vec2 off = p * iA.z * 2.0 / uViewport;
          gl_Position = vec4(iA.xy + off, 0.0, 1.0);
          float col = mod(max(iB.x, 0.0), COLS);
          float row = floor(max(iB.x, 0.0) / COLS + 0.001);
          vUv = (vec2(col, ROWS - 1.0 - row) + uv) / vec2(COLS, ROWS);
          vLocal = position.xy * 2.0;
          vB = iB;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec2 vUv;
        varying vec2 vLocal;
        varying vec4 vB;
        void main() {
          vec4 t;
          if (vB.x < -0.5) {
            float r = length(vLocal);
            float g = smoothstep(1.0, 0.25, r);
            vec3 col = mix(vec3(1.0, 0.24, 0.32), vec3(0.28, 0.5, 1.0), vB.z);
            t = vec4(col, g * 0.8);
          } else {
            t = texture2D(uMap, vUv);
            t.rgb *= 0.93;
          }
          if (t.a * vB.y < 0.02) discard;
          gl_FragColor = vec4(t.rgb, t.a * vB.y);
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, this.cap);
    this.mesh.name = 'offscreenMarkers';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 40;
    this.mesh.userData.noOutline = true;
    this.mesh.raycast = () => {};
  }

  setSize(w: number, h: number): void {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.mat.uniforms.uViewport.value.set(this.width, this.height);
  }

  /** Start a frame (drops last frame's markers). */
  begin(): void {
    this.n = 0;
  }

  /**
   * Add a marker for a world point if it is off screen. Returns true when a marker was placed.
   * `time` drives the pulse / halo flash.
   */
  add(camera: THREE.Camera, req: MarkerRequest, time: number): boolean {
    if (this.n + 3 > this.cap) return false;
    _v.set(req.x, req.y, req.z).applyMatrix4(camera.matrixWorldInverse);
    const behind = _v.z > 0;
    _v.set(req.x, req.y, req.z).project(camera);
    let nx = _v.x;
    let ny = _v.y;
    if (behind) {
      nx = -nx;
      ny = -ny;
    }
    const mx = 1 - (2 * 12) / this.width;
    const my = 1 - (2 * 12) / this.height;
    const onScreen = !behind && Math.abs(nx) < mx && Math.abs(ny) < my;
    if (onScreen && !req.occluded) return false;
    const alpha0 = req.alpha ?? 1;
    const pulse0 = this.calm ? 1 : 1 + 0.08 * Math.sin(time * 9);
    const size0 = ICON_PX * (req.scale ?? 1);
    if (onScreen) {
      // Hidden behind a building: hover over it, inside the inset box.
      const hx = THREE.MathUtils.clamp(nx * this.width * 0.5, -this.width * 0.5 + INSET, this.width * 0.5 - INSET);
      const hy = THREE.MathUtils.clamp(ny * this.height * 0.5 + size0 * 0.45, -this.height * 0.5 + INSET, this.height * 0.5 - INSET);
      const bob = this.calm ? 0 : Math.abs(Math.sin(time * 5)) * 6;
      const ux = hx / (this.width * 0.5);
      const uy = (hy + bob) / (this.height * 0.5);
      if (req.siren) this.put(ux, uy, size0 * 1.9 * pulse0, 0, -1, alpha0, this.calm ? 0.5 : Math.sin(time * 14) > 0 ? 0 : 1);
      this.put(ux, uy, size0 * pulse0, 0, EMOTE_CELLS[req.icon], alpha0, 0);
      return true;
    }
    // Clamp the direction from the screen center to the inset box (pixel aspect aware).
    const px = nx * this.width * 0.5;
    const py = ny * this.height * 0.5;
    const bx = this.width * 0.5 - INSET;
    const by = this.height * 0.5 - INSET;
    const len = Math.hypot(px, py) || 1;
    const k = Math.min(bx / Math.max(1e-3, Math.abs(px)), by / Math.max(1e-3, Math.abs(py)));
    const ex = px * Math.min(1, k);
    const ey = py * Math.min(1, k);
    const ang = Math.atan2(py / len, px / len);
    const alpha = req.alpha ?? 1;
    const pulse = this.calm ? 1 : 1 + 0.08 * Math.sin(time * 9);
    const size = ICON_PX * (req.scale ?? 1);
    const toNdc = (x: number, y: number): [number, number] => [x / (this.width * 0.5), y / (this.height * 0.5)];
    if (req.siren) {
      const red = this.calm ? 0.5 : Math.sin(time * 14) > 0 ? 0 : 1;
      const [hx, hy] = toNdc(ex, ey);
      this.put(hx, hy, size * 1.9 * pulse, 0, -1, alpha, red);
    }
    // Arrow sits outside the icon toward the target.
    const [ax, ay] = toNdc(ex + Math.cos(ang) * size * 0.62, ey + Math.sin(ang) * size * 0.62);
    this.put(ax, ay, size * 0.62, ang, EMOTE_CELLS.pointer, alpha, 0);
    const [ix, iy] = toNdc(ex, ey);
    this.put(ix, iy, size * pulse, 0, EMOTE_CELLS[req.icon], alpha, 0);
    return true;
  }

  private put(x: number, y: number, size: number, rot: number, cell: number, alpha: number, hue: number): void {
    const i = this.n++;
    this.a.setXYZW(i, x, y, size, rot);
    this.b.setXYZW(i, cell, alpha, hue, 0);
  }

  /** Finish the frame (upload). */
  end(): void {
    this.mesh.count = this.n;
    this.a.needsUpdate = true;
    this.b.needsUpdate = true;
  }

  get count(): number {
    return this.mesh.count;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.geo.dispose();
    this.mat.dispose();
  }
}
