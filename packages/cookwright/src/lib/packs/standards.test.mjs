// src/lib/packs/standards.test.mjs — the standards engine (stage-4 plan §4.5, §6):
// `loadESLint` through the repo's own node_modules, `wired`'s comparison of the
// effective config, the entries git lists with one path base and the mode filter,
// the blobs, `countBy` with tags and switched-off rules, `lintAt`'s unmeasured
// cases, and `render` never echoing ESLint's text. ESLint is the Promise-returning
// fake, as a package (src/test-fixtures/fake-eslint) or as a plain object.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { messages } from '../messages.mjs';
import { commit, fakeEslintRepo, gitInit, run, scratchRepo, scratchRoot } from '../../test-helpers.mjs';
import { blockCovers as globCovers } from './glob.mjs';
import * as engine from './standards.mjs';

const m = messages.standards;
const TMP = scratchRoot('cookwright-standards-engine-');
let n = 0;
const repoAt = (config = { packs: ['expo', 'supabase'] }) => scratchRepo(TMP, `r${(n += 1)}`, config);
const real = (p) => fs.realpathSync(p);

const rules = (packs = ['expo', 'supabase']) => engine.eslintRules({ packs });
const byKey = (key, list = rules()) => list.filter((r) => r.key === key);

/** A fake ESLint instance whose effective config is `rulesFor(path)`. */
const configured = (rulesFor) => ({ calculateConfigForFile: async (p) => ({ rules: rulesFor(p) }) });

/** The effective config the packs' exports give the root-relative `rel`, as ESLint 9.39.5 reports it: severity 2, the block's options. */
const asExported = (rel, cover = engine.coverage(rules())) =>
  Object.fromEntries(
    cover.flatMap(({ blocks }) => blocks.filter((b) => globCovers(b, rel)).flatMap((b) => Object.entries(b.rules).map(([id, v]) => [id, [2, ...v.slice(1)]]))),
  );

/** `asExported` at the absolute path `wired` asks about, under the root `/repo`. */
const packConfig = (p) => asExported(p.slice('/repo/'.length));

/** `rules`' entry for `id`, where it has one, with `over` merged into its first options object. */
const withOptions = (rules, id, over) =>
  rules[id] ? { ...rules, [id]: [rules[id][0], { ...rules[id][1], ...over }, ...rules[id].slice(2)] } : rules;

describe('eslintRules', () => {
  it('lists the declared packs’ ESLint rules that are on, keyed `<pack> <rule>`', () => {
    expect(rules().map((r) => r.key)).toEqual(['expo strings', 'expo tokens', 'expo size', 'supabase client']);
    expect(rules([{ name: 'expo', rules: { size: false } }]).map((r) => r.key)).toEqual(['expo strings', 'expo tokens']);
    expect(rules([])).toEqual([]);
  });
});

describe('loadESLint', () => {
  it('loads ESLint from the config root’s own node_modules, never this package’s', async () => {
    const repo = repoAt();
    await expect(engine.loadESLint(repo.root, 'npx expo lint')).rejects.toThrow(m.noEslint('npx expo lint'));
    fakeEslintRepo(repo.root);
    const { eslint, version } = await engine.loadESLint(repo.root, 'npx expo lint');
    expect(version).toBe('9.39.0-fake');
    expect(eslint.cwd).toBe(repo.root);
  });

  it('refuses an ESLint before 9 (no flat config) as unmeasurable, naming the version', async () => {
    const old = path.join(TMP, `eslint8-${(n += 1)}`);
    fs.mkdirSync(old);
    fs.writeFileSync(path.join(old, 'package.json'), '{ "name": "eslint", "version": "8.57.0", "main": "index.cjs" }');
    fs.writeFileSync(path.join(old, 'index.cjs'), 'class ESLint {}\nESLint.version = "8.57.0";\nexports.ESLint = ESLint;\n');
    const repo = repoAt();
    fakeEslintRepo(repo.root, { eslint: old });
    const err = await engine.loadESLint(repo.root, 'x').catch((e) => e);
    expect(err).toBeInstanceOf(engine.Unmeasurable);
    expect(err.message).toBe(m.oldEslint('8.57.0'));
  });
});

describe('wired', () => {
  const root = '/repo';

  it('measures every rule the effective config carries as the pack set it', async () => {
    const out = await engine.wired(configured(packConfig), root, rules());
    expect(out.measured.map((r) => r.key)).toEqual(['expo strings', 'expo tokens', 'expo size', 'supabase client']);
    expect(out.skipped).toEqual([]);
  });

  it('reads a changed option, a lower severity or a replaced selector as overridden, never measured', async () => {
    const cases = {
      'expo strings': { 'i18next/no-literal-string': [2, { mode: 'all' }] },
      'expo size': { 'max-lines-per-function': [2, { max: 300 }] },
      'expo tokens': { 'no-restricted-syntax': [2, { selector: 'Literal', message: 'my own selector' }] },
      'supabase client': { 'no-restricted-imports': [1, { paths: [{ name: '@supabase/supabase-js', message: '[cookwright supabase client] no' }] }] },
    };
    for (const [key, over] of Object.entries(cases)) {
      const out = await engine.wired(configured((p) => ({ ...packConfig(p), ...over })), root, rules());
      expect([key, out.skipped]).toEqual([key, [m.ruleSkipped(key, m.overridden)]]);
    }
  });

  it('measures a rule a later block set to error with exactly the pack’s own options', async () => {
    const later = (p) => {
      const pack = packConfig(p);
      return { ...pack, 'max-lines-per-function': ['error', ...pack['max-lines-per-function'].slice(1)] };
    };
    const out = await engine.wired(configured(later), root, rules());
    expect(out.measured.map((r) => r.key)).toEqual(['expo strings', 'expo tokens', 'expo size', 'supabase client']);
    expect(out.skipped).toEqual([]);
  });

  it('reads a later block that changes, leaves out or adds an option as overridden', async () => {
    /** `packConfig(p)` with `id`'s entry, where it has one, replaced by `fn` of it. */
    const altered = (id, fn) => (p) => {
      const pack = packConfig(p);
      return pack[id] ? { ...pack, [id]: fn(pack[id]) } : pack;
    };
    const cases = [
      ['expo strings', altered('i18next/no-literal-string', ([sev, opts]) => [sev, { ...opts, 'jsx-attributes': { exclude: [] } }])],
      ['expo size', altered('max-lines-per-function', ([sev, { max }]) => [sev, { max, skipBlankLines: true }])],
      ['expo tokens', altered('no-restricted-syntax', (entry) => entry.slice(0, 2))],
      // an option beside the pack's can switch detection off: <Text>Hello</Text> would go unflagged
      ['expo strings', altered('i18next/no-literal-string', ([sev, opts]) => [sev, { ...opts, 'jsx-components': { exclude: ['Trans', 'Text'] } }])],
      ['expo size', altered('max-lines-per-function', ([sev, opts]) => [sev, { ...opts, IIFEs: true, extra: 1 }])],
    ];
    for (const [key, config] of cases) {
      const out = await engine.wired(configured(config), root, rules());
      expect([key, out.skipped]).toEqual([key, [m.ruleSkipped(key, m.overridden)]]);
    }
  });

  it('checks the size limit at both samples: a component at 150, a .ts file at 40', async () => {
    const swapped = (p) => ({ ...packConfig(p), 'max-lines-per-function': [2, { max: /\.tsx$/.test(p) ? 40 : 150 }] });
    expect((await engine.wired(configured(swapped), root, byKey('expo size'))).measured).toEqual([]);
  });

  it('reads an absent rule as not wired, or as needing its plugin when the plugin does not resolve', async () => {
    const repo = repoAt();
    const out = await engine.wired(configured(() => ({})), repo.root, rules());
    expect(out.measured).toEqual([]);
    expect(out.skipped).toEqual([
      m.ruleSkipped('expo strings', m.needs('npm install --save-dev eslint-plugin-i18next')),
      m.ruleSkipped('expo tokens', m.notWired('cookwright/packs/expo/eslint.cjs')),
      m.ruleSkipped('expo size', m.notWired('cookwright/packs/expo/eslint.cjs')),
      m.ruleSkipped('supabase client', m.notWired('cookwright/packs/supabase/eslint.cjs')),
    ]);
    fakeEslintRepo(repo.root, { config: null });
    const withPlugin = await engine.wired(configured(() => ({})), repo.root, byKey('expo strings'));
    expect(withPlugin.skipped).toEqual([m.ruleSkipped('expo strings', m.notWired('cookwright/packs/expo/eslint.cjs'))]);
  });

  it('a config ESLint cannot load is unmeasurable: the engine’s own line, the error’s first line its detail', async () => {
    const broken = { calculateConfigForFile: async () => Promise.reject(new Error("Cannot find module '/Users/someone/app/x'\nRequire stack: …")) };
    const err = await engine.wired(broken, root, rules()).catch((e) => e);
    expect(err).toBeInstanceOf(engine.Unmeasurable);
    expect([err.message, err.detail]).toEqual([m.configFailed, "Cannot find module '/Users/someone/app/x'"]);
  });
});

describe('scopeAt', () => {
  const measured = rules();
  const cover = engine.coverage(measured);
  const at = (rulesFor) => ({ calculateConfigForFile: async (p) => (rulesFor === undefined ? undefined : { rules: rulesFor(p.slice('/top/'.length)) }) });

  it('covers a file by its packs’ own blocks: a component by every rule, a .ts file by size and client, a test by none', async () => {
    const eslint = at(asExported);
    const keys = async (rel) => (await engine.scopeAt(eslint, '/top', '/top', rel, cover)).rules.map((r) => r.key);
    expect(await keys('src/components/Card.tsx')).toEqual(['expo strings', 'expo tokens', 'expo size', 'supabase client']);
    expect(await keys('src/lib/a.ts')).toEqual(['expo size', 'supabase client']);
    expect(await keys('src/components/Card.test.tsx')).toEqual([]);
    expect(await keys('src/services/supabase.ts')).toEqual(['expo size']);
  });

  it('reads a covered file the config ignores as outside the rules, a rule changed for it or a config it cannot compute as unmeasured', async () => {
    expect(await engine.scopeAt(at(undefined), '/top', '/top', 'src/lib/a.ts', cover)).toEqual({ rules: [], ignored: true });
    const relaxed = at((rel) => ({ ...asExported(rel), 'max-lines-per-function': [2, { max: 400 }] }));
    expect(await engine.scopeAt(relaxed, '/top', '/top', 'src/lib/a.ts', cover)).toEqual({ unmeasured: m.changedHere(['expo size']) });
    const throws = { calculateConfigForFile: async () => Promise.reject(new Error('boom /Users/someone/app')) };
    expect(await engine.scopeAt(throws, '/top', '/top', 'src/lib/a.ts', cover)).toEqual({ unmeasured: m.configAtFile, detail: 'boom /Users/someone/app' });
    expect(await engine.scopeAt(at(undefined), '/top', '/top', 'README.ts.md', cover)).toEqual({ rules: [] });
  });

  it('judges a later block as wired does: exactly the pack’s options keep the file measured, one added or changed leaves it unmeasured', async () => {
    const rel = 'src/components/Card.tsx';
    const id = 'i18next/no-literal-string';
    const beside = { 'jsx-components': { exclude: ['Trans', 'Text'] } };
    const changedOpts = { 'jsx-attributes': { exclude: [] } };
    const severityOnly = at((r) => ({ ...asExported(r), [id]: ['error', ...asExported(r)[id].slice(1)] }));
    expect((await engine.scopeAt(severityOnly, '/top', '/top', rel, cover)).rules.map((r) => r.key)).toContain('expo strings');
    for (const opts of [beside, changedOpts]) {
      const later = at((r) => withOptions(asExported(r), id, opts));
      expect(await engine.scopeAt(later, '/top', '/top', rel, cover)).toEqual({ unmeasured: m.changedHere(['expo strings']) });
      const sample = configured((p) => withOptions(asExported(p.slice('/repo/'.length)), id, opts));
      expect((await engine.wired(sample, '/repo', byKey('expo strings'))).skipped).toEqual([m.ruleSkipped('expo strings', m.overridden)]);
    }
  });
});

describe('entries', () => {
  it('lists staged changes with both sides’ blobs and modes, a rename with its source, and drops a symbolic link', () => {
    const repo = repoAt();
    commit(repo, { 'src/a.ts': 'a\n', 'src/old.tsx': 'old\n', 'src/gone.js': 'g\n', 'README.md': 'r' }, 'init');
    fs.writeFileSync(path.join(repo.root, 'src/a.ts'), 'a2\n');
    fs.renameSync(path.join(repo.root, 'src/old.tsx'), path.join(repo.root, 'src/new.tsx'));
    fs.rmSync(path.join(repo.root, 'src/gone.js'));
    fs.writeFileSync(path.join(repo.root, 'src/added.jsx'), 'x\n');
    fs.symlinkSync('a.ts', path.join(repo.root, 'src/link.ts'));
    run(repo.root, 'git', ['add', '-A']);
    const top = real(repo.root);
    const entries = engine.stagedEntries(top, top);
    const by = Object.fromEntries(entries.map((e) => [e.path, e]));
    expect(Object.keys(by).sort()).toEqual(['src/a.ts', 'src/added.jsx', 'src/gone.js', 'src/link.ts', 'src/new.tsx']);
    expect(by['src/new.tsx']).toMatchObject({ status: 'R', basePath: 'src/old.tsx', mode: '100644' });
    expect(by['src/link.ts'].mode).toBe('120000');
    expect(entries.filter(engine.lintable).map((e) => e.path).sort()).toEqual(['src/a.ts', 'src/added.jsx', 'src/new.tsx']);
    expect(entries.filter(engine.hasBase).map((e) => e.path).sort()).toEqual(['src/a.ts', 'src/gone.js', 'src/new.tsx']);
    expect(entries.filter(engine.deletedLintable).map((e) => e.path)).toEqual(['src/gone.js']);
    const blobs = engine.readBlobs(top, [by['src/a.ts'].sha, by['src/a.ts'].baseSha, '0'.repeat(40)]);
    expect([blobs.get(by['src/a.ts'].sha), blobs.get(by['src/a.ts'].baseSha), blobs.get('0'.repeat(40))]).toEqual(['a2\n', 'a\n', null]);
  });

  it('lists only the config root’s files when it sits below the top, and shows paths from the root', () => {
    const top = gitInit(path.join(TMP, `nested-${(n += 1)}`));
    const outer = { root: top };
    fs.mkdirSync(path.join(top, 'apps/mobile'), { recursive: true });
    fs.writeFileSync(path.join(top, 'apps/mobile/cookwright.json'), '{ "version": 3 }');
    commit(outer, { 'apps/mobile/src/a.tsx': 'a\n', 'apps/web/src/b.tsx': 'b\n' }, 'init');
    commit(outer, { 'apps/mobile/src/a.tsx': 'a2\n', 'apps/web/src/b.tsx': 'b2\n' }, 'change');
    fs.writeFileSync(path.join(top, 'apps/mobile/src/a.tsx'), 'a3\n');
    fs.writeFileSync(path.join(top, 'apps/web/src/b.tsx'), 'b3\n');
    run(top, 'git', ['add', '-A']);
    const [t, root] = [real(top), real(path.join(top, 'apps/mobile'))];
    expect(engine.stagedEntries(t, root).map((e) => e.path)).toEqual(['apps/mobile/src/a.tsx']);
    expect(engine.headEntries(t, root).map((e) => e.path)).toEqual(['apps/mobile/cookwright.json', 'apps/mobile/src/a.tsx']);
    expect(engine.shownPath(t, root, 'apps/mobile/src/a.tsx')).toBe('src/a.tsx');
    expect(engine.rootSpec(t, root)).toBe(':(literal)apps/mobile');
    expect(engine.rootSpec(t, t)).toBe('.');
  });

  it('reads an unborn HEAD as no commit to count, and every staged file as added', () => {
    const repo = repoAt();
    const top = real(repo.root);
    expect(engine.headEntries(top, top)).toBeNull();
    fs.writeFileSync(path.join(repo.root, 'a.tsx'), 'a\n');
    run(repo.root, 'git', ['add', 'a.tsx']);
    expect(engine.stagedEntries(top, top).map((e) => [e.path, e.status, e.baseMode])).toEqual([['a.tsx', 'A', '000000']]);
  });
});

describe('countBy', () => {
  const measured = rules();
  const msg = (ruleId, message, severity = 2) => ({ ruleId, message, severity, line: 3, column: 7 });

  it('counts severity-2 messages of a measured rule, a shared id only with the rule’s tag in it', () => {
    const { counts, findings } = engine.countBy(
      [
        msg('i18next/no-literal-string', 'disallow literal string: Hello'),
        msg('no-restricted-syntax', '[cookwright expo tokens] use a theme colour token'),
        msg('no-restricted-syntax', 'my own selector'),
        // ESLint 9's no-restricted-imports wording, the configured message after its own (measured on 9.39.5)
        msg('no-restricted-imports', "'@supabase/supabase-js' import is restricted from being used. [cookwright supabase client] import it from the service"),
        msg('no-restricted-imports', "'lodash' import is restricted from being used. my own"),
        msg('max-lines-per-function', 'too long', 1),
        msg('no-unused-vars', 'x is unused'),
      ],
      measured,
    );
    expect([...counts]).toEqual([
      ['expo strings', 1],
      ['expo tokens', 1],
      ['supabase client', 1],
    ]);
    expect(findings.map((f) => f.text)).toEqual([
      'literal string in JSX; route it through t()',
      'colour or spacing literal in a component; use a theme token',
      'Supabase client imported outside the shared service; import it from there',
    ]);
  });

  it('never counts a rule switched off or not measured', () => {
    const on = rules([{ name: 'expo', rules: { strings: false } }]).filter((r) => r.key !== 'expo size');
    const { counts } = engine.countBy([msg('i18next/no-literal-string', 'x'), msg('max-lines-per-function', 'y')], on);
    expect([...counts]).toEqual([]);
  });
});

describe('lintAt and render', () => {
  const measured = rules();

  it('lints the code as the file at the top-relative path, with ESLint given the absolute path', async () => {
    const seen = [];
    const eslint = {
      lintText: async (code, { filePath }) => {
        seen.push([code, filePath]);
        return [{ messages: [{ ruleId: 'i18next/no-literal-string', severity: 2, message: 'm', line: 1, column: 2 }] }];
      },
    };
    const side = await engine.lintAt(eslint, '/top', 'src/A.tsx', '<T>hi</T>', measured);
    expect(seen).toEqual([['<T>hi</T>', '/top/src/A.tsx']]);
    expect([...side.counts]).toEqual([['expo strings', 1]]);
  });

  it('reads a rejected lint, a parsing error or an unreadable blob as unmeasured, never a count of 0', async () => {
    const rejects = { lintText: async () => Promise.reject(new Error('Error while loading rule\nstack')) };
    expect(await engine.lintAt(rejects, '/t', 'a.ts', 'x', measured)).toEqual({ unmeasured: m.lintThrew, detail: 'Error while loading rule' });
    const fatal = { lintText: async () => [{ messages: [{ ruleId: null, fatal: true, severity: 2, message: 'Parsing error', line: 4, column: 9 }] }] };
    expect(await engine.lintAt(fatal, '/t', 'a.ts', 'x', measured)).toEqual({ unmeasured: m.parseError(4, 9) });
    expect(await engine.lintAt(fatal, '/t', 'a.ts', null, measured)).toEqual({ unmeasured: m.noBlob });
  });

  it('renders a finding with the pack’s own text, never ESLint’s, which embeds the literal', async () => {
    const literal = 'ghp_0123456789abcdefghijklmnopqrstuvwxyzAB';
    const eslint = { lintText: async () => [{ messages: [{ ruleId: 'i18next/no-literal-string', severity: 2, message: `disallow literal string: ${literal}`, line: 2, column: 5 }] }] };
    const { findings } = await engine.lintAt(eslint, '/t', 'src/A.tsx', `<T>${literal}</T>`, measured);
    const line = engine.render('src/A.tsx', findings[0]);
    expect(line).toBe('src/A.tsx:2:5  expo strings  literal string in JSX; route it through t()');
    expect(line).not.toContain(literal);
  });
});
