// src/lib/probes.test.mjs — the machine probes, against scratch repos and a fake PATH.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { gitInit, run, scratchRoot, stageOnly } from '../test-helpers.mjs';
import {
  SCAN_ARGS,
  atLeast,
  claudeVersion,
  gitleaksVersion,
  hasTool,
  ignored,
  parseVersion,
  rootFiles,
  scanStaged,
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
