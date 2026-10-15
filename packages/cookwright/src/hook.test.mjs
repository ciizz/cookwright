// src/hook.test.mjs — `cookwright hook`, in process: the exit contract, the
// per-check SKIP for the harness's own trouble, COOKWRIGHT_SKIP, and each check's
// lines over scratch repos with the gitleaks scan played by a probe (plan §4.1, §6).

import fs from 'node:fs';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { main } from './hook.mjs';
import { TimedOut } from './lib/budget.mjs';
import { CONFIG_FILE } from './lib/config.mjs';
import { CLI } from './lib/messages.mjs';
import { commit, run, scratchRepo, scratchRoot } from './test-helpers.mjs';

const TMP = scratchRoot('cookwright-hook-');

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
const ENV = { PATH: process.env.PATH, HOME: process.env.HOME };
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

const hook = (repo, name, { probes = gitleaks(), env = ENV, args = [] } = {}) =>
  main([name, ...args], { cwd: repo.root, probes, env });

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
    const bad = { version: 1, hooks: { docSync: [{ name: 'x', code: [':(foo)x'], docs: ['d'] }] } };
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
    expect(out.filter((l) => l.includes('SKIP  '))).toHaveLength(2);
  });

  it('reports an unknown name on one line and ignores it', () => {
    const repo = repoAt();
    expect(hook(repo, 'pre-commit', { env: { ...ENV, COOKWRIGHT_SKIP: 'docsync,secrets' } })).toBe(0);
    expect(out[0]).toBe(
      'pre-commit  COOKWRIGHT_SKIP names unknown check(s) docsync, ignored (known: secrets, doc-sync)',
    );
    expect(line('secrets').status).toBe('SKIP');
    expect(line('doc-sync').status).toBe('PASS');
  });

  it('two failing checks: both lines, exit 10', () => {
    const repo = repoAt();
    stage(repo, { 'src/a.mjs': 'a' });
    expect(hook(repo, 'pre-commit', { probes: gitleaks(3) })).toBe(10);
    expect(out.map((l) => l.split('  ').slice(1, 3).join(' '))).toEqual(['FAIL secrets', 'FAIL doc-sync']);
  });
});
