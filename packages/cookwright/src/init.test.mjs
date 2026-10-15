// src/init.test.mjs — init on scratch repos: the fresh walk, idempotence, refresh,
// the refusals (each before any write), the host cases and .gitignore. The probes
// are injected (no Claude binary); `ignored` is real git.

import fs from 'node:fs';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { main } from './init.mjs';
import { DEFAULTS } from './lib/config.mjs';
import { claudeHookStep } from './lib/init/claude.mjs';
import { ENV_LINES } from './lib/init/gitignore.mjs';
import { HOOK_COMMAND, HOOK_LINES, HOSTS } from './lib/hosts.mjs';
import { messages } from './lib/messages.mjs';
import { renderBlock } from './lib/rules/block.mjs';
import { commit, gitInit, run, scratchRoot, stageOnly } from './test-helpers.mjs';

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

/** Run init; `rows` maps each target to `{ action, note }`. */
function init(cwd, argv = [], { version = '2.1.281', probes = {} } = {}) {
  out.length = 0;
  err.length = 0;
  const code = main(argv, { cwd, home: TMP, probes: { claudeVersion: () => version, ...probes } });
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
    });
    expect(rows['CLAUDE.md'].note).toBe(m.hostRules.native('2.1.281'));
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
    const hook = JSON.parse(read(root, '.claude/settings.json')).hooks.SessionStart;
    expect(hook).toEqual([{ hooks: [{ type: 'command', command: HOOK_COMMAND, timeout: 10 }] }]);
    expect(out).toContain(`PASS  git              ${messages.doctor.git.unborn('main')}`);
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
    const newer = BLOCK.replace('rules v1 -->', 'rules v9 -->');
    write(root, 'AGENTS.md', `${newer}\n`);
    expect(init(root).rows['AGENTS.md']).toEqual({ action: 'kept', note: m.block.newer(9) });
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
