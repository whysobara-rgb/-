/**
 * Grab-target highlight (doc §4: "잡기 전 대상 전체에 윤곽을 표시한다").
 *
 * Inverted-hull outline: every mesh of the target gets a back-face hull child that shares
 * its geometry and pushes vertices along *smoothed* normals (averaged per position, so hard
 * edged boxes do not crack open at corners). Thickness scales with view depth, giving a
 * near-constant on-screen width (~3 px at the game camera distance).
 *
 * Silhouette only: big merged rigs (bank, van, safes) would otherwise show a hull line
 * around every window, column and awning, because each protruding sub-part's hull sits in
 * front of the object's own surface. Their hulls are therefore also pushed AWAY from the
 * camera along the view ray (screen position unchanged) by a depth that grows with height:
 * inside the object's footprint the pushed hull ends up behind the object's own surface and
 * is hidden, while around the silhouette nothing of the object covers it. The push is
 * capped by height (slope * worldY) so the contact edge with the ground keeps its outline.
 * Characters keep the plain hull (inner lines around arms/hats read well on them).
 *
 * Hulls are created lazily the first time a highlight is shown, are children of the source
 * meshes (they inherit transforms, visibility and animation), never cast shadows, and are
 * ignored by raycasts.
 */
import * as THREE from 'three';

const OUTLINE_ATTR = 'outlineNormal';

/** Screen-ish thickness: world offset = thickness * view depth. */
export const OUTLINE_THICKNESS = { value: 0.0026 };
/** Permanent toon ink outline (characters, officers, safes): a touch bolder than the highlight. */
export const INK_THICKNESS = { value: 0.0034 };
export const INK_COLOR = '#2A2131';

const outlineMats = new Map<string, THREE.ShaderMaterial>();

/** Silhouette-only tuning for a Highlighter (see the header). */
export interface OutlineOptions {
  /** Maximum push-back along the view ray (m). 0 = plain hull (default). */
  pushMax?: number;
  /** Push-back per meter of world height above the ground (keeps ground contact outlined). */
  pushSlope?: number;
  /** Shared thickness uniform (default OUTLINE_THICKNESS). */
  thickness?: { value: number };
  /** Cutaway plane (object space) shared with the cut source materials. */
  cutPlane?: { value: THREE.Vector4 } | null;
}

let cutKeys = new WeakMap<object, number>();
let cutKeyNext = 1;
function uniformKey(u: object | null | undefined): number {
  if (!u) return 0;
  let k = cutKeys.get(u);
  if (!k) cutKeys.set(u, (k = cutKeyNext++));
  return k;
}

/** Shared outline material per color + push settings. */
export function outlineMaterial(color: THREE.ColorRepresentation, o: OutlineOptions = {}): THREE.ShaderMaterial {
  const c = new THREE.Color(color);
  const pushMax = o.pushMax ?? 0;
  const pushSlope = o.pushSlope ?? 0.7;
  const thickness = o.thickness ?? OUTLINE_THICKNESS;
  const cut = o.cutPlane ?? null;
  const key = `${c.getHexString()}|${pushMax}|${pushSlope}|t${uniformKey(thickness)}|c${uniformKey(cut)}`;
  let m = outlineMats.get(key);
  if (!m) {
    m = new THREE.ShaderMaterial({
      defines: cut ? { UH_CUT: 1 } : {},
      uniforms: {
        uColor: { value: c },
        uThickness: thickness,
        uPushMax: { value: pushMax },
        uPushSlope: { value: pushSlope },
        uCutPlane: cut ?? { value: new THREE.Vector4(0, 1, 0, 1e4) },
      },
      vertexShader: /* glsl */ `
        attribute vec3 outlineNormal;
        uniform float uThickness;
        uniform float uPushMax;
        uniform float uPushSlope;
        varying vec3 vLocal;
        void main() {
          vLocal = position;
          vec3 n = outlineNormal;
          float l = length(n);
          n = l > 1e-5 ? normalize(normalMatrix * (n / l)) : vec3(0.0);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          mv.xyz += n * uThickness * max(-mv.z, 2.0);
          if (uPushMax > 0.0) {
            // Slide away from the camera along the view ray: same pixel, deeper depth.
            float wy = (modelMatrix * vec4(position, 1.0)).y;
            float push = min(uPushMax, uPushSlope * max(wy - 0.03, 0.0));
            float len = max(length(mv.xyz), 1e-3);
            mv.xyz *= (len + push) / len;
          }
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform vec4 uCutPlane;
        varying vec3 vLocal;
        void main() {
          #ifdef UH_CUT
          if (dot(vLocal, uCutPlane.xyz) > uCutPlane.w + 0.02) discard;
          #endif
          gl_FragColor = vec4(uColor, 1.0);
          #include <colorspace_fragment>
        }
      `,
      side: THREE.BackSide,
    });
    m.name = `outline#${key}`;
    outlineMats.set(key, m);
  }
  return m;
}

/** Add an `outlineNormal` attribute (normals averaged over coincident positions). */
export function ensureOutlineNormals(geo: THREE.BufferGeometry): void {
  if (geo.getAttribute(OUTLINE_ATTR)) return;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos) return;
  let nrm = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (!nrm) {
    geo.computeVertexNormals();
    nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
  }
  const count = pos.count;
  const keyOf = (i: number): string =>
    `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  const acc = new Map<string, [number, number, number]>();
  for (let i = 0; i < count; i++) {
    const k = keyOf(i);
    let a = acc.get(k);
    if (!a) acc.set(k, (a = [0, 0, 0]));
    a[0] += nrm.getX(i);
    a[1] += nrm.getY(i);
    a[2] += nrm.getZ(i);
  }
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = acc.get(keyOf(i))!;
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    out[i * 3] = a[0] / l;
    out[i * 3 + 1] = a[1] / l;
    out[i * 3 + 2] = a[2] / l;
  }
  geo.setAttribute(OUTLINE_ATTR, new THREE.BufferAttribute(out, 3));
}

const noRaycast = (): void => {};

/**
 * Per-object highlight controller. `set(color)` shows the outline in that color,
 * `set(null)` hides it. Call `rebuild()` after swapping geometries in the target.
 */
export class Highlighter {
  private hulls: THREE.Mesh[] | null = null;
  private color: THREE.Color | null = null;
  /** userData slot holding this highlighter's hull on each source mesh. */
  protected slot = 'outlineHull';

  constructor(
    private readonly target: THREE.Object3D,
    private readonly options: OutlineOptions = {},
  ) {}

  get active(): boolean {
    return this.color !== null;
  }

  set(color: THREE.ColorRepresentation | null): void {
    if (color === null || color === undefined) {
      this.color = null;
      if (this.hulls) for (const h of this.hulls) h.visible = false;
      return;
    }
    this.color = new THREE.Color(color);
    if (!this.hulls) this.build();
    const mat = outlineMaterial(this.color, this.options);
    for (const h of this.hulls!) {
      h.material = mat;
      h.visible = (h.userData.hullEnabled as boolean | undefined) !== false;
    }
  }

  /** Enable/disable the hull of one source mesh (e.g. a faded wall). */
  setMeshEnabled(mesh: THREE.Object3D, enabled: boolean): void {
    const hull = mesh.userData[this.slot] as THREE.Mesh | undefined;
    if (!hull) {
      mesh.userData.outlineWanted = enabled;
      return;
    }
    hull.userData.hullEnabled = enabled;
    hull.visible = enabled && this.color !== null;
  }

  /** Drop hulls and recreate them on the next highlight (after geometry changes). */
  rebuild(): void {
    const col = this.color;
    this.removeHulls();
    if (col) this.set(col);
  }

  dispose(): void {
    this.removeHulls();
    this.color = null;
  }

  private build(): void {
    const sources: THREE.Mesh[] = [];
    this.target.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.userData.isOutlineHull || m.userData.noOutline) return;
      sources.push(m);
    });
    this.hulls = [];
    for (const src of sources) {
      ensureOutlineNormals(src.geometry);
      const hull = new THREE.Mesh(src.geometry, outlineMaterial(this.color ?? 0xffffff, this.options));
      hull.name = `${src.name}:outline`;
      hull.userData.isOutlineHull = true;
      hull.castShadow = false;
      hull.receiveShadow = false;
      hull.raycast = noRaycast;
      hull.frustumCulled = src.frustumCulled;
      if (src.userData.outlineWanted === false) hull.userData.hullEnabled = false;
      src.userData[this.slot] = hull;
      src.add(hull);
      this.hulls.push(hull);
    }
  }

  private removeHulls(): void {
    if (!this.hulls) return;
    for (const h of this.hulls) {
      const parent = h.parent;
      if (parent) {
        if (parent.userData[this.slot] === h) delete parent.userData[this.slot];
        parent.remove(h);
      }
    }
    this.hulls = null;
  }
}

/**
 * Permanent toon ink line (bold silhouette for characters, officers and loot so they read at
 * the high game camera). Hidden while a colored highlight replaces it (setVisible(false)).
 */
export class InkOutline extends Highlighter {
  constructor(target: THREE.Object3D, options: OutlineOptions = {}, color: THREE.ColorRepresentation = INK_COLOR) {
    super(target, { thickness: INK_THICKNESS, ...options });
    this.slot = 'inkHull';
    this.set(color);
    this.inkColor = color;
  }
  private inkColor: THREE.ColorRepresentation;
  private shown = true;
  setVisible(v: boolean): void {
    if (v === this.shown) return;
    this.shown = v;
    this.set(v ? this.inkColor : null);
  }
  /** Rebuild after geometry swaps (keeps visibility). */
  refresh(): void {
    this.rebuild();
    if (this.shown) this.set(this.inkColor);
  }
}

export function disposeOutlineCache(): void {
  outlineMats.forEach((m) => m.dispose());
  outlineMats.clear();
  cutKeys = new WeakMap();
}
