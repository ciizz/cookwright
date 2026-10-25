// src/hook.mjs — `cookwright hook <pre-commit|pre-push> [args…]`: what the git hook
// shims call (plan §4.1). The checks are in lib/hooks/registry.mjs.
//
// Exit 10 when, and only when, a check FAILed; the shim maps 10 to 1 for git and
// any other non-zero code to one crashed line and exit 0, so nothing but a finding
// ever blocks a commit or a push. Everything after the hook's name is accepted and
// ignored: git passes `<remote> <url>` to pre-push. A missing or unknown name is the
// usage, exit 2. A failure outside every check (finding the work tree) is one line,
// exit 0: doctor owns the harness's own state.

import fs from 'node:fs';

import { TimedOut } from './lib/budget.mjs';
import { workTreeRoot } from './lib/config.mjs';
import { openDoctorRepo } from './lib/doctor/repo.mjs';
import { FINDINGS_EXIT } from './lib/hooks/shims.mjs';
import { HOOKS, runHook } from './lib/hooks/registry.mjs';
import { messages } from './lib/messages.mjs';
import { PROBES } from './lib/probes.mjs';
import { FAIL } from './lib/verdict.mjs';

const m = messages.hook;

/**
 * `{ root, top, config, configError }`: the config found from `cwd` upward, bounded by
 * the work tree's top (git runs hooks at the top; a shim whose config root is below
 * it enters that directory first), else the top with no config; null outside a
 * work tree. No cookwright.json is a config of null with no error.
 */
function openHookRepo(cwd, probes) {
  const top = probes.hasTool('git') ? workTreeRoot(cwd) : null;
  if (!top) return null;
  const real = fs.realpathSync(top);
  return openDoctorRepo(cwd, probes) ?? { root: real, top: real, config: null, configError: null };
}

/**
 * `io.cwd`, `io.probes`, `io.env` (git's environment, process.env by default),
 * `io.input` (pre-push's stdin) and `io.spawn` (the standards check's child) are
 * the tests' seams; the bin passes none.
 */
export function main(argv = [], io = {}) {
  const [name] = argv;
  if (!name || !Object.hasOwn(HOOKS, name)) {
    console.error(m.usage);
    return 2;
  }
  try {
    const ctx = { probes: { ...PROBES, ...io.probes }, env: io.env ?? process.env, input: io.input, ...(io.spawn ? { spawn: io.spawn } : {}) };
    const repo = openHookRepo(io.cwd ?? process.cwd(), ctx.probes);
    if (!repo) {
      console.log(m.whole(name, m.notWorkTree));
      return 0;
    }
    const rows = runHook(name, repo, ctx);
    return rows.some(([, r]) => r.status === FAIL) ? FINDINGS_EXIT : 0;
  } catch (err) {
    const detail = err instanceof TimedOut ? messages.timedOut(err.what) : String(err?.message ?? err).split('\n')[0];
    console.log(m.whole(name, detail));
    return 0;
  }
}
