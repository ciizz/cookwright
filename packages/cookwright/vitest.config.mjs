import os from 'node:os';
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
    // Each git test spawns many short git processes. With one worker per core on a
    // machine other sessions share, the worker→main RPC starves and vitest exits 1
    // on a green suite ("Timeout calling onTaskUpdate", B-015). Half the cores, at
    // least two, keeps the main process scheduled; measured in the B-015 entry.
    maxWorkers: Math.max(2, Math.floor(os.cpus().length / 2)),
  },
});
