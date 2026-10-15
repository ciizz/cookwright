// src/lib/config.test.mjs — cookwright.json: discovery, defaults, every refusal, and
// the schema staying in step with the validator.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import {
  CONFIG_FILE,
  DEFAULTS,
  KNOWN_KEYS,
  findRoot,
  loadConfig,
  nonCodePathspecs,
  unknownMagic,
  validateConfig,
  withDefaults,
  workTreeRoot,
} from './config.mjs';
import { KNOWN_HOSTS, rulesFiles, workflowScript } from './hosts.mjs';
import { KNOWN_LEVELS } from './levels.mjs';
import { gitInit } from '../test-helpers.mjs';

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

const valid = () => withDefaults({ version: 1 });

describe('findRoot', () => {
  it('walks up from a nested directory to the config', () => {
    const dir = repoWith('nested', { version: 1 });
    expect(fs.realpathSync(findRoot(path.join(dir, 'a/b')))).toBe(fs.realpathSync(dir));
  });

  it('returns null outside any cookwright repo', () => {
    const dir = path.join(TMP, 'bare/x');
    fs.mkdirSync(dir, { recursive: true });
    expect(findRoot(dir)).toBeNull();
  });

  it('never climbs past the work tree: an enclosing directory’s config is not this repo’s', () => {
    const outer = repoWith('enclosing', { version: 1 });
    const inner = gitInit(path.join(outer, 'a/inner'));
    fs.mkdirSync(path.join(inner, 'src'));
    const top = workTreeRoot(path.join(inner, 'src'));
    expect(fs.realpathSync(top)).toBe(fs.realpathSync(inner));
    expect(findRoot(path.join(inner, 'src'), { stopAt: top })).toBeNull();
    // Unbounded, the walk would have found the enclosing one.
    expect(fs.realpathSync(findRoot(inner))).toBe(fs.realpathSync(outer));
    // A config at the work tree's top is still found from below it.
    fs.writeFileSync(path.join(inner, CONFIG_FILE), '{"version":1}');
    expect(findRoot(path.join(inner, 'src'), { stopAt: top })).toBe(inner);
  });

  it('has no work tree outside git', () => {
    expect(workTreeRoot(path.join(TMP, 'bare/x'))).toBeNull();
  });
});

describe('loadConfig', () => {
  it('applies the defaults one level deep', () => {
    const dir = repoWith('defaults', { version: 1, paths: { bundles: 'state/bundles' } });
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
    expect(() => loadConfig(repoWith('empty', {}))).toThrow(/version must be 1/);
  });

  it('normalizes a trailing slash so the gate’s dirty-path exclusion matches', () => {
    const dir = repoWith('slash', { version: 1, paths: { bundles: 'state/bundles/' } });
    expect(loadConfig(dir).paths.bundles).toBe('state/bundles');
  });

  it('reports every problem at once', () => {
    const dir = repoWith('bad', { version: 2, hosts: [], baseBranch: '', typo: 1 });
    expect(() => loadConfig(dir)).toThrow(
      /unknown key "typo"[\s\S]*version must be 1[\s\S]*hosts must be a non-empty list[\s\S]*baseBranch/,
    );
  });
});

describe('validateConfig', () => {
  const problems = (patch) => validateConfig({ ...valid(), ...patch }).join('\n');

  it('accepts the defaults', () => {
    expect(validateConfig(valid())).toEqual([]);
  });

  it('refuses an unknown or repeated host and keeps the known ones listed', () => {
    expect(problems({ hosts: ['gemini'] })).toMatch(
      /hosts: host "gemini" is not available in this version of cookwright \(known: claude\)/,
    );
    expect(problems({ hosts: 'claude' })).toMatch(/non-empty list/);
    expect(problems({ hosts: ['claude', 'claude'] })).toMatch(/each host once/);
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
    expect(changelog('docs/playbook.md')).toMatch(/paths\.changelog and paths\.playbook overlap/);
    const playbook = { ...DEFAULTS.paths, playbook: 'docs/closeouts/playbook.md' };
    expect(problems({ paths: playbook })).toMatch(/paths\.closeouts and paths\.playbook overlap/);
    expect(nonCodePathspecs(valid())).not.toContain(':(exclude)CHANGELOG.md'); // a changelog line is code
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
    expect(p.version.const).toBe(DEFAULTS.version);
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

  it('resolves the default host’s workflow script and rules files', () => {
    expect(workflowScript(valid(), 'bundle-phase')).toBe('hosts/claude/workflows/bundle-phase.js');
    expect(rulesFiles(valid())).toEqual(['AGENTS.md', 'CLAUDE.md']);
  });
});
