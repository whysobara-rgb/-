// 차원의 틈 전투: 렌더링, 플레이어, 무기, 괴생물체, 보스 AI
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ENEMIES, RARITIES, DROP_CHANCE, DROP_RARITY, rollWeapon } from './data.js';
import { buildGun, enemyGeometry } from './models.js';
import { sfx } from './audio.js';

const ARENA = 68;
const SHOT_PITCH = { pistol: 1.25, smg: 1.35, rifle: 1, burst: 1.05, drifle: 0.95, shotgun: 0.62, dshotgun: 0.55, sniper: 0.7, exrifle: 0.85, flak: 0.6, minigun: 1.45, cryo: 1.15 };
const ATK_DUR = 0.46, STRIKE = 0.17, FUSE = 0.5, CAST_DUR = 0.45;
// 갑각 가장자리에 발광색 림라이트 (모든 개체가 같은 셰이더 프로그램 공유)
function rimLight(m, color) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.rimColor = { value: new THREE.Color(color).multiplyScalar(0.35) };
    sh.fragmentShader = sh.fragmentShader
      .replace('uniform vec3 emissive;', 'uniform vec3 emissive;\nuniform vec3 rimColor;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += rimColor * pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 3.2);');
  };
  m.customProgramCacheKey = () => 'enemy-rim';
}
const EMBER_A = new THREE.Color(0xff3dbb).multiplyScalar(0.7), EMBER_B = new THREE.Color(0x8b5cf6).multiplyScalar(0.8);
const HOLE_C = new THREE.Color(0xb026ff);
const SHELL_BRASS = new THREE.Color(0xffb347), SHELL_RED = new THREE.Color(0xff3a2a);
const V = THREE.Vector3;
const tmp = new V(), tmp2 = new V(), tmp3 = new V();
const rand = (a, b) => a + Math.random() * (b - a);
const $ = (id) => document.getElementById(id);

export class Game {
  constructor(canvas, hooks) {
    this.hooks = hooks;
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x120822, 0.0062);
    this.camera = new THREE.PerspectiveCamera(85, 1, 0.03, 1400);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.7, 0.5, 0.7);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.buildWorld();
    this.buildFx();
    this.keys = {};
    this.mouseDown = false; this.aiming = false;
    this.running = false; this.paused = false;
    this.bindInput();
    this.resize();
    addEventListener('resize', () => this.resize());
    this.clock = new THREE.Clock();
    this.dmgPool = [...Array(40)].map(() => { const d = document.createElement('div'); d.className = 'dmgnum'; $('dmglayer').appendChild(d); return { el: d, t: 0, p: new V() }; });
    this.dmgIdx = 0;
    this.minimap = $('minimap').getContext('2d');
    const loop = () => { requestAnimationFrame(loop); this.frame(); };
    loop();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  // ───────────────────────── 월드 ─────────────────────────
  buildWorld() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0x7f6bff, 0x12061c, 0.75));
    const moon = new THREE.DirectionalLight(0xc4b5fd, 1.1); moon.position.set(-30, 60, 20); s.add(moon);
    const rim = new THREE.DirectionalLight(0xff2e88, 0.5); rim.position.set(40, 20, -50); s.add(rim);

    // ─ 바닥: 육각 타일 + 발광 홈 (텍스처 2장) ─
    // 이음새 없이 반복되도록 캔버스 크기를 육각 격자 주기(가로 4칸, 세로 4줄)에 맞춘다
    const hexR = 64, hw = Math.sqrt(3) * hexR, TW = Math.round(hw * 4), TH = Math.round(hexR * 6), TS = TW;
    const c = document.createElement('canvas'); c.width = TW; c.height = TH;
    const g = c.getContext('2d');
    const em = document.createElement('canvas'); em.width = TW; em.height = TH;
    const e = em.getContext('2d');
    g.fillStyle = '#0c0816'; g.fillRect(0, 0, TW, TH); e.fillStyle = '#000'; e.fillRect(0, 0, TW, TH);
    const hexPath = (ctx, cx, cy, r) => { ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } ctx.closePath(); };
    for (let row = -1; row < 6; row++) for (let col = -1; col < 6; col++) {
      const cx = col * hw + (row % 2 ? hw / 2 : 0), cy = row * hexR * 1.5;
      const shade = 14 + Math.random() * 10;
      g.fillStyle = `rgb(${shade + 4},${shade - 2},${shade + 14})`; hexPath(g, cx, cy, hexR - 3); g.fill();
      e.strokeStyle = '#2a1450'; e.lineWidth = 1.5; hexPath(e, cx, cy, hexR - 1.5); e.stroke();
    }
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${90 + Math.random() * 60},${60 + Math.random() * 40},${140 + Math.random() * 60},${Math.random() * 0.06})`; g.fillRect(Math.random() * TW, Math.random() * TH, 2 + Math.random() * 18, 1 + Math.random() * 3); }
    const tex = new THREE.CanvasTexture(c), etex = new THREE.CanvasTexture(em);
    for (const t of [tex, etex]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1200 / 14, 1200 / (14 * TH / TW)); t.anisotropy = 8; }
    tex.colorSpace = THREE.SRGBColorSpace;
    const floorMat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: etex, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.38, metalness: 0.55 });
    // 중심에서 퍼지는 에너지 파동 (바닥 발광에 곱해짐)
    floorMat.onBeforeCompile = (sh) => {
      sh.uniforms.uT = this.worldT = { value: 0 };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWorldP;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uT; varying vec3 vWorldP;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float rr = length(vWorldP.xz);
          float wave = 0.15 * pow(0.5 + 0.5 * sin(rr * 0.08 - uT * 0.6), 4.0);
          float edge = smoothstep(${ARENA - 8}.0, ${ARENA}.0, rr) * (1.0 - smoothstep(${ARENA}.0, ${ARENA + 6}.0, rr));
          float fade = 1.0 - smoothstep(${ARENA + 10}.0, 220.0, rr);
          float near = 1.0 - smoothstep(25.0, 90.0, length(vWorldP.xz - cameraPosition.xz));
          totalEmissiveRadiance *= (0.5 + wave + edge * 1.5) * (0.15 + 0.85 * near) * (0.2 + fade * 0.8);`);
    };
    const floor = new THREE.Mesh(new THREE.CircleGeometry(600, 96), floorMat);
    floor.rotation.x = -Math.PI / 2; s.add(floor);

    // 중앙 문양 + 동심원 링
    const sig = document.createElement('canvas'); sig.width = sig.height = 1024;
    const sg = sig.getContext('2d'); sg.translate(512, 512); sg.strokeStyle = '#ff3dbb'; sg.fillStyle = '#ff3dbb';
    const circle = (r, w) => { sg.lineWidth = w; sg.beginPath(); sg.arc(0, 0, r, 0, Math.PI * 2); sg.stroke(); };
    circle(500, 6); circle(470, 2); circle(330, 4); circle(140, 3);
    for (let i = 0; i < 72; i++) { sg.save(); sg.rotate(i / 72 * Math.PI * 2); sg.fillRect(-2, -500, 4, i % 6 ? 18 : 40); sg.restore(); }
    for (let i = 0; i < 6; i++) { sg.save(); sg.rotate(i / 6 * Math.PI * 2); sg.lineWidth = 3; sg.beginPath(); sg.moveTo(0, -330); sg.lineTo(286, 165); sg.stroke(); sg.beginPath(); sg.arc(0, -400, 26, 0, Math.PI * 2); sg.stroke(); sg.restore(); }
    sg.font = 'bold 34px Orbitron, sans-serif'; sg.textAlign = 'center';
    for (let i = 0; i < 12; i++) { sg.save(); sg.rotate(i / 12 * Math.PI * 2); sg.fillText('ᚱᛁᚠᛏ'.charAt(i % 4) + '◆', 0, -405); sg.restore(); }
    const sigTex = new THREE.CanvasTexture(sig);
    this.sigil = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), new THREE.MeshBasicMaterial({ map: sigTex, color: 0x9a5cc8, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.sigil.rotation.x = -Math.PI / 2; this.sigil.position.y = 0.03; s.add(this.sigil);
    for (const [r, col, o] of [[22, 0x7c3aed, 0.1], [40, 0xff3dbb, 0.06], [56, 0x7c3aed, 0.08]]) {
      const m = new THREE.Mesh(new THREE.RingGeometry(r - 0.12, r + 0.12, 160), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.y = 0.025; s.add(m);
    }

    // 아레나 경계: 바닥 링 + 육각 에너지 장벽
    const ring = new THREE.Mesh(new THREE.TorusGeometry(ARENA + 1, 0.18, 6, 160), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2e88).multiplyScalar(1.6) }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.1; s.add(ring);
    this.barrierMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { t: { value: 0 } },
      vertexShader: 'varying vec2 vU; void main(){ vU=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: `uniform float t; varying vec2 vU;
        float hex(vec2 p){ p.x*=1.1547; p.y+=mod(floor(p.x),2.)*.5; p=abs(fract(p)-.5); return abs(max(p.x*1.5+p.y,p.y*2.)-1.); }
        void main(){ vec2 p=vec2(vU.x*160., vU.y*14.);
          float h=smoothstep(.09,.0,hex(p));
          float scan=pow(.5+.5*sin(vU.y*40.-t*3.),12.);
          float fall=pow(1.-vU.y,2.2);
          float a=(h*.55+scan*.25+.06)*fall;
          gl_FragColor=vec4(mix(vec3(1.,.2,.7),vec3(.55,.25,1.),vU.y)*a,a); }`,
    });
    const barrier = new THREE.Mesh(new THREE.CylinderGeometry(ARENA + 1, ARENA + 1, 22, 160, 1, true), this.barrierMat);
    barrier.position.y = 11; s.add(barrier);

    // 하늘: 다층 성운 + 지평선 광륜 + 반짝이는 별 + 차원 균열
    const sky = new THREE.Mesh(new THREE.SphereGeometry(800, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide, fog: false, depthWrite: false,
      uniforms: { t: { value: 0 } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: `uniform float t; varying vec3 vP;
        float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
        float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
        float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*n(p);p*=2.03;a*=.5;}return v;}
        void main(){
          float y=vP.y; vec2 uv=vec2(atan(vP.z,vP.x)*2.2,y*3.5);
          vec3 c=mix(vec3(.09,.03,.16),vec3(.008,.004,.025),smoothstep(0.,.8,y));
          float n1=fbm(uv*1.2+vec2(t*.008,0.)), n2=fbm(uv*2.4-vec2(0.,t*.01)+n1);
          c+=vec3(.42,.1,.6)*pow(n2,2.2)*1.6*smoothstep(-.05,.5,y);
          c+=vec3(.05,.35,.5)*pow(fbm(uv*1.7+3.+n2),3.)*1.2*smoothstep(.05,.6,y);
          c+=vec3(.9,.15,.45)*pow(n1*n2,3.)*2.;
          c+=vec3(1.,.25,.6)*exp(-abs(y)*14.)*.55 + vec3(.5,.2,1.)*exp(-abs(y)*4.)*.18;
          float crack=abs(vP.x*.9+sin(vP.y*14.+t*.5)*.04+vP.z*.2);
          c+=vec3(1.,.25,.75)*smoothstep(.02,.0,crack)*smoothstep(.2,.55,y)*1.2;
          c+=vec3(.6,.3,1.)*smoothstep(.14,.0,crack)*smoothstep(.2,.55,y)*.22;
          vec2 sp=floor(vP.xz*520.+vP.y*300.);
          float st=step(.9978,h(sp)); float tw=.5+.5*sin(t*3.+h(sp+1.)*40.);
          c+=vec3(.85,.9,1.)*st*tw*smoothstep(.0,.25,y)*1.4;
          gl_FragColor=vec4(c,1.);
        }`,
    }));
    s.add(sky); this.sky = sky;

    // 하늘의 거대 차원 소용돌이
    this.vortexMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { t: { value: 0 } },
      vertexShader: 'varying vec2 vU; void main(){ vU=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: `uniform float t; varying vec2 vU;
        float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
        float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
        void main(){ vec2 p=vU-.5; float r=length(p)*2.; float a=atan(p.y,p.x);
          float sw=n(vec2(a*3.+r*6.-t*.6, r*4.-t*.3))*n(vec2(a*6.-r*9.+t*.4, r*7.));
          float arms=pow(.5+.5*sin(a*4.+r*14.-t*1.2),3.);
          float core=exp(-r*7.)*1.6;
          float m=(sw*1.8+arms*.45)*smoothstep(1.,.25,r)*smoothstep(.0,.12,r)+core;
          vec3 c=mix(vec3(1.,.95,1.),mix(vec3(1.,.2,.65),vec3(.35,.12,.9),r),smoothstep(.0,.35,r));
          gl_FragColor=vec4(c*m,m); }`,
    });
    this.vortex = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), this.vortexMat);
    this.vortex.position.set(-60, 330, -520); this.vortex.lookAt(0, 0, 0); s.add(this.vortex);

    // 고리 행성
    const planet = new THREE.Mesh(new THREE.SphereGeometry(70, 48, 32), new THREE.ShaderMaterial({
      fog: false,
      vertexShader: 'varying vec3 vN; varying vec3 vL; void main(){ vN=normalize(normalMatrix*normal); vL=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: `varying vec3 vN; varying vec3 vL;
        void main(){ float l=max(0.,dot(vN,normalize(vec3(-.6,.4,.7))));
          float band=.5+.5*sin(vL.y*.35+sin(vL.x*.05)*2.);
          vec3 base=mix(vec3(.12,.05,.25),vec3(.5,.2,.55),band);
          float rim=pow(1.-max(0.,vN.z),3.);
          gl_FragColor=vec4(base*(.08+l*1.1)+vec3(1.,.4,.8)*rim*.6,1.); }`,
    }));
    planet.position.set(380, 210, 420); s.add(planet);
    const pring = new THREE.Mesh(new THREE.RingGeometry(95, 150, 96), new THREE.MeshBasicMaterial({ color: 0xc9a3ff, transparent: true, opacity: 0.28, side: THREE.DoubleSide, fog: false, depthWrite: false }));
    pring.position.copy(planet.position); pring.rotation.set(1.2, 0.3, 0.4); s.add(pring);

    // 원경 산맥 (실루엣) + 고대 유적 아치 + 에너지 첨탑
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x1a1128, roughness: 0.9, metalness: 0.1, flatShading: true });
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + rand(-0.05, 0.05), d = rand(260, 380), h = rand(60, 190), r = rand(40, 90);
      const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 5 + (i % 3)), rockMat);
      m.position.set(Math.cos(a) * d, h / 2 - 5, Math.sin(a) * d); m.rotation.y = Math.random() * 3; s.add(m);
    }
    const ruinMat = new THREE.MeshStandardMaterial({ color: 0x241a38, roughness: 0.6, metalness: 0.4, flatShading: true, emissive: 0x2a0b45, emissiveIntensity: 0.4 });
    const veinMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xb026ff).multiplyScalar(1.4) });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + Math.PI / 12, d = rand(115, 150), h = rand(28, 52), w = rand(16, 26);
      const grp = new THREE.Group(); grp.position.set(Math.cos(a) * d, 0, Math.sin(a) * d); grp.lookAt(0, 0, 0);
      const broken = Math.random() < 0.35;
      for (const sx of [-1, 1]) {
        const ph = broken && sx > 0 ? h * rand(0.35, 0.6) : h;
        const col = new THREE.Mesh(new THREE.BoxGeometry(4, ph, 4), ruinMat); col.position.set(sx * w / 2, ph / 2, 0); grp.add(col);
        const v = new THREE.Mesh(new THREE.BoxGeometry(0.4, ph * 0.8, 4.1), veinMat); v.position.set(sx * w / 2, ph * 0.45, 0); grp.add(v);
      }
      if (!broken) {
        const top = new THREE.Mesh(new THREE.BoxGeometry(w + 8, 4, 5), ruinMat); top.position.y = h + 2; grp.add(top);
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(2.4, 0), veinMat); gem.position.y = h + 7; grp.add(gem);
      }
      s.add(grp);
    }
    this.spires = [];
    const spireMat = new THREE.MeshStandardMaterial({ color: 0x150d24, roughness: 0.25, metalness: 0.85, flatShading: true });
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xff3dbb, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8, d = 82, h = 34 + (i % 2) * 14;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 3.2, h, 6), spireMat); sp.position.set(x, h / 2, z); s.add(sp);
      for (let k = 0; k < 3; k++) { const rr = new THREE.Mesh(new THREE.TorusGeometry(3.6 - k * 0.7, 0.12, 6, 32), veinMat); rr.rotation.x = Math.PI / 2; rr.position.set(x, h * (0.3 + k * 0.22), z); s.add(rr); this.spires.push({ m: rr, k, base: rr.position.y }); }
      const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3dbb).multiplyScalar(2) })); orb.position.set(x, h + 3, z); s.add(orb);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.4, 400, 8, 1, true), beamMat); beam.position.set(x, h + 200, z); s.add(beam);
      this.spires.push({ m: orb, orb: true, base: orb.position.y, k: i });
    }
    // 떠다니는 섬 (아래로 크리스탈이 매달림)
    this.islands = [];
    const isleMat = new THREE.MeshStandardMaterial({ color: 0x21173a, roughness: 0.85, flatShading: true });
    const crysMat = new THREE.MeshStandardMaterial({ color: 0x220033, emissive: 0xb026ff, emissiveIntensity: 1.8, flatShading: true });
    for (let i = 0; i < 9; i++) {
      const a = rand(0, Math.PI * 2), d = rand(120, 230), y = rand(45, 110), sc = rand(6, 16);
      const grp = new THREE.Group(); grp.position.set(Math.cos(a) * d, y, Math.sin(a) * d);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(sc, sc * 0.2, sc * 1.6, 7), isleMat); grp.add(top);
      for (let k = 0; k < 4; k++) { const cr = new THREE.Mesh(new THREE.OctahedronGeometry(sc * rand(0.15, 0.3), 0), crysMat); cr.scale.y = 2.5; cr.position.set(rand(-sc, sc) * 0.4, -sc * rand(0.9, 1.4), rand(-sc, sc) * 0.4); grp.add(cr); }
      s.add(grp); this.islands.push({ grp, y, ph: Math.random() * 6 });
    }

    // 기둥 없음: 탁 트인 아레나 (충돌/미니맵 코드는 빈 배열로 그대로 동작)
    this.pillars = [];
    // 소환 포탈
    this.portals = [];
    const portalMat = new THREE.ShaderMaterial({
      transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { t: { value: 0 } },
      vertexShader: 'varying vec2 vU; void main(){ vU=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: `uniform float t; varying vec2 vU;
        void main(){ vec2 p=vU-.5; float r=length(p)*2.; float a=atan(p.y,p.x);
          float sw=sin(a*5.+r*12.-t*4.)*.5+.5;
          float m=smoothstep(1.,.85,r)*(.35+sw*.65);
          vec3 c=mix(vec3(1.,.15,.6),vec3(.45,.1,1.),r);
          gl_FragColor=vec4(c*m*1.6,m); }`,
    });
    this.portalMat = portalMat;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const grp = new THREE.Group();
      grp.position.set(Math.cos(a) * (ARENA - 2), 4, Math.sin(a) * (ARENA - 2));
      grp.lookAt(0, 4, 0);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(4, 40), portalMat); grp.add(disc);
      const tor = new THREE.Mesh(new THREE.TorusGeometry(4.1, 0.18, 8, 48), new THREE.MeshBasicMaterial({ color: 0xff3dbb })); grp.add(tor);
      s.add(grp); this.portals.push({ a, grp, disc });
    }
    // 부유 파편
    const debrisGeo = new THREE.TetrahedronGeometry(1, 0);
    this.debris = new THREE.InstancedMesh(debrisGeo, new THREE.MeshStandardMaterial({ color: 0x2a1b45, emissive: 0x3b0f6b, emissiveIntensity: 0.6, flatShading: true }), 90);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    this.debrisData = [];
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2, d = rand(80, 200);
      const dd = { p: new V(Math.cos(a) * d, rand(10, 70), Math.sin(a) * d), s: rand(1, 6), r: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0), sp: rand(0.05, 0.3) };
      this.debrisData.push(dd);
      m4.compose(dd.p, q.setFromEuler(dd.r), new V(dd.s, dd.s, dd.s)); this.debris.setMatrixAt(i, m4);
    }
    s.add(this.debris);

    // 환경 반사맵: 금속 총기·갑각에 보랏빛/네온 반사를 입힌다
    const pm = new THREE.PMREMGenerator(this.renderer), es = new THREE.Scene();
    es.add(new THREE.Mesh(new THREE.SphereGeometry(10, 24, 12), new THREE.MeshBasicMaterial({ color: 0x170b2b, side: THREE.BackSide })));
    for (const [c, x, y, z, w, h] of [[0xff3dbb, 6, 4, -5, 3, 1.5], [0x5ee7ff, -7, 2, 3, 3, 2], [0xffffff, 0, 9, 0, 6, 6], [0x8b5cf6, 3, -2, 7, 4, 1.5]]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(c === 0xffffff ? 0.9 : 1.1), side: THREE.DoubleSide }));
      p.position.set(x, y, z); p.lookAt(0, 0, 0); es.add(p);
    }
    s.environment = pm.fromScene(es, 0.02).texture; s.environmentIntensity = 0.9;

    // 재사용 포인트 라이트 (개수 고정 → 셰이더 재컴파일 없음)
    this.lights = [...Array(4)].map(() => { const l = new THREE.PointLight(0xff8833, 0, 18, 1.6); s.add(l); return { l, t: 0, max: 0 }; });
    this.lightIdx = 0;
    this.muzzleLight = new THREE.PointLight(0xffcc66, 0, 8, 2); this.camera.add(this.muzzleLight); this.muzzleLight.position.set(0.2, -0.1, -0.8);
  }

  buildFx() {
    // 파티클 (GPU 포인트, CPU 업데이트)
    const N = 4000;
    this.pN = N; this.pI = 0;
    this.pPos = new Float32Array(N * 3); this.pCol = new Float32Array(N * 3); this.pSize = new Float32Array(N);
    this.pVel = new Float32Array(N * 3); this.pLife = new Float32Array(N); this.pMax = new Float32Array(N); this.pGrav = new Float32Array(N);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1));
    this.pGeo = geo;
    const pts = new THREE.Points(geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
      vertexShader: 'attribute float size; varying vec3 vC; void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=min(48.,size*110./-mv.z); gl_Position=projectionMatrix*mv; }',
      fragmentShader: 'varying vec3 vC; void main(){ float d=length(gl_PointCoord-.5); if(d>.5) discard; gl_FragColor=vec4(vC*(1.-d*2.)*1.1,1.); }',
    }));
    pts.frustumCulled = false; this.scene.add(pts);
    this.tracers = []; this.flashes = []; this.lines = []; this.rings = [];
    this.tracerGeo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.5);
    this.flashGeo = new THREE.IcosahedronGeometry(1, 2);
    this.ringGeo = new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2);
    this.muzzleSprite = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.35), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, map: this.flareTex() }));
    this.muzzleSprite.visible = false;
    this.beam = new THREE.Mesh(this.tracerGeo, new THREE.MeshBasicMaterial({ color: 0xff3366 })); this.beam.visible = false; this.scene.add(this.beam);
  }

  flareTex() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, '#fff'); gr.addColorStop(0.3, 'rgba(255,200,120,.8)'); gr.addColorStop(1, 'rgba(255,120,40,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    g.strokeStyle = 'rgba(255,240,200,.9)'; g.lineWidth = 3;
    for (let i = 0; i < 4; i++) { g.beginPath(); const a = i * Math.PI / 4 + 0.3; g.moveTo(32, 32); g.lineTo(32 + Math.cos(a) * 32, 32 + Math.sin(a) * 32); g.stroke(); }
    return new THREE.CanvasTexture(c);
  }

  // ───────────────────────── 입력 ─────────────────────────
  bindInput() {
    addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (!this.running || this.paused) return;
      if (e.code.startsWith('Digit')) { const n = +e.code.slice(5) - 1; if (n >= 0 && n < 4) this.switchWeapon(n); }
      if (e.code === 'KeyR') this.startReload();
      if (e.code === 'Space' && !e.repeat) this.jump();
      if (e.code === 'KeyQ') this.skill('dash');
      if (e.code === 'KeyE') this.skill('shock');
      if (e.code === 'KeyF') this.skill('over');
      if (e.code === 'KeyG') this.skill('nade');
      if (e.code === 'KeyV') this.skill('slash');
      if (e.code === 'KeyX') this.weaponSkill();
      if (e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.running) return;
      if (document.pointerLockElement !== this.canvas) { this.canvas.requestPointerLock(); return; }
      if (e.button === 0) { this.mouseDown = true; this.triggerPulled = true; }
      if (e.button === 2) this.aiming = true;
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseDown = false; if (e.button === 2) this.aiming = false; });
    addEventListener('contextmenu', (e) => { if (this.running) e.preventDefault(); });
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.canvas || !this.running || this.paused) return;
      if (Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return; // 포인터락 직후 튀는 값 무시
      const s = 0.0022 * this.sens * (this.aiming ? 0.6 : 1);
      this.yaw -= e.movementX * s; this.pitch -= e.movementY * s;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
      this.swayX += e.movementX * 0.0004; this.swayY += e.movementY * 0.0004;
    });
    addEventListener('wheel', (e) => { if (this.running && !this.paused) this.switchWeapon((this.cur + (e.deltaY > 0 ? 1 : -1) + this.slots.length) % this.slots.length); });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== this.canvas && this.running && !this.paused) this.pause();
    });
  }

  pause() { this.paused = true; this.mouseDown = false; this.hooks.onPause(); }
  resume() { this.paused = false; this.canvas.requestPointerLock(); this.clock.getDelta(); }

  // ───────────────────────── 런 시작 ─────────────────────────
  start({ weapons, armor, clears, settings }) {
    this.cleanup();
    this.sens = settings.sens; this.camera.fov = settings.fov; this.baseFov = settings.fov;
    this.clears = clears;
    this.diff = { hp: 1 + clears * 0.22, dmg: 1 + clears * 0.1, coin: 1 + clears * 0.12 };
    this.total = Math.floor(rand(300, 5001));
    this.spawned = 0; this.kills = 0; this.coinsEarned = 0; this.loot = [];
    this.midSpawned = 0; this.bossSpawned = false; this.bossDead = false;
    // 균열 붕괴 시간: 300마리 ≈ 1분 40초, 5000마리 ≈ 4분. 시간이 다 되면 남은 개체는 소멸하고 보스가 즉시 강림
    this.stageTime = 90 + this.total * 0.03; this.collapsed = false;
    this.spawnRate = Math.min(45, Math.max(6, this.total / (this.stageTime * 0.75)));
    this.maxAlive = Math.min(240, 90 + this.total / 25);
    this.spawnAcc = 0; this.time = 0; this.combo = 0; this.comboT = 0;
    this.player = { pos: new V(0, 0, 0), vel: new V(), onGround: true, hp: 100, maxHp: 100, armor: armor.armor, maxArmor: armor.armor, dr: armor.dr, hurtT: 9, dashT: 0, dashDir: new V(), overT: 0 };
    this.yaw = 0; this.pitch = 0; this.swayX = 0; this.swayY = 0; this.shake = 0; this.recoil = 0; this.kick = 0;
    this.recoilV = 0; this.kickV = 0; this.roll = 0; this.fovPunch = 0; this.chKick = 0; this.stopT = 0; this.lastStop = 0; this.swingT = 0; this.swingDir = 1;
    this.cds = { dash: 0, shock: 0, over: 0, nade: 0, slash: 0 };
    this.cdMax = { dash: 2.2, shock: 9, over: 32, nade: 5, slash: 0.7 };
    this.slots = weapons.map((def) => ({ def, ammo: def.mag, reloadT: 0, cd: 0, burst: 0, spinT: 0, skillCd: 0 }));
    this.timers = []; this.stormT = 0; if (this.hole) { this.scene.remove(this.hole.m); this.scene.remove(this.hole.ring); this.hole = null; }
    this.cur = 0;
    this.enemies = []; this.projs = []; this.eprojs = []; this.pickups = []; this.dying = [];
    this.boss = null;
    this.equipView();
    this.running = true; this.paused = false;
    this.hooks.onStart(this.total);
    this.toast(`차원의 틈 개방 — 적 개체 ${this.total.toLocaleString()} 감지`, '#ff3dbb');
    this.clock.getDelta();
    this.canvas.requestPointerLock();
    this.updateHud(true);
  }

  cleanup() {
    for (const e of this.enemies || []) this.scene.remove(e.mesh);
    for (const p of this.projs || []) this.scene.remove(p.mesh);
    for (const p of this.eprojs || []) this.scene.remove(p.mesh);
    for (const p of this.pickups || []) this.scene.remove(p.mesh);
    for (const d of this.dying || []) { this.scene.remove(d.e.mesh); d.e.bodyMat.dispose(); }
    for (const t of this.tracers) this.scene.remove(t.m);
    for (const f of this.flashes) this.scene.remove(f.m);
    for (const l of this.lines) this.scene.remove(l.m);
    for (const r of this.rings) this.scene.remove(r.m);
    this.tracers = []; this.flashes = []; this.lines = []; this.rings = [];
    this.pLife.fill(0);
    if (this.view) this.camera.remove(this.view);
  }

  end(result) {
    this.running = false; this.mouseDown = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.beam.visible = false;
    this.hooks.onEnd({ result, kills: this.kills, total: this.total, coins: this.coinsEarned, loot: this.loot, time: this.time });
  }

  // ───────────────────────── 무기 ─────────────────────────
  equipView() {
    if (this.view) this.camera.remove(this.view);
    const def = this.slots[this.cur].def;
    this.view = new THREE.Group();
    const gun = buildGun(def); this.gun = gun;
    this.view.add(gun);
    gun.add(this.muzzleSprite);
    this.view.position.set(0.24, -0.22, -0.38); this.view.scale.setScalar(0.85);
    this.camera.add(this.view);
    this.switchT = 0.25;
    this.beam.material.color.set(RARITIES[def.rarity].color);
  }

  switchWeapon(i) {
    if (i === this.cur || !this.slots[i]) return;
    this.cur = i; this.slots[i].burst = 0; this.equipView(); sfx('click');
  }

  startReload() {
    const s = this.slots[this.cur];
    if (s.reloadT > 0 || s.ammo >= s.def.mag) return;
    s.reloadT = s.def.reload; sfx('reload');
  }

  muzzleWorld(i = 0) {
    const ms = this.gun.userData.muzzles;
    const m = ms[i % ms.length];
    return m.getWorldPosition(new V());
  }

  aimDir(spread) {
    const d = new V(0, 0, -1).applyQuaternion(this.camera.quaternion);
    if (spread > 0) {
      const r = new V(1, 0, 0).applyQuaternion(this.camera.quaternion), u = new V(0, 1, 0).applyQuaternion(this.camera.quaternion);
      const a = Math.random() * Math.PI * 2, m = Math.sqrt(Math.random()) * spread;
      d.addScaledVector(r, Math.cos(a) * m).addScaledVector(u, Math.sin(a) * m).normalize();
    }
    return d;
  }

  updateWeapon(dt) {
    const s = this.slots[this.cur], def = s.def, P = this.player;
    const over = P.overT > 0;
    const storm = this.stormT > 0 && def.mode !== 'melee';
    s.cd -= dt * (over ? 1.6 : 1) * (storm ? 2.5 : 1);
    if (this.switchT > 0) { this.switchT -= dt; return; }
    if (s.reloadT > 0) {
      s.reloadT -= dt;
      if (s.reloadT <= 0) s.ammo = def.mag;
      return;
    }
    if (def.gatling) s.spinT = Math.max(0, Math.min(1, s.spinT + (this.mouseDown ? dt * 2.5 : -dt * 1.5)));
    const wantFire = s.burst > 0 || (def.auto ? this.mouseDown : this.triggerPulled);
    this.triggerPulled = false;
    if (def.mode === 'melee') { if (wantFire && s.cd <= 0) { this.melee(s); s.cd = 1 / def.rate; } return; }
    if (!wantFire || s.cd > 0) return;
    if (def.gatling && s.spinT < 0.35) return;
    if (s.ammo <= 0) { sfx('empty'); this.startReload(); return; }
    if (def.burst && s.burst <= 0) s.burst = def.burst;
    this.fire(s);
    if (!over && !storm) s.ammo--;
    if (def.burst) { s.burst--; s.cd = s.burst > 0 ? 0.055 : 1 / def.rate; }
    else s.cd = 1 / def.rate;
    if (s.ammo <= 0 && !over && !storm) this.startReload();
  }

  fire(s) {
    const def = s.def, P = this.player;
    const mul = (P.overT > 0 ? 1.5 : 1);
    const moving = Math.hypot(P.vel.x, P.vel.z) > 3;
    const spread = def.spread * (moving ? 1.5 : 1) * (this.aiming ? 0.45 : 1) * (P.onGround ? 1 : 1.6);
    const col = RARITIES[def.rarity].color;
    const heavy = def.mode === 'proj' || def.pellets > 1 || def.rail ? 1 : def.dmg > 60 ? 0.6 : 0;
    for (let b = 0; b < def.barrels; b++) {
      const origin = this.camera.position.clone();
      const muzzle = this.muzzleWorld(b);
      if (def.mode === 'proj') {
        const dir = this.aimDir(spread);
        this.spawnProj(muzzle, dir, def, mul, col);
      } else if (def.mode === 'chain') {
        this.fireChain(origin, this.aimDir(spread), muzzle, def, mul, col);
      } else {
        for (let p = 0; p < def.pellets; p++) this.fireHitscan(origin, this.aimDir(spread), muzzle, def, mul, col);
      }
    }
    // 반동/연출: 스프링 반동(되튐) + 조준점 상승 + 좌우 흔들림 + FOV 펀치 + 탄피 배출
    const kick = Math.min(0.09, 0.012 + def.dmg * def.pellets * 0.00025 + (def.mode === 'proj' ? 0.05 : 0));
    const aimK = this.aiming ? 0.55 : 1;
    this.kickV += kick * 22;
    this.recoilV += kick * 12 * aimK;
    this.pitch = Math.min(1.5, this.pitch + kick * 0.12 * aimK);
    this.yaw += rand(-1, 1) * kick * 0.09 * aimK;
    this.roll = rand(-1, 1) * kick * 2.2;
    this.fovPunch = Math.min(6, this.fovPunch + heavy * 2.5 + kick * 10);
    this.chKick = Math.min(0.06, this.chKick + kick * 0.25);
    if (heavy >= 1) this.shake = Math.max(this.shake, 0.12);
    if (def.mode === 'hitscan' && !def.rail) this.ejectShell(def.pellets > 1);
    this.muzzleSprite.position.copy(this.gun.userData.muzzles[0].position);
    this.muzzleSprite.visible = def.mode !== 'beam'; this.muzzleSprite.rotation.z = Math.random() * 6;
    this.muzzleSprite.scale.setScalar(def.pellets > 1 || def.mode === 'proj' ? 1.6 : 1);
    this.muzzleT = 0.045;
    this.boltT = 1;
    if (this.gun.userData.pump) this.pumpT = 0.6;
    if (this.gun.userData.drum) this.drumTarget = (this.drumTarget || 0) + Math.PI / 3;
    this.muzzleLight.intensity = def.mode === 'beam' ? 1 : 6; this.muzzleLight.color.set(def.mode === 'beam' ? col : 0xffbb66);
    if (def.mode === 'beam') sfx('laser');
    else if (def.mode === 'chain') sfx('tesla');
    else if (def.rail) sfx('rail');
    else if (def.mode === 'proj') sfx('launch');
    else sfx('shot', { heavy, pitch: SHOT_PITCH[def.type] || 1 });
  }

  ejectShell(shotgun) {
    const q = this.camera.quaternion;
    const r = tmp.set(1, 0, 0).applyQuaternion(q), u = tmp2.set(0, 1, 0).applyQuaternion(q), f = new V(0, 0, -1).applyQuaternion(q);
    const pos = this.camera.position.clone().addScaledVector(r, 0.2).addScaledVector(u, -0.12).addScaledVector(f, 0.45);
    const vel = r.clone().multiplyScalar(rand(2.5, 4)).addScaledVector(u, rand(2, 3.2)).addScaledVector(f, rand(-0.5, 0.5));
    this.particle(pos, vel, shotgun ? SHELL_RED : SHELL_BRASS, shotgun ? 0.09 : 0.06, 0.9, 14);
  }

  hitStop(t) {
    // 짧은 시간 정지: 타격감을 위한 프레임 경직 (자주 걸리지 않도록 간격 제한)
    const now = performance.now();
    if (t < 0.1 && now - this.lastStop < 220) return;
    this.lastStop = now; this.stopT = Math.max(this.stopT, t);
  }

  melee(s) {
    const def = s.def, P = this.player, mul = P.overT > 0 ? 1.5 : 1;
    const col = RARITIES[def.rarity].color, c = new THREE.Color(col);
    const f = this.aimDir(0), o = this.camera.position;
    const fh = new V(f.x, 0, f.z).normalize(), right = new V(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.swingDir = -this.swingDir; this.swingT = 1;
    const hits = [];
    for (const e of this.enemies) {
      if (e.dead) continue;
      tmp.copy(e.mesh.position).setY(e.mesh.position.y + e.cy).sub(o);
      const d = tmp.length();
      if (d > def.range + e.r) continue;
      if (d > e.r + 0.6 && tmp.normalize().dot(f) < def.arc) continue;
      hits.push({ e, d });
    }
    hits.sort((a, b) => a.d - b.d);
    // 베기 궤적
    const thrust = def.mshape === 'spear' || def.mshape === 'fist';
    const half = Math.min(1.5, Math.acos(Math.max(-1, Math.min(1, def.arc))));
    for (let i = 0; i <= 20; i++) {
      const k = i / 20;
      if (thrust) {
        const p = o.clone().addScaledVector(f, 0.8 + k * def.range).add(tmp.set(rand(-0.1, 0.1), rand(-0.1, 0.1) - 0.2, 0));
        this.particle(p, tmp2.copy(f).multiplyScalar(6), c, 0.3, 0.18, 0);
      } else {
        const a = (k * 2 - 1) * half * this.swingDir;
        const dir = fh.clone().multiplyScalar(Math.cos(a)).addScaledVector(right, Math.sin(a));
        const p = o.clone().addScaledVector(dir, def.range * 0.7); p.y += -0.35 + k * 0.5;
        this.particle(p, dir.multiplyScalar(2), c, 0.45, 0.2, 0);
      }
    }
    hits.length = Math.min(hits.length, def.cleave || 1);
    let killed = 0;
    for (const h of hits) {
      const p = h.e.mesh.position.clone(); p.y += h.e.cy;
      tmp3.copy(h.e.mesh.position).sub(P.pos).setY(0).normalize();
      h.e.kb.addScaledVector(tmp3, h.e.def.boss ? def.kb * 0.12 : def.kb);
      this.burst(p, 14, col, 8, 0.35, 0.3);
      this.damage(h.e, def.dmg * mul * (h.e.def.boss ? 0.5 : 1), p, 0); // 보스는 근접 피해 50% 경감
      if (h.e.dead) killed++;
      if (def.mshape === 'fist') { this.explode(p, def.aoe, def.dmg * mul * 0.3, col, false); this.burst(p, 30, '#ffb347', 10, 0.35, 0.4); }
    }
    if (def.mshape === 'hammer') {
      const gp = o.clone().addScaledVector(fh, 3); gp.y = 0.2;
      this.explode(gp, def.aoe, def.dmg * mul * 0.35, col, false); this.shockRing(gp, def.aoe, col, 0.35);
      this.burst(gp, 40, col, 9, 0.4, 0.5); this.burst(gp, 16, '#8a7a99', 3, 0.8, 0.8, -1);
      this.shake = Math.max(this.shake, 0.35); sfx('boom', { s: 0.8 });
    }
    if (def.wave) this.spawnProj(o.clone().addScaledVector(f, 1).add(tmp.set(0, -0.2, 0)), f.clone(), { type: 'plasma', dmg: def.dmg * 0.35, aoe: 1.4, pierce: 3, speed: 42, grav: 0 }, mul, col);
    if (killed) P.hp = Math.min(P.maxHp, P.hp + def.leech * killed); // 흡혈은 처치 시에만
    const heavy = def.rate < 1.5 ? 1 : 0;
    this.kickV -= 0.4; this.roll = this.swingDir * 0.05;
    if (hits.length) {
      this.hitStop(Math.min(0.11, 0.035 + hits.length * 0.008 + (heavy ? 0.03 : 0)));
      this.shake = Math.max(this.shake, 0.12 + heavy * 0.2);
      this.fovPunch = Math.min(6, this.fovPunch + 1.5 + heavy * 2.5);
      sfx('meleeHit', { heavy });
    }
    sfx('swing', { heavy, pitch: def.mshape === 'chain' ? 1.6 : 1 });
  }

  rayEnemies(o, d, maxD) {
    const hits = [];
    for (const e of this.enemies) {
      if (e.dead) continue;
      const cx = e.mesh.position.x - o.x, cy = e.mesh.position.y + e.cy - o.y, cz = e.mesh.position.z - o.z;
      const b = cx * d.x + cy * d.y + cz * d.z;
      if (b < -e.r) continue;
      const c = cx * cx + cy * cy + cz * cz - e.r * e.r;
      const disc = b * b - c;
      if (disc < 0) continue;
      let t = b - Math.sqrt(disc); if (t < 0) t = b + Math.sqrt(disc);
      if (t < 0 || t > maxD) continue;
      hits.push({ e, t });
    }
    hits.sort((a, b) => a.t - b.t);
    return hits;
  }

  blockDist(o, d, maxD = 250) {
    let best = maxD;
    if (d.y < -1e-4) best = Math.min(best, o.y / -d.y);
    for (const p of this.pillars) {
      const ox = o.x - p.x, oz = o.z - p.z;
      const a = d.x * d.x + d.z * d.z; if (a < 1e-6) continue;
      const b = ox * d.x + oz * d.z, c = ox * ox + oz * oz - p.r * p.r * 0.75;
      const disc = b * b - a * c; if (disc < 0) continue;
      const t = (-b - Math.sqrt(disc)) / a;
      if (t > 0 && t < best && o.y + d.y * t < p.h) best = t;
    }
    return best;
  }

  fireHitscan(o, d, muzzle, def, mul, col) {
    const block = this.blockDist(o, d);
    const hits = this.rayEnemies(o, d, block);
    const pierce = def.pierce + (this.stormT > 0 ? 2 : 0);
    const n = Math.min(hits.length, 1 + pierce);
    let end = block;
    for (let i = 0; i < n; i++) {
      const h = hits[i]; const pt = o.clone().addScaledVector(d, h.t);
      this.damage(h.e, def.dmg * mul * (i === 0 ? 1 : 0.85), pt, def.slow);
      if (def.aoe && (i === 0 || def.pierce)) this.explode(pt, def.aoe, def.dmg * mul * 0.7, col, false);
      end = h.t;
    }
    if (n > 0 && !(pierce > 0 && n < 1 + pierce)) end = hits[n - 1].t;
    const pt = o.clone().addScaledVector(d, Math.min(end, 250));
    if (n === 0 && end < 250) {
      this.burst(pt, 6, col, 4, 0.25, 0.12);
      if (def.aoe) this.explode(pt, def.aoe, def.dmg * mul * 0.7, col, false);
    }
    if (def.mode === 'beam') { this.beamFrom = muzzle; this.beamTo = pt; this.beamT = 0.06; }
    else this.tracer(muzzle, pt, col, def.rail ? 0.05 : def.pellets > 1 ? 0.012 : 0.02, def.rail ? 0.25 : 0.06);
  }

  fireChain(o, d, muzzle, def, mul, col) {
    const block = this.blockDist(o, d);
    const hits = this.rayEnemies(o, d, block);
    let from = muzzle, cur = hits.length ? hits[0].e : null, dmg = def.dmg * mul;
    if (!cur) { this.bolt(muzzle, o.clone().addScaledVector(d, Math.min(block, 40)), col); return; }
    const hitSet = new Set();
    for (let k = 0; k <= def.chain && cur; k++) {
      hitSet.add(cur);
      const p = cur.mesh.position.clone(); p.y += cur.cy;
      this.bolt(from, p, col); this.damage(cur, dmg, p, 0);
      from = p; dmg *= 0.85;
      let best = null, bd = 9 * 9;
      for (const e of this.enemies) {
        if (e.dead || hitSet.has(e)) continue;
        const dd = e.mesh.position.distanceToSquared(p); if (dd < bd) { bd = dd; best = e; }
      }
      cur = best;
    }
  }

  spawnProj(pos, dir, def, mul, col) {
    const m = new THREE.Mesh(def.type === 'plasma' ? new THREE.SphereGeometry(0.22, 10, 8) : new THREE.CapsuleGeometry(0.08, 0.3, 4, 8),
      new THREE.MeshBasicMaterial({ color: def.type === 'plasma' ? col : 0xffaa55 }));
    m.position.copy(pos); this.scene.add(m);
    const vel = dir.clone().multiplyScalar(def.speed);
    if (def.grav) vel.y += def.speed * 0.18;
    this.projs.push({ m, mesh: m, vel, def, mul, col, life: def.bounce ? 1.4 : 4, pierce: def.pierce || 0, hit: new Set() });
  }

  updateProjs(dt) {
    for (let i = this.projs.length - 1; i >= 0; i--) {
      const p = this.projs[i], pos = p.mesh.position;
      p.life -= dt;
      p.vel.y -= p.def.grav * dt;
      const steps = Math.ceil(p.vel.length() * dt / 0.8);
      let dead = p.life <= 0;
      for (let s = 0; s < steps && !dead; s++) {
        pos.addScaledVector(p.vel, dt / steps);
        if (pos.y < 0.15) {
          if (p.def.bounce && p.vel.y < -2) { pos.y = 0.15; p.vel.y *= -0.45; p.vel.x *= 0.7; p.vel.z *= 0.7; }
          else if (p.def.bounce) { pos.y = 0.15; p.vel.y = 0; p.vel.x *= 0.9; p.vel.z *= 0.9; }
          else dead = true;
        }
        for (const pl of this.pillars) {
          const dx = pos.x - pl.x, dz = pos.z - pl.z;
          if (dx * dx + dz * dz < pl.r * pl.r * 0.75 && pos.y < pl.h) {
            if (p.def.bounce) { const l = Math.hypot(dx, dz); p.vel.x = dx / l * 6; p.vel.z = dz / l * 6; } else dead = true;
          }
        }
        for (const e of this.enemies) {
          if (e.dead || p.hit.has(e)) continue;
          const ex = e.mesh.position.x - pos.x, ey = e.mesh.position.y + e.cy - pos.y, ez = e.mesh.position.z - pos.z;
          if (ex * ex + ey * ey + ez * ez < (e.r + 0.3) ** 2) {
            if (p.def.type === 'plasma') {
              p.hit.add(e); this.damage(e, p.def.dmg * p.mul, pos.clone(), 0);
              this.explode(pos.clone(), p.def.aoe, p.def.dmg * p.mul * 0.5, p.col, false);
              if (--p.pierce < 0) dead = true;
            } else dead = true;
            break;
          }
        }
      }
      if (p.def.type !== 'plasma') this.burst(pos, 1, '#ffaa66', 1, 0.3, 0.18, -2);
      p.mesh.lookAt(tmp.copy(pos).add(p.vel));
      p.mesh.rotateX(Math.PI / 2);
      if (dead) {
        if (p.def.type !== 'plasma') this.explode(pos.clone(), p.def.aoe, p.def.dmg * p.mul, p.col, true);
        this.scene.remove(p.mesh); p.mesh.geometry.dispose(); this.projs.splice(i, 1);
      }
    }
  }

  // ───────────────────────── 무기 스킬 (전설 이상, X키) ─────────────────────────
  after(t, fn) { this.timers.push({ t, fn }); }
  updateTimers(dt) {
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i]; tm.t -= dt;
      if (tm.t <= 0) { this.timers.splice(i, 1); if (this.running) tm.fn(); }
    }
    const h = this.hole;
    if (h) {
      h.t -= dt; h.m.rotation.y += dt * 4; h.ring.rotation.z += dt * 6;
      const k = 1 - h.t / h.max; h.m.scale.setScalar(1 + k * 1.5);
      for (const e of this.enemies) {
        if (e.dead || e.def.boss) continue;
        tmp.copy(h.pos).sub(e.mesh.position); tmp.y = 0; const d = tmp.length();
        if (d < 15 && d > 0.6) e.mesh.position.addScaledVector(tmp.normalize(), Math.min(d, (22 - d) * dt));
      }
      if (Math.random() < 0.7) { tmp2.set(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize().multiplyScalar(10); this.particle(tmp.copy(h.pos).add(tmp2), tmp2.multiplyScalar(-1.6), HOLE_C, 0.35, 0.5, 0); }
      if (h.t <= 0) {
        this.explode(h.pos, 10, h.dmg, h.col, true); this.shockRing(h.pos, 12, h.col, 0.6); this.hitStop(0.08);
        this.scene.remove(h.m); this.scene.remove(h.ring); this.hole = null;
      }
    }
  }

  aimPoint(maxD = 140) {
    const o = this.camera.position, d = this.aimDir(0);
    const block = this.blockDist(o, d, maxD), hits = this.rayEnemies(o, d, block);
    const t = hits.length ? hits[0].t : block;
    const p = o.clone().addScaledVector(d, Math.min(t, maxD)); p.y = 0.1;
    return p;
  }

  weaponSkill() {
    const s = this.slots[this.cur], def = s.def, sk = def.skill;
    if (!sk) { this.toast('전설 등급 이상 무기만 스킬이 있습니다', '#a79bc9'); return; }
    if (s.skillCd > 0) return;
    s.skillCd = sk.cd;
    const col = RARITIES[def.rarity].color, pw = sk.power * (this.player.overT > 0 ? 1.3 : 1);
    const base = def.dps * pw, o = this.camera.position.clone();
    this.toast(`${sk.icon} ${sk.name}!`, col); sfx('overdrive'); this.hooks.onFlash(col + '33');
    switch (sk.id) {
      case 'storm': this.stormT = 5; break;
      case 'rail': {
        const d = this.aimDir(0), end = o.clone().addScaledVector(d, 250);
        for (const e of this.enemies) {
          if (e.dead) continue;
          tmp.copy(e.mesh.position).setY(e.mesh.position.y + e.cy).sub(o);
          const along = tmp.dot(d); if (along < 0) continue;
          if (tmp.addScaledVector(d, -along).length() < e.r + 1.6) this.damage(e, base * 3, null, 0, true);
        }
        this.tracer(this.muzzleWorld(0), end, col, 0.55, 0.6); this.tracer(this.muzzleWorld(0), end, '#ffffff', 0.18, 0.5);
        for (let i = 0; i < 40; i++) this.burst(o.clone().addScaledVector(d, i * 6), 3, col, 3, 0.4, 0.5, 0);
        this.shake = 0.7; this.kickV += 1.2; sfx('rail'); this.hitStop(0.06);
        break;
      }
      case 'orbital': {
        const c = this.aimPoint();
        this.telegraph(c, 8, 1.4);
        for (let i = 0; i < 3; i++) this.after(0.55 + i * 0.3, () => {
          const p = c.clone().add(tmp.set(rand(-3, 3), 0, rand(-3, 3)));
          this.tracer(p.clone().setY(140), p, '#ffe6a8', 1.6, 0.35); this.tracer(p.clone().setY(140), p, col, 3.5, 0.25);
          this.explode(p.setY(0.5), 8, base * 2, col, true);
        });
        break;
      }
      case 'thunder': {
        const P = this.player.pos;
        const targets = this.enemies.filter((e) => !e.dead && e.mesh.position.distanceTo(P) < 30)
          .sort((a, b) => a.mesh.position.distanceToSquared(P) - b.mesh.position.distanceToSquared(P)).slice(0, 12);
        targets.forEach((e, i) => this.after(i * 0.06, () => {
          if (e.dead) return;
          const p = e.mesh.position.clone(); p.y += e.cy;
          this.bolt(p.clone().add(tmp.set(rand(-4, 4), 45, rand(-4, 4))), p, col);
          this.damage(e, base * 1.4, p, 0); this.flashLight(p, 0xbfe9ff, 25, 0.12); sfx('tesla');
        }));
        break;
      }
      case 'blackhole': {
        const p = this.aimPoint(60); p.y = 2.5;
        const m = new THREE.Mesh(new THREE.SphereGeometry(1.4, 24, 16), new THREE.MeshBasicMaterial({ color: 0x000000 }));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.18, 8, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(2) }));
        m.position.copy(p); ring.position.copy(p); ring.rotation.x = Math.PI / 2.5;
        this.scene.add(m, ring);
        if (this.hole) { this.scene.remove(this.hole.m); this.scene.remove(this.hole.ring); }
        this.hole = { pos: p, m, ring, t: 2.2, max: 2.2, dmg: base * 3, col };
        break;
      }
      case 'zero': {
        const P = this.player.pos;
        this.shockRing(P, 18, '#9be8ff', 0.7); this.burst(P.clone().setY(1), 140, '#bff4ff', 20, 0.45, 0.8, 1);
        for (const e of this.enemies) {
          if (e.dead || e.mesh.position.distanceTo(P) > 18 + e.r) continue;
          e.freezeT = e.def.boss ? 1.5 : 4; this.damage(e, base * 1.2, null, 1, true);
          this.burst(e.mesh.position.clone().setY(e.mesh.position.y + e.cy), 8, '#e0fbff', 3, 0.4, 0.6, 2);
        }
        sfx('shock');
        break;
      }
      case 'nova': {
        for (let i = 0; i < 48; i++) {
          const a = (i / 48) * Math.PI * 2, d = new V(Math.sin(a), rand(-0.05, 0.12), Math.cos(a)).normalize();
          this.fireHitscan(o, d, o.clone().addScaledVector(d, 0.6).setY(o.y - 0.3), def, 1.5 * pw, col);
        }
        this.shake = 0.5; sfx('shot', { heavy: 1, pitch: 0.5 }); this.hitStop(0.05);
        break;
      }
      case 'rend': {
        const P = this.player.pos;
        for (let i = 0; i < 60; i++) {
          const a = (i / 60) * Math.PI * 2;
          tmp.set(P.x + Math.cos(a) * 7, 1.1, P.z + Math.sin(a) * 7);
          this.particle(tmp, tmp2.set(-Math.sin(a) * 9, 0, Math.cos(a) * 9), new THREE.Color(col), 0.55, 0.3, 0);
        }
        this.shockRing(P, 9, col, 0.35); this.swingT = 1; this.swingDir = -this.swingDir;
        for (const e of this.enemies) {
          if (e.dead) continue;
          tmp.copy(e.mesh.position).sub(P); tmp.y = 0;
          if (tmp.length() > 9 + e.r) continue;
          e.kb.addScaledVector(tmp.normalize(), e.def.boss ? 1 : 6);
          this.damage(e, def.dmg * 3 * pw * (e.def.boss ? 0.5 : 1), null, 0, true);
        }
        sfx('meleeHit', { heavy: 1 }); this.shake = 0.4; this.hitStop(0.06);
        break;
      }
    }
  }

  // ───────────────────────── 이펙트 ─────────────────────────
  particle(pos, vel, col, size, life, grav) {
    const i = this.pI; this.pI = (this.pI + 1) % this.pN;
    this.pPos[i * 3] = pos.x; this.pPos[i * 3 + 1] = pos.y; this.pPos[i * 3 + 2] = pos.z;
    this.pVel[i * 3] = vel.x; this.pVel[i * 3 + 1] = vel.y; this.pVel[i * 3 + 2] = vel.z;
    this.pCol[i * 3] = col.r; this.pCol[i * 3 + 1] = col.g; this.pCol[i * 3 + 2] = col.b;
    this.pSize[i] = size; this.pLife[i] = life; this.pMax[i] = life; this.pGrav[i] = grav;
  }
  burst(pos, n, color, speed, size, life, grav = 12) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      tmp2.set(rand(-1, 1), rand(-0.3, 1), rand(-1, 1)).normalize().multiplyScalar(speed * rand(0.3, 1));
      this.particle(pos, tmp2, c, size * rand(0.6, 1.3), life * rand(0.6, 1.2), grav);
    }
  }
  updateParticles(dt) {
    const P = this.pPos, Vv = this.pVel;
    for (let i = 0; i < this.pN; i++) {
      if (this.pLife[i] <= 0) { if (this.pSize[i] !== 0) this.pSize[i] = 0; continue; }
      this.pLife[i] -= dt;
      Vv[i * 3 + 1] -= this.pGrav[i] * dt;
      P[i * 3] += Vv[i * 3] * dt; P[i * 3 + 1] += Vv[i * 3 + 1] * dt; P[i * 3 + 2] += Vv[i * 3 + 2] * dt;
      if (P[i * 3 + 1] < 0.02) { P[i * 3 + 1] = 0.02; Vv[i * 3 + 1] *= -0.3; Vv[i * 3] *= 0.7; Vv[i * 3 + 2] *= 0.7; }
      const k = this.pLife[i] / this.pMax[i];
      if (k < 0.3) this.pSize[i] *= 0.9;
    }
    this.pGeo.attributes.position.needsUpdate = true; this.pGeo.attributes.color.needsUpdate = true; this.pGeo.attributes.size.needsUpdate = true;
  }

  tracer(a, b, col, w, life) {
    const m = new THREE.Mesh(this.tracerGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.copy(a); m.lookAt(b); const len = a.distanceTo(b); m.scale.set(w, w, len);
    this.scene.add(m); this.tracers.push({ m, t: life, max: life, w });
  }
  bolt(a, b, col) {
    const pts = []; const n = 8;
    for (let i = 0; i <= n; i++) {
      const p = a.clone().lerp(b, i / n);
      if (i > 0 && i < n) p.add(tmp.set(rand(-0.4, 0.4), rand(-0.4, 0.4), rand(-0.4, 0.4)));
      pts.push(p);
    }
    const m = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xbfe9ff }));
    this.scene.add(m); this.lines.push({ m, t: 0.09 });
    this.burst(b, 5, col, 5, 0.25, 0.25);
  }
  flashLight(pos, color, intensity, dur) {
    const L = this.lights[this.lightIdx]; this.lightIdx = (this.lightIdx + 1) % this.lights.length;
    L.l.position.copy(pos); L.l.color.set(color); L.l.intensity = intensity; L.max = intensity; L.t = dur; L.dur = dur;
  }
  explode(pos, radius, dmg, col, big) {
    const m = new THREE.Mesh(this.flashGeo, new THREE.MeshBasicMaterial({ color: big ? 0xffb347 : col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.copy(pos); m.scale.setScalar(0.1); this.scene.add(m);
    // 카메라가 폭발 구 안에 들어가 화면 전체가 하얗게 덮이지 않도록 크기를 거리로 제한
    const camD = pos.distanceTo(this.camera.position);
    this.flashes.push({ m, t: big ? 0.35 : 0.22, max: big ? 0.35 : 0.22, r: Math.min(radius, Math.max(0.4, camD * 0.6)) });
    this.burst(pos, big ? 60 : 14, big ? '#ff8a2a' : col, radius * 3, big ? 0.6 : 0.35, 0.6);
    if (big) { this.burst(pos, 25, '#ffee88', radius * 4.5, 0.35, 0.4); this.burst(pos, 20, '#553344', 3, 1.2, 1.2, -1); }
    this.flashLight(pos, big ? 0xff8833 : col, big ? 40 : 12, big ? 0.35 : 0.15);
    const d = pos.distanceTo(this.player.pos);
    if (big) { this.shake = Math.max(this.shake, Math.max(0, 0.6 - d / 40)); sfx('boom', { s: Math.min(1.4, radius / 5) }); }
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dd = tmp.copy(e.mesh.position).setY(e.mesh.position.y + e.cy).distanceTo(pos) - e.r;
      if (dd < radius) this.damage(e, dmg * (1 - 0.5 * Math.max(0, dd) / radius), null, 0, true);
    }
  }
  shockRing(pos, radius, color, dur = 0.5) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.copy(pos).setY(0.15); m.scale.setScalar(0.5); this.scene.add(m);
    this.rings.push({ m, t: dur, max: dur, r: radius, grow: true });
  }
  telegraph(pos, radius, dur) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(radius, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff1133, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.position.copy(pos).setY(0.08); this.scene.add(m);
    this.rings.push({ m, t: dur, max: dur, r: radius, grow: false, tele: true });
  }
  updateFx(dt) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i]; t.t -= dt;
      const k = Math.max(0, t.t / t.max); t.m.scale.x = t.m.scale.y = t.w * k; t.m.material.opacity = k;
      if (t.t <= 0) { this.scene.remove(t.m); t.m.material.dispose(); this.tracers.splice(i, 1); }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]; f.t -= dt; const k = 1 - f.t / f.max;
      f.m.scale.setScalar(f.r * (0.3 + k * 0.9)); f.m.material.opacity = 1 - k;
      if (f.t <= 0) { this.scene.remove(f.m); f.m.material.dispose(); this.flashes.splice(i, 1); }
    }
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i]; l.t -= dt;
      if (l.t <= 0) { this.scene.remove(l.m); l.m.geometry.dispose(); l.m.material.dispose(); this.lines.splice(i, 1); }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]; r.t -= dt; const k = 1 - r.t / r.max;
      if (r.grow) { r.m.scale.setScalar(0.5 + r.r * k); r.m.material.opacity = 1 - k; }
      else r.m.material.opacity = 0.15 + 0.35 * Math.abs(Math.sin(k * 18));
      if (r.t <= 0) { this.scene.remove(r.m); r.m.material.dispose(); if (r.tele) r.m.geometry.dispose(); this.rings.splice(i, 1); }
    }
    for (let i = (this.dying || []).length - 1; i >= 0; i--) {
      const d = this.dying[i]; d.t -= dt; d.e.inner.scale.multiplyScalar(1 + dt * 5);
      if (d.t <= 0) { this.scene.remove(d.e.mesh); d.e.bodyMat.dispose(); this.dying.splice(i, 1); }
    }
    for (const L of this.lights) { if (L.t > 0) { L.t -= dt; L.l.intensity = Math.max(0, L.max * L.t / L.dur); } }
    if (this.muzzleT > 0) { this.muzzleT -= dt; if (this.muzzleT <= 0) { this.muzzleSprite.visible = false; this.muzzleLight.intensity = 0; } }
    if (this.beamT > 0) {
      this.beamT -= dt; this.beam.visible = true;
      const a = this.muzzleWorld(0);
      this.beam.position.copy(a); this.beam.lookAt(this.beamTo);
      const w = 0.03 + Math.random() * 0.02; this.beam.scale.set(w, w, a.distanceTo(this.beamTo));
      if (Math.random() < 0.5) this.burst(this.beamTo, 2, this.beam.material.color, 4, 0.25, 0.2);
    } else this.beam.visible = false;
  }

  // ───────────────────────── 괴생물체 ─────────────────────────
  spawnEnemy(key, pos) {
    const def = ENEMIES[key];
    const geo = enemyGeometry(key, def);
    const mesh = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(def.color).multiplyScalar(1.35), roughness: 0.32, metalness: 0.45, flatShading: true, vertexColors: true, emissive: def.color, emissiveIntensity: 0.15 });
    rimLight(bodyMat, def.eye);
    const body = new THREE.Mesh(geo.body, bodyMat);
    const eyes = new THREE.Mesh(geo.eyes, this.eyeMat(def.eye));
    const jaw = new THREE.Mesh(geo.jaw, bodyMat); jaw.position.fromArray(geo.jawPos);
    const inner = new THREE.Group(); inner.add(body, eyes, jaw); mesh.add(inner);
    const legsA = geo.legsA && new THREE.Mesh(geo.legsA, bodyMat), legsB = geo.legsB && new THREE.Mesh(geo.legsB, bodyMat);
    if (legsA) inner.add(legsA, legsB);
    inner.position.y = def.size * 0.9;
    if (!pos) {
      const portal = this.portals[Math.floor(Math.random() * this.portals.length)];
      if (Math.random() < 0.45) {
        // 플레이어 주변 28~40m에 열리는 작은 균열에서 출현 (이동 시간 단축)
        const a = Math.random() * Math.PI * 2, d = rand(28, 40);
        pos = new V(this.player.pos.x + Math.cos(a) * d, def.fly ? 5 : 0, this.player.pos.z + Math.sin(a) * d);
        const R = Math.hypot(pos.x, pos.z); if (R > ARENA - 3) { pos.x *= (ARENA - 3) / R; pos.z *= (ARENA - 3) / R; }
        this.burst(tmp3.copy(pos).setY(1.2), 14, '#ff3dbb', 5, 0.5, 0.5, 0); this.burst(tmp3, 6, '#ffffff', 2, 0.3, 0.3, 0);
      } else {
        pos = new V(Math.cos(portal.a) * (ARENA - 4) + rand(-3, 3), def.fly ? 4 : 0, Math.sin(portal.a) * (ARENA - 4) + rand(-3, 3));
        this.burst(tmp3.copy(pos).setY(2), 6, '#ff3dbb', 6, 0.5, 0.4, 0);
      }
    }
    mesh.position.copy(pos);
    this.scene.add(mesh);
    const hpMul = this.diff.hp * (def.boss ? 1 + Math.min(1.5, this.total / 5000) : 1);
    const e = {
      key, def, mesh, inner, bodyMat, hp: def.hp * hpMul, maxHp: def.hp * hpMul, r: def.size * 1.15, cy: def.size * 0.9,
      speed: def.speed * rand(0.85, 1.15), slowT: 0, flash: 0, atkCd: 0, phase: Math.random() * 6,
      skillCd: 3, state: 'chase', stateT: 0, kb: new V(), enraged: false, spitCd: rand(1, 3),
      fly: !!def.fly, alt: def.fly ? rand(def.alt[0], def.alt[1]) : 0, climbT: 0,
      jaw, eyes, legsA, legsB, atkT: 0, castT: 0, atkHit: false,
    };
    this.enemies.push(e);
    if (def.boss) {
      this.boss = e;
      this.hooks.onBoss(e);
      sfx('roar'); this.shake = 0.6;
      this.toast(def.boss === 2 ? '⚠ 보스 출현 — 균열의 폭군' : '⚠ 중간보스 출현 — 라바저', '#ff2244');
    }
    return e;
  }
  eyeMat(c) {
    this.eyeMats = this.eyeMats || {};
    return this.eyeMats[c] || (this.eyeMats[c] = new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2.2) }));
  }

  spawnTick(dt) {
    const alive = this.enemies.length;
    if (this.spawned < this.total) {
      this.spawnAcc += dt * this.spawnRate * (1 + Math.min(0.5, this.time / 60));
      while (this.spawnAcc >= 1 && this.enemies.length < this.maxAlive && this.spawned < this.total) {
        this.spawnAcc -= 1; this.spawned++;
        const r = Math.random(), prog = this.spawned / this.total;
        let key = 'crawler';
        if (r < 0.08 + prog * 0.05) key = 'brute';
        else if (r < 0.18) key = 'spitter';
        else if (r < 0.26) key = 'exploder';
        else if (r < 0.37) key = 'wraith';
        else if (r < 0.43) key = 'gazer';
        else if (r < 0.6) key = 'stalker';
        this.spawnEnemy(key);
      }
      if (this.spawnAcc > 3) this.spawnAcc = 3;
      const p = Math.max(this.spawned / this.total, this.time / this.stageTime);
      if (this.time >= this.stageTime && !this.collapsed) {
        this.collapsed = true; this.spawned = this.total;
        this.toast('균열 붕괴! 남은 개체 소멸 — 보스 강림', '#ff2244'); sfx('roar'); this.shake = 0.8;
      }
      if ((p >= 0.33 && this.midSpawned === 0) || (p >= 0.66 && this.midSpawned === 1)) { this.midSpawned++; this.spawnEnemy('ravager'); }
    } else if (!this.bossSpawned && (alive < 60 || this.collapsed)) {
      this.bossSpawned = true; this.spawnEnemy('tyrant', new V(0, 0, -ARENA + 10));
    }
  }

  damage(e, dmg, pt, slow, silent) {
    if (e.dead) return;
    dmg = Math.round(dmg * rand(0.92, 1.08));
    const crit = pt && pt.y > e.mesh.position.y + e.cy + e.r * 0.35;
    if (crit) dmg = Math.round(dmg * 1.6);
    e.hp -= dmg; e.flash = 0.08;
    e.pop = Math.min(0.35, (e.pop || 0) + 0.08 + dmg / e.maxHp * 0.6);
    if (!e.def.boss && pt) { tmp3.copy(e.mesh.position).sub(this.player.pos).setY(0).normalize(); e.kb.addScaledVector(tmp3, Math.min(3, dmg / e.maxHp * 6)); }
    if (slow) e.slowT = 2;
    if (pt) { this.burst(pt, e.def.boss ? 6 : 4, e.def.eye, 5, 0.3, 0.3); this.dmgNum(pt, dmg, crit); }
    else if (!silent || Math.random() < 0.3) { const p = e.mesh.position.clone(); p.y += e.cy * 2; this.dmgNum(p, dmg, false); }
    if (e.hp <= 0) { this.hitmark(crit, true); this.kill(e, crit); } else this.hitmark(crit, false);
  }

  kill(e, crit) {
    e.dead = true;
    this.kills++; this.combo++; this.comboT = 2.5;
    const pos = e.mesh.position.clone(); pos.y += e.cy;
    this.burst(pos, e.def.boss ? 160 : 22, e.def.color, e.def.boss ? 14 : 7, e.def.boss ? 0.9 : 0.45, 0.9);
    this.burst(pos, e.def.boss ? 60 : 8, e.def.eye, e.def.boss ? 18 : 6, 0.3, 0.5);
    // 죽음 연출: 하얗게 번쩍이며 부풀었다가 터짐
    e.bodyMat.emissive.set(e.def.eye); e.bodyMat.emissiveIntensity = 1.1;
    this.dying.push({ e, t: 0.09 });
    sfx('kill', { combo: this.combo });
    if (e.def.boss) this.hitStop(e.def.boss === 2 ? 0.45 : 0.25);
    else if (crit) this.hitStop(0.03);
    const [c0, c1] = e.def.coin;
    const coins = Math.round(rand(c0, c1 + 1) * 6 * this.diff.coin * (1 + Math.min(this.combo, 100) * 0.005));
    this.coinsEarned += coins; this.hooks.onCoins(coins);
    const tier = e.def.boss === 2 ? 'boss' : e.def.boss === 1 ? 'mid' : 'normal';
    if (Math.random() < DROP_CHANCE[tier]) this.dropWeapon(pos, rollWeapon(DROP_RARITY[tier]));
    if (tier === 'boss' && Math.random() < 0.5) this.dropWeapon(pos.clone().add(new V(2, 0, 0)), rollWeapon(DROP_RARITY.boss));
    if (tier !== 'normal') { this.dropWeapon(pos.clone().add(new V(-2, 0, 1)), null, 'hp'); this.shake = 1; this.explode(pos, 8, 0, e.def.eye, true); }
    else if (Math.random() < 0.025) this.dropWeapon(pos, null, 'hp');
    if (e.def.explode) this.explode(pos, 4, 60, '#ff7a1a', true);
    if (e === this.boss) {
      this.boss = null; this.hooks.onBoss(null);
      if (e.def.boss === 2) { this.bossDead = true; this.toast('보스 처치! 차원의 틈이 닫히고 있다', '#fbbf24'); }
      else this.toast('중간보스 처치!', '#fbbf24');
    }
  }

  dropWeapon(pos, def, kind = 'weapon') {
    const grp = new THREE.Group();
    const col = kind === 'hp' ? '#22ff88' : RARITIES[def.rarity].color;
    if (kind === 'hp') {
      grp.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(1.6) })));
    } else {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0x1a1a22, metalness: 0.8, roughness: 0.3, emissive: col, emissiveIntensity: 0.6 }));
      grp.add(crate);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.45, 18, 12, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.y = 9; grp.add(beam);
      this.toast(`${RARITIES[def.rarity].name} 무기 드랍!`, col);
    }
    grp.position.copy(pos).setY(0.8);
    this.scene.add(grp);
    this.pickups.push({ mesh: grp, def, kind, t: 0, col });
  }

  updatePickups(dt) {
    const P = this.player.pos;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i]; p.t += dt;
      p.mesh.rotation.y += dt * 2; p.mesh.children[0].position.y = Math.sin(p.t * 3) * 0.15;
      tmp.copy(P).setY(0.8).sub(p.mesh.position);
      const d = tmp.length();
      if (d < 7 || p.t > 25) p.mesh.position.addScaledVector(tmp.normalize(), Math.min(d, dt * (14 + p.t)));
      if (d < 1.3) {
        this.scene.remove(p.mesh);
        this.pickups.splice(i, 1);
        if (p.kind === 'hp') { this.player.hp = Math.min(this.player.maxHp, this.player.hp + 30); this.toast('+30 체력', '#22ff88'); sfx('coin'); }
        else { this.loot.push(p.def); this.hooks.onLoot(p.def); sfx('loot'); }
      }
    }
  }

  updateEnemies(dt) {
    const P = this.player;
    // 공간 해시로 서로 밀어내기
    const grid = new Map();
    for (const e of this.enemies) {
      const k = Math.floor(e.mesh.position.x / 3) * 1000 + Math.floor(e.mesh.position.z / 3);
      let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(e);
    }
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead) { this.enemies.splice(i, 1); continue; }
      const pos = e.mesh.position;
      e.phase += dt * 8;
      e.atkCd -= dt; e.slowT -= dt; e.freezeT = (e.freezeT || 0) - dt;
      const dx = P.pos.x - pos.x, dz = P.pos.z - pos.z;
      const dist = Math.hypot(dx, dz) || 0.001;
      const nx = dx / dist, nz = dz / dist;
      let spd = e.speed * (e.freezeT > 0 ? 0.08 : e.slowT > 0 ? 0.5 : 1) * (e.enraged ? 1.4 : 1);
      let mvx = nx, mvz = nz;
      if (e.def.boss) { const r = this.bossAI(e, dt, dist, nx, nz); if (r) { mvx = r.x; mvz = r.z; spd = r.s; } }
      else if (e.fly) {
        // 비행: 고도를 유지하며 접근 → 박쥐는 근처에서 급강하, 감시자는 거리를 두고 공중 사격
        e.climbT -= dt;
        let ty = e.alt + Math.sin(e.phase * 0.3) * 0.8, climb = 1.5;
        if (e.def.shooter) {
          if (dist < 22) {
            spd = dist < 14 ? -2.5 : 0; e.spitCd -= dt;
            if (e.spitCd <= 0) { e.spitCd = rand(1.5, 2.3); e.castT = CAST_DUR; }
          }
        } else if (dist < 11 && e.climbT <= 0) { ty = P.pos.y + 0.9; climb = 4; spd *= 1.5; e.diving = true; }
        else e.diving = false;
        pos.y += (ty - pos.y) * Math.min(1, dt * climb);
      } else if (e.def.ranged && dist < 17) {
        spd = 0; e.spitCd -= dt;
        if (e.spitCd <= 0) { e.spitCd = rand(1.8, 2.8); e.castT = CAST_DUR; }
      } else if (e.key === 'stalker') { mvx += Math.sin(e.phase * 0.4) * 0.5 * nz; mvz -= Math.sin(e.phase * 0.4) * 0.5 * nx; }
      if (e.castT > 0) {
        e.castT -= dt;
        if (e.castT <= 0) {
          const head = pos.clone(); head.y += e.cy * (e.fly ? 1 : 1.4); head.x += nx * e.r; head.z += nz * e.r;
          this.enemyShot(head, e.fly ? 20 : 18, e.def.dmg, e.fly ? 0xffd60a : 0x9dff3d);
          this.burst(head, 10, e.fly ? '#ffd60a' : '#9dff3d', 4, 0.35, 0.3, 0);
        }
      }
      // 공격 중 이동: 예비동작에선 멈칫, 타격 순간엔 앞으로 덮침
      if (e.atkT > 0 && !e.def.boss) spd *= e.atkT > STRIKE ? 0.15 : 1.9;
      // 분리
      const gx = Math.floor(pos.x / 3), gz = Math.floor(pos.z / 3);
      let sx = 0, sz = 0;
      for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
        const a = grid.get((gx + ox) * 1000 + gz + oz); if (!a) continue;
        for (const o of a) {
          if (o === e || o.fly !== e.fly) continue;
          const ddx = pos.x - o.mesh.position.x, ddz = pos.z - o.mesh.position.z;
          const rr = e.r + o.r, d2 = ddx * ddx + ddz * ddz;
          if (d2 < rr * rr && d2 > 1e-4) { const d = Math.sqrt(d2); sx += ddx / d * (rr - d); sz += ddz / d * (rr - d); }
        }
      }
      pos.x += (mvx * spd + e.kb.x) * dt + sx * Math.min(1, dt * 8);
      pos.z += (mvz * spd + e.kb.z) * dt + sz * Math.min(1, dt * 8);
      e.kb.multiplyScalar(Math.max(0, 1 - dt * 5));
      // 플레이어 몸을 파고들지 않도록 최소 거리 유지 (카메라 관통 방지)
      if (!e.fly || pos.y < P.pos.y + 2.5) {
        const px = pos.x - P.pos.x, pz = pos.z - P.pos.z, minD = e.r * (e.def.boss ? 1.05 : 1.25) + 0.5, d2 = px * px + pz * pz;
        if (d2 < minD * minD && d2 > 1e-6) { const d = Math.sqrt(d2); pos.x = P.pos.x + px / d * minD; pos.z = P.pos.z + pz / d * minD; }
      }
      for (const pl of this.pillars) {
        const ddx = pos.x - pl.x, ddz = pos.z - pl.z, rr = pl.r + e.r * 0.7, d2 = ddx * ddx + ddz * ddz;
        if (d2 < rr * rr && !(e.fly && pos.y > pl.h)) {
          const d = Math.sqrt(d2) || 0.01; pos.x = pl.x + ddx / d * rr; pos.z = pl.z + ddz / d * rr;
          // 기둥을 돌아가도록 접선 방향으로 미끄러짐
          const side = (nx * ddz - nz * ddx) > 0 ? 1 : -1;
          pos.x += -ddz / d * side * spd * dt; pos.z += ddx / d * side * spd * dt;
        }
      }
      const R = Math.hypot(pos.x, pos.z); if (R > ARENA + 2) { pos.x *= (ARENA + 2) / R; pos.z *= (ARENA + 2) / R; }
      // 연출
      e.mesh.rotation.y = Math.atan2(dx, dz);
      const bob = e.fly ? Math.sin(e.phase * 0.5) * 0.3 : Math.abs(Math.sin(e.phase)) * e.def.size * (e.key === 'stalker' ? 0.5 : 0.18);
      e.inner.position.y = e.cy + bob;
      e.inner.rotation.z = Math.sin(e.phase) * 0.12;
      e.pop = Math.max(0, (e.pop || 0) - dt * 2.5);
      const pp = 1 + e.pop;
      e.inner.scale.set((1 + Math.sin(e.phase * 2) * 0.04) * pp, (1 - Math.sin(e.phase * 2) * 0.04) / pp, pp);
      if (e.key === 'wraith') e.inner.scale.x *= e.atkT > 0 ? 0.65 : 1 + Math.sin(e.phase * 2.2) * 0.3;
      if (e.flash > 0) { e.flash -= dt; e.bodyMat.emissiveIntensity = e.flash > 0 ? 2.5 : (e.enraged ? 0.8 : 0.15); e.bodyMat.emissive.set(e.flash > 0 ? 0xffffff : (e.enraged ? 0xff0022 : e.def.color)); }
      // 근접 공격
      const vy = pos.y + e.cy - (P.pos.y + 1);
      const d3 = e.fly ? Math.hypot(dist, vy) : dist, reach = e.r + (e.fly ? 0.9 : 0.75);
      const grounded = e.fly || P.pos.y < e.def.size * 2;
      if (e.atkT <= 0 && e.atkCd <= 0 && d3 < reach + 1.0 && grounded && !e.dead && !(e.freezeT > 0)) {
        e.atkT = e.def.explode ? FUSE : ATK_DUR; e.atkHit = false; e.atkCd = e.def.boss ? 1.1 : 0.95;
      }
      if (e.atkT > 0) {
        e.atkT -= dt;
        if (!e.atkHit && e.atkT <= (e.def.explode ? 0 : STRIKE * 0.45)) { // 덮친 직후 판정
          e.atkHit = true;
          if (e.def.explode) { if (d3 < reach + 2.4) this.hurt(e.def.dmg * this.diff.dmg); e.hp = 0; this.kill(e); }
          else if (d3 < reach + 0.8 && grounded) {
            this.hurt(e.def.dmg * this.diff.dmg);
            this.burst(tmp.copy(P.pos).setY(P.pos.y + 1.1).addScaledVector(tmp2.set(-nx, 0, -nz), 0.6), 8, '#ff2a55', 4, 0.3, 0.25);
            if (e.fly) e.climbT = 1.6; // 공격 후 다시 상승
          }
        }
        if (e.atkT < 0) e.atkT = 0;
      }
      this.animateEnemy(e, spd);
      if (e.freezeT > 0 && e.flash <= 0) { e.bodyMat.emissive.set(0x5ec8ff); e.bodyMat.emissiveIntensity = 0.9; e.frozenTint = true; }
      else if (e.frozenTint && e.freezeT <= 0) { e.frozenTint = false; e.bodyMat.emissive.set(e.def.color); e.bodyMat.emissiveIntensity = 0.15; }
    }
  }

  // 부위 애니메이션: 교차 보행, 턱 벌림, 공격 예비동작/타격, 원거리 시전, 보스 스킬 자세
  animateEnemy(e, spd) {
    const s = e.def.size, moving = Math.min(1, Math.abs(spd) / 3);
    let rx = 0, jaw = 0.12 + Math.max(0, Math.sin(e.phase * 0.35)) * 0.12, lunge = 0, eyeK = 1;
    if (e.atkT > 0) {
      if (e.def.explode) {
        const k = 1 - e.atkT / FUSE;
        e.inner.scale.multiplyScalar(1 + k * 0.5);
        e.bodyMat.emissive.set(Math.sin(k * 45) > 0 ? 0xffffff : 0xff4400); e.bodyMat.emissiveIntensity = 0.6 + k * 2;
        jaw = 1.2;
      } else if (e.atkT > STRIKE) {
        const w = 1 - (e.atkT - STRIKE) / (ATK_DUR - STRIKE);
        rx = -0.55 * w; jaw = 0.2 + 1.1 * w; lunge = -0.2 * s * w;
      } else {
        const k = 1 - e.atkT / STRIKE, p = Math.min(1, k * 3);
        rx = (-0.55 + 1.05 * p) * (1 - k * 0.7); jaw = (1 - p) * 1.3; lunge = 0.32 * s * p * (1 - k * 0.6);
      }
    }
    if (e.castT > 0) {
      const k = 1 - e.castT / CAST_DUR;
      rx = -0.4 * k; jaw = 0.3 + 1.2 * k; eyeK = 1 + k * 0.5;
    }
    if (e.fly && e.diving && e.atkT <= 0) rx += 0.6;
    if (e.def.boss) {
      const t = Math.max(0, e.stateT);
      if (e.state === 'slam') { rx = -0.7 * (1 - t / 1.1); jaw = 1.2; e.inner.position.y += 0.7 * s * (1 - t / 1.1); }
      else if (e.state === 'charge') { rx = 0.35; jaw = 1.3; }
      else if (e.state === 'barrage') { rx = -0.25 + Math.sin(e.phase * 3) * 0.05; jaw = 1.4; }
      else if (e.state === 'summon') { rx = -0.6; jaw = 1.0 + Math.sin(e.phase * 2) * 0.3; e.inner.position.y += 0.4; }
    }
    e.inner.rotation.x = rx;
    e.inner.position.z = lunge;
    if (e.key === 'gazer') { e.jaw.rotation.x = -0.5 - jaw * 0.6; e.eyes.scale.setScalar(eyeK); }
    else { e.jaw.rotation.x = jaw * 0.45; e.jaw.scale.x = 1 + jaw * 0.55; }
    if (e.legsA) {
      if (e.fly) { e.legsA.rotation.y = Math.sin(e.phase * 0.3) * 0.3; e.legsB.rotation.y = -e.legsA.rotation.y; }
      else {
        const sw = Math.sin(e.phase) * 0.38 * moving;
        e.legsA.rotation.y = sw; e.legsB.rotation.y = -sw;
        e.legsA.position.y = Math.max(0, Math.sin(e.phase)) * 0.12 * s * moving;
        e.legsB.position.y = Math.max(0, -Math.sin(e.phase)) * 0.12 * s * moving;
      }
    }
  }

  bossAI(e, dt, dist, nx, nz) {
    const big = e.def.boss === 2;
    if (!e.enraged && e.hp < e.maxHp * 0.5) { e.enraged = true; this.toast(`${e.def.name} 격노!`, '#ff2244'); sfx('roar'); }
    e.stateT -= dt;
    if (e.state === 'chase') {
      e.skillCd -= dt * (e.enraged ? 1.5 : 1);
      if (e.skillCd <= 0) {
        const opts = big ? ['slam', 'charge', 'barrage', 'summon', 'barrage'] : ['slam', 'charge', 'summon'];
        const s = opts[Math.floor(Math.random() * opts.length)];
        e.state = s; e.skillCd = rand(3.5, 5.5);
        if (s === 'slam') { e.stateT = 1.1; this.telegraph(e.mesh.position, big ? 13 : 9, 1.1); this.hooks.onBossSkill('지면 강타 — 범위 밖으로 피하거나 점프!'); sfx('warn'); }
        if (s === 'charge') { e.stateT = 0.7; e.chargeDir = new V(nx, 0, nz); this.hooks.onBossSkill('돌진 — 옆으로 대시!'); sfx('warn'); }
        if (s === 'barrage') { e.stateT = 1.4; e.shots = 0; this.hooks.onBossSkill('공허 탄막 — 엄폐하라!'); }
        if (s === 'summon') { e.stateT = 0.8; this.hooks.onBossSkill('하수인 소환'); }
      }
      return null;
    }
    if (e.state === 'slam') {
      e.inner.position.y += 0.5 * (1 - Math.max(0, e.stateT) / 1.1);
      if (e.stateT <= 0) {
        const R = big ? 13 : 9;
        this.shockRing(e.mesh.position, R, 0xff2244, 0.5); this.burst(e.mesh.position.clone().setY(0.5), 80, '#ff3355', 16, 0.6, 0.7);
        sfx('boom', { s: 1.4 }); this.shake = 1;
        const d = e.mesh.position.distanceTo(tmp.copy(this.player.pos).setY(0));
        if (d < R && this.player.pos.y < 0.6) { this.hurt((big ? 45 : 30) * this.diff.dmg); this.player.vel.addScaledVector(tmp.set(-nx, 0, -nz), -18); this.player.vel.y = 8; this.player.onGround = false; }
        e.state = 'chase';
      }
      return { x: 0, z: 0, s: 0 };
    }
    if (e.state === 'charge') {
      if (e.stateT > 0) { e.bodyMat.emissive.set(0xff2200); e.bodyMat.emissiveIntensity = 1.5; return { x: 0, z: 0, s: 0 }; }
      if (e.stateT > -1.1) { if (Math.random() < 0.5) this.burst(e.mesh.position.clone().setY(0.3), 3, '#ff5533', 4, 0.6, 0.4); return { x: e.chargeDir.x, z: e.chargeDir.z, s: e.speed * 5 }; }
      e.state = 'chase'; e.bodyMat.emissiveIntensity = 0.15; return null;
    }
    if (e.state === 'barrage') {
      const want = Math.floor((1.4 - e.stateT) / 0.08);
      while (e.shots < want && e.shots < 18) {
        e.shots++;
        const a = Math.atan2(nx, nz) + (e.shots - 9) * 0.07;
        const o = e.mesh.position.clone(); o.y = e.cy * 1.8;
        this.enemyShot(o, 26, 14, 0xff2a6a, new V(Math.sin(a), 0, Math.cos(a)));
      }
      if (e.stateT <= 0) e.state = 'chase';
      return { x: 0, z: 0, s: 0 };
    }
    if (e.state === 'summon') {
      if (e.stateT <= 0) {
        const n = big ? 12 : 7;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const p = e.mesh.position.clone().add(new V(Math.cos(a) * (e.r + 2), 0, Math.sin(a) * (e.r + 2)));
          const sk = ['crawler', 'stalker', 'wraith'][i % 3];
          if (sk === 'wraith') p.y = 3;
          this.spawnEnemy(sk, p);
        }
        this.burst(e.mesh.position.clone().setY(2), 60, '#b026ff', 10, 0.6, 0.6);
        e.state = 'chase';
      }
      return { x: 0, z: 0, s: 0 };
    }
    return null;
  }

  enemyShot(pos, speed, dmg, color, dir) {
    const target = this.player.pos.clone(); target.y += 1.2;
    const d = dir ? dir.clone() : target.sub(pos).normalize();
    if (dir) { const t2 = this.player.pos.clone().setY(1.2).sub(pos).normalize(); d.y = t2.y; d.normalize(); }
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2) }));
    m.position.copy(pos); this.scene.add(m);
    this.eprojs.push({ mesh: m, vel: d.multiplyScalar(speed), dmg: dmg * this.diff.dmg, life: 4, col: color });
  }

  updateEnemyProjs(dt) {
    const P = this.player;
    for (let i = this.eprojs.length - 1; i >= 0; i--) {
      const p = this.eprojs[i]; p.life -= dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (Math.random() < 0.4) this.burst(p.mesh.position, 1, p.col, 0.5, 0.35, 0.3, 0);
      const d = p.mesh.position.distanceTo(tmp.copy(P.pos).setY(P.pos.y + 1.1));
      let dead = p.life <= 0 || p.mesh.position.y < 0;
      for (const pl of this.pillars) { const dx = p.mesh.position.x - pl.x, dz = p.mesh.position.z - pl.z; if (dx * dx + dz * dz < pl.r * pl.r * 0.75) dead = true; }
      if (d < 1.0) { this.hurt(p.dmg); dead = true; }
      if (dead) { this.burst(p.mesh.position, 8, p.col, 4, 0.3, 0.3); this.scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); this.eprojs.splice(i, 1); }
    }
  }

  // ───────────────────────── 플레이어 ─────────────────────────
  hurt(d) {
    const P = this.player;
    if (P.dashT > 0 || !this.running) return;
    d *= 1 - P.dr;
    if (P.armor > 0) { const a = Math.min(P.armor, d * 0.7); P.armor -= a; d -= a; }
    P.hp -= d; P.hurtT = 0; this.shake = Math.max(this.shake, 0.25);
    this.hooks.onHurt(Math.min(1, d / 25));
    sfx('hurt');
    if (P.hp <= 0) { P.hp = 0; this.end('dead'); }
  }

  skill(k) {
    if (this.cds[k] > 0) return;
    const P = this.player;
    const sdmg = this.diff.hp;
    this.cds[k] = this.cdMax[k];
    if (k === 'dash') {
      const f = new V(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), r = new V(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const d = new V();
      if (this.keys.KeyW) d.add(f); if (this.keys.KeyS) d.sub(f); if (this.keys.KeyD) d.add(r); if (this.keys.KeyA) d.sub(r);
      if (d.lengthSq() === 0) d.copy(f);
      P.dashDir.copy(d.normalize()); P.dashT = 0.2; sfx('dash');
      this.hooks.onFlash('rgba(120,200,255,.25)');
    }
    if (k === 'shock') {
      const pos = P.pos.clone();
      this.shockRing(pos, 12, 0x66ccff, 0.45); this.burst(pos.clone().setY(1), 90, '#7dd3fc', 18, 0.5, 0.5, 2);
      this.flashLight(pos.clone().setY(2), 0x66ccff, 50, 0.4); sfx('shock'); this.shake = 0.5;
      for (const e of this.enemies) {
        if (e.dead) continue;
        const dd = e.mesh.position.distanceTo(pos);
        if (dd < 12 + e.r) {
          tmp.copy(e.mesh.position).sub(pos).setY(0).normalize();
          e.kb.addScaledVector(tmp, e.def.boss ? 4 : 30);
          this.damage(e, 260 * sdmg * (1 - dd / 24), null, 1, true);
        }
      }
    }
    if (k === 'over') { P.overT = 7; sfx('overdrive'); this.toast('오버드라이브! 연사 +60% · 피해 +50% · 탄약 무한', '#ff3dbb'); }
    if (k === 'nade') {
      const def = { type: 'frag', dmg: 300 * sdmg, aoe: 7.5, grav: 22, speed: 26, bounce: true, pierce: 0 };
      const dir = this.aimDir(0); dir.y += 0.15;
      this.spawnProj(this.camera.position.clone().add(new V(0, -0.2, 0)), dir.normalize(), def, 1, '#ff8a2a');
      sfx('click');
    }
    if (k === 'slash') {
      const f = this.aimDir(0); sfx('slash');
      this.view.rotation.z = -1.2;
      let hit = 0;
      for (const e of this.enemies) {
        if (e.dead) continue;
        tmp.copy(e.mesh.position).setY(e.mesh.position.y + e.cy).sub(this.camera.position);
        const d = tmp.length();
        if (d < 4.5 + e.r && tmp.normalize().dot(f) > 0.4) { this.damage(e, 160 * sdmg, null, 0); e.kb.addScaledVector(tmp.setY(0), 12); hit++; }
      }
      const p = this.camera.position.clone().addScaledVector(f, 2);
      this.burst(p, 30, '#a5f3fc', 9, 0.3, 0.25, 0);
      if (hit) this.shake = 0.2;
    }
  }

  // 더블 점프: 지상 점프 1회 + 공중 점프 1회
  jump() {
    const P = this.player;
    if (P.onGround) { P.vel.y = 8.5; P.onGround = false; P.jumps = 1; return; }
    if (P.jumps < 2) {
      P.jumps = 2; P.vel.y = 9;
      this.burst(tmp.copy(P.pos).setY(P.pos.y + 0.2), 20, '#7dd3fc', 5, 0.3, 0.35, 4);
      sfx('dash');
    }
  }

  updatePlayer(dt) {
    const P = this.player, k = this.keys;
    const f = new V(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), r = new V(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = new V();
    if (k.KeyW) wish.add(f); if (k.KeyS) wish.sub(f); if (k.KeyD) wish.add(r); if (k.KeyA) wish.sub(r);
    if (wish.lengthSq()) wish.normalize();
    const sprint = k.ShiftLeft && !this.mouseDown && !this.aiming;
    const swinging = this.swingT > 0 && this.gun && this.gun.userData.melee;
    const speed = (sprint ? 13.5 : 9.5) * (this.aiming ? 0.7 : 1) * (swinging ? 0.65 : 1); // 휘두르는 동안 감속
    const accel = P.onGround ? 12 : 3;
    P.vel.x += (wish.x * speed - P.vel.x) * Math.min(1, accel * dt);
    P.vel.z += (wish.z * speed - P.vel.z) * Math.min(1, accel * dt);
    P.vel.y -= 24 * dt;
    if (P.dashT > 0) { P.dashT -= dt; P.pos.addScaledVector(P.dashDir, 38 * dt); this.burst(this.camera.position.clone().addScaledVector(P.dashDir, -1).setY(1), 3, '#7dd3fc', 2, 0.3, 0.3, 0); }
    P.pos.addScaledVector(P.vel, dt);
    if (P.pos.y <= 0) { P.pos.y = 0; P.vel.y = 0; P.onGround = true; P.jumps = 0; }
    for (const pl of this.pillars) {
      const dx = P.pos.x - pl.x, dz = P.pos.z - pl.z, rr = pl.r + 0.5, d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) { const d = Math.sqrt(d2) || 0.01; P.pos.x = pl.x + dx / d * rr; P.pos.z = pl.z + dz / d * rr; }
    }
    const R = Math.hypot(P.pos.x, P.pos.z); if (R > ARENA) { P.pos.x *= ARENA / R; P.pos.z *= ARENA / R; }
    P.hurtT += dt;
    if (P.hurtT > 4 && P.armor < P.maxArmor) P.armor = Math.min(P.maxArmor, P.armor + 12 * dt);
    if (P.hurtT > 6 && P.hp < P.maxHp) P.hp = Math.min(P.maxHp, P.hp + 3 * dt);
    if (P.overT > 0) P.overT -= dt;
    for (const key in this.cds) this.cds[key] = Math.max(0, this.cds[key] - dt);
    for (const sl of this.slots) sl.skillCd = Math.max(0, (sl.skillCd || 0) - dt);
    if (this.stormT > 0) this.stormT -= dt;

    // 카메라
    this.recoilV += (-this.recoil * 260 - this.recoilV * 24) * dt; this.recoil += this.recoilV * dt;
    this.kickV += (-this.kick * 420 - this.kickV * 26) * dt; this.kick += this.kickV * dt;
    this.roll *= Math.max(0, 1 - dt * 10); this.fovPunch *= Math.max(0, 1 - dt * 12); this.chKick *= Math.max(0, 1 - dt * 8);
    this.shake *= Math.max(0, 1 - dt * 6);
    const hspd = Math.hypot(P.vel.x, P.vel.z);
    this.bobT = (this.bobT || 0) + dt * hspd * (P.onGround ? 1.1 : 0);
    const sh = this.shake * 0.25;
    this.camera.position.set(P.pos.x + rand(-sh, sh), P.pos.y + 1.7 + Math.sin(this.bobT) * 0.05 * Math.min(1, hspd / 9) + rand(-sh, sh), P.pos.z);
    this.camera.rotation.set(this.pitch + this.recoil, this.yaw, this.roll * 0.3);
    const def = this.slots[this.cur].def;
    const zoom = this.aiming ? (def.scope || def.rail ? 0.4 : 0.75) : 1;
    const targetFov = this.baseFov * zoom * (sprint && hspd > 10 ? 1.08 : 1) * (P.dashT > 0 ? 1.12 : 1);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 12);
    this.camera.fov += this.fovPunch * 0.12;
    this.camera.updateProjectionMatrix();
    // 뷰모델
    const s = this.slots[this.cur];
    this.swayX *= Math.max(0, 1 - dt * 8); this.swayY *= Math.max(0, 1 - dt * 8);
    const reloadK = s.reloadT > 0 ? Math.sin(Math.PI * (1 - s.reloadT / def.reload)) : 0;
    const sw = this.switchT > 0 ? this.switchT / 0.25 : 0;
    const ax = this.aiming ? 0 : 0.24, ay = this.aiming ? -0.15 : -0.22;
    this.view.position.x += (ax - this.swayX - this.view.position.x) * Math.min(1, dt * 14);
    this.view.position.y += (ay + this.swayY + Math.sin(this.bobT * 0.5) * 0.012 * Math.min(1, hspd / 9) - reloadK * 0.12 - sw * 0.3 - this.view.position.y) * Math.min(1, dt * 14);
    this.view.position.z = -0.38 + this.kick * 1.4;
    this.view.rotation.x = this.kick * 3.2 - reloadK * 0.6;
    this.view.rotation.y = 0;
    this.view.rotation.z += ((sprint && hspd > 10 ? 0.35 : 0) + reloadK * 0.5 - this.view.rotation.z) * Math.min(1, dt * 10);
    this.view.rotation.z += this.roll;
    // 움직이는 총기 부품: 노리쇠/슬라이드, 펌프 액션, 탄창 교체, 실린더 회전, 로켓 탄두
    const ud = this.gun.userData;
    if (ud.bolt) {
      this.boltT = Math.max(0, (this.boltT || 0) - dt * 16);
      const locked = s.ammo === 0 && def.type === 'pistol';
      ud.bolt.position.z = (locked ? 1 : this.boltT) * (def.type === 'pistol' ? 0.055 : 0.04);
    }
    if (ud.pump) {
      ud.pumpZ ??= ud.pump.position.z;
      this.pumpT = Math.max(0, (this.pumpT || 0) - dt);
      const k = this.pumpT > 0 && this.pumpT < 0.42 ? Math.sin((0.42 - this.pumpT) / 0.42 * Math.PI) : 0;
      ud.pump.position.z = ud.pumpZ + k * 0.09;
    }
    if (ud.mag) {
      ud.magY ??= ud.mag.position.y;
      const rk = s.reloadT > 0 ? 1 - s.reloadT / def.reload : 0;
      const off = rk <= 0 ? 0 : rk < 0.45 ? rk / 0.45 : rk < 0.6 ? 1 : (1 - rk) / 0.4;
      ud.mag.position.y = ud.magY - off * 0.32;
      ud.mag.visible = off < 0.95;
    }
    if (ud.drum) {
      if (s.reloadT > 0) this.drumTarget = (this.drumTarget || 0) + dt * 14;
      ud.drum.rotation.z += ((this.drumTarget || 0) - ud.drum.rotation.z) * Math.min(1, dt * 18);
    }
    if (ud.warhead) ud.warhead.visible = s.ammo > 0 && !(s.reloadT > 0 && s.reloadT > def.reload * 0.35);
    if (ud.ring2) ud.ring2.rotation.y += dt * 4;
    if (this.gun.userData.melee && this.swingT > 0) {
      this.swingT = Math.max(0, this.swingT - dt * Math.max(5, def.rate * 2.5));
      const k = 1 - this.swingT, e = Math.sin(k * Math.PI);
      if (def.mshape === 'spear' || def.mshape === 'fist') this.view.position.z -= e * (def.mshape === 'spear' ? 0.5 : 0.32);
      else {
        this.view.rotation.z = this.swingDir * (1 - k * 2) * 1.1;
        this.view.rotation.y = this.swingDir * (0.5 - k) * 1.2;
        this.view.rotation.x = -0.6 * e;
        this.view.position.x += -this.swingDir * (0.5 - k) * 0.3;
      }
    }
    if (this.gun.userData.teeth) this.gun.userData.teeth.position.y = Math.sin(performance.now() * 0.08) * 0.004;
    if (this.gun.userData.spin) this.gun.userData.spin.rotation.z += dt * s.spinT * 40;
    if (this.gun.userData.ring) this.gun.userData.ring.rotation.z += dt * 3;
    if (this.gun.userData.core) this.gun.userData.core.rotation.y += dt * 5;
  }

  // ───────────────────────── HUD ─────────────────────────
  toast(text, color) { this.hooks.onToast(text, color); }
  hitmark(crit, kill) { this.hooks.onHitmark(crit, kill); sfx('hit', { crit }); }
  dmgNum(p, dmg, crit) {
    const d = this.dmgPool[this.dmgIdx]; this.dmgIdx = (this.dmgIdx + 1) % this.dmgPool.length;
    d.p.copy(p); d.t = 0.7; d.el.textContent = dmg; d.el.className = 'dmgnum' + (crit ? ' crit' : '');
    d.ox = rand(-20, 20);
  }
  updateDmgNums(dt) {
    const w = innerWidth / 2, h = innerHeight / 2;
    for (const d of this.dmgPool) {
      if (d.t <= 0) { if (d.el.style.opacity !== '0') d.el.style.opacity = '0'; continue; }
      d.t -= dt; d.p.y += dt * 1.5;
      tmp.copy(d.p).project(this.camera);
      if (tmp.z > 1) { d.el.style.opacity = '0'; continue; }
      d.el.style.opacity = Math.min(1, d.t * 3);
      d.el.style.transform = `translate(${tmp.x * w + w + d.ox}px,${-tmp.y * h + h}px) scale(${0.7 + d.t * 0.6})`;
    }
  }
  drawMinimap() {
    const g = this.minimap, S = 170, c = S / 2, range = 50, sc = c / range;
    g.clearRect(0, 0, S, S);
    g.save(); g.beginPath(); g.arc(c, c, c - 1, 0, Math.PI * 2); g.clip();
    g.fillStyle = 'rgba(10,6,22,.72)'; g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(176,38,255,.25)'; g.beginPath(); g.arc(c, c, c * 0.5, 0, 7); g.stroke();
    const P = this.player.pos, cs = Math.cos(this.yaw), sn = Math.sin(this.yaw);
    const tr = (x, z) => { const dx = x - P.x, dz = z - P.z; return [c + (dx * cs - dz * sn) * sc, c + (dx * sn + dz * cs) * sc]; };
    g.fillStyle = 'rgba(120,90,180,.6)';
    for (const p of this.pillars) { const [x, y] = tr(p.x, p.z); g.beginPath(); g.arc(x, y, p.r * sc, 0, 7); g.fill(); }
    for (const e of this.enemies) {
      const [x, y] = tr(e.mesh.position.x, e.mesh.position.z);
      if (e.def.boss) { g.fillStyle = '#ff2244'; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); }
      else { g.fillStyle = e.fly ? '#5ee7ff' : e.def.ranged ? '#9dff3d' : e.def.explode ? '#ff8a2a' : '#ff4d6d'; g.fillRect(x - 1.5, y - 1.5, 3, 3); }
    }
    for (const p of this.pickups) { const [x, y] = tr(p.mesh.position.x, p.mesh.position.z); g.fillStyle = p.col; g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill(); }
    g.restore();
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(c, c - 7); g.lineTo(c - 5, c + 5); g.lineTo(c + 5, c + 5); g.fill();
  }

  updateHud(force) {
    const P = this.player, s = this.slots[this.cur];
    this.hooks.onHud({
      hp: P.hp, maxHp: P.maxHp, armor: P.armor, maxArmor: P.maxArmor,
      ammo: s.ammo, mag: s.def.mag, reload: s.reloadT > 0 ? 1 - s.reloadT / s.def.reload : -1,
      over: P.overT > 0 || this.stormT > 0, weapon: s.def,
      wskill: s.def.skill ? { ...s.def.skill, left: s.skillCd } : null, slots: this.slots.map((x) => x.def), cur: this.cur,
      kills: this.kills, total: this.total, remaining: this.total - this.spawned + this.enemies.length + (this.bossSpawned ? 0 : 1),
      cds: this.cds, cdMax: this.cdMax, combo: this.comboT > 0 ? this.combo : 0,
      boss: this.boss ? { name: this.boss.def.name, hp: this.boss.hp, max: this.boss.maxHp, enraged: this.boss.enraged } : null,
      stageLeft: Math.max(0, this.stageTime - this.time), collapsed: this.collapsed,
      spread: s.def.spread + this.chKick, melee: s.def.mode === 'melee', time: this.time, force,
    });
  }

  frame() {
    let dt = Math.min(0.05, this.clock.getDelta());
    if (this.stopT > 0 && this.running && !this.paused) { this.stopT -= dt; dt *= 0.06; }
    const t = performance.now() / 1000;
    this.sky.material.uniforms.t.value = t; this.portalMat.uniforms.t.value = t;
    this.barrierMat.uniforms.t.value = t; this.vortexMat.uniforms.t.value = t;
    // 떠오르는 불씨 (분위기용 파티클)
    if (!this.paused) {
      this.emberAcc = (this.emberAcc || 0) + dt * 40;
      const cx = this.running ? this.player.pos.x : 0, cz = this.running ? this.player.pos.z : 0;
      while (this.emberAcc >= 1) {
        this.emberAcc -= 1;
        tmp.set(cx + rand(-30, 30), rand(0, 2), cz + rand(-30, 30));
        tmp2.set(rand(-0.3, 0.3), rand(0.8, 2.2), rand(-0.3, 0.3));
        this.particle(tmp, tmp2, Math.random() < 0.6 ? EMBER_A : EMBER_B, rand(0.08, 0.16), rand(2.5, 4.5), -0.15);
      }
    }
    if (this.worldT) this.worldT.value = t;
    this.sigil.rotation.z = t * 0.05; this.vortex.rotation.z = t * 0.02;
    for (const sp of this.spires) { if (sp.orb) sp.m.position.y = sp.base + Math.sin(t * 1.5 + sp.k) * 0.8; else sp.m.position.y = sp.base + Math.sin(t * 2 + sp.k) * 0.6; }
    for (const il of this.islands) { il.grp.position.y = il.y + Math.sin(t * 0.3 + il.ph) * 2; il.grp.rotation.y = t * 0.02 + il.ph; }
    if (this.running && !this.paused) {
      this.time += dt;
      this.updatePlayer(dt);
      this.updateWeapon(dt);
      this.spawnTick(dt);
      this.updateEnemies(dt);
      this.updateProjs(dt);
      this.updateEnemyProjs(dt);
      this.updatePickups(dt);
      this.updateTimers(dt);
      this.updateFx(dt);
      this.updateParticles(dt);
      this.updateDmgNums(dt);
      if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; }
      this.hudT = (this.hudT || 0) - dt;
      if (this.hudT <= 0) { this.hudT = 0.05; this.updateHud(); this.drawMinimap(); }
      if (this.running && this.bossDead && this.enemies.length === 0 && this.spawned >= this.total) {
        // 남은 드랍은 자동 회수
        for (const p of this.pickups) { if (p.kind === 'weapon') { this.loot.push(p.def); this.hooks.onLoot(p.def); } this.scene.remove(p.mesh); }
        this.pickups = [];
        this.end('clear');
      }
    } else if (!this.running) {
      // 메뉴 배경: 천천히 회전하는 카메라
      this.camera.position.set(Math.cos(t * 0.04) * 48, 7 + Math.sin(t * 0.1) * 2, Math.sin(t * 0.04) * 48);
      this.camera.lookAt(0, 16, 0);
      this.updateFx(dt); this.updateParticles(dt);
    }
    this.composer.render();
  }
}
