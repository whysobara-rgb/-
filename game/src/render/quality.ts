/**
 * Render quality presets (ViewSettings.quality).
 *
 *  - high:   target 60 fps at 1080p on a mid-range discrete GPU. 4096 shadow map, MSAA,
 *            pixel ratio up to 2, full particles and decor.
 *  - medium: 2048 shadow map, MSAA, pixel ratio up to 1.25, most particles/decor.
 *  - low:    usable on integrated GPUs. No shadow maps (the models' soft blob shadows stay),
 *            no MSAA, pixel ratio 1, half particles, ~half of the purely decorative props,
 *            no post-processing, simple shop fronts.
 *  Post (medium/high): bloom on emissives, warm grade, vignette, impact frames (post.ts).
 *
 * Everything here is data; GameView applies it (applySettings works live — toggling MSAA
 * recreates the WebGL renderer, a decor density change rebuilds the merged scenery).
 */
export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualityPreset {
  readonly level: QualityLevel;
  /** WebGL MSAA (renderer must be recreated to change it). */
  readonly antialias: boolean;
  /** Upper bound for devicePixelRatio. */
  readonly maxPixelRatio: number;
  /** Shadow maps on/off. */
  readonly shadows: boolean;
  /** Shadow map size (power of two). */
  readonly shadowMapSize: number;
  /** Half extent (m) of the sun's orthographic shadow frustum around the camera target. */
  readonly shadowRadius: number;
  /** Multiplier for every particle count (0..1). */
  readonly particles: number;
  /** Fraction of visual-only decor kept (1 = all). Never touches anything with collision. */
  readonly decorDensity: number;
  /** Footstep puffs (tiny dust under running feet). */
  readonly footsteps: boolean;
  /** Bank dust trails / safe drag dust. */
  readonly dragDust: boolean;
  /** Character blob shadows even when shadow maps are on (contact grounding). */
  readonly blobShadows: boolean;
  /** Post-processing composer (bloom + grade + impact frames). Off = direct canvas render. */
  readonly post: boolean;
  /** MSAA samples of the post scene target (the canvas MSAA is unused while post is on). */
  readonly msaaSamples: number;
  /** Bloom strength and resolution (fraction of the canvas). */
  readonly bloomStrength: number;
  readonly bloomScale: number;
  /** Chromatic aberration flashes on impacts. */
  readonly chroma: boolean;
  /** Ground overlay texture resolution (px per meter): paths, lanes, manholes, wear. */
  readonly groundDetail: number;
  /** Shop window dioramas + window silhouettes (merged scenery detail). */
  readonly shopInteriors: boolean;
}

export const QUALITY_PRESETS: Readonly<Record<QualityLevel, QualityPreset>> = {
  low: {
    level: 'low',
    antialias: false,
    maxPixelRatio: 1,
    shadows: false,
    shadowMapSize: 1024,
    shadowRadius: 26,
    particles: 0.5,
    decorDensity: 0.5,
    footsteps: false,
    dragDust: true,
    blobShadows: true,
    post: false,
    msaaSamples: 0,
    bloomStrength: 0,
    bloomScale: 0.25,
    chroma: false,
    groundDetail: 12,
    shopInteriors: false,
  },
  medium: {
    level: 'medium',
    antialias: true,
    maxPixelRatio: 1.25,
    shadows: true,
    shadowMapSize: 2048,
    shadowRadius: 28,
    particles: 0.8,
    decorDensity: 0.85,
    footsteps: true,
    dragDust: true,
    blobShadows: true,
    post: true,
    msaaSamples: 4,
    bloomStrength: 0.55,
    bloomScale: 0.25,
    chroma: false,
    groundDetail: 18,
    shopInteriors: true,
  },
  high: {
    level: 'high',
    antialias: true,
    maxPixelRatio: 2,
    shadows: true,
    shadowMapSize: 4096,
    shadowRadius: 30,
    particles: 1,
    decorDensity: 1,
    footsteps: true,
    dragDust: true,
    blobShadows: true,
    post: true,
    msaaSamples: 4,
    bloomStrength: 0.6,
    bloomScale: 0.5,
    chroma: true,
    groundDetail: 24,
    shopInteriors: true,
  },
};

export function qualityPreset(level: QualityLevel | string | undefined): QualityPreset {
  return QUALITY_PRESETS[(level as QualityLevel) in QUALITY_PRESETS ? (level as QualityLevel) : 'high'];
}

/** Integer particle count scaled by the preset (at least `min` when base > 0). */
export function scaledCount(base: number, preset: QualityPreset, min = 1): number {
  if (base <= 0) return 0;
  return Math.max(min, Math.round(base * preset.particles));
}
