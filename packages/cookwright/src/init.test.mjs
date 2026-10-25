// src/init.test.mjs — init on scratch repos: the fresh walk, idempotence, refresh,
// the refusals (each before any write), the host cases and .gitignore. The probes
// are injected (no Claude binary); `ignored` is real git.

import fs from 'node:fs';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { main } from './init.mjs';
import { applyRows } from './lib/init/files.mjs';
import { pointersStep } from './lib/init/pointers.mjs';
import { openInitRepo } from './lib/init/repo.mjs';
import { CONFIG_VERSION, DEFAULTS, validateConfig, withDefaults } from './lib/config.mjs';
import { NO_PACKS, freshConfig } from './lib/init/config.mjs';
import { callLine, shimText } from './lib/hooks/shims.mjs';
import { claudeHookStep } from './lib/init/claude.mjs';
import { codexHookStep } from './lib/init/codex.mjs';
import { ENV_LINES, NODE_MODULES_LINE } from './lib/init/gitignore.mjs';
import { CODEX_HOOK_COMMAND, HOOK_COMMAND, HOOK_LINES, HOSTS, SKILLS } from './lib/hosts.mjs';
import { messages } from './lib/messages.mjs';
import { PROBES, hasTool } from './lib/probes.mjs';
import { RULES_VERSION, beginMarker, packKind, renderBlock } from './lib/rules/block.mjs';
import { PACKS, RATCHET_CHECK } from './lib/packs/registry.mjs';
import { renderSection } from './lib/packs/section.mjs';
import { shippedPieces } from './lib/doctor/hosts.mjs';
import { CHECKS } from './lib/doctor/registry.mjs';
import { commit, gitInit, gitWithoutScopes, linkPackage, run, scratchRoot, stageOnly, v1Block, v2Block } from './test-helpers.mjs';

const TMP = scratchRoot('cookwright-init-');
const m = messages.init;
/** doctor's static rows, which init's own readout prints. */
const N = Object.keys(CHECKS).length;
const WIDTH = Math.max(...Object.keys(CHECKS).map((k) => k.length));
/** The readout's line for a fresh repo with no test script: no gate check. */
const GATE_WARN = `WARN  ${'gate.scripts'.padEnd(WIDTH)}  ${messages.doctor.gateScripts.none}`;
const TEMPLATES = path.join(path.dirname(new URL(import.meta.url).pathname), 'lib/templates');
const template = (name) => fs.readFileSync(path.join(TEMPLATES, name), 'utf8');
const BLOCK = renderBlock(DEFAULTS);

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

let n = 0;
/** A fresh git repo (no commit, no config) under `parent`. */
const fresh = (parent = TMP) => gitInit(path.join(parent, `r${(n += 1)}`));

const write = (root, rel, body) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
};
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (root, rel) => fs.existsSync(path.join(root, rel));
const executable = (root, rel) => (fs.statSync(path.join(root, rel)).mode & 0o111) !== 0;
/** The effective core.hooksPath, or null when it is set nowhere. */
const hooksPath = (root) => {
  try {
    return run(root, 'git', ['config', '--get', 'core.hooksPath']);
  } catch {
    return null;
  }
};

/** Every file under `root` but .git, as rel → text; a symbolic link as `-> <its text>`, never followed. */
function tree(root) {
  const files = {};
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const abs = path.join(dir, e.name);
      if (e.isSymbolicLink()) files[path.relative(root, abs)] = `-> ${fs.readlinkSync(abs)}`;
      else if (e.isDirectory()) walk(abs);
      else files[path.relative(root, abs)] = fs.readFileSync(abs, 'utf8');
    }
  };
  walk(root);
  return files;
}

const ROW = /^(wrote|updated|kept|skipped) +(\S+) +(.*)$/;

/** The Codex hook step alone at `root`, for the host-table `entry`. */
const codexHookStepFor = (root, entry) => codexHookStep({ root }, {}, entry);

/** The claude pointers the package ships, at the top: path and link text for a root at the top. */
const POINTERS = shippedPieces('claude').map((p) => {
  const rel = p.kind === 'skill' ? `.claude/skills/${p.file}` : `.claude/workflows/${p.file}`;
  const inPackage = p.kind === 'skill' ? `skills/${p.file}` : `hosts/claude/workflows/${p.file}`;
  return { ...p, rel, inPackage, text: `../../node_modules/cookwright/${inPackage}` };
});

/** gitleaks played present and running, so doctor's verdict never depends on this machine. */
const GITLEAKS = {
  hasTool: (bin) => bin === 'gitleaks' || hasTool(bin),
  scanStaged: () => ({ status: 0, timedOut: false, stderr: '' }),
  gitleaksVersion: () => '8.30.1',
};

/** Run init; `rows` maps each target to `{ action, note }`. */
function init(cwd, argv = [], { version = '2.1.281', probes = {} } = {}) {
  out.length = 0;
  err.length = 0;
  const code = main(argv, { cwd, home: TMP, probes: { ...GITLEAKS, claudeVersion: () => version, ...probes } });
  const rows = {};
  for (const line of out) {
    const r = ROW.exec(line);
    if (r) rows[r[2]] = { action: r[1], note: r[3] };
  }
  return { code, rows, actions: Object.values(rows).map((r) => r.action) };
}

describe('a fresh repo', () => {
  it('writes every piece but the import, and doctor passes with no commits yet', () => {
    const root = linkPackage(fresh()); // the package, as a workspace link installs it
    const { code, rows } = init(root);
    expect(code).toBe(0);
    expect(Object.fromEntries(Object.entries(rows).map(([t, r]) => [t, r.action]))).toEqual({
      'cookwright.json': 'wrote',
      'docs/backlog.md': 'wrote',
      'docs/closeouts/': 'wrote',
      'CHANGELOG.md': 'wrote',
      'AGENTS.md': 'wrote',
      'CLAUDE.md': 'skipped',
      '.claude/settings.json': 'wrote',
      ...Object.fromEntries(POINTERS.map(({ rel }) => [rel, 'wrote'])),
      '.gitignore': 'wrote',
      'hooks.path': 'wrote',
      '.githooks/pre-commit': 'wrote',
      '.githooks/pre-push': 'wrote',
    });
    expect(POINTERS.map(({ rel }) => rel)).toEqual(
      expect.arrayContaining(['.claude/skills/bundle', '.claude/workflows/bundle-phase.js', '.claude/workflows/docs-audit.js']),
    );
    for (const { rel, text } of POINTERS) {
      expect(fs.readlinkSync(path.join(root, rel))).toBe(text);
      expect(rows[rel].note).toBe(m.pointers.wrote(text));
      expect(fs.existsSync(path.join(root, rel))).toBe(true); // it resolves
    }
    expect(rows['CLAUDE.md'].note).toBe(m.hostRules.native('2.1.281'));
    expect(hooksPath(root)).toBe('.githooks');
    for (const name of ['pre-commit', 'pre-push']) {
      expect(read(root, `.githooks/${name}`)).toBe(shimText(name));
      expect(executable(root, `.githooks/${name}`)).toBe(true);
    }
    expect(read(root, 'docs/backlog.md')).toBe(template('backlog.md'));
    expect(read(root, 'CHANGELOG.md')).toBe(template('CHANGELOG.md'));
    expect(read(root, 'docs/closeouts/.gitkeep')).toBe('');
    expect(read(root, 'AGENTS.md')).toBe(`${BLOCK}\n`);
    // node_modules is in info/exclude here (linkPackage), so only the env patterns are written.
    expect(read(root, '.gitignore')).toBe('.env\n.env.*\n!.env.example\n');
    expect(exists(root, 'CLAUDE.md')).toBe(false);
    const config = JSON.parse(read(root, 'cookwright.json'));
    expect(config).toMatchObject({ version: CONFIG_VERSION, level: 0, hosts: ['claude'], baseBranch: 'main' });
    expect(config.paths).toEqual(DEFAULTS.paths);
    expect(config.gate).toEqual({ checks: [] });
    expect(config.hooks).toEqual({ docSync: [] });
    const hook = JSON.parse(read(root, '.claude/settings.json')).hooks.SessionStart;
    expect(hook).toEqual([{ hooks: [{ type: 'command', command: HOOK_COMMAND, timeout: 10 }] }]);
    expect(out).toContain(`PASS  ${'git'.padEnd(WIDTH)}  ${messages.doctor.git.unborn('main')}`);
    // No test script, so no gate check: the one WARN, pre-push running nothing (B-012).
    expect(out).toContain(`${N} checks — ${N - 1} PASS, 0 FAIL, 1 WARN, 0 SKIP`);
    expect(out.filter((l) => /^(FAIL|WARN|SKIP) /.test(l))).toEqual([GATE_WARN]);
    expect(out).toContain('level 0 declared: complete; weak: gate.scripts');
  });

  it('changes no byte on a second run, and reports no wrote or updated row', () => {
    const root = fresh();
    init(root);
    commit({ root }, {}, 'first run');
    const before = tree(root);
    const second = init(root);
    expect(second.code).toBe(0);
    expect(second.actions.filter((a) => a === 'wrote' || a === 'updated')).toEqual([]);
    expect(tree(root)).toEqual(before);
    expect(run(root, 'git', ['status', '--porcelain'])).toBe('');
  });

  it('detects the hook by HOOK_COMMAND, not by its text', () => {
    const root = fresh();
    init(root);
    const file = '.claude/settings.json';
    const settings = JSON.parse(read(root, file));
    const reworded = HOOK_COMMAND.replace(HOOK_LINES.notInstalled, 'not installed, reworded');
    settings.hooks.SessionStart.push({ hooks: [{ type: 'command', command: reworded }] });
    write(root, file, `${JSON.stringify(settings, null, 2)}\n`);
    const before = tree(root);
    expect(init(root).rows[file].action).toBe('kept');
    expect(tree(root)).toEqual(before);
  });

  it('--dry-run prints the report, writes nothing and skips doctor', () => {
    const root = fresh();
    const { code, rows } = init(root, ['--dry-run']);
    expect(code).toBe(0);
    expect(rows['AGENTS.md'].action).toBe('wrote');
    expect(out).toContain(m.dryFooter);
    expect(out.some((l) => /^PASS /.test(l))).toBe(false);
    expect(tree(root)).toEqual({});
    expect(rows['hooks.path'].action).toBe('wrote');
    expect(hooksPath(root)).toBe(null);
  });

  it('runs from a subdirectory and writes at the work tree top', () => {
    const root = fresh();
    fs.mkdirSync(path.join(root, 'apps/mobile'), { recursive: true });
    expect(init(path.join(root, 'apps/mobile')).code).toBe(0);
    expect(exists(root, 'cookwright.json')).toBe(true);
    expect(exists(root, 'apps/mobile/cookwright.json')).toBe(false);
  });
});

describe('refusals', () => {
  it('refuses outside a git work tree', () => {
    const dir = path.join(TMP, 'not-a-repo');
    fs.mkdirSync(dir);
    expect(init(dir).code).toBe(2);
    expect(err[0]).toBe(m.refused(m.notWorkTree(dir)));
    expect(tree(dir)).toEqual({});
  });

  it('refuses an unknown flag or a positional with the usage, and names bundle init for --plan', () => {
    const root = fresh();
    expect(init(root, ['--bogus']).code).toBe(2);
    expect(err).toEqual([m.refused(messages.unknownFlag('bogus', ['base', 'hosts', 'packs', 'dry-run'])), m.usage]);
    expect(init(root, ['now']).code).toBe(2);
    expect(err).toEqual([m.refused(m.usage)]);
    expect(init(root, ['--plan', 'plan.md']).code).toBe(2);
    expect(err[0]).toBe(m.refused(m.bundleFlag('plan')));
    expect(init(root, ['--split', 's.json']).code).toBe(2);
    expect(err[0]).toMatch(/bundle init/);
    expect(init(root, ['--dry-run', 'yes']).code).toBe(2);
    expect(tree(root)).toEqual({});
  });

  it('refuses a malformed block before any write: the whole tree is untouched', () => {
    const root = fresh();
    write(root, 'AGENTS.md', '# Mine\n\n<!-- cookwright:begin rules v1 -->\nno end\n');
    const before = tree(root);
    expect(init(root).code).toBe(2);
    expect(err[0]).toBe(m.refused(messages.doctor.block.malformed('AGENTS.md', 'noEnd')));
    expect(tree(root)).toEqual(before);
  });

  it('refuses unparseable settings before any write', () => {
    const root = fresh();
    write(root, '.claude/settings.json', '{ "hooks": ');
    const before = tree(root);
    expect(init(root).code).toBe(2);
    expect(err[0]).toMatch(/^init: \.claude\/settings\.json is not valid JSON/);
    expect(tree(root)).toEqual(before);
  });

  it('refuses settings whose SessionStart is not a list', () => {
    const root = fresh();
    write(root, '.claude/settings.json', '{ "hooks": { "SessionStart": {} } }\n');
    expect(init(root).code).toBe(2);
    expect(err[0]).toBe(m.refused(m.settingsShape('.claude/settings.json', 'hooks.SessionStart')));
  });

  it('refuses an invalid existing config with the loader message, before any write', () => {
    const root = fresh();
    write(root, 'cookwright.json', '{ "version": 2, "hosts": ["gemini"] }');
    const before = tree(root);
    expect(init(root).code).toBe(2);
    expect(err[0]).toMatch(/host "gemini" is not available in this version of cookwright/);
    expect(tree(root)).toEqual(before);
  });

  it('refuses a --base git would not take as a branch name, before any write', () => {
    for (const base of ['', '  ', 'a b', 'x..y']) {
      const root = fresh();
      expect(init(root, ['--base', base]).code).toBe(2);
      expect(err[0]).toBe(m.refused(m.badBase(base)));
      expect(tree(root)).toEqual({});
    }
  });

  it('refuses when the ignore probe errors, before any write', () => {
    const root = fresh();
    const ignored = () => {
      throw new Error(messages.probeFailed('git check-ignore .env', 'fatal: boom'));
    };
    expect(init(root, [], { probes: { ignored } }).code).toBe(2);
    expect(err[0]).toBe(m.refused(messages.probeFailed('git check-ignore .env', 'fatal: boom')));
    expect(tree(root)).toEqual({});
  });
});

describe('cookwright.json', () => {
  it('keeps a version-1 config byte for byte, migrated in memory, naming migrate', () => {
    const root = fresh();
    const text = '{"version":1,"paths":{"playbook":"docs/playbook.md"}}';
    write(root, 'cookwright.json', text);
    const { code, rows } = init(root);
    expect(code).toBe(0);
    expect(rows['cookwright.json']).toEqual({ action: 'kept', note: m.config.migrated(1, CONFIG_VERSION) });
    expect(m.config.migrated(1, 2)).toBe('version 1, migrated in memory; run npx cookwright migrate to write version 2');
    expect(read(root, 'cookwright.json')).toBe(text);
    expect(exists(root, 'docs/playbook.md')).toBe(false);
  });

  it('keeps an existing config byte for byte, even without level', () => {
    const root = fresh();
    const text = '{"version":3,"paths":{"backlog":"notes/todo/backlog.md"}}';
    write(root, 'cookwright.json', text);
    const { rows } = init(root);
    expect(rows['cookwright.json']).toEqual({ action: 'kept', note: m.config.kept(0) });
    expect(read(root, 'cookwright.json')).toBe(text);
    // paths.backlog in a directory that did not exist yet
    expect(rows['notes/todo/backlog.md'].action).toBe('wrote');
    expect(read(root, 'notes/todo/backlog.md')).toBe(template('backlog.md'));
  });

  const baseOf = (root, argv = []) => {
    init(root, [...argv, '--dry-run']);
    return /baseBranch (\S+);/.exec(out.find((l) => l.startsWith('wrote    cookwright.json')))[1];
  };

  it('takes baseBranch from --base, main, master, the checked-out branch, then main', () => {
    const a = fresh();
    expect(baseOf(a, ['--base', 'develop'])).toBe('develop');
    const b = fresh();
    commit({ root: b }, { 'x.txt': 'x' }, 'x');
    run(b, 'git', ['checkout', '-q', '-b', 'feature']);
    expect(baseOf(b)).toBe('main');
    const c = gitInit(path.join(TMP, 'master-repo'));
    run(c, 'git', ['checkout', '-q', '-b', 'master']);
    commit({ root: c }, { 'x.txt': 'x' }, 'x');
    run(c, 'git', ['checkout', '-q', '-b', 'feature']);
    expect(baseOf(c)).toBe('master');
    const d = gitInit(path.join(TMP, 'trunk-repo'));
    run(d, 'git', ['checkout', '-q', '-b', 'trunk']); // unborn
    expect(baseOf(d)).toBe('trunk');
    commit({ root: d }, { 'x.txt': 'x' }, 'x');
    run(d, 'git', ['checkout', '-q', '--detach']);
    expect(baseOf(d)).toBe('main');
  });

  it('gates on npm test only when the test script exits', () => {
    const gate = (script) => {
      const root = fresh();
      write(root, 'package.json', JSON.stringify({ scripts: script ? { test: script } : {} }));
      init(root, ['--dry-run']);
      return out.find((l) => l.startsWith('wrote    cookwright.json'));
    };
    expect(gate('vitest run')).toMatch(/gate: npm test$/);
    expect(gate('jest --watchAll=false')).toMatch(/gate: npm test$/);
    expect(gate('echo "Error: no test specified" && exit 1')).toContain(m.config.gateNone(m.config.placeholder));
    expect(gate('jest --watchAll')).toContain(m.config.gateNone(m.config.watch));
    expect(gate(null)).toContain(m.config.gateNone(m.config.noTestScript));
    const root = fresh();
    write(root, 'package.json', JSON.stringify({ scripts: { test: 'vitest run' } }));
    init(root);
    expect(JSON.parse(read(root, 'cookwright.json')).gate.checks).toEqual([{ name: 'test', run: 'npm test' }]);
  });
});

describe('cookwright.json: a fresh config’s packs, doc-sync rules and gate checks', () => {
  const RATCHET = { name: 'standards', run: 'npx cookwright standards --ratchet', skipExit: 11 };
  const TYPES = { name: 'standards:types', run: 'npx cookwright standards --types', skipExit: 11 };
  const DESIGN_DOC = { name: 'expo:design-doc', code: ['src/components/**', 'components/**', ':!**/*.test.*'], docs: ['docs/design-system.md'] };
  const DATA_DOC = { name: 'supabase:data-doc', code: ['supabase/migrations/**'], docs: ['docs/data-model.md'] };
  const fresh3 = (names, pkg) => {
    const root = fresh();
    if (pkg) write(root, 'package.json', JSON.stringify(pkg));
    return freshConfig(root, undefined, ['claude'], { names, note: 'packs: chosen' });
  };

  it('declares the packs and writes each one’s doc-sync rule and gate checks after npm test, valid as written', () => {
    const { raw, note } = fresh3(['expo', 'supabase'], { scripts: { test: 'vitest run' } });
    expect(raw.packs).toEqual(['expo', 'supabase']);
    expect(Object.keys(raw)).toEqual(['$schema', 'version', 'level', 'hosts', 'packs', 'baseBranch', 'paths', 'gate', 'hooks']);
    expect(raw.hooks.docSync).toEqual([DESIGN_DOC, DATA_DOC]);
    expect(raw.gate.checks).toEqual([{ name: 'test', run: 'npm test' }, RATCHET, TYPES]);
    expect(RATCHET_CHECK).toEqual(RATCHET);
    expect(validateConfig(withDefaults(raw))).toEqual([]);
    expect(note).toBe(m.config.wrote('main', 'packs: chosen', m.config.gateRuns(['npm test', RATCHET.run, TYPES.run])));
    expect(note).toBe('baseBranch main; packs: chosen; gate: npm test, npx cookwright standards --ratchet, npx cookwright standards --types');
  });

  it('writes the ratchet once for one pack or two, and the types check only with supabase', () => {
    expect(fresh3(['expo']).raw.gate.checks).toEqual([RATCHET]);
    expect(fresh3(['expo']).raw.hooks.docSync).toEqual([DESIGN_DOC]);
    expect(fresh3(['supabase']).raw.gate.checks).toEqual([RATCHET, TYPES]);
    expect(fresh3(['supabase', 'expo']).raw.hooks.docSync).toEqual([DATA_DOC, DESIGN_DOC]);
  });

  it('says why npm test is not in a gate the packs fill, and writes an empty packs list with none', () => {
    expect(fresh3(['expo']).note).toBe(
      `baseBranch main; packs: chosen; gate: ${RATCHET.run}; no npm test (${m.config.noPackage})`,
    );
    const none = freshConfig(fresh(), undefined, ['claude'], NO_PACKS);
    expect(none.raw.packs).toEqual([]);
    expect(none.raw.gate.checks).toEqual([]);
    expect(none.raw.hooks.docSync).toEqual([]);
    expect(none.note).toBe(`baseBranch main; ${m.config.packsNone}; ${m.config.gateNone(m.config.noPackage)}`);
  });
});

describe('cookwright.json: pack detection and --packs', () => {
  const EXPO_APP = { dependencies: { expo: '~58.0.0' } };
  const configOf = (root) => JSON.parse(read(root, 'cookwright.json'));

  it('declares the packs the tree shows on a fresh config, writing their sections and docs, then changes no byte', () => {
    const root = fresh();
    write(root, 'package.json', JSON.stringify(EXPO_APP));
    write(root, 'supabase/config.toml', 'project_id = "app"\n');
    const { code, rows } = init(root);
    expect(code).toBe(0);
    expect(rows['cookwright.json'].note).toContain(
      'packs: expo (package.json depends on expo), supabase (supabase/config.toml exists)',
    );
    expect(configOf(root).packs).toEqual(['expo', 'supabase']);
    for (const target of ['AGENTS.md#expo', 'AGENTS.md#supabase', 'docs/design-system.md', 'docs/data-model.md']) {
      expect([target, rows[target]?.action]).toEqual([target, 'wrote']);
    }
    commit({ root }, {}, 'init');
    const before = tree(root);
    expect(init(root).actions.filter((a) => a === 'wrote' || a === 'updated')).toEqual([]);
    expect(tree(root)).toEqual(before);
  });

  it('takes --packs over detection on a fresh config, an empty list included', () => {
    const a = fresh();
    write(a, 'package.json', JSON.stringify(EXPO_APP));
    expect(init(a, ['--packs', 'supabase']).rows['cookwright.json'].note).toContain(m.config.packsFlag(['supabase']));
    expect(configOf(a).packs).toEqual(['supabase']);
    expect(exists(a, 'docs/design-system.md')).toBe(false);
    const b = fresh();
    write(b, 'package.json', JSON.stringify(EXPO_APP));
    init(b, ['--packs', ',']);
    expect(configOf(b).packs).toEqual([]);
    expect(m.config.packsFlag([])).toBe('packs: none (--packs)');
    const c = fresh();
    expect(init(c).rows['cookwright.json'].note).toContain(m.config.packsNone);
  });

  it('refuses --packs on an existing config, and never detects into one', () => {
    const root = fresh();
    write(root, 'package.json', JSON.stringify(EXPO_APP));
    write(root, 'cookwright.json', JSON.stringify({ version: CONFIG_VERSION }));
    const before = tree(root);
    expect(init(root, ['--packs', 'expo']).code).toBe(2);
    expect(err).toEqual([m.refused(m.config.existing('packs', 'packs'))]);
    expect(tree(root)).toEqual(before);
    const { rows } = init(root);
    expect(rows['cookwright.json'].action).toBe('kept');
    expect(Object.keys(rows).filter((t) => t.startsWith('AGENTS.md#') || t === 'docs/design-system.md')).toEqual([]);
    expect(read(root, 'cookwright.json')).toBe(before['cookwright.json']);
  });

  it('refuses an unknown or repeated pack on a fresh config, before any write', () => {
    const root = fresh();
    expect(init(root, ['--packs', 'expo,flutter']).code).toBe(2);
    expect(err[0]).toMatch(/flutter/);
    expect(init(root, ['--packs', 'expo,expo']).code).toBe(2);
    expect(err[0]).toMatch(/each pack once/);
    expect(tree(root)).toEqual({});
  });
});

describe('state homes', () => {
  it('adds a .gitkeep to an existing empty closeouts directory', () => {
    const root = fresh();
    fs.mkdirSync(path.join(root, 'docs/closeouts'), { recursive: true });
    expect(init(root).rows['docs/closeouts/']).toEqual({ action: 'updated', note: m.homes.emptyDir });
    expect(exists(root, 'docs/closeouts/.gitkeep')).toBe(true);
  });

  it('adds a .gitkeep when the closeouts directory holds only ignored files, once', () => {
    const root = fresh();
    write(root, '.gitignore', '.DS_Store\n');
    write(root, 'docs/closeouts/.DS_Store', 'x');
    expect(init(root).rows['docs/closeouts/']).toEqual({ action: 'updated', note: m.homes.emptyDir });
    expect(exists(root, 'docs/closeouts/.gitkeep')).toBe(true);
    expect(init(root).rows['docs/closeouts/'].action).toBe('kept');
  });

  it('keeps homes that exist, whatever they hold', () => {
    const root = fresh();
    write(root, 'docs/backlog.md', '# mine\n');
    write(root, 'docs/closeouts/one.md', 'x');
    write(root, 'CHANGELOG.md', '# mine\n');
    const { rows } = init(root);
    expect([rows['docs/backlog.md'].action, rows['docs/closeouts/'].action, rows['CHANGELOG.md'].action]).toEqual([
      'kept',
      'kept',
      'kept',
    ]);
    expect(read(root, 'docs/backlog.md')).toBe('# mine\n');
    expect(exists(root, 'docs/closeouts/.gitkeep')).toBe(false);
  });
});

describe('the rules block', () => {
  it('appends the block after one blank line, the original text intact', () => {
    const a = fresh();
    write(a, 'AGENTS.md', '# Mine\n\n- a rule\n');
    expect(init(a).rows['AGENTS.md'].action).toBe('updated');
    expect(read(a, 'AGENTS.md')).toBe(`# Mine\n\n- a rule\n\n${BLOCK}\n`);
    const b = fresh();
    write(b, 'AGENTS.md', '# Mine\n- a rule');
    init(b);
    expect(read(b, 'AGENTS.md')).toBe(`# Mine\n- a rule\n\n${BLOCK}\n`);
    expect(init(b).rows['AGENTS.md'].action).toBe('kept');
  });

  it('refreshes a stale block, the text outside the markers byte-identical', () => {
    const root = fresh();
    const stale = BLOCK.replace('Ask before adding a dependency.', 'An older rule.');
    write(root, 'AGENTS.md', `above\n\n${stale}\nbelow, with an <!-- cookwright:end --> mention\n`);
    expect(init(root).rows['AGENTS.md'].action).toBe('updated');
    expect(read(root, 'AGENTS.md')).toBe(`above\n\n${BLOCK}\nbelow, with an <!-- cookwright:end --> mention\n`);
  });

  it.each([
    ['v1', v1Block],
    ['v2', v2Block],
  ])('refreshes a %s block to v3, the text outside the markers byte-identical', (_, older) => {
    const root = fresh();
    const above = '# My rules\n\n- mine, with a `<!-- cookwright:end -->` mention\n\n';
    const below = '\n## More of mine\n\nThe Unreleased section is history.\n';
    write(root, 'AGENTS.md', `${above}${older(BLOCK)}\n${below}`);
    expect(init(root).rows['AGENTS.md']).toEqual({ action: 'updated', note: m.block.refreshed(3) });
    expect(read(root, 'AGENTS.md')).toBe(`${above}${BLOCK}\n${below}`);
    expect(BLOCK).toContain('COOKWRIGHT_SKIP=doc-sync git commit');
    expect(BLOCK).toContain('the `setup` skill walks doctor');
    expect(init(root).rows['AGENTS.md'].action).toBe('kept');
  });

  it('keeps a CRLF file CRLF, and a second run keeps it', () => {
    const root = fresh();
    const crlf = (s) => s.replace(/\n/g, '\r\n');
    const stale = BLOCK.replace('Ask before adding a dependency.', 'An older rule.');
    write(root, 'AGENTS.md', crlf(`above\n\n${stale}\nbelow\n`));
    init(root);
    expect(read(root, 'AGENTS.md')).toBe(crlf(`above\n\n${BLOCK}\nbelow\n`));
    expect(init(root).rows['AGENTS.md'].action).toBe('kept');
  });

  it('leaves a newer block alone', () => {
    const root = fresh();
    const newer = BLOCK.replace(beginMarker(), beginMarker(RULES_VERSION + 7));
    write(root, 'AGENTS.md', `${newer}\n`);
    expect(init(root).rows['AGENTS.md']).toEqual({ action: 'kept', note: m.block.newer(RULES_VERSION + 7) });
    expect(read(root, 'AGENTS.md')).toBe(`${newer}\n`);
  });
});

describe('stack packs: the sections of AGENTS.md and the contract docs', () => {
  const EXPO = renderSection(PACKS.expo);
  const SUPABASE = renderSection(PACKS.supabase);
  const PKG = path.dirname(new URL(import.meta.url).pathname).replace(/\/src$/, '');
  const packTemplate = (name, rel) => fs.readFileSync(path.join(PKG, 'packs', name, rel), 'utf8');
  /** A repo with a version-3 config declaring `packs`. */
  const withPacks = (packs, files = {}) => {
    const root = fresh();
    write(root, 'cookwright.json', JSON.stringify({ version: 3, packs }));
    for (const [rel, body] of Object.entries(files)) write(root, rel, body);
    return root;
  };

  it('writes the core block and both sections in one file, then keeps every byte on a rerun', () => {
    const root = withPacks(['expo', 'supabase']);
    const { code, rows } = init(root);
    expect(code).toBe(0);
    expect(rows['AGENTS.md']).toEqual({ action: 'wrote', note: m.block.wrote });
    expect(rows['AGENTS.md#expo']).toEqual({ action: 'wrote', note: m.pack.section.wrote('expo') });
    expect(rows['AGENTS.md#supabase']).toEqual({ action: 'wrote', note: m.pack.section.wrote('supabase') });
    expect(read(root, 'AGENTS.md')).toBe(`${BLOCK}\n\n${EXPO}\n\n${SUPABASE}\n`);
    const before = tree(root);
    const second = init(root);
    expect([second.rows['AGENTS.md'], second.rows['AGENTS.md#expo'], second.rows['AGENTS.md#supabase']]).toEqual([
      { action: 'kept', note: m.block.current },
      { action: 'kept', note: m.pack.section.current('expo') },
      { action: 'kept', note: m.pack.section.current('supabase') },
    ]);
    expect(tree(root)).toEqual(before);
  });

  it('adds a section right after the managed blocks, the user text around them intact', () => {
    const root = withPacks(['expo'], { 'AGENTS.md': `# Mine\n\n${BLOCK}\n## Below\n- mine\n` });
    const { rows } = init(root);
    expect(rows['AGENTS.md'].action).toBe('kept');
    expect(rows['AGENTS.md#expo']).toEqual({ action: 'updated', note: m.pack.section.appended('expo') });
    expect(read(root, 'AGENTS.md')).toBe(`# Mine\n\n${BLOCK}\n\n${EXPO}\n\n## Below\n- mine\n`);
    // a second pack declared later goes after the first one's section
    write(root, 'cookwright.json', JSON.stringify({ version: 3, packs: ['expo', 'supabase'] }));
    expect(init(root).rows['AGENTS.md#supabase'].action).toBe('updated');
    expect(read(root, 'AGENTS.md')).toBe(`# Mine\n\n${BLOCK}\n\n${EXPO}\n\n${SUPABASE}\n\n## Below\n- mine\n`);
    expect(init(root).actions.filter((a) => a !== 'kept' && a !== 'skipped')).toEqual([]);
  });

  it('refreshes a stale core block and a stale section in one pass, both kept on a rerun', () => {
    const staleCore = BLOCK.replace('Ask before adding a dependency.', 'An older rule.');
    const staleExpo = EXPO.replace(beginMarker(1, packKind('expo')), beginMarker(0, packKind('expo')));
    const root = withPacks([{ name: 'expo', rules: { size: false } }], {
      'AGENTS.md': `above\n\n${staleCore}\nmiddle\n\n${staleExpo}\nbelow\n`,
    });
    const { rows } = init(root);
    const off = renderSection(PACKS.expo, new Set(['size']));
    expect(rows['AGENTS.md']).toEqual({ action: 'updated', note: m.block.refreshed(RULES_VERSION) });
    expect(rows['AGENTS.md#expo']).toEqual({ action: 'updated', note: m.pack.section.refreshed('expo', 1) });
    expect(read(root, 'AGENTS.md')).toBe(`above\n\n${BLOCK}\nmiddle\n\n${off}\nbelow\n`);
    expect(off).toContain('(switched off).');
    expect(init(root).rows['AGENTS.md#expo'].action).toBe('kept');
  });

  it('keeps a CRLF file CRLF when it adds a section', () => {
    const crlf = (t) => t.replace(/\n/g, '\r\n');
    const root = withPacks(['supabase'], { 'AGENTS.md': crlf(`above\n\n${BLOCK}\n`) });
    init(root);
    expect(read(root, 'AGENTS.md')).toBe(crlf(`above\n\n${BLOCK}\n\n${SUPABASE}\n`));
    expect(init(root).rows['AGENTS.md#supabase'].action).toBe('kept');
  });

  it('leaves a newer section alone and refuses a malformed one before any write', () => {
    const newer = EXPO.replace(beginMarker(1, packKind('expo')), beginMarker(9, packKind('expo')));
    const a = withPacks(['expo'], { 'AGENTS.md': `${BLOCK}\n\n${newer}\n` });
    expect(init(a).rows['AGENTS.md#expo']).toEqual({ action: 'kept', note: m.pack.section.newer('expo', 9) });
    expect(read(a, 'AGENTS.md')).toBe(`${BLOCK}\n\n${newer}\n`);
    const b = withPacks(['expo'], { 'AGENTS.md': `${BLOCK}\n\n${beginMarker(1, packKind('expo'))}\n- half a section\n` });
    const before = tree(b);
    expect(init(b).code).toBe(2);
    expect(err.join('\n')).toContain(m.pack.section.malformed('AGENTS.md', 'expo', 'noEnd'));
    expect(tree(b)).toEqual(before);
  });

  it('writes no section and no doc when no pack is declared', () => {
    const root = withPacks([]);
    const { rows } = init(root);
    expect(Object.keys(rows).filter((t) => t.startsWith('AGENTS.md#') || t.startsWith('docs/d'))).toEqual([]);
    expect(read(root, 'AGENTS.md')).toBe(`${BLOCK}\n`);
  });

  it('writes each declared pack’s contract doc from its template, and keeps one that exists', () => {
    const root = withPacks(['expo', 'supabase'], { 'docs/data-model.md': '# mine\n' });
    const { rows } = init(root);
    expect(rows['docs/design-system.md']).toEqual({ action: 'wrote', note: m.pack.doc.template('expo') });
    expect(rows['docs/data-model.md']).toEqual({ action: 'kept', note: m.pack.doc.present('supabase') });
    expect(read(root, 'docs/design-system.md')).toBe(packTemplate('expo', 'templates/design-system.md'));
    expect(read(root, 'docs/data-model.md')).toBe('# mine\n');
    expect(read(root, 'docs/design-system.md')).toMatch(/^\| Primitive \| File \| Props \| Notes \|$/m);
    const supabase = packTemplate('supabase', 'templates/data-model.md');
    for (const header of ['| Migration | Tables and RPCs touched | Summary |', '| Table | Purpose | RLS |', '| RPC | Signature | Purpose |']) {
      expect(supabase.split('\n')).toContain(header);
    }
    expect(init(root).rows['docs/design-system.md'].action).toBe('kept');
  });
});

describe('stack packs: eslint.config.js and the pack dependencies', () => {
  const PKG = path.dirname(new URL(import.meta.url).pathname).replace(/\/src$/, '');
  const EXPO_TEMPLATE = fs.readFileSync(path.join(PKG, 'src/lib/templates/eslint.config.js'), 'utf8');
  const EXPO_LINE = "  ...require('cookwright/packs/expo/eslint.cjs'),";
  const SUPABASE_LINE = "  ...require('cookwright/packs/supabase/eslint.cjs'),";
  const wired = (...lines) => EXPO_TEMPLATE.replace('  expoConfig,\n', `  expoConfig,\n${lines.map((l) => `${l}\n`).join('')}`);
  const withPacks = (packs, files = {}) => {
    const root = fresh();
    write(root, 'cookwright.json', JSON.stringify({ version: 3, packs }));
    for (const [rel, body] of Object.entries(files)) write(root, rel, body);
    return root;
  };

  it('is the template the overlay supplies and npx expo lint writes', () => {
    expect(fs.readFileSync(path.join(PKG, '../../fixtures/expo-overlay/eslint.config.js'), 'utf8')).toBe(EXPO_TEMPLATE);
    expect(EXPO_TEMPLATE.split('\n')).toEqual([
      '// https://docs.expo.dev/guides/using-eslint/',
      "const { defineConfig } = require('eslint/config');",
      "const expoConfig = require('eslint-config-expo/flat');",
      '',
      'module.exports = defineConfig([',
      '  expoConfig,',
      '  {',
      "    ignores: ['dist/*'],",
      '  },',
      ']);',
      '',
    ]);
  });

  it('spreads both packs’ exports after expoConfig in one transform, byte for byte, then keeps it', () => {
    const root = withPacks(['expo', 'supabase'], { 'eslint.config.js': EXPO_TEMPLATE });
    const exports = ['cookwright/packs/expo/eslint.cjs', 'cookwright/packs/supabase/eslint.cjs'];
    expect(init(root).rows['eslint.config.js']).toEqual({ action: 'updated', note: m.pack.eslint.added(exports) });
    expect(read(root, 'eslint.config.js')).toBe(wired(EXPO_LINE, SUPABASE_LINE));
    expect(read(root, 'eslint.config.js')).toBe(`// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  ...require('cookwright/packs/expo/eslint.cjs'),
  ...require('cookwright/packs/supabase/eslint.cjs'),
  {
    ignores: ['dist/*'],
  },
]);
`);
    const before = tree(root);
    expect(init(root).rows['eslint.config.js']).toEqual({ action: 'kept', note: m.pack.eslint.names(exports) });
    expect(tree(root)).toEqual(before);
  });

  it('adds the second pack’s line once it is declared, in the config’s order, and keeps CRLF', () => {
    const crlf = (t) => t.replace(/\n/g, '\r\n');
    const root = withPacks(['supabase'], { 'eslint.config.js': crlf(EXPO_TEMPLATE) });
    init(root);
    expect(read(root, 'eslint.config.js')).toBe(crlf(wired(SUPABASE_LINE)));
    write(root, 'cookwright.json', JSON.stringify({ version: 3, packs: ['supabase', 'expo'] }));
    expect(init(root).rows['eslint.config.js'].action).toBe('updated');
    expect(read(root, 'eslint.config.js')).toBe(crlf(wired(SUPABASE_LINE, EXPO_LINE)));
  });

  it('leaves any other config alone, naming the lines, and keeps one that already names the exports', () => {
    const mine = EXPO_TEMPLATE.replace("'dist/*'", "'dist/*', 'build/*'");
    const a = withPacks(['expo', 'supabase'], { 'eslint.config.js': mine });
    expect(init(a).rows['eslint.config.js']).toEqual({
      action: 'skipped',
      note: m.pack.eslint.other([EXPO_LINE.trim(), SUPABASE_LINE.trim()]),
    });
    expect(read(a, 'eslint.config.js')).toBe(mine);
    const handWired = `${mine}// mine\nmodule.exports.push(...require('cookwright/packs/expo/eslint.cjs'));\n`;
    const b = withPacks(['expo'], { 'eslint.config.mjs': handWired });
    expect(init(b).rows['eslint.config.mjs']).toEqual({
      action: 'kept',
      note: m.pack.eslint.names(['cookwright/packs/expo/eslint.cjs']),
    });
  });

  it('names the setup line of the first pack when there is no ESLint config, and writes none', () => {
    const a = withPacks(['expo', 'supabase']);
    expect(init(a).rows['eslint.config.js']).toEqual({ action: 'skipped', note: m.pack.eslint.none('npx expo lint') });
    expect(exists(a, 'eslint.config.js')).toBe(false);
    const b = withPacks(['supabase']);
    expect(init(b).rows['eslint.config.js'].note).toBe('no ESLint config; npm install --save-dev eslint sets ESLint up, then rerun init');
    expect(init(withPacks([])).rows['eslint.config.js']).toBe(undefined);
  });

  it('names eslint-plugin-i18next until it is installed, never installing it, and not when strings is off', () => {
    const root = withPacks(['expo']);
    expect(init(root).rows['eslint-plugin-i18next']).toEqual({
      action: 'skipped',
      note: 'needs npm install --save-dev eslint-plugin-i18next (the strings rule)',
    });
    expect(exists(root, 'node_modules')).toBe(false);
    write(root, 'node_modules/eslint-plugin-i18next/package.json', '{"name":"eslint-plugin-i18next"}');
    expect(init(root).rows['eslint-plugin-i18next']).toEqual({ action: 'kept', note: m.pack.dep.installed('the strings rule') });
    const off = withPacks([{ name: 'expo', rules: { strings: false } }]);
    expect(init(off).rows['eslint-plugin-i18next']).toBe(undefined);
    expect(init(withPacks(['supabase'])).rows['eslint-plugin-i18next']).toBe(undefined);
  });
});

describe('host rules: the CLAUDE.md import', () => {
  const importRow = (root, opts) => init(root, [], opts).rows['CLAUDE.md'];

  it('prepends the import to a root CLAUDE.md once', () => {
    const root = fresh();
    write(root, 'CLAUDE.md', '# Mine\n\nUse `@AGENTS.md` in prose.\n');
    expect(importRow(root).action).toBe('updated');
    expect(read(root, 'CLAUDE.md')).toBe('@AGENTS.md\n\n# Mine\n\nUse `@AGENTS.md` in prose.\n');
    expect(importRow(root)).toEqual({ action: 'kept', note: m.hostRules.imports('@AGENTS.md') });
  });

  it('writes a CLAUDE.md holding only the import when something shadows AGENTS.md', () => {
    for (const shadow of ['.claude/CLAUDE.md', 'CLAUDE.local.md']) {
      const root = fresh();
      write(root, shadow, '# local\n');
      expect(importRow(root)).toEqual({ action: 'wrote', note: m.hostRules.shadowed('@AGENTS.md', [shadow]) });
      expect(read(root, 'CLAUDE.md')).toBe('@AGENTS.md\n');
      expect(read(root, shadow)).toBe('# local\n');
    }
  });

  it('writes the import for a CLAUDE.md in an ancestor directory', () => {
    const parent = path.join(TMP, 'ancestor');
    write(parent, 'CLAUDE.md', '# above\n');
    const root = fresh(parent);
    expect(importRow(root).note).toBe(m.hostRules.shadowed('@AGENTS.md', ['../CLAUDE.md']));
    expect(read(root, 'CLAUDE.md')).toBe('@AGENTS.md\n');
  });

  it('writes the import for a Claude Code older than 2.1.281, and only then', () => {
    const old = fresh();
    expect(importRow(old, { version: '2.1.280' })).toEqual({
      action: 'wrote',
      note: m.hostRules.old('@AGENTS.md', '2.1.280', '2.1.281'),
    });
    const none = fresh();
    expect(importRow(none, { version: null })).toEqual({ action: 'skipped', note: m.hostRules.noClaude });
    expect(exists(none, 'CLAUDE.md')).toBe(false);
  });
});

describe('host rules: a symlinked CLAUDE.md or AGENTS.md', () => {
  const link = (root, from, to) => fs.symlinkSync(to, path.join(root, from));
  const isLink = (root, rel) => fs.lstatSync(path.join(root, rel)).isSymbolicLink();

  it('keeps CLAUDE.md -> AGENTS.md and appends the block once, through no second write', () => {
    const root = fresh();
    write(root, 'AGENTS.md', '# Rules\n');
    link(root, 'CLAUDE.md', 'AGENTS.md');
    const first = init(root);
    expect(first.code).toBe(0);
    expect(first.rows['CLAUDE.md']).toEqual({ action: 'kept', note: m.hostRules.linked });
    expect(first.rows['AGENTS.md'].action).toBe('updated');
    expect(read(root, 'AGENTS.md')).toBe(`# Rules\n\n${BLOCK}\n`);
    expect(isLink(root, 'CLAUDE.md')).toBe(true);
    const second = init(root);
    expect(second.actions.filter((a) => a === 'wrote' || a === 'updated')).toEqual([]);
    expect(read(root, 'AGENTS.md')).toBe(`# Rules\n\n${BLOCK}\n`);
  });

  it('keeps a CLAUDE.md linked to an AGENTS.md init is about to write', () => {
    const root = fresh();
    link(root, 'CLAUDE.md', 'AGENTS.md');
    const { code, rows } = init(root);
    expect(code).toBe(0);
    expect([rows['AGENTS.md'].action, rows['CLAUDE.md']]).toEqual(['wrote', { action: 'kept', note: m.hostRules.linked }]);
    expect(read(root, 'CLAUDE.md')).toBe(`${BLOCK}\n`);
  });

  it('refuses to write through any other link, before any write', () => {
    const reverse = fresh();
    write(reverse, 'CLAUDE.md', '# Rules\n');
    link(reverse, 'AGENTS.md', 'CLAUDE.md');
    expect(init(reverse).code).toBe(2);
    expect(err[0]).toBe(m.refused(m.symlink('AGENTS.md')));
    expect(read(reverse, 'CLAUDE.md')).toBe('# Rules\n');
    expect(exists(reverse, 'cookwright.json')).toBe(false);

    const elsewhere = fresh();
    write(elsewhere, 'docs/claude.md', '# Mine\n');
    link(elsewhere, 'CLAUDE.md', 'docs/claude.md');
    const before = tree(elsewhere);
    expect(init(elsewhere).code).toBe(2);
    expect(err[0]).toBe(m.refused(m.symlink('CLAUDE.md')));
    expect(tree(elsewhere)).toEqual(before);
  });
});

describe('a symlinked parent directory', () => {
  const outside = () => fs.mkdtempSync(path.join(TMP, 'outside-'));

  it('refuses a write through a linked .claude or state-home directory, before any write', () => {
    const shared = outside();
    const claude = fresh();
    fs.symlinkSync(shared, path.join(claude, '.claude'));
    expect(init(claude).code).toBe(2);
    expect(err[0]).toBe(m.refused(m.symlink('.claude')));
    expect(fs.readdirSync(shared)).toEqual([]);
    expect(exists(claude, 'cookwright.json')).toBe(false);

    const docsDir = outside();
    const docs = fresh();
    fs.symlinkSync(docsDir, path.join(docs, 'docs'));
    expect(init(docs).code).toBe(2);
    expect(err[0]).toBe(m.refused(m.symlink('docs')));
    expect(fs.readdirSync(docsDir)).toEqual([]);
    expect(exists(docs, 'AGENTS.md')).toBe(false);
  });
});

describe('host hook: .claude/settings.json', () => {
  const FILE = '.claude/settings.json';
  const entry = { type: 'command', command: HOOK_COMMAND, timeout: 10 };

  it('merges into existing settings, the other hooks intact, the four-space indent kept', () => {
    const root = fresh();
    const settings = {
      permissions: { allow: ['Bash(npm test)'] },
      hooks: {
        SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'echo hi' }] }],
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'true' }] }],
      },
    };
    write(root, FILE, `${JSON.stringify(settings, null, 4)}\n`);
    expect(init(root).rows[FILE]).toEqual({ action: 'updated', note: m.hostHook.added });
    settings.hooks.SessionStart.push({ hooks: [entry] });
    expect(read(root, FILE)).toBe(`${JSON.stringify(settings, null, 4)}\n`);
    expect(init(root).rows[FILE].action).toBe('kept');
  });

  it('says so when merging rewrites the layout of the rest', () => {
    const root = fresh();
    const text = '{\n  "permissions": { "allow": ["Bash(npm test)", "Read"] }\n}\n';
    write(root, FILE, text);
    expect(init(root).rows[FILE]).toEqual({ action: 'updated', note: `${m.hostHook.added}${m.hostHook.relaid}` });
    expect(JSON.parse(read(root, FILE)).permissions).toEqual({ allow: ['Bash(npm test)', 'Read'] });
  });

  it('is not fooled by a command that mentions doctor', () => {
    const root = fresh();
    const settings = { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo "run cookwright doctor"' }] }] } };
    write(root, FILE, JSON.stringify(settings, null, 2));
    expect(init(root).rows[FILE].action).toBe('updated');
    expect(JSON.parse(read(root, FILE)).hooks.SessionStart).toHaveLength(2);
  });

  it('replaces an earlier version of the command in place', () => {
    const root = fresh();
    const past = { ...HOSTS.claude, hookCommandsPast: ['node old-doctor.mjs'] };
    const settings = { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node old-doctor.mjs' }] }] } };
    write(root, FILE, `${JSON.stringify(settings, null, 2)}\n`);
    const r = claudeHookStep({ root }, {}, past);
    expect([r.action, r.note]).toEqual(['updated', m.hostHook.replaced]);
    expect(JSON.parse(r.writes[0].content).hooks.SessionStart).toEqual([
      { hooks: [{ type: 'command', command: HOOK_COMMAND }] },
    ]);
  });
});

describe('.gitignore', () => {
  it('keeps a .gitignore that already covers .env*', () => {
    const root = fresh();
    write(root, '.gitignore', 'node_modules/\n.env*\n');
    expect(init(root).rows['.gitignore']).toEqual({ action: 'kept', note: m.gitignore.ignored });
    expect(read(root, '.gitignore')).toBe('node_modules/\n.env*\n');
  });

  it('appends the patterns when .env.local is not covered, a newline first if missing', () => {
    const root = fresh();
    write(root, '.gitignore', 'node_modules/\n.env');
    expect(init(root).rows['.gitignore'].action).toBe('updated');
    expect(read(root, '.gitignore')).toBe('node_modules/\n.env\n.env\n.env.*\n!.env.example\n');
    expect(init(root).rows['.gitignore'].action).toBe('kept');
  });

  it('appends the patterns after a later rule that overrides them, once', () => {
    const root = fresh();
    const text = 'node_modules/\n.env\n.env.*\n!.env.example\n!.env.local\n';
    write(root, '.gitignore', text);
    expect(init(root).rows['.gitignore']).toEqual({ action: 'updated', note: m.gitignore.appended(ENV_LINES) });
    expect(read(root, '.gitignore')).toBe(`${text}.env\n.env.*\n!.env.example\n`);
    expect(init(root).rows['.gitignore'].action).toBe('kept');
  });

  it('writes node_modules/ first into a bare repo’s new .gitignore (B-011)', () => {
    const root = fresh();
    expect(init(root).rows['.gitignore']).toEqual({ action: 'wrote', note: m.gitignore.wrote([NODE_MODULES_LINE, ...ENV_LINES]) });
    expect(read(root, '.gitignore')).toBe('node_modules/\n.env\n.env.*\n!.env.example\n');
    expect(init(root).rows['.gitignore']).toEqual({ action: 'kept', note: m.gitignore.ignored });
  });

  it('appends node_modules/ when git does not ignore it, alone or before the env patterns, once (B-011)', () => {
    const envOnly = fresh();
    write(envOnly, '.gitignore', '.env\n.env.*\n!.env.example\n');
    expect(init(envOnly).rows['.gitignore']).toEqual({ action: 'updated', note: m.gitignore.appended([NODE_MODULES_LINE]) });
    expect(read(envOnly, '.gitignore')).toBe('.env\n.env.*\n!.env.example\nnode_modules/\n');
    expect(init(envOnly).rows['.gitignore']).toEqual({ action: 'kept', note: m.gitignore.ignored });
    const neither = fresh();
    write(neither, '.gitignore', '.DS_Store\r\n');
    expect(init(neither).rows['.gitignore'].note).toBe('appended node_modules/, .env, .env.*, !.env.example');
    expect(read(neither, '.gitignore')).toBe('.DS_Store\r\nnode_modules/\r\n.env\r\n.env.*\r\n!.env.example\r\n');
    expect(init(neither).rows['.gitignore'].action).toBe('kept');
  });

  it('counts a node_modules rule that is not last, or a bare node_modules pattern, as covered', () => {
    const root = fresh();
    write(root, '.gitignore', 'node_modules\n.env*\n');
    expect(init(root).rows['.gitignore']).toEqual({ action: 'kept', note: m.gitignore.ignored });
    expect(m.gitignore.ignored).toBe('node_modules, .env and .env.local are ignored');
  });

  it('leaves the file alone when it ends with node_modules/ and git still does not ignore it', () => {
    const root = fresh();
    const text = '.env*\nnode_modules/\n';
    write(root, '.gitignore', text);
    const probes = { ignored: (_, p) => p !== NODE_MODULES_LINE };
    expect(init(root, [], { probes }).rows['.gitignore']).toEqual({ action: 'kept', note: m.gitignore.overridden([NODE_MODULES_LINE]) });
    expect(read(root, '.gitignore')).toBe(text);
  });

  it('leaves the file alone when it ends with the patterns and git still does not ignore', () => {
    const root = fresh();
    const text = 'node_modules/\n.env\n.env.*\n!.env.example\n';
    write(root, '.gitignore', text);
    const probes = { ignored: (_, p) => p !== '.env.local' };
    expect(init(root, [], { probes }).rows['.gitignore']).toEqual({ action: 'kept', note: m.gitignore.overridden(['.env.local']) });
    expect(read(root, '.gitignore')).toBe(text);
  });

  it('counts a tracked .env as covered by the rules', () => {
    const root = fresh();
    stageOnly(root, '.env');
    commit({ root }, { '.gitignore': 'node_modules/\n.env\n.env.*\n' }, 'oops');
    expect(init(root).rows['.gitignore'].action).toBe('kept');
  });
});

describe('git hooks', () => {
  const SHIMS = ['.githooks/pre-commit', '.githooks/pre-push'];
  const TARGETS = ['hooks.path', ...SHIMS];
  const f = messages.foreignHooks;
  const hookRows = (rows) => TARGETS.map((t) => rows[t]);
  const userHook = (root, body, mode = 0o755) => {
    write(root, '.githooks/pre-commit', body);
    fs.chmodSync(path.join(root, '.githooks/pre-commit'), mode);
  };

  it('keeps the shims and the path on a second run', () => {
    const root = fresh();
    init(root);
    const second = init(root);
    expect(hookRows(second.rows)).toEqual([
      { action: 'kept', note: m.hooks.pathKept('.githooks') },
      { action: 'kept', note: m.hooks.shimKept },
      { action: 'kept', note: m.hooks.shimKept },
    ]);
  });

  it('skips all three, writing nothing, when core.hooksPath is set elsewhere locally', () => {
    const cases = [
      ['.husky/_', '.husky/_'],
      [path.join(TMP, 'abs', '.githooks'), f.absolutePath],
      ['~/hooks', f.absolutePath],
      ['../shared/hooks', f.outsidePath],
    ];
    for (const [value, shown] of cases) {
      const root = fresh();
      run(root, 'git', ['config', '--local', 'core.hooksPath', value]);
      const { code, rows } = init(root);
      const note = f.path(shown, 'local');
      expect(note).not.toContain(TMP);
      expect(hookRows(rows)).toEqual(TARGETS.map(() => ({ action: 'skipped', note })));
      expect(exists(root, '.githooks')).toBe(false);
      expect(hooksPath(root)).toBe(value);
      expect(code).toBe(0); // a foreign setup is a WARN in doctor, never drift
    }
  });

  it('skips all three when core.hooksPath comes from the global config, naming the scope', () => {
    const root = fresh();
    const global = path.join(TMP, `global-${n}`);
    fs.writeFileSync(global, '[core]\n\thooksPath = .githooks\n');
    vi.stubEnv('GIT_CONFIG_GLOBAL', global);
    try {
      const { rows } = init(root);
      expect(hookRows(rows)).toEqual(TARGETS.map(() => ({ action: 'skipped', note: f.path('.githooks', 'global') })));
    } finally {
      vi.unstubAllEnvs();
    }
    expect(exists(root, '.githooks')).toBe(false);
  });

  it('installs the hooks on a git without --show-scope (before 2.26), and still names a global path', () => {
    vi.stubEnv('PATH', `${gitWithoutScopes(TMP)}${path.delimiter}${process.env.PATH}`);
    try {
      const root = fresh();
      const { code, rows } = init(root);
      expect(code).toBe(0);
      expect(rows['hooks.path']).toEqual({ action: 'wrote', note: m.hooks.pathSet('.githooks') });
      expect(hooksPath(root)).toBe('.githooks');
      expect(init(root).rows['hooks.path']).toEqual({ action: 'kept', note: m.hooks.pathKept('.githooks') });
      const global = path.join(TMP, `global-old-git-${n}`);
      fs.writeFileSync(global, '[core]\n\thooksPath = .githooks\n');
      vi.stubEnv('GIT_CONFIG_GLOBAL', global);
      const other = fresh();
      const note = f.path('.githooks', f.notLocal);
      expect(hookRows(init(other).rows)).toEqual(TARGETS.map(() => ({ action: 'skipped', note })));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('writes the shims at the work tree top when cookwright.json is below it, entering the config root', () => {
    const top = fresh();
    const app = path.join(top, 'apps/mobile');
    write(app, 'cookwright.json', JSON.stringify({ version: CONFIG_VERSION }));
    const nested = ['hooks.path', '../../.githooks/pre-commit', '../../.githooks/pre-push'];
    const first = init(app);
    expect(first.code).toBe(0);
    expect(nested.map((t) => first.rows[t].action)).toEqual(['wrote', 'wrote', 'wrote']);
    expect(read(top, '.githooks/pre-commit')).toBe(shimText('pre-commit', 'apps/mobile'));
    expect(read(top, '.githooks/pre-push')).toBe(shimText('pre-push', 'apps/mobile'));
    expect(exists(app, '.githooks')).toBe(false);
    expect(hooksPath(top)).toBe('.githooks');
    expect(nested.map((t) => init(app).rows[t].action)).toEqual(['kept', 'kept', 'kept']);
  });

  it('keeps a user’s hook at the top that enters the config root and calls cookwright', () => {
    const top = fresh();
    const app = path.join(top, 'apps/mobile');
    write(app, 'cookwright.json', JSON.stringify({ version: CONFIG_VERSION }));
    for (const line of [`cd apps/mobile && exec ${callLine('pre-commit')}`, `${callLine('pre-commit', 'apps/mobile')} || exit 1`]) {
      userHook(top, `#!/bin/sh\n${line}\n`);
      expect([line, init(app).rows['../../.githooks/pre-commit']]).toEqual([line, { action: 'kept', note: m.hooks.calls }]);
    }
    userHook(top, `#!/bin/sh\n${callLine('pre-commit')}\n`); // from the top: no config there
    const note = f.file('../../.githooks/pre-commit');
    expect(init(app).rows['hooks.path']).toEqual({ action: 'skipped', note });
  });

  it('skips all three when git’s hooks directory holds a hook of the user’s', () => {
    const root = fresh();
    write(root, '.git/hooks/pre-commit', '#!/bin/sh\nexit 0\n');
    const { rows } = init(root);
    expect(hookRows(rows)).toEqual(TARGETS.map(() => ({ action: 'skipped', note: f.dir('.git/hooks', ['pre-commit']) })));
    expect(exists(root, '.githooks')).toBe(false);
    expect(hooksPath(root)).toBe(null);
  });

  it('keeps a user’s own hook that calls cookwright in each accepted form, and writes the other', () => {
    const call = callLine('pre-commit');
    for (const line of [`exec ${call}`, `${call} || exit 1`, `${call} || exit $?`, `${call}\n# done`]) {
      const root = fresh();
      const body = `#!/bin/sh\necho mine\n${line}\n`;
      userHook(root, body);
      const { rows } = init(root);
      expect([line, rows['.githooks/pre-commit']]).toEqual([line, { action: 'kept', note: m.hooks.calls }]);
      expect(rows['.githooks/pre-push'].action).toBe('wrote');
      expect(rows['hooks.path'].action).toBe('wrote');
      expect(read(root, '.githooks/pre-commit')).toBe(body);
    }
  });

  // No executable bit on Windows; root ignores the read-only .git directory.
  const NO_MODES = process.platform === 'win32';

  it.skipIf(NO_MODES)('makes a hook that calls cookwright executable, its bytes intact', () => {
    const root = fresh();
    const body = `#!/bin/sh\r\n${callLine('pre-commit')} || exit 1\r\n`;
    userHook(root, body, 0o644);
    expect(init(root).rows['.githooks/pre-commit']).toEqual({ action: 'updated', note: m.hooks.modeFixed });
    expect(executable(root, '.githooks/pre-commit')).toBe(true);
    expect(read(root, '.githooks/pre-commit')).toBe(body);
    expect(init(root).rows['.githooks/pre-commit'].action).toBe('kept');
  });

  it('skips all three when a .githooks file swallows the status or does not call cookwright', () => {
    const call = callLine('pre-commit');
    for (const body of [`#!/bin/sh\n${call} || true\n`, `#!/bin/sh\n${call}\necho done\n`, '#!/bin/sh\nnpm run lint\n']) {
      const root = fresh();
      userHook(root, body);
      const before = tree(root);
      const { rows } = init(root, ['--dry-run']);
      expect(hookRows(rows)).toEqual(TARGETS.map(() => ({ action: 'skipped', note: f.file('.githooks/pre-commit') })));
      init(root);
      expect(read(root, '.githooks/pre-commit')).toBe(before['.githooks/pre-commit']);
      expect(exists(root, '.githooks/pre-push')).toBe(false);
      expect(hooksPath(root)).toBe(null);
    }
  });

  it('refuses a .githooks entry that is not a file, before any write', () => {
    const root = fresh();
    fs.mkdirSync(path.join(root, '.githooks/pre-push'), { recursive: true });
    expect(init(root).code).toBe(2);
    expect(err[0]).toBe(m.refused(m.notAFile('.githooks/pre-push')));
    expect(exists(root, 'cookwright.json')).toBe(false);
  });

  it('refuses to write the shims through a linked .githooks directory', () => {
    const root = fresh();
    const elsewhere = fs.mkdtempSync(path.join(TMP, 'hooks-'));
    fs.symlinkSync(elsewhere, path.join(root, '.githooks'));
    expect(init(root).code).toBe(2);
    expect(err[0]).toBe(m.refused(m.symlink('.githooks')));
    expect(fs.readdirSync(elsewhere)).toEqual([]);
  });

  it.skipIf(NO_MODES || process.getuid?.() === 0)('sets the path only after the shims are written; a git failure names the inert files', () => {
    const root = fresh();
    const git = path.join(root, '.git');
    fs.chmodSync(git, 0o555); // git config cannot take its lock file
    let r;
    try {
      r = init(root);
    } finally {
      fs.chmodSync(git, 0o755);
    }
    expect(r.code).toBe(2);
    expect(err[0]).toMatch(/^init: git config --local core\.hooksPath \.githooks failed: .+; \.githooks\/pre-commit, \.githooks\/pre-push are written but inactive, rerun init$/);
    expect(executable(root, '.githooks/pre-commit')).toBe(true);
    expect(hooksPath(root)).toBe(null);
    const again = init(root);
    expect(hookRows(again.rows).map((x) => x.action)).toEqual(['wrote', 'kept', 'kept']);
    expect(hooksPath(root)).toBe('.githooks');
  });
});

describe('pointers: the skills and workflows', () => {
  const outside = () => fs.mkdtempSync(path.join(TMP, 'outside-'));
  const SKILL = POINTERS.find((p) => p.kind === 'skill');
  const pointerRows = (rows) => POINTERS.map(({ rel }) => [rel, rows[rel]?.action]);
  const all = (action) => POINTERS.map(({ rel }) => [rel, action]);

  /** The pointers step alone, through openInitRepo and applyRows, with the step's seams. */
  const step = (root, io = {}) => {
    const repo = openInitRepo(root, { home: TMP });
    repo.config = { hosts: ['claude'], level: 0 };
    return pointersStep('claude')(repo, { probes: PROBES, ...io });
  };

  it('keeps every pointer on a second run, the tree byte-identical, each resolving', () => {
    const root = linkPackage(fresh());
    init(root);
    const before = tree(root);
    const second = init(root);
    expect(pointerRows(second.rows)).toEqual(all('kept'));
    for (const { rel } of POINTERS) expect(second.rows[rel].note).toBe(m.pointers.resolves);
    expect(tree(root)).toEqual(before);
  });

  it('writes the same text without node_modules, saying so, and keeps it dangling', () => {
    const root = fresh();
    const first = init(root);
    expect(first.code).toBe(0);
    for (const { rel, text } of POINTERS) {
      expect(fs.readlinkSync(path.join(root, rel))).toBe(text);
      expect(first.rows[rel]).toEqual({ action: 'wrote', note: `${m.pointers.wrote(text)}${m.pointers.notYet}` });
      expect(fs.existsSync(path.join(root, rel))).toBe(false);
    }
    const second = init(root);
    for (const { rel } of POINTERS) expect(second.rows[rel]).toEqual({ action: 'kept', note: m.pointers.notInstalled });
    expect(m.pointers.notInstalled).toBe('not installed where it points (npm install)');
  });

  it('replaces an earlier pointer, by its text', () => {
    const root = linkPackage(fresh());
    write(root, '.claude/skills/.keep', '');
    fs.symlinkSync('../../somewhere/old/bundle', path.join(root, SKILL.rel));
    const rows = step(root, { past: ['../../somewhere/old/bundle'] });
    expect(rows.find((r) => r.target === SKILL.rel)).toMatchObject({ action: 'updated', note: m.pointers.past });
    applyRows(root, rows);
    expect(fs.readlinkSync(path.join(root, SKILL.rel))).toBe(SKILL.text);
    expect(step(root).find((r) => r.target === SKILL.rel).action).toBe('kept');
  });

  it('keeps an earlier pointer whole when its replacement fails, at the link or the rename, and leaves nothing beside it', () => {
    const fails = (code) => () => {
      throw Object.assign(new Error(code), { code });
    };
    for (const [seam, code, links] of [['symlink', 'EPERM', true], ['symlink', 'EACCES', false], ['rename', 'EACCES', false]]) {
      const root = linkPackage(fresh());
      write(root, '.claude/skills/.keep', '');
      fs.symlinkSync('../../somewhere/old/bundle', path.join(root, SKILL.rel));
      const rows = step(root, { past: ['../../somewhere/old/bundle'] }).filter((r) => r.target === SKILL.rel);
      expect(applyRows(root, rows, { [seam]: fails(code) })).toEqual([{ rel: SKILL.rel, code, links }]);
      expect(fs.readlinkSync(path.join(root, SKILL.rel))).toBe('../../somewhere/old/bundle');
      expect(fs.readdirSync(path.join(root, '.claude/skills')).sort()).toEqual(['.keep', SKILL.file].sort());
    }
  });

  // root ignores the modes this test sets.
  it.skipIf(process.getuid?.() === 0)('reports a pointer it cannot write for want of permission, never a stack, and goes on', () => {
    const skills = POINTERS.filter((p) => p.kind === 'skill');
    // The directory cannot be made: .claude is read-only and .claude/skills absent.
    const mk = linkPackage(fresh());
    write(mk, '.claude/.keep', '');
    const rows = step(mk).filter((r) => skills.some((p) => p.rel === r.target));
    fs.chmodSync(path.join(mk, '.claude'), 0o555);
    try {
      expect(applyRows(mk, rows)).toEqual(skills.map(({ rel }) => ({ rel, code: 'EACCES', links: false })));
    } finally {
      fs.chmodSync(path.join(mk, '.claude'), 0o755);
    }
    // The link cannot be made: .claude/skills is read-only; the run goes on to doctor.
    const root = linkPackage(fresh());
    write(root, '.claude/skills/.keep', '');
    fs.chmodSync(path.join(root, '.claude/skills'), 0o555);
    try {
      out.length = 0;
      const code = main([], { cwd: root, home: TMP, probes: { ...GITLEAKS, claudeVersion: () => '2.1.281' } });
      for (const { rel } of skills) expect(out).toContain(m.pointers.writeFailed(rel, 'EACCES'));
      expect(code).toBe(1); // setup's pointer missing: drift, as doctor reads it
      expect(exists(root, 'AGENTS.md')).toBe(true);
    } finally {
      fs.chmodSync(path.join(root, '.claude/skills'), 0o755);
    }
    expect(m.pointers.writeFailed('.claude/skills/x', 'EACCES')).toBe(
      'pointer .claude/skills/x not written (EACCES); whatever stood there is unchanged',
    );
  });

  it('skips a link of the user’s, dangling or resolving, and a real directory or file, touching none', () => {
    const elsewhere = outside();
    const root = linkPackage(fresh());
    const [a, b, c] = POINTERS;
    fs.mkdirSync(path.dirname(path.join(root, a.rel)), { recursive: true });
    fs.mkdirSync(path.dirname(path.join(root, b.rel)), { recursive: true });
    fs.symlinkSync('../../nowhere/mine', path.join(root, a.rel)); // dangling, another shape
    fs.symlinkSync(elsewhere, path.join(root, b.rel)); // resolving, another directory
    write(root, c.kind === 'skill' ? `${c.rel}/SKILL.md` : c.rel, 'mine');
    const before = tree(root);
    const { rows } = init(root, ['--dry-run']);
    expect(rows[a.rel]).toEqual({ action: 'skipped', note: m.pointers.theirsLink(a.name) });
    expect(rows[b.rel]).toEqual({ action: 'skipped', note: m.pointers.theirsLink(b.name) });
    expect(rows[c.rel]).toEqual({ action: 'skipped', note: m.pointers.theirs(c.name) });
    init(root);
    const after = tree(root);
    for (const rel of Object.keys(before).filter((k) => k.startsWith('.claude/s') || k.startsWith('.claude/w'))) {
      expect([rel, after[rel]]).toEqual([rel, before[rel]]);
    }
    expect(fs.readdirSync(elsewhere)).toEqual([]);
  });

  it('skips a pointer whose directory is a file of the user’s, before any write', () => {
    const root = linkPackage(fresh());
    write(root, '.claude/skills', 'mine');
    const { code, rows } = init(root);
    expect(code).toBe(0);
    expect(rows[SKILL.rel]).toEqual({ action: 'skipped', note: m.pointers.theirs(SKILL.name) });
    expect(read(root, '.claude/skills')).toBe('mine');
  });

  it('skips the pointers under a linked .claude/skills or .claude, the target untouched, the other steps unaffected', () => {
    const shared = outside();
    const root = linkPackage(fresh());
    fs.mkdirSync(path.join(root, '.claude'));
    fs.symlinkSync(shared, path.join(root, '.claude/skills'));
    const { code, rows } = init(root);
    expect(code).toBe(0);
    expect(rows[SKILL.rel]).toEqual({ action: 'skipped', note: m.pointers.linkedParent('.claude/skills') });
    for (const p of POINTERS.filter((x) => x.kind === 'workflow')) expect(rows[p.rel].action).toBe('wrote');
    expect(rows['AGENTS.md'].action).toBe('wrote');
    expect(rows['.claude/settings.json'].action).toBe('wrote');
    expect(fs.readdirSync(shared)).toEqual([]);

    const settings = outside();
    write(settings, 'settings.json', `${JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: HOOK_COMMAND }] }] } })}\n`);
    const linked = linkPackage(fresh());
    fs.symlinkSync(settings, path.join(linked, '.claude'));
    const r = init(linked);
    expect(r.code).toBe(0);
    expect(r.rows['.claude/settings.json'].action).toBe('kept');
    expect(pointerRows(r.rows)).toEqual(all('skipped'));
    for (const { rel } of POINTERS) expect(r.rows[rel].note).toBe(m.pointers.linkedParent('.claude'));
    expect(fs.readdirSync(settings)).toEqual(['settings.json']);
  });

  it('points from the top into a config root two levels below, the package there or hoisted to the top', () => {
    for (const hoisted of [false, true]) {
      const top = fresh();
      const app = path.join(top, 'apps/mobile');
      write(app, 'cookwright.json', JSON.stringify({ version: CONFIG_VERSION }));
      linkPackage(hoisted ? top : app);
      const first = init(app);
      expect(first.code).toBe(0);
      for (const p of POINTERS) {
        const text = `../../${hoisted ? '' : 'apps/mobile/'}node_modules/cookwright/${p.inPackage}`;
        expect(first.rows[`../../${p.rel}`]).toEqual({ action: 'wrote', note: m.pointers.wrote(text) });
        expect(fs.readlinkSync(path.join(top, p.rel))).toBe(text);
        expect(fs.existsSync(path.join(top, p.rel))).toBe(true);
      }
      expect(exists(app, '.claude/skills')).toBe(false);
      const second = init(app);
      for (const p of POINTERS) expect(second.rows[`../../${p.rel}`]).toEqual({ action: 'kept', note: m.pointers.resolves });
    }
  });

  it('retargets a dangling pointer of ours once the package is installed elsewhere, and keeps it after', () => {
    const top = fresh();
    const app = path.join(top, 'apps/mobile');
    write(app, 'cookwright.json', JSON.stringify({ version: CONFIG_VERSION }));
    init(app); // no package anywhere: the config root's form
    expect(fs.readlinkSync(path.join(top, SKILL.rel))).toBe(`../../apps/mobile/node_modules/cookwright/${SKILL.inPackage}`);
    linkPackage(top); // then hoisted to the top
    const text = `../../node_modules/cookwright/${SKILL.inPackage}`;
    const r = init(app);
    expect(r.rows[`../../${SKILL.rel}`]).toEqual({ action: 'updated', note: m.pointers.retargeted(text) });
    expect(fs.readlinkSync(path.join(top, SKILL.rel))).toBe(text);
    expect(init(app).rows[`../../${SKILL.rel}`].action).toBe('kept');
  });

  it('says ignored by git when the pointer is', () => {
    const root = linkPackage(fresh());
    write(root, '.gitignore', '.env\n.env.*\n!.env.example\n.claude/\n');
    const { rows } = init(root);
    for (const { rel, text } of POINTERS) expect(rows[rel].note).toBe(`${m.pointers.wrote(text)}${m.pointers.ignored}`);
    expect(m.pointers.ignored).toBe('; ignored by git');
  });

  it('writes nothing on --dry-run', () => {
    const root = linkPackage(fresh());
    const { rows } = init(root, ['--dry-run']);
    expect(pointerRows(rows)).toEqual(all('wrote'));
    expect(exists(root, '.claude')).toBe(false);
  });

  it('reports a link the filesystem refuses after the rows, goes on, and exits as doctor does', () => {
    const root = linkPackage(fresh());
    const symlink = () => {
      throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
    };
    out.length = 0;
    const code = main([], { cwd: root, home: TMP, probes: { ...GITLEAKS, claudeVersion: () => '2.1.281' }, symlink });
    const lines = POINTERS.map(({ rel }) => m.pointers.linkFailed(rel, 'EPERM'));
    const at = out.indexOf(lines[0]);
    expect(at).toBeGreaterThan(out.findIndex((l) => l.startsWith('wrote    .githooks/pre-push')));
    expect(out.slice(at, at + lines.length)).toEqual(lines);
    expect(m.pointers.linkFailed('.claude/skills/x', 'EPERM')).toBe(
      'pointer .claude/skills/x not written: this filesystem refuses symbolic links (EPERM)',
    );
    expect(exists(root, '.githooks/pre-push')).toBe(true);
    expect(exists(root, 'AGENTS.md')).toBe(true);
    // At level 0 only a Level 0 pointer missing is drift; every one shipped today is Level 2.
    expect(code).toBe(POINTERS.some((p) => p.level === 0) ? 1 : 0);
  });

  it('names a level for every skill the package ships', () => {
    for (const p of shippedPieces('claude').filter((x) => x.kind === 'skill')) expect(Object.keys(SKILLS)).toContain(p.name);
  });
});

describe('codex: --hosts, its rules row, .codex/hooks.json and its pointers', () => {
  const FILE = '.codex/hooks.json';
  const codex = HOSTS.codex;
  const ours = { type: 'command', command: CODEX_HOOK_COMMAND, timeout: 10 };
  const SETUP = { kind: 'skill', name: 'setup', file: 'setup', level: 0 };
  const CODEX_POINTERS = shippedPieces('codex').map((p) => `.agents/skills/${p.file}`);
  const hooksFile = (groups, indent = 2) => `${JSON.stringify({ hooks: { SessionStart: groups } }, null, indent)}\n`;
  const kept = (root) => {
    const before = tree(root);
    expect(init(root).rows[FILE]).toEqual({ action: 'kept', note: m.hostHook.kept });
    expect(tree(root)).toEqual(before);
  };

  it('writes both hosts on --hosts claude,codex, doctor passes, and a second run changes no byte', () => {
    const root = linkPackage(fresh());
    const { code, rows } = init(root, ['--hosts', 'claude,codex']);
    expect(code).toBe(0);
    expect(JSON.parse(read(root, 'cookwright.json')).hosts).toEqual(['claude', 'codex']);
    expect(rows['AGENTS.override.md']).toEqual({ action: 'skipped', note: m.codex.native });
    expect(rows[FILE]).toEqual({ action: 'wrote', note: `${m.hostHook.wrote}${m.hostHook.trust('Codex', '/hooks')}` });
    expect(rows[FILE].note).toBe(
      "SessionStart hook runs doctor; Codex reads it at startup: open or restart Codex at the work tree's top, trust it with /hooks, then start a new session for the readout",
    );
    expect(JSON.parse(read(root, FILE))).toEqual({ hooks: { SessionStart: [{ matcher: 'startup|resume', hooks: [ours] }] } });
    expect(rows['.claude/settings.json'].action).toBe('wrote');
    // Codex gets the skills it can run, never bundle or a workflow: it has no workflow mechanism.
    expect(CODEX_POINTERS).not.toContain('.agents/skills/bundle');
    for (const rel of CODEX_POINTERS) expect(rows[rel].action).toBe('wrote');
    expect(Object.keys(rows).filter((t) => t.startsWith('.agents/'))).toEqual(CODEX_POINTERS);
    expect(out).toContain(`${N} checks — ${N - 1} PASS, 0 FAIL, 1 WARN, 0 SKIP`);
    expect(out.filter((l) => /^(FAIL|WARN|SKIP) /.test(l))).toEqual([GATE_WARN]);
    commit({ root }, {}, 'first run');
    const before = tree(root);
    const second = init(root);
    expect(second.actions.filter((a) => a === 'wrote' || a === 'updated')).toEqual([]);
    expect(tree(root)).toEqual(before);
  });

  it('writes Codex alone on --hosts codex: no .claude row, the rules row after the block row', () => {
    const root = linkPackage(fresh());
    const { code, rows } = init(root, ['--hosts', 'codex']);
    expect(code).toBe(0);
    expect(Object.keys(rows).filter((t) => t.startsWith('.claude') || t === 'CLAUDE.md')).toEqual([]);
    expect(exists(root, '.claude')).toBe(false);
    const targets = Object.keys(rows);
    expect(targets.indexOf('AGENTS.override.md')).toBe(targets.indexOf('AGENTS.md') + 1);
    expect(rows['AGENTS.md'].action).toBe('wrote');
    expect(rows['AGENTS.override.md']).toEqual({ action: 'skipped', note: m.codex.native });
    expect(JSON.parse(read(root, 'cookwright.json')).hosts).toEqual(['codex']);
    expect(out).toContain('level 0 declared: complete; weak: gate.scripts');
  });

  it('names an AGENTS.override.md on the path as the rules row, and never touches it', () => {
    const root = linkPackage(fresh());
    write(root, 'AGENTS.override.md', '# mine\n');
    write(root, 'app/AGENTS.override.md', '# app\n');
    const { rows } = init(path.join(root, 'app'), ['--hosts', 'codex', '--dry-run']);
    const found = ['app/AGENTS.override.md', 'AGENTS.override.md'];
    expect(rows['app/AGENTS.override.md']).toEqual({ action: 'skipped', note: m.codex.override(found) });
    init(root, ['--hosts', 'codex']);
    expect(read(root, 'AGENTS.override.md')).toBe('# mine\n');
    expect(init(root).rows['AGENTS.override.md']).toEqual({ action: 'skipped', note: m.codex.override(['AGENTS.override.md']) });
  });

  it('merges the hook into an existing file, its other hooks and indent kept, then keeps it byte for byte', () => {
    const root = fresh();
    write(root, 'cookwright.json', JSON.stringify({ version: CONFIG_VERSION, hosts: ['codex'] }));
    const theirs = { matcher: 'startup', hooks: [{ type: 'command', command: 'echo hi' }] };
    write(root, FILE, hooksFile([theirs], 4));
    const { action, note } = init(root).rows[FILE];
    expect({ action, note }).toEqual({ action: 'updated', note: `${m.hostHook.added}${m.hostHook.trustAgain('Codex', '/hooks')}` });
    expect(note).toBe(
      "doctor SessionStart hook added; the other settings kept; Codex reads it at startup: open or restart Codex at the work tree's top, trust it again with /hooks, then start a new session for the readout",
    );
    expect(read(root, FILE)).toBe(hooksFile([theirs, { matcher: 'startup|resume', hooks: [ours] }], 4));
    kept(root);
  });

  it('moves the hook from another matcher, a group of the user’s kept, then keeps it', () => {
    const root = fresh();
    write(root, 'cookwright.json', JSON.stringify({ version: CONFIG_VERSION, hosts: ['codex'] }));
    const theirs = { type: 'command', command: 'echo hi' };
    write(root, FILE, hooksFile([{ matcher: 'startup', hooks: [theirs, ours] }, { hooks: [ours] }]));
    expect(init(root).rows[FILE]).toEqual({
      action: 'updated',
      note: `${m.hostHook.matcher('startup|resume')}${m.hostHook.trustAgain('Codex', '/hooks')}`,
    });
    expect(JSON.parse(read(root, FILE)).hooks.SessionStart).toEqual([
      { matcher: 'startup', hooks: [theirs] },
      { matcher: 'startup|resume', hooks: [ours] },
    ]);
    kept(root);
  });

  it('removes a copy of the hook under another matcher beside the right one, then keeps it', () => {
    const root = fresh();
    write(root, 'cookwright.json', JSON.stringify({ version: CONFIG_VERSION, hosts: ['codex'] }));
    const theirs = { type: 'command', command: 'echo hi' };
    write(root, FILE, hooksFile([{ matcher: 'startup|resume', hooks: [ours] }, { matcher: 'compact', hooks: [theirs, ours] }]));
    expect(init(root).rows[FILE]).toEqual({
      action: 'updated',
      note: `${m.hostHook.stray('startup|resume')}${m.hostHook.trustAgain('Codex', '/hooks')}`,
    });
    expect(JSON.parse(read(root, FILE)).hooks.SessionStart).toEqual([
      { matcher: 'startup|resume', hooks: [ours] },
      { matcher: 'compact', hooks: [theirs] },
    ]);
    kept(root);
  });

  it('replaces an earlier command in place, and refuses a file that is not the shape Codex reads', () => {
    const root = fresh();
    write(root, FILE, hooksFile([{ matcher: 'startup|resume', hooks: [{ type: 'command', command: 'node old.mjs' }] }]));
    const r = codexHookStepFor(root, { ...codex, hookCommandsPast: ['node old.mjs'] });
    expect([r.action, r.note]).toEqual(['updated', `${m.hostHook.replaced}${m.hostHook.trustAgain('Codex', '/hooks')}`]);
    expect(JSON.parse(r.writes[0].content).hooks.SessionStart).toEqual([
      { matcher: 'startup|resume', hooks: [{ type: 'command', command: CODEX_HOOK_COMMAND }] },
    ]);
    const bad = fresh();
    write(bad, 'cookwright.json', JSON.stringify({ version: CONFIG_VERSION, hosts: ['codex'] }));
    write(bad, FILE, '{ "hooks": [] }\n');
    expect(init(bad).code).toBe(2);
    expect(err[0]).toBe(m.refused(m.settingsShape(FILE, 'hooks', 'Codex')));
    expect(exists(bad, 'AGENTS.md')).toBe(false);
  });

  it('writes a Codex skill pointer at .agents/skills, and ships it only the skills it can run', () => {
    const root = linkPackage(fresh());
    const repo = openInitRepo(root, { home: TMP });
    repo.config = { hosts: ['codex'], level: 0 };
    const [r] = pointersStep('codex')(repo, { probes: PROBES, shipped: () => [SETUP] });
    expect(r).toMatchObject({ action: 'wrote', target: '.agents/skills/setup' });
    expect(r.writes).toEqual([{ rel: '.agents/skills/setup', link: '../../node_modules/cookwright/skills/setup' }]);
    const pkg = fs.mkdtempSync(path.join(TMP, 'pkg-'));
    // setup's SKILL.md left out: the manifest, not the package's files, names the skills.
    for (const rel of ['skills/bundle/SKILL.md', 'hosts/claude/workflows/bundle-phase.js']) write(pkg, rel, '');
    expect(shippedPieces('codex', pkg)).toEqual([SETUP]);
    expect(shippedPieces('claude', pkg).map((p) => p.name)).toEqual(['bundle', 'setup', 'bundle-phase']);
  });

  it('refuses --hosts and --base on an existing config, before any write; refuses an unknown host on a fresh one', () => {
    const root = fresh();
    write(root, 'cookwright.json', JSON.stringify({ version: CONFIG_VERSION }));
    const before = tree(root);
    expect(init(root, ['--hosts', 'codex']).code).toBe(2);
    expect(err).toEqual([m.refused(m.config.existing('hosts', 'hosts'))]);
    expect(init(root, ['--base', 'develop']).code).toBe(2);
    expect(err).toEqual([m.refused(m.config.existing('base', 'baseBranch'))]);
    expect(tree(root)).toEqual(before);
    expect(m.config.existing('hosts', 'hosts')).toBe(
      '--hosts applies to a fresh cookwright.json and this repo has one; change hosts there by hand, then rerun init',
    );
    const other = fresh();
    expect(init(other, ['--hosts', 'claude,gemini']).code).toBe(2);
    expect(err[0]).toMatch(/hosts: host "gemini" is not available/);
    expect(init(other, ['--hosts', 'codex,codex']).code).toBe(2);
    expect(err[0]).toMatch(/each host once/);
    expect(tree(other)).toEqual({});
  });
});
