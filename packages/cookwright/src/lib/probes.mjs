// src/lib/probes.mjs — the few questions init and doctor ask the machine: is a tool
// on PATH, which Claude Code is installed, does git ignore a path.
//
// They are injected (doctor's `probes`), so the tests need no Claude binary and can
// play a machine without git. Each answers fast: doctor's budget is two seconds.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

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
 * longer than `timeout` ms: an unverified version reads as not installed.
 */
export function claudeVersion({ bin = 'claude', timeout = 1500 } = {}) {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout });
  if (r.error || r.status !== 0) return null;
  return parseVersion(r.stdout);
}

/**
 * Whether git ignores `rel` (root-relative) in the work tree at `root`. One path per
 * call: `-q` with two paths is fatal, and without it git exits 0 when only one is
 * ignored. Exit 0 ignored, 1 not; anything else throws with git's stderr, never
 * "not ignored".
 */
export function ignored(root, rel) {
  const r = spawnSync('git', ['check-ignore', '-q', '--', rel], {
    cwd: root,
    encoding: 'utf8',
    timeout: 5000,
  });
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  const detail = (r.stderr || r.error?.message || '').trim();
  throw new Error(messages.probeFailed(`git check-ignore ${rel}`, detail));
}

/** The real probes; doctor and init take overrides of any of them. */
export const PROBES = Object.freeze({ hasTool, claudeVersion, ignored });
