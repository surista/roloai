import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['shared/src/**/*.test.ts', 'mobile/src/lib/**/*.test.ts', 'scripts/**/*.test.mjs'] },
});
