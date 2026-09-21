// @ts-check
import { defineConfig, envField } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  env: {
    schema: {
      PUBLIC_APP_NAME: envField.string({
        context: 'client',
        access: 'public',
        default: 'Bookshelf',
      }),
      PUBLIC_API_URL: envField.string({
        context: 'client',
        access: 'public',
        optional: true,
      }),
      API_SECRET: envField.string({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
    },
  },
});
