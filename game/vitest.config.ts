import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/sim/**/*.test.ts', 'test/ai/**/*.test.ts', 'test/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120000,
  },
});
