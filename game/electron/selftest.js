/* Renderer half of `--selftest` (see main.cjs). Plain script: runs in the sandboxed page. */
(async () => {
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  const status = document.getElementById('status');

  const n = window.uprootNative;
  check('bridge present', !!n && typeof n.saveRead === 'function' && typeof n.saveWrite === 'function');
  check('no Node globals in the page', typeof require === 'undefined' && typeof process === 'undefined' && typeof module === 'undefined');
  check('bridge version', n && n.bridgeVersion === 1, n && n.bridgeVersion);

  // Save round-trip: fresh dir, two writes (backup rotation), a corrupt write (must not rotate),
  // then two good writes again. Unicode must survive the IPC + file round-trip.
  const p1 = JSON.stringify({ version: 1, note: '뿌리째 털어라 — 첫 저장 ✓', n: 1 });
  const p2 = JSON.stringify({ version: 1, note: '두 번째 저장 🦝', n: 2 });
  check('fresh save is empty', n.saveRead('main') === null && n.saveRead('backup') === null);
  check('write #1', n.saveWrite(p1) === true);
  check('read #1', n.saveRead('main') === p1);
  check('write #2', n.saveWrite(p2) === true);
  check('read #2', n.saveRead('main') === p2);
  check('backup holds #1', n.saveRead('backup') === p1);
  check('write corrupt', n.saveWrite('{"truncated":') === true);
  check('backup rotated to #2', n.saveRead('backup') === p2);
  check('write #1 again', n.saveWrite(p1) === true);
  check('corrupt main not rotated into backup', n.saveRead('backup') === p2);
  check('write #2 again', n.saveWrite(p2) === true);
  check('final main/backup', n.saveRead('main') === p2 && n.saveRead('backup') === p1);
  check('quarantine', n.saveQuarantine('{"truncated":', 'selftest') === true);
  check('oversized write rejected', n.saveWrite('x'.repeat(6 * 1024 * 1024)) === false);
  check('non-string write rejected', n.saveWrite(42) === false);

  check('steam bridge shape', typeof n.steam.available === 'boolean' && typeof n.steam.unlock === 'function');
  check('steam rejects malformed ids', n.steam.unlock('../not an id') === false && n.steam.isUnlocked('bad id') === null);
  check('isFullscreen is boolean', typeof n.isFullscreen() === 'boolean');
  const unsub = n.onFullscreenChange(() => {});
  check('onFullscreenChange returns unsubscribe', typeof unsub === 'function');
  unsub();
  n.log('info', 'self-test renderer log line');

  check('window.open blocked', window.open('https://example.com/') === null);
  try {
    const perm = await Notification.requestPermission();
    check('permission requests denied', perm === 'denied', perm);
  } catch (err) {
    check('permission requests denied', true, `threw: ${err}`);
  }

  const before = location.href;
  try {
    location.href = 'https://example.com/';
  } catch {
    // some engines throw on blocked navigation
  }
  await new Promise((r) => setTimeout(r, 400));
  check('navigation blocked', location.href === before, location.href);

  status.textContent = results.every((r) => r.ok) ? 'self-test passed' : 'self-test failed';
  window.uprootSelftest.report({ results, expectMain: p2, expectBackup: p1 });
})().catch((err) => {
  if (window.uprootSelftest) window.uprootSelftest.report({ results: [{ name: 'exception', ok: false, detail: String((err && err.stack) || err) }] });
});
