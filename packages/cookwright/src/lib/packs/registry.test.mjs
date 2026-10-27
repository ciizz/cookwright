// src/lib/packs/registry.test.mjs — the pack registry and the manifests it loads:
// one directory per pack, every rule a sentence with a measurement or listed as
// advisory, the defaults a pack writes valid config, and the one reading of
// `packs` that every consumer shares.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULTS, SECRET_NAME, validateConfig, withDefaults } from '../config.mjs';
import { PACKAGE_ROOT } from '../hosts.mjs';
import { KINDS } from '../secret/proofs.mjs';
import {
  ADVISORY,
  KNOWN_PACKS,
  PACKS,
  RATCHET_CHECK,
  activeRules,
  declaredPacks,
  packName,
  switchableRules,
} from './registry.mjs';

const PACKS_DIR = path.join(PACKAGE_ROOT, 'packs');
const MEASURES = ['eslint', 'doc-sync', 'gate', ADVISORY];
const manifests = KNOWN_PACKS.map((name) => [name, PACKS[name]]);
const byMeasure = (manifest, measure) => manifest.rules.filter((r) => r.measure === measure);

describe('the registry', () => {
  it('lists exactly the pack directories the package ships, expo and supabase', () => {
    const dirs = fs
      .readdirSync(PACKS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect(dirs).toEqual([...KNOWN_PACKS].sort());
    expect(KNOWN_PACKS).toEqual(['expo', 'supabase']);
  });

  it('freezes every manifest all the way down', () => {
    const unfrozen = [];
    const walk = (v, at) => {
      if (v === null || typeof v !== 'object') return;
      if (!Object.isFrozen(v)) unfrozen.push(at);
      for (const [k, w] of Object.entries(v)) walk(w, `${at}.${k}`);
    };
    walk(PACKS, 'PACKS');
    walk(RATCHET_CHECK, 'RATCHET_CHECK');
    expect(unfrozen).toEqual([]);
  });

  it('keeps the import rule: a manifest imports nothing, the registry only the manifests', () => {
    for (const name of KNOWN_PACKS) {
      expect(fs.readFileSync(path.join(PACKS_DIR, name, 'pack.mjs'), 'utf8')).not.toMatch(/^\s*import\b|\bimport\(/m);
    }
    const own = fs.readFileSync(path.join(PACKAGE_ROOT, 'src/lib/packs/registry.mjs'), 'utf8');
    const imports = [...own.matchAll(/^import .* from '([^']+)';$/gm)].map(([, from]) => from);
    expect(imports).toEqual(KNOWN_PACKS.map((n) => `../../../packs/${n}/pack.mjs`));
  });
});

describe.each(manifests)('the %s manifest', (name, manifest) => {
  it('names itself, has a version, and points at its export and its setup line', () => {
    expect(manifest.name).toBe(name);
    expect(Number.isInteger(manifest.version) && manifest.version >= 1).toBe(true);
    expect(manifest.eslintExport).toBe(`packs/${name}/eslint.cjs`);
    expect(manifest.setup.eslint).toMatch(/^(npx|npm) /);
  });

  it('has each rule once, by a kebab-case id, with a sentence and a known measure', () => {
    const ids = manifest.rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of manifest.rules) {
      expect(rule.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(MEASURES).toContain(rule.measure);
      expect(rule.sentence).toMatch(/^[A-Z`]/);
      expect(rule.sentence).not.toMatch(/[.\n]$|\n/);
    }
  });

  it('gives each rule exactly the data of its measure, and an advisory rule none', () => {
    const data = { eslint: 'eslint', 'doc-sync': 'docSync', gate: 'gate' };
    for (const rule of manifest.rules) {
      for (const [measure, key] of Object.entries(data)) {
        expect([rule.id, key, Object.hasOwn(rule, key)]).toEqual([rule.id, key, rule.measure === measure]);
      }
    }
  });

  it('names its ESLint ids, the samples wired compares, and a tag of its own on a shared id', () => {
    for (const rule of byMeasure(manifest, 'eslint')) {
      expect(rule.eslint.ruleIds.length).toBeGreaterThan(0);
      expect(rule.eslint.options.length).toBeGreaterThan(0);
      for (const o of rule.eslint.options) {
        expect(o.sample).toMatch(/^src\/.+\.(tsx|ts|jsx|js)$/);
        expect(typeof o.expect).toBe('object');
      }
      const shared = rule.eslint.ruleIds.some((id) => ['no-restricted-syntax', 'no-restricted-imports'].includes(id));
      if (shared) expect(rule.eslint.tag).toBe(`[cookwright ${name} ${rule.id}]`);
      else expect(rule.eslint.tag).toBeUndefined();
    }
  });

  it('has one hook message per ESLint rule, and a dependency for every rule that needs one', () => {
    expect(Object.keys(manifest.messages).sort()).toEqual(byMeasure(manifest, 'eslint').map((r) => r.id).sort());
    for (const text of Object.values(manifest.messages)) expect(text).toMatch(/^[^\n]+$/);
    const packages = manifest.deps.map((d) => d.package);
    for (const rule of manifest.rules.filter((r) => r.needs)) expect(packages).toContain(rule.needs);
    for (const dep of manifest.deps) expect(dep.install).toBe(`npm install --save-dev ${dep.package}`);
  });

  it('writes valid config: its doc-sync rules under a pack-owned name, its gate checks', () => {
    const docSync = byMeasure(manifest, 'doc-sync').map((r) => r.docSync);
    for (const rule of docSync) expect(rule.name).toMatch(new RegExp(`^${name}:`));
    const config = withDefaults({ version: DEFAULTS.version, hooks: { docSync: structuredClone(docSync) } });
    expect(validateConfig(config)).toEqual([]);
    for (const rule of byMeasure(manifest, 'gate')) expect(rule.gate.name).toMatch(/^standards:/);
  });

  it('declares its proof kinds as data and pure functions, none shadowing a core or another pack’s kind', () => {
    const kinds = Object.entries(manifest.proofs ?? {});
    for (const [kind, def] of kinds) {
      expect(kind).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(Object.hasOwn(KINDS, kind)).toBe(false);
      for (const other of KNOWN_PACKS.filter((n) => n !== name)) expect(Object.hasOwn(PACKS[other].proofs ?? {}, kind)).toBe(false);
      expect(Object.keys(def).sort()).toEqual(['against', 'check', 'fields', 'hints', 'names', 'valid']);
      expect(def.fields.every((f) => !['kind', 'names'].includes(f))).toBe(true);
      expect(Object.keys(def.valid).sort()).toEqual([...def.fields].sort());
      expect(Object.keys(def.hints).sort()).toEqual([...def.fields].sort());
      for (const f of def.fields) expect([typeof def.valid[f], def.hints[f]]).toEqual(['function', expect.stringMatching(/^[a-z][^\n.]+[^.]$/)]);
      expect(def.names === null || def.names.every((n) => SECRET_NAME.test(n))).toBe(true);
      expect([typeof def.against, typeof def.check]).toEqual(['function', 'function']);
    }
  });

  it('lists its ambient names as secret names, each once, and its pointers among them', () => {
    const ambient = manifest.ambient ?? Object.freeze([]);
    const pointers = manifest.pointers ?? Object.freeze([]);
    expect([Array.isArray(ambient), Object.isFrozen(ambient), Array.isArray(pointers), Object.isFrozen(pointers)]).toEqual([true, true, true, true]);
    for (const n of ambient) expect(n).toMatch(SECRET_NAME);
    expect(new Set(ambient).size).toBe(ambient.length);
    for (const n of pointers) expect(ambient).toContain(n);
  });

  it('declares each contract doc with its scope, its code directories and its entries kind', () => {
    expect(manifest.docs.length).toBeGreaterThan(0);
    const docSyncDocs = byMeasure(manifest, 'doc-sync').flatMap((r) => r.docSync.docs);
    for (const doc of manifest.docs) {
      expect(doc.path).toMatch(/^docs\/[a-z-]+\.md$/);
      expect(docSyncDocs).toContain(doc.path);
      expect(doc.template).toBe(`templates/${path.basename(doc.path)}`);
      expect(doc.scope.length).toBeGreaterThan(0);
      expect(doc.code.length).toBeGreaterThan(0);
      expect(['components', 'migrations']).toContain(doc.entries);
    }
  });
});

describe('the rules of the kickoff', () => {
  it('ship as the plan names them (disposition 1)', () => {
    const ids = (n, measured) => PACKS[n].rules.filter((r) => (r.measure !== ADVISORY) === measured).map((r) => r.id);
    expect(ids('expo', true)).toEqual(['strings', 'tokens', 'size', 'design-doc']);
    expect(ids('expo', false)).toEqual(['components-first', 'visual-contract', 'reuse-first']);
    expect(ids('supabase', true)).toEqual(['client', 'data-doc', 'types']);
    expect(ids('supabase', false)).toEqual([]);
    expect(switchableRules(PACKS.expo)).toEqual(ids('expo', true));
  });

  it('measure size by function, 150 in a component file and 40 elsewhere (disposition 21)', () => {
    const size = PACKS.expo.rules.find((r) => r.id === 'size').eslint;
    expect(size.ruleIds).toEqual(['max-lines-per-function']);
    expect(size.options.map((o) => [path.extname(o.sample), o.expect.max])).toEqual([
      ['.tsx', 150],
      ['.ts', 40],
    ]);
  });

  it('carry the doc-sync defaults and the gate entries of plan §4.3 and disposition 30', () => {
    const docSync = (n) => PACKS[n].rules.filter((r) => r.docSync).map((r) => r.docSync);
    expect(docSync('expo')).toEqual([
      { name: 'expo:design-doc', code: ['src/components/**', 'components/**', ':!**/*.test.*', ':!**/__tests__/**', ':!**/__snapshots__/**'], docs: ['docs/design-system.md'] },
    ]);
    expect(docSync('supabase')).toEqual([
      { name: 'supabase:data-doc', code: ['supabase/migrations/**'], docs: ['docs/data-model.md'] },
    ]);
    const types = PACKS.supabase.rules.find((r) => r.id === 'types').gate;
    expect(types).toEqual({ name: 'standards:types', run: 'npx cookwright standards --types', skipExit: 11 });
    expect(RATCHET_CHECK).toEqual({ name: 'standards', run: 'npx cookwright standards --ratchet', skipExit: 11 });
  });
});

describe('the secrets data of stage 5', () => {
  it('gives the supabase pack its proof kind and the names its tools read on their own (dispositions 19, 22, 29)', () => {
    expect(Object.keys(PACKS.supabase.proofs)).toEqual(['supabase']);
    expect(PACKS.supabase.proofs.supabase.fields).toEqual(['ref']);
    expect(PACKS.supabase.proofs.supabase.names).toEqual(['SUPABASE_URL', 'DB_URL']);
    expect(PACKS.supabase.ambient).toEqual(['SUPABASE_DB_URL', 'SUPABASE_ACCESS_TOKEN', 'PGPASSWORD', 'PGPASSFILE', 'PGSERVICE', 'PGSERVICEFILE']);
    expect(PACKS.supabase.pointers).toEqual(['PGPASSFILE', 'PGSERVICE', 'PGSERVICEFILE']);
    expect([PACKS.expo.proofs, PACKS.expo.ambient]).toEqual([undefined, undefined]);
  });
});

describe('declaredPacks and activeRules', () => {
  it('reads no packs as none', () => {
    expect(declaredPacks({})).toEqual([]);
    expect(declaredPacks({ packs: [] })).toEqual([]);
  });

  it('reads a name and an object alike, in order, with the switched-off rules', () => {
    const packs = declaredPacks({ packs: ['supabase', { name: 'expo', rules: { size: false, tokens: false } }] });
    expect(packs.map((p) => [p.name, p.manifest, [...p.off]])).toEqual([
      ['supabase', PACKS.supabase, []],
      ['expo', PACKS.expo, ['size', 'tokens']],
    ]);
    expect(declaredPacks({ packs: [{ name: 'expo' }] })[0].off.size).toBe(0);
    expect(packName('expo')).toBe('expo');
    expect(packName({ name: 'supabase' })).toBe('supabase');
  });

  it('keeps the measured rules that are not switched off, never an advisory one', () => {
    const [expo] = declaredPacks({ packs: [{ name: 'expo', rules: { size: false } }] });
    expect(activeRules(expo).map((r) => r.id)).toEqual(['strings', 'tokens', 'design-doc']);
    const [supabase] = declaredPacks({ packs: ['supabase'] });
    expect(activeRules(supabase).map((r) => r.id)).toEqual(['client', 'data-doc', 'types']);
  });
});
