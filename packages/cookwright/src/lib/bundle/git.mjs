// src/lib/bundle/git.mjs — the few git reads the bundle CLI needs.
//
// Every helper takes `cwd` so the tests can point it at a scratch repository; the
// one that needs to know what counts as code takes `repo` = { root, config }.

import { spawnSync } from 'node:child_process';

import { nonCodePathspecs } from '../config.mjs';

/** Run git with output captured; throws with git's stderr on a non-zero exit. */
export function git(args, { cwd = process.cwd(), allowFail = false, raw = false } = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 60_000 });
  if (r.status !== 0 && !allowFail) {
    throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || '').trim()}`);
  }
  if (r.status !== 0) return null;
  return raw ? r.stdout : r.stdout.trim();
}

export const head = (cwd) => git(['rev-parse', 'HEAD'], { cwd });

/** The checked-out branch name, or null on a detached HEAD. */
export function currentBranch(cwd) {
  const name = git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
  return name === 'HEAD' ? null : name;
}

export const mergeBase = (a, b, cwd) => git(['merge-base', a, b], { cwd });

/**
 * Paths with uncommitted changes (staged, unstaged or untracked), excluding the
 * given path prefixes — the bundle's own state writes must not make a gate refuse.
 *
 * `-z` porcelain: NUL-separated and never quoted, so a path with a space or a
 * non-ASCII character still matches its prefix. A rename contributes BOTH sides —
 * `git mv src/x.ts <bundles>/x.ts` deletes a source file, and hiding that would
 * let a gate record a commit its checks never saw.
 */
export function dirtyPaths(cwd, { exclude = [] } = {}) {
  const out = git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd, raw: true });
  const fields = out.split('\0').filter(Boolean);
  const paths = [];
  for (let i = 0; i < fields.length; i += 1) {
    const entry = fields[i];
    paths.push(entry.slice(3));
    // In -z mode a rename/copy's ORIGINAL path is the next field, with no status.
    if (/^[RC]/.test(entry)) paths.push(fields[(i += 1)]);
  }
  return paths.filter((p) => !exclude.some((prefix) => p.startsWith(prefix)));
}

/** True when `a` is `b` or an ancestor of it. */
export function isAncestor(a, b, cwd) {
  return git(['merge-base', '--is-ancestor', a, b], { cwd, allowFail: true }) !== null;
}

/** The newest commit in from..to touching any of `paths`, or null. */
export function lastCommitTouching(from, to, paths, cwd) {
  return git(['log', '-1', '--format=%H', `${from}..${to}`, '--', ...paths], { cwd }) || null;
}

/** Files changed between two commits (names only, renames split). */
export function changedFiles(from, to, cwd) {
  const out = git(['diff', '--name-only', '--no-renames', `${from}..${to}`], { cwd });
  return out ? out.split('\n') : [];
}

/**
 * The newest CODE commit in from..to — code being everything outside the configured
 * state homes (see `nonCodePathspecs`). Returns `from` when there is none.
 */
export function lastCodeCommit(from, to, repo) {
  const pathspec = ['.', ...nonCodePathspecs(repo.config)];
  const out = git(['log', '-1', '--format=%H', `${from}..${to}`, '--', ...pathspec], {
    cwd: repo.root,
  });
  return out || from;
}
