// src/migrate.test.mjs — `cookwright migrate [--dry-run]`: the 1 → 2 step written in
// the file's own layout, the dry run, an injected chain, and every refusal leaving
// the file byte for byte.

import fs from 'node:fs';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { CONFIG_FILE, loadConfig } from './lib/config.mjs';
import { messages } from './lib/messages.mjs';
import { main } from './migrate.mjs';
import { gitInit, scratchRoot } from './test-helpers.mjs';

const m = messages.migrate;
const TMP = scratchRoot('cookwright-migrate-');
const STALE = { version: 1, level: 0, paths: { playbook: 'docs/playbook.md', backlog: 'docs/backlog.md' } };

const out = [];
const err = [];
let spies;
beforeAll(() => {
  spies = [
    vi.spyOn(console, 'log').mockImplementation((...a) => out.push(a.join(' '))),
    vi.spyOn(console, 'error').mockImplementation((...a) => err.push(a.join(' '))),
  ];
});
afterAll(() => spies.forEach((s) => s.mockRestore()));
afterEach(() => {
  out.length = 0;
  err.length = 0;
});

let n = 0;
/** A git repo whose cookwright.json is `text` (an object is written with two-space JSON). */
function repoWith(text) {
  const root = gitInit(path.join(TMP, `r${(n += 1)}`));
  const body = typeof text === 'string' ? text : `${JSON.stringify(text, null, 2)}\n`;
  fs.writeFileSync(path.join(root, CONFIG_FILE), body);
  return root;
}
const read = (root) => fs.readFileSync(path.join(root, CONFIG_FILE), 'utf8');
const migrate = (root, argv = [], io = {}) => main(argv, { cwd: root, ...io });

describe('1 → 2', () => {
  it('drops the stale playbook key, writes version 2, and a second run is already current', () => {
    const root = repoWith(STALE);
    expect(migrate(root)).toBe(0);
    expect(out).toEqual([
      "1 → 2: paths.playbook dropped (docs/playbook.md was never written; the package's playbook applies)",
      'cookwright.json written at version 2',
    ]);
    expect(read(root)).toBe(`${JSON.stringify({ version: 2, level: 0, paths: { backlog: 'docs/backlog.md' } }, null, 2)}\n`);
    expect(Object.hasOwn(loadConfig(root), 'migratedFrom')).toBe(false);
    out.length = 0;
    const before = read(root);
    expect(migrate(root)).toBe(0);
    expect(out).toEqual(['cookwright.json: already at version 2']);
    expect(read(root)).toBe(before);
  });

  it('keeps the file’s mode and leaves no temporary file', () => {
    const root = repoWith(STALE);
    fs.chmodSync(path.join(root, CONFIG_FILE), 0o640);
    expect(migrate(root)).toBe(0);
    expect(fs.statSync(path.join(root, CONFIG_FILE)).mode & 0o777).toBe(0o640);
    expect(fs.readdirSync(root).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('keeps the key when the playbook is there', () => {
    const root = repoWith(STALE);
    fs.mkdirSync(path.join(root, 'docs'));
    fs.writeFileSync(path.join(root, 'docs/playbook.md'), 'mine');
    expect(migrate(root)).toBe(0);
    expect(out[0]).toBe('1 → 2: paths.playbook kept (docs/playbook.md, your own playbook)');
    expect(JSON.parse(read(root))).toEqual({ ...STALE, version: 2 });
  });

  it('says there is nothing to change without the key', () => {
    const root = repoWith({ version: 1 });
    expect(migrate(root)).toBe(0);
    expect(out).toEqual(['1 → 2: nothing to change (no paths.playbook)', 'cookwright.json written at version 2']);
    expect(read(root)).toBe('{\n  "version": 2\n}\n');
  });

  it('keeps the file’s indent, CRLF line endings and missing final newline', () => {
    const tab = `${JSON.stringify(STALE, null, '\t')}\n`;
    const crlf = JSON.stringify(STALE, null, 4).split('\n').join('\r\n');
    for (const [text, indent, eol, tail] of [
      [tab, '\t', '\n', '\n'],
      [crlf, 4, '\r\n', ''],
    ]) {
      const root = repoWith(text);
      expect(migrate(root)).toBe(0);
      const want = JSON.stringify({ version: 2, level: 0, paths: { backlog: 'docs/backlog.md' } }, null, indent);
      expect(read(root)).toBe(want.split('\n').join(eol) + tail);
      expect(out.at(-1)).toBe(m.wrote(2, false));
      out.length = 0;
    }
  });

  it('says so when rewriting relays more than the keys, as a one-line array does', () => {
    const text = '{\n  "version": 1,\n  "hosts": ["claude"],\n  "paths": { "playbook": "docs/playbook.md" }\n}\n';
    const root = repoWith(text);
    expect(migrate(root)).toBe(0);
    expect(out.at(-1)).toBe(
      'cookwright.json written at version 2 (the file is rewritten in standard JSON layout, its indent kept)',
    );
    expect(read(root)).toBe('{\n  "version": 2,\n  "hosts": [\n    "claude"\n  ],\n  "paths": {}\n}\n');
  });
});

describe('--dry-run', () => {
  it('prints the steps and what it would write, and writes nothing', () => {
    const text = '{"version":1,"paths":{"playbook":"docs/playbook.md"}}';
    const root = repoWith(text);
    expect(migrate(root, ['--dry-run'])).toBe(0);
    expect(out).toEqual([
      "1 → 2: paths.playbook dropped (docs/playbook.md was never written; the package's playbook applies)",
      'dry run: cookwright.json would be written at version 2 (the file is rewritten in standard JSON layout, its indent kept); nothing written',
    ]);
    expect(read(root)).toBe(text);
  });
});

describe('an injected chain', () => {
  it('runs every step in order from the file’s version, one line each', () => {
    const seen = [];
    const step = (k) => (raw) => {
      seen.push([k, raw.version]);
      return { raw: { ...raw, level: 0 }, outcome: `step${k}` };
    };
    const root = repoWith({ version: 0 });
    expect(migrate(root, [], { migrations: { 0: step(0), 1: step(1) } })).toBe(0);
    expect(seen).toEqual([
      [0, 0],
      [1, 1],
    ]);
    expect(out).toEqual(['0 → 1: step0', '1 → 2: step1', 'cookwright.json written at version 2']);
    expect(JSON.parse(read(root))).toEqual({ version: 2, level: 0 });
  });

  it('refuses a result the validator refuses, the file byte for byte', () => {
    const root = repoWith(STALE);
    const before = read(root);
    const broken = { 1: (raw) => ({ raw: { ...raw, hosts: ['gemini'] }, outcome: 'x' }) };
    expect(migrate(root, [], { migrations: broken })).toBe(2);
    expect(err.at(-1)).toMatch(/^migrate: the migrated cookwright\.json would be invalid: hosts: host "gemini" .*; nothing written$/);
    expect(read(root)).toBe(before);
  });
});

describe('refusals, exit 2, nothing written', () => {
  it('refuses a newer version with the loader’s line', () => {
    const root = repoWith({ version: 3 });
    const before = read(root);
    expect(migrate(root)).toBe(2);
    expect(err).toEqual([
      "migrate: cookwright.json: version 3 is newer than this cookwright's 2: update cookwright (npm install cookwright@latest)",
    ]);
    expect(read(root)).toBe(before);
  });

  it('refuses a version no step starts from with the validator’s line', () => {
    for (const config of [{}, { version: 0 }, { version: '1' }]) {
      const root = repoWith(config);
      expect(migrate(root)).toBe(2);
      expect(err.at(-1)).toBe('migrate: cookwright.json: version must be 2');
      expect(JSON.parse(read(root))).toEqual(config);
    }
  });

  it('refuses a write that fails, the file byte for byte and no temporary file left', () => {
    if (process.getuid?.() === 0) return; // root writes into a read-only directory
    const root = repoWith(STALE);
    const before = read(root);
    fs.chmodSync(root, 0o555);
    try {
      expect(migrate(root)).toBe(2);
    } finally {
      fs.chmodSync(root, 0o755);
    }
    expect(err.at(-1)).toBe(`migrate: ${m.writeFailed('EACCES')}`);
    expect(read(root)).toBe(before);
    expect(fs.readdirSync(root).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('refuses a config that is a symbolic link, the target untouched', () => {
    const root = gitInit(path.join(TMP, 'linked'));
    const target = path.join(TMP, 'elsewhere.json');
    fs.writeFileSync(target, JSON.stringify(STALE));
    fs.symlinkSync(target, path.join(root, CONFIG_FILE));
    expect(migrate(root)).toBe(2);
    expect(err.at(-1)).toBe(`migrate: ${m.symlink(CONFIG_FILE)}`);
    expect(fs.readFileSync(target, 'utf8')).toBe(JSON.stringify(STALE));
  });

  it('refuses no config, unparsable JSON and a non-object', () => {
    const bare = gitInit(path.join(TMP, 'bare'));
    expect(migrate(bare)).toBe(2);
    expect(err.at(-1)).toBe(`migrate: ${m.noConfig(bare)}`);
    expect(migrate(repoWith('{ nope'))).toBe(2);
    expect(err.at(-1)).toMatch(/^migrate: cookwright\.json: /);
    expect(migrate(repoWith('[]'))).toBe(2);
    expect(err.at(-1)).toBe(`migrate: ${m.notObject}`);
  });

  it('refuses an unknown flag, a positional or a value after --dry-run, with the usage', () => {
    const root = repoWith(STALE);
    const before = read(root);
    expect(migrate(root, ['--force'])).toBe(2);
    expect(err).toEqual(['migrate: unknown flag --force (known: --dry-run)', m.usage]);
    for (const argv of [['now'], ['--dry-run', 'yes']]) {
      err.length = 0;
      expect(migrate(root, argv)).toBe(2);
      expect(err).toEqual([`migrate: ${m.usage}`]);
    }
    expect(m.usage).toBe('usage: npx cookwright migrate [--dry-run]');
    expect(read(root)).toBe(before);
  });
});

it('finds the config from a subdirectory, as doctor does', () => {
  const root = repoWith(STALE);
  fs.mkdirSync(path.join(root, 'src/deep'), { recursive: true });
  expect(migrate(path.join(root, 'src/deep'))).toBe(0);
  expect(JSON.parse(read(root)).version).toBe(2);
});
