/**
 * Recovery zone marker: a painted rectangle (team hazard stripes, corner brackets, big team
 * emblem, '회수 구역' label) + an animated border that
 *   - pulses while something eligible is inside (setActive 0..1), and
 *   - fills clockwise around the perimeter with the 1.5 s recovery dwell (setProgress 0..1).
 * Readable without color: stripes + emblem shape + label + the progress sweep.
 *
 * The marker is placed at the zone's center/angle on creation.
 */
import * as THREE from 'three';
import type { TeamId, ZoneDef } from '../../sim/types';
import { TEAM_STYLES } from '../../shared/teams';
import { createToonMaterial, SHARED_UNIFORMS } from './materials';
import { zoneTexture } from './textures';

export interface ZoneMarkerRig {
  readonly root: THREE.Group;
  readonly team: TeamId;
  setActive(a: number): void;
  setProgress(p: number): void;
  update(dt: number): void;
  dispose(): void;
}

const BAND = 0.32; // progress band width (m)

/** Rectangle frame with a `perim` attribute 0..1 clockwise from the top-center (north). */
function frameGeometry(hx: number, hz: number, inset: number, width: number): THREE.BufferGeometry {
  const ox = hx - inset;
  const oz = hz - inset;
  const ix = ox - width;
  const iz = oz - width;
  // Path (outer corners), clockwise seen from above (+x east, +z south):
  // top-center -> top-right -> bottom-right -> bottom-left -> top-left -> top-center.
  const outer: [number, number][] = [
    [0, -oz],
    [ox, -oz],
    [ox, oz],
    [-ox, oz],
    [-ox, -oz],
    [0, -oz],
  ];
  const inner: [number, number][] = [
    [0, -iz],
    [ix, -iz],
    [ix, iz],
    [-ix, iz],
    [-ix, -iz],
    [0, -iz],
  ];
  // Cumulative length along the band's center line.
  const mid = outer.map(([x, z], i) => [(x + inner[i][0]) / 2, (z + inner[i][1]) / 2] as [number, number]);
  const lens = [0];
  for (let i = 1; i < mid.length; i++) lens.push(lens[i - 1] + Math.hypot(mid[i][0] - mid[i - 1][0], mid[i][1] - mid[i - 1][1]));
  const total = lens[lens.length - 1];
  const pos: number[] = [];
  const perim: number[] = [];
  const across: number[] = [];
  const idx: number[] = [];
  const SUB = 12;
  let v = 0;
  for (let s = 0; s < outer.length - 1; s++) {
    for (let k = 0; k <= SUB; k++) {
      const t = k / SUB;
      const ox2 = outer[s][0] + (outer[s + 1][0] - outer[s][0]) * t;
      const oz2 = outer[s][1] + (outer[s + 1][1] - outer[s][1]) * t;
      const ix2 = inner[s][0] + (inner[s + 1][0] - inner[s][0]) * t;
      const iz2 = inner[s][1] + (inner[s + 1][1] - inner[s][1]) * t;
      const p = (lens[s] + (lens[s + 1] - lens[s]) * t) / total;
      pos.push(ox2, 0, oz2, ix2, 0, iz2);
      perim.push(p, p);
      across.push(1, 0);
      if (k > 0) {
        const a = v - 2;
        idx.push(a, a + 1, v, a + 1, v + 1, v);
      }
      v += 2;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('perim', new THREE.Float32BufferAttribute(perim, 1));
  g.setAttribute('across', new THREE.Float32BufferAttribute(across, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export function createZoneMarker(zone: ZoneDef, label = '회수 구역'): ZoneMarkerRig {
  const team = zone.team;
  const style = TEAM_STYLES[team];
  const sx = zone.half.x * 2;
  const sz = zone.half.y * 2;
  const root = new THREE.Group();
  root.name = `zone${team}`;
  root.position.set(zone.center.x, 0, zone.center.y);
  root.rotation.y = -zone.angle;

  const paintGeo = new THREE.PlaneGeometry(sx, sz).rotateX(-Math.PI / 2);
  const paintMat = createToonMaterial({ map: zoneTexture(team, sx, sz, label), transparent: true, depthWrite: false, rim: 0, polygonOffset: -2 });
  const paint = new THREE.Mesh(paintGeo, paintMat);
  paint.position.y = 0.012;
  paint.receiveShadow = true;
  paint.renderOrder = -2;
  paint.name = 'zone:paint';
  root.add(paint);

  // Inner fill that brightens with progress.
  const fillGeo = new THREE.PlaneGeometry(sx - 1.4, sz - 1.4).rotateX(-Math.PI / 2);
  const fillMat = new THREE.MeshBasicMaterial({ color: style.color, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const fill = new THREE.Mesh(fillGeo, fillMat);
  fill.position.y = 0.016;
  fill.renderOrder = -1;
  root.add(fill);

  const frameGeo = frameGeometry(zone.half.x, zone.half.y, 0.08, BAND);
  const uniforms = {
    uProgress: { value: 0 },
    uActive: { value: 0 },
    uColor: { value: new THREE.Color(style.color) },
    uTime: SHARED_UNIFORMS.uTime,
  };
  const frameMat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    vertexShader: /* glsl */ `
      attribute float perim;
      attribute float across;
      varying float vPerim;
      varying float vAcross;
      void main() {
        vPerim = perim;
        vAcross = across;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uProgress;
      uniform float uActive;
      uniform vec3 uColor;
      uniform float uTime;
      varying float vPerim;
      varying float vAcross;
      void main() {
        float filled = step(vPerim, uProgress) * step(0.001, uProgress);
        // Bright head at the sweep front.
        float head = filled * smoothstep(uProgress - 0.04, uProgress, vPerim);
        float pulse = uActive * (0.35 + 0.25 * sin(uTime * 6.0 - vPerim * 30.0));
        float a = max(filled * 0.95, pulse);
        if (a < 0.01) discard;
        vec3 c = mix(uColor, vec3(1.0), 0.25 + 0.6 * head + 0.25 * (1.0 - filled) );
        float edge = smoothstep(0.0, 0.15, vAcross) * smoothstep(1.0, 0.85, vAcross);
        gl_FragColor = vec4(c, a * mix(0.75, 1.0, edge));
        #include <colorspace_fragment>
      }
    `,
  });
  const frame = new THREE.Mesh(frameGeo, frameMat);
  frame.position.y = 0.02;
  frame.renderOrder = 0;
  frame.name = 'zone:progress';
  root.add(frame);

  let active = 0;
  let progress = 0;
  let shownProgress = 0;

  return {
    root,
    team,
    setActive(a: number) {
      active = THREE.MathUtils.clamp(a, 0, 1);
    },
    setProgress(p: number) {
      progress = THREE.MathUtils.clamp(p, 0, 1);
      if (progress < shownProgress) shownProgress = progress; // resets snap back immediately
    },
    update(dt: number) {
      // Smooth only upward motion so the sweep looks continuous at 60 Hz ticks.
      shownProgress += (progress - shownProgress) * (1 - Math.exp(-dt * 30));
      uniforms.uProgress.value = shownProgress;
      uniforms.uActive.value += (active - uniforms.uActive.value) * (1 - Math.exp(-dt * 10));
      fillMat.opacity = 0.08 * uniforms.uActive.value + 0.22 * shownProgress;
    },
    dispose() {
      paintGeo.dispose();
      paintMat.dispose();
      fillGeo.dispose();
      fillMat.dispose();
      frameGeo.dispose();
      frameMat.dispose();
      root.removeFromParent();
    },
  };
}
