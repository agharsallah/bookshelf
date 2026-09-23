/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config';

/**
 * Two projects sharing the Astro-aware Vite config:
 * - `unit`: pure TS modules in Node (fast, no DOM).
 * - `dom`:  React components (`*.test.tsx`) in happy-dom.
 */
export default getViteConfig({
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'happy-dom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['src/test/setup-dom.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**'],
    },
  },
});
