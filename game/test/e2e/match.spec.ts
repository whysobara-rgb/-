/**
 * Boot -> title -> keyboard menu navigation -> quick match (autotest bot in the human slot,
 * sped up) -> HUD + sim advancing -> pause / resume -> match end -> results with the biggest
 * event card -> one-press rematch. Zero console errors throughout.
 */
import { expect, test } from '@playwright/test';
import { FAST, appState, boot, expectNoErrors, focused, navTo, press, shot, uproot, waitState, watchConsole } from './helpers';

test('quick match: title -> menu -> setup -> match -> pause -> results -> rematch', async ({ page }) => {
  const problems = watchConsole(page);
  await boot(page, `fresh=1&${FAST}&speed=4&matchSeconds=40`);
  await waitState(page, 'title');
  await expect(page.locator('.uh-screen--title')).toBeVisible();
  await page.waitForTimeout(1500);
  await shot(page, '01-title');

  // Title -> main menu (any key)
  await press(page, 'Enter');
  await waitState(page, 'menu');
  await expect(page.locator('.uh-screen--menu')).toBeVisible();
  // fresh save: practice is suggested first; move down to 빠른 대전 with the keyboard
  expect(await focused(page)).toBe('menu:practice');
  await navTo(page, 'menu:quickMatch');
  await page.waitForTimeout(400);
  await shot(page, '02-menu');
  await press(page, 'Enter');
  await waitState(page, 'quickSetup');
  await expect(page.locator('.uh-screen--quick')).toBeVisible();
  await page.waitForTimeout(800);
  await shot(page, '03-quick-setup');

  // Start (focused by default) -> layout preview -> in-world countdown -> match
  await press(page, 'Enter');
  await waitState(page, ['preview', 'match'], 120_000);
  await waitState(page, 'match', 120_000);
  await expect(page.locator('.uh-hud')).toBeVisible();
  await page.waitForFunction(() => {
    const u = (window as unknown as { __uproot: { state(): { match: { tick: number } | null } } }).__uproot;
    return (u.state().match?.tick ?? 0) > 120;
  }, null, { timeout: 120_000 });
  const t1 = await uproot<number>(page, 'u.state().match.tick');
  await page.waitForTimeout(1500);
  const t2 = await uproot<number>(page, 'u.state().match.tick');
  expect(t2).toBeGreaterThan(t1);
  await expect(page.locator('.uh-timer')).toBeVisible();
  await expect(page.locator('.uh-sb__score').first()).toBeVisible();
  await expect(page.locator('.uh-banks')).toBeVisible();
  await shot(page, '04-match-hud');

  // Pause / resume (Esc)
  await press(page, 'Escape');
  await waitState(page, 'paused', 60_000);
  await expect(page.locator('.uh-screen--pause')).toBeVisible();
  const pausedTick = await uproot<number>(page, 'u.state().match.tick');
  await page.waitForTimeout(1500);
  expect(await uproot<number>(page, 'u.state().match.tick')).toBe(pausedTick);
  await shot(page, '05-pause');
  // Esc on the pause menu's own confirm dialog closes the dialog only (back semantics): the
  // match stays paused on the pause menu.
  await navTo(page, 'pause:restart');
  await press(page, 'Enter');
  await expect(page.locator('.uh-screen--dialog')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(600);
  await shot(page, '05b-pause-restart-confirm');
  await press(page, 'Escape');
  await expect(page.locator('.uh-screen--dialog')).toHaveCount(0, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  expect(await appState(page)).toBe('paused');
  expect(await uproot<number>(page, 'u.state().match.tick')).toBe(pausedTick);
  await expect(page.locator('.uh-screen--pause')).toBeVisible();
  await press(page, 'Escape');
  await waitState(page, 'match', 60_000);
  await page.waitForFunction((t) => {
    const u = (window as unknown as { __uproot: { state(): { match: { tick: number } | null } } }).__uproot;
    return (u.state().match?.tick ?? 0) > t;
  }, pausedTick, { timeout: 60_000 });

  // Match plays out to the results screen
  await waitState(page, 'results', 6 * 60_000);
  await expect(page.locator('.uh-screen--results')).toBeVisible();
  const summary = await uproot<{ outcome: string; result: { scores: number[] }; biggest: { key: string } | null }>(page, 'u.state().summary');
  expect(['win', 'lose', 'draw']).toContain(summary.outcome);
  if (summary.result.scores[0]! + summary.result.scores[1]! > 0) {
    expect(summary.biggest).not.toBeNull();
    await expect(page.locator('.uh-screen--results')).toContainText(/회수|빠짐|펜스/);
  }
  await page.waitForTimeout(2500);
  await shot(page, '06-results');

  // One press: rematch (focused by default) starts a new match
  await press(page, 'Enter');
  await waitState(page, ['loading', 'match'], 60_000);
  await waitState(page, 'match', 120_000);
  expect(await uproot<number>(page, 'u.state().match.tick')).toBeLessThan(600);
  await page.waitForTimeout(1000);
  await shot(page, '07-rematch');
  expect(await appState(page)).toBe('match');
  expect(await uproot<number>(page, 'u.errors()')).toBe(0);
  expectNoErrors(problems);
});
