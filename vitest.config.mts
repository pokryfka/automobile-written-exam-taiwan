// Worker tests run inside the Workers runtime (Miniflare) with a local D1 database.
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
      }),
    ],
    test: {
      include: ['worker/test/**/*.test.ts'],
      setupFiles: ['worker/test/apply-migrations.ts'],
    },
  };
});
