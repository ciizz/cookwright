// src/lib/config.test.mjs — cookwright.json: discovery, defaults, every refusal, and
// the schema staying in step with the validator.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import {
  CONFIG_FILE,
  CONFIG_VERSION,
  DEFAULTS,
  KNOWN_KEYS,
  OPTIONAL_PATHS,
  applyMigrations,
  findRoot,
  loadConfig,
  nonCodePathspecs,
  unknownMagic,
  validateConfig,
  withDefaults,
  workTreeRoot,
} from './config.mjs';
import {
  KNOWN_HOSTS,
  installedPackage,
  playbookPath,
  rulesFiles,
  workflowHosts,
  workflowScript,
} from './hosts.mjs';
import { KNOWN_LEVELS } from './levels.mjs';
import { MIGRATIONS } from './migrations.mjs';
import { gitInit, linkPackage } from '../test-helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = JSON.parse(
  fs.readFileSync(path.join(HERE, '../../schema/cookwright.schema.json'), 'utf8'),
);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cookwright-config-'));
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

function repoWith(name, config) {
  const dir = path.join(TMP, name);
  fs.mkdirSync(path.join(dir, 'a/b'), { recursive: true });
  const body = typeof config === 'string' ? config : JSON.stringify(config);
  fs.writeFileSync(path.join(dir, CONFIG_FILE), body);
  return dir;
}

const valid = () => withDefaults({ version: CONFIG_VERSION });

describe('findRoot', () => {
  it('walks up from a nested directory to the config', () => {
    const dir = repoWith('nested', { version: CONFIG_VERSION });
    expect(fs.realpathSync(findRoot(path.join(dir, 'a/b')))).toBe(fs.realpathSync(dir));
  });

  it('returns null outside any cookwright repo', () => {
    const dir = path.join(TMP, 'bare/x');
    fs.mkdirSync(dir, { recursive: true });
    expect(findRoot(dir)).toBeNull();
  });

  it('never climbs past the work tree: an enclosing directory’s config is not this repo’s', () => {
    const outer = repoWith('enclosing', { version: CONFIG_VERSION });
    const inner = gitInit(path.join(outer, 'a/inner'));
    fs.mkdirSync(path.join(inner, 'src'));
    const top = workTreeRoot(path.join(inner, 'src'));
    expect(fs.realpathSync(top)).toBe(fs.realpathSync(inner));
    expect(findRoot(path.join(inner, 'src'), { stopAt: top })).toBeNull();
    // Unbounded, the walk would have found the enclosing one.
    expect(fs.realpathSync(findRoot(inner))).toBe(fs.realpathSync(outer));
    // A config at the work tree's top is still found from below it.
    fs.writeFileSync(path.join(inner, CONFIG_FILE), JSON.stringify({ version: CONFIG_VERSION }));
    expect(findRoot(path.join(inner, 'src'), { stopAt: top })).toBe(inner);
  });

  it('has no work tree outside git', () => {
    expect(workTreeRoot(path.join(TMP, 'bare/x'))).toBeNull();
  });
});

describe('loadConfig', () => {
  it('applies the defaults one level deep', () => {
    const dir = repoWith('defaults', { version: CONFIG_VERSION, paths: { bundles: 'state/bundles' } });
    const config = loadConfig(dir);
    expect(config.level).toBe(0);
    expect(config.paths.changelog).toBe('CHANGELOG.md');
    expect(config.hosts).toEqual(['claude']);
    expect(config.baseBranch).toBe('main');
    expect(config.paths).toEqual({ ...DEFAULTS.paths, bundles: 'state/bundles' });
    expect(config.gate).toEqual({ checks: [], flakes: {} });
    expect(config.hooks).toEqual({ docSync: [] });
    expect(config.ci).toBeUndefined();
  });

  it('names a missing, unparsable or non-object file, and requires version', () => {
    expect(() => loadConfig(path.join(TMP, 'nowhere'))).toThrow(/not found/);
    expect(() => loadConfig(repoWith('broken', '{ nope'))).toThrow(/cookwright\.json: /);
    expect(() => loadConfig(repoWith('array', '[]'))).toThrow(/must be a JSON object/);
    expect(() => loadConfig(repoWith('null', 'null'))).toThrow(/must be a JSON object/);
    expect(() => loadConfig(repoWith('empty', {}))).toThrow(`version must be ${CONFIG_VERSION}`);
  });

  it('refuses a paths, gate or hooks that is not an object instead of defaulting it', () => {
    for (const value of ['disabled', [], null]) {
      for (const [key, line] of [
        ['hooks', 'hooks must be an object'],
        ['gate', 'gate must be an object'],
        ['paths', 'paths must be an object'],
      ]) {
        const dir = repoWith(`not-object-${key}-${JSON.stringify(value).replace(/\W/g, '') || 'x'}`, {
          version: CONFIG_VERSION,
          [key]: value,
        });
        expect(() => loadConfig(dir)).toThrow(line);
      }
    }
  });

  it('normalizes a trailing slash so the gate’s dirty-path exclusion matches', () => {
    const dir = repoWith('slash', { version: CONFIG_VERSION, paths: { bundles: 'state/bundles/' } });
    expect(loadConfig(dir).paths.bundles).toBe('state/bundles');
  });

  it('reports every problem at once', () => {
    const dir = repoWith('bad', { version: 0, hosts: [], baseBranch: '', typo: 1 });
    expect(() => loadConfig(dir)).toThrow(
      /unknown key "typo"[\s\S]*version must be 2[\s\S]*hosts must be a non-empty list[\s\S]*baseBranch/,
    );
  });
});

describe('an older version, migrated in memory', () => {
  const stale = { version: 1, paths: { playbook: 'docs/playbook.md' } };

  it('loads a version-1 config with the stale playbook key dropped, and says it migrated', () => {
    const dir = repoWith('v1-stale', stale);
    const config = loadConfig(dir);
    expect(config.version).toBe(CONFIG_VERSION);
    expect(config.paths.playbook).toBeUndefined();
    expect(config.migratedFrom).toBe(1);
    expect(JSON.parse(fs.readFileSync(path.join(dir, CONFIG_FILE), 'utf8'))).toEqual(stale); // nothing written
  });

  it('keeps the key when a playbook is there, or when it names another path', () => {
    const dir = repoWith('v1-own', stale);
    fs.mkdirSync(path.join(dir, 'docs'));
    fs.writeFileSync(path.join(dir, 'docs/playbook.md'), 'mine');
    expect(loadConfig(dir).paths.playbook).toBe('docs/playbook.md');
    expect(loadConfig(dir).migratedFrom).toBe(1);
    const other = repoWith('v1-other', { version: 1, paths: { playbook: 'ops/playbook.md' } });
    expect(loadConfig(other).paths.playbook).toBe('ops/playbook.md');
  });

  it('sets no migratedFrom on a current config', () => {
    expect(Object.hasOwn(loadConfig(repoWith('v-current', { version: CONFIG_VERSION })), 'migratedFrom')).toBe(false);
  });

  it('refuses a newer version naming the update, and keeps today’s line for any other', () => {
    expect(() => loadConfig(repoWith('v3', { version: 3 }))).toThrow(
      new Error(
        `${CONFIG_FILE}: version 3 is newer than this cookwright's 2: update cookwright (npm install cookwright@latest)`,
      ),
    );
    for (const [i, version] of [0, -1, 1.5, '1', null].entries()) {
      expect(() => loadConfig(repoWith(`v-bad-${i}`, { version }))).toThrow(`version must be ${CONFIG_VERSION}`);
    }
  });

  it('still validates the migrated result', () => {
    expect(() => loadConfig(repoWith('v1-invalid', { ...stale, hosts: ['gemini'] }))).toThrow(/host "gemini"/);
  });

  it('runs an injected chain in order, from the version the file says', () => {
    const seen = [];
    const step = (n) => (raw) => {
      seen.push([n, raw.version]);
      return { raw: { ...raw, level: 0 }, outcome: `step${n}` };
    };
    const migrations = { 0: step(0), 1: step(1) };
    const dir = repoWith('v0-chain', { version: 0 });
    expect(loadConfig(dir, { migrations }).migratedFrom).toBe(0);
    expect(seen).toEqual([
      [0, 0],
      [1, 1],
    ]);
    // A chain with a gap is not a chain: the validator names the version.
    expect(() => loadConfig(dir, { migrations: { 1: step(1) } })).toThrow(`version must be ${CONFIG_VERSION}`);
  });

  it('never changes the object it migrates, and reports one step per version', () => {
    const raw = structuredClone(stale);
    const out = applyMigrations(raw, { exists: () => false });
    expect(raw).toEqual(stale);
    expect(out.raw).toEqual({ version: 2, paths: {} });
    expect(out.steps).toEqual([{ from: 1, to: 2, outcome: 'playbookDropped', detail: 'docs/playbook.md' }]);
    expect(applyMigrations({ version: CONFIG_VERSION }, { exists: () => false })).toBeNull();
  });
});

describe('validateConfig', () => {
  const problems = (patch) => validateConfig({ ...valid(), ...patch }).join('\n');

  it('accepts the defaults', () => {
    expect(validateConfig(valid())).toEqual([]);
  });

  it('refuses an unknown or repeated host and keeps the known ones listed', () => {
    expect(problems({ hosts: ['gemini'] })).toMatch(
      /hosts: host "gemini" is not available in this version of cookwright \(known: claude, codex\)/,
    );
    expect(problems({ hosts: 'claude' })).toMatch(/non-empty list/);
    expect(problems({ hosts: ['claude', 'claude'] })).toMatch(/each host once/);
    expect(problems({ hosts: ['codex', 'codex'] })).toMatch(/each host once/);
    for (const hosts of [['codex'], ['claude', 'codex'], ['codex', 'claude']]) {
      expect([hosts, problems({ hosts })]).toEqual([hosts, '']);
    }
    expect(problems({ $schema: 1 })).toMatch(/\$schema must be a string/);
  });

  it('refuses a level this version does not know, or one that is not an integer', () => {
    expect(problems({ level: 0 })).toBe('');
    for (const level of [1, '0', -1, 0.5, null]) {
      expect(problems({ level })).toMatch(/^level must be one of 0 in this version of cookwright$/);
    }
  });

  it('holds paths.changelog to the root-relative rule and keeps it out of every other path', () => {
    const changelog = (p) => problems({ paths: { ...DEFAULTS.paths, changelog: p } });
    expect(changelog('docs/CHANGELOG.md')).toBe('');
    expect(changelog('/CHANGELOG.md')).toMatch(/paths\.changelog must be a root-relative path/);
    expect(changelog('../CHANGELOG.md')).toMatch(/paths\.changelog/);
    expect(changelog('docs/bundles/CHANGELOG.md')).toMatch(/paths\.bundles and paths\.changelog overlap/);
    expect(changelog('docs/closeouts')).toMatch(/paths\.changelog and paths\.closeouts overlap/);
    const withPlaybook = { ...DEFAULTS.paths, playbook: 'docs/playbook.md' };
    expect(problems({ paths: { ...withPlaybook, changelog: 'docs/playbook.md' } })).toMatch(
      /paths\.changelog and paths\.playbook overlap/,
    );
    const playbook = { ...DEFAULTS.paths, playbook: 'docs/closeouts/playbook.md' };
    expect(problems({ paths: playbook })).toMatch(/paths\.closeouts and paths\.playbook overlap/);
    expect(nonCodePathspecs(valid())).not.toContain(':(exclude)CHANGELOG.md'); // a changelog line is code
  });

  it('takes paths.playbook as optional: absent is valid, present is held to the path rules', () => {
    expect(DEFAULTS.paths.playbook).toBeUndefined();
    expect(valid().paths.playbook).toBeUndefined();
    expect(validateConfig(valid())).toEqual([]);
    const playbook = (p) => problems({ paths: { ...DEFAULTS.paths, playbook: p } });
    expect(playbook('docs/playbook.md')).toBe('');
    expect(playbook('/docs/playbook.md')).toMatch(/paths\.playbook must be a root-relative path/);
    expect(playbook('../playbook.md')).toMatch(/paths\.playbook must be a root-relative path/);
    expect(playbook('')).toMatch(/paths\.playbook must be a root-relative path/);
    expect(playbook(null)).toMatch(/paths\.playbook must be a root-relative path/);
    expect(playbook('docs/bundles/playbook.md')).toMatch(/paths\.bundles and paths\.playbook overlap/);
  });

  it('refuses paths that escape the root, are absolute, or are the root itself', () => {
    const paths = (p) => problems({ paths: { ...DEFAULTS.paths, bundles: p } });
    expect(paths('/tmp/x')).toMatch(/paths\.bundles must be a root-relative path/);
    expect(paths('../x')).toMatch(/paths\.bundles/);
    expect(paths('.')).toMatch(/paths\.bundles/);
    expect(paths('a//b')).toMatch(/paths\.bundles/);
    expect(paths('')).toMatch(/paths\.bundles/);
    expect(problems({ paths: { ...DEFAULTS.paths, extra: 'x' } })).toMatch(/paths: unknown key "extra"/);
  });

  it('refuses state homes that nest, since the gate ignores dirt under bundles', () => {
    const nested = { ...DEFAULTS.paths, closeouts: 'docs/bundles/closeouts' };
    expect(problems({ paths: nested })).toMatch(/paths\.bundles and paths\.closeouts overlap/);
    const same = { ...DEFAULTS.paths, backlog: 'docs/bundles' };
    expect(problems({ paths: same })).toMatch(/paths\.backlog and paths\.bundles overlap/);
    expect(problems({ paths: { ...DEFAULTS.paths, backlog: 'docs/bundles.md' } })).toBe('');
  });

  it('refuses a malformed gate: checks shape, duplicate names, needs, flakes', () => {
    const gate = (g) => problems({ gate: { ...DEFAULTS.gate, ...g } });
    expect(gate({ checks: 'npm test' })).toMatch(/gate\.checks must be a list/);
    expect(gate({ checks: [{ name: 'x' }] })).toMatch(/gate\.checks\[0\]\.run must be a non-empty command string/);
    expect(gate({ checks: [{ run: 'x' }] })).toMatch(/gate\.checks\[0\]\.name/);
    expect(gate({ checks: [{ name: 'a', run: 'x', needs: 'deno' }] })).toMatch(/needs must be a list/);
    expect(gate({ checks: [{ name: 'a', run: 'x', cmd: 'y' }] })).toMatch(/unknown key "cmd"/);
    expect(
      gate({
        checks: [
          { name: 'a', run: 'x' },
          { name: 'a', run: 'y' },
        ],
      }),
    ).toMatch(/duplicate name "a"/);
    expect(gate({ flakes: { 'B-1': 1 } })).toMatch(/flakes must map/);
    expect(gate({ legs: {} })).toMatch(/gate: unknown key "legs"/);
  });

  it('refuses a malformed hooks.docSync: shape, keys, names, pathspec lists', () => {
    const rule = (r) => ({ name: 'playbook', code: ['src/*'], docs: ['docs/playbook.md'], ...r });
    const hooks = (h) => problems({ hooks: { ...DEFAULTS.hooks, ...h } });
    expect(hooks({ docSync: [rule()] })).toBe('');
    expect(hooks({ docSync: 'x' })).toBe('hooks.docSync must be a list');
    expect(hooks({ pushChecks: [] })).toMatch(/^hooks: unknown key "pushChecks"$/);
    expect(hooks({ docSync: ['x'] })).toBe('hooks.docSync[0] must be an object');
    expect(hooks({ docSync: [rule({ extra: 1 })] })).toBe('hooks.docSync[0]: unknown key "extra"');
    expect(hooks({ docSync: [rule({ name: '' })] })).toBe('hooks.docSync[0].name must be a non-empty string');
    const { docs, ...noDocs } = rule();
    expect(docs).toBeDefined();
    expect(hooks({ docSync: [noDocs] })).toBe('hooks.docSync[0].docs must be a non-empty list of git pathspecs');
    expect(hooks({ docSync: [rule({ code: [] })] })).toBe(
      'hooks.docSync[0].code must be a non-empty list of git pathspecs',
    );
    expect(hooks({ docSync: [rule({ code: ['src/*', 3, ''] })] })).toBe(
      'hooks.docSync[0].code[1] must be a non-empty string\nhooks.docSync[0].code[2] must be a non-empty string',
    );
    expect(hooks({ docSync: [rule(), rule({ code: ['lib/*'] })] })).toBe('hooks.docSync[1]: duplicate name "playbook"');
  });

  it('refuses pathspec magic git does not know, and leaves the rest of a pathspec to git', () => {
    const code = (spec) => problems({ hooks: { docSync: [{ name: 'r', code: [spec], docs: ['README.md'] }] } });
    expect(code(':(foo)src')).toBe('hooks.docSync[0].code[0]: unknown pathspec magic "foo"');
    expect(code(':(exclude,Glob)src')).toMatch(/unknown pathspec magic "Glob"/);
    expect(code(':(top')).toMatch(/unknown pathspec magic "\(top"/);
    expect(code(':x')).toMatch(/unknown pathspec magic ":x"/);
    for (const ok of [':!x', ':^x', ':/x', ':/!x', '::x', ':(exclude,glob)x', ':(attr:text)x', ':()x', '*.md', 'a:b']) {
      expect(code(ok)).toBe('');
    }
    const docs = problems({ hooks: { docSync: [{ name: 'r', code: ['x'], docs: [':(prefix:0)x'] }] } });
    expect(docs).toBe('hooks.docSync[0].docs[0]: unknown pathspec magic "prefix:0"');
  });

  it('refuses a ci block without a workflow', () => {
    expect(problems({ ci: {} })).toMatch(/ci\.workflow must name a workflow file/);
    expect(problems({ ci: { workflow: 'ci.yml' } })).toBe('');
  });
});

describe('the schema and the validator agree', () => {
  const props = (schema) => Object.keys(schema.properties).sort();

  it('declare the same keys at every level', () => {
    expect(props(SCHEMA)).toEqual([...KNOWN_KEYS.top].sort());
    expect(props(SCHEMA.properties.paths)).toEqual([...KNOWN_KEYS.paths].sort());
    expect(props(SCHEMA.properties.gate)).toEqual([...KNOWN_KEYS.gate].sort());
    expect(props(SCHEMA.properties.gate.properties.checks.items)).toEqual(
      [...KNOWN_KEYS.check].sort(),
    );
    expect(props(SCHEMA.properties.ci)).toEqual([...KNOWN_KEYS.ci].sort());
    expect(props(SCHEMA.properties.hooks)).toEqual([...KNOWN_KEYS.hooks].sort());
    const rule = SCHEMA.properties.hooks.properties.docSync.items;
    expect(props(rule)).toEqual([...KNOWN_KEYS.docSyncRule].sort());
    expect([...rule.required].sort()).toEqual([...KNOWN_KEYS.docSyncRule].sort());
  });

  it('agree on which pathspec magic is known', () => {
    const rule = SCHEMA.properties.hooks.properties.docSync.items.properties;
    expect(rule.docs.items).toEqual(rule.code.items);
    const pattern = new RegExp(rule.code.items.pattern);
    const specs = [
      'src/*', ':!x', ':^x', ':/x', '::x', ':()x', ':(exclude,glob)x', ':(attr:text)x', ':(exclude,)x',
      ':(top,literal,icase)x', ':(foo)x', ':(top', ':x', ':(prefix:0)x', ':(exclude,Glob)x',
    ];
    for (const spec of specs) expect([spec, pattern.test(spec)]).toEqual([spec, unknownMagic(spec) === null]);
  });

  it('agree on the defaults, the known hosts and the known levels', () => {
    const p = SCHEMA.properties;
    expect(p.level.enum).toEqual([...KNOWN_LEVELS]);
    expect(p.level.type).toBe('integer');
    expect(p.level.default).toBe(DEFAULTS.level);
    expect(p.hosts.default).toEqual(DEFAULTS.hosts);
    expect(p.hosts.items.enum).toEqual(KNOWN_HOSTS);
    expect(p.baseBranch.default).toBe(DEFAULTS.baseBranch);
    for (const key of KNOWN_KEYS.paths) {
      expect(p.paths.properties[key].default).toBe(DEFAULTS.paths[key]);
    }
    for (const key of OPTIONAL_PATHS) {
      expect(KNOWN_KEYS.paths).toContain(key);
      expect(Object.hasOwn(p.paths.properties[key], 'default')).toBe(false);
      expect(Object.hasOwn(DEFAULTS.paths, key)).toBe(false);
    }
    expect(DEFAULTS.version).toBe(CONFIG_VERSION);
    // The schema accepts what the loader loads: the current version and every
    // version a migration starts from.
    const loadable = [CONFIG_VERSION, ...Object.keys(MIGRATIONS).map(Number)].sort();
    expect([...p.version.enum].sort()).toEqual(loadable);
    expect(p.hooks.properties.docSync.default).toEqual(DEFAULTS.hooks.docSync);
  });

  it('validates the repo’s own cookwright.json', () => {
    const own = loadConfig(path.join(HERE, '../../../..'));
    expect(own.paths.bundles).toBe('docs/dev/bundles');
    expect(own.gate.checks.map((c) => c.name)).toEqual(['test']);
  });
});

describe('derived values', () => {
  it('excludes exactly the state homes from what counts as code', () => {
    expect(nonCodePathspecs(valid())).toEqual([
      ':(exclude)docs/bundles',
      ':(exclude)docs/closeouts',
      ':(exclude)docs/backlog.md',
    ]);
  });

  it('resolves the workflow pointer of the first host with workflows, and the default host’s rules files', () => {
    expect(workflowScript(valid(), 'bundle-phase')).toBe('.claude/workflows/bundle-phase.js');
    expect(rulesFiles(valid())).toEqual(['AGENTS.md', 'CLAUDE.md']);
    const hosts = (list) => ({ ...valid(), hosts: list });
    expect(workflowScript(hosts(['codex', 'claude']), 'bundle-phase')).toBe('.claude/workflows/bundle-phase.js');
    expect(rulesFiles(hosts(['codex', 'claude']))).toEqual(['AGENTS.md']);
    expect(workflowScript(hosts(['codex']), 'bundle-phase')).toBeNull();
    expect(workflowHosts()).toEqual(['claude']);
  });

  it('finds the installed package at the config root, else hoisted to the work tree top', () => {
    const top = gitInit(path.join(TMP, 'installed'));
    const app = path.join(top, 'apps/mobile');
    fs.mkdirSync(app, { recursive: true });
    const nested = { root: app, top };
    expect(installedPackage(nested)).toBeNull();
    expect(playbookPath(valid(), nested)).toBe('node_modules/cookwright/docs/playbook.md');
    linkPackage(top);
    expect(installedPackage(nested)).toBe('../../node_modules/cookwright');
    expect(playbookPath(valid(), nested)).toBe('../../node_modules/cookwright/docs/playbook.md');
    expect(fs.existsSync(path.join(app, playbookPath(valid(), nested)))).toBe(true);
    linkPackage(app);
    expect(installedPackage(nested)).toBe('node_modules/cookwright');
    expect(installedPackage({ root: top })).toBe('node_modules/cookwright');
    // A directory without a package.json is not an install.
    const bare = path.join(TMP, 'bare-install');
    fs.mkdirSync(path.join(bare, 'node_modules/cookwright'), { recursive: true });
    expect(installedPackage({ root: bare })).toBeNull();
  });

  it('reads the playbook the config names before the package’s', () => {
    const own = { ...valid(), paths: { ...valid().paths, playbook: 'ops/playbook.md' } };
    expect(playbookPath(own, { root: TMP })).toBe('ops/playbook.md');
  });
});
