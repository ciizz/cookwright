// src/audit.test.mjs — `cookwright audit args`: the declared packs' contract docs
// with their scopes, the `--doc` extras, and every refusal (stage-4 plan §6).

import fs from 'node:fs';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { main } from './audit.mjs';
import { dispatch } from './cli-main.mjs';
import { messages } from './lib/messages.mjs';
import { PACKS } from './lib/packs/registry.mjs';
import { scratchRepo, scratchRoot } from './test-helpers.mjs';

const m = messages.audit;
const TMP = scratchRoot('cookwright-audit-');
const DESIGN = 'docs/design-system.md';
const DATA = 'docs/data-model.md';

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
/** A scratch repo declaring `packs`, with `files` (root-relative path → body) written. */
function repoWith(packs, files = {}) {
  const repo = scratchRepo(TMP, `r${(n += 1)}`, { packs });
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo.root, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo.root, rel), body);
  }
  return repo.root;
}
const args = (root, argv = []) => main(['args', ...argv], { cwd: root });
const printed = () => JSON.parse(out.join('\n'));
const scopeOf = (pack) => PACKS[pack].docs[0].scope;

describe('audit args', () => {
  it("prints each declared pack's contract doc with its scope", () => {
    const root = repoWith(['expo', 'supabase'], { [DESIGN]: '# d\n', [DATA]: '# m\n' });
    expect(args(root)).toBe(0);
    expect(printed()).toEqual({
      docs: [
        { path: DESIGN, scope: scopeOf('expo') },
        { path: DATA, scope: scopeOf('supabase') },
      ],
    });
    expect(err).toEqual([]);
  });

  it('adds each --doc extra after the packs, with its scope or the default one', () => {
    const root = repoWith(['expo'], { [DESIGN]: '# d\n', 'docs/api.md': '# a\n', 'README.md': '# r\n' });
    expect(args(root, ['--doc', 'docs/api.md:every endpoint against src/api', '--doc', './README.md'])).toBe(0);
    expect(printed().docs).toEqual([
      { path: DESIGN, scope: scopeOf('expo') },
      { path: 'docs/api.md', scope: 'every endpoint against src/api' },
      { path: 'README.md', scope: m.defaultScope },
    ]);
  });

  it('takes extras alone when no pack is declared, run from a subdirectory', () => {
    const root = repoWith([], { 'docs/api.md': '# a\n' });
    fs.mkdirSync(path.join(root, 'src'));
    expect(main(['args', '--doc', 'docs/api.md'], { cwd: path.join(root, 'src') })).toBe(0);
    expect(printed()).toEqual({ docs: [{ path: 'docs/api.md', scope: m.defaultScope }] });
  });

  it('is reached through the dispatcher', async () => {
    const root = repoWith(['supabase'], { [DATA]: '# m\n' });
    expect(await dispatch(['audit', 'args'], { cwd: root })).toBe(0);
    expect(printed().docs.map((d) => d.path)).toEqual([DATA]);
  });
});

describe('audit args refuses', () => {
  const refused = (code, line) => {
    expect(code).toBe(2);
    expect(out).toEqual([]);
    expect(err[0]).toBe(m.refused(line));
  };

  it("a declared pack's contract doc that is missing, naming init", () => {
    const root = repoWith(['expo', 'supabase'], { [DESIGN]: '# d\n' });
    refused(args(root), m.packDocMissing(DATA, 'supabase'));
    expect(err[0]).toContain('run npx cookwright init');
  });

  it('nothing to audit', () => {
    refused(args(repoWith([])), m.nothing);
  });

  it('an extra that is missing, a directory, or outside the repo', () => {
    const root = repoWith([], { 'docs/a.md': '# a\n' });
    refused(args(root, ['--doc', 'docs/none.md']), m.notAFile('docs/none.md'));
    err.length = 0;
    refused(args(root, ['--doc', 'docs']), m.notAFile('docs'));
    for (const bad of ['../outside.md', '/etc/hosts', 'docs/../../x.md', '.']) {
      err.length = 0;
      refused(args(root, ['--doc', bad]), m.outside(bad));
    }
  });

  it('a doc reached through a symbolic link, an extra or a pack doc', () => {
    const root = repoWith(['expo'], { 'real/design-system.md': '# d\n', 'elsewhere/a.md': '# a\n' });
    fs.mkdirSync(path.join(root, 'docs'));
    fs.symlinkSync('../real/design-system.md', path.join(root, DESIGN));
    refused(args(root), m.link(DESIGN, DESIGN));
    fs.rmSync(path.join(root, DESIGN));
    fs.writeFileSync(path.join(root, DESIGN), '# d\n');
    fs.symlinkSync('elsewhere', path.join(root, 'linked'));
    err.length = 0;
    refused(args(root, ['--doc', 'linked/a.md']), m.link('linked/a.md', 'linked'));
  });

  it('a path listed twice', () => {
    const root = repoWith(['expo'], { [DESIGN]: '# d\n' });
    refused(args(root, ['--doc', DESIGN]), m.twice(DESIGN));
  });

  it('a bad argument, with the usage', () => {
    const root = repoWith([]);
    expect(main([], { cwd: root })).toBe(2);
    expect(err).toEqual([m.refused(m.usage)]);
    err.length = 0;
    expect(main(['args', '--docs', 'x'], { cwd: root })).toBe(2);
    expect(err).toEqual([m.refused(messages.unknownFlag('docs', ['doc'])), m.usage]);
    err.length = 0;
    expect(main(['args', '--doc'], { cwd: root })).toBe(2);
    expect(err).toEqual([m.refused(messages.missing(m.docFlag)), m.usage]);
    err.length = 0;
    expect(main(['args', '--doc', ':scope only'], { cwd: root })).toBe(2);
    expect(err).toEqual([m.refused(m.emptyPath), m.usage]);
  });

  it('no config, and an invalid one', () => {
    const bare = path.join(TMP, 'bare');
    fs.mkdirSync(bare);
    refused(main(['args'], { cwd: bare }), m.noConfig(bare));
    const root = repoWith([]);
    fs.writeFileSync(path.join(root, 'cookwright.json'), JSON.stringify({ version: 3, packs: ['rails'] }));
    err.length = 0;
    expect(args(root)).toBe(2);
    expect(err[0]).toMatch(/^audit: cookwright\.json invalid: .*rails/);
  });
});
