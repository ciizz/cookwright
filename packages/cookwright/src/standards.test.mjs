// src/standards.test.mjs — `cookwright standards`, in process, over scratch repos
// measured by the fake ESLint package linked into their node_modules, the packs'
// real exports spread by their eslint.config.js (stage-4 plan §4.5, §6): the count
// on HEAD, the per-file ratchet of `--staged` with its exits and lines, the branch
// ratchet of `--ratchet` with its base order, the types measure of `--types`
// through a fake supabase CLI on PATH, and every state in which it cannot measure.

import fs from 'node:fs';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { messages } from './lib/messages.mjs';
import { appliedVersions, typesShape } from './lib/packs/types.mjs';
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
  it('refuses a positional, an unknown flag, a value on a mode, two modes or --base alone, exit 2, nothing measured', async () => {
    const repo = repoWith();
    const refused = [['x'], ['--nope'], ['--staged', 'yes'], ['--ratchet', 'main'], ['--staged', '--ratchet'], ['--base', 'main'], ['--ratchet', '--base']];
    for (const argv of refused) {
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

describe('--ratchet: the branch against its base', () => {
  const sha = (repo, rev = 'HEAD') => run(repo.root, 'git', ['rev-parse', rev]);
  const since = (repo, rev, label) => m.since(sha(repo, rev), label);
  /** A repo with `files` on main and a branch `feat` holding `changes` in one commit. */
  function branched(files, changes, opts) {
    const repo = repoWith(files, opts);
    run(repo.root, 'git', ['checkout', '-qb', 'feat']);
    commit(repo, changes, 'feat');
    return repo;
  }
  const ratchet = (repo, args = [], env = ENV) => main(['--ratchet', ...args], { cwd: repo.root, env });

  it('passes a branch whose counts did not rise, the verdict line first, against the merge-base', async () => {
    const repo = branched({ 'src/components/Card.tsx': LEGACY }, { 'src/components/Card.tsx': CLEAN, 'src/a.ts': 'a\n' });
    expect(await ratchet(repo)).toBe(0);
    const changes = ['expo strings 1 → 0', 'expo tokens 1 → 0', 'expo size 0 → 0', 'supabase client 0 → 0'];
    expect(out).toEqual([m.ratchet(changes, [], 2, since(repo, 'main', 'merge-base main HEAD'))]);
    expect(out[0]).toBe(`${changes.join(', ')} (2 file(s) since ${sha(repo, 'main').slice(0, 8)} (merge-base main HEAD))`);
  });

  it('fails a rise, the line naming each risen rule and its files, the findings below it', async () => {
    const repo = branched({ 'src/components/Card.tsx': LEGACY }, { 'src/components/Card.tsx': CLEAN, 'src/components/New.tsx': LEGACY, 'src/components/Two.tsx': `// two\n${LEGACY}` });
    expect(await ratchet(repo)).toBe(10);
    const at = since(repo, 'main', 'merge-base main HEAD');
    const files = ['src/components/New.tsx', 'src/components/Two.tsx'];
    expect(out[0]).toBe(m.ratchetRose([m.risenItem('expo strings 1 → 2', files), m.risenItem('expo tokens 1 → 2', files)], at));
    expect(out.slice(1)).toEqual([
      'src/components/New.tsx:2:32  expo tokens  colour or spacing literal in a component; use a theme token',
      'src/components/New.tsx:2:45  expo strings  literal string in JSX; route it through t()',
      'src/components/Two.tsx:3:32  expo tokens  colour or spacing literal in a component; use a theme token',
      'src/components/Two.tsx:3:45  expo strings  literal string in JSX; route it through t()',
    ]);
    expect(out.join('\n')).not.toContain('Hello there');
  });

  it('names the deleted files it did not count, the rules it did not measure, and no change at all', async () => {
    const repo = repoWith({ 'src/components/Card.tsx': LEGACY, 'src/a.ts': 'a\n' }, { packs: ['expo'], fake: { plugin: false } });
    run(repo.root, 'git', ['checkout', '-qb', 'feat']);
    run(repo.root, 'git', ['rm', '-q', 'src/components/Card.tsx']);
    run(repo.root, 'git', ['commit', '-qm', 'rm', '--no-verify']);
    const at = since(repo, 'main', 'merge-base main HEAD');
    expect(await ratchet(repo)).toBe(0);
    expect(out).toEqual([m.tail(m.noChange(at), [m.ruleSkipped('expo strings', m.needs(I18NEXT)), m.deleted(1)])]);
    out.length = 0;
    commit(repo, { 'src/a.ts': 'b\n' }, 'a');
    expect(await ratchet(repo)).toBe(0);
    expect(out).toEqual([m.ratchet(['expo tokens 0 → 0', 'expo size 0 → 0'], [m.ruleSkipped('expo strings', m.needs(I18NEXT)), m.deleted(1)], 1, at)]);
  });

  it('lints a rename’s base side at its new path: a legacy file moved is no rise', async () => {
    const repo = repoWith({ 'src/components/Old.tsx': LEGACY });
    run(repo.root, 'git', ['checkout', '-qb', 'feat']);
    run(repo.root, 'git', ['mv', 'src/components/Old.tsx', 'src/components/New.tsx']);
    run(repo.root, 'git', ['commit', '-qm', 'mv', '--no-verify']);
    expect(await ratchet(repo)).toBe(0);
    expect(out[0]).toMatch(/^expo strings 1 → 1, expo tokens 1 → 1, .* \(1 file\(s\) since /);
  });

  it('skips, exit 11, when a changed file cannot be measured and nothing rose', async () => {
    const repo = branched({}, { 'src/b.ts': '// FAKE_THROW\n' });
    expect(await ratchet(repo)).toBe(11);
    expect(out).toEqual([m.skippedBecause(m.notMeasured([m.notMeasuredItem('src/b.ts', 'Error while loading rule: the fake was told to throw')]))]);
  });

  it('on the base branch: its upstream, and with none no base, exit 11 naming what it tried', async () => {
    const repo = repoWith({ 'src/components/Card.tsx': CLEAN });
    commit(repo, { 'src/components/Card.tsx': LEGACY }, 'worse');
    expect(await ratchet(repo)).toBe(11);
    expect(out).toEqual([m.noBase(['main@{upstream}'])]);
    out.length = 0;
    run(repo.root, 'git', ['branch', 'remote-ish', 'HEAD~1']);
    run(repo.root, 'git', ['branch', '-q', '--set-upstream-to=remote-ish', 'main']);
    expect(await ratchet(repo)).toBe(10);
    expect(out[0]).toBe(
      m.ratchetRose(['expo strings 0 → 1', 'expo tokens 0 → 1'].map((c) => m.risenItem(c, ['src/components/Card.tsx'])), since(repo, 'HEAD~1', 'main@{upstream}')),
    );
  });

  it('takes --base first, then COOKWRIGHT_PUSH_BASE, each falling through when it names no commit here', async () => {
    const repo = repoWith({ 'src/components/Card.tsx': CLEAN });
    commit(repo, { 'src/components/Card.tsx': LEGACY }, 'worse');
    const head = sha(repo);
    const env = { ...ENV, COOKWRIGHT_PUSH_BASE: head };
    expect(await ratchet(repo, [], env)).toBe(0);
    expect(out.at(-1)).toBe(m.tail(m.noChange(m.since(head, 'COOKWRIGHT_PUSH_BASE')), []));
    out.length = 0;
    expect(await ratchet(repo, ['--base', 'HEAD~1'], env)).toBe(10);
    expect(out[0]).toMatch(new RegExp(`since ${sha(repo, 'HEAD~1').slice(0, 8)} \\(--base HEAD~1\\)`));
    out.length = 0;
    const missing = 'f'.repeat(40);
    expect(await ratchet(repo, ['--base', 'no-such-ref'], { ...ENV, COOKWRIGHT_PUSH_BASE: missing })).toBe(11);
    expect(out).toEqual([m.noBase(['--base no-such-ref', 'COOKWRIGHT_PUSH_BASE', 'main@{upstream}'])]);
  });

  it('off the base branch with no base branch here: no base, exit 11', async () => {
    const repo = repoWith({}, { packs: ['expo'] });
    run(repo.root, 'git', ['checkout', '-qb', 'feat']);
    run(repo.root, 'git', ['branch', '-qD', 'main']);
    expect(await ratchet(repo)).toBe(11);
    expect(out).toEqual([m.noBase(['merge-base main HEAD'])]);
  });

  it('lists only the config root’s changed files when it sits below the top', async () => {
    const top = gitInit(path.join(TMP, `nested-r-${(n += 1)}`));
    const root = path.join(top, 'apps/mobile');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'cookwright.json'), JSON.stringify({ version: 3, packs: ['expo'] }));
    fakeEslintRepo(root);
    commit({ root: top }, { 'apps/mobile/src/components/Card.tsx': CLEAN, 'apps/web/src/components/W.tsx': CLEAN }, 'init');
    run(top, 'git', ['checkout', '-qb', 'feat']);
    commit({ root: top }, { 'apps/mobile/src/components/Card.tsx': LEGACY, 'apps/web/src/components/W.tsx': LEGACY }, 'worse');
    expect(await main(['--ratchet'], { cwd: root, env: ENV })).toBe(10);
    const file = ['src/components/Card.tsx'];
    expect(out[0]).toBe(m.ratchetRose([m.risenItem('expo strings 0 → 1', file), m.risenItem('expo tokens 0 → 1', file)], m.since(run(top, 'git', ['rev-parse', 'main']), 'merge-base main HEAD')));
  });
});

describe('--types: the supabase types against the local stack', () => {
  const t = m.types;
  const SCRIPT = 'supabase gen types --local --schema public > src/types/db.ts';
  const INIT = '20261025120000_init.sql';
  const TODOS = '20261025130000_todos.sql';
  const TYPES = 'export type Database = { public: { todos: {} } };\n';
  /** A fake `supabase` on PATH: `migration list` prints list.txt (or fails), `gen types` records its args and prints types.ts. */
  function fakeSupabase() {
    const dir = fs.mkdtempSync(path.join(TMP, 'supabase-'));
    const bin = path.join(dir, 'supabase');
    const script = [
      '#!/bin/sh',
      'here=$(dirname "$0")',
      'case "$1 $2" in',
      '  "migration list") [ -f "$here/list.fail" ] && { echo "failed to connect to postgres" >&2; exit 1; }; cat "$here/list.txt" ;;',
      '  "gen types") shift 2; echo "$@" > "$here/gen.args"; cat "$here/types.ts" ;;',
      '  *) exit 3 ;;',
      'esac',
      '',
    ].join('\n');
    fs.writeFileSync(bin, script, { mode: 0o755 });
    return dir;
  }
  const table = (versions) =>
    ['', '   Local          | Remote         | Time (UTC)          ', '  ----------------|----------------|---------------------',
      ...versions.map((v) => `   ${v} | ${v} | 2026-10-25 12:00:00 `), ''].join('\n');
  /** main with the init migration and its types, a branch `feat` adding `changes`; the fake stack applied `applied`. */
  function supa(changes, { script = SCRIPT, applied = ['20261025120000', '20261025130000'], generated = TYPES } = {}) {
    const repo = repoWith(
      { 'package.json': JSON.stringify({ scripts: { 'db:types': script } }), [`supabase/migrations/${INIT}`]: 'create table a();\n', 'src/types/db.ts': 'export type Database = {};\n' },
      { packs: ['supabase'] },
    );
    run(repo.root, 'git', ['checkout', '-qb', 'feat']);
    if (changes) commit(repo, changes, 'feat');
    const dir = fakeSupabase();
    fs.writeFileSync(path.join(dir, 'list.txt'), table(applied));
    fs.writeFileSync(path.join(dir, 'types.ts'), generated);
    return { repo, dir, env: { ...ENV, PATH: `${dir}${path.delimiter}${ENV.PATH}` } };
  }
  const types = ({ repo, env }, args = []) => main(['--types', ...args], { cwd: repo.root, env });
  const at = (repo) => m.since(run(repo.root, 'git', ['rev-parse', 'main']), 'merge-base main HEAD');

  it('accepts exactly one script shape, --local among its args, nothing after the target', () => {
    expect(typesShape(SCRIPT)).toEqual({ args: ['--local', '--schema', 'public'], target: 'src/types/db.ts' });
    expect(typesShape('supabase gen types typescript --local>types.ts')).toEqual({ args: ['typescript', '--local'], target: 'types.ts' });
    for (const bad of [
      'supabase gen types --linked > db.ts',
      'npx supabase gen types --local > db.ts',
      'supabase gen types --local > db.ts && prettier --write db.ts',
      'supabase gen types --local | tee db.ts',
      'supabase gen types --local > db.ts; echo done',
      'supabase gen types --local > a.ts > b.ts',
      'supabase gen types --local >> db.ts',
      "supabase gen types --local --schema 'public' > db.ts",
      'supabase gen types --local > /tmp/db.ts',
      'supabase gen types --local > ../db.ts',
      'supabase gen types --local',
      undefined,
    ]) {
      expect([bad, typesShape(bad)]).toEqual([bad, null]);
    }
  });

  it('passes types that match what the local stack generates, its args passed through', async () => {
    const s = supa({ [`supabase/migrations/${TODOS}`]: 'create table todos();\n', 'src/types/db.ts': TYPES });
    expect(await types(s)).toBe(0);
    expect(out).toEqual([t.current('src/types/db.ts', at(s.repo))]);
    expect(fs.readFileSync(path.join(s.dir, 'gen.args'), 'utf8').trim()).toBe('--local --schema public');
  });

  it('fails stale types, exit 10, naming the file and npm run db:types', async () => {
    const s = supa({ [`supabase/migrations/${TODOS}`]: 'create table todos();\n' });
    expect(await types(s)).toBe(10);
    expect(out).toEqual([t.rose('src/types/db.ts', 'db:types')]);
    expect(out[0]).toBe('src/types/db.ts differs from what the local stack generates; run npm run db:types and commit it (measured against the local stack)');
  });

  it('skips with no migration or types change since the base', async () => {
    const s = supa({ 'README.md': 'other' });
    expect(await types(s)).toBe(11);
    expect(out).toEqual([t.noChange(at(s.repo))]);
  });

  it('skips when the local stack differs from HEAD’s migrations, either direction, or cannot be read', async () => {
    const todos = { [`supabase/migrations/${TODOS}`]: 'create table todos();\n' };
    const behind = supa(todos, { applied: ['20261025120000'] });
    expect(await types(behind)).toBe(11);
    const ahead = supa(todos, { applied: ['20261025120000', '20261025130000', '20261026090000'] });
    expect(await types(ahead)).toBe(11);
    const down = supa(todos);
    fs.writeFileSync(path.join(down.dir, 'list.fail'), '');
    expect(await types(down)).toBe(11);
    const odd = supa(todos);
    fs.writeFileSync(path.join(odd.dir, 'list.txt'), 'no table here\n');
    expect(await types(odd)).toBe(11);
    expect(out).toEqual([t.stackDiffers(0, 1), t.stackDiffers(1, 0), t.stackFailed('failed to connect to postgres'), t.stackUnread]);
  });

  it('skips: the rule off, no script, another shape, no CLI, no base', async () => {
    const off = supa(null);
    expect(await main(['--types'], { cwd: repoWith({}, { packs: ['expo'] }).root, env: off.env })).toBe(11);
    const none = supa(null, { script: null });
    fs.writeFileSync(path.join(none.repo.root, 'package.json'), '{}');
    expect(await types(none)).toBe(11);
    expect(await types(supa(null, { script: 'supabase gen types --linked > db.ts' }))).toBe(11);
    const noCli = supa(null);
    expect(await types({ ...noCli, env: { ...ENV, PATH: fs.mkdtempSync(path.join(TMP, 'empty-')) } })).toBe(11);
    const noBase = supa(null);
    run(noBase.repo.root, 'git', ['checkout', '-q', 'main']);
    expect(await types(noBase)).toBe(11);
    expect(out).toEqual([t.off, t.noScript('db:types'), t.shape('db:types'), t.needsCli, m.noBase(['main@{upstream}'])]);
  });

  it('reads the applied versions from the Remote column of migration list --local', () => {
    expect(appliedVersions(table(['20261025120000']))).toEqual(['20261025120000']);
    const pending = '   Local          | Remote | Time (UTC)\n  ---|---|---\n   20261025120000 |        | 2026-10-25 12:00:00\n';
    expect(appliedVersions(pending)).toEqual([]);
    expect(appliedVersions('\u001b[1m   Local | Remote | Time\u001b[0m\n x | 20261025120000 | y\n')).toEqual(['20261025120000']);
    expect(appliedVersions('Cannot connect')).toBeNull();
  });
});
