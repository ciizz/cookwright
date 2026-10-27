// src/lib/probes.mjs — the few questions init, doctor and the hooks ask the machine:
// is a tool on PATH, which Claude Code is installed, does git ignore a path (and by
// which line), which files sit at the root, what gitleaks finds in the staged diff,
// is there a terminal; and the two ways the secrets engine reaches a tool: one
// synchronous call whose output it reads (`capture`), and the one child it starts
// (`spawnChild`, stage-5 plan disposition 9).
//
// They are injected (doctor's `probes`), so the tests need no Claude or gitleaks
// binary and can play a machine without git. Each is bounded by doctor's shared
// budget (budget.mjs) when one is open.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { MAX_BUFFER, TimedOut, runBounded } from './budget.mjs';
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

/**
 * The ignore rule that ignores `rel` (relative to `root`) as `{ source, line,
 * pattern }`, or null when no rule does or a negated one (`!pattern`) has the last
 * word. `--no-index`, as `ignored` reads it; a directory is asked with a trailing
 * slash (`secrets/`), the form a `secrets/` rule matches. Anything but exit 0 or 1
 * throws with git's stderr.
 */
export function ignoredBy(root, rel) {
  const r = runBounded('git', ['check-ignore', '-v', '--no-index', '--', rel], { cwd: root });
  if (r.timedOut) throw new TimedOut('git check-ignore');
  if (r.status === 1) return null;
  const m = r.status === 0 ? /^(.+?):(\d+):(.*)\t/.exec(r.stdout) : null;
  if (!m) {
    const detail = (r.stderr || r.error?.message || r.stdout || '').trim();
    throw new Error(messages.probeFailed(`git check-ignore ${rel}`, detail));
  }
  return m[3].startsWith('!') ? null : { source: m[1], line: Number(m[2]), pattern: m[3] };
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

/**
 * Whether a terminal is there to prompt on: /dev/tty opens (where age and security
 * prompt, whatever the standard streams are). An agent's shell has none. On
 * Windows, whether stdin is a terminal.
 */
export function terminal() {
  if (process.platform === 'win32') return Boolean(process.stdin.isTTY);
  try {
    fs.closeSync(fs.openSync('/dev/tty', 'r+'));
    return true;
  } catch {
    return false;
  }
}

/** A backend tool's call outside doctor's budget is capped here (disposition 9). */
export const CAPTURE_CAP_MS = 120_000;

/**
 * One synchronous call of a backend's tool (`age`, `age-keygen`, `op`, `security`):
 * `{ status, stdout, stderr, error }`, `input` on its stdin, both outputs captured
 * as text. Bounded by doctor's budget inside one, by `cap` outside; `cap: null` is
 * uncapped, for a call that prompts on the terminal it opens itself. A timeout
 * throws TimedOut naming the tool. Never a shell.
 */
export function capture(cmd, args, { input, cwd, env, cap = CAPTURE_CAP_MS } = {}) {
  const opts = { stdio: 'pipe', ...(input !== undefined && { input }), ...(cwd && { cwd }), ...(env && { env }) };
  if (cap === null) {
    const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: MAX_BUFFER, ...opts });
    return { status: r.error ? null : r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error };
  }
  const r = runBounded(cmd, args, opts, cap);
  if (r.timedOut) throw new TimedOut(cmd);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, error: r.error };
}

/** The one child `run` starts, asynchronous, never through a shell (disposition 9). */
export const spawnChild = (cmd, args, opts = {}) => spawn(cmd, args, { ...opts, shell: false });

/** The real probes; doctor, init and the hooks take overrides of any of them. */
export const PROBES = Object.freeze({
  hasTool,
  claudeVersion,
  ignored,
  ignoredBy,
  rootFiles,
  scanStaged,
  gitleaksVersion,
  terminal,
  capture,
  spawnChild,
});
