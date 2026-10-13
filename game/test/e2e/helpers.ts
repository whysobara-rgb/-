/**
 * Shared helpers for the browser smoke tests.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';

export const SHOTS = process.env.E2E_SHOTS ?? path.join('test-results', 'shots');
mkdirSync(SHOTS, { recursive: true });

/** Fast, software-GL friendly test hooks. */
export const FAST = 'autotest=1&quality=low&render=12&lang=ko';

export interface Problems {
  errors: string[];
}

/** Collect console errors and uncaught page errors (the game must log none). */
export function watchConsole(page: Page): Problems {
  const p: Problems = { errors: [] };
  page.on('console', (m) => {
    if (m.type() === 'error') p.errors.push(`[console.error] ${m.text()}`);
  });
  page.on('pageerror', (e) => p.errors.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));
  return p;
}

export async function boot(page: Page, query: string): Promise<void> {
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => document.documentElement.dataset.booted === '1', null, { timeout: 120_000 });
}

export async function appState(page: Page): Promise<string> {
  return page.evaluate(() => document.documentElement.dataset.appState ?? 'boot');
}

export async function waitState(page: Page, state: string | string[], timeout = 120_000): Promise<void> {
  const want = Array.isArray(state) ? state : [state];
  await page.waitForFunction((w) => w.includes(document.documentElement.dataset.appState ?? ''), want, { timeout, polling: 250 });
}

export async function uproot<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(() => { const u = window.__uproot; return ${fn}; })()`) as Promise<T>;
}

/** Press a key with a short hold so a slow (software-GL) frame still sees it. */
export async function press(page: Page, key: string, holdMs = 60): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(holdMs);
  await page.keyboard.up(key);
  await page.waitForTimeout(150);
}

export async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

export function expectNoErrors(p: Problems): void {
  expect(p.errors, p.errors.join('\n\n')).toEqual([]);
}

/** Currently focused nav item (virtual focus: `.is-focused[data-nav]`) of the top screen. */
export async function focused(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('.uh-screen:not([hidden]) .is-focused[data-nav]'));
    return els.length ? els[els.length - 1]!.dataset.nav ?? null : null;
  });
}

/**
 * Move the virtual focus with the keyboard until `id` is focused. Waits for every step to land
 * (a software-GL frame can take a second; two presses inside one frame would merge).
 */
export async function navTo(page: Page, id: string, key = 'ArrowDown', maxSteps = 12): Promise<void> {
  for (let i = 0; i < maxSteps; i++) {
    const cur = await focused(page);
    if (cur === id) return;
    await press(page, key);
    await page.waitForFunction((prev) => {
      const els = Array.from(document.querySelectorAll<HTMLElement>('.uh-screen:not([hidden]) .is-focused[data-nav]'));
      const now = els.length ? els[els.length - 1]!.dataset.nav ?? null : null;
      return now !== prev;
    }, cur, { timeout: 20_000 });
  }
  expect(await focused(page)).toBe(id);
}
