import { defineConfig } from 'vite';

// base './' so the built game loads from file:// inside Electron.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
  server: { port: 5173, host: '127.0.0.1' },
});
