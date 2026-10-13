/**
 * UiScreen.fitToViewport measures with `.uh-measuring` (transforms dropped). The production CSS
 * minifier folds `rotate` / `scale` / `translate` that share a rule with `transform` into one
 * `transform` shorthand, so in a shipped build rotated stamps and stickers kept their rotation
 * while measuring and results-like screens shrank to the 0.5 floor. Keep them in their own rule.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = fs.readFileSync(path.resolve(__dirname, '../../src/ui/styles/base.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('shrink-to-fit measuring CSS', () => {
  const rules = [...CSS.matchAll(/([^{}]*\.uh-measuring[^{}]*)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));

  it('resets the individual transform properties', () => {
    for (const p of ['rotate', 'scale', 'translate', 'transform']) {
      expect(rules.some((r) => new RegExp(`(^|;|\\s)${p}\\s*:\\s*none\\s*!important`).test(r.body)), p).toBe(true);
    }
  });

  it('never puts them in the same rule as `transform` (the minifier would merge them)', () => {
    for (const r of rules) {
      const hasTransform = /(^|;|\s)transform\s*:/.test(r.body);
      const hasIndividual = /(^|;|\s)(rotate|scale|translate)\s*:/.test(r.body);
      expect(hasTransform && hasIndividual, r.sel).toBe(false);
    }
  });
});
