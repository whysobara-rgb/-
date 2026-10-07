/**
 * Kickoff cue (fun-plan WP5 acceptance, content-plan F5): for the first 5 s of a match the
 * nearest starter target (classic: small safe; v2: crate or ATM) is cued; the extra arrow is only
 * for players with fewer than 10 finished matches on the save (matches 1-9 of a fresh save), and
 * the cue is gone after 5 s.
 */
import { expect, test, type Page } from '@playwright/test';
import { appState, boot, expectNoErrors, shot, uproot, waitState, watchConsole } from './helpers';

interface CueInfo {
  target: { id: number | string; kind: 'smallSafe' | 'atm' | 'crate'; pos: { x: number; y: number } };
  pulse: boolean;
  arrowEligible: boolean;
  arrows: number;
  onScreen: boolean;
}

/** Visible HUD off-screen arrows of a kind (the kickoff arrow: 'safe' classic, 'ping' v2). */
async function hudArrows(page: Page, kind: string): Promise<number> {
  return page.evaluate((k) => document.querySelectorAll(`.uh-arrow[data-kind="${k}"]:not([hidden])`).length, kind);
}

/** Start a quick match on plaza with `matches` finished matches on the (in-memory) save. */
async function startWithMatches(page: Page, matches: number): Promise<void> {
  await page.evaluate((n) => {
    const u = (window as unknown as { __uproot: { save(): { stats: { matches: number } }; app: { startQuick(o: unknown, preview: boolean): void } } }).__uproot;
    u.save().stats.matches = n;
    u.app.startQuick({ mode: '1v1', layout: 'plaza', rival: 'hodadak', difficulty: 'normal' }, false);
  }, matches);
  await waitState(page, 'match', 180_000);
  await page.waitForFunction(() => {
    const u = (window as unknown as { __uproot: { sim: { state: { tick: number } } | null } }).__uproot;
    return (u.sim?.state.tick ?? 0) >= 30;
  }, null, { timeout: 180_000, polling: 100 });
}

async function cue(page: Page): Promise<CueInfo | null> {
  return uproot<CueInfo | null>(page, 'u.app.currentMatch ? u.app.currentMatch.kickoffCueInfo() : null');
}

/** End the match and go back to the menu (retried: the end hold / results may still be opening). */
async function leaveMatch(page: Page): Promise<void> {
  await uproot(page, '(u.endMatch(), 0)');
  for (let i = 0; i < 60; i++) {
    if ((await appState(page)) === 'menu') return;
    await uproot(page, '(u.app.toMenu(), 0)');
    await page.waitForTimeout(2000);
  }
  await waitState(page, 'menu', 10_000);
}

test('kickoff cue: arrow only on matches 1-9 of a fresh save; pulse / cue gone after 5 s', async ({ page }) => {
  // five match starts at speed 1 under software GL
  test.setTimeout(25 * 60 * 1000);
  const problems = watchConsole(page);
  const missing: string[] = [];
  page.on('response', (r) => {
    if (r.status() >= 400) missing.push(`${r.status()} ${r.url()}`);
  });
  // speed 1: the 5 s window is checked in sim ticks; autotest drives the human slot
  await boot(page, 'fresh=1&autotest=1&quality=low&render=12&lang=ko&skipIntro=1&seed=4');
  await waitState(page, 'menu');

  // fresh save (0 finished) and the 9th match (8 finished): cue + arrow
  for (const n of [0, 8]) {
    await startWithMatches(page, n);
    const c = await cue(page);
    expect(c, `cue at kickoff with ${n} finished matches`).not.toBeNull();
    // classic: the nearest small safe (pulsed); v2: the nearest crate or ATM, never a safe
    const content = await uproot<string>(page, 'u.sim.rules.content');
    if (content === 'v2') expect(['crate', 'atm']).toContain(c!.target.kind);
    else expect(c!.target.kind).toBe('smallSafe');
    expect(c!.arrowEligible).toBe(true);
    expect(c!.arrows).toBe(1);
    expect(c!.pulse).toBe(c!.target.kind !== 'crate');
    // the HUD draws it while the target is off screen
    await page.waitForTimeout(1500);
    const now = await cue(page);
    const arrowKind = c!.target.kind === 'smallSafe' ? 'safe' : 'ping';
    if (now && !now.onScreen) expect(await hudArrows(page, arrowKind)).toBe(1);
    console.log(`kickoff n=${n} content=${content} target=${c!.target.kind}:${String(c!.target.id)} onScreen=${String(now?.onScreen)} hudArrows=${await hudArrows(page, arrowKind)}`);
    if (n === 0) await shot(page, 'kickoff-01-fresh');
    await leaveMatch(page);
  }

  // the 10th match (9 finished) still gets it; the 11th (10 finished) does not
  await startWithMatches(page, 9);
  expect((await cue(page))!.arrowEligible).toBe(true);
  await leaveMatch(page);
  await startWithMatches(page, 10);
  const veteran = await cue(page);
  expect(veteran).not.toBeNull();
  expect(veteran!.arrowEligible).toBe(false);
  expect(veteran!.arrows).toBe(0);
  await page.waitForTimeout(1500);
  expect(await hudArrows(page, veteran!.target.kind === 'smallSafe' ? 'safe' : 'ping')).toBe(0);
  await shot(page, 'kickoff-02-veteran');

  // after 5 s of match time the cue is gone
  await page.waitForFunction(() => {
    const u = (window as unknown as { __uproot: { sim: { state: { tick: number } } | null } }).__uproot;
    return (u.sim?.state.tick ?? 0) >= 5 * 60 + 5;
  }, null, { timeout: 240_000, polling: 250 });
  expect(await cue(page)).toBeNull();
  expect(await appState(page)).toBe('match');
  await leaveMatch(page);
  expect(missing, missing.join('\n')).toEqual([]);
  expectNoErrors(problems);
});
