import { defineConfig } from 'vitest/config';

/** Unit tests cover the pure modules in src/lib; no DOM or Vite plugins needed. */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
