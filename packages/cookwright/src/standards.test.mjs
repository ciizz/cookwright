// src/standards.test.mjs — `cookwright standards`, in process, over scratch repos
// measured by the fake ESLint package linked into their node_modules, the packs'
// real exports spread by their eslint.config.js (stage-4 plan §4.5, §6): the count
// on HEAD, the per-file ratchet of `--staged` with its exits and lines, and every
// state in which it cannot measure.

import fs from 'node:fs';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { messages } from './lib/messages.mjs';
import { main } from './standards.mjs';
import { commit, fakeEslintRepo, gitInit, run, scratchRepo, scratchRoot } from './test-helpers.mjs';

const m = messages.standards;
const TMP = scratchRoot('cookwright-standards-');

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

const ENV = { PATH: process.env.PATH, HOME: process.env.HOME, GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: '1' };
const I18NEXT = 'npm install --save-dev eslint-plugin-i18next';

// Components as the fake ESLint reads them: JSX text between > and <, a quoted hex colour.
const CLEAN = "export function Card() {\n  return <View style={styles.card}>{t('card.title')}</View>;\n}\n";
const LEGACY = "export function Card() {\n  return <View style={{ color: '#ff0000' }}>Hello there</View>;\n}\n";

let n = 0;
/** A repo declaring `packs`, measured by the fake, with `files` committed on main. */
function repoWith(files = {}, { packs = ['expo', 'supabase'], fake = {} } = {}) {
  const repo = scratchRepo(TMP, `r${(n += 1)}`, { packs });
  fakeEslintRepo(repo.root, fake);
  commit(repo, { 'README.md': 'r', ...files }, 'init');
  return repo;
}

function stage(repo, files) {
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo.root, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo.root, rel), body);
  }
  run(repo.root, 'git', ['add', '-A']);
}

const standards = (repo, args = ['--staged'], io = {}) => main(args, { cwd: repo.root, env: ENV, ...io });

describe('usage', () => {
  it('refuses a positional, an unknown flag or a value on --staged, exit 2, nothing measured', async () => {
    const repo = repoWith();
    for (const argv of [['x'], ['--ratchet'], ['--staged', 'yes']]) {
      expect(await main(argv, { cwd: repo.root, env: ENV })).toBe(2);
      expect(err.at(-1)).toBe(m.usage);
    }
    expect(out).toEqual([]);
  });
});

describe('no flag: the count on HEAD', () => {
  it('counts each measured rule over HEAD’s files, never the working tree', async () => {
    const repo = repoWith({ 'src/components/Card.tsx': LEGACY, 'src/lib/db.ts': "import { x } from '@supabase/supabase-js';\n" });
    fs.writeFileSync(path.join(repo.root, 'src/components/Card.tsx'), CLEAN);
    expect(await standards(repo, [])).toBe(0);
    expect(out).toEqual(['expo  strings  1', 'expo  tokens  1', 'expo  size  0', 'supabase  client  1', m.counted(3)]);
  });

  it('cannot count before the first commit', async () => {
    const repo = scratchRepo(TMP, `r${(n += 1)}`, { packs: ['expo'] });
    fakeEslintRepo(repo.root);
    expect(await standards(repo, [])).toBe(11);
    expect(out).toEqual([m.noHead]);
  });
});

describe('--staged: the per-file ratchet', () => {
  it('passes a legacy file touched without a new violation (disposition 31)', async () => {
    const repo = repoWith({ 'src/components/Card.tsx': LEGACY });
    stage(repo, { 'src/components/Card.tsx': `// a comment\n${LEGACY}` });
    expect(await standards(repo)).toBe(0);
    expect(out).toEqual([m.noRise(1)]);
  });

  it('fails a rise, its findings first with the pack’s text, the line naming the file and each risen rule', async () => {
    const repo = repoWith({ 'src/components/Card.tsx': CLEAN });
    stage(repo, { 'src/components/Card.tsx': LEGACY, 'src/components/Other.tsx': CLEAN });
    expect(await standards(repo)).toBe(10);
    expect(out).toEqual([
      'src/components/Card.tsx:2:32  expo tokens  colour or spacing literal in a component; use a theme token',
      'src/components/Card.tsx:2:45  expo strings  literal string in JSX; route it through t()',
      m.rose([m.roseItem('src/components/Card.tsx', ['expo strings 0 → 1', 'expo tokens 0 → 1'])]),
    ]);
    expect(out.join('\n')).not.toContain('Hello there');
  });

  it('counts an added file’s HEAD side as 0, and a rename’s HEAD side at its new path', async () => {
    const repo = repoWith({ 'src/components/Old.tsx': LEGACY });
    run(repo.root, 'git', ['mv', 'src/components/Old.tsx', 'src/components/New.tsx']);
    expect(await standards(repo)).toBe(0);
    expect(out).toEqual([m.noRise(1)]);
    out.length = 0;
    run(repo.root, 'git', ['commit', '-qm', 'rename', '--no-verify']);
    stage(repo, { 'src/components/Added.tsx': `// new\n${LEGACY}` });
    expect(await standards(repo)).toBe(10);
    expect(out.at(-1)).toBe(m.rose([m.roseItem('src/components/Added.tsx', ['expo strings 0 → 1', 'expo tokens 0 → 1'])]));
  });

  it('counts no deletion and says so; no file under a pack’s rules is a pass', async () => {
    const repo = repoWith({ 'src/components/Card.tsx': LEGACY, 'src/a.ts': 'a\n' });
    run(repo.root, 'git', ['rm', '-q', 'src/components/Card.tsx']);
    stage(repo, { 'src/a.ts': 'b\n' });
    expect(await standards(repo)).toBe(0);
    expect(out).toEqual([m.tail(m.noRise(1), [m.deleted(1)])]);
    out.length = 0;
    run(repo.root, 'git', ['commit', '-qm', 'x', '--no-verify']);
    stage(repo, { 'README.md': 'changed', 'notes.txt': 'n' });
    expect(await standards(repo)).toBe(0);
    expect(out).toEqual([m.noStaged]);
  });

  it('never lints a symbolic link staged beside a file', async () => {
    const repo = repoWith({ 'src/components/Card.tsx': CLEAN });
    fs.symlinkSync('Card.tsx', path.join(repo.root, 'src/components/Link.tsx'));
    stage(repo, { 'src/components/Card.tsx': `${CLEAN}\n` });
    expect(await standards(repo)).toBe(0);
    expect(out).toEqual([m.noRise(1)]);
  });

  it('skips, exit 11, when a file cannot be measured and nothing rose; a rise elsewhere still fails', async () => {
    const repo = repoWith({ 'src/components/Card.tsx': CLEAN });
    stage(repo, { 'src/components/Card.tsx': `${CLEAN}// FAKE_FATAL\n`, 'src/b.ts': '// FAKE_THROW\n' });
    expect(await standards(repo)).toBe(11);
    const items = [m.notMeasuredItem('src/b.ts', 'Error while loading rule: the fake was told to throw'), m.notMeasuredItem('src/components/Card.tsx', m.parseError(1, 1))];
    expect(out).toEqual([m.skippedBecause(m.notMeasured(items))]);
    out.length = 0;
    stage(repo, { 'src/components/Other.tsx': LEGACY });
    expect(await standards(repo)).toBe(10);
    expect(out.at(-1)).toBe(
      m.tail(m.rose([m.roseItem('src/components/Other.tsx', ['expo strings 0 → 1', 'expo tokens 0 → 1'])]), [m.notMeasured(items)]),
    );
  });

  it('measures the rules it can and names the rest: the plugin absent, a rule switched off counts nothing', async () => {
    const repo = repoWith({}, { packs: [{ name: 'expo', rules: { tokens: false } }], fake: { plugin: false } });
    stage(repo, { 'src/components/Card.tsx': LEGACY });
    expect(await standards(repo)).toBe(0);
    expect(out).toEqual([m.tail(m.noRise(1), [m.ruleSkipped('expo strings', m.needs(I18NEXT))])]);
  });

  it('reads a rule a later block replaced as overridden, and counts the others', async () => {
    const own = [
      "const expo = require('cookwright/packs/expo/eslint.cjs').withResolver((id) => require.resolve(id));",
      "module.exports = [...expo, { files: ['**/components/**'], rules: { 'no-restricted-syntax': ['error', { selector: \"Identifier[name='legacy']\", message: 'my own' }] } }];",
      '',
    ].join('\n');
    const repo = repoWith({}, { packs: ['expo'], fake: { config: own } });
    stage(repo, { 'src/components/Card.tsx': `${LEGACY}const legacy = 1;\n` });
    expect(await standards(repo)).toBe(10);
    expect(out.at(-1)).toBe(
      m.tail(m.rose([m.roseItem('src/components/Card.tsx', ['expo strings 0 → 1'])]), [m.ruleSkipped('expo tokens', m.overridden)]),
    );
  });

  it('lists only the config root’s files when it sits below the top, paths shown from the root', async () => {
    const top = gitInit(path.join(TMP, `nested-${(n += 1)}`));
    const root = path.join(top, 'apps/mobile');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'cookwright.json'), JSON.stringify({ version: 3, packs: ['expo'] }));
    fakeEslintRepo(root);
    commit({ root: top }, { 'apps/mobile/src/components/Card.tsx': CLEAN, 'apps/web/src/components/W.tsx': CLEAN }, 'init');
    stage({ root: top }, { 'apps/mobile/src/components/Card.tsx': LEGACY, 'apps/web/src/components/W.tsx': LEGACY });
    expect(await main(['--staged'], { cwd: root, env: ENV })).toBe(10);
    expect(out.at(-1)).toBe(m.rose([m.roseItem('src/components/Card.tsx', ['expo strings 0 → 1', 'expo tokens 0 → 1'])]));
  });
});

describe('cannot measure: one line, exit 11', () => {
  it('names a missing ESLint with the first pack’s setup line, a config that does not load, and no rule wired', async () => {
    const noEslint = repoWith({}, { fake: { eslint: null } });
    expect(await standards(noEslint)).toBe(11);
    const broken = repoWith({}, { fake: { config: "require('./missing');\n" } });
    expect(await standards(broken)).toBe(11);
    const unwired = repoWith({}, { packs: ['supabase'], fake: { config: 'module.exports = [];\n' } });
    expect(await standards(unwired)).toBe(11);
    expect(out[0]).toBe(m.noEslint('npx expo lint'));
    expect(out[1]).toMatch(/^skipped, ESLint could not load the repo's config: Cannot find module '\.\/missing'/);
    expect(out[2]).toBe(m.noneMeasured([m.ruleSkipped('supabase client', m.notWired('cookwright/packs/supabase/eslint.cjs'))]));
  });

  it('names no ESLint rule on, no config, an invalid one, and no work tree', async () => {
    const off = repoWith({}, { packs: [{ name: 'expo', rules: { strings: false, tokens: false, size: false } }] });
    expect(await standards(off)).toBe(11);
    const bare = gitInit(path.join(TMP, `bare-${(n += 1)}`));
    expect(await main(['--staged'], { cwd: bare, env: ENV })).toBe(11);
    fs.writeFileSync(path.join(bare, 'cookwright.json'), '{ "version": 3, "packs": ["nope"] }');
    expect(await main(['--staged'], { cwd: bare, env: ENV })).toBe(11);
    const outside = fs.mkdtempSync(path.join(TMP, 'outside-'));
    expect(await main(['--staged'], { cwd: outside, env: ENV })).toBe(11);
    expect(out[0]).toBe(m.noRules);
    expect(out[1]).toBe(m.noConfig);
    expect(out[2]).toMatch(/^skipped, cookwright\.json invalid: .*nope/);
    expect(out[3]).toBe(m.notWorkTree);
  });
});
