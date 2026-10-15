// src/changelog.test.mjs — the changelog generator on scratch repos: the release
// tags and their metadata, the commits between them, the render, the file's state,
// and the command's four modes (plan §4.4, §6).

import fs from 'node:fs';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { parseMeta, rawTags, releaseTags, tagMeta } from './lib/changelog/tags.mjs';
import { commit, run, scratchRepo, scratchRoot } from './test-helpers.mjs';

const TMP = scratchRoot('cookwright-changelog-');

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

  it('ends a value at a blank line or the next key, and drops a signature block', () => {
    const body = 'store: live\n\norphan line\nnote:\nlater\n-----BEGIN PGP SIGNATURE-----\nkey: x\n';
    expect(parseMeta(body)).toEqual([
      { key: 'store', lines: ['live'] },
      { key: 'note', lines: ['later'] },
    ]);
  });

  it('reads CRLF bodies like LF ones', () => {
    expect(parseMeta('released: 2026-10-15\r\nnote: x\r\n')).toEqual([
      { key: 'released', lines: ['2026-10-15'] },
      { key: 'note', lines: ['x'] },
    ]);
  });
});
