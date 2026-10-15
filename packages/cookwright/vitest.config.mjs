import { defineConfig } from 'vitest/config';

// Pure-logic tests beside the source they exercise. Git-dependent tests build
// scratch repositories under the OS temp dir; nothing touches this checkout.
export default defineConfig({
  test: {
    include: ['src/**/*.test.mjs'],
    environment: 'node',
  },
});
