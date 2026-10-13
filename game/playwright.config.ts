/**
 * Browser smoke tests (test/e2e). The web server is `vite preview` of a FRESH production build,
 * so the tests exercise exactly what ships (CSP, bundled fonts, no dev hooks except ?autotest).
 *
 * Headless Chromium renders WebGL through SwiftShader (software): the specs use the test hooks
 * ?render=N (draw every N-th frame), ?speed=N, ?quality=low and ?matchSeconds=N, and long
 * timeouts. Screenshots of every major state go to E2E_SHOTS (default test-results/shots).
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4179);

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 8 * 60 * 1000,
  expect: { timeout: 30 * 1000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 720 },
    actionTimeout: 30 * 1000,
    trace: 'off',
    video: 'off',
    launchOptions: {
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } }],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/`,
    timeout: 5 * 60 * 1000,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
