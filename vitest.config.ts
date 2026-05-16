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
  },
});
