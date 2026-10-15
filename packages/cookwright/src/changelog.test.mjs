// src/changelog.test.mjs — the changelog generator on scratch repos: the release
// tags and their metadata, the commits between them, the render, the file's state,
// and the command's four modes (plan §4.4, §6).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { main } from './changelog.mjs';
import { main as initMain } from './init.mjs';
import { classify } from './lib/changelog/commits.mjs';
import { MARKER, TEMPLATE, hasMarker, renderChangelog } from './lib/changelog/render.mjs';
import { changelogState, generate } from './lib/changelog/state.mjs';
import { parseMeta, rawTags, releaseTags, tagMeta } from './lib/changelog/tags.mjs';
import { Refusal } from './lib/cli.mjs';
import { messages } from './lib/messages.mjs';
import { commit, gitInit, run, scratchRepo, scratchRoot } from './test-helpers.mjs';

const TMP = scratchRoot('cookwright-changelog-');
const m = messages.changelog;
const TEMPLATE_FILE = path.join(path.dirname(new URL(import.meta.url).pathname), 'lib/templates/CHANGELOG.md');

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
/** A scratch repo with a config and no commit; tags are never signed, whatever the machine says. */
function repoAt(config = {}) {
  const repo = scratchRepo(TMP, `r${(n += 1)}`, config);
  run(repo.root, 'git', ['config', 'tag.gpgsign', 'false']);
  run(repo.root, 'git', ['config', 'tag.forceSignAnnotated', 'false']);
  return repo;
}
let f = 0;
/** One commit with subject `msg` (and an optional body), touching a fresh file. */
const commitMsg = (repo, msg) => commit(repo, { [`f${(f += 1)}.txt`]: msg }, msg);
const tag = (repo, name, ...messages) =>
  run(repo.root, 'git', ['tag', ...(messages.length ? ['-a', name, ...messages.flatMap((x) => ['-m', x])] : [name])]);
/**
 * An annotated tag on HEAD whose message carries a `marker` armour block straight
 * after it, as `git tag -s` writes one: built with mktag, so no key is needed.
 */
function signedTag(repo, name, message, marker) {
  const object = run(repo.root, 'git', ['rev-parse', 'HEAD']);
  const armour = `-----BEGIN ${marker}-----\n\nAAAAexample==\n-----END ${marker}-----\n`;
  const head = `object ${object}\ntype commit\ntag ${name}\ntagger T <t@example.invalid> 1760486400 +0000`;
  const input = `${head}\n\n${message}\n${armour}`;
  const sha = execFileSync('git', ['mktag'], { cwd: repo.root, encoding: 'utf8', input }).trim();
  run(repo.root, 'git', ['update-ref', `refs/tags/${name}`, sha]);
}

describe('release tags', () => {
  it('returns git’s raw name and object type joined by byte 037 (%1f, not %x1f)', () => {
    const repo = repoAt();
    commitMsg(repo, 'feat: one');
    tag(repo, 'v0.1.0');
    tag(repo, 'v0.2.0', 'released: 2026-10-15');
    expect(rawTags(repo.root)).toBe('v0.1.0\x1fcommit\nv0.2.0\x1ftag\n');
  });

  it('finds nothing on an unborn HEAD', () => {
    const repo = repoAt();
    expect(releaseTags(repo.root)).toEqual({ tags: [], skipped: [] });
  });

  it('orders by version, skips non-semver names, and keeps only tags merged into HEAD', () => {
    const repo = repoAt();
    commitMsg(repo, 'feat: one');
    for (const t of ['v1.10.0', 'v1.2.0', 'v1.0.0-rc1', 'v2.0.0']) tag(repo, t);
    run(repo.root, 'git', ['checkout', '-q', '-b', 'side']);
    commitMsg(repo, 'fix: side');
    tag(repo, 'v3.0.0');
    run(repo.root, 'git', ['checkout', '-q', 'main']);
    const { tags, skipped } = releaseTags(repo.root);
    expect(tags.map((t) => t.name)).toEqual(['v1.2.0', 'v1.10.0', 'v2.0.0']);
    expect(tags[0]).toEqual({ name: 'v1.2.0', version: '1.2.0', annotated: false });
    expect(skipped).toEqual(['v1.0.0-rc1']);
  });

  it('orders versions past 2^53 exactly, never as equal Numbers in git’s lexical order', () => {
    const repo = repoAt();
    commitMsg(repo, 'feat: one');
    const names = ['v10000000000000000.0.0', 'v9999999999999999.0.0', 'v1.0.9007199254740993', 'v1.0.9007199254740992'];
    for (const t of names) tag(repo, t);
    expect(releaseTags(repo.root).tags.map((t) => t.name)).toEqual([
      'v1.0.9007199254740992',
      'v1.0.9007199254740993',
      'v9999999999999999.0.0',
      'v10000000000000000.0.0',
    ]);
  });

  it('reads metadata from an annotated tag, never from a lightweight one', () => {
    const repo = repoAt();
    commit(repo, { 'a.txt': 'a' }, 'feat: one\n\nnote: from the commit body');
    tag(repo, 'v0.1.0');
    tag(repo, 'v0.2.0', 'Release 0.2', 'released: 2026-10-15\nnote: first line\n  second line\nios: 1.2 (34)');
    tag(repo, 'v0.3.0', 'released: 2026-10-16');
    const [light, annotated, subjectOnly] = releaseTags(repo.root).tags;
    expect(tagMeta(repo.root, light)).toEqual([]);
    expect(tagMeta(repo.root, annotated)).toEqual([
      { key: 'released', lines: ['2026-10-15'] },
      { key: 'note', lines: ['first line', 'second line'] },
      { key: 'ios', lines: ['1.2 (34)'] },
    ]);
    expect(tagMeta(repo.root, subjectOnly)).toEqual([{ key: 'released', lines: ['2026-10-16'] }]);
  });

  it('drops the signature in every format git signs with, the message one paragraph', () => {
    const repo = repoAt();
    commitMsg(repo, 'feat: one');
    const markers = ['PGP SIGNATURE', 'PGP MESSAGE', 'SIGNED MESSAGE', 'SSH SIGNATURE'];
    const message = 'released: 2026-10-15\nnote: first line\n  second line';
    markers.forEach((marker, i) => signedTag(repo, `v1.0.${i}`, message, marker));
    const { tags } = releaseTags(repo.root);
    expect(tags.map((t) => t.annotated)).toEqual([true, true, true, true]);
    for (const t of tags) {
      expect(tagMeta(repo.root, t)).toEqual([
        { key: 'released', lines: ['2026-10-15'] },
        { key: 'note', lines: ['first line', 'second line'] },
      ]);
    }
    expect(generate(repo.root).text).not.toMatch(/-----|AAAAexample/);
  });
});

describe('tag metadata', () => {
  it('ignores a subject that is not a key line, and prose not under a key', () => {
    expect(parseMeta('Release notes\n\nsome prose\n\nnote: kept\n')).toEqual([{ key: 'note', lines: ['kept'] }]);
  });

  it('keeps a URL on a continuation line out of the keys', () => {
    expect(parseMeta('note: see\nhttps://example.invalid/x\n')).toEqual([
      { key: 'note', lines: ['see', 'https://example.invalid/x'] },
    ]);
  });

  it('ends a value at a blank line or the next key', () => {
    const body = 'store: live\n\norphan line\nnote:\nlater\nkey: x\n';
    expect(parseMeta(body)).toEqual([
      { key: 'store', lines: ['live'] },
      { key: 'note', lines: ['later'] },
      { key: 'key', lines: ['x'] },
    ]);
  });

  it('reads CRLF bodies like LF ones', () => {
    expect(parseMeta('released: 2026-10-15\r\nnote: x\r\n')).toEqual([
      { key: 'released', lines: ['2026-10-15'] },
      { key: 'note', lines: ['x'] },
    ]);
  });
});

describe('the render', () => {
  it('is the template, byte for byte, at zero tags: unborn, and with commits', () => {
    expect(renderChangelog([])).toBe(fs.readFileSync(TEMPLATE_FILE, 'utf8').replace(/\r\n/g, '\n'));
    expect(TEMPLATE).toMatch(/^# Changelog\n\n<!-- cookwright:changelog -->\n\n[^\n]+\n\n---\n$/);
    expect(hasMarker(TEMPLATE)).toBe(true);
    const repo = repoAt();
    expect(generate(repo.root).text).toBe(TEMPLATE);
    commitMsg(repo, 'feat: one');
    commitMsg(repo, 'fix: two');
    expect(generate(repo.root)).toEqual({ text: TEMPLATE, tags: [], skipped: [], notAncestors: [] });
  });

  it('classifies conventional subjects: feat, fix, perf visible, the rest internal', () => {
    expect(classify('feat(api)!: drop v1')).toEqual({ type: 'feat', scope: 'api', breaking: true, text: 'drop v1' });
    expect(classify('perf: faster')).toEqual({ type: 'perf', scope: null, breaking: false, text: 'faster' });
    for (const s of ['docs: x', 'chore(bundle): y', 'Merge branch x', 'feat:no space', 'Feat: caps']) {
      expect(classify(s)).toBeNull();
    }
  });

  it('renders releases newest first with their metadata, sections and internal count', () => {
    const repo = repoAt();
    const a = commitMsg(repo, 'feat: first feature');
    commitMsg(repo, 'docs: readme');
    tag(repo, 'v0.1.0', 'released: 2026-10-01');
    const b = commitMsg(repo, 'feat(api)!: new shape');
    const c = commitMsg(repo, 'fix: crash on start');
    const d = commitMsg(repo, 'perf(list): fewer renders');
    commitMsg(repo, 'chore: tidy');
    tag(repo, 'v0.2.0', 'Release 0.2', 'released: 2026-10-15\nnote: first line\n  second line\nios: 1.2 (34)\nstore: live');
    const sha = (x) => `\`${x.slice(0, 8)}\``;
    expect(generate(repo.root).text).toBe(
      `${TEMPLATE}
## 0.2.0 — 2026-10-15

> first line
> second line

**Ios.** 1.2 (34)

**Store.** live

### Features

- **BREAKING** **api** — new shape ${sha(b)}

### Fixes

- crash on start ${sha(c)}

### Performance

- **list** — fewer renders ${sha(d)}

_4 commits in this release, 1 internal (docs, chore, refactor, tests, tooling)._

## 0.1.0 — 2026-10-01

### Features

- first feature ${sha(a)}

_2 commits in this release, 1 internal (docs, chore, refactor, tests, tooling)._
`,
    );
  });

  it('renders a lightweight tag with no date and no metadata, and a URL continuation as one quote', () => {
    const repo = repoAt();
    commit(repo, { 'a.txt': 'a' }, 'feat: one\n\nnote: from the commit body');
    tag(repo, 'v1.0.0');
    commitMsg(repo, 'chore: two');
    tag(repo, 'v1.1.0', 'note: see\nhttps://example.invalid/x');
    const text = generate(repo.root).text;
    expect(text).toContain('\n## 1.0.0\n\n### Features\n');
    expect(text).not.toContain('from the commit body');
    expect(text).toContain('## 1.1.0\n\n> see\n> https://example.invalid/x\n\n_1 commit in this release, 1 internal');
    expect(text).not.toMatch(/\*\*Https\.\*\*/);
    expect(text).not.toMatch(/ \n/);
  });

  it('is the same whatever log.showSignature says', () => {
    const repo = repoAt();
    commitMsg(repo, 'feat: one');
    tag(repo, 'v1.0.0', 'released: 2026-10-15');
    const before = generate(repo.root).text;
    run(repo.root, 'git', ['config', 'log.showSignature', 'true']);
    expect(generate(repo.root).text).toBe(before);
  });

  it('lists a maintenance release once, under its own version, and reports it out of line', () => {
    const repo = repoAt();
    commitMsg(repo, 'feat: base');
    tag(repo, 'v1.0.0');
    run(repo.root, 'git', ['checkout', '-q', '-b', 'maint']);
    const F = commitMsg(repo, 'fix: maintenance');
    tag(repo, 'v1.1.1');
    run(repo.root, 'git', ['checkout', '-q', 'main']);
    commitMsg(repo, 'feat: two');
    tag(repo, 'v2.0.0');
    run(repo.root, 'git', ['merge', '-q', '--no-ff', '--no-edit', 'maint']);
    const B = commitMsg(repo, 'fix: after merge');
    tag(repo, 'v2.1.0');
    const g = generate(repo.root);
    expect(g.notAncestors).toEqual([['v1.1.1', 'v2.0.0']]);
    expect(g.text.split(F.slice(0, 8)).length).toBe(2); // F once
    const v210 = g.text.slice(g.text.indexOf('## 2.1.0'), g.text.indexOf('## 2.0.0'));
    expect(v210).toContain(B.slice(0, 8));
    expect(v210).toContain('_2 commits in this release, 1 internal');
    expect(g.text.indexOf(F.slice(0, 8))).toBeGreaterThan(g.text.indexOf('## 1.1.1'));
    expect(generate(repo.root).text).toBe(g.text);
  });
});

const read = (repo, rel = 'CHANGELOG.md') => fs.readFileSync(path.join(repo.root, rel), 'utf8');
const write = (repo, body, rel = 'CHANGELOG.md') => {
  fs.mkdirSync(path.dirname(path.join(repo.root, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo.root, rel), body);
};
/** Run the command; `out` and `err` hold what it printed. */
const cl = (repo, ...argv) => {
  out.length = 0;
  err.length = 0;
  return main(argv, { cwd: repo.root });
};

describe('the changelog state', () => {
  it('is missing, unmarked, stale or current, LF-normalised', () => {
    const repo = repoAt();
    commitMsg(repo, 'feat: one');
    tag(repo, 'v1.0.0', 'released: 2026-10-15');
    expect(changelogState(repo).state).toBe('missing');
    write(repo, '# Changelog\n\nmine\n');
    expect(changelogState(repo).state).toBe('unmarked');
    const text = generate(repo.root).text;
    write(repo, `${text}\nedited\n`);
    expect(changelogState(repo).state).toBe('stale');
    write(repo, text);
    expect(changelogState(repo)).toMatchObject({ state: 'current', tags: 1 });
    write(repo, text.replace(/\n/g, '\r\n'));
    expect(changelogState(repo).state).toBe('current');
    expect(hasMarker(`x\n  ${MARKER}  \ny`)).toBe(true);
  });

  it('reads a CRLF template (a Windows autocrlf checkout) as LF, so the file init seeds is current', async () => {
    const crlf = fs.readFileSync(TEMPLATE_FILE, 'utf8').replace(/\r?\n/g, '\r\n');
    const readFileSync = fs.readFileSync;
    let served = false;
    const spy = vi.spyOn(fs, 'readFileSync').mockImplementation((p, ...rest) => {
      if (!String(p).endsWith('/templates/CHANGELOG.md')) return readFileSync(p, ...rest);
      served = true;
      return crlf;
    });
    try {
      vi.resetModules();
      const fresh = await import('./lib/changelog/state.mjs');
      const render = await import('./lib/changelog/render.mjs');
      expect(served).toBe(true);
      expect(render.TEMPLATE).toBe(TEMPLATE);
      const repo = repoAt();
      write(repo, crlf);
      expect(fresh.changelogState(repo).state).toBe('current');
    } finally {
      spy.mockRestore();
      vi.resetModules();
    }
  });
});

describe('npx cookwright changelog', () => {
  it('passes --check on an unborn repo after init, and with commits but no tag', () => {
    const root = gitInit(path.join(TMP, `r${(n += 1)}`));
    initMain([], { cwd: root, home: TMP, probes: { claudeVersion: () => '2.1.281' } });
    const repo = { root };
    expect(read(repo)).toBe(TEMPLATE);
    expect(cl(repo, '--check')).toBe(0);
    expect(out).toEqual([m.check.current('CHANGELOG.md', 0)]);
    expect(cl(repo, '--unreleased')).toBe(0);
    expect(out).toEqual([m.noCommits]);
    commitMsg(repo, 'feat: one');
    commitMsg(repo, 'chore: two');
    expect(cl(repo, '--check')).toBe(0);
    expect(cl(repo, '--unreleased')).toBe(0);
    expect(out.join('\n')).toMatch(/^## Unreleased — 2 commits, no release tag yet\n\n### Features\n\n- one `[0-9a-f]{8}`\n\n_1 internal /);
  });

  it('writes by default, reports non-semver tags, and a second run changes no byte', () => {
    const repo = repoAt();
    commitMsg(repo, 'feat: one');
    tag(repo, 'v1.0.0', 'released: 2026-10-15');
    tag(repo, 'v1.1.0-rc1');
    expect(cl(repo)).toBe(0);
    expect(out).toEqual([m.regenerated('CHANGELOG.md', 1)]);
    expect(err).toEqual([m.skippedTag('v1.1.0-rc1')]);
    const first = read(repo);
    expect(first).toBe(generate(repo.root).text);
    const mtime = fs.statSync(path.join(repo.root, 'CHANGELOG.md')).mtimeMs;
    expect(cl(repo)).toBe(0);
    expect(read(repo)).toBe(first);
    expect(fs.statSync(path.join(repo.root, 'CHANGELOG.md')).mtimeMs).toBe(mtime);
    expect(cl(repo, '--check')).toBe(0);
    expect(out).toEqual([m.check.current('CHANGELOG.md', 1)]);
  });

  it('--check fails on a missing, an unmarked and a hand-edited file', () => {
    const repo = repoAt();
    commitMsg(repo, 'feat: one');
    tag(repo, 'v1.0.0');
    expect(cl(repo, '--check')).toBe(1);
    expect(err).toEqual([m.check.missing('CHANGELOG.md')]);
    write(repo, '# Changelog\n');
    expect(cl(repo, '--check')).toBe(1);
    expect(err).toEqual([m.check.unmarked('CHANGELOG.md')]);
    write(repo, `${generate(repo.root).text}- a hand-written line\n`);
    expect(cl(repo, '--check')).toBe(1);
    expect(err).toEqual([m.check.stale('CHANGELOG.md')]);
  });

  it('refuses to replace a hand-kept changelog unless --adopt is passed', () => {
    const repo = repoAt();
    commitMsg(repo, 'feat: one');
    write(repo, '# Changelog\n\n## Unreleased\n\n- mine\n');
    expect(cl(repo)).toBe(2);
    expect(err).toEqual([m.refused(m.unmarkedRefused('CHANGELOG.md'))]);
    expect(read(repo)).toBe('# Changelog\n\n## Unreleased\n\n- mine\n');
    expect(cl(repo, '--adopt')).toBe(0);
    expect(read(repo)).toBe(TEMPLATE);
  });

  it('writes paths.changelog where the config puts it', () => {
    const repo = repoAt({ paths: { changelog: 'docs/CHANGES.md' } });
    commitMsg(repo, 'feat: one');
    expect(cl(repo)).toBe(0);
    expect(out).toEqual([m.regenerated('docs/CHANGES.md', 0)]);
    expect(read(repo, 'docs/CHANGES.md')).toBe(TEMPLATE);
    expect(fs.existsSync(path.join(repo.root, 'CHANGELOG.md'))).toBe(false);
  });

  it('never writes through a link: the file, or a directory on its path', () => {
    const outside = path.join(TMP, `outside${(n += 1)}`);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'theirs.md'), 'theirs\n');
    const repo = repoAt();
    commitMsg(repo, 'feat: one');
    fs.symlinkSync(path.join(outside, 'theirs.md'), path.join(repo.root, 'CHANGELOG.md'));
    expect(cl(repo, '--adopt')).toBe(2);
    expect(err).toEqual([m.refused(m.symlink('CHANGELOG.md'))]);
    expect(fs.readFileSync(path.join(outside, 'theirs.md'), 'utf8')).toBe('theirs\n');

    const linked = repoAt({ paths: { changelog: 'docs/CHANGELOG.md' } });
    commitMsg(linked, 'feat: one');
    fs.symlinkSync(outside, path.join(linked.root, 'docs'));
    expect(cl(linked, '--adopt')).toBe(2);
    expect(err).toEqual([m.refused(m.symlink('docs'))]);
    expect(fs.readdirSync(outside)).toEqual(['theirs.md']);
  });

  it('--unreleased lists what no release tag holds, never a released maintenance commit', () => {
    const repo = repoAt();
    commitMsg(repo, 'feat: base');
    tag(repo, 'v1.0.0');
    expect(cl(repo, '--unreleased')).toBe(0);
    expect(out).toEqual([m.nothingUnreleased('v1.0.0')]);
    run(repo.root, 'git', ['checkout', '-q', '-b', 'maint']);
    const F = commitMsg(repo, 'fix: maintenance');
    tag(repo, 'v1.1.1');
    run(repo.root, 'git', ['checkout', '-q', 'main']);
    commitMsg(repo, 'feat: two');
    tag(repo, 'v2.0.0');
    run(repo.root, 'git', ['merge', '-q', '--no-ff', '--no-edit', 'maint']);
    const B = commitMsg(repo, 'fix: after merge');
    expect(cl(repo, '--unreleased')).toBe(0);
    const printed = out.join('\n');
    expect(printed).toMatch(/^## Unreleased — 2 commits since v2\.0\.0\n/);
    expect(printed).toContain(B.slice(0, 8));
    expect(printed).not.toContain(F.slice(0, 8));
    expect(printed).toContain('_1 internal ');
    expect(cl(repo)).toBe(0);
    expect(err).toEqual([m.notAncestor('v1.1.1', 'v2.0.0')]);
  });

  it('refuses two modes, a positional, a flag value or an unknown flag with the usage, exit 2', () => {
    const repo = repoAt();
    for (const argv of [['--check', '--adopt'], ['x'], ['--check', 'x'], ['--bogus']]) {
      expect(cl(repo, ...argv)).toBe(2);
      expect(err.at(-1)).toMatch(/usage: npx cookwright changelog \[--check \| --unreleased \| --adopt\]$/);
    }
    expect(fs.existsSync(path.join(repo.root, 'CHANGELOG.md'))).toBe(false);
  });

  it('refuses outside a work tree and without a config', () => {
    const bare = path.join(TMP, `plain${(n += 1)}`);
    fs.mkdirSync(bare);
    expect(main(['--check'], { cwd: bare })).toBe(2);
    const root = gitInit(path.join(TMP, `r${(n += 1)}`));
    expect(main(['--check'], { cwd: root })).toBe(2);
    expect(err.at(-1)).toMatch(/^changelog: no cookwright\.json at or above /);
  });

  it('refuses a HEAD that names no commit and is no unborn branch, never an empty changelog', () => {
    const repo = repoAt();
    commitMsg(repo, 'feat: one');
    tag(repo, 'v1.0.0');
    expect(cl(repo)).toBe(0);
    const before = read(repo);
    const ref = path.join(repo.root, '.git/refs/heads/main');
    expect(fs.existsSync(ref)).toBe(true);
    fs.writeFileSync(ref, 'not a sha\n');
    expect(() => releaseTags(repo.root)).toThrow(Refusal);
    for (const argv of [[], ['--check'], ['--unreleased']]) {
      expect(cl(repo, ...argv)).toBe(2);
      expect(err).toEqual([expect.stringMatching(/^changelog: git symbolic-ref failed: \S/)]);
    }
    expect(read(repo)).toBe(before);
    fs.writeFileSync(path.join(repo.root, '.git/HEAD'), 'ref: refs/heads/a..b\n');
    expect(() => releaseTags(repo.root)).toThrow(Refusal);
  });
});
