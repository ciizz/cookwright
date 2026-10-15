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
import { messages as bundleMessages } from './lib/bundle/messages.mjs';
import { TEMPLATE as CHANGELOG } from './lib/changelog/render.mjs';
import { DEFAULTS } from './lib/config.mjs';
import { checkClaudeHook } from './lib/doctor/claude.mjs';
import { openDoctorRepo } from './lib/doctor/repo.mjs';
import { runChecks } from './lib/doctor/registry.mjs';
import { shimText } from './lib/hooks/shims.mjs';
import { HOOK_COMMAND, HOSTS } from './lib/hosts.mjs';
import { messages } from './lib/messages.mjs';
import { PROBES } from './lib/probes.mjs';
import { RULES_VERSION, beginMarker, renderBlock } from './lib/rules/block.mjs';
import { commit, gitInit, gitWithoutScopes, run, scratchRepo, scratchRoot, stageOnly, v1Block } from './test-helpers.mjs';

const TMP = scratchRoot('cookwright-doctor-');
const m = messages.doctor;

const BACKLOG = '# Backlog\n\n## Open bugs\n\n## Open enhancements\n\n## Closed\n';
const SETTINGS = (command = HOOK_COMMAND) =>
  `${JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command }] }] } }, null, 2)}\n`;

/** Every file of a Level 0 repo on the default paths, committed on `main`. */
const LEVEL0_FILES = {
  'docs/backlog.md': BACKLOG,
  'docs/closeouts/.gitkeep': '',
  'CHANGELOG.md': CHANGELOG,
  'AGENTS.md': `# Rules\n\n${renderBlock(DEFAULTS)}\n`,
  '.claude/settings.json': SETTINGS(),
  '.gitignore': '.env\n.env.*\n!.env.example\n',
  '.githooks/pre-commit': shimText('pre-commit'),
  '.githooks/pre-push': shimText('pre-push'),
};

/** gitleaks on PATH, its dry run exiting `status`, its version 8.30.1. */
const gitleaks = (status = 0, over = {}) => ({
  hasTool: (bin) => bin === 'gitleaks' || PROBES.hasTool(bin),
  scanStaged: () => ({ status, timedOut: false, stderr: '' }),
  gitleaksVersion: () => '8.30.1',
  ...over,
});

/** Probes for a machine with git, gitleaks and Claude Code 2.1.281; override any of them. */
const probes = (over = {}) => ({ ...PROBES, ...gitleaks(), claudeVersion: () => '2.1.281', ...over });

/** Write `files` (null skips), the .githooks ones executable. */
function writeAll(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    if (body === null) continue;
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body, { mode: rel.startsWith('.githooks/') ? 0o755 : 0o644 });
  }
}

/** The package's bin at `dir`, as npm installs it there: untracked, git told to ignore it. */
function installPackage(dir) {
  writeAll(dir, { 'node_modules/cookwright/bin/cookwright.mjs': '' });
  const exclude = run(dir, 'git', ['rev-parse', '--git-path', 'info/exclude']);
  fs.mkdirSync(path.dirname(path.resolve(dir, exclude)), { recursive: true });
  fs.appendFileSync(path.resolve(dir, exclude), 'node_modules\n');
}

let n = 0;
/**
 * A healthy Level 0 repo, `files` overriding (null deletes) before the commit, with
 * core.hooksPath set locally to `hooksPath` (null: unset) and the package installed.
 */
function level0(files = {}, config = null, { hooksPath = '.githooks' } = {}) {
  const repo = scratchRepo(TMP, `r${(n += 1)}`);
  const all = { ...LEVEL0_FILES, ...files };
  if (config) all['cookwright.json'] = JSON.stringify({ version: 1, ...config });
  writeAll(repo.root, all);
  commit(repo, {}, 'level 0');
  installPackage(repo.root);
  if (hooksPath) run(repo.root, 'git', ['config', '--local', 'core.hooksPath', hooksPath]);
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
    const needConfig = ['homes.backlog', 'homes.closeouts', 'homes.changelog', 'backlog.ids', 'gate.scripts'];
    for (const name of [...needConfig, 'rules.block', 'host.rules', 'host.hook']) {
      expect(rows[name]).toEqual({ status: 'SKIP', note: m.configInvalid });
    }
    expect(rows.git).toEqual({ status: 'PASS', note: m.git.configInvalid });
    expect(rows['rules.size'].status).toBe('PASS');
    expect(rows['secrets.env'].status).toBe('PASS');
    for (const name of ['hooks.path', 'hooks.pre-commit', 'hooks.pre-push', 'tools.gitleaks']) {
      expect([name, rows[name].status]).toEqual([name, 'PASS']); // none needs the config
    }
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
    expect(state(block.replace(beginMarker(), beginMarker(RULES_VERSION + 7)))).toEqual({
      status: 'WARN',
      note: m.block.newer('AGENTS.md', RULES_VERSION + 7),
    });
  });

  it('FAILs a v1 block as stale', () => {
    expect(state(`# Rules\n\n${v1Block(block)}\n`)).toEqual({ status: 'FAIL', note: m.block.stale('AGENTS.md') });
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

describe('homes.changelog', () => {
  it('PASSes the generated file, WARNs one without the marker', () => {
    expect(doctor(level0())['homes.changelog']).toEqual({ status: 'PASS', note: m.homes.fileOk('CHANGELOG.md') });
    expect(doctor(level0({ 'CHANGELOG.md': '# Changelog\n\n## Unreleased\n' }))['homes.changelog']).toEqual({
      status: 'WARN',
      note: m.homes.unmarked('CHANGELOG.md'),
    });
  });
});

describe('git hooks', () => {
  const HOOKS = ['hooks.path', 'hooks.pre-commit', 'hooks.pre-push'];
  const f = messages.foreignHooks;
  const hooks = (root, opts) => {
    const rows = doctor(root, opts);
    return HOOKS.map((name) => rows[name]);
  };
  const ok = [
    { status: 'PASS', note: m.hooks.pathOk('.githooks') },
    { status: 'PASS', note: m.hooks.shim('.githooks/pre-commit') },
    { status: 'PASS', note: m.hooks.shim('.githooks/pre-push') },
  ];
  const elsewhere = (note) => [{ status: 'WARN', note }, ...[1, 2].map(() => ({ status: 'SKIP', note: m.hooks.elsewhere }))];

  it('PASSes the shims with core.hooksPath .githooks from the local scope', () => {
    expect(hooks(level0())).toEqual(ok);
  });

  it('FAILs core.hooksPath unset with nothing foreign, a missing shim, a shim not executable', () => {
    expect(hooks(level0({}, null, { hooksPath: null }))[0]).toEqual({ status: 'FAIL', note: m.hooks.pathUnset });
    expect(hooks(level0({ '.githooks/pre-push': null }))[2]).toEqual({
      status: 'FAIL',
      note: m.hooks.missing('.githooks/pre-push'),
    });
    const root = level0();
    fs.mkdirSync(path.join(root, '.githooks/pre-push.d'));
    fs.rmSync(path.join(root, '.githooks/pre-push'));
    fs.symlinkSync('nowhere', path.join(root, '.githooks/pre-push'));
    expect(hooks(root)[2]).toEqual({ status: 'FAIL', note: m.hooks.notAFile('.githooks/pre-push') });
  });

  it.skipIf(process.platform === 'win32')('FAILs a shim that is not executable', () => {
    const root = level0();
    fs.chmodSync(path.join(root, '.githooks/pre-commit'), 0o644);
    expect(hooks(root)[1]).toEqual({ status: 'FAIL', note: m.hooks.notExecutable('.githooks/pre-commit') });
  });

  it('WARNs a hook whose package is not installed where it runs: it would print not-installed and check nothing', () => {
    const root = level0();
    fs.rmSync(path.join(root, 'node_modules'), { recursive: true });
    expect(hooks(root).slice(1)).toEqual([
      { status: 'WARN', note: m.hooks.notInstalled('.githooks/pre-commit') },
      { status: 'WARN', note: m.hooks.notInstalled('.githooks/pre-push') },
    ]);
  });

  it('PASSes a user’s own hook that calls cookwright', () => {
    const body = '#!/bin/sh\necho mine\nexec node node_modules/cookwright/bin/cookwright.mjs hook pre-commit "$@"\n';
    expect(hooks(level0({ '.githooks/pre-commit': body }))[1]).toEqual({
      status: 'PASS',
      note: m.hooks.calls('.githooks/pre-commit'),
    });
  });

  it('WARNs a foreign setup and SKIPs the two files: local elsewhere, global, user hooks, a .githooks file of theirs', () => {
    expect(hooks(level0({}, null, { hooksPath: '.husky/_' }))).toEqual(elsewhere(f.path('.husky/_', 'local')));
    const global = path.join(TMP, 'global-hooks-config');
    fs.writeFileSync(global, '[core]\n\thooksPath = .githooks\n');
    const unsetLocally = level0({}, null, { hooksPath: null });
    vi.stubEnv('GIT_CONFIG_GLOBAL', global);
    try {
      expect(hooks(unsetLocally)).toEqual(elsewhere(f.path('.githooks', 'global')));
    } finally {
      vi.unstubAllEnvs();
    }
    const userHooks = level0({}, null, { hooksPath: null });
    writeAll(userHooks, { '.git/hooks/pre-commit': '#!/bin/sh\n', '.git/hooks/pre-push.sample': '' });
    expect(hooks(userHooks)).toEqual(elsewhere(f.dir('.git/hooks', ['pre-commit'])));
    const theirs = level0({ '.githooks/pre-commit': '#!/bin/sh\nnpm run lint\n' });
    expect(hooks(theirs)).toEqual(elsewhere(f.file('.githooks/pre-commit')));
  });

  it('reads the path on a git without --show-scope (before 2.26): local PASS, elsewhere WARN, never a probe error', () => {
    vi.stubEnv('PATH', `${gitWithoutScopes(TMP)}${path.delimiter}${process.env.PATH}`);
    const global = path.join(TMP, 'global-hooks-config-old-git');
    fs.writeFileSync(global, '[core]\n\thooksPath = .githooks\n');
    try {
      expect(hooks(level0())).toEqual(ok);
      expect(hooks(level0({}, null, { hooksPath: '.husky/_' }))).toEqual(elsewhere(f.path('.husky/_', 'local')));
      expect(hooks(level0({}, null, { hooksPath: null }))[0]).toEqual({ status: 'FAIL', note: m.hooks.pathUnset });
      vi.stubEnv('GIT_CONFIG_GLOBAL', global);
      expect(hooks(level0({}, null, { hooksPath: null }))).toEqual(elsewhere(f.path('.githooks', f.notLocal)));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('reads the shims at the work tree top when cookwright.json is below it', () => {
    const top = gitInit(path.join(TMP, `nested-top-${(n += 1)}`));
    const app = path.join(top, 'apps/mobile');
    const { '.githooks/pre-commit': a, '.githooks/pre-push': b, ...rest } = LEVEL0_FILES;
    const config = JSON.stringify({ version: 1 });
    writeAll(app, { ...rest, 'cookwright.json': config, '.githooks/pre-commit': a, '.githooks/pre-push': b }); // B-007's place
    commit({ root: top }, {}, 'level 0 in apps/mobile');
    installPackage(app);
    run(top, 'git', ['config', '--local', 'core.hooksPath', '.githooks']);
    expect(hooks(app).slice(1)).toEqual([
      { status: 'FAIL', note: m.hooks.missing('../../.githooks/pre-commit') },
      { status: 'FAIL', note: m.hooks.missing('../../.githooks/pre-push') },
    ]);
    writeAll(top, {
      '.githooks/pre-commit': shimText('pre-commit', 'apps/mobile'),
      '.githooks/pre-push': shimText('pre-push', 'apps/mobile'),
    });
    expect(hooks(app)).toEqual([
      ok[0],
      { status: 'PASS', note: m.hooks.shim('../../.githooks/pre-commit') },
      { status: 'PASS', note: m.hooks.shim('../../.githooks/pre-push') },
    ]);
  });

  it('never shows a machine path: an absolute core.hooksPath, or a sibling worktree’s hooks directory', () => {
    const abs = hooks(level0({}, null, { hooksPath: path.join(TMP, 'elsewhere') }));
    expect(abs).toEqual(elsewhere(f.path(f.absolutePath, 'local')));
    const repo = scratchRepo(TMP, `wt-userhooks-${(n += 1)}`);
    commit(repo, { 'README.md': 'x' }, 'init');
    writeAll(repo.root, { '.git/hooks/pre-commit': '#!/bin/sh\n' });
    const sibling = path.join(TMP, `wt-userhooks-sibling-${n}`);
    run(repo.root, 'git', ['worktree', 'add', '-q', '-b', 'side', sibling]);
    const [pathRow] = hooks(sibling);
    expect(pathRow).toEqual({ status: 'WARN', note: f.dir(f.gitHooksDir, ['pre-commit']) });
    expect(JSON.stringify(abs)).not.toContain(TMP);
  });

  it('reads a linked worktree whose branch lacks .githooks/ as the path PASS and the files missing', () => {
    const repo = scratchRepo(TMP, `wt-main-${(n += 1)}`);
    const { '.githooks/pre-commit': a, '.githooks/pre-push': b, ...rest } = LEVEL0_FILES;
    writeAll(repo.root, rest);
    const base = commit(repo, {}, 'level 0 without the hooks');
    writeAll(repo.root, { '.githooks/pre-commit': a, '.githooks/pre-push': b });
    commit(repo, {}, 'the hooks');
    installPackage(repo.root);
    run(repo.root, 'git', ['config', '--local', 'core.hooksPath', '.githooks']);
    expect(hooks(repo.root)).toEqual(ok);
    const sibling = path.join(TMP, `wt-sibling-${n}`);
    run(repo.root, 'git', ['worktree', 'add', '-q', '-b', 'side', sibling, base]);
    const rows = doctor(sibling);
    expect(HOOKS.map((name) => rows[name])).toEqual([
      ok[0],
      { status: 'FAIL', note: m.hooks.missing('.githooks/pre-commit') },
      { status: 'FAIL', note: m.hooks.missing('.githooks/pre-push') },
    ]);
    for (const [name, r] of Object.entries(rows)) expect([name, r.note]).not.toEqual([name, expect.stringMatching(/(^|\s)\//)]);
  });
});

describe('tools.gitleaks', () => {
  const tool = (over) => doctor(level0(), { probes: probes(over) })['tools.gitleaks'];

  it('PASSes on PATH when the dry run exits 0 or 3, naming the version', () => {
    const calls = [];
    const scanStaged = (root, opts) => {
      calls.push(opts);
      return { status: 3, timedOut: false, stderr: '' };
    };
    expect(tool({ scanStaged })).toEqual({ status: 'PASS', note: m.gitleaks.ok('8.30.1') });
    expect(calls).toEqual([{ quiet: true }]);
    expect(tool({ gitleaksVersion: () => null })).toEqual({ status: 'PASS', note: m.gitleaks.ok(null) });
  });

  it('runs the dry run at the work tree top when cookwright.json is below it', () => {
    const top = gitInit(path.join(TMP, `nested-gitleaks-${(n += 1)}`));
    const app = path.join(top, 'apps/mobile');
    writeAll(app, { 'cookwright.json': JSON.stringify({ version: 1 }) });
    const roots = [];
    const scanStaged = (root) => {
      roots.push(root);
      return { status: 0, timedOut: false, stderr: '' };
    };
    expect(doctor(app, { probes: probes({ scanStaged }) })['tools.gitleaks'].status).toBe('PASS');
    expect(roots).toEqual([fs.realpathSync(top)]);
  });

  it('FAILs any other exit, naming the first stderr line', () => {
    const scanStaged = () => ({ status: 1, timedOut: false, stderr: '\nerror: .gitleaks.toml: bad rule\nmore\n' });
    expect(tool({ scanStaged })).toEqual({
      status: 'FAIL',
      note: m.gitleaks.broken(1, 'error: .gitleaks.toml: bad rule'),
    });
    expect(m.gitleaks.broken(1, 'error: x')).toBe(
      'gitleaks does not run (exit 1): error: x; the pre-commit secret scan is skipped',
    );
  });

  it('SKIPs absent, and reads a timeout as unverified', () => {
    expect(tool({ hasTool: (bin) => bin !== 'gitleaks' })).toEqual({ status: 'SKIP', note: m.gitleaks.absent });
    const scanStaged = () => ({ status: null, timedOut: true, stderr: '' });
    expect(tool({ scanStaged })).toEqual({ status: 'SKIP', note: m.checkTimedOut(messages.timedOut('gitleaks')) });
  });
});

describe('gate.scripts', () => {
  const scripts = (files, checks) => doctor(level0(files, { gate: { checks } }))['gate.scripts'];
  const test = { name: 'test', run: 'npm test' };

  it('PASSes no checks, or every npm script defined', () => {
    expect(scripts({}, [])).toEqual({ status: 'PASS', note: m.gateScripts.none });
    const pkg = JSON.stringify({ scripts: { test: 'vitest run' } });
    expect(scripts({ 'package.json': pkg }, [test, { name: 'lint', run: 'eslint .' }])).toEqual({
      status: 'PASS',
      note: m.gateScripts.ok(2),
    });
  });

  it('FAILs with the gate’s own refusal text, verbatim', () => {
    expect(scripts({ 'package.json': '{}' }, [test])).toEqual({
      status: 'FAIL',
      note: bundleMessages.missingScript('test', 'test'),
    });
    expect(scripts({}, [test])).toEqual({ status: 'FAIL', note: bundleMessages.noPackageJson('test', 'test') });
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
    expect(out).toHaveLength(20);
    expect(out[0]).toBe(`PASS  ${'config'.padEnd('hooks.pre-commit'.length)}  ${m.config.ok(0)}`);
    expect(out.slice(-3)).toEqual([
      '16 checks — 16 PASS, 0 FAIL, 0 WARN, 0 SKIP',
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
    expect(out).toContain('16 checks — 14 PASS, 0 FAIL, 1 WARN, 1 SKIP');
  });

  it('reads gitleaks absent as unverified, and the level complete', () => {
    expect(doc(level0(), [], { hasTool: (bin) => bin !== 'gitleaks' })).toBe(0);
    expect(out).toContain('level 0 declared: complete; unverified: tools.gitleaks');
  });

  it('reads a foreign hooks setup as weak, its files unverified, and the level complete', () => {
    expect(doc(level0({}, null, { hooksPath: '.husky/_' }))).toBe(0);
    expect(out).toContain('level 0 declared: complete; weak: hooks.path; unverified: hooks.pre-commit, hooks.pre-push');
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
      'cookwright doctor: 16 checks — 15 PASS, 1 FAIL, 0 WARN, 0 SKIP',
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
