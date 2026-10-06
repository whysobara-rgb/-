import * as T from 'three';
import * as M from '../../render/models';
import { MeshBatcher } from '../batcher';
export function run(noBatch = false): Record<string, unknown> {
  const renderer = new T.WebGLRenderer({ antialias: true });
  renderer.setSize(900, 600);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);
  renderer.domElement.style.cssText = 'position:fixed;inset:0;z-index:999';
  const gl = renderer.getContext();
  const ext = !!gl.getExtension('WEBGL_multi_draw');
  const scene = new T.Scene();
  const L = M.createDuskLighting({ quality: 'low' });
  scene.add(L.group); scene.background = new T.Color('#c9b0d8');
  const ground = new T.Mesh(new T.CircleGeometry(12, 48).rotateX(-Math.PI / 2), M.createToonMaterial({ color: '#E8C9A8' }));
  ground.receiveShadow = true; scene.add(ground);
  const bank = M.createBank(); scene.add(bank.root); bank.root.position.set(0, 0, -3);
  const rigs: M.RaccoonRig[] = [];
  const looks = [{ team: 0 as const, look: { hat: 'teamCapA' as const } }, { team: 0 as const, look: { hat: 'none' as const, furTint: 0.2 } }, { team: 1 as const, look: { hat: 'tongkeunHat' as const, rival: 'tongkeun' as const } }, { team: 1 as const, look: { hat: 'hodadakBand' as const, rival: 'hodadak' as const } }];
  looks.forEach((o, i) => { const r = M.createRaccoon(o); r.root.position.set(-3 + i * 2, 0, 3); r.root.rotation.y = Math.PI / 2; scene.add(r.root); rigs.push(r); });
  const cam = new T.PerspectiveCamera(40, 1.5, 0.1, 200); cam.position.set(0, 9, 15); cam.lookAt(0, 1, 0);
  const frame = (): void => { rigs.forEach((r, i) => r.update(0.016, M.idlePose(1 + i))); bank.update(0.016); scene.updateMatrixWorld(); };
  frame(); renderer.render(scene, cam); const before = renderer.info.render.calls;
  const batcher = new MeshBatcher(); scene.add(batcher.root);
  rigs.forEach((r) => batcher.add(r.root)); batcher.add(bank.root);
  const t0 = performance.now();
  if (noBatch) { batcher.dispose(); renderer.render(scene, cam); return { before }; }
  frame(); batcher.sync(); const syncMs = performance.now() - t0;
  renderer.render(scene, cam);
  const after = renderer.info.render.calls;
  const t1 = performance.now(); for (let i = 0; i < 20; i++) { frame(); batcher.sync(); } const sync20 = (performance.now() - t1) / 20;
  return { ext, before, after, batched: batcher.batchedMeshes, syncMs, sync20 };
}
