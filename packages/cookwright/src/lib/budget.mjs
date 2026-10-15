// src/lib/budget.mjs — the time init's and doctor's subprocesses may take.
//
// doctor runs in a SessionStart hook with a ten-second timeout and promises an
// answer in under two seconds (plan §4.8). So every git or claude call it makes
// takes its timeout from one shared budget, opened by `withBudget`; once the budget
// is spent, a call times out at once instead of spawning. Outside a budget (init's
// own steps, the bundle CLI's root lookup) each call is capped at CALL_CAP_MS.
//
// This module imports nothing of cookwright's: config.mjs uses it, and config.mjs
// must not reach messages.mjs. A timeout is a TimedOut carrying what timed out; the
// caller words it.

import { spawnSync } from 'node:child_process';

export const BUDGET_MS = 1800;
export const CALL_CAP_MS = 1500;

let deadline = null;

/** Run `fn` with a fresh shared budget of `ms`; the previous one is restored after. */
export function withBudget(fn, ms = BUDGET_MS) {
  const outer = deadline;
  deadline = Date.now() + ms;
  try {
    return fn();
  } finally {
    deadline = outer;
  }
}

/** The next call's timeout in ms: at most `cap`, 0 when the budget is spent. */
export function timeLeft(cap = CALL_CAP_MS) {
  if (deadline === null) return cap;
  return Math.max(0, Math.min(cap, deadline - Date.now()));
}

/** A subprocess that did not answer in time: `what` names it (`git rev-parse`). */
export class TimedOut extends Error {
  constructor(what) {
    super(what);
    this.name = 'TimedOut';
    this.what = what;
  }
}

/**
 * spawnSync bounded by the budget. Never throws: `status` is null on any spawn
 * error, and `timedOut` says whether that error was the clock.
 */
export function runBounded(cmd, args, opts = {}, cap = CALL_CAP_MS) {
  const ms = timeLeft(cap);
  if (ms <= 0) return { status: null, stdout: '', stderr: '', timedOut: true };
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts, timeout: ms, killSignal: 'SIGKILL' });
  return {
    status: r.error ? null : r.status,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    error: r.error,
    timedOut: r.error?.code === 'ETIMEDOUT',
  };
}
