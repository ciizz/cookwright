// src/doctor.test.mjs — doctor: every row of plan §4.8's table, on scratch repos,
// with the probes injected (no Claude binary; git played absent where it matters).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { dispatch } from './cli-main.mjs';
import { main } from './doctor.mjs';
import { BUDGET_MS, TimedOut } from './lib/budget.mjs';
import { DEFAULTS } from './lib/config.mjs';
import { checkClaudeHook } from './lib/doctor/claude.mjs';
import { openDoctorRepo } from './lib/doctor/repo.mjs';
import { runChecks } from './lib/doctor/registry.mjs';
import { HOOK_COMMAND, HOSTS } from './lib/hosts.mjs';
import { messages } from './lib/messages.mjs';
import { PROBES } from './lib/probes.mjs';
import { renderBlock } from './lib/rules/block.mjs';
import { commit, gitInit, scratchRepo, scratchRoot, stageOnly } from './test-helpers.mjs';

const TMP = scratchRoot('cookwright-doctor-');
const m = messages.doctor;

const BACKLOG = '# Backlog\n\n## Open bugs\n\n## Open enhancements\n\n## Closed\n';
const SETTINGS = (command = HOOK_COMMAND) =>
  `${JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command }] }] } }, null, 2)}\n`;

/** Every file of a Level 0 repo on the default paths, committed on `main`. */
const LEVEL0_FILES = {
  'docs/backlog.md': BACKLOG,
  'docs/closeouts/.gitkeep': '',
  'CHANGELOG.md': '# Changelog\n\n## Unreleased\n',
  'AGENTS.md': `# Rules\n\n${renderBlock(DEFAULTS)}\n`,
  '.claude/settings.json': SETTINGS(),
  '.gitignore': '.env\n.env.*\n!.env.example\n',
};

/** Probes for a machine with git and Claude Code 2.1.281; override any of them. */
const probes = (over = {}) => ({ ...PROBES, claudeVersion: () => '2.1.281', ...over });

let n = 0;
/** A healthy Level 0 repo, `files` overriding (null deletes) before the commit. */
function level0(files = {}, config = null) {
  const repo = scratchRepo(TMP, `r${(n += 1)}`);
  const all = { ...LEVEL0_FILES, ...files };
  if (config) all['cookwright.json'] = JSON.stringify({ version: 1, ...config });
  for (const [rel, body] of Object.entries(all)) if (body === null) delete all[rel];
  commit(repo, all, 'level 0');
  return repo.root;
}

/** The checks as `{ name: { status, note } }`. */
function doctor(root, { cwd = root, home = TMP, probes: p = probes() } = {}) {
  return Object.fromEntries(runChecks(openDoctorRepo(cwd, p, { home }), p));
}

const write = (root, rel, body) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
};

describe('a Level 0 repo', () => {
  it('passes every check', () => {
    const rows = doctor(level0());
    for (const [name, r] of Object.entries(rows)) expect([name, r.status]).toEqual([name, 'PASS']);
    expect(rows.config.note).toBe(m.config.ok(0));
    expect(rows.git.note).toBe(m.git.ok('main'));
    expect(rows['host.rules'].note).toBe(m.hostRules.native('2.1.281'));
    expect(rows['secrets.env'].note).toBe(m.secrets.ok);
  });
});

describe('config', () => {
  it('names an unknown host verbatim and SKIPs what needs the config', () => {
    const root = level0({}, { hosts: ['codex'] });
    const rows = doctor(root);
    expect(rows.config.status).toBe('FAIL');
    expect(rows.config.note).toBe(
      'cookwright.json: hosts: host "codex" is not available in this version of cookwright (known: claude)',
    );
    const needConfig = ['homes.backlog', 'homes.closeouts', 'homes.changelog', 'backlog.ids'];
    for (const name of [...needConfig, 'rules.block', 'host.rules', 'host.hook']) {
      expect(rows[name]).toEqual({ status: 'SKIP', note: m.configInvalid });
    }
    expect(rows.git).toEqual({ status: 'PASS', note: m.git.configInvalid });
    expect(rows['rules.size'].status).toBe('PASS');
    expect(rows['secrets.env'].status).toBe('PASS');
  });

  it('joins several loader problems on one line', () => {
    const root = level0();
    write(root, 'cookwright.json', JSON.stringify({ version: 2, level: 3 }));
    const { note } = doctor(root).config;
    expect(note).toMatch(/^cookwright\.json: version must be 1; level must be one of 0/);
    expect(note).not.toMatch(/\n/);
  });
});

describe('git', () => {
  it('PASSes an unborn HEAD named baseBranch, noting no commits yet', () => {
    const root = gitInit(path.join(TMP, 'unborn'));
    write(root, 'cookwright.json', JSON.stringify({ version: 1 }));
    expect(doctor(root).git).toEqual({ status: 'PASS', note: m.git.unborn('main') });
  });

  it('WARNs when baseBranch does not exist', () => {
    const root = level0({}, { baseBranch: 'trunk' });
    expect(doctor(root).git).toEqual({ status: 'WARN', note: m.git.noBase('trunk') });
  });

  it('FAILs outside a work tree, and SKIPs the git checks with git absent', () => {
    const root = path.join(TMP, 'plain');
    write(root, 'cookwright.json', JSON.stringify({ version: 1 }));
    const rows = doctor(root);
    expect(rows.git).toEqual({ status: 'FAIL', note: m.git.notWorkTree });
    expect(rows['secrets.env']).toEqual({ status: 'SKIP', note: m.secrets.notWorkTree });
    const noGit = doctor(level0(), { probes: probes({ hasTool: (t) => t !== 'git' }) });
    expect(noGit.git).toEqual({ status: 'SKIP', note: 'skipped, needs git, run setup' });
    expect(noGit['secrets.env']).toEqual({ status: 'SKIP', note: 'skipped, needs git, run setup' });
    expect(noGit['homes.backlog'].status).toBe('PASS');
  });
});

describe('homes and backlog ids', () => {
  it('FAILs a missing home, WARNs missing headings', () => {
    const rows = doctor(level0({ 'docs/backlog.md': null, 'docs/closeouts/.gitkeep': null, 'CHANGELOG.md': null }));
    expect(rows['homes.backlog']).toEqual({ status: 'FAIL', note: m.homes.missing('docs/backlog.md') });
    expect(rows['homes.closeouts']).toEqual({ status: 'FAIL', note: m.homes.missing('docs/closeouts/') });
    expect(rows['homes.changelog']).toEqual({ status: 'FAIL', note: m.homes.missing('CHANGELOG.md') });
    expect(rows['backlog.ids']).toEqual({ status: 'SKIP', note: m.ids.noBacklog });
    const partial = doctor(level0({ 'docs/backlog.md': '# Backlog\n\n## Open bugs\n' }));
    expect(partial['homes.backlog']).toEqual({
      status: 'WARN',
      note: 'docs/backlog.md lacks "## Open enhancements", "## Closed"',
    });
  });

  it('counts item ids only: a prose cross-reference is no duplicate', () => {
    const backlog = `${BACKLOG}- **E-001** first\n- **B-002** a bug\n- **E-006** Folded into E-001.\n`;
    expect(doctor(level0({ 'docs/backlog.md': backlog }))['backlog.ids']).toEqual({
      status: 'PASS',
      note: m.ids.ok(3),
    });
    const dup = `${backlog}- **B-002** again\n  - **E-001** nested again\n`;
    expect(doctor(level0({ 'docs/backlog.md': dup }))['backlog.ids']).toEqual({
      status: 'WARN',
      note: 'duplicate id(s): B-002, E-001',
    });
  });
});

describe('rules', () => {
  const block = renderBlock(DEFAULTS);
  const state = (agents) => doctor(level0({ 'AGENTS.md': agents }))['rules.block'];

  it('PASSes a current block; FAILs no file, no block, stale, malformed; WARNs newer', () => {
    expect(state(`${block}\n`)).toEqual({ status: 'PASS', note: m.block.current('AGENTS.md') });
    expect(state(null)).toEqual({ status: 'FAIL', note: m.block.noFile('AGENTS.md') });
    expect(state('# mine\n')).toEqual({ status: 'FAIL', note: m.block.absent('AGENTS.md') });
    expect(state(block.replace('managed', 'edited'))).toEqual({
      status: 'FAIL',
      note: m.block.stale('AGENTS.md'),
    });
    expect(state(block.replace('<!-- cookwright:end -->', ''))).toEqual({
      status: 'FAIL',
      note: m.block.malformed('AGENTS.md', 'noEnd'),
    });
    expect(state(block.replace('rules v1', 'rules v9'))).toEqual({
      status: 'WARN',
      note: m.block.newer('AGENTS.md', 9),
    });
  });

  it('renders the block with the repo’s own paths', () => {
    const paths = { backlog: 'notes/backlog.md' };
    const agents = `${renderBlock({ ...DEFAULTS, paths: { ...DEFAULTS.paths, ...paths } })}\n`;
    const root = level0({ 'AGENTS.md': agents, 'notes/backlog.md': BACKLOG }, { paths });
    expect(doctor(root)['rules.block'].status).toBe('PASS');
    expect(doctor(level0({}, { paths }))['rules.block'].status).toBe('FAIL');
  });

  it('WARNs an oversized line or file, naming it', () => {
    const rows = doctor(level0({ 'CLAUDE.md': `@AGENTS.md\n${'x'.repeat(3001)}\n` }));
    expect(rows['rules.size']).toEqual({ status: 'WARN', note: m.size.longLine('CLAUDE.md', 2, 3001) });
    const big = `${block}\n${'word '.repeat(13_000)}\n`.replace(/(.{100})/g, '$1\n');
    const bigRows = doctor(level0({ 'AGENTS.md': big }));
    const kb = Math.ceil(Buffer.byteLength(big) / 1024);
    expect(kb).toBeGreaterThan(60);
    expect(bigRows['rules.size']).toEqual({ status: 'WARN', note: m.size.big('AGENTS.md', kb) });
  });
});

describe('host.rules', () => {
  const rules = (root, opts = {}) => doctor(root, opts)['host.rules'];
  const version = (v) => ({ probes: probes({ claudeVersion: () => v }) });

  it('PASSes a root CLAUDE.md that is a link to AGENTS.md', () => {
    const root = level0();
    fs.symlinkSync('AGENTS.md', path.join(root, 'CLAUDE.md'));
    expect(rules(root, version(null))).toEqual({ status: 'PASS', note: m.hostRules.linked });
  });

  it('reads the version only when nothing shadows AGENTS.md', () => {
    const root = level0();
    expect(rules(root, version('2.1.281'))).toEqual({ status: 'PASS', note: m.hostRules.native('2.1.281') });
    expect(rules(root, version('2.1.280'))).toEqual({
      status: 'FAIL',
      note: m.hostRules.old('2.1.280', '2.1.281'),
    });
    expect(rules(root, version(null))).toEqual({
      status: 'SKIP',
      note: 'skipped, needs claude, run setup (AGENTS.md support unverified)',
    });
    const imported = level0({ 'CLAUDE.md': '# Claude\n\n@AGENTS.md\n' });
    const never = probes({ claudeVersion: () => expect.unreachable('no version probe') });
    expect(rules(imported, { probes: never })).toEqual({
      status: 'PASS',
      note: m.hostRules.imports('CLAUDE.md', '@AGENTS.md'),
    });
  });

  it('FAILs any shadowing file without the root import, wherever the scan finds it', () => {
    const fail = (files) => ({ status: 'FAIL', note: m.hostRules.shadowed(files, '@AGENTS.md') });
    expect(rules(level0({ '.claude/CLAUDE.md': '# x\n' }))).toEqual(fail(['.claude/CLAUDE.md']));
    expect(rules(level0({ 'CLAUDE.local.md': '# x\n' }))).toEqual(fail(['CLAUDE.local.md']));
    expect(rules(level0({ 'CLAUDE.md': 'use `@AGENTS.md` here\n' }))).toEqual(fail(['CLAUDE.md']));
    const nested = level0({ 'app/CLAUDE.md': '# app\n', 'app/x.txt': 'x' });
    expect(rules(nested, { cwd: path.join(nested, 'app') })).toEqual(fail(['app/CLAUDE.md']));
    expect(rules(nested).status).toBe('PASS'); // from the root, app/ is not on the scan
  });

  it('scans the root’s ancestors, but not the home directory’s .claude/', () => {
    const parent = path.join(TMP, 'ancestor');
    const root = gitInit(path.join(parent, 'repo'));
    commit({ root }, { 'cookwright.json': JSON.stringify({ version: 1 }), ...LEVEL0_FILES }, 'l0');
    write(parent, '.claude/CLAUDE.md', '# user memory\n');
    expect(rules(root, { home: parent }).status).toBe('PASS');
    expect(rules(root, { home: TMP })).toEqual({
      status: 'FAIL',
      note: m.hostRules.shadowed(['../.claude/CLAUDE.md'], '@AGENTS.md'),
    });
    write(parent, 'CLAUDE.md', '# above\n');
    expect(rules(root, { home: parent }).note).toBe(m.hostRules.shadowed(['../CLAUDE.md'], '@AGENTS.md'));
  });
});

describe('host.hook', () => {
  const hook = (files) => doctor(level0(files))['host.hook'];
  const none = { status: 'FAIL', note: m.hostHook.none('.claude/settings.json') };

  it('PASSes HOOK_COMMAND only, by equality', () => {
    expect(hook({})).toEqual({ status: 'PASS', note: m.hostHook.ok('.claude/settings.json') });
    expect(hook({ '.claude/settings.json': SETTINGS('echo "run cookwright doctor"') })).toEqual(none);
    expect(hook({ '.claude/settings.json': SETTINGS(`${HOOK_COMMAND} `) })).toEqual(none);
  });

  it('names the project file when the hook is only in settings.local.json', () => {
    const rows = hook({ '.claude/settings.json': null, '.claude/settings.local.json': SETTINGS() });
    expect(rows).toEqual(none);
    expect(rows.note).toMatch(/settings\.local\.json or the user settings is not what init wires/);
  });

  it('FAILs unparseable settings; WARNs an earlier version of the command', () => {
    expect(hook({ '.claude/settings.json': '{ nope' })).toMatchObject({
      status: 'FAIL',
      note: expect.stringMatching(/^\.claude\/settings\.json is not valid JSON \(/),
    });
    const root = level0({ '.claude/settings.json': SETTINGS('old doctor hook') });
    const repo = openDoctorRepo(root, probes(), { home: TMP });
    const entry = { ...HOSTS.claude, hookCommandsPast: ['old doctor hook'] };
    expect(checkClaudeHook(repo, probes(), entry)).toEqual({
      status: 'WARN',
      note: m.hostHook.past('.claude/settings.json'),
    });
  });
});

describe('secrets.env', () => {
  const secrets = (root) => doctor(root)['secrets.env'];
  const track = stageOnly; // an index entry, never an env file on disk

  it('PASSes example files and .envrc; FAILs a tracked env file at any depth, named', () => {
    const root = level0();
    track(root, '.env.example');
    track(root, '.envrc');
    track(root, 'apps/mobile/.env.sample');
    expect(secrets(root)).toEqual({ status: 'PASS', note: m.secrets.ok });
    track(root, 'apps/mobile/.env');
    expect(secrets(root)).toEqual({ status: 'FAIL', note: m.secrets.tracked(['apps/mobile/.env']) });
    track(root, '.env');
    expect(secrets(root).note).toMatch(/^tracked env file\(s\): \.env, apps\/mobile\/\.env;/);
  });

  it('WARNs an untracked env file at the root and a protected path git does not ignore', () => {
    const root = level0();
    const atRoot = probes({ rootFiles: () => ['README.md', '.env.local'] });
    expect(doctor(root, { probes: atRoot })['secrets.env']).toEqual({
      status: 'WARN',
      note: m.secrets.untracked(['.env.local']),
    });
    const onlyEnv = level0({ '.gitignore': '.env\n' });
    expect(secrets(onlyEnv)).toEqual({ status: 'WARN', note: m.secrets.notIgnored(['.env.local']) });
    expect(secrets(level0({ '.gitignore': '.env*\n' })).status).toBe('PASS');
  });

  it('reads a git error from the probe as a FAIL naming it, never a crash', () => {
    const throwing = probes({
      ignored: () => {
        throw new Error('git check-ignore .env failed: boom');
      },
    });
    expect(doctor(level0(), { probes: throwing })['secrets.env']).toEqual({
      status: 'FAIL',
      note: m.checkThrew('git check-ignore .env failed: boom'),
    });
  });

  it('reads a probe that outlasts the budget as unverified, never a FAIL', () => {
    const slow = probes({
      ignored: () => {
        throw new TimedOut('git check-ignore');
      },
    });
    expect(doctor(level0(), { probes: slow })['secrets.env']).toEqual({
      status: 'SKIP',
      note: m.checkTimedOut(messages.timedOut('git check-ignore')),
    });
  });
});

describe('the readout', () => {
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
  const doc = (root, argv = [], over = {}) => main(argv, { cwd: root, home: TMP, probes: probes(over) });

  it('prints every check, the counts, the level line and the next level', () => {
    expect(doc(level0())).toBe(0);
    expect(out).toHaveLength(15);
    expect(out[0]).toBe(`PASS  config           ${m.config.ok(0)}`);
    expect(out.slice(-3)).toEqual([
      '11 checks — 11 PASS, 0 FAIL, 0 WARN, 0 SKIP',
      'level 0 declared: complete',
      'next: Level 1 is not available in this version of cookwright',
    ]);
  });

  it('reads a FAIL among the requirements as drift, and exits 1', () => {
    expect(doc(level0({ 'AGENTS.md': null, 'CHANGELOG.md': null }))).toBe(1);
    expect(out).toContain('level 0 declared: drift, 2 piece(s) missing: homes.changelog, rules.block');
  });

  it('names what is weak or unverified, and still reads complete', () => {
    expect(doc(level0({}, { baseBranch: 'trunk' }), [], { claudeVersion: () => null })).toBe(0);
    expect(out).toContain('level 0 declared: complete; weak: git; unverified: host.rules');
    expect(out).toContain('11 checks — 9 PASS, 0 FAIL, 1 WARN, 1 SKIP');
  });

  it('a WARN outside the requirements is neither drift nor weak', () => {
    expect(doc(level0({ '.gitignore': '.env\n' }))).toBe(0);
    expect(out).toContain('level 0 declared: complete');
  });

  it('reads an invalid config as level unknown, and exits 1', () => {
    expect(doc(level0({}, { hosts: ['codex'] }))).toBe(1);
    expect(out.at(-1)).toBe('level unknown: config invalid');
    expect(out.join('\n')).not.toMatch(/^FAIL {2}host\./m);
  });

  it('refuses no config, an unknown flag and a positional with exit 2', () => {
    const bare = gitInit(path.join(TMP, 'bare'));
    expect(doc(bare)).toBe(2);
    expect(err.at(-1)).toBe(`doctor: ${m.noConfig(bare)}`);
    expect(err.at(-1)).toMatch(/run npx cookwright init$/);
    expect(doc(level0(), ['--verbose'])).toBe(2);
    expect(err.at(-1)).toBe('doctor: unknown flag --verbose (known: --hook)');
    expect(doc(level0(), ['now'])).toBe(2);
    expect(doc(level0(), ['--hook', 'now'])).toBe(0);
    expect(err.at(-1)).toBe(`doctor: ${m.usage}`);
    expect(out).toEqual([m.hookLine(m.usage)]);
    expect(out).toHaveLength(1);
  });
});

describe('--hook', () => {
  const out = [];
  let spy;
  beforeAll(() => {
    spy = vi.spyOn(console, 'log').mockImplementation((...a) => out.push(a.join(' ')));
  });
  afterAll(() => spy.mockRestore());
  afterEach(() => {
    out.length = 0;
  });
  const hook = (root, over = {}) => main(['--hook'], { cwd: root, home: TMP, probes: probes(over) });

  it('prints exactly one line when everything passes', () => {
    expect(hook(level0())).toBe(0);
    expect(out).toEqual(['cookwright doctor: level 0 complete']);
  });

  it('prints only what is not PASS, the counts and the level line, and exits 0 on a FAIL', () => {
    expect(hook(level0({ '.claude/settings.json': null }))).toBe(0);
    expect(out).toEqual([
      `FAIL  host.hook  ${m.hostHook.none('.claude/settings.json')}`,
      'cookwright doctor: 11 checks — 10 PASS, 1 FAIL, 0 WARN, 0 SKIP',
      'level 0 declared: drift, 1 piece(s) missing: host.hook',
    ]);
  });

  it('exits 0 on a thrown probe, printing one line', () => {
    const root = level0();
    expect(hook(root, { hasTool: () => { throw new Error('PATH unreadable\nmore'); } })).toBe(0);
    expect(out).toEqual(['cookwright doctor crashed: PATH unreadable']);
  });

  it('exits 0 with no cookwright.json, naming init', () => {
    const bare = gitInit(path.join(TMP, 'bare-hook'));
    expect(hook(bare)).toBe(0);
    expect(out).toEqual([m.hookLine(m.noConfig(bare))]);
  });

  it('runs through the dispatcher, from a subdirectory', async () => {
    const root = level0({ 'src/x.txt': 'x' });
    expect(await dispatch(['doctor', '--hook'], { cwd: path.join(root, 'src'), home: TMP, probes: probes() })).toBe(0);
    expect(out).toEqual(['cookwright doctor: level 0 complete']);
  });
});

describe('a stalled git', () => {
  const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '../bin/cookwright.mjs');

  it('times out inside the two-second budget and the hook still prints one line', () => {
    const root = level0();
    const shims = path.join(TMP, 'stalled-git-bin');
    fs.mkdirSync(shims, { recursive: true });
    fs.writeFileSync(path.join(shims, 'git'), '#!/bin/sh\nexec /bin/sleep 30\n', { mode: 0o755 });
    const PATH = [shims, path.dirname(process.execPath)].join(path.delimiter);
    const started = Date.now();
    const r = spawnSync(process.execPath, [BIN, 'doctor', '--hook'], {
      cwd: root,
      env: { ...process.env, PATH },
      encoding: 'utf8',
      timeout: 10_000,
    });
    const elapsed = Date.now() - started;
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split('\n')).toEqual([m.hookLine(messages.timedOut('git rev-parse'))]);
    expect(elapsed).toBeLessThan(BUDGET_MS + 1500); // the budget plus node's own startup
  });
});
