// src/init.test.mjs — init on scratch repos: the fresh walk, idempotence, refresh,
// the refusals (each before any write), the host cases and .gitignore. The probes
// are injected (no Claude binary); `ignored` is real git.

import fs from 'node:fs';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { main } from './init.mjs';
import { DEFAULTS } from './lib/config.mjs';
import { callLine, shimText } from './lib/hooks/shims.mjs';
import { claudeHookStep } from './lib/init/claude.mjs';
import { ENV_LINES } from './lib/init/gitignore.mjs';
import { HOOK_COMMAND, HOOK_LINES, HOSTS } from './lib/hosts.mjs';
import { messages } from './lib/messages.mjs';
import { hasTool } from './lib/probes.mjs';
import { RULES_VERSION, beginMarker, renderBlock } from './lib/rules/block.mjs';
import { commit, gitInit, gitWithoutScopes, run, scratchRoot, stageOnly, v1Block } from './test-helpers.mjs';

const TMP = scratchRoot('cookwright-init-');
const m = messages.init;
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

/** Every file under `root` but .git, as rel → text. */
function tree(root) {
  const files = {};
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else files[path.relative(root, abs)] = fs.readFileSync(abs, 'utf8');
    }
  };
  walk(root);
  return files;
}

const ROW = /^(wrote|updated|kept|skipped) +(\S+) +(.*)$/;

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
    const root = fresh();
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
      '.gitignore': 'wrote',
      'hooks.path': 'wrote',
      '.githooks/pre-commit': 'wrote',
      '.githooks/pre-push': 'wrote',
    });
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
    expect(read(root, '.gitignore')).toBe('.env\n.env.*\n!.env.example\n');
    expect(exists(root, 'CLAUDE.md')).toBe(false);
    const config = JSON.parse(read(root, 'cookwright.json'));
    expect(config).toMatchObject({ version: 1, level: 0, hosts: ['claude'], baseBranch: 'main' });
    expect(config.paths).toEqual(DEFAULTS.paths);
    expect(config.gate).toEqual({ checks: [] });
    expect(config.hooks).toEqual({ docSync: [] });
    const hook = JSON.parse(read(root, '.claude/settings.json')).hooks.SessionStart;
    expect(hook).toEqual([{ hooks: [{ type: 'command', command: HOOK_COMMAND, timeout: 10 }] }]);
    expect(out).toContain(`PASS  ${'git'.padEnd('hooks.pre-commit'.length)}  ${messages.doctor.git.unborn('main')}`);
    expect(out).toContain('16 checks — 16 PASS, 0 FAIL, 0 WARN, 0 SKIP');
    expect(out.filter((l) => /^(FAIL|WARN|SKIP) /.test(l))).toEqual([]);
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
    expect(err).toEqual([m.refused(messages.unknownFlag('bogus', ['base', 'dry-run'])), m.usage]);
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
    write(root, 'cookwright.json', '{ "version": 1, "hosts": ["codex"] }');
    const before = tree(root);
    expect(init(root).code).toBe(2);
    expect(err[0]).toMatch(/host "codex" is not available in this version of cookwright/);
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
  it('keeps an existing config byte for byte, even without level', () => {
    const root = fresh();
    const text = '{"version":1,"paths":{"backlog":"notes/todo/backlog.md"}}';
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

  it('refreshes a v1 block to v2, the text outside the markers byte-identical', () => {
    const root = fresh();
    const above = '# My rules\n\n- mine, with a `<!-- cookwright:end -->` mention\n\n';
    const below = '\n## More of mine\n\nThe Unreleased section is history.\n';
    write(root, 'AGENTS.md', `${above}${v1Block(BLOCK)}\n${below}`);
    expect(init(root).rows['AGENTS.md']).toEqual({ action: 'updated', note: m.block.refreshed(2) });
    expect(read(root, 'AGENTS.md')).toBe(`${above}${BLOCK}\n${below}`);
    expect(BLOCK).toContain('COOKWRIGHT_SKIP=doc-sync git commit');
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
    const text = '.env\n.env.*\n!.env.example\n!.env.local\n';
    write(root, '.gitignore', text);
    expect(init(root).rows['.gitignore']).toEqual({ action: 'updated', note: m.gitignore.appended(ENV_LINES) });
    expect(read(root, '.gitignore')).toBe(`${text}.env\n.env.*\n!.env.example\n`);
    expect(init(root).rows['.gitignore'].action).toBe('kept');
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
    commit({ root }, { '.gitignore': '.env\n.env.*\n' }, 'oops');
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
