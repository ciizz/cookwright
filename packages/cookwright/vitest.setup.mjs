// vitest.setup.mjs — runs in every test worker before a test file loads. Not shipped
// (the package's `files` names bin, src and schema only).
//
// git's global and system config are isolated for the whole suite: a contributor
// whose own config sets core.hooksPath (a global hook manager), a signing key or a
// default branch must see the same results as a clean machine. A test that needs a
// global config points GIT_CONFIG_GLOBAL at its own scratch file.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cookwright-gitconfig-'));
const global = path.join(dir, 'gitconfig');
fs.writeFileSync(global, '');

process.env.GIT_CONFIG_GLOBAL = global;
process.env.GIT_CONFIG_NOSYSTEM = '1';
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

// Yield to the event loop after every test. The tests are synchronous (spawnSync,
// sync fs), and between tests the runner only awaits microtasks, so a file of them
// never reaches the loop's poll phase until the file ends. The worker reports each
// test to the main process over an RPC with a 60 s timer; when a file runs past
// 60 s under load, Node fires that due timer before it reads the reply that has
// already arrived, and vitest exits 1 on a green suite (B-015). One setImmediate
// per test lets every reply be read while its timer is still live.
afterEach(() => new Promise((resolve) => setImmediate(resolve)));
