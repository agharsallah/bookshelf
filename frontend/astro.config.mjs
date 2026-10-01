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
      // Comma-separated hosts this server answers (DNS-rebinding guard, src/middleware.ts).
      // An entry without a port allows any port. Unset: localhost, 127.0.0.1 and [::1].
      ALLOWED_HOSTS: envField.string({
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
      name: 'Source Serif 4',
      cssVariable: '--font-source-serif',
      weights: ['300 800'],
      styles: ['normal', 'italic'],
      fallbacks: ['Georgia', 'serif'],
    },
    {
      provider: fontProviders.google(),
      name: 'Hanken Grotesk',
      cssVariable: '--font-hanken',
      weights: ['400 800'],
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

  // ClientRouter prefetches every link; on hover that server-renders each page you pass
  // over (dozens of backend calls apiece). On tap it still starts just before the click.
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'tap',
  },

  integrations: [react()],

  adapter: node({
    mode: 'standalone',
  }),
});
