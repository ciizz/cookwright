// src/hook.test.mjs — `cookwright hook`, in process: the exit contract, the
// per-check SKIP for the harness's own trouble, COOKWRIGHT_SKIP, and each check's
// lines over scratch repos with the gitleaks scan played by a probe (plan §4.1, §6).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { main } from './hook.mjs';
import { main as init } from './init.mjs';
import { openDoctorRepo } from './lib/doctor/repo.mjs';
import { runChecks } from './lib/doctor/registry.mjs';
import { TimedOut } from './lib/budget.mjs';
import { generate } from './lib/changelog/state.mjs';
import { CONFIG_FILE, CONFIG_VERSION } from './lib/config.mjs';
import { CLI, messages } from './lib/messages.mjs';
import { callLine, callsCookwright, shimText } from './lib/hooks/shims.mjs';
import { hasTool } from './lib/probes.mjs';
import { commit, fakeEslintRepo, gitInit, run, scratchRepo, scratchRoot } from './test-helpers.mjs';

const TMP = scratchRoot('cookwright-hook-');
const PKG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

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

/** The suite may itself run under a hook: nothing of the caller's git or COOKWRIGHT_SKIP leaks in. */
const ENV = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
  GIT_CONFIG_NOSYSTEM: '1',
};
const RULE = { name: 'docs', code: ['src/*', ':!*.test.mjs'], docs: ['docs/guide.md'] };

let n = 0;
const repoAt = (config = { hooks: { docSync: [RULE] } }) => scratchRepo(TMP, `r${(n += 1)}`, config);

/** gitleaks played: on PATH, its scan exiting `status`, its version 8.30.1. */
function gitleaks(status = 0, over = {}) {
  const calls = [];
  return {
    calls,
    hasTool: () => true,
    scanStaged: (root, opts) => {
      calls.push({ root, opts });
      return { status, timedOut: false, stderr: '' };
    },
    gitleaksVersion: () => '8.30.1',
    ...over,
  };
}
const noGitleaks = { hasTool: (bin) => bin !== 'gitleaks' };

const hook = (repo, name, { probes = gitleaks(), env = ENV, args = [], input } = {}) =>
  main([name, ...args], { cwd: repo.root, probes, env, input });

/** The `<check>` line's status and note. */
const line = (check) => {
  const found = out.find((l) => l.split('  ')[2] === check);
  if (!found) return null;
  const [, status, , ...note] = found.split('  ');
  return { status, note: note.join('  ') };
};

function stage(repo, files) {
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo.root, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo.root, rel), body);
  }
  run(repo.root, 'git', ['add', '--', ...Object.keys(files)]);
}

describe('the command', () => {
  it('refuses a missing or unknown hook name with the usage, exit 2', () => {
    const repo = repoAt();
    expect(main([], { cwd: repo.root })).toBe(2);
    expect(err.at(-1)).toMatch(new RegExp(`^usage: ${CLI} hook <pre-commit\\|pre-push>`));
    expect(main(['post-merge'], { cwd: repo.root })).toBe(2);
    expect(main(['toString'], { cwd: repo.root })).toBe(2);
  });

  it('accepts and ignores everything after the name', () => {
    const repo = repoAt();
    expect(hook(repo, 'pre-commit', { args: ['origin', '../bare.git', '--x'] })).toBe(0);
    expect(line('secrets').status).toBe('PASS');
  });

  it('outside a work tree prints one line and exits 0', () => {
    const dir = path.join(TMP, 'plain');
    fs.mkdirSync(dir);
    expect(main(['pre-commit'], { cwd: dir, probes: gitleaks(), env: ENV })).toBe(0);
    expect(out).toEqual(['cookwright pre-commit: not inside a git work tree; nothing checked']);
  });

  it('prints one line per check, `<hook>  <STATUS>  <check>  <note>`, in order', () => {
    const repo = repoAt();
    expect(hook(repo, 'pre-commit')).toBe(0);
    expect(out).toEqual([
      'pre-commit  PASS  secrets  staged diff clean (gitleaks 8.30.1)',
      'pre-commit  PASS  doc-sync  1 rule(s) checked, no doc missing',
      'pre-commit  SKIP  standards  no packs declared',
    ]);
  });
});

describe('without a usable config', () => {
  it('runs secrets and SKIPs the config checks when there is no cookwright.json', () => {
    const repo = repoAt();
    fs.unlinkSync(path.join(repo.root, CONFIG_FILE));
    expect(hook(repo, 'pre-commit')).toBe(0);
    expect(line('secrets').status).toBe('PASS');
    expect(line('doc-sync')).toEqual({ status: 'SKIP', note: `no ${CONFIG_FILE}; run ${CLI} init` });
    expect(hook(repo, 'pre-commit', { probes: gitleaks(3) })).toBe(10);
  });

  it('names the loader’s message on an invalid one, and a secrets FAIL still exits 10', () => {
    const repo = repoAt();
    const bad = { version: CONFIG_VERSION, hooks: { docSync: [{ name: 'x', code: [':(foo)x'], docs: ['d'] }] } };
    fs.writeFileSync(path.join(repo.root, CONFIG_FILE), JSON.stringify(bad));
    expect(hook(repo, 'pre-commit')).toBe(0);
    expect(line('doc-sync')).toEqual({
      status: 'SKIP',
      note: `${CONFIG_FILE} invalid: hooks.docSync[0].code[0]: unknown pathspec magic "foo"; run ${CLI} doctor`,
    });
    out.length = 0;
    expect(hook(repo, 'pre-commit', { probes: gitleaks(3) })).toBe(10);
    expect(line('secrets').status).toBe('FAIL');
  });
});

describe('secrets', () => {
  it('SKIPs when gitleaks is not on PATH, and never calls the scan', () => {
    const repo = repoAt();
    expect(hook(repo, 'pre-commit', { probes: noGitleaks })).toBe(0);
    expect(line('secrets')).toEqual({ status: 'SKIP', note: 'skipped, needs gitleaks, run setup (brew install gitleaks)' });
  });

  it('PASSes on exit 0, naming the version when it is known, and scans at the root with git’s env', () => {
    const repo = repoAt();
    const probes = gitleaks(0);
    const env = { ...ENV, GIT_INDEX_FILE: '/x/index' };
    expect(hook(repo, 'pre-commit', { probes, env })).toBe(0);
    expect(probes.calls).toEqual([{ root: fs.realpathSync(repo.root), opts: { env } }]);
    out.length = 0;
    expect(hook(repo, 'pre-commit', { probes: gitleaks(0, { gitleaksVersion: () => null }) })).toBe(0);
    expect(line('secrets').note).toBe('staged diff clean');
  });

  it('FAILs on exit 3 with exit 10, never 1', () => {
    const repo = repoAt();
    expect(hook(repo, 'pre-commit', { probes: gitleaks(3) })).toBe(10);
    expect(line('secrets')).toEqual({
      status: 'FAIL',
      note: 'secret(s) in the staged diff (values redacted above); remove them, or add an anchored allowlist entry to .gitleaks.toml, never a whole-file one',
    });
  });

  it('SKIPs on any other exit or a timeout: a failure to run is not a finding', () => {
    const repo = repoAt();
    expect(hook(repo, 'pre-commit', { probes: gitleaks(1) })).toBe(0);
    expect(line('secrets')).toEqual({ status: 'SKIP', note: `gitleaks did not run (exit 1); run ${CLI} doctor` });
    out.length = 0;
    const slow = gitleaks(null, { scanStaged: () => ({ status: null, timedOut: true, stderr: '' }) });
    expect(hook(repo, 'pre-commit', { probes: slow })).toBe(0);
    expect(line('secrets').note).toBe(`gitleaks did not run (timed out after 60 s); run ${CLI} doctor`);
  });
});

describe('doc-sync', () => {
  it('SKIPs with no rules configured', () => {
    const repo = repoAt({});
    expect(hook(repo, 'pre-commit')).toBe(0);
    expect(line('doc-sync')).toEqual({
      status: 'SKIP',
      note: `no doc-sync rules configured (hooks.docSync in ${CONFIG_FILE})`,
    });
  });

  it('FAILs a rule whose code is staged without its doc, naming the files; PASSes with the doc', () => {
    const repo = repoAt();
    commit(repo, { 'README.md': 'x' }, 'init');
    stage(repo, { 'src/a.mjs': 'a', 'src/a.test.mjs': 't' });
    expect(hook(repo, 'pre-commit')).toBe(10);
    expect(line('doc-sync')).toEqual({
      status: 'FAIL',
      note: 'docs: 1 file(s) changed (src/a.mjs), but none of docs/guide.md is staged; update the doc in this commit, or COOKWRIGHT_SKIP=doc-sync with the reason in the message',
    });
    out.length = 0;
    stage(repo, { 'docs/guide.md': 'g' });
    expect(hook(repo, 'pre-commit')).toBe(0);
    expect(line('doc-sync').status).toBe('PASS');
  });

  it('PASSes code staged only under an excluded pathspec, and works on an unborn HEAD', () => {
    const repo = repoAt();
    stage(repo, { 'src/a.test.mjs': 't' });
    expect(hook(repo, 'pre-commit')).toBe(0);
    stage(repo, { 'src/b.mjs': 'b' });
    expect(hook(repo, 'pre-commit')).toBe(10);
  });

  it('reports every unmet rule in one line', () => {
    const other = { name: 'api', code: ['api/*'], docs: ['docs/api.md'] };
    const repo = repoAt({ hooks: { docSync: [RULE, other] } });
    stage(repo, { 'src/a.mjs': 'a', 'api/b.mjs': 'b' });
    expect(hook(repo, 'pre-commit')).toBe(10);
    expect(line('doc-sync').note).toMatch(/^docs: 1 file\(s\) changed .*; api: 1 file\(s\) changed .*; update the doc/);
  });

  it("leaves a pack-owned rule switched off in packs unchecked, and says so (disposition 8)", () => {
    const design = { name: 'expo:design-doc', code: ['components/**'], docs: ['docs/design-system.md'] };
    const noStandards = { ...ENV, COOKWRIGHT_SKIP: 'standards' };
    const on = repoAt({ packs: ['expo'], hooks: { docSync: [design, RULE] } });
    stage(on, { 'components/Button.tsx': 'b' });
    expect(hook(on, 'pre-commit', { env: noStandards })).toBe(10);
    expect(line('doc-sync').note).toMatch(/^expo:design-doc: 1 file\(s\) changed/);
    out.length = 0;
    const off = repoAt({ packs: [{ name: 'expo', rules: { 'design-doc': false } }], hooks: { docSync: [design, RULE] } });
    stage(off, { 'components/Button.tsx': 'b' });
    expect(hook(off, 'pre-commit', { env: noStandards })).toBe(0);
    expect(line('doc-sync')).toEqual({
      status: 'PASS',
      note: '1 rule(s) checked, no doc missing; expo:design-doc not checked, switched off in packs',
    });
    out.length = 0;
    const only = repoAt({ packs: [{ name: 'expo', rules: { 'design-doc': false } }], hooks: { docSync: [design] } });
    stage(only, { 'components/Button.tsx': 'b' });
    expect(hook(only, 'pre-commit', { env: noStandards })).toBe(0);
    expect(line('doc-sync')).toEqual({
      status: 'SKIP',
      note: `no doc-sync rule checked: expo:design-doc switched off in packs (${CONFIG_FILE})`,
    });
  });

  it('a pathspec git refuses (exit 128) is its own SKIP line and leaves a secrets FAIL in force', () => {
    const bad = { name: 'bad', code: [':(glob,literal)src'], docs: ['d'] };
    const repo = repoAt({ hooks: { docSync: [bad] } });
    expect(hook(repo, 'pre-commit')).toBe(0);
    expect(line('doc-sync').status).toBe('SKIP');
    expect(line('doc-sync').note).toMatch(/^could not run: bad: fatal: /);
    out.length = 0;
    expect(hook(repo, 'pre-commit', { probes: gitleaks(3) })).toBe(10);
    expect(line('secrets').status).toBe('FAIL');
    expect(line('doc-sync').status).toBe('SKIP');
  });
});

describe('standards', () => {
  const sm = messages.hook.standards;
  /** spawnSync played: records its calls, answers `r`. */
  function child(r) {
    const calls = [];
    const spawn = (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return { status: 0, stdout: '', stderr: '', ...r };
    };
    return { calls, spawn };
  }
  const packed = () => repoAt({ packs: ['expo'] });

  it('SKIPs with no packs declared, spawning nothing', () => {
    const c = child({});
    expect(main(['pre-commit'], { cwd: repoAt().root, probes: gitleaks(), env: ENV, spawn: c.spawn })).toBe(0);
    expect(line('standards')).toEqual({ status: 'SKIP', note: 'no packs declared' });
    expect(c.calls).toEqual([]);
  });

  it('runs this package’s bin as a child from the config root, with git’s env, a 60 s cap and SIGKILL', () => {
    const repo = packed();
    const c = child({ stdout: '1 staged file(s), no rise\n' });
    const env = { ...ENV, GIT_INDEX_FILE: '.git/next-index.lock' };
    expect(main(['pre-commit'], { cwd: repo.root, probes: gitleaks(), env, spawn: c.spawn })).toBe(0);
    expect(c.calls).toHaveLength(1);
    const [{ cmd, args, opts }] = c.calls;
    expect(cmd).toBe(process.execPath);
    expect(args).toEqual([path.join(PKG_DIR, 'bin/cookwright.mjs'), 'standards', '--staged']);
    expect(opts).toMatchObject({ cwd: fs.realpathSync(repo.root), env, timeout: 60_000, killSignal: 'SIGKILL' });
    expect(line('standards')).toEqual({ status: 'PASS', note: '1 staged file(s), no rise' });
  });

  it('FAILs on exit 10, the findings above the line and the escape on it; the commit exits 10', () => {
    const findings = 'src/components/Card.tsx:2:32  expo tokens  colour or spacing literal in a component; use a theme token';
    const last = "a pack rule's count rose in 1 staged file(s): src/components/Card.tsx expo tokens 0 → 1";
    const c = child({ status: 10, stdout: `${findings}\n${last}\n`, stderr: 'Warning: React version was set to detect' });
    expect(main(['pre-commit'], { cwd: packed().root, probes: gitleaks(), env: ENV, spawn: c.spawn })).toBe(10);
    expect(line('standards')).toEqual({ status: 'FAIL', note: sm.failed(last) });
    expect(out.indexOf(findings)).toBe(out.findIndex((l) => l.startsWith('pre-commit  FAIL  standards')) - 1);
    expect(out.join('\n')).not.toContain('React version');
  });

  it('SKIPs on exit 11 with the child’s line, a timeout, a crash or no line; none blocks the commit', () => {
    const cases = [
      [{ status: 11, stdout: 'skipped, needs ESLint (npx expo lint installs it)\n' }, 'skipped, needs ESLint (npx expo lint installs it)'],
      [{ status: null, error: Object.assign(new Error('spawnSync node ETIMEDOUT'), { code: 'ETIMEDOUT' }) }, sm.timedOut(60)],
      [{ status: 1, stderr: 'TypeError: boom\n    at x' }, messages.hook.couldNotRun(sm.exit(1, 'TypeError: boom'))],
      [{ status: 0, stdout: '' }, messages.hook.couldNotRun(sm.silent)],
    ];
    for (const [r, note] of cases) {
      out.length = 0;
      expect(main(['pre-commit'], { cwd: packed().root, probes: gitleaks(), env: ENV, spawn: child(r).spawn })).toBe(0);
      expect(line('standards')).toEqual({ status: 'SKIP', note });
    }
  });

  it('COOKWRIGHT_SKIP=standards skips it without spawning', () => {
    const c = child({ status: 10, stdout: 'rose\n' });
    const env = { ...ENV, COOKWRIGHT_SKIP: 'standards' };
    expect(main(['pre-commit'], { cwd: packed().root, probes: gitleaks(), env, spawn: c.spawn })).toBe(0);
    expect(line('standards').note).toBe('skipped by COOKWRIGHT_SKIP; say why in the commit message');
    expect(c.calls).toEqual([]);
  });
});

describe('a check that throws or times out', () => {
  it('is that check’s SKIP line; another check’s FAIL still exits 10', () => {
    const repo = repoAt();
    stage(repo, { 'src/a.mjs': 'a' });
    const boom = gitleaks(0, {
      scanStaged: () => {
        throw new Error('spawn exploded\nsecond line');
      },
    });
    expect(hook(repo, 'pre-commit', { probes: boom })).toBe(10);
    expect(line('secrets')).toEqual({ status: 'SKIP', note: 'could not run: spawn exploded' });
    expect(line('doc-sync').status).toBe('FAIL');
  });

  it('a timeout reads as one, and alone exits 0', () => {
    const repo = repoAt();
    const stalled = gitleaks(0, {
      scanStaged: () => {
        throw new TimedOut('gitleaks');
      },
    });
    expect(hook(repo, 'pre-commit', { probes: stalled })).toBe(0);
    expect(line('secrets').note).toMatch(/^could not run: gitleaks did not answer in time/);
  });
});

describe('COOKWRIGHT_SKIP', () => {
  it('skips the named check, says to give the reason, and runs the others', () => {
    const repo = repoAt();
    stage(repo, { 'src/a.mjs': 'a' });
    const probes = gitleaks(3);
    expect(hook(repo, 'pre-commit', { probes, env: { ...ENV, COOKWRIGHT_SKIP: 'doc-sync' } })).toBe(10);
    expect(line('doc-sync')).toEqual({ status: 'SKIP', note: 'skipped by COOKWRIGHT_SKIP; say why in the commit message' });
    expect(line('secrets').status).toBe('FAIL');
    out.length = 0;
    expect(hook(repo, 'pre-commit', { env: { ...ENV, COOKWRIGHT_SKIP: ' doc-sync , secrets' } })).toBe(0);
    expect(out.filter((l) => l.includes('skipped by COOKWRIGHT_SKIP'))).toHaveLength(2);
  });

  it('reports an unknown name on one line and ignores it', () => {
    const repo = repoAt();
    expect(hook(repo, 'pre-commit', { env: { ...ENV, COOKWRIGHT_SKIP: 'docsync,secrets' } })).toBe(0);
    expect(out[0]).toBe(
      'pre-commit  COOKWRIGHT_SKIP names unknown check(s) docsync, ignored (known: secrets, doc-sync, standards, gate, changelog)',
    );
    expect(line('secrets').status).toBe('SKIP');
    expect(line('doc-sync').status).toBe('PASS');
  });

  it('two failing checks: both lines, exit 10', () => {
    const repo = repoAt();
    stage(repo, { 'src/a.mjs': 'a' });
    expect(hook(repo, 'pre-commit', { probes: gitleaks(3) })).toBe(10);
    expect(out.map((l) => l.split('  ').slice(1, 3).join(' '))).toEqual(['FAIL secrets', 'FAIL doc-sync', 'SKIP standards']);
  });
});

describe('pre-push', () => {
  const ZERO = '0'.repeat(40);
  const node = (code) => `node -e "${code}"`;
  const OK = { name: 'ok', run: node('process.exit(0)') };
  const probes = { hasTool: (bin) => bin !== 'gitleaks' && hasTool(bin) };

  /** A committed repo whose changelog is current, with `checks` as its gate. */
  function pushRepo(checks = [OK], config = {}) {
    const repo = repoAt({ gate: { checks }, ...config });
    commit(repo, { 'README.md': 'x' }, 'feat: one');
    commit(repo, { 'CHANGELOG.md': generate(repo.root).text }, 'docs: changelog');
    return { ...repo, head: run(repo.root, 'git', ['rev-parse', 'HEAD']) };
  }
  const pushing = (repo, sha = repo.head, ref = 'refs/heads/main') => `${ref} ${sha} refs/heads/main ${ZERO}\n`;
  const push = (repo, input = pushing(repo), opts = {}) => hook(repo, 'pre-push', { probes, input, ...opts });

  it('runs the gate and the changelog check on what is pushed, accepting git’s arguments', () => {
    const repo = pushRepo();
    expect(hook(repo, 'pre-push', { probes, input: pushing(repo), args: ['origin', '../bare.git'] })).toBe(0);
    expect(line('gate').status).toBe('PASS');
    expect(line('gate').note).toMatch(/^ok \(\d+\.\d s\)$/);
    expect(line('changelog')).toEqual({ status: 'PASS', note: 'CHANGELOG.md matches 0 release tag(s)' });
  });

  it('SKIPs both checks when nothing is pushed, or only deletions', () => {
    const repo = pushRepo();
    expect(push(repo, '')).toBe(0);
    expect(line('gate')).toEqual({ status: 'SKIP', note: 'nothing to push' });
    expect(line('changelog')).toEqual({ status: 'SKIP', note: 'nothing to push' });
    out.length = 0;
    expect(push(repo, `(delete) ${ZERO} refs/heads/old ${repo.head}\n`)).toBe(0);
    expect(line('gate')).toEqual({ status: 'SKIP', note: 'only deletions pushed' });
    expect(line('changelog')).toEqual({ status: 'SKIP', note: 'only deletions pushed' });
  });

  it('SKIPs both, running nothing, when a pushed sha is not HEAD', () => {
    const repo = pushRepo([{ name: 'marker', run: node("require('fs').writeFileSync('ran', '')") }]);
    const older = run(repo.root, 'git', ['rev-parse', 'HEAD~1']);
    run(repo.root, 'git', ['branch', 'other', older]);
    expect(push(repo, pushing(repo, older, 'refs/heads/other'))).toBe(0);
    const note = 'not tested: other is not the checked-out branch';
    expect(line('gate')).toEqual({ status: 'SKIP', note });
    expect(line('changelog')).toEqual({ status: 'SKIP', note });
    expect(fs.existsSync(path.join(repo.root, 'ran'))).toBe(false);
  });

  it('runs both when any pushed ref is HEAD, each line naming what it tested and what not (branch plus an older branch)', () => {
    const repo = pushRepo();
    const older = run(repo.root, 'git', ['rev-parse', 'HEAD~1']);
    const input = `${pushing(repo)}${pushing(repo, older, 'refs/heads/old')}`;
    expect(push(repo, input)).toBe(0);
    const label = 'tested main at HEAD; not tested: old is not the checked-out branch';
    expect(line('gate').note).toMatch(new RegExp(`^ok \\(\\d+\\.\\d s\\), ${label}$`));
    expect(line('changelog')).toEqual({ status: 'PASS', note: `CHANGELOG.md matches 0 release tag(s), ${label}` });
  });

  /** An annotated tag `name` on `rev`: its own object sha, not the commit's. */
  const annotated = (repo, name, rev = 'HEAD') => {
    run(repo.root, 'git', ['tag', '-a', name, '-m', 'released: 2026-10-15', rev]);
    return run(repo.root, 'git', ['rev-parse', name]);
  };

  it('counts an annotated tag on HEAD as HEAD: pushed with the branch, or alone', () => {
    const repo = pushRepo();
    const tag = annotated(repo, 'v1.0.0');
    expect(tag).not.toBe(repo.head);
    const tagLine = `refs/tags/v1.0.0 ${tag} refs/tags/v1.0.0 ${ZERO}\n`;
    // The changelog predates the tag: the release push is where the stale check must fire.
    expect(push(repo, `${pushing(repo)}${tagLine}`)).toBe(10);
    expect(line('gate').status).toBe('PASS');
    expect(line('changelog')).toEqual({
      status: 'FAIL',
      note: 'CHANGELOG.md: out of date with the release tags; run npx cookwright changelog and commit',
    });
    out.length = 0;
    expect(push(repo, tagLine)).toBe(10);
    expect(line('gate').note).not.toMatch(/not tested/);
    expect(line('changelog').status).toBe('FAIL');
  });

  it('SKIPs both when the only pushed ref is an annotated tag on another commit', () => {
    const repo = pushRepo();
    const tag = annotated(repo, 'v0.9.0', 'HEAD~1');
    expect(push(repo, `refs/tags/v0.9.0 ${tag} refs/tags/v0.9.0 ${ZERO}\n`)).toBe(0);
    const note = 'not tested: refs/tags/v0.9.0 is not the checked-out branch';
    expect(line('gate')).toEqual({ status: 'SKIP', note });
    expect(line('changelog')).toEqual({ status: 'SKIP', note });
  });

  it('SKIPs both, running nothing, when the tree is dirty, not counting the bundle state', () => {
    const repo = pushRepo([{ name: 'marker', run: node("require('fs').writeFileSync('ran', '')") }]);
    fs.writeFileSync(path.join(repo.root, 'README.md'), 'changed');
    fs.mkdirSync(path.join(repo.root, 'new'));
    fs.writeFileSync(path.join(repo.root, 'new/file.txt'), 'untracked');
    fs.mkdirSync(path.join(repo.root, 'docs/bundles/x'), { recursive: true });
    fs.writeFileSync(path.join(repo.root, 'docs/bundles/x/state.json'), '{}');
    expect(push(repo)).toBe(0);
    const note = `not tested: the working tree has 2 uncommitted file(s) and is not ${repo.head.slice(0, 8)}`;
    expect(line('gate')).toEqual({ status: 'SKIP', note });
    expect(line('changelog')).toEqual({ status: 'SKIP', note });
    expect(fs.existsSync(path.join(repo.root, 'ran'))).toBe(false);
  });

  it('runs both on a clean tree once only the bundle state is uncommitted', () => {
    const repo = pushRepo();
    fs.mkdirSync(path.join(repo.root, 'docs/bundles/x'), { recursive: true });
    fs.writeFileSync(path.join(repo.root, 'docs/bundles/x/state.json'), '{}');
    expect(push(repo)).toBe(0);
    expect(line('gate').note).toMatch(/^ok \(\d+\.\d s\)$/);
    expect(line('changelog')).toEqual({ status: 'PASS', note: 'CHANGELOG.md matches 0 release tag(s)' });
  });

  it('SKIPs the gate with no checks configured, or with every check skipped, naming them', () => {
    expect(push(pushRepo([]))).toBe(0);
    expect(line('gate')).toEqual({ status: 'SKIP', note: 'no gate checks configured (gate.checks)' });
    out.length = 0;
    const needs = { name: 'lint', run: 'true', needs: ['no-such-tool-x'] };
    expect(push(pushRepo([needs]))).toBe(0);
    expect(line('gate')).toEqual({
      status: 'SKIP',
      note: 'every gate check skipped: lint (skipped, needs no-such-tool-x, run setup)',
    });
  });

  it('reads a check’s own skipExit as a skip: beside a pass the gate PASSes naming it; alone, a SKIP carrying its line', () => {
    const cannot = { name: 'standards', run: node("console.log('skipped, no base to ratchet against'); process.exit(11)"), skipExit: 11 };
    expect(push(pushRepo([OK, cannot]))).toBe(0);
    expect(line('gate').note).toMatch(/^ok \(\d+\.\d s\); skipped: standards$/);
    expect(out).toContain('  SKIPPED standards (skipped, no base to ratchet against)');
    out.length = 0;
    expect(push(pushRepo([cannot]))).toBe(0);
    expect(line('gate')).toEqual({
      status: 'SKIP',
      note: 'no check ran (every check was skipped: standards (skipped, no base to ratchet against)) — run setup, or fix gate.checks in cookwright.json',
    });
    out.length = 0;
    const { skipExit, ...plain } = cannot;
    expect(skipExit).toBe(11);
    expect(push(pushRepo([plain]))).toBe(10);
    expect(line('gate').status).toBe('FAIL');
  });

  it('FAILs a failing check with its tail above the line and the elapsed time, exit 10', () => {
    const bad = { name: 'unit', run: node("console.log('assertion failed here'); process.exit(1)") };
    const needs = { name: 'lint', run: 'true', needs: ['no-such-tool-x'] };
    expect(push(pushRepo([OK, bad, needs]))).toBe(10);
    expect(line('gate').status).toBe('FAIL');
    expect(line('gate').note).toMatch(/^unit \(\d+\.\d s\); skipped: lint$/);
    const tail = out.findIndex((l) => l.includes('── unit (stdout tail, then stderr tail) ──'));
    expect(tail).toBeGreaterThan(-1);
    expect(out[tail]).toMatch(/assertion failed here/);
    expect(tail).toBeLessThan(out.findIndex((l) => l.startsWith('pre-push  FAIL  gate')));
  });

  it('SKIPs the gate, exit 0, on an npm script the repo lacks, with the gate’s own text', () => {
    const repo = pushRepo([{ name: 'test', run: 'npm test' }]);
    fs.writeFileSync(path.join(repo.root, 'package.json'), '{"scripts":{}}');
    commit(repo, {}, 'chore: package');
    expect(push(repo, pushing(repo, run(repo.root, 'git', ['rev-parse', 'HEAD'])))).toBe(0);
    expect(line('gate').status).toBe('SKIP');
    expect(line('gate').note).toMatch(/^gate check "test" runs npm script "test", which package.json does not define/);
  });

  it('passes the pushed ref’s remote commit to the gate as COOKWRIGHT_PUSH_BASE: one ref, a new ref, refs that disagree', () => {
    const says = node("console.log(process.env.COOKWRIGHT_PUSH_BASE || 'none')");
    const repo = pushRepo([{ name: 'base', run: `${says} > base.txt` }]);
    const older = run(repo.root, 'git', ['rev-parse', 'HEAD~1']);
    const read = () => fs.readFileSync(path.join(repo.root, 'base.txt'), 'utf8').trim();
    const ignore = () => fs.appendFileSync(path.join(repo.root, '.git/info/exclude'), 'base.txt\n');
    ignore();
    const ref = (name, remote) => `${name} ${repo.head} ${name} ${remote}\n`;
    expect(push(repo, ref('refs/heads/main', older), { env: { ...ENV, COOKWRIGHT_PUSH_BASE: 'outer' } })).toBe(0);
    expect(read()).toBe(older);
    expect(push(repo, ref('refs/heads/main', ZERO), { env: { ...ENV, COOKWRIGHT_PUSH_BASE: 'outer' } })).toBe(0);
    expect(read()).toBe('none');
    // A new tag beside the branch: the tag has no remote commit, the branch's is the base.
    expect(push(repo, `${ref('refs/heads/main', older)}${ref('refs/tags/v1', ZERO)}`)).toBe(0);
    expect(read()).toBe(older);
    out.length = 0;
    expect(push(repo, `${ref('refs/heads/main', older)}${ref('refs/heads/other', repo.head)}`)).toBe(0);
    expect(read()).toBe('none');
    expect(line('gate').note).toMatch(/, no ratchet base: main, other at HEAD have different remote commits$/);
  });

  it('runs the gate commands without git’s hook variables, keeping the rest', () => {
    const vars = "['GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_DIR'].some((k) => k in process.env)";
    const leak = node(`process.exit(${vars} ? 1 : 0)`);
    const kept = node("process.exit(process.env.KEPT === 'yes' ? 0 : 1)");
    const repo = pushRepo([
      { name: 'leak', run: leak },
      { name: 'kept', run: kept },
    ]);
    const git = path.join(repo.root, '.git');
    const env = { ...ENV, GIT_DIR: git, GIT_INDEX_FILE: path.join(git, 'index'), GIT_PREFIX: '', KEPT: 'yes' };
    expect(push(repo, pushing(repo), { env })).toBe(0);
    expect(line('gate').note).toMatch(/^leak, kept \(\d+\.\d s\)$/);
  });

  it('maps the changelog state: stale FAILs, unmarked and missing SKIP', () => {
    const repo = pushRepo();
    const pushCommitted = (files) => push(repo, pushing(repo, commit(repo, files, 'docs: changelog')));
    const text = fs.readFileSync(path.join(repo.root, 'CHANGELOG.md'), 'utf8');
    expect(pushCommitted({ 'CHANGELOG.md': `${text}hand edit\n` })).toBe(10);
    expect(line('changelog').status).toBe('FAIL');
    expect(line('changelog').note).toMatch(/^CHANGELOG\.md: out of date with the release tags; run npx cookwright changelog and commit/);
    out.length = 0;
    expect(pushCommitted({ 'CHANGELOG.md': '# Changelog\n' })).toBe(0);
    expect(line('changelog').note).toMatch(/^CHANGELOG\.md: not generated by cookwright; npx cookwright changelog --adopt replaces the file/);
    out.length = 0;
    fs.unlinkSync(path.join(repo.root, 'CHANGELOG.md'));
    expect(pushCommitted({})).toBe(0);
    expect(line('changelog').note).toMatch(/^CHANGELOG\.md: missing; run npx cookwright init/);
  });

  it('COOKWRIGHT_SKIP=gate leaves the changelog check running', () => {
    const repo = pushRepo();
    expect(push(repo, pushing(repo), { env: { ...ENV, COOKWRIGHT_SKIP: 'gate' } })).toBe(0);
    expect(line('gate').status).toBe('SKIP');
    expect(line('changelog').status).toBe('PASS');
  });

  it('SKIPs both with the loader’s message when the config is invalid', () => {
    const repo = pushRepo();
    fs.writeFileSync(path.join(repo.root, CONFIG_FILE), '{"version": 0}');
    expect(push(repo)).toBe(0);
    expect(line('gate').note).toBe(`${CONFIG_FILE} invalid: version must be ${CONFIG_VERSION}; run ${CLI} doctor`);
    expect(line('changelog').note).toBe(line('gate').note);
  });
});

describe('the shims', () => {
  it('call the hook and map its exit codes; no exec, no npx', () => {
    const text = shimText('pre-commit');
    expect(text.startsWith('#!/bin/sh\n')).toBe(true);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).not.toContain('\r');
    const commands = text.split('\n').filter((l) => !l.startsWith('#'));
    expect(commands.filter((l) => /\bnpx\b|\bexec\b/.test(l))).toEqual([]);
    expect(text).toContain(`${callLine('pre-commit')}; s=$?`);
    expect(text).toContain('[ $s -eq 10 ] && exit 1');
    expect(shimText('pre-push')).toContain('cookwright pre-push crashed (exit $s); the push goes through unchecked');
  });

  it('callsCookwright accepts only the forms in which a finding reaches git', () => {
    const call = callLine('pre-commit');
    const file = (...lines) => ['#!/bin/sh', ...lines, ''].join('\n');
    expect(callsCookwright(shimText('pre-commit'), 'pre-commit')).toBe(true);
    for (const ok of [`exec ${call}`, `  ${call} || exit 1`, `${call} || exit $?`]) {
      expect(callsCookwright(file('npm run lint', ok, 'echo after'), 'pre-commit')).toBe(true);
    }
    expect(callsCookwright(file('npm run lint', call, '# trailing comment', ''), 'pre-commit')).toBe(true);
    expect(callsCookwright(file(call).replace(/\n/g, '\r\n'), 'pre-commit')).toBe(true);
    for (const bad of [file(`${call} || true`), file(call, 'echo done'), file(`# ${call}`), file('npx lint-staged')]) {
      expect(callsCookwright(bad, 'pre-commit')).toBe(false);
    }
    expect(callsCookwright(file(callLine('pre-push')), 'pre-commit')).toBe(false);
    expect(callsCookwright(shimText('pre-push'), 'pre-commit')).toBe(false);
  });
});

describe('end to end: a real git commit through the shim', () => {
  const PKG = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  /** git's own config isolated; gitleaks skipped (it would run for real here and SKIP elsewhere). */
  const GIT_ENV = { ...ENV, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', COOKWRIGHT_SKIP: 'secrets' };

  function e2eRepo(pkg = PKG) {
    const repo = repoAt();
    commit(repo, { 'README.md': 'x', 'docs/guide.md': 'g' }, 'init');
    fs.appendFileSync(path.join(repo.root, '.git/info/exclude'), 'node_modules\n');
    if (pkg) {
      fs.mkdirSync(path.join(repo.root, 'node_modules'));
      fs.symlinkSync(pkg, path.join(repo.root, 'node_modules/cookwright'));
    }
    fs.mkdirSync(path.join(repo.root, '.githooks'));
    hookFile(repo, shimText('pre-commit'));
    run(repo.root, 'git', ['config', 'core.hooksPath', '.githooks']);
    return repo;
  }
  const hookFile = (repo, text) => fs.writeFileSync(path.join(repo.root, '.githooks/pre-commit'), text, { mode: 0o755 });
  const userHook = (repo, line) => hookFile(repo, `#!/bin/sh\necho user hook\n${line}\n`);
  const head = (repo) => run(repo.root, 'git', ['rev-parse', 'HEAD']);

  /** `git commit` for real (hooks on), with `files` staged. */
  function gitCommit(repo, files, msg = 'feat: change', env = GIT_ENV) {
    stage(repo, files);
    const r = spawnSync('git', ['commit', '-q', '-m', msg], { cwd: repo.root, env, encoding: 'utf8' });
    return { status: r.status, output: `${r.stdout}${r.stderr}` };
  }

  it('refuses a code change without its doc (the shim maps 10 to 1), then lands it with the doc', () => {
    const repo = e2eRepo();
    const before = head(repo);
    const refused = gitCommit(repo, { 'src/a.mjs': 'a' });
    expect(refused.status).toBe(1);
    expect(refused.output).toMatch(/pre-commit {2}SKIP {2}secrets {2}skipped by COOKWRIGHT_SKIP/);
    expect(refused.output).toMatch(/pre-commit {2}FAIL {2}doc-sync {2}docs: 1 file\(s\) changed \(src\/a\.mjs\)/);
    expect(head(repo)).toBe(before);
    const shim = spawnSync('sh', ['.githooks/pre-commit'], { cwd: repo.root, env: GIT_ENV, encoding: 'utf8' });
    expect(shim.status).toBe(1);
    const landed = gitCommit(repo, { 'docs/guide.md': 'updated' });
    expect(landed.status).toBe(0);
    expect(landed.output).toMatch(/pre-commit {2}PASS {2}doc-sync/);
    expect(head(repo)).not.toBe(before);
  });

  it('refuses through a user’s own hook in each accepted form; `|| true` lets the commit land', () => {
    const repo = e2eRepo();
    const call = callLine('pre-commit');
    for (const form of [`exec ${call}`, `${call} || exit 1`, call]) {
      userHook(repo, form);
      const r = gitCommit(repo, { 'src/a.mjs': form });
      expect([form, r.status]).toEqual([form, 1]);
      expect(r.output).toMatch(/user hook[\s\S]*pre-commit {2}FAIL {2}doc-sync/);
    }
    userHook(repo, `${call} || true`);
    const swallowed = gitCommit(repo, { 'src/a.mjs': 'swallowed' });
    expect(swallowed.status).toBe(0);
    expect(swallowed.output).toMatch(/pre-commit {2}FAIL {2}doc-sync/);
    expect(callsCookwright(`#!/bin/sh\n${call} || true\n`, 'pre-commit')).toBe(false);
  });

  it('through the hooks init installs: refused without the doc, landed with it', () => {
    const repo = repoAt();
    commit(repo, { 'README.md': 'x', 'docs/guide.md': 'g' }, 'init');
    fs.appendFileSync(path.join(repo.root, '.git/info/exclude'), 'node_modules\n');
    fs.mkdirSync(path.join(repo.root, 'node_modules'));
    fs.symlinkSync(PKG, path.join(repo.root, 'node_modules/cookwright'));
    init([], { cwd: repo.root, home: TMP, probes: { ...gitleaks(), claudeVersion: () => '2.1.281' } });
    expect(out.some((l) => /^wrote {4}hooks\.path +/.test(l) && l.endsWith(messages.init.hooks.pathSet('.githooks')))).toBe(true);
    expect(fs.readFileSync(path.join(repo.root, '.githooks/pre-commit'), 'utf8')).toBe(shimText('pre-commit'));
    const before = head(repo);
    const refused = gitCommit(repo, { 'src/a.mjs': 'a' });
    expect(refused.status).toBe(1);
    expect(refused.output).toMatch(/pre-commit {2}FAIL {2}doc-sync {2}docs: 1 file\(s\) changed \(src\/a\.mjs\)/);
    expect(head(repo)).toBe(before);
    expect(gitCommit(repo, { 'docs/guide.md': 'updated' }).status).toBe(0);
  });

  /** A gitleaks on PATH that logs the directory it ran in, finds nothing and says 8.30.1. */
  function cwdGitleaks(dir) {
    const bin = path.join(dir, 'fake-bin');
    fs.mkdirSync(bin, { recursive: true });
    const log = path.join(dir, 'gitleaks-cwd.log');
    const script = `#!/bin/sh\n[ "$1" = version ] && { echo 8.30.1; exit 0; }\npwd -P >> '${log}'\nexit 0\n`;
    fs.writeFileSync(path.join(bin, 'gitleaks'), script, { mode: 0o755 });
    const env = { ...GIT_ENV, PATH: `${bin}${path.delimiter}${GIT_ENV.PATH}` };
    delete env.COOKWRIGHT_SKIP;
    return { env, cwds: () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) };
  }

  it('refuses a component that adds a colour literal and JSX text, through the child and the fake ESLint; lands it fixed', () => {
    const repo = repoAt({ packs: ['expo'] });
    fakeEslintRepo(repo.root);
    commit(repo, { 'README.md': 'x', 'src/components/Card.tsx': 'export function Card() {\n  return null;\n}\n' }, 'init');
    fs.mkdirSync(path.join(repo.root, '.githooks'));
    fs.writeFileSync(path.join(repo.root, '.githooks/pre-commit'), shimText('pre-commit'), { mode: 0o755 });
    run(repo.root, 'git', ['config', 'core.hooksPath', '.githooks']);
    const before = head(repo);
    const bad = "export function Greeting() {\n  return <Text style={{ color: '#ff0000' }}>Hello there</Text>;\n}\n";
    const refused = gitCommit(repo, { 'src/components/Greeting.tsx': bad });
    expect(refused.status).toBe(1);
    expect(refused.output).toContain('src/components/Greeting.tsx:2:32  expo tokens  colour or spacing literal in a component; use a theme token');
    expect(refused.output).toContain('src/components/Greeting.tsx:2:45  expo strings  literal string in JSX; route it through t()');
    expect(refused.output).toMatch(/pre-commit {2}FAIL {2}standards {2}a pack rule's count rose in 1 staged file\(s\): src\/components\/Greeting\.tsx expo strings 0 → 1, expo tokens 0 → 1; fix them, or COOKWRIGHT_SKIP=standards/);
    expect(refused.output).not.toContain('Hello there');
    expect(head(repo)).toBe(before);
    const good = "export function Greeting() {\n  return <Text style={styles.text}>{t('greeting')}</Text>;\n}\n";
    const landed = gitCommit(repo, { 'src/components/Greeting.tsx': good });
    expect(landed.output).toContain('pre-commit  PASS  standards  1 staged file(s), no rise');
    expect(landed.status).toBe(0);
  });

  it('a config below the work tree top: init writes the shims at the top, a real commit is checked, doctor agrees', () => {
    const top = gitInit(path.join(TMP, `nested-${(n += 1)}`));
    const repo = { root: path.join(top, 'apps/mobile') };
    fs.mkdirSync(repo.root, { recursive: true });
    fs.writeFileSync(path.join(repo.root, CONFIG_FILE), JSON.stringify({ version: CONFIG_VERSION, hooks: { docSync: [RULE] } }));
    const outer = { root: top };
    commit(outer, { 'README.md': 'x', 'apps/mobile/docs/guide.md': 'g' }, 'init');
    fs.appendFileSync(path.join(top, '.git/info/exclude'), 'node_modules\n');
    fs.mkdirSync(path.join(repo.root, 'node_modules'));
    fs.symlinkSync(PKG, path.join(repo.root, 'node_modules/cookwright'));
    const probes = { ...gitleaks(), claudeVersion: () => '2.1.281' };
    init([], { cwd: repo.root, home: TMP, probes });
    expect(out.join('\n')).toMatch(/wrote +\.\.\/\.\.\/\.githooks\/pre-commit/);
    expect(fs.readFileSync(path.join(top, '.githooks/pre-commit'), 'utf8')).toBe(shimText('pre-commit', 'apps/mobile'));
    expect(fs.existsSync(path.join(repo.root, '.githooks'))).toBe(false);
    expect(run(top, 'git', ['config', '--get', 'core.hooksPath'])).toBe('.githooks');
    const before = head(outer);
    const scan = cwdGitleaks(path.join(TMP, `nested-bin-${n}`));
    const refused = gitCommit(outer, { 'apps/mobile/src/a.mjs': 'a' }, 'feat: change', scan.env);
    expect(refused.status).toBe(1);
    expect(refused.output).toContain('pre-commit  PASS  secrets  staged diff clean (gitleaks 8.30.1)');
    expect(scan.cwds()).toEqual([fs.realpathSync(top)]); // the whole staged diff, never apps/mobile alone
    expect(refused.output).toMatch(/pre-commit {2}FAIL {2}doc-sync {2}docs: 1 file\(s\) changed \(apps\/mobile\/src\/a\.mjs\)/);
    expect(head(outer)).toBe(before);
    expect(gitCommit(outer, { 'apps/mobile/docs/guide.md': 'updated' }).status).toBe(0);
    const rows = Object.fromEntries(runChecks(openDoctorRepo(repo.root, probes, { home: TMP }), probes));
    expect(['hooks.path', 'hooks.pre-commit', 'hooks.pre-push'].map((c) => rows[c])).toEqual([
      { status: 'PASS', note: messages.doctor.hooks.pathOk('.githooks') },
      { status: 'PASS', note: messages.doctor.hooks.shim('../../.githooks/pre-commit') },
      { status: 'PASS', note: messages.doctor.hooks.shim('../../.githooks/pre-push') },
    ]);
  });

  it('a config below the top in a checkout without that directory: the not-here line, exit 0', () => {
    const repo = repoAt();
    commit(repo, { 'README.md': 'x' }, 'init');
    fs.mkdirSync(path.join(repo.root, '.githooks'));
    hookFile(repo, shimText('pre-commit', 'apps/gone'));
    run(repo.root, 'git', ['config', 'core.hooksPath', '.githooks']);
    const r = gitCommit(repo, { 'src/a.mjs': 'a' });
    expect(r.status).toBe(0);
    expect(r.output).toContain('cookwright pre-commit skipped: apps/gone is not in this checkout');
  });

  it('without the package installed: the not-installed line, exit 0, the commit lands', () => {
    const repo = e2eRepo(null);
    const r = gitCommit(repo, { 'src/a.mjs': 'a' });
    expect(r.status).toBe(0);
    expect(r.output).toContain('cookwright pre-commit skipped: package not installed (npm install)');
  });

  it('a package whose bin throws at import: the crashed line, exit 0, the commit lands', () => {
    const broken = path.join(TMP, 'broken-pkg');
    fs.mkdirSync(path.join(broken, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(broken, 'bin/cookwright.mjs'), "throw new Error('broken at import');\n");
    const repo = e2eRepo(broken);
    const r = gitCommit(repo, { 'src/a.mjs': 'a' });
    expect(r.status).toBe(0);
    expect(r.output).toMatch(/cookwright pre-commit crashed \(exit 1\); the commit goes through unchecked/);
  });
});
