/**
 * Tutorial (autotest driver), rival tournament persistence, settings persistence and the
 * live language switch.
 */
import { expect, test } from '@playwright/test';
import { FAST, boot, expectNoErrors, navTo, press, shot, uproot, waitState, watchConsole } from './helpers';

test('tutorial completes under the autotest driver and offers the first match', async ({ page }) => {
  const problems = watchConsole(page);
  await boot(page, `fresh=1&${FAST}&flow=tutorial&speed=3`);
  await waitState(page, 'match', 120_000);
  await expect(page.locator('.uh-tut')).toBeVisible();
  await expect(page.locator('.uh-sb--practice')).toBeVisible();
  await page.waitForTimeout(1500);
  await shot(page, '10-tutorial-start');
  // beats advance on real events: the bank beat comes after the first +100
  await page.waitForFunction(() => {
    const u = (window as unknown as { __uproot: { state(): { tutorialBeat: string | null } } }).__uproot;
    return ['bankGrab', 'uproot', 'fence', 'bankRecover', 'done'].includes(u.state().tutorialBeat ?? '');
  }, null, { timeout: 4 * 60_000 });
  await shot(page, '11-tutorial-bank');
  await waitState(page, 'tutorialOffer', 6 * 60_000);
  expect(await uproot<boolean>(page, 'u.state().tutorialDone')).toBe(true);
  const scores = await uproot<number[]>(page, 'u.sim.state.scores');
  expect(scores[0]).toBe(1100); // +100 small safe, then the whole bank (500 + 500)
  await expect(page.locator('.uh-screen--dialog')).toBeVisible();
  await page.waitForTimeout(800);
  await shot(page, '12-tutorial-offer');
  // confirm -> first match vs the novice bot on the plaza
  await press(page, 'Enter');
  await waitState(page, ['loading', 'preview', 'match'], 60_000);
  await waitState(page, 'match', 120_000);
  const cfg = await uproot<{ kind: string; layoutId: string; rival: string; difficulty: string; mode: string }>(page, 'u.state().config');
  expect(cfg).toMatchObject({ kind: 'quick', layoutId: 'plaza', rival: 'hodadak', difficulty: 'novice', mode: '1v1' });
  // practice score does not carry over
  expect(await uproot<number[]>(page, 'u.sim.state.scores')).toEqual([0, 0]);
  expectNoErrors(problems);
});

test('tournament progress persists after reload', async ({ page }) => {
  const problems = watchConsole(page);
  await boot(page, `${FAST}&skipIntro=1&speed=4&matchSeconds=20`);
  await page.evaluate(() => localStorage.clear());
  await boot(page, `${FAST}&flow=tournament&speed=4&matchSeconds=20`);
  await waitState(page, 'tournament');
  await expect(page.locator('.uh-screen--tournament')).toBeVisible();
  await page.waitForTimeout(1000);
  await shot(page, '20-tournament');
  await press(page, 'Enter'); // 호다닥 is focused
  await waitState(page, ['preview', 'match'], 120_000);
  await waitState(page, 'match', 120_000);
  const cfg = await uproot<{ kind: string; layoutId: string; rival: string; adaptation: unknown }>(page, 'u.state().config');
  expect(cfg).toMatchObject({ kind: 'tournament', layoutId: 'plaza', rival: 'hodadak', adaptation: null });
  await waitState(page, 'results', 6 * 60_000);
  const rec = await uproot<{ outcome: string; gameNumber: number; seriesState: string }>(page, 'u.state().record');
  expect(rec.gameNumber).toBe(1);
  await expect(page.locator('.uh-screen--results')).toBeVisible();
  await page.waitForTimeout(1500);
  await shot(page, '21-tournament-results');
  const before = await uproot<{ series: { gameIndex: number; wins: number; losses: number; draws: number } | null; beaten: string[] }>(page, 'u.save().tournament');
  expect(before.series?.gameIndex).toBe(1);

  // Reload: the series in progress is still there (written after every game)
  await boot(page, `${FAST}&flow=tournament`);
  await waitState(page, 'tournament');
  const after = await uproot<typeof before>(page, 'u.save().tournament');
  expect(after).toEqual(before);
  await expect(page.locator('.uh-tourcard--inProgress, .uh-tourcard--cleared').first()).toBeVisible();
  await shot(page, '22-tournament-reloaded');

  // Resume -> intermission is skipped on resume; the next game starts with the saved adaptation
  await press(page, 'Enter');
  await waitState(page, ['preview', 'match'], 120_000);
  const cfg2 = await uproot<{ kind: string; rival: string }>(page, 'u.state().config');
  expect(cfg2).toMatchObject({ kind: 'tournament', rival: 'hodadak' });

  // A started series game can't be thrown away: no restart, and leaving forfeits it (saved).
  await waitState(page, 'match', 120_000);
  await page.waitForFunction(() => {
    const u = (window as unknown as { __uproot: { state(): { match: { tick: number } | null } } }).__uproot;
    return (u.state().match?.tick ?? 0) > 60;
  }, null, { timeout: 120_000 });
  await press(page, 'Escape');
  await waitState(page, 'paused', 60_000);
  await expect(page.locator('[data-nav="pause:restart"]')).toHaveCount(0);
  await navTo(page, 'pause:menu');
  await press(page, 'Enter');
  await expect(page.locator('.uh-screen--dialog')).toContainText('패배로 기록', { timeout: 30_000 });
  await page.waitForTimeout(600);
  await shot(page, '23-tournament-forfeit-confirm');
  await navTo(page, 'dlg:confirm', 'ArrowRight');
  await press(page, 'Enter');
  await waitState(page, 'tournament', 60_000);
  const forfeited = await uproot<typeof before>(page, 'u.save().tournament');
  if ((before.series?.losses ?? 0) >= 1) {
    expect(forfeited.series).toBeNull(); // second loss: series lost, retry that rival only
  } else {
    expect(forfeited.series?.gameIndex).toBe(2);
    expect(forfeited.series?.losses).toBe((before.series?.losses ?? 0) + 1);
  }
  await shot(page, '24-tournament-after-forfeit');
  expectNoErrors(problems);
});

test('settings persist and the language switch updates visible text', async ({ page }) => {
  const problems = watchConsole(page);
  await boot(page, `${FAST}&skipIntro=1`);
  await page.evaluate(() => localStorage.clear());
  await boot(page, `${FAST}&skipIntro=1`);
  await waitState(page, 'menu');
  await expect(page.locator('.uh-screen--menu')).toContainText('빠른 대전');
  await navTo(page, 'menu:settings');
  await press(page, 'Enter');
  await waitState(page, 'settings');
  await expect(page.locator('.uh-screen--settings')).toContainText('설정');
  await page.waitForTimeout(600);
  await shot(page, '30-settings-ko');
  // Language row is focused first: → switches to English, live
  await press(page, 'ArrowRight');
  await expect(page.locator('.uh-screen--settings')).toContainText('Settings', { timeout: 30_000 });
  await page.waitForTimeout(600);
  await shot(page, '31-settings-en');
  // Audio tab (E twice: Game -> Controls -> Audio): master volume down one step
  const master0 = await uproot<number>(page, 'u.save().settings.volumes.master');
  await press(page, 'KeyE');
  await page.waitForFunction(() => !!document.querySelector('.uh-screen--settings [data-nav^="bind:"]'), null, { timeout: 30_000 });
  await press(page, 'KeyE');
  await page.waitForFunction(() => !!document.querySelector('.uh-screen--settings [data-nav="set:master"]'), null, { timeout: 30_000 });
  await navTo(page, 'set:master');
  await press(page, 'ArrowLeft');
  await page.waitForFunction((m) => {
    const u = (window as unknown as { __uproot: { save(): { settings: { volumes: { master: number } } } } }).__uproot;
    return u.save().settings.volumes.master < m;
  }, master0, { timeout: 30_000 });
  const master1 = await uproot<number>(page, 'u.save().settings.volumes.master');
  await shot(page, '31b-settings-audio');
  // Back to the menu: English there too
  await press(page, 'Escape');
  await waitState(page, 'menu');
  await expect(page.locator('.uh-screen--menu')).toContainText('Quick Match');
  await shot(page, '32-menu-en');
  expect(await uproot<string>(page, 'u.save().settings.language')).toBe('en');

  // Reload: still English (persisted)
  await boot(page, `autotest=1&quality=low&render=12&skipIntro=1`);
  await waitState(page, 'menu');
  await expect(page.locator('.uh-screen--menu')).toContainText('Quick Match');
  expect(await uproot<string>(page, 'u.save().settings.language')).toBe('en');
  expect(await uproot<number>(page, 'u.save().settings.volumes.master')).toBe(master1);
  expectNoErrors(problems);
});
