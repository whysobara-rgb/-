/**
 * Taunts end to end (owner bug report "도발이 실행이 안돼 / 도발(T)에서 마우스를 못 따라온다"):
 * in a quick match, Ctrl+1 through the real keyboard path starts the butt wiggle in the sim
 * (CharacterState.emote + the 'emote' event), the view plays its pose and pops its head bubble;
 * then the T wheel opened with the cursor far from the wheel highlights exactly the slot the
 * cursor is moved onto (also while the ring is drawn scaled down, as in its open pop-in), and
 * releasing T plays that taunt. Zero console errors.
 *
 * Test scaffolding (environment only, never the behaviour under test): the autotest proxy that
 * drives the human slot is switched off so the keyboard drives it, the bots stand still (so a
 * dash cannot knock the taunt off), and the input re-activation gap is lifted because software
 * GL frames here can take longer than its 0.5 s (a real 60 fps client never hits it).
 */
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { SHOTS, boot, expectNoErrors, watchConsole } from './helpers';

const Q = 'fresh=1&autotest=1&quality=low&render=2&lang=ko&flow=quick&skipIntro=1&matchSeconds=240&police=0';

interface Rec {
  events: Array<{ type: string; tick: number; charId: number; emoteId: string; nearOpponentId?: number | null; cause?: string }>;
  states: string[];
  poses: string[];
  bubbles: string[];
}

/** Screenshot with a long timeout (software GL under load can take well over 30 s per frame). */
async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), timeout: 240_000 });
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
  // the disc's open animation (scale-in) runs on wall-clock time: wait until the slot sits still
  // where it is drawn for good before aiming at it
  await page.waitForFunction(
    () => {
      const disc = document.querySelector('.uh-ewheel__disc');
      return !!disc && disc.getAnimations().every((a) => a.playState === 'finished' || a.playState === 'idle');
    },
    null,
    { timeout: 120_000, polling: 100 },
  );
  let box = (await slot.boundingBox())!;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    const b = (await slot.boundingBox())!;
    const still = Math.abs(b.x - box.x) < 0.5 && Math.abs(b.y - box.y) < 0.5 && Math.abs(b.width - box.width) < 0.5;
    box = b;
    if (still) break;
  }
  const target = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const center = await page.evaluate(() => (window as unknown as { __uproot: { app: { currentMatch: { svc: { hud: { taunts: { geometry(): { x: number; y: number; dead: number } } } } } } } }).__uproot.app.currentMatch.svc.hud.taunts.geometry());
  // the slot is drawn right of the wheel center, outside the center disc
  expect(target.x - center.x).toBeGreaterThan(center.dead);
  expect(Math.abs(target.y - center.y)).toBeLessThan(box.height / 2);
  // nothing highlighted yet: the resting cursor picks nothing
  expect(await page.evaluate(() => (window as unknown as { __uproot: { app: { currentMatch: { wheel: { hover: number | null } } } } }).__uproot.app.currentMatch.wheel.hover)).toBeNull();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  // the controller picks the slot under the cursor (diagnostics in the message if it does not)
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const u = (window as unknown as { __uproot: { app: { currentMatch: { wheel: { hover: number | null; open: boolean }; sim: { state: { tick: number } }; svc: { hud: { taunts: { geometry(): unknown } } } }; d: { input: { pointer: unknown } } } } }).__uproot;
          const m = u.app.currentMatch;
          return JSON.stringify({ hover: m.wheel.hover, open: m.wheel.open, tick: m.sim.state.tick, pointer: u.app.d.input.pointer, geo: m.svc.hud.taunts.geometry() });
        }),
      { timeout: 120_000, intervals: [250] },
    )
    .toMatch(/"hover":1,/);
  await expect(slot).toHaveClass(/is-hover/, { timeout: 120_000 });
  expect(await page.evaluate(() => (window as unknown as { __uproot: { app: { currentMatch: { wheel: { hover: number | null } } } } }).__uproot.app.currentMatch.wheel.hover)).toBe(1);
  await expect(page.locator('.uh-ewheel__slot.is-hover')).toHaveCount(1);
  await shot(page, 'taunt-02-wheel-hover-under-cursor');

  // --- pop-in: while the ring is drawn scaled down (the open animation starts at 0.55) the slot
  // where it is drawn right now is picked, with the real CSS and the HUD's real geometry() --------
  const hoverNow = () => page.evaluate(() => (window as unknown as { __uproot: { app: { currentMatch: { wheel: { hover: number | null } } } } }).__uproot.app.currentMatch.wheel.hover);
  await page.evaluate(() => {
    const disc = document.querySelector<HTMLElement>('.uh-ewheel__disc')!;
    for (const a of disc.getAnimations()) a.finish();
    disc.style.transform = 'scale(0.55)';
  });
  const small = await page.evaluate(() => {
    const geo = (window as unknown as { __uproot: { app: { currentMatch: { svc: { hud: { taunts: { geometry(): { x: number; y: number; dead: number } } } } } } } }).__uproot.app.currentMatch.svc.hud.taunts.geometry();
    const c = document.querySelector('.uh-ewheel__center')!.getBoundingClientRect();
    const box = (id: string) => {
      const r = document.querySelector(`.uh-ewheel__slot[data-emote="${id}"]`)!.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    return { geo, centerR: Math.min(c.width, c.height) / 2, down: box('squatBounce'), right: box('bleh') };
  });
  // the deadzone shrank with the ring (0.55x the center disc), so the drawn slots lie outside it
  expect(small.geo.dead).toBeGreaterThan(small.centerR * 0.5);
  expect(small.geo.dead).toBeLessThan(small.centerR * 0.6);
  expect(small.down.y - small.geo.y).toBeGreaterThan(small.geo.dead);
  expect(small.down.y - small.geo.y).toBeLessThan(small.centerR); // inside the full-size disc: the old deadzone would have eaten it
  await page.mouse.move(small.down.x, small.down.y, { steps: 8 });
  await expect.poll(hoverNow, { timeout: 120_000, intervals: [250] }).toBe(2);
  await expect(page.locator('.uh-ewheel__slot[data-emote="squatBounce"]')).toHaveClass(/is-hover/, { timeout: 120_000 });
  await shot(page, 'taunt-02b-popin-drawn-slot');
  await page.mouse.move(small.right.x, small.right.y, { steps: 8 });
  await expect.poll(hoverNow, { timeout: 120_000, intervals: [250] }).toBe(1);
  // back to full size, cursor back on the full-size slot
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('.uh-ewheel__disc')!.style.transform = '';
  });
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await expect.poll(hoverNow, { timeout: 120_000, intervals: [250] }).toBe(1);

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
