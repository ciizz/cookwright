// src/lib/hooks/docsync.test.mjs — doc-sync's matching on scratch repos: git's own
// pathspecs over the staged files, through `git diff --cached` only (plan §4.1, §6).

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { commit, run, scratchRepo, scratchRoot } from '../../test-helpers.mjs';
import { PACKS } from '../packs/registry.mjs';
import { stagedMatching, unmetRules } from './docsync.mjs';

const TMP = scratchRoot('cookwright-docsync-');
const ENV = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
  GIT_CONFIG_NOSYSTEM: '1',
};
let n = 0;
const repoAt = () => scratchRepo(TMP, `r${(n += 1)}`);

/** Write `files` and stage exactly them. */
function stage(repo, files) {
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo.root, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo.root, rel), body);
  }
  run(repo.root, 'git', ['add', '--', ...Object.keys(files)]);
}

const RULE = {
  name: 'playbook',
  code: ['src/lib/bundle/*', ':!*.test.mjs'],
  docs: ['docs/playbook.md', 'skills/bundle/SKILL.md'],
};
const unmet = (repo, env = ENV) => unmetRules(repo.root, [RULE], env);

describe('stagedMatching', () => {
  it('matches the staged files by git pathspec: `*` crosses `/`, a leading-star exclude holds', () => {
    const repo = repoAt();
    commit(repo, { 'README.md': 'x' }, 'init');
    stage(repo, { 'src/lib/bundle/deep/a.mjs': 'a', 'src/lib/bundle/a.test.mjs': 't', 'other.mjs': 'o' });
    expect(stagedMatching(repo.root, RULE.code, { env: ENV, rule: 'r' })).toEqual(['src/lib/bundle/deep/a.mjs']);
    expect(stagedMatching(repo.root, ['*.mjs'], { env: ENV, rule: 'r' }).sort()).toEqual([
      'other.mjs',
      'src/lib/bundle/a.test.mjs',
      'src/lib/bundle/deep/a.mjs',
    ]);
  });

  it('sees nothing that is only in the working tree', () => {
    const repo = repoAt();
    commit(repo, { 'src/lib/bundle/a.mjs': 'a' }, 'init');
    fs.writeFileSync(path.join(repo.root, 'src/lib/bundle/a.mjs'), 'changed, not staged');
    expect(unmet(repo)).toEqual([]);
  });

  it('throws naming the rule and git’s stderr on a pathspec git refuses', () => {
    const repo = repoAt();
    commit(repo, { 'README.md': 'x' }, 'init');
    expect(() => stagedMatching(repo.root, [':(glob,literal)x'], { env: ENV, rule: 'r' })).toThrow(/^r: fatal: /);
  });
});

describe('unmetRules', () => {
  it('fails a rule whose code is staged without a doc, and passes it with one', () => {
    const repo = repoAt();
    commit(repo, { 'README.md': 'x' }, 'init');
    stage(repo, { 'src/lib/bundle/gate.mjs': 'g' });
    expect(unmet(repo)).toEqual([
      'playbook: 1 file(s) changed (src/lib/bundle/gate.mjs), but none of docs/playbook.md, skills/bundle/SKILL.md is staged',
    ]);
    stage(repo, { 'skills/bundle/SKILL.md': 's' });
    expect(unmet(repo)).toEqual([]);
  });

  it('leaves a component’s tests and snapshots out of the expo pack’s design-doc rule', () => {
    const rule = PACKS.expo.rules.find((r) => r.id === 'design-doc').docSync;
    const repo = repoAt();
    commit(repo, { 'README.md': 'x' }, 'init');
    stage(repo, {
      'components/__tests__/ThemedText-test.tsx': 't',
      'components/__tests__/__snapshots__/ThemedText-test.tsx.snap': 's',
      'src/components/__snapshots__/Card.tsx.snap': 's',
      'components/Button.test.tsx': 't',
    });
    expect(unmetRules(repo.root, [rule], ENV)).toEqual([]);
    stage(repo, { 'components/Button.tsx': 'b' });
    expect(unmetRules(repo.root, [rule], ENV)).toEqual([
      'expo:design-doc: 1 file(s) changed (components/Button.tsx), but none of docs/design-system.md is staged',
    ]);
  });

  it('passes code staged only under an excluded pathspec', () => {
    const repo = repoAt();
    commit(repo, { 'README.md': 'x' }, 'init');
    stage(repo, { 'src/lib/bundle/gate.test.mjs': 't' });
    expect(unmet(repo)).toEqual([]);
  });

  it('counts a deleted code file, and a rename out of the watched path', () => {
    const repo = repoAt();
    commit(repo, { 'src/lib/bundle/a.mjs': 'a\n'.repeat(20), 'src/lib/bundle/b.mjs': 'b' }, 'init');
    run(repo.root, 'git', ['rm', '-q', 'src/lib/bundle/b.mjs']);
    expect(unmet(repo)[0]).toMatch(/^playbook: 1 file\(s\) changed \(src\/lib\/bundle\/b\.mjs\)/);
    run(repo.root, 'git', ['reset', '-q', '--hard']);
    fs.mkdirSync(path.join(repo.root, 'lib'));
    run(repo.root, 'git', ['mv', 'src/lib/bundle/a.mjs', 'lib/a.mjs']);
    expect(unmet(repo)[0]).toMatch(/^playbook: 1 file\(s\) changed \(src\/lib\/bundle\/a\.mjs\)/);
  });

  it('works on an unborn HEAD', () => {
    const repo = repoAt();
    stage(repo, { 'src/lib/bundle/a.mjs': 'a' });
    expect(unmet(repo)).toHaveLength(1);
    stage(repo, { 'docs/playbook.md': 'p' });
    expect(unmet(repo)).toEqual([]);
  });

  it('judges the index GIT_INDEX_FILE names, as in a partial commit', () => {
    const repo = repoAt();
    commit(repo, { 'README.md': 'x' }, 'init');
    const index = path.join(repo.root, '.git/partial-index');
    const env = { ...ENV, GIT_INDEX_FILE: index };
    run(repo.root, 'git', ['read-tree', `--index-output=${index}`, 'HEAD']);
    fs.mkdirSync(path.join(repo.root, 'src/lib/bundle'), { recursive: true });
    fs.writeFileSync(path.join(repo.root, 'src/lib/bundle/a.mjs'), 'a');
    run(repo.root, 'git', ['update-index', '--add', 'src/lib/bundle/a.mjs']);
    // Staged in the real index; the partial one holds HEAD only, so nothing is unmet there.
    expect(unmet(repo)).toHaveLength(1);
    expect(unmet(repo, env)).toEqual([]);
  });

  it('names five files, then an ellipsis', () => {
    const repo = repoAt();
    commit(repo, { 'README.md': 'x' }, 'init');
    stage(repo, Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [`src/lib/bundle/f${i}.mjs`, `${i}`])));
    const [line] = unmet(repo);
    expect(line).toMatch(/^playbook: 6 file\(s\) changed \(src\/lib\/bundle\/f1\.mjs, .*f5\.mjs, …\), but none/);
  });
});
