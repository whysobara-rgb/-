/**
 * Built-in "뽑았다!" callout: a hand-lettered sticker banner (star burst, white sticker rim,
 * ink outline, gold lettering) that slams in above an object the moment it is pulled out of
 * the ground, wobbles, then floats up and pops away. Scaled by size (small safe < large safe <
 * bank). The HUD can show its own callout from GameView.takeCallouts() instead and turn this
 * one off with ViewSettings.builtinCallouts = false.
 */
import * as THREE from 'three';
import type { LootKind } from '../sim';
import { FONT_STACK, makeCanvasTexture } from './models/textures';

const TEXT = { ko: '뽑았다!', en: 'UPROOTED!' } as const;
const INK = '#2A2131';
const LIFE = 1.45;

interface Banner {
  sprite: THREE.Sprite;
  age: number;
  size: number;
  x: number;
  y: number;
  z: number;
  spin: number;
}

function drawBanner(ctx: CanvasRenderingContext2D, w: number, h: number, text: string): void {
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2 + 6;
  // Star burst behind the lettering.
  const spikes = 14;
  const burst = (r0: number, r1: number): void => {
    ctx.beginPath();
    for (let i = 0; i <= spikes * 2; i++) {
      const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? r0 : r1;
      const x = cx + Math.cos(a) * r * 1.75;
      const y = cy + Math.sin(a) * r * 0.82;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };
  ctx.lineJoin = 'round';
  burst(78, 118);
  ctx.lineWidth = 18;
  ctx.strokeStyle = '#FFFFFF';
  ctx.stroke();
  ctx.lineWidth = 8;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = '#FF7A3D';
  ctx.fill();
  burst(64, 98);
  ctx.fillStyle = '#FFB13D';
  ctx.fill();
  // Speed ticks.
  ctx.strokeStyle = '#FFF3C4';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  for (const [x0, y0, x1, y1] of [
    [cx - 200, cy - 60, cx - 170, cy - 44],
    [cx + 200, cy - 60, cx + 170, cy - 44],
    [cx - 210, cy + 50, cx - 180, cy + 40],
    [cx + 210, cy + 50, cx + 180, cy + 40],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  // Lettering: slight upward slant, thick sticker rim, ink, gold gradient, gloss.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.06);
  const size = text.length > 6 ? 70 : 92;
  ctx.font = `bold ${size}px ${FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 30;
  ctx.strokeStyle = '#FFFFFF';
  ctx.strokeText(text, 0, 4);
  ctx.lineWidth = 16;
  ctx.strokeStyle = INK;
  ctx.strokeText(text, 0, 4);
  // Drop layer.
  ctx.fillStyle = '#B8471E';
  ctx.fillText(text, 0, 10);
  const g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
  g.addColorStop(0, '#FFF6B0');
  g.addColorStop(0.45, '#FFD23F');
  g.addColorStop(1, '#FF9F1C');
  ctx.fillStyle = g;
  ctx.fillText(text, 0, 4);
  ctx.restore();
}

export class UprootBanners {
  readonly root = new THREE.Group();
  private readonly list: Banner[] = [];
  private readonly textures = new Map<string, THREE.Texture>();
  private readonly mats: THREE.SpriteMaterial[] = [];
  /** Drop the wobble (reduced motion keeps the pop). */
  calm = false;

  constructor() {
    this.root.name = 'uprootBanners';
  }

  private texture(lang: 'ko' | 'en'): THREE.Texture {
    let t = this.textures.get(lang);
    if (!t) {
      const text = TEXT[lang];
      t = makeCanvasTexture(512, 256, (ctx, w, h) => drawBanner(ctx, w, h, text), { fontText: text, mipmaps: false });
      this.textures.set(lang, t);
    }
    return t;
  }

  /** Pop a banner above a world point (three coords; y = top of the object). */
  show(x: number, y: number, z: number, kind: LootKind, lang: 'ko' | 'en'): void {
    if (this.list.length >= 4) {
      const old = this.list.shift()!;
      old.sprite.removeFromParent();
    }
    const mat = new THREE.SpriteMaterial({ map: this.texture(lang), transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    this.mats.push(mat);
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 30;
    sprite.userData.noOutline = true;
    sprite.raycast = () => {};
    this.root.add(sprite);
    const size = kind === 'bank' ? 5.2 : kind === 'largeSafe' ? 3.2 : 2.5;
    this.list.push({ sprite, age: 0, size, x, y, z, spin: Math.random() < 0.5 ? -1 : 1 });
  }

  update(dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i]!;
      b.age += dt;
      const t = b.age;
      if (t >= LIFE) {
        b.sprite.removeFromParent();
        const m = b.sprite.material;
        const k = this.mats.indexOf(m);
        if (k >= 0) this.mats.splice(k, 1);
        m.dispose();
        this.list.splice(i, 1);
        continue;
      }
      // Slam in (overshoot), settle, then float up and pop away.
      let s: number;
      if (t < 0.16) {
        const k = t / 0.16;
        s = 0.2 + 1.15 * (1 - Math.pow(1 - k, 3));
      } else if (t < 0.3) s = 1.35 - 0.35 * ((t - 0.16) / 0.14);
      else s = 1 + (this.calm ? 0 : 0.03 * Math.sin(t * 12));
      let alpha = 1;
      let rise = t > 0.3 ? (t - 0.3) * 0.5 : 0;
      if (t > LIFE - 0.25) {
        const k = (LIFE - t) / 0.25;
        s *= 0.6 + 0.4 * k + (1 - k) * 0.25;
        alpha = k;
        rise += (1 - k) * 0.5;
      }
      const mat = b.sprite.material;
      mat.opacity = alpha;
      mat.rotation = this.calm ? 0 : b.spin * (t < 0.3 ? 0.18 * (1 - t / 0.3) : 0.03 * Math.sin(t * 7));
      b.sprite.scale.set(b.size * s, b.size * 0.5 * s, 1);
      b.sprite.position.set(b.x, b.y + rise, b.z);
    }
  }

  get count(): number {
    return this.list.length;
  }

  clear(): void {
    for (const b of this.list) {
      b.sprite.removeFromParent();
      b.sprite.material.dispose();
    }
    this.list.length = 0;
    this.mats.length = 0;
  }

  dispose(): void {
    this.clear();
    for (const t of this.textures.values()) t.dispose();
    this.textures.clear();
    this.root.removeFromParent();
  }
}
