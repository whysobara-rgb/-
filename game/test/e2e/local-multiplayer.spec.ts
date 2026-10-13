/**
 * 같이 하기 (local multiplayer): two keyboard players and a stubbed gamepad join from the main
 * menu entry, pick teams, ready up, start a 2:2 versus match, and both humans move independently
 * (keyboard A right, keyboard B left) under one shared camera. Results show the per-player panel.
 */
import { expect, test, type Page } from '@playwright/test';
import { FAST, boot, expectNoErrors, shot, uproot, waitState, watchConsole } from './helpers';

interface LobbyPlayer {
  device: string;
  index: number;
  team: number;
  ready: boolean;
}

const lobby = (page: Page) => uproot<{ players: LobbyPlayer[] }>(page, 'u.app.lobbyState');

/** Key tap held long enough for a slow software-GL frame. */
async function tap(page: Page, key: string, holdMs = 120): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(holdMs);
  await page.keyboard.up(key);
  await page.waitForTimeout(250);
}

/** Pads are sampled, not evented: hold the button until the lobby saw it. */
async function padTap(page: Page, button: number, until: (p: { players: LobbyPlayer[] }) => boolean): Promise<void> {
  await page.evaluate((b) => (window as unknown as { __padPress(i: number, b: number, d: boolean): void }).__padPress(0, b, true), button);
  await expect.poll(async () => until(await lobby(page)), { timeout: 60_000, intervals: [200] }).toBe(true);
  await page.evaluate((b) => (window as unknown as { __padPress(i: number, b: number, d: boolean): void }).__padPress(0, b, false), button);
  await page.waitForTimeout(400);
}

test('two keyboards (+ a pad) join, start a 2:2 versus match and move independently', async ({ page }) => {
  const problems = watchConsole(page);
  // One standard gamepad at index 0 that the test can press.
  await page.addInitScript(() => {
    const pad = {
      index: 0,
      id: 'Test Pad (STANDARD GAMEPAD Vendor: 045e Product: 028e)',
      connected: true,
      mapping: 'standard',
      timestamp: 0,
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
      axes: [0, 0, 0, 0],
      vibrationActuator: null,
    };
    const w = window as unknown as { __padPress(i: number, b: number, d: boolean): void };
    w.__padPress = (_i, b, d) => {
      pad.buttons[b] = { pressed: d, touched: d, value: d ? 1 : 0 };
      pad.timestamp++;
    };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad, null, null, null], configurable: true });
  });
  await boot(page, `${FAST}&skipIntro=1&matchSeconds=45`);
  await waitState(page, 'menu');

  // Main menu entry (mouse click on the quiet list item).
  const entry = page.locator('[data-nav="menu:together"]');
  await expect(entry).toBeVisible();
  await entry.click();
  await waitState(page, 'together');
  await expect(page.locator('.uh-screen--together')).toBeVisible();
  await page.waitForTimeout(800);

  // P1: keyboard left (Space), P2: keyboard right ('.'), balanced onto the moon team.
  await tap(page, 'Space');
  await tap(page, 'Period');
  await expect.poll(async () => (await lobby(page)).players.map((p) => [p.device, p.index, p.team]), { timeout: 60_000 }).toEqual([
    ['kbA', 0, 0],
    ['kbB', 1, 1],
  ]);
  // A pad joins (A) as P3 on the star team, then leaves again (B).
  await padTap(page, 0, (l) => l.players.some((p) => p.device === 'pad:0'));
  const p3 = (await lobby(page)).players.find((p) => p.device === 'pad:0');
  expect(p3).toMatchObject({ index: 2, team: 0, ready: false });
  await expect(page.locator('.uh-together__card[data-player="3"]')).toBeVisible();
  await shot(page, 'local-01-join-3');
  await padTap(page, 1, (l) => !l.players.some((p) => p.device === 'pad:0'));

  // Team switch for P2 and back, then everybody ready -> match options.
  await tap(page, 'ArrowLeft');
  await expect.poll(async () => (await lobby(page)).players.find((p) => p.device === 'kbB')?.team, { timeout: 60_000 }).toBe(0);
  await tap(page, 'ArrowRight');
  await expect.poll(async () => (await lobby(page)).players.find((p) => p.device === 'kbB')?.team, { timeout: 60_000 }).toBe(1);
  await tap(page, 'Space');
  await tap(page, 'Period');
  await expect(page.locator('.uh-together.is-options')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-nav="together:start"]')).toBeVisible();
  await shot(page, 'local-02-options');

  // Start (P1 confirms the focused 털러 가자!), skip the layout preview.
  await tap(page, 'Space');
  await waitState(page, ['loading', 'preview', 'match'], 120_000);
  await waitState(page, ['preview', 'match'], 180_000);
  if ((await page.evaluate(() => document.documentElement.dataset.appState)) === 'preview') await tap(page, 'Enter');
  await waitState(page, 'match', 180_000);
  const cfg = await uproot<{ kind: string; mode: string; local: { style: string; seats: { device: string; team: number }[] } }>(page, 'u.app.currentMatch.config');
  expect(cfg.kind).toBe('quick');
  expect(cfg.mode).toBe('2v2');
  expect(cfg.local.style).toBe('versus');
  const roster = await uproot<{ team: number; isBot: boolean }[]>(page, 'u.sim.setup.roster.map((r) => ({ team: r.team, isBot: r.isBot }))');
  expect(roster).toEqual([
    { team: 0, isBot: false },
    { team: 0, isBot: true },
    { team: 1, isBot: false },
    { team: 1, isBot: true },
  ]);
  await page.waitForFunction(() => (window as unknown as { __uproot: { app: { currentMatch: { state: string } } } }).__uproot.app.currentMatch.state === 'playing', null, { timeout: 180_000, polling: 250 });

  const seatPos = () =>
    uproot<{ index: number; x: number; y: number }[]>(page, 'u.app.currentMatch.seats.map((s) => ({ index: s.index, x: u.sim.getCharacter(s.charId).pos.x, y: u.sim.getCharacter(s.charId).pos.y }))');
  const before = await seatPos();
  // shared camera: both humans framed together
  expect(await uproot<number>(page, 'u.app.currentMatch.focus().group.length')).toBe(2);

  // P1 holds D (right), P2 holds ArrowLeft (left): each moves only with their own keys.
  await page.keyboard.down('KeyD');
  await page.keyboard.down('ArrowLeft');
  await expect
    .poll(
      async () => {
        const now = await seatPos();
        return now[0]!.x - before[0]!.x > 1 && before[1]!.x - now[1]!.x > 1;
      },
      { timeout: 180_000, intervals: [500] },
    )
    .toBe(true);
  await shot(page, 'local-03-versus-match');
  await page.keyboard.up('ArrowLeft');
  // Only P1 still holds a key: P2 stops (pure keyboard B input), P1 keeps going right.
  // Measured in sim ticks, not wall-clock time (software GL frames can take seconds under load).
  const tick = () => uproot<number>(page, 'u.sim.state.tick');
  const waitTicks = async (n: number) => {
    const t0 = await tick();
    await expect.poll(tick, { timeout: 180_000, intervals: [250] }).toBeGreaterThanOrEqual(t0 + n);
  };
  await waitTicks(36); // P2's slide after letting go settles
  const mid = await seatPos();
  // P1 keeps going right while P2 stays put
  await expect
    .poll(async () => (await seatPos())[0]!.x - mid[0]!.x, { timeout: 180_000, intervals: [250] })
    .toBeGreaterThan(0.5);
  await waitTicks(30);
  const later = await seatPos();
  await page.keyboard.up('KeyD');
  expect(later[0]!.x).toBeGreaterThan(mid[0]!.x);
  expect(Math.abs(later[1]!.x - mid[1]!.x)).toBeLessThan(0.6);
  // per-player HUD: two corner chips, "P1"/"P2" tags
  await expect(page.locator('.uh-pchip')).toHaveCount(2);
  expect(await page.locator('.uh-hud').evaluate((el) => el.classList.contains('is-local'))).toBe(true);

  // Finish -> results with the per-player panel; rematch keeps the same players.
  await uproot(page, 'u.endMatch()');
  await waitState(page, 'results', 180_000);
  await expect(page.locator('.uh-res__hl')).toBeVisible();
  await page.waitForTimeout(1500);
  await shot(page, 'local-04-results');
  expectNoErrors(problems);
});
