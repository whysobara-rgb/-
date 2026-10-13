// Vite dev server for the steam-asset capture (tools/steam-assets/capture.mjs): the project
// root, HMR and file watching off so other edits never reload a page mid-capture.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig({
  root,
  base: '/',
  configFile: false,
  clearScreen: false,
  logLevel: 'warn',
  server: { host: '127.0.0.1', hmr: false, watch: null },
});
