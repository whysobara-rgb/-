/**
 * Grab-target highlight (doc §4: "잡기 전 대상 전체에 윤곽을 표시한다").
 *
 * Inverted-hull outline: every mesh of the target gets a back-face hull child that shares
 * its geometry and pushes vertices along *smoothed* normals (averaged per position, so hard
 * edged boxes do not crack open at corners). Thickness scales with view depth, giving a
 * near-constant on-screen width (~3 px at the game camera distance).
 *
 * Hulls are created lazily the first time a highlight is shown, are children of the source
 * meshes (they inherit transforms, visibility and animation), never cast shadows, and are
 * ignored by raycasts.
 */
import * as THREE from 'three';

const OUTLINE_ATTR = 'outlineNormal';

/** Screen-ish thickness: world offset = thickness * view depth. */
export const OUTLINE_THICKNESS = { value: 0.0026 };

const outlineMats = new Map<string, THREE.ShaderMaterial>();

/** Shared outline material per color. */
export function outlineMaterial(color: THREE.ColorRepresentation): THREE.ShaderMaterial {
  const c = new THREE.Color(color);
  const key = c.getHexString();
  let m = outlineMats.get(key);
  if (!m) {
    m = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: c },
        uThickness: OUTLINE_THICKNESS,
      },
      vertexShader: /* glsl */ `
        attribute vec3 outlineNormal;
        uniform float uThickness;
        void main() {
          vec3 n = outlineNormal;
          float l = length(n);
          n = l > 1e-5 ? normalize(normalMatrix * (n / l)) : vec3(0.0);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          mv.xyz += n * uThickness * max(-mv.z, 2.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        void main() {
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

  constructor(private readonly target: THREE.Object3D) {}

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
    const mat = outlineMaterial(this.color);
    for (const h of this.hulls!) {
      h.material = mat;
      h.visible = (h.userData.hullEnabled as boolean | undefined) !== false;
    }
  }

  /** Enable/disable the hull of one source mesh (e.g. a faded wall). */
  setMeshEnabled(mesh: THREE.Object3D, enabled: boolean): void {
    const hull = mesh.userData.outlineHull as THREE.Mesh | undefined;
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
      const hull = new THREE.Mesh(src.geometry, outlineMaterial(this.color ?? 0xffffff));
      hull.name = `${src.name}:outline`;
      hull.userData.isOutlineHull = true;
      hull.castShadow = false;
      hull.receiveShadow = false;
      hull.raycast = noRaycast;
      hull.frustumCulled = src.frustumCulled;
      if (src.userData.outlineWanted === false) hull.userData.hullEnabled = false;
      src.userData.outlineHull = hull;
      src.add(hull);
      this.hulls.push(hull);
    }
  }

  private removeHulls(): void {
    if (!this.hulls) return;
    for (const h of this.hulls) {
      const parent = h.parent;
      if (parent) {
        if (parent.userData.outlineHull === h) delete parent.userData.outlineHull;
        parent.remove(h);
      }
    }
    this.hulls = null;
  }
}

export function disposeOutlineCache(): void {
  outlineMats.forEach((m) => m.dispose());
  outlineMats.clear();
}
