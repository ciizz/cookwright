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

/** A scratch git repo `parent/name` with a cookwright.json (defaults unless overridden), as `repo`. */
export function scratchRepo(parent, name, config = {}) {
  const dir = gitInit(path.join(parent, name));
  fs.writeFileSync(path.join(dir, CONFIG_FILE), JSON.stringify({ version: 1, ...config }));
  return { root: dir, config: loadConfig(dir) };
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
