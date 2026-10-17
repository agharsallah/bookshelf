// @ts-check
import { defineConfig, envField, fontProviders, memoryCache } from 'astro/config';

import react from '@astrojs/react';
import node from '@astrojs/node';
import vercel from '@astrojs/vercel';
import { cacheVercel } from '@astrojs/vercel/cache';

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
      // Read-only showcase (docs/DEMO.md): greys out adding and the local-only tools,
      // and the /api proxy refuses every write.
      PUBLIC_DEMO: envField.boolean({
        context: 'client',
        access: 'public',
        default: false,
      }),
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

  // Cache for on-demand responses that opt in (lib/route-cache.ts, lib/demo-cache.ts): in
  // process, or Vercel's CDN on Vercel (the demo deploy). A server island's URL carries its
  // component encrypted afresh on every render (`e`); left out of the memory key, a
  // prop-less island such as Today's is found again on the next visit.
  cache: {
    provider: process.env.VERCEL ? cacheVercel() : memoryCache({ query: { exclude: ['e'] } }),
  },

  integrations: [react()],

  // Vercel sets VERCEL during its builds (the demo deploy); everywhere else, Node.
  adapter: process.env.VERCEL ? vercel() : node({ mode: 'standalone' }),
});
