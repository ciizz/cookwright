// src/lib/probes.test.mjs — the machine probes, against scratch repos and a fake PATH.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { gitInit, run, scratchRoot, stageOnly } from '../test-helpers.mjs';
import { TimedOut, withBudget } from './budget.mjs';
import {
  SCAN_ARGS,
  atLeast,
  capture,
  claudeVersion,
  gitleaksVersion,
  hasTool,
  ignored,
  ignoredBy,
  parseVersion,
  rootFiles,
  scanStaged,
  spawnChild,
  terminal,
} from './probes.mjs';

const TMP = scratchRoot('cookwright-probes-');

describe('hasTool', () => {
  it('finds an executable on PATH and nothing else', () => {
    const bin = path.join(TMP, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'tool'), '#!/bin/sh\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'plain'), 'x', { mode: 0o644 });
    fs.mkdirSync(path.join(bin, 'dir'));
    expect(hasTool('tool', { PATH: bin })).toBe(true);
    expect(hasTool('plain', { PATH: bin })).toBe(false);
    expect(hasTool('dir', { PATH: bin })).toBe(false);
    expect(hasTool('absent', { PATH: bin })).toBe(false);
    expect(hasTool('node')).toBe(true);
  });
});

describe('versions', () => {
  it('parses the first x.y.z and compares numerically', () => {
    expect(parseVersion('2.1.281 (Claude Code)')).toBe('2.1.281');
    expect(parseVersion('no version')).toBeNull();
    expect(atLeast('2.1.281', '2.1.281')).toBe(true);
    expect(atLeast('2.1.280', '2.1.281')).toBe(false);
    expect(atLeast('2.10.0', '2.9.999')).toBe(true);
  });

  it('reads an absent or failing claude as null', () => {
    expect(claudeVersion({ bin: path.join(TMP, 'no-such-claude') })).toBeNull();
    const fake = path.join(TMP, 'fake-claude');
    fs.writeFileSync(fake, '#!/bin/sh\necho "2.1.300 (Claude Code)"\n', { mode: 0o755 });
    // A generous timeout: a script exec'd for the first time can be slow to start
    // (macOS scans a new executable), and this test is about the parsing.
    expect(claudeVersion({ bin: fake, timeout: 10_000 })).toBe('2.1.300');
    const failing = path.join(TMP, 'failing-claude');
    fs.writeFileSync(failing, '#!/bin/sh\necho 2.1.300; exit 3\n', { mode: 0o755 });
    expect(claudeVersion({ bin: failing, timeout: 10_000 })).toBeNull();
  });
});

describe('ignored', () => {
  it('answers per path, and partial coverage reads as partial', () => {
    const root = gitInit(path.join(TMP, 'repo'));
    fs.writeFileSync(path.join(root, '.gitignore'), '.env\n');
    expect(ignored(root, '.env')).toBe(true);
    expect(ignored(root, '.env.local')).toBe(false);
    fs.writeFileSync(path.join(root, '.gitignore'), '.env*\n');
    expect(ignored(root, '.env.local')).toBe(true);
  });

  it('judges a tracked path by the rules, not by the index', () => {
    const root = gitInit(path.join(TMP, 'tracked'));
    fs.writeFileSync(path.join(root, '.gitignore'), '.env\n');
    stageOnly(root, '.env');
    expect(run(root, 'git', ['ls-files'])).toBe('.env');
    expect(ignored(root, '.env')).toBe(true);
  });

  it('throws on a git error instead of answering "not ignored"', () => {
    const outside = path.join(TMP, 'not-a-repo');
    fs.mkdirSync(outside);
    expect(() => ignored(outside, '.env')).toThrow(/git check-ignore \.env failed: .+/);
  });
});

describe('ignoredBy', () => {
  it('names the rule that ignores a path, a directory asked with its slash, and null for a negation', () => {
    const root = gitInit(path.join(TMP, 'by'));
    fs.writeFileSync(path.join(root, '.gitignore'), '# keys\nsecrets/\n*.age\n!keep/*.age\n');
    expect(ignoredBy(root, 'secrets/')).toEqual({ source: '.gitignore', line: 2, pattern: 'secrets/' });
    expect(ignoredBy(root, 'secrets/recipients.txt')).toEqual({ source: '.gitignore', line: 2, pattern: 'secrets/' });
    expect(ignoredBy(root, 'x.age')).toEqual({ source: '.gitignore', line: 3, pattern: '*.age' });
    expect(ignoredBy(root, 'keep/x.age')).toBeNull();
    expect(ignoredBy(root, 'other.txt')).toBeNull();
    const outside = path.join(TMP, 'not-a-repo-by');
    fs.mkdirSync(outside);
    expect(() => ignoredBy(outside, 'x')).toThrow(/git check-ignore x failed: .+/);
  });
});

describe('capture, spawnChild, terminal', () => {
  const node = process.execPath;

  it('captures both outputs of a call fed on stdin, with the env and cwd it is given', () => {
    const code = 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{console.log(s.length, process.env.ONLY, process.cwd());console.error("e");process.exit(4)})';
    const r = capture(node, ['-e', code], { input: 'abc', env: { ONLY: 'x' }, cwd: TMP });
    expect(r.status).toBe(4);
    expect(r.stdout.trim().split(' ').slice(0, 2)).toEqual(['3', 'x']);
    expect(fs.realpathSync(r.stdout.trim().split(' ')[2])).toBe(fs.realpathSync(TMP));
    expect(r.stderr).toBe('e\n');
    expect(capture(path.join(TMP, 'no-such-tool'), []).status).toBeNull();
  });

  it('is bounded by its cap and by a spent budget, and uncapped with cap null', () => {
    expect(() => capture(node, ['-e', 'setTimeout(()=>{},5000)'], { cap: 200 })).toThrow(TimedOut);
    expect(() => withBudget(() => capture(node, ['-e', '1']), 0)).toThrow(TimedOut);
    expect(capture(node, ['-e', 'setTimeout(()=>{},300)'], { cap: null }).status).toBe(0);
  });

  it('spawns the one child without a shell', async () => {
    const child = spawnChild('echo', ['$HOME', '|', 'x'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    await new Promise((resolve) => child.on('close', resolve));
    expect(out).toBe('$HOME | x\n');
  });

  it('reads no terminal where /dev/tty does not open (an agent shell, the test runner)', () => {
    expect(typeof terminal()).toBe('boolean');
  });
});

describe('rootFiles', () => {
  it('names the regular files at the top of a directory, never what is below', () => {
    const dir = path.join(TMP, 'top');
    fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'README.md'), 'x');
    fs.writeFileSync(path.join(dir, 'sub/notes.md'), 'x');
    fs.symlinkSync('README.md', path.join(dir, 'link.md'));
    fs.symlinkSync('missing', path.join(dir, 'dangling'));
    expect(rootFiles(dir).sort()).toEqual(['README.md', 'link.md']);
  });
});

describe('gitleaks', () => {
  /** A fake gitleaks in its own PATH directory: prints its argv and cwd to stderr, exits `code`. */
  function fakeGitleaks(name, code) {
    const dir = path.join(TMP, name);
    fs.mkdirSync(dir);
    const body = `#!/bin/sh\necho "$@" >&2\npwd >&2\necho "8.30.1"\nexit ${code}\n`;
    fs.writeFileSync(path.join(dir, 'gitleaks'), body, { mode: 0o755 });
    return dir;
  }

  it('scans the staged diff at the root with the exit-code-3 flags, under the env it is given', () => {
    const root = gitInit(path.join(TMP, 'scan'));
    const env = { PATH: fakeGitleaks('leaks3', 3) };
    const r = scanStaged(root, { quiet: true, env, cap: 10_000 });
    expect(r.status).toBe(3);
    expect(r.timedOut).toBe(false);
    const [args, cwd] = r.stderr.trim().split('\n');
    expect(args).toBe(SCAN_ARGS.join(' '));
    expect(SCAN_ARGS).toEqual(['git', '--pre-commit', '--staged', '--redact', '--verbose', '--no-color', '--no-banner', '--exit-code', '3']);
    expect(fs.realpathSync(cwd)).toBe(fs.realpathSync(root));
    expect(scanStaged(root, { quiet: true, env: { PATH: path.join(TMP, 'nowhere') } }).status).toBeNull();
  });

  it('reads the version, or null when gitleaks is absent or fails', () => {
    const ok = fakeGitleaks('leaks0', 0);
    expect(gitleaksVersion({ bin: path.join(ok, 'gitleaks'), timeout: 10_000 })).toBe('8.30.1');
    const failing = fakeGitleaks('leaks1', 1);
    expect(gitleaksVersion({ bin: path.join(failing, 'gitleaks'), timeout: 10_000 })).toBeNull();
    expect(gitleaksVersion({ bin: path.join(TMP, 'no-such-gitleaks') })).toBeNull();
  });
});
