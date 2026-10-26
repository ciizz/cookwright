# B-018 — A user's own lint run must not fail on the harness's pointers

Written 2026-10-26 from backlog entry B-018, found by stage 4's QA (b) on a fresh scaffold with cookwright 0.2.0 from npm. A patch release, 0.2.1.

## 1. Context

After `npx cookwright init` on an Expo app, the user's own lint run fails. `npx expo lint` (the scaffold's `npm run lint`, and the editor's view) lints the two workflow pointers init writes, `.claude/workflows/bundle-phase.js` and `.claude/workflows/docs-audit.js`: symbolic links into the package, `.js` files whose scripts have a top-level `return`. ESLint reports `Parsing error: 'return' outside of function` for each and exits 1. Measured on 2026-10-26: 2 parsing errors plus the scaffold's own literal string in `App.tsx`.

Why the pack's ignores do not help (*measured*, `packs/expo/eslint.cjs`, `packs/supabase/eslint.cjs`): every block sets `files` and `rules` beside its `ignores`, and in flat config an `ignores` beside other keys only narrows that block. Only a config object whose sole key is `ignores` is a global ignore. The hook and the ratchet are unaffected: they never lint a symbolic link (stage-4 disposition 19) and lint named blobs, not the tree.

What the engine does with the export's blocks (*measured*, `src/lib/packs/standards.mjs`): `coverage()` keeps a block only when `b.rules && id in b.rules` for one of the rule's ESLint ids, so a block with no `rules` is dropped before `wiring()`, `scopeAt()` and `changedAt()` see it. The engine needs no change. `src/lib/packs/glob.mjs`'s `blockCovers` already treats an absent `files` as "every file". Doctor's `pack.<name>.lint` row is a text match on the export's path and does not read blocks. Init's `eslintConfigStep` inserts the two spread lines and does not read blocks.

`src/lib/packs/eslint.test.mjs` (*measured*) asserts for every block: a name `cookwright/<pack>/<rule>[/<part>]`, keys among `name, files, ignores, plugins, rules`, `ignores` containing `HARNESS`; test 55 flat-maps `Object.keys(b.rules)` over the other blocks (a block with no `rules` throws); its own `applies()` reads `block.files` without the absent-files case. These change with the export.

## 2. Decisions

Dispositions by the Judgment rules, recorded with `bundle decide` at kickoff:

1. Rule 4 (imported, never copied): the ignore ships inside each pack's export as its first block, `{ name: 'cookwright/<pack>/ignores', ignores: ['.claude/**', '.agents/**', '.codex/**'] }`, with no other key, so it is a global ignore wherever the spread lands. Both packs carry it, since a repo may spread one; two identical global ignores are harmless. Nothing is written into the user's config beyond the spread lines init already writes.
2. Rule 3 (claim what was measured): the global block ignores the three pointer directories only. `node_modules/**` is ESLint's own default ignore, and `**/*.test.*` and `**/__tests__/**` stay per-block: a user's lint run of their tests is theirs, the pack only keeps its rules off them.
3. Rule 6 (wanted twice): a repo with ESLint and the pointers but no pack (a non-Expo app) has the same defect and no export to carry the fix. Not observed yet; logged as E-056 with the proposal (the setup skill offers a `{ ignores: ['.claude/**', '.agents/**', '.codex/**'] }` line into an existing config when `host.pointers` finds a workflow pointer and an `eslint.config.*` that does not name `.claude`), built when it is met.
4. Rule 3: the real-ESLint proof is the fixture, as stage 4 decided (disposition 25): after init it runs `npx eslint . --format json` on the scaffold and asserts that no reported file lies under `.claude/`, and that `App.tsx` is reported under `i18next/no-literal-string`, which also shows the pack's rules reach the user's own run. The unit test asserts the block's shape and that it covers the pointer paths.
5. Rule 3: the standards guide gains the sentence a user needs: their own lint run reports every violation at error severity, legacy ones included, since that run is the editor's view; the hook and the gate judge only the change. One sentence, in "Where they are measured".

## 3. Scope

In: the two exports, their test, the fixture step, the guide sentence, the backlog (B-018 closed, E-056 opened), the closeout. Out: the non-pack repo (E-056), the hook and the engine (unaffected, measured), doctor rows, init.

## 4. Design

- `packs/expo/eslint.cjs`: `const POINTERS = ['.claude/**', '.agents/**', '.codex/**']`; `IGNORES` becomes `[...POINTERS, 'node_modules/**', '**/*.test.*', '**/__tests__/**']` (bytes of the per-block ignores unchanged); `const ignores = { name: 'cookwright/expo/ignores', ignores: POINTERS }`; `blocks(plugin)` returns `[ignores, ...(plugin ? [strings(plugin)] : []), tokens, ...size]`. The header comment gains the paragraph on global ignores (why a rules-less block, what it ignores and what it leaves to the user).
- `packs/supabase/eslint.cjs`: the same `POINTERS`, a first block `cookwright/supabase/ignores`.
- `src/lib/packs/eslint.test.mjs`: the shape test allows the ignores block (`name` and `ignores` only, `ignores` exactly `POINTERS`, first in the array) and keeps the rules-only assertion for the others; `applies()` mirrors `blockCovers` (`!block.files || …`); test 55 flat-maps `Object.keys(b.rules ?? {})`; a new test: the ignores block is the first element of each export and `withResolver` and `coverage` keep it; `blockCovers(ignores, '.claude/workflows/bundle-phase.js')` is false for every block and the ignores block's `ignores` match the three pointer paths init writes (`.claude/workflows/x.js`, `.agents/skills/x`, `.codex/x`); the engine test (`standards.test.mjs`) gains one case: an export with a leading ignores block measures the same as without (coverage drops it).
- `scripts/ci/fixture.sh`: a `lint_run` step after `doctor`: `npx eslint . --format json > "$WORK/lint.json"` (exit 1 expected, the scaffold's literal string), then `node -e` asserts no `filePath` contains `/.claude/` and one result for `App.tsx` carries `ruleId === 'i18next/no-literal-string'`; `fail` otherwise. The header comment lists the step.
- `docs/guides/standards.md`, "Where they are measured": one bullet, **your own lint run** (`npx expo lint`, `npm run lint`, the editor) reports every violation at error severity, legacy ones included, and the pack's export tells ESLint to leave the harness's pointers (`.claude/`, `.agents/`, `.codex/`) alone so that run does not fail on them; the hook and the gate judge only the change.
- Messages: none (no user-facing string changes; the block name is config).

## 5. Files

Changed: `packages/cookwright/packs/expo/eslint.cjs`, `packages/cookwright/packs/supabase/eslint.cjs`, `packages/cookwright/src/lib/packs/eslint.test.mjs`, `packages/cookwright/src/lib/packs/standards.test.mjs` (one case), `scripts/ci/fixture.sh`, `docs/guides/standards.md`, `docs/dev/backlog.md`, `README.md` (the packs status row drops its B-018 clause). New: `docs/dev/closeouts/b-018.md`.

## 6. Tests

- Export shape: first block named `cookwright/<pack>/ignores`, keys `name` and `ignores` only, ignores exactly the three pointer globs; every other block unchanged (names, files, ignores, rules as today).
- Coverage: `blockCovers` false for `.claude/workflows/bundle-phase.js` under every block; the pointer paths of `.agents/` and `.codex/` likewise.
- Engine: `coverage([item])` returns the same blocks with the ignores block present as without; one existing fake-ESLint measurement repeated through the real export (its blocks already come from the `.cjs`).
- Fixture: the lint-run step as in §4; a failing run names the first `.claude` path reported.

## 7. Verification

`npm test` (count measured at the session end); `bash scripts/ci/fixture.sh` locally with real ESLint 9.39.5, the new step green; in the scratch Expo tree from the QA (b) refresh (cookwright installed from this branch's tarball), `npx expo lint` reports only `App.tsx`'s literal string and no `.claude` file, exit 1 for that one legacy error; `npx cookwright standards` and a staged-file hook run unchanged. Then CI on the branch.

## 8. State homes

Backlog: B-018 closed with the commit; E-056 opened (disposition 3). README: the packs row reads `works; 0.2.0 on npm` plus `0.2.1 fixes your own lint run` until the release, then the refreshed row. Closeout `docs/dev/closeouts/b-018.md` with the numbers. Charter unchanged.

## 9. Release, the developer's hands, after the merge

`docs/guides/releases-and-changelog.md`'s order at 0.2.1: `npm version 0.2.1 --no-git-tag-version` in `packages/cookwright`, the release commit, `git tag -a v0.2.1 -m 'released: <date>' -m 'note: Your own lint run no longer fails on the harness pointers (B-018).'`, `npx cookwright changelog`, its commit, `git push --follow-tags`, `npm publish --workspace packages/cookwright`.

## 10. Split

One slice, `fix`, one session `s1`: §4 whole. Checkpoints: the two exports with the shape and coverage tests green; the engine case; the fixture step green locally; the guide bullet and the backlog. Then `review:fix`, `fix:fix`, `review:whole` (the same range, kept for the runner's landing rule), QA (the fresh-scaffold lint run above, recorded as one round), closeout. Base branch `main`; bundle branch `bundle/b-018`.
