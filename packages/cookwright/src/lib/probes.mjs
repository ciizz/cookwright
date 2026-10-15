// src/lib/probes.mjs — the few questions init, doctor and the hooks ask the machine:
// is a tool on PATH, which Claude Code is installed, does git ignore a path, which
// files sit at the root, what gitleaks finds in the staged diff.
//
// They are injected (doctor's `probes`), so the tests need no Claude or gitleaks
// binary and can play a machine without git. Each is bounded by doctor's shared
// budget (budget.mjs) when one is open.

import fs from 'node:fs';
import path from 'node:path';

import { TimedOut, runBounded } from './budget.mjs';
import { messages } from './messages.mjs';

/** True when `bin` is an executable file in a PATH directory. No subprocess. */
export function hasTool(bin, { PATH = process.env.PATH ?? '' } = {}) {
  return PATH.split(path.delimiter)
    .filter(Boolean)
    .some((dir) => {
      try {
        fs.accessSync(path.join(dir, bin), fs.constants.X_OK);
        return fs.statSync(path.join(dir, bin)).isFile();
      } catch {
        return false;
      }
    });
}

/** The first `x.y.z` in `text`, or null. */
export function parseVersion(text) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(text ?? '');
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

/** True when version `a` is `b` or newer (both `x.y.z`). */
export function atLeast(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if (pa[i] !== pb[i]) return pa[i] > pb[i];
  return true;
}

/**
 * Claude Code's version (`x.y.z`), or null when it is not on PATH, fails, or takes
 * longer than `timeout` ms or than the shared budget has left: an unverified version
 * reads as not installed.
 */
export function claudeVersion({ bin = 'claude', timeout = 1500 } = {}) {
  const r = runBounded(bin, ['--version'], {}, timeout);
  if (r.status !== 0) return null;
  return parseVersion(r.stdout);
}

/**
 * Whether git ignores `rel` (root-relative) in the work tree at `root`. One path per
 * call: `-q` with two paths is fatal, and without it git exits 0 when only one is
 * ignored. `--no-index`: the question is whether the rules cover the path, and git
 * otherwise answers "not ignored" for any tracked file (doctor FAILs a tracked env
 * file on its own). Exit 0 ignored, 1 not; anything else throws with git's stderr,
 * never "not ignored".
 */
export function ignored(root, rel) {
  const r = runBounded('git', ['check-ignore', '-q', '--no-index', '--', rel], { cwd: root });
  if (r.timedOut) throw new TimedOut('git check-ignore');
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  const detail = (r.stderr || r.error?.message || '').trim();
  throw new Error(messages.probeFailed(`git check-ignore ${rel}`, detail));
}

/** The names of the regular files directly in `dir` (links followed): never a walk. */
export function rootFiles(dir) {
  return fs.readdirSync(dir).filter((name) => {
    try {
      return fs.statSync(path.join(dir, name)).isFile();
    } catch {
      return false;
    }
  });
}

/** The staged-diff scan: `--exit-code 3` tells a finding from a failure to run. */
export const SCAN_ARGS = Object.freeze([
  'git',
  '--pre-commit',
  '--staged',
  '--redact',
  '--verbose',
  '--no-color',
  '--no-banner',
  '--exit-code',
  '3',
]);
export const SCAN_CAP_MS = 60_000;

/**
 * gitleaks over the staged diff at `root`: `{ status, timedOut, stderr }`, status
 * null when it could not be spawned. Its redacted output streams straight to the
 * terminal (no buffer to overflow on a large staged dump); with `quiet` (doctor's
 * dry run) stdout is discarded and stderr kept for its first line, inside the
 * shared budget. `env` is git's, so a partial commit's GIT_INDEX_FILE is seen.
 */
export function scanStaged(root, { quiet = false, env, cap = quiet ? undefined : SCAN_CAP_MS } = {}) {
  const stdio = quiet ? ['ignore', 'ignore', 'pipe'] : ['ignore', 'inherit', 'inherit'];
  const opts = { cwd: root, stdio, ...(env ? { env } : {}) };
  const r = runBounded('gitleaks', SCAN_ARGS, opts, cap);
  return { status: r.status, timedOut: r.timedOut, stderr: r.stderr };
}

/** gitleaks' version (`x.y.z`), or null when it is absent, fails or is slow. */
export function gitleaksVersion({ bin = 'gitleaks', timeout = 5000 } = {}) {
  const r = runBounded(bin, ['version'], {}, timeout);
  return r.status === 0 ? parseVersion(r.stdout) : null;
}

/** The real probes; doctor, init and the hooks take overrides of any of them. */
export const PROBES = Object.freeze({ hasTool, claudeVersion, ignored, rootFiles, scanStaged, gitleaksVersion });
