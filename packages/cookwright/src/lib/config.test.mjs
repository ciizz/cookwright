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
  validateConfig,
  withDefaults,
} from './config.mjs';
import { KNOWN_HOSTS, rulesFile, workflowScript } from './hosts.mjs';

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
});

describe('loadConfig', () => {
  it('applies the defaults one level deep', () => {
    const dir = repoWith('defaults', { version: 1, paths: { bundles: 'state/bundles' } });
    const config = loadConfig(dir);
    expect(config.hosts).toEqual(['claude']);
    expect(config.baseBranch).toBe('main');
    expect(config.paths).toEqual({ ...DEFAULTS.paths, bundles: 'state/bundles' });
    expect(config.gate).toEqual({ checks: [], flakes: {} });
    expect(config.ci).toBeUndefined();
  });

  it('names a missing or unparsable file', () => {
    expect(() => loadConfig(path.join(TMP, 'nowhere'))).toThrow(/not found/);
    expect(() => loadConfig(repoWith('broken', '{ nope'))).toThrow(/cookwright\.json: /);
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

  it('refuses an unknown host and keeps the known ones listed', () => {
    expect(problems({ hosts: ['gemini'] })).toMatch(/unknown host "gemini" \(known: claude\)/);
    expect(problems({ hosts: 'claude' })).toMatch(/non-empty list/);
  });

  it('refuses paths that escape the root or are absolute', () => {
    const paths = (p) => problems({ paths: { ...DEFAULTS.paths, bundles: p } });
    expect(paths('/tmp/x')).toMatch(/paths\.bundles must be a root-relative path/);
    expect(paths('../x')).toMatch(/paths\.bundles/);
    expect(paths('')).toMatch(/paths\.bundles/);
    expect(problems({ paths: { ...DEFAULTS.paths, extra: 'x' } })).toMatch(/paths: unknown key "extra"/);
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
  });

  it('agree on the defaults and the known hosts', () => {
    const p = SCHEMA.properties;
    expect(p.hosts.default).toEqual(DEFAULTS.hosts);
    expect(p.hosts.items.enum).toEqual(KNOWN_HOSTS);
    expect(p.baseBranch.default).toBe(DEFAULTS.baseBranch);
    for (const key of KNOWN_KEYS.paths) {
      expect(p.paths.properties[key].default).toBe(DEFAULTS.paths[key]);
    }
    expect(p.version.const).toBe(DEFAULTS.version);
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

  it('resolves the default host’s workflow script and rules file', () => {
    expect(workflowScript(valid(), 'bundle-phase')).toBe('hosts/claude/workflows/bundle-phase.js');
    expect(rulesFile(valid())).toBe('CLAUDE.md');
  });
});
