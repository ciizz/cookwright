// src/lib/doctor/repo.mjs — what doctor's checks look at: the root, the invocation
// cwd, the config (or why it did not load), and whether git is here at all.
//
// No network, no npm, no stdin, no recursive walk: every read is a named file, and
// every git call is bounded by doctor's shared budget (budget.mjs).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CALL_CAP_MS, TimedOut, runBounded } from '../budget.mjs';
import { findRoot, loadConfig, workTreeRoot } from '../config.mjs';
import { messages } from '../messages.mjs';
import { fail, pass, skip } from '../verdict.mjs';

/**
 * git's exit status and output: a check decides what a failure means. The one throw
 * is TimedOut, when git outlasts the shared budget (budget.mjs) or `cap`, the per-call
 * ceiling (doctor's 1.5 s by default; the changelog and the hooks pass 60 s). Inside
 * a budget, the budget still bounds the call. `env` replaces the process's own (the
 * hook passes git's, GIT_INDEX_FILE included); absent, git inherits it.
 */
export function gitRun(root, args, { cap = CALL_CAP_MS, env } = {}) {
  const r = runBounded('git', args, env ? { cwd: root, env } : { cwd: root }, cap);
  if (r.timedOut) throw new TimedOut(`git ${args[0]}`);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
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

export const isLink = (p) => {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

/**
 * True when `a` and `b` are one file: the same inode (a symlink or a hard link),
 * or `a` a symlink naming `b` that does not exist yet.
 */
export function sameFile(a, b) {
  const id = (p) => {
    const st = stat(p);
    return st ? `${st.dev}:${st.ino}` : null;
  };
  if (id(a) !== null && id(a) === id(b)) return true;
  return isLink(a) && path.resolve(path.dirname(a), fs.readlinkSync(a)) === b;
}

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
export const oneLine = (message) => {
  const [head, ...rest] = message.split('\n').map((s) => s.trim());
  return rest.length ? `${head} ${rest.join('; ')}` : head;
};

/**
 * The repo doctor runs on, or null when no cookwright.json is found from `cwd` up
 * to the work tree's top. `home` is the user's home directory (its `.claude/` is the
 * user's own settings, never a project file); `env` the environment doctor runs in
 * and `platform` the OS, which the secrets rows read.
 */
export function openDoctorRepo(cwd, probes, { home = os.homedir(), env = process.env, platform = process.platform } = {}) {
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
  const paths = { root: real(root), top: top && real(top), cwd: real(cwd), home: real(home) };
  return { ...paths, env, platform, hasGit, workTree, config, configError };
}

/**
 * `repo.node_modules` (B-011): no file under the config root's node_modules is in
 * the index. One bounded `git ls-files --error-unmatch` whose stdout is discarded,
 * so a tracked tree of any size costs nothing to read: exit 0 is tracked, a FAIL
 * naming the untrack command (drift); exit 1 is nothing tracked.
 */
export function checkNodeModules(repo) {
  const m = messages.doctor.nodeModules;
  if (!repo.workTree) return skip(m.notWorkTree);
  const args = ['ls-files', '--error-unmatch', '--', 'node_modules'];
  const r = runBounded('git', args, { cwd: repo.root, stdio: ['ignore', 'ignore', 'pipe'] });
  if (r.timedOut) throw new TimedOut('git ls-files');
  if (r.status === 0) return fail(m.tracked);
  if (r.status === 1) return pass(m.ok);
  const detail = (r.stderr || r.error?.message || '').trim().split('\n')[0];
  throw new Error(messages.probeFailed('git ls-files', detail));
}
