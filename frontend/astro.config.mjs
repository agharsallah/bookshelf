// @ts-check
import { defineConfig, envField, fontProviders } from 'astro/config';

import react from '@astrojs/react';
import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
  env: {
    schema: {
      PUBLIC_APP_NAME: envField.string({
        context: 'client',
        access: 'public',
        default: 'Bookshelf',
      }),
      // Public backend base URL (including /api/v1). Used server-side unless
      // API_INTERNAL_URL overrides it; the browser always goes through /api.
      PUBLIC_API_URL: envField.string({
        context: 'client',
        access: 'public',
        optional: true,
      }),
      // Server-only backend base URL, for when the server reaches the backend on a
      // different host than the public one (containers, private network).
      API_INTERNAL_URL: envField.string({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
      // Sent as X-API-Key by the /api proxy on mutating requests. Never shipped to the browser.
      API_SECRET: envField.string({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
    },
  },

  // Self-hosted at build time by the Fonts API (no runtime call to Google).
  fonts: [
    {
      provider: fontProviders.google(),
      name: 'Literata',
      cssVariable: '--font-literata',
      weights: ['300 800'],
      styles: ['normal', 'italic'],
      fallbacks: ['Georgia', 'serif'],
    },
    {
      provider: fontProviders.google(),
      name: 'Schibsted Grotesk',
      cssVariable: '--font-schibsted',
      weights: ['400 700'],
      styles: ['normal'],
      fallbacks: ['system-ui', 'sans-serif'],
    },
    {
      provider: fontProviders.google(),
      name: 'IBM Plex Mono',
      cssVariable: '--font-plex-mono',
      weights: [400, 500],
      styles: ['normal'],
      fallbacks: ['ui-monospace', 'monospace'],
    },
  ],

  integrations: [react()],

  adapter: node({
    mode: 'standalone',
  }),
});
