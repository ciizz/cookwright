// src/lib/init/repo.mjs — where init runs: the root, the invocation cwd (the host
// scan starts there), the home directory, and the base branch it would configure.

import fs from 'node:fs';
import os from 'node:os';

import { Refusal } from '../cli.mjs';
import { findRoot, workTreeRoot } from '../config.mjs';
import { gitRun } from '../doctor/repo.mjs';
import { messages } from '../messages.mjs';

const m = messages.init;

const real = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
};

/**
 * The directory holding cookwright.json found upward from `cwd`, bounded by the
 * work tree, else the work tree's top (`top`, where the git hooks go). Not a work
 * tree (or no git): refused.
 */
export function openInitRepo(cwd, { home = os.homedir() } = {}) {
  const top = workTreeRoot(cwd);
  if (!top) throw new Refusal(m.notWorkTree(cwd));
  const root = findRoot(cwd, { stopAt: top }) ?? top;
  // Real paths, so the host scan's home test and its relative names hold through a
  // symlinked temp or home directory (doctor does the same).
  return { root: real(root), top: real(top), cwd: real(cwd), home: real(home), config: null };
}

/** git's answer to a yes/no question: exit 0 yes, 1 no, anything else refuses. */
function gitAsks(root, args) {
  const r = gitRun(root, args);
  if (r.status === 0 || r.status === 1) return r;
  throw new Refusal(m.gitFailed(args[0], r.stderr.trim() || `exit ${r.status}`));
}

/**
 * `--base` (refused unless git takes it as a branch name), else an existing `main`, else `master`, else the checked-out branch
 * (symbolic-ref works on an unborn HEAD), else `main`.
 */
export function detectBase(root, flag) {
  if (flag !== undefined) {
    if (gitRun(root, ['check-ref-format', '--branch', flag]).status !== 0) throw new Refusal(m.badBase(flag));
    return flag;
  }
  for (const name of ['main', 'master']) {
    if (gitAsks(root, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`]).status === 0) return name;
  }
  const head = gitAsks(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  return head.status === 0 && head.stdout.trim() ? head.stdout.trim() : 'main';
}
