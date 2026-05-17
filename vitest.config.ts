import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: { NODE_ENV: 'test' },
    globals: false,
    pool: 'forks',
    fileParallelism: false,
    setupFiles: [],
    testTimeout: 15_000,
    // Vitest's default exclude is node_modules + .git + cache dirs. We also
    // skip dist/ because `pnpm build` emits compiled .js mirrors of every
    // test file there — without this they get discovered as duplicates and
    // fail at boot when env.ts can't find .env.test.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
  },
});
