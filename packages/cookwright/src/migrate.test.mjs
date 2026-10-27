// src/migrate.test.mjs — `cookwright migrate [--dry-run]`: the 1 → 2, 2 → 3 and 3 → 4 steps
// written in the file's own layout, the dry run, an injected chain, and every
// refusal leaving the file byte for byte.

import fs from 'node:fs';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { CONFIG_FILE, loadConfig } from './lib/config.mjs';
import { messages } from './lib/messages.mjs';
import { MIGRATIONS } from './lib/migrations.mjs';
import { main } from './migrate.mjs';
import { gitInit, scratchRoot } from './test-helpers.mjs';

const m = messages.migrate;
const TMP = scratchRoot('cookwright-migrate-');
const STALE = { version: 1, level: 0, paths: { playbook: 'docs/playbook.md', backlog: 'docs/backlog.md' } };
/** The 2 → 3 step's line on a config without `packs`. */
const PACKS_ADDED = '2 → 3: packs added, empty (no stack pack declared; the setup skill offers the ones your tree shows)';
/** The 3 → 4 step's line on a config without `secrets`. */
const SECRETS_NONE = '3 → 4: no secrets backend declared, Level 2 off (the secrets guide shows the key)';

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

describe('1 → 2 → 3 → 4', () => {
  it('drops the stale playbook key, adds packs, writes version 4, and a second run is already current', () => {
    const root = repoWith(STALE);
    expect(migrate(root)).toBe(0);
    expect(out).toEqual([
      "1 → 2: paths.playbook dropped (docs/playbook.md was never written; the package's playbook applies)",
      PACKS_ADDED,
      SECRETS_NONE,
      'cookwright.json written at version 4',
    ]);
    const want = { version: 4, level: 0, paths: { backlog: 'docs/backlog.md' }, packs: [] };
    expect(read(root)).toBe(`${JSON.stringify(want, null, 2)}\n`);
    expect(Object.hasOwn(loadConfig(root), 'migratedFrom')).toBe(false);
    out.length = 0;
    const before = read(root);
    expect(migrate(root)).toBe(0);
    expect(out).toEqual(['cookwright.json: already at version 4']);
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
    expect(JSON.parse(read(root))).toEqual({ ...STALE, version: 4, packs: [] });
  });

  it('says there is nothing to change without the key', () => {
    const root = repoWith({ version: 1 });
    expect(migrate(root)).toBe(0);
    expect(out).toEqual(['1 → 2: nothing to change (no paths.playbook)', PACKS_ADDED, SECRETS_NONE, 'cookwright.json written at version 4']);
    expect(read(root)).toBe('{\n  "version": 4,\n  "packs": []\n}\n');
  });

  it('writes the key in when it is absent and a playbook is at the version-1 default', () => {
    const root = repoWith({ version: 1, level: 0 });
    fs.mkdirSync(path.join(root, 'docs'));
    fs.writeFileSync(path.join(root, 'docs/playbook.md'), 'mine');
    expect(migrate(root)).toBe(0);
    expect(out[0]).toBe('1 → 2: paths.playbook set to docs/playbook.md (your own playbook, which version 1 read when the key was absent)');
    expect(JSON.parse(read(root))).toEqual({ version: 4, level: 0, paths: { playbook: 'docs/playbook.md' }, packs: [] });
    expect(loadConfig(root).paths.playbook).toBe('docs/playbook.md');
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
      const want = JSON.stringify({ version: 4, level: 0, paths: { backlog: 'docs/backlog.md' }, packs: [] }, null, indent);
      expect(read(root)).toBe(want.split('\n').join(eol) + tail);
      expect(out.at(-1)).toBe(m.wrote(4, false));
      out.length = 0;
    }
  });

  it('says so when rewriting relays more than the keys, as a one-line array does', () => {
    const text = '{\n  "version": 1,\n  "hosts": ["claude"],\n  "paths": { "playbook": "docs/playbook.md" }\n}\n';
    const root = repoWith(text);
    expect(migrate(root)).toBe(0);
    expect(out.at(-1)).toBe(
      'cookwright.json written at version 4 (the file is rewritten in standard JSON layout, its indent kept)',
    );
    expect(read(root)).toBe('{\n  "version": 4,\n  "hosts": [\n    "claude"\n  ],\n  "packs": [],\n  "paths": {}\n}\n');
  });
});

describe('2 → 3', () => {
  const V2 = { version: 2, level: 0, hosts: ['claude'], baseBranch: 'main' };

  it('writes packs as an empty list after hosts, and never declares a pack', () => {
    const root = repoWith(V2);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { expo: '1' } }));
    expect(migrate(root)).toBe(0);
    expect(out).toEqual([PACKS_ADDED, SECRETS_NONE, 'cookwright.json written at version 4']);
    expect(Object.keys(JSON.parse(read(root)))).toEqual(['version', 'level', 'hosts', 'packs', 'baseBranch']);
    expect(loadConfig(root).packs).toEqual([]);
  });

  it('keeps a packs value already there, and leaves its judgment to the validator', () => {
    const root = repoWith({ ...V2, packs: [{ name: 'expo', rules: { size: false } }] });
    expect(migrate(root)).toBe(0);
    expect(out).toEqual(['2 → 3: packs kept as it is', SECRETS_NONE, 'cookwright.json written at version 4']);
    expect(JSON.parse(read(root)).packs).toEqual([{ name: 'expo', rules: { size: false } }]);
    out.length = 0;
    const bad = repoWith({ ...V2, packs: ['rails'] });
    const before = read(bad);
    expect(migrate(bad)).toBe(2);
    expect(err.at(-1)).toMatch(/^migrate: the migrated cookwright\.json would be invalid: packs: pack "rails" is not available/);
    expect(read(bad)).toBe(before);
  });
});

describe('3 → 4', () => {
  const V3 = { version: 3, level: 0, hosts: ['claude'], packs: [], baseBranch: 'main' };

  it('writes the version alone, no secrets key, every other key in place', () => {
    const root = repoWith(V3);
    expect(migrate(root)).toBe(0);
    expect(out).toEqual([SECRETS_NONE, 'cookwright.json written at version 4']);
    expect(read(root)).toBe(`${JSON.stringify({ ...V3, version: 4 }, null, 2)}\n`);
    expect(Object.hasOwn(loadConfig(root), 'secrets')).toBe(false);
  });

  it('keeps a secrets value already there, and leaves its judgment to the validator', () => {
    const secrets = { backend: 'age', targets: { dev: { names: ['API_KEY'] } } };
    const root = repoWith({ ...V3, secrets });
    expect(migrate(root)).toBe(0);
    expect(out).toEqual(['3 → 4: secrets kept as it is', 'cookwright.json written at version 4']);
    expect(loadConfig(root).secrets).toEqual(secrets);
    out.length = 0;
    const bad = repoWith({ ...V3, secrets: { backend: 'vault', targets: {} } });
    const before = read(bad);
    expect(migrate(bad)).toBe(2);
    expect(err.at(-1)).toBe(
      'migrate: the migrated cookwright.json would be invalid: secrets.backend must be one of age, keychain, 1password; nothing written',
    );
    expect(read(bad)).toBe(before);
  });
});

describe('--dry-run', () => {
  it('prints the steps and what it would write, and writes nothing', () => {
    const text = '{"version":1,"paths":{"playbook":"docs/playbook.md"}}';
    const root = repoWith(text);
    expect(migrate(root, ['--dry-run'])).toBe(0);
    expect(out).toEqual([
      "1 → 2: paths.playbook dropped (docs/playbook.md was never written; the package's playbook applies)",
      PACKS_ADDED,
      SECRETS_NONE,
      'dry run: cookwright.json would be written at version 4 (the file is rewritten in standard JSON layout, its indent kept); nothing written',
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
    expect(migrate(root, [], { migrations: { 0: step(0), 1: step(1), 2: step(2), 3: step(3) } })).toBe(0);
    expect(seen).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    expect(out).toEqual(['0 → 1: step0', '1 → 2: step1', '2 → 3: step2', '3 → 4: step3', 'cookwright.json written at version 4']);
    expect(JSON.parse(read(root))).toEqual({ version: 4, level: 0 });
  });

  it('refuses a result the validator refuses, the file byte for byte', () => {
    const root = repoWith(STALE);
    const before = read(root);
    const broken = { 1: (raw) => ({ raw: { ...raw, hosts: ['gemini'] }, outcome: 'x' }), 2: MIGRATIONS[2], 3: MIGRATIONS[3] };
    expect(migrate(root, [], { migrations: broken })).toBe(2);
    expect(err.at(-1)).toMatch(/^migrate: the migrated cookwright\.json would be invalid: hosts: host "gemini" .*; nothing written$/);
    expect(read(root)).toBe(before);
  });
});

describe('refusals, exit 2, nothing written', () => {
  it('refuses a newer version with the loader’s line', () => {
    const root = repoWith({ version: 5 });
    const before = read(root);
    expect(migrate(root)).toBe(2);
    expect(err).toEqual([
      "migrate: cookwright.json: version 5 is newer than this cookwright's 4: update cookwright (npm install cookwright@latest)",
    ]);
    expect(read(root)).toBe(before);
  });

  it('refuses a version no step starts from with the validator’s line', () => {
    for (const config of [{}, { version: 0 }, { version: '1' }]) {
      const root = repoWith(config);
      expect(migrate(root)).toBe(2);
      expect(err.at(-1)).toBe('migrate: cookwright.json: version must be 4');
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
  expect(JSON.parse(read(root)).version).toBe(4);
});
