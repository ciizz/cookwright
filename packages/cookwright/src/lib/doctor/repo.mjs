// src/lib/doctor/repo.mjs — what doctor's checks look at: the root, the invocation
// cwd, the config (or why it did not load), and whether git is here at all.
//
// No network, no npm, no stdin, no recursive walk: every read is a named file, and
// every git call is short and bounded by a timeout that fits doctor's budget.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { findRoot, loadConfig, workTreeRoot } from '../config.mjs';

/** git's exit status and output, never a throw: a check decides what a failure means. */
export function gitRun(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 5000 });
  return { status: r.error ? null : r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const stat = (p) => {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
};
export const isFile = (p) => stat(p)?.isFile() ?? false;
export const isDir = (p) => stat(p)?.isDirectory() ?? false;

const real = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

/** A file's text with CRLF normalised to LF. */
export const readLF = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

/** The loader's message as one line: `cookwright.json: problem; problem`. */
const oneLine = (message) => {
  const [head, ...rest] = message.split('\n').map((s) => s.trim());
  return rest.length ? `${head} ${rest.join('; ')}` : head;
};

/**
 * The repo doctor runs on, or null when no cookwright.json is found from `cwd` up
 * to the work tree's top. `home` is the user's home directory (its `.claude/` is the
 * user's own settings, never a project file).
 */
export function openDoctorRepo(cwd, probes, { home = os.homedir() } = {}) {
  const hasGit = probes.hasTool('git');
  const top = hasGit ? workTreeRoot(cwd) : null;
  const root = findRoot(cwd, { stopAt: top ?? undefined });
  if (!root) return null;
  let config = null;
  let configError = null;
  try {
    config = loadConfig(root);
  } catch (err) {
    configError = oneLine(err.message);
  }
  const inside = hasGit && gitRun(root, ['rev-parse', '--is-inside-work-tree']);
  const workTree = Boolean(inside) && inside.status === 0 && inside.stdout.trim() === 'true';
  // Real paths throughout, so the scan's home test and its relative names hold
  // through a symlinked temp or home directory.
  return { root: real(root), cwd: real(cwd), home: real(home), hasGit, workTree, config, configError };
}
