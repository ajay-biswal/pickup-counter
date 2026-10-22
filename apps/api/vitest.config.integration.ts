
import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

config({ path: '.env.test', override: true });

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/integration/**/*.integration.spec.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
    fileParallelism: false,
  },
});
