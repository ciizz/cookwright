// src/test-helpers.mjs — scratch git repositories for the tests. Not shipped (the
// package's `files` excludes it). Every repo lives under a temp root the caller
// owns, so nothing touches this checkout.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { fileURLToPath } from 'node:url';

import { afterAll } from 'vitest';

import { CONFIG_FILE, CONFIG_VERSION, loadConfig } from './lib/config.mjs';

/** This package's own directory, the target of `linkPackage`. */
export const PACKAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
  fs.writeFileSync(path.join(dir, CONFIG_FILE), JSON.stringify({ version: CONFIG_VERSION, ...config }));
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

/** The agent's rules v4 added to the block's Secrets section (stage 5), up to the next section. */
const RUN_RULES = /(Name the secret instead\.)\n- When `cookwright\.json` declares `secrets`[\s\S]*?(\n\n## Conventions)/;

/** The managed block as v3 shipped it (stage 3), from a v4 render: the v3 marker, no `run` rules. */
export function v3Block(v4) {
  const out = v4
    .replace(/^<!-- cookwright:begin rules v4 -->$/m, '<!-- cookwright:begin rules v3 -->')
    .replace(RUN_RULES, '$1$2');
  if (/rules v4|cookwright run|secrets set/.test(out)) throw new Error('v3Block: the v4 render changed shape');
  return out;
}

/** The sentence v3 added to the block's Session start (stage 3). */
const SETUP_SENTENCE = / On a FAIL whose line does not clear it, on an update, or when the developer asks, the `setup` skill walks doctor's readout\./;

/** The managed block as v2 shipped it (stage 2), from a v4 render: the v2 marker, no setup sentence. */
export function v2Block(v4) {
  const out = v3Block(v4)
    .replace(/^<!-- cookwright:begin rules v3 -->$/m, '<!-- cookwright:begin rules v2 -->')
    .replace(SETUP_SENTENCE, '');
  if (/rules v3|`setup` skill/.test(out)) throw new Error('v2Block: the v3 render changed shape');
  return out;
}

/**
 * The managed block as v1 shipped it (stage 1), from a v4 render: the v1 marker,
 * the hand-kept changelog line, no doc-sync enforcement, no Git hooks section.
 */
export function v1Block(v4) {
  const v2 = v2Block(v4);
  const out = v2
    .replace(/^<!-- cookwright:begin rules v2 -->$/m, '<!-- cookwright:begin rules v1 -->')
    .replace(/^- User-visible changes: .*$/m, '- User-visible changes: the Unreleased section of `CHANGELOG.md`.')
    .replace(/ The pre-commit hook enforces .*$/m, '')
    .replace(/^## Git hooks\n\n.*\n\n/m, '');
  if (out === v2 || /COOKWRIGHT_SKIP|rules v2/.test(out)) throw new Error('v1Block: the v2 render changed shape');
  return out;
}

/**
 * Install this package at `dir/node_modules/cookwright` as a symlink, the way a
 * workspace link does, and hide `node_modules` from git in the repo `dir` is in.
 */
export function linkPackage(dir) {
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  fs.symlinkSync(PACKAGE, path.join(dir, 'node_modules/cookwright'));
  const exclude = run(dir, 'git', ['rev-parse', '--git-path', 'info/exclude']);
  fs.mkdirSync(path.dirname(path.resolve(dir, exclude)), { recursive: true });
  fs.appendFileSync(path.resolve(dir, exclude), 'node_modules\n');
  return dir;
}

/** The test-only stand-in for ESLint's Node API (src/test-fixtures/fake-eslint). */
export const FAKE_ESLINT = path.join(PACKAGE, 'src/test-fixtures/fake-eslint');

/** An eslint.config.js spreading the packs' exports, the expo one with the plugin resolved from the repo. */
export const PACK_ESLINT_CONFIG = [
  "const expo = require('cookwright/packs/expo/eslint.cjs');",
  "const withPlugin = expo.withResolver((id) => require.resolve(id));",
  "module.exports = [...withPlugin, ...require('cookwright/packs/supabase/eslint.cjs')];",
  '',
].join('\n');

/**
 * Make `dir` a repo the standards engine measures with the fake ESLint: the fake at
 * node_modules/eslint, this package at node_modules/cookwright (both links, hidden
 * from git), `eslint.config.js` written with `config` (PACK_ESLINT_CONFIG by
 * default; null writes none) and, with `plugin`, a stub eslint-plugin-i18next.
 */
export function fakeEslintRepo(dir, { config = PACK_ESLINT_CONFIG, plugin = true, eslint = FAKE_ESLINT } = {}) {
  const modules = path.join(dir, 'node_modules');
  fs.mkdirSync(modules, { recursive: true });
  if (eslint) fs.symlinkSync(eslint, path.join(modules, 'eslint'));
  if (!fs.existsSync(path.join(modules, 'cookwright'))) fs.symlinkSync(PACKAGE, path.join(modules, 'cookwright'));
  if (plugin) {
    fs.mkdirSync(path.join(modules, 'eslint-plugin-i18next'));
    fs.writeFileSync(path.join(modules, 'eslint-plugin-i18next/package.json'), '{ "name": "eslint-plugin-i18next", "version": "6.1.5" }\n');
    fs.writeFileSync(path.join(modules, 'eslint-plugin-i18next/index.js'), 'module.exports = { rules: {} };\n');
  }
  if (config !== null) fs.writeFileSync(path.join(dir, 'eslint.config.js'), config);
  const exclude = run(dir, 'git', ['rev-parse', '--git-path', 'info/exclude']);
  fs.mkdirSync(path.dirname(path.resolve(dir, exclude)), { recursive: true });
  fs.appendFileSync(path.resolve(dir, exclude), 'node_modules\n');
  return dir;
}
