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
import { CONFIG_VERSION, DEFAULTS } from './lib/config.mjs';
import { checkClaudeHook } from './lib/doctor/claude.mjs';
import { checkCodexHook } from './lib/doctor/codex.mjs';
import { checkPointers, hostPointers, shippedPieces } from './lib/doctor/hosts.mjs';
import { openDoctorRepo } from './lib/doctor/repo.mjs';
import { CHECKS, runChecks } from './lib/doctor/registry.mjs';
import { levelLine } from './lib/doctor/report.mjs';
import { LEVELS } from './lib/levels.mjs';
import { shimText } from './lib/hooks/shims.mjs';
import { CODEX_HOOK_COMMAND, HOOK_COMMAND, HOSTS } from './lib/hosts.mjs';
import { messages } from './lib/messages.mjs';
import { PACKS, RATCHET_CHECK, packDefaults, packName } from './lib/packs/registry.mjs';
import { renderSection } from './lib/packs/section.mjs';
import { PROBES } from './lib/probes.mjs';
import { RULES_VERSION, beginMarker, renderBlock } from './lib/rules/block.mjs';
import { HEADER } from './lib/secret/backends/age.mjs';
import { commit, fakeEslintRepo, gitInit, gitWithoutScopes, run, scratchRepo, scratchRoot, stageOnly, v1Block, v2Block, v3Block } from './test-helpers.mjs';

const TMP = scratchRoot('cookwright-doctor-');
const m = messages.doctor;
/** The environment doctor reads: PATH alone, so a name this machine exports never reaches a row. */
const ENV = Object.freeze({ PATH: process.env.PATH });
/** The static rows: every repo's readout has them, a declared pack's rows come after. */
const N = Object.keys(CHECKS).length;
const WIDTH = Math.max(...Object.keys(CHECKS).map((k) => k.length));

const BACKLOG = '# Backlog\n\n## Open bugs\n\n## Open enhancements\n\n## Closed\n';
const SETTINGS = (command = HOOK_COMMAND) =>
  `${JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command }] }] } }, null, 2)}\n`;

/** The gate a Level 0 repo runs: one npm script, which its package.json defines. */
const GATE = { checks: [{ name: 'test', run: 'npm test' }] };

/** Every file of a Level 0 repo on the default paths, committed on `main`. */
const LEVEL0_FILES = {
  'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }),
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

/** Each pointer the package ships for `host`: its path from the top, its link text, and the target in the package. */
const pointersOf = (host) =>
  shippedPieces(host).map((piece) => {
    const p = hostPointers({ root: TMP }, host, { shipped: () => [piece] })[0];
    return { ...piece, rel: p.rel, text: p.target, inPackage: path.posix.relative('node_modules/cookwright', path.posix.join(path.posix.dirname(p.rel), p.target)) };
  });
const POINTERS = pointersOf('claude');
const CODEX_POINTERS = pointersOf('codex');

/**
 * The pointers at `root`, as init writes them: Claude Code's always, Codex's when
 * `hosts` names it; a path `files` names (a body or null) is left to `files`.
 */
function writePointers(root, files = {}, hosts = ['claude']) {
  const all = [...POINTERS, ...(hosts.includes('codex') ? CODEX_POINTERS : [])];
  for (const { rel, text } of all.filter((x) => !Object.hasOwn(files, x.rel))) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.symlinkSync(text, path.join(root, rel));
  }
}

/**
 * The package at `dir`, as npm installs it there: its package.json, its bin and every pointer target
 * (`skills/<name>/SKILL.md`, `hosts/claude/workflows/<name>.js`), untracked, git told
 * to ignore it.
 */
function installPackage(dir) {
  const targets = Object.fromEntries(
    POINTERS.map(({ inPackage }) => [`node_modules/cookwright/${inPackage}${inPackage.endsWith('.js') ? '' : '/SKILL.md'}`, '']),
  );
  writeAll(dir, { 'node_modules/cookwright/package.json': '{}', 'node_modules/cookwright/bin/cookwright.mjs': '', ...targets });
  const exclude = run(dir, 'git', ['rev-parse', '--git-path', 'info/exclude']);
  fs.mkdirSync(path.dirname(path.resolve(dir, exclude)), { recursive: true });
  fs.appendFileSync(path.resolve(dir, exclude), 'node_modules\n');
}

let n = 0;
/**
 * A healthy Level 0 repo, `files` overriding (null deletes; a pointer's path too)
 * before the commit, with the pointers committed, core.hooksPath set locally to
 * `hooksPath` (null: unset) and the package installed. Its config runs GATE, which
 * `config` (or a `cookwright.json` in `files`) replaces.
 */
function level0(files = {}, config = null, { hooksPath = '.githooks' } = {}) {
  const repo = scratchRepo(TMP, `r${(n += 1)}`);
  const all = { 'cookwright.json': JSON.stringify({ version: CONFIG_VERSION, gate: GATE, ...config }), ...LEVEL0_FILES, ...files };
  writeAll(repo.root, all);
  writePointers(repo.root, files, config?.hosts);
  commit(repo, {}, 'level 0');
  installPackage(repo.root);
  if (hooksPath) run(repo.root, 'git', ['config', '--local', 'core.hooksPath', hooksPath]);
  return repo.root;
}

/** The checks as `{ name: { status, note } }`. */
function doctor(root, { cwd = root, home = TMP, probes: p = probes(), env = ENV, platform } = {}) {
  return Object.fromEntries(runChecks(openDoctorRepo(cwd, p, { home, env, ...(platform && { platform }) }), p));
}

const write = (root, rel, body) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
};

describe('a Level 0 repo', () => {
  it('passes every static check, and has no pack row', () => {
    const rows = doctor(level0());
    expect(Object.keys(rows)).toEqual(Object.keys(CHECKS));
    for (const [name, r] of Object.entries(rows)) expect([name, r.status]).toEqual([name, 'PASS']);
    expect(rows.config.note).toBe(m.config.ok(0));
    expect(rows.git.note).toBe(m.git.ok('main'));
    expect(rows['host.rules'].note).toBe(m.hostRules.native('2.1.281'));
    expect(rows['secrets.env'].note).toBe(m.secrets.ok);
  });
});

describe('config', () => {
  it('names an unknown host verbatim and SKIPs what needs the config', () => {
    const root = level0({}, { hosts: ['gemini'] });
    const rows = doctor(root);
    expect(rows.config.status).toBe('FAIL');
    expect(rows.config.note).toBe(
      'cookwright.json: hosts: host "gemini" is not available in this version of cookwright (known: claude, codex)',
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

  it('WARNs a version-1 config migrated in memory, and runs every other check as on a current one', () => {
    const v1 = JSON.stringify({ version: 1, paths: { playbook: 'docs/playbook.md' }, gate: GATE });
    const rows = doctor(level0({ 'cookwright.json': v1 }));
    expect(rows.config).toEqual({ status: 'WARN', note: m.config.migrated(1, CONFIG_VERSION) });
    expect(m.config.migrated(1, 2)).toBe(
      'valid at version 2 after migrating from 1 in memory; run npx cookwright migrate to write it',
    );
    const current = doctor(level0());
    for (const name of Object.keys(current).filter((k) => k !== 'config')) {
      expect([name, rows[name]]).toEqual([name, current[name]]);
    }
  });

  it('joins several loader problems on one line', () => {
    const root = level0();
    write(root, 'cookwright.json', JSON.stringify({ version: 0, level: 3 }));
    const { note } = doctor(root).config;
    expect(note).toMatch(new RegExp(`^cookwright\\.json: version must be ${CONFIG_VERSION}; level must be one of 0`));
    expect(note).not.toMatch(/\n/);
  });
});

describe('git', () => {
  it('PASSes an unborn HEAD named baseBranch, noting no commits yet', () => {
    const root = gitInit(path.join(TMP, 'unborn'));
    write(root, 'cookwright.json', JSON.stringify({ version: CONFIG_VERSION }));
    expect(doctor(root).git).toEqual({ status: 'PASS', note: m.git.unborn('main') });
  });

  it('WARNs when baseBranch does not exist', () => {
    const root = level0({}, { baseBranch: 'trunk' });
    expect(doctor(root).git).toEqual({ status: 'WARN', note: m.git.noBase('trunk') });
  });

  it('FAILs outside a work tree, and SKIPs the git checks with git absent', () => {
    const root = path.join(TMP, 'plain');
    write(root, 'cookwright.json', JSON.stringify({ version: CONFIG_VERSION }));
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

  it.each([
    ['v1', v1Block],
    ['v2', v2Block],
    ['v3', v3Block],
  ])('FAILs a %s block as stale', (_, older) => {
    expect(state(`# Rules\n\n${older(block)}\n`)).toEqual({ status: 'FAIL', note: m.block.stale('AGENTS.md') });
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
    commit({ root }, { 'cookwright.json': JSON.stringify({ version: CONFIG_VERSION }), ...LEVEL0_FILES }, 'l0');
    write(parent, '.claude/CLAUDE.md', '# user memory\n');
    expect(rules(root, { home: parent }).status).toBe('PASS');
    expect(rules(root, { home: TMP, env: ENV })).toEqual({
      status: 'FAIL',
      note: m.hostRules.shadowed(['../.claude/CLAUDE.md'], '@AGENTS.md'),
    });
    write(parent, 'CLAUDE.md', '# above\n');
    expect(rules(root, { home: parent }).note).toBe(m.hostRules.shadowed(['../CLAUDE.md'], '@AGENTS.md'));
  });
});

describe('host.pointers', () => {
  const pm = m.pointers;
  // SKILL: a Level 2 skill (bundle); SETUP: the Level 0 one.
  const SKILL = POINTERS.find((x) => x.kind === 'skill' && x.level === 2);
  const SETUP = POINTERS.find((x) => x.name === 'setup');
  const SKILLS_SHIPPED = POINTERS.filter((x) => x.kind === 'skill');
  const skills = SKILLS_SHIPPED.length;
  const check = (root, io = {}, p = probes()) => checkPointers(openDoctorRepo(root, p, { home: TMP, env: ENV }), p, io);
  const link = (root, rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.symlinkSync(text, path.join(root, rel));
  };

  it('PASSes every pointer of ours that resolves, with the counts', () => {
    expect(doctor(level0())['host.pointers']).toEqual({
      status: 'PASS',
      note: pm.counts('claude', skills, POINTERS.length - skills),
    });
    expect(pm.counts('claude', 1, 2)).toBe('claude: 1 skill, 2 workflows');
  });

  it('FAILs a missing Level 0 pointer as drift, and WARNs a missing Level 2 one at level 0', () => {
    const root = level0({ [SETUP.rel]: null });
    expect(check(root)).toEqual({
      status: 'FAIL',
      note: pm.named('claude', pm.missing('.claude/skills/setup')),
    });
    expect(pm.missing('.claude/skills/setup')).toBe('.claude/skills/setup missing (run npx cookwright init)');
    const rows = runChecks(openDoctorRepo(root, probes(), { home: TMP, env: ENV }), probes());
    expect(levelLine(DEFAULTS, rows)).toBe('level 0 declared: drift, 1 piece(s) missing: host.pointers');

    const r = doctor(level0({ [SKILL.rel]: null }))['host.pointers'];
    expect(r).toEqual({ status: 'WARN', note: pm.named('claude', pm.notRequired(SKILL.name, 2, 0)) });
    expect(pm.notRequired('bundle', 2, 0)).toBe('bundle (Level 2) not required at level 0; run npx cookwright init to add it');
  });

  it('reads a Level 2 pointer missing as weak, the level complete', () => {
    const out = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a) => out.push(a.join(' ')));
    try {
      expect(main([], { cwd: level0({ [SKILL.rel]: null }), home: TMP, env: ENV, probes: probes() })).toBe(0);
    } finally {
      spy.mockRestore();
    }
    expect(out).toContain('level 0 declared: complete; weak: host.pointers');
  });

  it('WARNs a pointer of ours whose target is not installed', () => {
    const root = level0();
    fs.rmSync(path.join(root, 'node_modules/cookwright', SKILL.inPackage), { recursive: true });
    expect(doctor(root)['host.pointers']).toEqual({ status: 'WARN', note: pm.named('claude', pm.notInstalled(SKILL.rel)) });
    expect(pm.notInstalled('.claude/skills/x')).toBe('.claude/skills/x: not installed where it points (npm install)');
  });

  it('expects every skill the manifest lists, so a damaged install missing a SKILL.md never reads PASS', () => {
    const root = level0();
    fs.rmSync(path.join(root, 'node_modules/cookwright', SETUP.inPackage, 'SKILL.md'));
    expect(shippedPieces('claude', path.join(root, 'node_modules/cookwright')).map((x) => x.name)).toContain('setup');
    expect(doctor(root)['host.pointers']).toEqual({ status: 'WARN', note: pm.named('claude', pm.notInstalled(SETUP.rel)) });
  });

  it('WARNs an untracked pointer git ignores, naming git add -f; PASSes an untracked one it does not', () => {
    const ignoredRoot = level0({ ...Object.fromEntries(POINTERS.map(({ rel }) => [rel, null])), '.gitignore': `${LEVEL0_FILES['.gitignore']}.claude/skills/\n` });
    for (const { rel, text } of POINTERS) link(ignoredRoot, rel, text);
    expect(doctor(ignoredRoot)['host.pointers']).toEqual({
      status: 'WARN',
      note: SKILLS_SHIPPED.map(({ rel }) => pm.named('claude', pm.ignored(rel))).join('; '),
    });
    expect(pm.ignored('.claude/skills/x')).toBe('.claude/skills/x is ignored by git; git add -f .claude/skills/x to track it');
    const plain = level0(Object.fromEntries(POINTERS.map(({ rel }) => [rel, null])));
    for (const { rel, text } of POINTERS) link(plain, rel, text);
    expect(doctor(plain)['host.pointers'].status).toBe('PASS');
  });

  it('never asks git whether a pointer is ignored when git cannot answer', () => {
    const ignored = () => {
      throw new Error('spawnSync git ENOENT');
    };
    const noGit = probes({ hasTool: (t) => t !== 'git', ignored });
    expect(doctor(level0(), { probes: noGit })['host.pointers'].status).toBe('PASS');
    const outside = path.join(TMP, `outside${(n += 1)}`);
    write(outside, 'cookwright.json', JSON.stringify({ version: CONFIG_VERSION }));
    writeAll(outside, { 'node_modules/cookwright/package.json': '{}' });
    writePointers(outside);
    for (const { inPackage } of POINTERS) write(outside, `node_modules/cookwright/${inPackage}${inPackage.endsWith('.js') ? '' : '/SKILL.md'}`, '');
    expect(check(outside, {}, probes({ ignored })).status).toBe('PASS');
  });

  it('FAILs an earlier pointer, by its text', () => {
    const root = level0({ [SKILL.rel]: null });
    link(root, SKILL.rel, '../../old/place/bundle');
    expect(check(root, { past: ['../../old/place/bundle'] })).toEqual({ status: 'FAIL', note: pm.named('claude', pm.past(SKILL.rel)) });
    expect(check(root)).toEqual({ status: 'WARN', note: pm.named('claude', pm.theirsLink(SKILL.rel, SKILL.name)) });
  });

  it('WARNs the user’s own link, file or directory, and a linked parent, naming each', () => {
    const elsewhere = fs.mkdtempSync(path.join(TMP, 'own-'));
    const theirLink = level0({ [SKILL.rel]: null });
    link(theirLink, SKILL.rel, elsewhere);
    expect(doctor(theirLink)['host.pointers']).toEqual({ status: 'WARN', note: pm.named('claude', pm.theirsLink(SKILL.rel, SKILL.name)) });
    const theirDir = level0({ [SKILL.rel]: null, [`${SKILL.rel}/SKILL.md`]: 'mine' });
    expect(doctor(theirDir)['host.pointers']).toEqual({ status: 'WARN', note: pm.named('claude', pm.theirs(SKILL.rel, SKILL.name)) });
    const linkedParent = level0(Object.fromEntries(SKILLS_SHIPPED.map(({ rel }) => [rel, null])));
    fs.rmSync(path.join(linkedParent, '.claude/skills'), { recursive: true, force: true });
    link(linkedParent, '.claude/skills', elsewhere);
    expect(doctor(linkedParent)['host.pointers']).toEqual({
      status: 'WARN',
      note: SKILLS_SHIPPED.map(({ name }) => pm.named('claude', pm.linkedParent('.claude/skills', name))).join('; '),
    });
  });

  it('WARNs a missing pointer on Windows, whatever its level', () => {
    const root = level0({ [SETUP.rel]: null });
    expect(check(root, { platform: 'win32' })).toEqual({
      status: 'WARN',
      note: pm.named('claude', pm.windows('.claude/skills/setup')),
    });
  });

  it('WARNs a pointer of ours left dangling where the package is installed elsewhere, naming init', () => {
    const top = gitInit(path.join(TMP, `nested${(n += 1)}`));
    const app = path.join(top, 'apps/mobile');
    write(app, 'cookwright.json', JSON.stringify({ version: CONFIG_VERSION }));
    installPackage(top);
    for (const p of POINTERS) link(top, p.rel, `../../apps/mobile/${path.posix.relative('../..', p.text)}`);
    const r = check(app);
    expect(r.status).toBe('WARN');
    expect(r.note).toBe(POINTERS.map((p) => pm.named('claude', pm.misdirected(`../../${p.rel}`))).join('; '));
  });

  it('names what is not PASS worst first, every host joined', () => {
    const root = level0({ [SKILL.rel]: null, [SETUP.rel]: null });
    const r = check(root);
    expect(r.status).toBe('FAIL');
    expect(r.note).toBe(
      [pm.named('claude', pm.missing('.claude/skills/setup')), pm.named('claude', pm.notRequired(SKILL.name, 2, 0))].join('; '),
    );
    const two = level0({}, { hosts: ['claude', 'codex'] });
    const both = checkPointers(openDoctorRepo(two, probes(), { home: TMP, env: ENV }), probes());
    expect(both).toEqual({
      status: 'PASS',
      note: [pm.counts('claude', skills, POINTERS.length - skills), pm.counts('codex', CODEX_POINTERS.length, null)].join('; '),
    });
    expect(pm.counts('codex', 1, null)).toBe('codex: 1 skill');
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
    const repo = openDoctorRepo(root, probes(), { home: TMP, env: ENV });
    const entry = { ...HOSTS.claude, hookCommandsPast: ['old doctor hook'] };
    expect(checkClaudeHook(repo, probes(), entry)).toEqual({
      status: 'WARN',
      note: m.hostHook.past('.claude/settings.json'),
    });
  });
});

describe('codex: host.rules and host.hook', () => {
  const cm = m.codex;
  const FILE = '.codex/hooks.json';
  const HOOKS = (groups) => `${JSON.stringify({ hooks: { SessionStart: groups } }, null, 2)}\n`;
  const ours = (matcher = 'startup|resume') => ({
    ...(matcher === null ? {} : { matcher }),
    hooks: [{ type: 'command', command: CODEX_HOOK_COMMAND, timeout: 10 }],
  });
  /** A Level 0 repo for `hosts`, the Codex hooks file in place unless `files` says otherwise. */
  const repoFor = (hosts, files = {}) => level0({ [FILE]: HOOKS([ours()]), ...files }, { hosts });
  const codexOnly = (files) => repoFor(['codex'], files);

  it('passes every check on a Codex-only repo, and on a two-host one with each host named', () => {
    const rows = doctor(codexOnly());
    for (const [name, r] of Object.entries(rows)) expect([name, r.status]).toEqual([name, 'PASS']);
    expect(rows['host.rules'].note).toBe(cm.rules.native('AGENTS.override.md'));
    expect(rows['host.hook'].note).toBe(cm.hook.ok(FILE, '/hooks'));
    expect(cm.hook.ok(FILE, '/hooks')).toBe(
      '.codex/hooks.json carries the doctor hook, which Codex reads at startup (whether it is trusted is yours: restart Codex, then /hooks)',
    );
    const two = doctor(repoFor(['claude', 'codex']));
    for (const [name, r] of Object.entries(two)) expect([name, r.status]).toEqual([name, 'PASS']);
    expect(two['host.rules'].note).toBe(
      [m.byHost('claude', m.hostRules.native('2.1.281')), m.byHost('codex', cm.rules.native('AGENTS.override.md'))].join('; '),
    );
    expect(two['host.hook'].note).toBe(
      [m.byHost('claude', m.hostHook.ok('.claude/settings.json')), m.byHost('codex', cm.hook.ok(FILE, '/hooks'))].join('; '),
    );
  });

  it('WARNs an AGENTS.override.md on the path from the invocation directory, root-relative; FAILs no AGENTS.md', () => {
    const rules = (root, opts) => doctor(root, opts)['host.rules'];
    expect(rules(codexOnly({ 'AGENTS.override.md': '# mine\n' }))).toEqual({
      status: 'WARN',
      note: cm.rules.override(['AGENTS.override.md']),
    });
    const nested = codexOnly({ 'app/AGENTS.override.md': '# app\n' });
    expect(rules(nested, { cwd: path.join(nested, 'app') })).toEqual({ status: 'WARN', note: cm.rules.override(['app/AGENTS.override.md']) });
    expect(rules(nested).status).toBe('PASS'); // from the root, app/ is not on the path
    expect(rules(codexOnly({ 'AGENTS.md': null }))).toEqual({ status: 'FAIL', note: cm.rules.none('AGENTS.md') });
  });

  it('FAILs the hook absent or unparseable, WARNs it under another matcher or an earlier command', () => {
    const hook = (files) => doctor(codexOnly(files))['host.hook'];
    expect(hook({ [FILE]: null })).toEqual({ status: 'FAIL', note: cm.hook.none(FILE) });
    expect(hook({ [FILE]: HOOKS([{ hooks: [{ type: 'command', command: HOOK_COMMAND }] }]) })).toEqual({ status: 'FAIL', note: cm.hook.none(FILE) });
    expect(hook({ [FILE]: '{ nope' })).toMatchObject({ status: 'FAIL', note: expect.stringMatching(/^\.codex\/hooks\.json is not valid JSON \(/) });
    expect(hook({ [FILE]: HOOKS([ours('startup')]) })).toEqual({ status: 'WARN', note: cm.hook.matcher(FILE, 'startup', 'startup|resume') });
    expect(hook({ [FILE]: HOOKS([ours(null)]) })).toEqual({ status: 'WARN', note: cm.hook.matcher(FILE, undefined, 'startup|resume') });
    expect(hook({ [FILE]: HOOKS([ours(), ours('compact')]) })).toEqual({ status: 'WARN', note: cm.hook.stray(FILE, 'compact', 'startup|resume') });
    expect(cm.hook.stray(FILE, 'compact', 'startup|resume')).toBe(
      '.codex/hooks.json also has the doctor hook under matcher compact, beside startup|resume (run npx cookwright init)',
    );
    expect(cm.hook.matcher(FILE, undefined, 'startup|resume')).toBe(
      '.codex/hooks.json has the doctor hook under no matcher, not startup|resume (run npx cookwright init)',
    );
    const root = codexOnly({ [FILE]: HOOKS([{ matcher: 'startup|resume', hooks: [{ type: 'command', command: 'old' }] }]) });
    const entry = { ...HOSTS.codex, hookCommandsPast: ['old'] };
    expect(checkCodexHook(openDoctorRepo(root, probes(), { home: TMP, env: ENV }), probes(), entry)).toEqual({
      status: 'WARN',
      note: m.hostHook.past(FILE),
    });
  });

  it('WARNs the hook for a config root below the work tree’s top, whose readout the hook cannot reach', () => {
    const top = fs.mkdtempSync(path.join(TMP, 'codex-nested-'));
    const root = path.join(top, 'apps/mobile');
    writeAll(root, { [FILE]: HOOKS([ours()]) });
    expect(checkCodexHook({ root, top }, probes())).toEqual({ status: 'WARN', note: cm.hook.nested(FILE, 'apps/mobile') });
    expect(checkCodexHook({ root, top: root }, probes())).toEqual({ status: 'PASS', note: cm.hook.ok(FILE, '/hooks') });
  });

  it('names only the hosts not PASS, worst first, and reads the joined FAIL as drift', () => {
    const rows = doctor(repoFor(['claude', 'codex'], { [FILE]: HOOKS([ours('startup')]), '.claude/settings.json': null }));
    expect(rows['host.hook']).toEqual({
      status: 'FAIL',
      note: [m.byHost('claude', m.hostHook.none('.claude/settings.json')), m.byHost('codex', cm.hook.matcher(FILE, 'startup', 'startup|resume'))].join('; '),
    });
    const skipped = doctor(repoFor(['claude', 'codex']), { probes: probes({ claudeVersion: () => null }) });
    expect(skipped['host.rules']).toEqual({ status: 'SKIP', note: m.byHost('claude', m.hostRules.noClaude) });
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

describe('secrets.backend, secrets.targets and secrets.carriers (stage-5 plan §4.6)', () => {
  const sb = m.secretsBackend;
  const st = m.secretsTargets;
  const sc = m.secretsCarriers;
  const KEY = `age1${'q'.repeat(58)}`;
  const ARMORED = '-----BEGIN AGE ENCRYPTED FILE-----\nYWdl\n-----END AGE ENCRYPTED FILE-----\n';
  const NAMES = ['API_URL', 'API_TOKEN'];
  const proof = { kind: 'host', host: 'api.example.com', names: ['API_URL'] };
  const ageConfig = (targets = { dev: { names: NAMES, proof }, prod: { names: NAMES, proof } }) => ({
    secrets: { backend: 'age', targets },
  });
  const AGE_FILES = { 'secrets/recipients.txt': `${KEY}\n`, 'secrets/dev.env.age': ARMORED };
  /** A machine with age, age-keygen and gitleaks (and git, node) on PATH, `missing` taken away. */
  const tools = (missing = [], over = {}) =>
    probes({ hasTool: (bin, o) => !missing.includes(bin) && (['age', 'age-keygen', 'op', 'security', 'gitleaks'].includes(bin) || PROBES.hasTool(bin, o)), ...over });
  let ids = 0;
  /** An age identity outside every work tree: `kind` header (passphrase-protected), plain or none, at `mode`. */
  function identity(kind = 'header', mode = 0o600) {
    const file = path.join(TMP, 'ids', `i${(ids += 1)}`, 'identity.age');
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    if (kind === 'header') fs.writeFileSync(file, `${HEADER}-> scrypt fake\n`, { mode });
    if (kind === 'plain') fs.writeFileSync(file, '# created: now\nAGE-SECRET-KEY-1FAKE\n', { mode });
    fs.chmodSync(path.dirname(file), 0o700);
    if (kind !== 'none') fs.chmodSync(file, mode);
    return file;
  }
  const rows = (root, { id = identity(), env = {}, ...rest } = {}) =>
    doctor(root, { probes: tools(), env: { ...ENV, COOKWRIGHT_AGE_IDENTITY: id, ...env }, ...rest });
  const pick = (r) => ({ backend: r['secrets.backend'], targets: r['secrets.targets'], carriers: r['secrets.carriers'] });

  it('reads no secrets key as Level 2 off, no targets, and nothing carried: three static PASS rows', () => {
    const r = doctor(level0());
    expect(Object.keys(r).slice(-3)).toEqual(['secrets.backend', 'secrets.targets', 'secrets.carriers']);
    expect(pick(r)).toEqual({
      backend: { status: 'PASS', note: sb.none },
      targets: { status: 'PASS', note: st.none },
      carriers: { status: 'PASS', note: sc.ok },
    });
  });

  it('age: the identity missing, plain, passphrase-protected, readable by others, on Windows', () => {
    const root = level0(AGE_FILES, ageConfig());
    const missing = path.join(TMP, 'ids', 'never', 'identity.age');
    expect(rows(root, { id: missing })['secrets.backend']).toEqual({ status: 'WARN', note: sb.age.missing(missing) });
    const plain = identity('plain');
    expect(rows(root, { id: plain })['secrets.backend']).toEqual({ status: 'WARN', note: sb.age.noPassphrase(plain) });
    expect(rows(root, { id: plain })['secrets.backend'].note).not.toMatch(/AGE-SECRET-KEY/);
    const good = identity();
    expect(rows(root, { id: good })['secrets.backend']).toEqual({ status: 'PASS', note: sb.age.ok(good) });
    const open = identity('header', 0o644);
    expect(rows(root, { id: open })['secrets.backend']).toEqual({ status: 'FAIL', note: sb.age.mode(open, '644') });
    expect(rows(root, { id: open, platform: 'win32' })['secrets.backend']).toEqual({ status: 'SKIP', note: sb.age.windows(open) });
  });

  it('age: an identity inside a git work tree FAILs naming it, by realpath, and the targets row follows', () => {
    const other = gitInit(path.join(TMP, 'dotfiles'));
    const linked = path.join(TMP, 'linked-config');
    fs.symlinkSync(other, linked);
    const id = path.join(linked, 'cookwright', 'identity.age');
    const r = rows(level0(AGE_FILES, ageConfig()), { id });
    const real = fs.realpathSync(other);
    expect(r['secrets.backend']).toEqual({ status: 'FAIL', note: sb.age.inWorkTree(id, real) });
    expect(r['secrets.targets']).toEqual({ status: 'SKIP', note: st.follows('FAIL', sb.age.inWorkTree(id, real)) });
  });

  it('SKIPs the backend row, never FAILs it, on a machine without git (rule 1)', () => {
    const r = rows(level0(AGE_FILES, ageConfig()), { probes: tools(['git']) });
    expect(r['secrets.backend']).toEqual({ status: 'SKIP', note: messages.doctor.needsGit });
    expect(r['secrets.targets']).toEqual({ status: 'SKIP', note: messages.doctor.needsGit });
  });

  it("SKIPs a missing tool naming the operation, age-keygen only while there is no identity (disposition 58)", () => {
    const root = level0(AGE_FILES, ageConfig());
    const noAge = rows(root, { probes: tools(['age']) });
    expect(noAge['secrets.backend']).toEqual({ status: 'SKIP', note: sb.needsTool('age', 'run', messages.secrets.age.install) });
    expect(noAge['secrets.targets'].status).toBe('SKIP');
    expect(rows(root, { probes: tools(['age-keygen']) })['secrets.backend'].status).toBe('PASS');
    const none = path.join(TMP, 'ids', 'none-yet', 'identity.age');
    expect(rows(root, { id: none, probes: tools(['age-keygen']) })['secrets.backend']).toEqual({
      status: 'SKIP',
      note: sb.needsTool('age-keygen', 'secrets init', messages.secrets.age.install),
    });
  });

  it('age: names each target, the committed one tracked, the absent one missing, the unproved one', () => {
    const config = ageConfig({ dev: { names: NAMES, proof }, prod: { names: NAMES, proof }, ops: { names: ['OPS_TOKEN'] } });
    const r = rows(level0({ ...AGE_FILES, 'secrets/ops.env.age': ARMORED }, config));
    expect(r['secrets.targets']).toEqual({
      status: 'WARN',
      note: [
        st.age.ok('dev', true),
        st.age.noCiphertext('prod', 'secrets/prod.env.age'),
        st.age.ok('ops', true),
        st.unproved('ops'),
      ].join('; '),
    });
    expect(r['secrets.targets'].note).toBe(
      'dev: ciphertext and recipients tracked; prod: no ciphertext (secrets/prod.env.age): npx cookwright secrets set prod <NAME>, for each name; ops: ciphertext and recipients tracked; ops: unproved (no proof declared; the secrets guide shows the kinds)',
    );
    const both = rows(level0({ ...AGE_FILES, 'secrets/prod.env.age': ARMORED }, ageConfig()));
    expect(both['secrets.targets']).toEqual({ status: 'PASS', note: `${st.age.ok('dev', true)}; ${st.age.ok('prod', true)}` });
  });

  it('age: WARNs a ciphertext changed or untracked, and a recipients file that differs from HEAD', () => {
    const root = level0({ ...AGE_FILES, 'secrets/prod.env.age': ARMORED }, ageConfig());
    write(root, 'secrets/dev.env.age', `${ARMORED}x\n`);
    write(root, 'secrets/recipients.txt', `${KEY}\n# a new line\n`);
    fs.rmSync(path.join(root, 'secrets/prod.env.age'));
    run(root, 'git', ['rm', '-q', '--cached', 'secrets/prod.env.age']);
    write(root, 'secrets/prod.env.age', ARMORED);
    expect(rows(root)['secrets.targets']).toEqual({
      status: 'WARN',
      note: [
        messages.secrets.recipients({ why: 'differs' }, 'secrets/recipients.txt'),
        st.file('dev', 'secrets/dev.env.age', 'changed'),
        st.file('prod', 'secrets/prod.env.age', 'untracked'),
      ].join('; '),
    });
  });

  it('FAILs a secrets path git ignores, naming the .gitignore line (disposition 42)', () => {
    const root = level0({ ...AGE_FILES, '.gitignore': '.env\n.env.*\n!.env.example\nsecrets/\n' }, ageConfig());
    expect(rows(root)['secrets.targets']).toEqual({
      status: 'FAIL',
      note: st.ignored('secrets/', { source: '.gitignore', line: 4, pattern: 'secrets/' }),
    });
    write(root, '.gitignore', '.env\n.env.*\n!.env.example\n*.age\n');
    const rule = { source: '.gitignore', line: 4, pattern: '*.age' };
    expect(rows(root)['secrets.targets']).toEqual({
      status: 'FAIL',
      note: [st.ignored('secrets/dev.env.age', rule), st.ignored('secrets/prod.env.age', rule)].join('; '),
    });
  });

  it('reads the files top-relative from a config root below the top, past a decoy secrets/ at the top (disposition 54)', () => {
    const top = level0({ 'secrets/dev.env.age': 'a decoy\n' });
    const config = { version: CONFIG_VERSION, gate: GATE, ...ageConfig({ dev: { names: NAMES, proof } }) };
    commit({ root: top }, { 'apps/mobile/cookwright.json': JSON.stringify(config), 'apps/mobile/secrets/recipients.txt': `${KEY}\n` }, 'nested');
    const r = rows(top, { cwd: path.join(top, 'apps/mobile') });
    expect(r['secrets.targets']).toEqual({ status: 'WARN', note: st.age.noCiphertext('dev', 'secrets/dev.env.age') });
  });

  it('WARNs an empty targets object, a chosen state (disposition 44)', () => {
    expect(rows(level0({}, ageConfig({})))['secrets.targets']).toEqual({ status: 'WARN', note: st.empty });
  });

  it('1password: op on PATH; the template parsed, a literal FAILed by line number', () => {
    const config = { secrets: { backend: '1password', targets: { dev: { names: NAMES, proof } } } };
    const tpl = 'API_URL=op://Dev/api/url\nAPI_TOKEN=op://Dev/api/token\n';
    const r = doctor(level0({ 'secrets/dev.env.tpl': tpl }, config), { probes: tools() });
    expect(pick(r).backend).toEqual({ status: 'PASS', note: sb.op });
    expect(pick(r).targets).toEqual({ status: 'PASS', note: st.op.ok('dev') });
    const literal = doctor(level0({ 'secrets/dev.env.tpl': `${tpl}# API_TOKEN=tok-old\n` }, config), { probes: tools() });
    expect(literal['secrets.targets']).toEqual({ status: 'FAIL', note: st.op.literal('dev', 'secrets/dev.env.tpl', [3]) });
    expect(doctor(level0({}, config), { probes: tools(['op']) })['secrets.backend']).toEqual({
      status: 'SKIP',
      note: sb.needsTool('op', 'run', messages.secrets.op.install),
    });
  });

  describe('keychain', () => {
    const config = { secrets: { backend: 'keychain', id: 'app', targets: { dev: { names: NAMES, proof } } } };
    const held = (status) => (cmd, args) => ({ status: args.at(-1) === 'API_TOKEN' ? status : 0, stdout: '', stderr: '' });

    it('SKIPs off macOS; on macOS names the services and looks each name up by attributes', () => {
      const root = level0({}, config);
      expect(doctor(root, { probes: tools(), platform: 'linux' })['secrets.backend']).toEqual({
        status: 'SKIP',
        note: sb.platform('keychain'),
      });
      const calls = [];
      const capture = (cmd, args, opts) => {
        calls.push(args);
        return held(44)(cmd, args, opts);
      };
      const r = doctor(root, { probes: tools([], { capture }), platform: 'darwin' });
      expect(r['secrets.backend']).toEqual({ status: 'PASS', note: sb.keychain(['cookwright/app/dev']) });
      expect(r['secrets.targets']).toEqual({ status: 'WARN', note: st.keychain.missing('dev', 'cookwright/app/dev', ['API_TOKEN']) });
      expect(calls.every((a) => !a.includes('-g') && !a.includes('-w'))).toBe(true);
    });

    it('reads a budget spent inside inspect as a SKIP, the level rows measured first (disposition 69)', () => {
      const capture = () => {
        throw new TimedOut('security');
      };
      const repo = openDoctorRepo(level0({}, config), tools(), { home: TMP, env: ENV, platform: 'darwin' });
      const r = Object.fromEntries(runChecks(repo, tools([], { capture })));
      expect(r['secrets.targets']).toEqual({ status: 'SKIP', note: st.timedOut('security') });
      expect(r['repo.node_modules'].status).toBe('PASS');
      const names = Object.keys(r);
      expect(names.indexOf('repo.node_modules')).toBeLessThan(names.indexOf('secrets.targets'));
    });
  });

  describe('secrets.carriers', () => {
    const carriers = (root, opts = {}) => doctor(root, opts)['secrets.carriers'];

    it('WARNs an .envrc at the root or tracked anywhere, with or without a secrets key', () => {
      expect(carriers(level0({ '.envrc': 'use flake\n' }))).toEqual({ status: 'WARN', note: sc.envrcTracked(['.envrc']) });
      const loose = level0();
      write(loose, '.envrc', 'use flake\n');
      expect(carriers(loose)).toEqual({ status: 'WARN', note: sc.envrcRoot });
      expect(carriers(level0({ 'apps/api/.envrc': 'x\n' }))).toEqual({ status: 'WARN', note: sc.envrcTracked(['apps/api/.envrc']) });
    });

    it('reads .envrc from the top for a config root below it: tracked above or under the root, untracked above or at it, top-relative (review:surface finding 1)', () => {
      const top = level0({ '.envrc': 'use flake\n', 'apps/web/.envrc': 'x\n' });
      const config = { version: CONFIG_VERSION, gate: GATE };
      commit({ root: top }, { 'apps/mobile/cookwright.json': JSON.stringify(config), 'apps/mobile/ios/.envrc': 'x\n' }, 'nested');
      const cwd = path.join(top, 'apps/mobile');
      expect(carriers(top, { cwd })).toEqual({ status: 'WARN', note: sc.envrcTracked(['.envrc', 'apps/mobile/ios/.envrc']) });
      write(top, 'apps/.envrc', 'x\n');
      write(top, 'apps/mobile/.envrc', 'x\n');
      expect(carriers(top, { cwd })).toEqual({
        status: 'WARN',
        note: [sc.envrcTracked(['.envrc', 'apps/mobile/ios/.envrc']), sc.envrcAbove(['apps/.envrc']), sc.envrcRoot].join('; '),
      });
    });

    it("WARNs a declared or ambient name in doctor's environment, by name only", () => {
      const root = level0({}, { packs: ['supabase'], secrets: { backend: 'age', targets: { dev: { names: NAMES, proof } } } });
      const env = { ...ENV, API_TOKEN: 'a-stale-token-value', SUPABASE_DB_URL: 'postgresql://x', UNRELATED: '1' };
      const got = carriers(root, { env });
      expect(got).toEqual({ status: 'WARN', note: sc.exported(['API_TOKEN', 'SUPABASE_DB_URL']) });
      expect(got.note).not.toMatch(/stale|postgresql/);
    });

    it('WARNs a line setting such a name in a shell rc file, comments skipped, names and files only', () => {
      const root = level0({}, { packs: ['supabase'], secrets: { backend: 'age', targets: { dev: { names: NAMES, proof } } } });
      const home = fs.mkdtempSync(path.join(TMP, 'home-'));
      fs.writeFileSync(path.join(home, '.zshrc'), '# export API_TOKEN=old\nexport SUPABASE_DB_URL=postgresql://u:p@h/d\nexport PATH=/x\n');
      fs.writeFileSync(path.join(home, '.zshenv'), '  API_TOKEN=$(op read op://v/i/f)\n');
      const got = carriers(root, { home });
      expect(got).toEqual({
        status: 'WARN',
        note: sc.rcLine([
          ['API_TOKEN', '~/.zshenv'],
          ['SUPABASE_DB_URL', '~/.zshrc'],
        ]),
      });
      expect(got.note).not.toMatch(/postgresql|op read/);
      expect(carriers(level0(), { home })).toEqual({ status: 'PASS', note: sc.ok });
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
  // A foreign setup is a chosen state: all three rows WARN, the files naming hooks.path (disposition 17).
  const elsewhere = (note) => [{ status: 'WARN', note }, ...[1, 2].map(() => ({ status: 'WARN', note: m.hooks.elsewhere }))];

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

  it('WARNs a foreign setup and its two files: local elsewhere, global, user hooks, a .githooks file of theirs', () => {
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
    const config = JSON.stringify({ version: CONFIG_VERSION });
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
    writeAll(app, { 'cookwright.json': JSON.stringify({ version: CONFIG_VERSION }) });
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

describe('packs and the pack rows', () => {
  const DESIGN = 'docs/design-system.md';
  const DATA = 'docs/data-model.md';
  const agents = (...sections) => `# Rules\n\n${[renderBlock(DEFAULTS), ...sections].join('\n\n')}\n`;
  const expoSection = (off) => renderSection(PACKS.expo, off);
  const supabaseSection = () => renderSection(PACKS.supabase);
  const DOCS = { [DESIGN]: '| Primitive | File | Props | Notes |\n| --- | --- | --- | --- |\n', [DATA]: '| Migration | Tables | Summary |\n|---|---|---|\n' };
  /** A Level 0 repo declaring `packs`, with their sections, contract docs and doc-sync rules, `files` overriding. */
  const packed = (packs, files = {}, docSync = packDefaults(packs.map(packName)).docSync) =>
    level0({ 'AGENTS.md': agents(...packs.map(packName).map((n) => renderSection(PACKS[n]))), ...DOCS, ...files }, { packs, hooks: { docSync } });

  it('reads packs PASS with none declared and none detected, WARN when the tree shows a stack, PASS naming the declared', () => {
    expect(doctor(level0()).packs).toEqual({ status: 'PASS', note: m.packs.none });
    const app = { 'package.json': JSON.stringify({ dependencies: { expo: '~58.0.0' } }), 'supabase/config.toml': '' };
    expect(doctor(level0(app)).packs).toEqual({
      status: 'WARN',
      note: m.packs.detected([
        { name: 'expo', evidence: messages.detect.dependsOn('expo') },
        { name: 'supabase', evidence: messages.detect.file('supabase/config.toml') },
      ]),
    });
    expect(m.packs.detected([{ name: 'expo', evidence: 'package.json depends on expo' }])).toBe(
      'expo detected (package.json depends on expo), no pack declared; the setup skill offers it',
    );
    expect(doctor(packed(['expo', 'supabase'], app)).packs).toEqual({ status: 'PASS', note: 'declared: expo, supabase' });
    expect(doctor(level0({}, { hosts: ['gemini'] })).packs).toEqual({ status: 'SKIP', note: m.configInvalid });
  });

  const TYPES_SCRIPT = 'supabase gen types --local > src/types/db.ts';
  const withTypes = { 'package.json': JSON.stringify({ scripts: { test: 'vitest run', 'db:types': TYPES_SCRIPT } }) };
  const withSupabase = probes({ hasTool: (bin) => bin === 'supabase' || probes().hasTool(bin) });

  /** `packed` with the gate entries a fresh config gets for `packs`, the types check among them. */
  const packedWithGate = (packs, files) =>
    level0(
      { 'AGENTS.md': agents(...packs.map((n) => renderSection(PACKS[n]))), ...DOCS, ...files },
      { packs, hooks: { docSync: packDefaults(packs).docSync }, gate: { checks: [...GATE.checks, ...packDefaults(packs).gate] } },
    );

  it('appends each declared pack’s rows after the static ones, in packs order, every one PASS on a fresh repo', () => {
    const rows = doctor(fakeEslintRepo(packedWithGate(['supabase', 'expo'], withTypes)), { probes: withSupabase });
    const kinds = ['declared', 'rules', 'docs', 'lint'];
    expect(Object.keys(rows)).toEqual([
      ...Object.keys(CHECKS),
      ...kinds.map((k) => `pack.supabase.${k}`),
      'pack.supabase.types',
      ...kinds.map((k) => `pack.expo.${k}`),
    ]);
    expect(rows['pack.expo.lint'].note).toBe('eslint 9.39.0-fake; eslint.config.js names cookwright/packs/expo/eslint.cjs');
    for (const [name, r] of Object.entries(rows)) expect([name, r.status]).toEqual([name, 'PASS']);
    expect(rows['pack.expo.declared'].note).toBe('expo pack v1: strings, tokens, size, design-doc; advisory: 3');
    expect(rows['pack.supabase.declared'].note).toBe('supabase pack v1: client, data-doc, types');
    expect(rows['pack.expo.rules'].note).toBe("AGENTS.md: the expo pack's section is current");
    expect(rows['pack.expo.docs'].note).toBe('0 primitives, 0 documented in docs/design-system.md');
    expect(rows['pack.supabase.docs'].note).toBe('0 migrations, 0 documented in docs/data-model.md');
    expect(rows['pack.supabase.types'].note).toBe('measured by the gate against the local stack (db:types writes src/types/db.ts)');
  });

  it('reads pack.<name>.lint: WARN with no ESLint, an old one, no config, the export not named, its plugin missing', () => {
    const l = m.pack.lint;
    const lint = (fake, packs = ['expo'], files = {}) => {
      const root = packedWithGate(packs, files);
      if (fake) fakeEslintRepo(root, fake);
      return doctor(root);
    };
    expect(lint(null)['pack.expo.lint']).toEqual({ status: 'WARN', note: l.noEslint('npx expo lint') });
    expect(l.noEslint('npx expo lint')).toBe('not measured; npx expo lint installs ESLint');
    expect(lint(null, ['supabase'])['pack.supabase.lint']).toEqual({ status: 'WARN', note: l.noEslint('npm install --save-dev eslint') });
    const old = fs.mkdtempSync(path.join(TMP, 'eslint8-'));
    fs.writeFileSync(path.join(old, 'package.json'), '{ "name": "eslint", "version": "8.57.0" }');
    expect(lint({ eslint: old })['pack.expo.lint']).toEqual({ status: 'WARN', note: l.oldEslint('8.57.0') });
    expect(lint({ config: null })['pack.expo.lint']).toEqual({ status: 'WARN', note: l.noConfig('npx expo lint') });
    const supabaseExport = 'cookwright/packs/supabase/eslint.cjs';
    expect(lint({ config: null }, ['supabase'])['pack.supabase.lint']).toEqual({ status: 'WARN', note: l.writeConfig(supabaseExport) });
    expect(l.writeConfig(supabaseExport)).toBe(
      `not measured; no ESLint config (eslint.config.js); write one that spreads ${supabaseExport} (the setup skill does it with consent)`,
    );
    const spread = "...require('cookwright/packs/expo/eslint.cjs'),";
    expect(lint({ config: 'module.exports = [];\n' })['pack.expo.lint']).toEqual({
      status: 'WARN',
      note: l.unnamed('eslint.config.js', 'cookwright/packs/expo/eslint.cjs', [spread]),
    });
    expect(l.unnamed('eslint.config.js', 'cookwright/packs/expo/eslint.cjs', [spread])).toBe(
      `eslint.config.js does not name cookwright/packs/expo/eslint.cjs; add ${spread} at the end of its config array by hand: ` +
        "spread last, the pack's options replace yours for any ESLint rule a block of yours also sets on the pack's files; " +
        'spread before a block of yours that sets such a rule, that rule reads overridden and is not measured unless the block ' +
        "sets only error, or error with exactly the pack's options (the setup skill does it with consent)",
    );
    const esm = lint({ config: null }, ['expo'], { 'eslint.config.mjs': 'export default [];\n' })['pack.expo.lint'];
    const esmImport = "import cookwrightExpo from 'cookwright/packs/expo/eslint.cjs';";
    expect(esm.note).toBe(l.unnamed('eslint.config.mjs', 'cookwright/packs/expo/eslint.cjs', ['...cookwrightExpo,'], [esmImport]));
    expect(esm.note).toContain(`add ${esmImport} at its top and ...cookwrightExpo, at the end of its config array by hand: `);
    const i18next = 'npm install --save-dev eslint-plugin-i18next';
    expect(lint({ plugin: false })['pack.expo.lint']).toEqual({
      status: 'WARN',
      note: `${l.ok('9.39.0-fake', 'eslint.config.js', 'cookwright/packs/expo/eslint.cjs')}; ${l.needs(i18next, PACKS.expo.deps[0].reason)}`,
    });
  });

  it('WARNs pack.<name>.lint when the gate has no ratchet entry, or one without its skip exit', () => {
    const l = m.pack.lint;
    const named = l.ok('9.39.0-fake', 'eslint.config.js', 'cookwright/packs/expo/eslint.cjs');
    const lint = (checks) => {
      const root = level0({ 'AGENTS.md': agents(expoSection()), ...DOCS }, { packs: ['expo'], hooks: { docSync: packDefaults(['expo']).docSync }, gate: { checks } });
      return doctor(fakeEslintRepo(root))['pack.expo.lint'];
    };
    const entry = JSON.stringify(RATCHET_CHECK);
    expect(lint(GATE.checks)).toEqual({ status: 'WARN', note: `${named}; ${l.noGate(entry)}` });
    expect(l.noGate(entry)).toBe(
      'the gate runs no standards ratchet; add {"name":"standards","run":"npx cookwright standards --ratchet","skipExit":11} to gate.checks (npx cookwright packs rules prints it)',
    );
    const bare = { name: 'standards', run: 'npx cookwright standards --ratchet' };
    expect(lint([bare])).toEqual({ status: 'WARN', note: `${named}; ${m.pack.noSkipExit('standards', 11)}` });
    expect(m.pack.noSkipExit('standards', 11)).toBe('the gate check standards has no "skipExit": 11, so its "cannot measure" exit fails the gate; add it');
    expect(lint([{ ...bare, run: 'echo cookwright standards --ratchet', skipExit: 11 }]).note).toBe(`${named}; ${l.noGate(entry)}`);
    expect(lint([{ ...bare, run: 'npx cookwright standards --ratchet && true', skipExit: 11 }]).note).toBe(`${named}; ${l.noGate(entry)}`);
    for (const run of ['npx cookwright standards --ratchet --base main', 'node node_modules/cookwright/bin/cookwright.mjs standards --ratchet']) {
      expect(lint([{ ...bare, run, skipExit: 11 }])).toEqual({ status: 'PASS', note: named });
    }
  });

  it('asks for no plugin with its rule off, and has no lint row with every ESLint rule off', () => {
    const stringsOff = [{ name: 'expo', rules: { strings: false } }];
    const gate = { checks: [...GATE.checks, RATCHET_CHECK] };
    const root = level0({ 'AGENTS.md': agents(expoSection(new Set(['strings']))), ...DOCS }, { packs: stringsOff, gate });
    expect(doctor(fakeEslintRepo(root, { plugin: false }))['pack.expo.lint'].status).toBe('PASS');
    const allOff = [{ name: 'supabase', rules: { client: false } }];
    expect(Object.keys(doctor(level0({}, { packs: allOff })))).not.toContain('pack.supabase.lint');
  });

  it('reads pack.supabase.types: SKIP without the CLI, WARN with no script, another shape or no gate entry, absent with the rule off', () => {
    const t = m.pack.types;
    const types = (files, p = withSupabase, packs = ['supabase']) => doctor(packed(packs, files), { probes: p })['pack.supabase.types'];
    const noSupabase = probes({ hasTool: (bin) => bin !== 'supabase' && probes().hasTool(bin) });
    expect(types(withTypes, noSupabase)).toEqual({ status: 'SKIP', note: t.needsCli });
    expect(t.needsCli).toBe('skipped, needs supabase (brew install supabase/tap/supabase)');
    expect(types({})).toEqual({ status: 'WARN', note: t.noScript('db:types') });
    expect(t.noScript('db:types')).toBe(
      'no db:types script in package.json; add "db:types": "supabase gen types --local > <path>", the shape the gate\'s types check reads',
    );
    const linked = { 'package.json': JSON.stringify({ scripts: { test: 'vitest run', 'db:types': 'supabase gen types --linked > db.ts' } }) };
    expect(types(linked)).toEqual({ status: 'WARN', note: t.shape('db:types') });
    const entry = '{"name":"standards:types","run":"npx cookwright standards --types","skipExit":11}';
    expect(types(withTypes)).toEqual({ status: 'WARN', note: t.noGate(entry) });
    expect(t.noGate(entry)).toBe(`the gate runs no types check; add ${entry} to gate.checks (npx cookwright packs rules prints it)`);
    expect(doctor(packedWithGate(['supabase'], withTypes), { probes: withSupabase })['pack.supabase.types'].status).toBe('PASS');
    const typesWith = (check) => {
      const root = level0(
        { 'AGENTS.md': agents(renderSection(PACKS.supabase)), ...DOCS, ...withTypes },
        { packs: ['supabase'], hooks: { docSync: packDefaults(['supabase']).docSync }, gate: { checks: [RATCHET_CHECK, check] } },
      );
      return doctor(root, { probes: withSupabase })['pack.supabase.types'];
    };
    const bare = { name: 'standards:types', run: 'npx cookwright standards --types' };
    expect(typesWith(bare)).toEqual({ status: 'WARN', note: m.pack.noSkipExit('standards:types', 11) });
    expect(typesWith({ ...bare, run: 'echo cookwright standards --types', skipExit: 11 })).toEqual({ status: 'WARN', note: t.noGate(entry) });
    expect(typesWith({ ...bare, run: 'npx cookwright standards --types --staged', skipExit: 11 })).toEqual({ status: 'WARN', note: t.noGate(entry) });
    expect(typesWith({ ...bare, skipExit: 11 }).status).toBe('PASS');
    expect(types(withTypes, withSupabase, [{ name: 'supabase', rules: { types: false } }])).toBeUndefined();
  });

  it('has no pack row without a config, and a pack FAIL never moves the level line', () => {
    expect(Object.keys(doctor(level0({}, { hosts: ['gemini'] }))).some((k) => k.startsWith('pack.'))).toBe(false);
    const rows = runChecks(openDoctorRepo(packed(['expo'], { 'AGENTS.md': agents() }), probes(), { home: TMP, env: ENV }), probes());
    expect(Object.fromEntries(rows)['pack.expo.rules'].status).toBe('FAIL');
    expect(levelLine(DEFAULTS, rows)).toBe('level 0 declared: complete');
  });

  it('reads the section: FAIL absent, stale, malformed or with no AGENTS.md; WARN newer', () => {
    const r = m.pack.rules;
    const rules = (files) => doctor(packed(['expo'], files))['pack.expo.rules'];
    expect(rules({ 'AGENTS.md': agents() })).toEqual({ status: 'FAIL', note: r.absent('AGENTS.md', 'expo') });
    expect(r.absent('AGENTS.md', 'expo')).toBe('AGENTS.md has no expo pack section (run npx cookwright init)');
    const stale = expoSection().replace('theme tokens only', 'tokens');
    expect(rules({ 'AGENTS.md': agents(stale) })).toEqual({ status: 'FAIL', note: r.stale('AGENTS.md', 'expo') });
    const newer = expoSection().replace(beginMarker(1, 'pack expo'), beginMarker(9, 'pack expo'));
    expect(rules({ 'AGENTS.md': agents(newer) })).toEqual({ status: 'WARN', note: r.newer('AGENTS.md', 'expo', 9) });
    const noEnd = `# Rules\n\n${renderBlock(DEFAULTS)}\n\n${expoSection().split('\n').slice(0, -1).join('\n')}\n`;
    expect(rules({ 'AGENTS.md': noEnd })).toEqual({ status: 'FAIL', note: r.malformed('AGENTS.md', 'expo', 'noEnd') });
    expect(rules({ 'AGENTS.md': null })).toEqual({ status: 'FAIL', note: r.noFile('AGENTS.md', 'expo') });
  });

  it('WARNs a rule switched off on a current section, and keeps a FAIL a FAIL, both notes on the line', () => {
    const off = [{ name: 'expo', rules: { size: false, tokens: false } }];
    const current = expoSection(new Set(['size', 'tokens']));
    const rules = (text) => doctor(packed(off, { 'AGENTS.md': agents(text) }))['pack.expo.rules'];
    expect(rules(current)).toEqual({ status: 'WARN', note: "AGENTS.md: the expo pack's section is current; switched off: tokens, size" });
    expect(rules(expoSection())).toEqual({
      status: 'FAIL',
      note: `${m.pack.rules.stale('AGENTS.md', 'expo')}; ${m.pack.rules.off(['tokens', 'size'])}`,
    });
  });

  it('WARNs a contract doc missing, its doc-sync rule absent or not the pack’s', () => {
    const d = m.pack.docs;
    const docs = (files, docSync) => doctor(packed(['expo'], files, docSync))['pack.expo.docs'];
    expect(docs({ [DESIGN]: null }, [])).toEqual({
      status: 'WARN',
      note: `${d.missing(DESIGN)}; ${d.noRule('expo:design-doc', DESIGN)}`,
    });
    expect(d.missing(DESIGN)).toBe('docs/design-system.md missing (run npx cookwright init)');
    expect(docs({}, [])).toEqual({ status: 'WARN', note: d.noRule('expo:design-doc', DESIGN) });
    const elsewhere = [{ name: 'expo:design-doc', code: ['src/components/**'], docs: ['docs/ui.md'] }];
    expect(docs({}, elsewhere)).toEqual({ status: 'WARN', note: d.ruleDiffers('expo:design-doc', DESIGN) });
    const [pack] = packDefaults(['expo']).docSync;
    // Another doc beside the pack's would be satisfied alone; a narrower code list leaves components unasked.
    const widened = [{ ...pack, docs: [...pack.docs, 'README.md'] }];
    expect(docs({}, widened)).toEqual({ status: 'WARN', note: d.ruleDiffers('expo:design-doc', DESIGN) });
    const narrowed = [{ ...pack, code: ['src/screens/**'] }];
    expect(docs({}, narrowed)).toEqual({ status: 'WARN', note: d.ruleDiffers('expo:design-doc', DESIGN) });
    const reordered = [{ ...pack, code: [...pack.code].reverse() }, { name: 'mine', code: ['app/**'], docs: ['README.md'] }];
    expect(docs({}, reordered).status).toBe('PASS');
  });

  it('asks for no doc-sync rule when the pack’s doc rule is switched off', () => {
    const off = [{ name: 'expo', rules: { 'design-doc': false } }];
    const root = level0({ 'AGENTS.md': agents(expoSection(new Set(['design-doc']))), ...DOCS }, { packs: off });
    expect(doctor(root)['pack.expo.docs']).toEqual({ status: 'PASS', note: m.pack.docs.ok(0, 'components', DESIGN) });
  });

  it('counts the primitives and migrations with no entry, naming the first ones, never a FAIL', () => {
    const components = Object.fromEntries(
      ['Avatar', 'Button', 'Chip', 'Fab', 'Card', 'Tag', 'Toast'].map((c) => [`src/components/${c}.tsx`, '']),
    );
    const design = `${DOCS[DESIGN]}| \`Button\` | src/components/Button.tsx | label | |\n`;
    const rows = doctor(packed(['expo', 'supabase'], {
      ...components,
      [DESIGN]: design,
      'supabase/migrations/20261025120000_init.sql': '',
      'supabase/migrations/20261025130000_todos.sql': '',
      [DATA]: `${DOCS[DATA]}| 20261025120000_init.sql | todos | first |\n`,
    }));
    expect(rows['pack.expo.docs']).toEqual({
      status: 'WARN',
      note: '6 of 7 primitives have no entry in docs/design-system.md: Avatar, Card, Chip, Fab, Tag, …',
    });
    expect(rows['pack.supabase.docs']).toEqual({
      status: 'WARN',
      note: '1 of 2 migrations has no entry in docs/data-model.md: 20261025130000_todos.sql',
    });
  });

  it('counts a primitive documented under a ## or ### heading as an entry', () => {
    const design = '# Design system\n\n## Button\n\nThe one button.\n\n### `Card`\n\nA surface.\n';
    const rows = doctor(packed(['expo'], { 'src/components/Button.tsx': '', 'src/components/Card/index.tsx': '', [DESIGN]: design }));
    expect(rows['pack.expo.docs']).toEqual({ status: 'PASS', note: m.pack.docs.ok(2, 'components', DESIGN) });
  });

  it.skipIf(process.getuid?.() === 0)('SKIPs the count of a code directory it cannot read, never a measured 0', () => {
    const root = packed(['expo'], { 'src/components/Button.tsx': '' });
    const dir = path.join(root, 'src/components');
    fs.chmodSync(dir, 0o000);
    try {
      expect(doctor(root)['pack.expo.docs']).toEqual({
        status: 'SKIP',
        note: m.pack.docs.unreadable('components', 'src/components', 'EACCES'),
      });
    } finally {
      fs.chmodSync(dir, 0o755);
    }
    expect(m.pack.docs.unreadable('components', 'src/components', 'EACCES')).toBe(
      'primitives not counted: src/components could not be read (EACCES)',
    );
  });
});

describe('repo.node_modules', () => {
  it('PASSes an installed, untracked node_modules, and FAILs a tracked one with the untrack command (B-011)', () => {
    const root = level0();
    expect(doctor(root)['repo.node_modules']).toEqual({ status: 'PASS', note: m.nodeModules.ok });
    stageOnly(root, 'node_modules/left-pad/index.js');
    expect(doctor(root)['repo.node_modules']).toEqual({ status: 'FAIL', note: m.nodeModules.tracked });
    expect(m.nodeModules.tracked).toBe('node_modules is tracked (git rm -r --cached node_modules, then commit)');
  });

  it('reads a tracked node_modules as drift at Level 0', () => {
    const root = level0();
    stageOnly(root, 'node_modules/left-pad/index.js');
    const rows = runChecks(openDoctorRepo(root, probes(), { home: TMP, env: ENV }), probes());
    expect(levelLine(DEFAULTS, rows)).toBe('level 0 declared: drift, 1 piece(s) missing: repo.node_modules');
  });

  it('judges the config root’s node_modules, not a sibling’s', () => {
    const top = level0({ 'apps/web/node_modules/x/index.js': '' });
    expect(doctor(top)['repo.node_modules'].status).toBe('PASS');
  });
});

describe('gate.scripts', () => {
  const scripts = (files, checks) => doctor(level0(files, { gate: { checks } }))['gate.scripts'];
  const test = { name: 'test', run: 'npm test' };

  it('WARNs no checks, since pre-push then runs nothing (B-012)', () => {
    expect(scripts({}, [])).toEqual({ status: 'WARN', note: m.gateScripts.none });
    expect(m.gateScripts.none).toBe('no gate checks configured; pre-push runs nothing (add a check to gate.checks)');
  });

  it('PASSes every npm script defined', () => {
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
    expect(scripts({ 'package.json': null }, [test])).toEqual({ status: 'FAIL', note: bundleMessages.noPackageJson('test', 'test') });
  });
});

describe('the level line', () => {
  /** Every required row PASS, then `over` (name → status), plus a non-required FAIL row. */
  const rows = (over = {}) => [
    ...LEVELS[0].requires.map((name) => [name, { status: over[name] ?? 'PASS', note: '' }]),
    ['rules.size', { status: 'FAIL', note: '' }],
  ];
  const line = (over) => levelLine(DEFAULTS, rows(over));

  it('is a truth table over the required rows: FAIL drift, else SKIP not verified, else complete, a WARN weak on each', () => {
    expect(line({})).toBe('level 0 declared: complete');
    expect(line({ git: 'WARN' })).toBe('level 0 declared: complete; weak: git');
    expect(line({ 'host.rules': 'SKIP', 'tools.gitleaks': 'SKIP' })).toBe(
      'level 0 declared: not verified: host.rules, tools.gitleaks (see their lines)',
    );
    expect(line({ 'tools.gitleaks': 'SKIP', git: 'WARN' })).toBe(
      'level 0 declared: not verified: tools.gitleaks (see their lines); weak: git',
    );
    expect(line({ 'rules.block': 'FAIL', 'tools.gitleaks': 'SKIP', git: 'WARN' })).toBe(
      'level 0 declared: drift, 1 piece(s) missing: rules.block; weak: git; not verified: tools.gitleaks (see their lines)',
    );
    expect(levelLine(null, rows())).toBe(m.levelUnknown);
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
  const doc = (root, argv = [], over = {}) => main(argv, { cwd: root, home: TMP, env: ENV, probes: probes(over) });

  it('prints every check, the counts, the level line and the next level', () => {
    expect(doc(level0())).toBe(0);
    expect(out).toHaveLength(N + 4);
    expect(out[0]).toBe(`PASS  ${'config'.padEnd(WIDTH)}  ${m.config.ok(0)}`);
    expect(out.slice(-3)).toEqual([
      `${N} checks — ${N} PASS, 0 FAIL, 0 WARN, 0 SKIP`,
      'level 0 declared: complete',
      'next: Level 1 is not available in this version of cookwright',
    ]);
  });

  it('reads a FAIL among the requirements as drift, and exits 1', () => {
    expect(doc(level0({ 'AGENTS.md': null, 'CHANGELOG.md': null }))).toBe(1);
    expect(out).toContain('level 0 declared: drift, 2 piece(s) missing: homes.changelog, rules.block');
  });

  it('reads a required check that could not measure as not verified, naming what is weak too', () => {
    expect(doc(level0({}, { baseBranch: 'trunk' }), [], { claudeVersion: () => null })).toBe(0);
    expect(out).toContain('level 0 declared: not verified: host.rules (see their lines); weak: git');
    expect(out).toContain(`${N} checks — ${N - 2} PASS, 0 FAIL, 1 WARN, 1 SKIP`);
  });

  it('reads a version-1 config as weak, not drift', () => {
    const v1 = JSON.stringify({ version: 1, paths: { playbook: 'docs/playbook.md' }, gate: GATE });
    expect(doc(level0({ 'cookwright.json': v1 }))).toBe(0);
    expect(out).toContain('level 0 declared: complete; weak: config');
  });

  it('reads gitleaks absent as not verified, never complete (B-013)', () => {
    expect(doc(level0(), [], { hasTool: (bin) => bin !== 'gitleaks' })).toBe(0);
    expect(out).toContain('level 0 declared: not verified: tools.gitleaks (see their lines)');
    expect(out.join('\n')).not.toMatch(/complete/);
  });

  it('reads a foreign hooks setup, a chosen state, as weak and the level complete (disposition 17)', () => {
    expect(doc(level0({}, null, { hooksPath: '.husky/_' }))).toBe(0);
    expect(out).toContain('level 0 declared: complete; weak: hooks.path, hooks.pre-commit, hooks.pre-push');
  });

  it('a WARN outside the requirements is neither drift nor weak', () => {
    expect(doc(level0({ '.gitignore': '.env\n' }))).toBe(0);
    expect(out).toContain('level 0 declared: complete');
  });

  it('reads an invalid config as level unknown, and exits 1', () => {
    expect(doc(level0({}, { hosts: ['gemini'] }))).toBe(1);
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
  const hook = (root, over = {}) => main(['--hook'], { cwd: root, home: TMP, env: ENV, probes: probes(over) });

  it('prints exactly one line when everything passes', () => {
    expect(hook(level0())).toBe(0);
    expect(out).toEqual(['cookwright doctor: level 0 complete']);
  });

  it('prints only what is not PASS, the counts and the level line, and exits 0 on a FAIL', () => {
    expect(hook(level0({ '.claude/settings.json': null }))).toBe(0);
    expect(out).toEqual([
      `FAIL  host.hook  ${m.hostHook.none('.claude/settings.json')}`,
      `cookwright doctor: ${N} checks — ${N - 1} PASS, 1 FAIL, 0 WARN, 0 SKIP`,
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
    expect(await dispatch(['doctor', '--hook'], { cwd: path.join(root, 'src'), home: TMP, env: ENV, probes: probes() })).toBe(0);
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
