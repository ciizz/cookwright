import { defineConfig } from 'vitest/config';

// Pure-logic tests beside the source they exercise. Git-dependent tests build
// scratch repositories under the OS temp dir; nothing touches this checkout. The
// setup file isolates git's global and system config for every test.
export default defineConfig({
  test: {
    include: ['src/**/*.test.mjs'],
    environment: 'node',
    setupFiles: ['./vitest.setup.mjs'],
    // The git-heavy tests spawn dozens of git processes each and take 6–7 s when
    // other agent sessions share the machine, past vitest's 5 s default; the suite
    // then fails the push gate on commits that changed nothing it tests (B-014).
    // Idle, the slowest test runs under 5 s; 30 s is headroom, not a budget.
    testTimeout: 30_000,
  },
});
