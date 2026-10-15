// src/test-helpers.mjs — scratch git repositories for the tests. Not shipped (the
// package's `files` excludes it). Every repo lives under a temp root the caller
// owns, so nothing touches this checkout.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll } from 'vitest';

import { CONFIG_FILE, loadConfig } from './lib/config.mjs';

/** A command's trimmed stdout; throws on a non-zero exit. */
export const run = (cwd, cmd, args) => execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim();

/** A fresh temp directory, removed after the calling test file. */
export function scratchRoot(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** An empty git repo at `dir` on `main`, with a local identity and no signing. */
export function gitInit(dir) {
  fs.mkdirSync(dir, { recursive: true });
  run(dir, 'git', ['init', '-q', '-b', 'main']);
  run(dir, 'git', ['config', 'user.email', 't@example.invalid']);
  run(dir, 'git', ['config', 'user.name', 'test']);
  run(dir, 'git', ['config', 'commit.gpgsign', 'false']);
  return dir;
}

/**
 * A directory holding a `git` that refuses `--show-scope` as git before 2.26 does
 * (a usage error, exit 129) and runs the real git for anything else. Put it first
 * on PATH to play an old git.
 */
export function gitWithoutScopes(parent) {
  const real = run(parent, 'sh', ['-c', 'command -v git']);
  const dir = path.join(parent, `old-git-${process.pid}`);
  fs.mkdirSync(dir, { recursive: true });
  const script = [
    '#!/bin/sh',
    'for a in "$@"; do',
    '  [ "$a" = "--show-scope" ] && { echo "error: unknown option show-scope" >&2; exit 129; }',
    'done',
    `exec '${real}' "$@"`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'git'), script, { mode: 0o755 });
  return dir;
}

/** A scratch git repo `parent/name` with a cookwright.json (defaults unless overridden), as `repo`. */
export function scratchRepo(parent, name, config = {}) {
  const dir = gitInit(path.join(parent, name));
  fs.writeFileSync(path.join(dir, CONFIG_FILE), JSON.stringify({ version: 1, ...config }));
  return { root: dir, config: loadConfig(dir) };
}

/**
 * Stage `rel` as an empty file without writing it: an index entry only. The rules
 * forbid a plaintext env file on disk even in a test, so a tracked `.env` is played
 * this way.
 */
export function stageOnly(root, rel) {
  const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: root, input: '', encoding: 'utf8' }).trim();
  run(root, 'git', ['update-index', '--add', '--cacheinfo', `100644,${blob},${rel}`]);
}

/** Write `files` (root-relative path → body), stage everything, commit; returns the sha. */
export function commit(repo, files, msg) {
  const dir = repo.root;
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  run(dir, 'git', ['add', '-A']);
  run(dir, 'git', ['commit', '-q', '--no-verify', '-m', msg]);
  return run(dir, 'git', ['rev-parse', 'HEAD']);
}

/**
 * The managed block as v1 shipped it (stage 1), from a v2 render: the v1 marker,
 * the hand-kept changelog line, no doc-sync enforcement, no Git hooks section.
 */
export function v1Block(v2) {
  const out = v2
    .replace(/^<!-- cookwright:begin rules v2 -->$/m, '<!-- cookwright:begin rules v1 -->')
    .replace(/^- User-visible changes: .*$/m, '- User-visible changes: the Unreleased section of `CHANGELOG.md`.')
    .replace(/ The pre-commit hook enforces .*$/m, '')
    .replace(/^## Git hooks\n\n.*\n\n/m, '');
  if (out === v2 || /COOKWRIGHT_SKIP|rules v2/.test(out)) throw new Error('v1Block: the v2 render changed shape');
  return out;
}
