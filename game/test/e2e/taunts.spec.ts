/**
 * Taunts end to end (owner bug report "도발이 실행이 안돼 / 도발(T)에서 마우스를 못 따라온다"):
 * in a quick match, Ctrl+1 through the real keyboard path starts the butt wiggle in the sim
 * (CharacterState.emote + the 'emote' event), the view plays its pose and pops its head bubble;
 * then the T wheel opened with the cursor far from the wheel highlights exactly the slot the
 * cursor is moved onto, and releasing T plays that taunt. Zero console errors.
 *
 * Test scaffolding (environment only, never the behaviour under test): the autotest proxy that
 * drives the human slot is switched off so the keyboard drives it, the bots stand still (so a
 * dash cannot knock the taunt off), and the input re-activation gap is lifted because software
 * GL frames here can take longer than its 0.5 s (a real 60 fps client never hits it).
 */
import { expect, test, type Page } from '@playwright/test';
import { boot, expectNoErrors, shot, watchConsole } from './helpers';

const Q = 'fresh=1&autotest=1&quality=low&render=2&lang=ko&flow=quick&skipIntro=1&matchSeconds=240&police=0';

interface Rec {
  events: Array<{ type: string; tick: number; charId: number; emoteId: string; nearOpponentId?: number | null; cause?: string }>;
  states: string[];
  poses: string[];
  bubbles: string[];
}

async function rec(page: Page): Promise<Rec> {
  return page.evaluate(() => (window as unknown as { __taunt: Rec }).__taunt);
}

/** Sim ticks of the running match. */
async function tick(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __uproot: { app: { currentMatch: { sim: { state: { tick: number } } } } } }).__uproot.app.currentMatch.sim.state.tick);
}

test('taunts: Ctrl+1 plays the wiggle; the T wheel follows the mouse and plays the slot under it', async ({ page }) => {
  test.setTimeout(20 * 60 * 1000);
  const problems = watchConsole(page);
  await boot(page, Q);
  await page.waitForFunction(() => {
    const m = (window as unknown as { __uproot?: { app?: { currentMatch?: { phase: string } | null } } }).__uproot?.app?.currentMatch;
    return !!m && m.phase === 'playing';
  }, null, { timeout: 15 * 60 * 1000, polling: 500 });

  await page.evaluate(() => {
    type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const u = (window as unknown as { __uproot: Any }).__uproot;
    const m = u.app.currentMatch;
    m.proxy = null; // the keyboard drives the human slot
    for (const b of m.bots) b.update = () => ({ move: { x: 0, y: 0 }, grab: false, dash: false, aim: null, ping: null });
    const input = u.app.d.input;
    input.reactivateAfter = 1e12;
    const r = ((window as unknown as { __taunt: Rec }).__taunt = { events: [], states: [], poses: [], bubbles: [] } as Rec);
    const sim = m.sim;
    const step = sim.step.bind(sim);
    sim.step = (cmds: unknown) => {
      const ev = step(cmds);
      for (const e of ev) if (e.type === 'emote' || e.type === 'emoteCancel') r.events.push({ ...e });
      const me = sim.getCharacter(m.meId);
      if (me?.emote && r.states[r.states.length - 1] !== `${me.emote.id}@${me.emote.startTick}`) r.states.push(`${me.emote.id}@${me.emote.startTick}`);
      return ev;
    };
    const view = m.svc.view;
    const upd = view.taunts.update.bind(view.taunts);
    view.taunts.update = (c: { id: number }, t: number, w: unknown) => {
      const s = upd(c, t, w);
      if (s && c.id === m.meId && r.poses[r.poses.length - 1] !== s.id) r.poses.push(s.id);
      return s;
    };
    const show = view.emotes.show.bind(view.emotes);
    view.emotes.show = (owner: number, kind: string, o: unknown) => {
      if (owner === m.meId) r.bubbles.push(kind);
      return show(owner, kind, o);
    };
  });
  const meId = await page.evaluate(() => (window as unknown as { __uproot: { app: { currentMatch: { meId: number } } } }).__uproot.app.currentMatch.meId);
  await page.mouse.move(640, 600);

  // --- Ctrl+1: the real keyboard path (chord -> emote1 -> Command.emote -> sim -> view) -----------
  await page.keyboard.down('Control');
  await page.keyboard.down('Digit1');
  await page.waitForTimeout(150);
  await page.keyboard.up('Digit1');
  await page.keyboard.up('Control');
  await page.waitForFunction((id) => (window as unknown as { __taunt: Rec }).__taunt.events.some((e) => e.type === 'emote' && e.charId === id), meId, { timeout: 120_000, polling: 100 });
  let r = await rec(page);
  const first = r.events.find((e) => e.type === 'emote' && e.charId === meId)!;
  expect(first.emoteId).toBe('wiggle');
  expect(r.states[0]).toBe(`wiggle@${first.tick}`);
  // the view plays the pose and pops the tail-wiggle bubble over the head
  await page.waitForFunction(() => {
    const t = (window as unknown as { __taunt: Rec }).__taunt;
    return t.poses.includes('wiggle') && t.bubbles.includes('tauntWiggle');
  }, null, { timeout: 120_000, polling: 100 });
  await shot(page, 'taunt-01-ctrl1-wiggle');
  await expect(page.locator('.uh-tchip')).toBeVisible();

  // let it finish and cool down
  await page.waitForFunction(
    (id) => {
      const m = (window as unknown as { __uproot: { app: { currentMatch: { sim: { state: { tick: number }; getCharacter(id: number): { emote: unknown } } } } } }).__uproot.app.currentMatch;
      return !m.sim.getCharacter(id).emote;
    },
    meId,
    { timeout: 120_000, polling: 100 },
  );
  const after = await tick(page);
  await page.waitForFunction((t) => (window as unknown as { __uproot: { app: { currentMatch: { sim: { state: { tick: number } } } } } }).__uproot.app.currentMatch.sim.state.tick > t + 70, after, {
    timeout: 120_000,
    polling: 100,
  });
  r = await rec(page);
  expect(r.events.filter((e) => e.charId === meId && e.type === 'emoteCancel')).toEqual([]);

  // --- T wheel opened with the cursor far from the wheel, then moved onto the right slot -------
  await page.mouse.move(120, 110);
  await page.waitForTimeout(300);
  const wheelOpen = () => page.evaluate(() => (window as unknown as { __uproot: { app: { currentMatch: { wheel: { open: boolean } } } } }).__uproot.app.currentMatch.wheel.open);
  await page.keyboard.down('KeyT');
  await page.waitForFunction(() => (window as unknown as { __uproot: { app: { currentMatch: { wheel: { open: boolean } } } } }).__uproot.app.currentMatch.wheel.open, null, { timeout: 120_000, polling: 100 });
  expect(await wheelOpen()).toBe(true);
  const slot = page.locator('.uh-ewheel__slot[data-emote="bleh"]');
  await expect(slot).toBeVisible();
  await page.waitForTimeout(1200); // open animation (scale-in) done
  const box = (await slot.boundingBox())!;
  const target = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // nothing highlighted yet: the resting cursor picks nothing
  expect(await page.evaluate(() => (window as unknown as { __uproot: { app: { currentMatch: { wheel: { hover: number | null } } } } }).__uproot.app.currentMatch.wheel.hover)).toBeNull();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await expect(slot).toHaveClass(/is-hover/, { timeout: 120_000 });
  expect(await page.evaluate(() => (window as unknown as { __uproot: { app: { currentMatch: { wheel: { hover: number | null } } } } }).__uproot.app.currentMatch.wheel.hover)).toBe(1);
  await expect(page.locator('.uh-ewheel__slot.is-hover')).toHaveCount(1);
  await shot(page, 'taunt-02-wheel-hover-under-cursor');
  await page.keyboard.up('KeyT');
  await page.waitForFunction(
    (id) => (window as unknown as { __taunt: Rec }).__taunt.events.filter((e) => e.type === 'emote' && e.charId === id).length >= 2,
    meId,
    { timeout: 120_000, polling: 100 },
  );
  r = await rec(page);
  const second = r.events.filter((e) => e.type === 'emote' && e.charId === meId)[1]!;
  expect(second.emoteId).toBe('bleh');
  await page.waitForFunction(() => {
    const t = (window as unknown as { __taunt: Rec }).__taunt;
    return t.poses.includes('bleh') && t.bubbles.includes('tauntBleh');
  }, null, { timeout: 120_000, polling: 100 });
  await shot(page, 'taunt-03-wheel-bleh');
  expect(await wheelOpen()).toBe(false);

  expectNoErrors(problems);
});
