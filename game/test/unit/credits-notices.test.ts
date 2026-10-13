/**
 * Credits → Licenses: the in-game view parses LICENSES/THIRD_PARTY_NOTICES.txt (written by
 * tools/steam-assets/notices.mjs). A format change on either side must not silently empty it.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseNotices } from '../../src/ui/screens/CreditsScreen';

const ROOT = path.resolve(__dirname, '../..');
const NOTICES = fs.readFileSync(path.join(ROOT, 'LICENSES/THIRD_PARTY_NOTICES.txt'), 'utf8');

describe('third-party notices', () => {
  const parsed = parseNotices(NOTICES);

  it('lists every shipped component with its license and full text', () => {
    const names = parsed.sections.map((s) => s.name);
    for (const want of ['three.js', 'steamworks.js', 'Electron', 'Jua', 'Noto Sans KR']) {
      expect(names.some((n) => n.startsWith(want)), `${want} in ${names.join(', ')}`).toBe(true);
    }
    expect(names.some((n) => /Rust crates/.test(n))).toBe(true);
    for (const s of parsed.sections) {
      expect(s.license, s.name).not.toBe('');
      expect(s.website, s.name).toMatch(/^https:\/\//);
      expect(s.usedFor, s.name).not.toBe('');
      expect(s.blocks.length, s.name).toBeGreaterThan(0);
      const body = s.blocks.join('\n');
      expect(body, s.name).toMatch(/Permission is hereby granted|SIL OPEN FONT LICENSE/);
    }
    expect(parsed.intro).toMatch(/THIRD-PARTY SOFTWARE NOTICES/);
  });

  it('keeps the full text: no line is lost when splitting into navigable blocks', () => {
    for (const s of parsed.sections) {
      const lines = s.blocks.join('\n').split('\n').filter((l) => l.trim() !== '');
      for (const b of s.blocks) expect(b.split('\n').length, s.name).toBeLessThanOrEqual(16);
      const start = NOTICES.indexOf(s.name);
      const end = NOTICES.indexOf('='.repeat(78), start);
      const sourceLines = NOTICES.slice(NOTICES.indexOf('-'.repeat(78), start) + 79, end)
        .split('\n')
        .filter((l) => l.trim() !== '');
      expect(lines, s.name).toEqual(sourceLines.map((l) => l.replace(/\r$/, '')));
    }
  });

  it('carries the fonts’ own copyright statements', () => {
    const jua = parsed.sections.find((s) => s.name.startsWith('Jua'))!;
    const noto = parsed.sections.find((s) => s.name.startsWith('Noto Sans KR'))!;
    expect(jua.blocks[0]).toMatch(/^Copyright \d{4}/);
    expect(noto.blocks[0]).toMatch(/^Copyright 2014-2021 Adobe/);
  });

  it('is up to date with node_modules (tools/steam-assets/notices.mjs --check)', () => {
    expect(() => execFileSync(process.execPath, [path.join(ROOT, 'tools/steam-assets/notices.mjs'), '--check'], { stdio: 'pipe' })).not.toThrow();
  });
});
