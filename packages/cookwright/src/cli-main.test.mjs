// src/cli-main.test.mjs — the `cookwright` bin and its dispatcher: unknown commands,
// the hand-off to the bundle runner, and the bin reached through a symlink, the way
// node_modules/.bin/cookwright reaches it.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { dispatch } from './cli-main.mjs';
import { CONFIG_VERSION } from './lib/config.mjs';
import { CLI } from './lib/messages.mjs';
import { commit, scratchRepo, scratchRoot } from './test-helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '../bin/cookwright.mjs');
const TMP = scratchRoot('cookwright-cli-');

describe('dispatch', () => {
  const logs = [];
  const errors = [];
  let spies;
  beforeAll(() => {
    spies = [
      vi.spyOn(console, 'log').mockImplementation((...a) => logs.push(a.join(' '))),
      vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a.join(' '))),
    ];
  });
  afterAll(() => spies.forEach((s) => s.mockRestore()));
  afterEach(() => {
    logs.length = 0;
    errors.length = 0;
  });

  it('prints the usage and exits 2 on an unknown or missing command', async () => {
    expect(await dispatch(['bogus'])).toBe(2);
    expect(errors.at(-1)).toBe(`usage: ${CLI} <init|doctor|changelog|hook|migrate|bundle|standards|audit|packs|run|secrets> …`);
    expect(await dispatch([])).toBe(2);
    expect(await dispatch(['toString'])).toBe(2); // not an inherited property
  });

  it('hands `bundle` and the rest of argv to the bundle runner', async () => {
    const repo = scratchRepo(TMP, 'dispatch');
    commit(repo, { 'a/b.txt': 'x' }, 'init');
    expect(await dispatch(['bundle'], { cwd: repo.root })).toBe(2);
    expect(errors.at(-1)).toMatch(new RegExp(`^usage: ${CLI} bundle <init\\|status`));
    expect(await dispatch(['bundle', 'status'], { cwd: path.join(repo.root, 'a') })).toBe(0);
    expect(logs.join('\n')).toMatch(/no bundle state for this branch/);
  });

  it('hands `changelog` and its flags to the changelog command', async () => {
    const repo = scratchRepo(TMP, 'changelog');
    expect(await dispatch(['changelog', '--check'], { cwd: repo.root })).toBe(1);
    expect(errors.at(-1)).toMatch(/^CHANGELOG\.md: missing; /);
    expect(await dispatch(['changelog', '--check', '--adopt'], { cwd: repo.root })).toBe(2);
  });

  it('hands `migrate` and its flags to the migrate command', async () => {
    const repo = scratchRepo(TMP, 'migrate');
    expect(await dispatch(['migrate', '--dry-run'], { cwd: repo.root })).toBe(0);
    expect(logs.at(-1)).toBe(`cookwright.json: already at version ${CONFIG_VERSION}`);
    expect(await dispatch(['migrate', '--force'], { cwd: repo.root })).toBe(2);
    expect(errors.at(-1)).toBe(`usage: ${CLI} migrate [--dry-run]`);
  });

  it('hands `hook` and git’s arguments to the hook command', async () => {
    const repo = scratchRepo(TMP, 'hook');
    const probes = { hasTool: (bin) => bin === 'git' };
    const env = { PATH: process.env.PATH };
    expect(await dispatch(['hook', 'pre-commit', 'extra'], { cwd: repo.root, probes, env })).toBe(0);
    expect(logs.at(-2)).toMatch(/^pre-commit {2}SKIP {2}doc-sync {2}no doc-sync rules/);
    expect(logs.at(-1)).toBe('pre-commit  SKIP  standards  no packs declared');
    expect(await dispatch(['hook'], { cwd: repo.root })).toBe(2);
    expect(errors.at(-1)).toMatch(new RegExp(`^usage: ${CLI} hook <pre-commit\\|pre-push>`));
  });
});

describe('the bin', () => {
  it('exits with the dispatcher’s code when reached through a symlink', () => {
    const repo = scratchRepo(TMP, 'bin');
    commit(repo, { 'x.txt': 'x' }, 'init');
    const link = path.join(TMP, 'cookwright-link.mjs');
    fs.symlinkSync(BIN, link);
    const node = (...argv) =>
      spawnSync(process.execPath, [link, ...argv], { cwd: repo.root, encoding: 'utf8' });

    const bogus = node('bogus');
    expect(bogus.status).toBe(2);
    expect(bogus.stderr).toMatch(/^usage: /);
    const status = node('bundle', 'status');
    expect(status.status).toBe(0);
    expect(status.stdout).toMatch(/no bundle state for this branch/);
  });
});
