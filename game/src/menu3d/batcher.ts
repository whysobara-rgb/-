/**
 * Draw-call batcher for the menu scenes (budget: <= 60 draw calls per scene).
 *
 * The procedural rigs (src/render/models) are built from one mesh per rigid part: a raccoon is
 * ~22 draw calls, a bank ~18. The menus show several of them at once, so instead of touching
 * the rigs (read-only for us) this mirrors them: every frame, after the rigs animated, each
 * opaque mesh that shares its material with other meshes is drawn through one THREE.BatchedMesh
 * per (material, vertex layout) — one multi-draw call for all raccoon bodies, one for all ink
 * outlines, and so on. The source meshes keep animating exactly as before (their matrixWorld is
 * the instance matrix); they are only moved to a hidden layer so the camera skips them.
 *
 * Meshes that cannot be batched safely stay as they are: transparent materials (sorting),
 * per-object render hooks (camera-facing labels), instanced / skinned / morphed meshes, and any
 * material used by a single mesh only (nothing to gain).
 *
 * The set of meshes is re-checked every sync() with a cheap signature (mesh ids + geometry
 * ids + materials). Anything that changes it (a hat swap rebuilds raccoon geometry, an FX mesh
 * appears) rebuilds the batches on the spot; that is rare and costs a few milliseconds.
 */
import * as THREE from 'three';

/** Layer the mirrored source meshes move to (never enabled on any menu camera). */
export const HIDDEN_LAYER = 30;

interface Member {
  mesh: THREE.Mesh;
  instanceId: number;
  /** Original layer mask, restored when the batch is torn down. */
  mask: number;
}

interface Batch {
  key: string;
  mesh: THREE.BatchedMesh;
  members: Member[];
}

const baseOnBeforeRender = THREE.Object3D.prototype.onBeforeRender;

/**
 * Custom ShaderMaterials (e.g. the inverted-hull ink outline) read modelViewMatrix /
 * modelMatrix / normalMatrix directly, so the batching matrix never reaches them. A derived
 * material re-routes those three uniforms through the batch instance matrix (same uniforms
 * object, so thickness / colour changes on the source keep applying).
 */
function batchedShaderMaterial(src: THREE.ShaderMaterial): THREE.ShaderMaterial | null {
  const vs = src.vertexShader;
  const at = vs.indexOf('void main()');
  if (at < 0) return null;
  const open = vs.indexOf('{', at);
  if (open < 0) return null;
  // Helper functions declared before main() would miss the re-routing: refuse those.
  const head = vs.slice(0, at);
  if (/modelViewMatrix|modelMatrix|normalMatrix/.test(head.replace(/uniform[^;]*;/g, ''))) return null;
  const inject = [
    '#include <batching_vertex>',
    '#define modelViewMatrix (modelViewMatrix * batchingMatrix)',
    '#define modelMatrix (modelMatrix * batchingMatrix)',
    '#define normalMatrix (normalMatrix * mat3(batchingMatrix))',
  ].join('\n');
  const d = new THREE.ShaderMaterial();
  THREE.Material.prototype.copy.call(d, src);
  d.defines = { ...src.defines };
  d.uniforms = src.uniforms;
  d.vertexShader = `#include <batching_pars_vertex>\n${vs.slice(0, open + 1)}\n${inject}\n${vs.slice(open + 1)}`;
  d.fragmentShader = src.fragmentShader;
  d.name = `${src.name}#batched`;
  return d;
}

function layoutKey(g: THREE.BufferGeometry): string {
  const parts: string[] = [];
  const names = Object.keys(g.attributes).sort();
  for (const n of names) {
    const a = g.attributes[n] as THREE.BufferAttribute;
    if ((a as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute) return '';
    parts.push(`${n}:${a.itemSize}:${a.array.constructor.name}:${a.normalized ? 1 : 0}`);
  }
  parts.push(g.index ? `i:${g.index.array.constructor.name}` : 'n');
  return parts.join(',');
}

/** Transparent materials that may batch anyway (flat ground decals: blob shadows, glows). */
const transparentOk = new WeakSet<THREE.Material>();
export function allowTransparentBatching(m: THREE.Material): void {
  transparentOk.add(m);
}

function batchable(o: THREE.Object3D): o is THREE.Mesh {
  const m = o as THREE.Mesh & { isInstancedMesh?: boolean; isSkinnedMesh?: boolean; isBatchedMesh?: boolean };
  if (!m.isMesh || m.isInstancedMesh || m.isSkinnedMesh || m.isBatchedMesh) return false;
  if (o.userData.noBatch) return false;
  const mat = m.material;
  if (!mat || Array.isArray(mat)) return false;
  if ((mat.transparent || mat.alphaHash) && !transparentOk.has(mat)) return false;
  if ((mat as THREE.RawShaderMaterial).isRawShaderMaterial) return false;
  if (m.onBeforeRender !== baseOnBeforeRender) return false;
  const g = m.geometry;
  if (!g || !g.attributes.position || g.morphAttributes.position) return false;
  if (g.drawRange.start !== 0 || (g.drawRange.count !== Infinity && g.drawRange.count < (g.index ? g.index.count : g.attributes.position.count))) return false;
  return true;
}

/** Effective visibility (the mesh and every ancestor up to `stop`). */
function shown(o: THREE.Object3D, stop: THREE.Object3D | null): boolean {
  let q: THREE.Object3D | null = o;
  while (q && q !== stop) {
    if (!q.visible) return false;
    q = q.parent;
  }
  return true;
}

export class MeshBatcher {
  /** Add this to the scene (identity transform). Holds the BatchedMeshes. */
  readonly root = new THREE.Group();
  private readonly sources = new Set<THREE.Object3D>();
  private batches: Batch[] = [];
  private signature = '';
  private readonly scratch: THREE.Mesh[] = [];
  private disposed = false;
  private readonly derived = new Map<THREE.Material, THREE.ShaderMaterial | null>();
  /** Number of source meshes currently drawn through batches (stats). */
  batchedMeshes = 0;

  constructor() {
    this.root.name = 'menu3d:batches';
    this.root.matrixAutoUpdate = false;
  }

  /** Mirror every batchable mesh under `source` (call once per rig / prop root). */
  add(source: THREE.Object3D): void {
    this.sources.add(source);
    this.signature = '';
  }

  remove(source: THREE.Object3D): void {
    if (!this.sources.delete(source)) return;
    this.signature = '';
  }

  /**
   * Call after the rigs updated and `scene.updateMatrixWorld()` ran (the renderer would do it
   * again, harmlessly). Rebuilds the batches when the mesh set changed, then copies matrices
   * and visibility.
   */
  sync(): void {
    if (this.disposed) return;
    const list = this.scratch;
    list.length = 0;
    let sig = '';
    for (const s of this.sources) {
      s.traverse((o) => {
        if (batchable(o)) {
          list.push(o);
          sig += `${o.id}.${o.geometry.id}.${(o.material as THREE.Material).uuid};`;
        }
      });
    }
    if (sig !== this.signature) {
      this.signature = sig;
      this.rebuild(list);
    }
    for (const b of this.batches) {
      for (const m of b.members) {
        b.mesh.setMatrixAt(m.instanceId, m.mesh.matrixWorld);
        b.mesh.setVisibleAt(m.instanceId, shown(m.mesh, null));
      }
    }
  }

  private teardown(): void {
    for (const b of this.batches) {
      for (const m of b.members) m.mesh.layers.mask = m.mask;
      b.mesh.removeFromParent();
      b.mesh.dispose();
    }
    this.batches = [];
    this.batchedMeshes = 0;
  }

  private rebuild(list: THREE.Mesh[]): void {
    this.teardown();
    const groups = new Map<string, THREE.Mesh[]>();
    for (const m of list) {
      const lk = layoutKey(m.geometry);
      if (!lk) continue;
      const key = `${(m.material as THREE.Material).uuid}|${lk}|${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = []));
      g.push(m);
    }
    for (const [key, meshes] of groups) {
      if (meshes.length < 2) continue;
      const geos = new Map<THREE.BufferGeometry, number>();
      let verts = 0;
      let idx = 0;
      for (const m of meshes) {
        if (geos.has(m.geometry)) continue;
        geos.set(m.geometry, -1);
        verts += m.geometry.attributes.position.count;
        idx += m.geometry.index ? m.geometry.index.count : 0;
      }
      const srcMat = meshes[0].material as THREE.Material;
      let material: THREE.Material = srcMat;
      if ((srcMat as THREE.ShaderMaterial).isShaderMaterial) {
        let d = this.derived.get(srcMat);
        if (d === undefined) {
          d = batchedShaderMaterial(srcMat as THREE.ShaderMaterial);
          this.derived.set(srcMat, d);
        }
        if (!d) continue;
        material = d;
      }
      let bm: THREE.BatchedMesh;
      try {
        bm = new THREE.BatchedMesh(meshes.length, verts, Math.max(idx, 1), material);
        for (const g of geos.keys()) geos.set(g, bm.addGeometry(g));
      } catch {
        continue; // incompatible layout after all: leave these meshes as they are
      }
      bm.name = `batch:${material.name || material.type}`;
      bm.frustumCulled = false;
      bm.perObjectFrustumCulled = false;
      bm.sortObjects = false;
      bm.castShadow = meshes.some((m) => m.castShadow);
      bm.receiveShadow = meshes.some((m) => m.receiveShadow);
      bm.renderOrder = meshes[0].renderOrder;
      const members: Member[] = [];
      for (const m of meshes) {
        const instanceId = bm.addInstance(geos.get(m.geometry)!);
        members.push({ mesh: m, instanceId, mask: m.layers.mask });
        // Hidden layer only: the rig keeps animating it, the camera no longer draws it.
        m.layers.set(HIDDEN_LAYER);
      }
      this.root.add(bm);
      this.batches.push({ key, mesh: bm, members });
      this.batchedMeshes += meshes.length;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.teardown();
    for (const d of this.derived.values()) d?.dispose();
    this.derived.clear();
    this.sources.clear();
    this.disposed = true;
    this.root.removeFromParent();
  }
}
