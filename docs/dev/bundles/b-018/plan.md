# B-018 — A user's own lint run must not fail on the harness's pointers

Written 2026-10-26 from backlog entry B-018, found by stage 4's QA (b) on a fresh scaffold with cookwright 0.2.0 from npm. Revised the same day after one adversarial read (2 P1, 1 P2, 5 P3, all folded: dispositions 6 to 10). A patch release, 0.2.1.

## 1. Context

After `npx cookwright init` on an Expo app, the user's own lint run fails. `npx expo lint` (the scaffold's `npm run lint`, and the editor's view) lints the two workflow pointers init writes, `.claude/workflows/bundle-phase.js` and `.claude/workflows/docs-audit.js`: symbolic links into the package, `.js` files whose scripts have a top-level `return`. ESLint reports `Parsing error: 'return' outside of function` for each and exits 1. Measured on 2026-10-26: 2 parsing errors plus the scaffold's own literal string in `App.tsx`.

Why the pack's ignores do not help (*measured*, `packs/expo/eslint.cjs`, `packs/supabase/eslint.cjs`): every block sets `files` and `rules` beside its `ignores`, and in flat config an `ignores` beside other keys only narrows that block. Only a config object whose sole key is `ignores` is a global ignore. The hook and the ratchet are unaffected: they never lint a symbolic link (stage-4 disposition 19) and lint named blobs, not the tree.

What the engine does with the export's blocks (*measured*, `src/lib/packs/standards.mjs`): `coverage()` keeps a block only when `b.rules && id in b.rules` for one of the rule's ESLint ids, so a block with no `rules` is dropped before `wiring()`, `scopeAt()` and `changedAt()` see it. The engine needs no change. `src/lib/packs/glob.mjs`'s `blockCovers` already treats an absent `files` as "every file". Doctor's `pack.<name>.lint` row is a text match on the export's path and does not read blocks. Init's `eslintConfigStep` inserts the two spread lines and does not read blocks.

What init writes under the host directories (*measured*, `src/lib/hosts.mjs`): `.claude/workflows/<name>.js` (symbolic links to the package's workflow scripts, whose format has a top-level `return` that ESLint cannot parse), `.claude/skills/<name>` and `.agents/skills/<name>` (links to directories holding one `SKILL.md` each), and `.codex/hooks.json`. Only the workflow pointers are files ESLint lints. A user's own files live in the same host directories (`.claude/hooks/*.ts`, their own skills' scripts) and are linted by their own config today; a user's own workflow script under `.claude/workflows/` shares the format and fails the same way.

`src/lib/packs/eslint.test.mjs` (*measured*) asserts for every block: a name `cookwright/<pack>/<rule>[/<part>]`, keys among `name, files, ignores, plugins, rules`, `ignores` containing `HARNESS`; test 55 flat-maps `Object.keys(b.rules)` over the other blocks (a block with no `rules` throws); its own `applies()` reads `block.files` without the absent-files case; the attributes test reads `EXPORTS.expo[0]` as the strings block, the supabase describe destructures `const [client] = supabaseExport`, and the glob-subset test spreads `block.files`. All of these change with the export (disposition 9).

## 2. Decisions

Dispositions by the Judgment rules, recorded with `bundle decide` at kickoff:

1. Rule 4 (imported, never copied): the ignore ships inside each pack's export as its first block, `{ name: 'cookwright/<pack>/ignores', ignores: ['.claude/workflows/**'] }`, with no other key, so it is a global ignore wherever the spread lands. Both packs carry it, since a repo may spread one; two identical global ignores are harmless. Nothing is written into the user's config beyond the spread lines init already writes.
2. Rule 3 (claim what was measured) and review finding 3: the global block ignores Claude Code's workflow directory only, `.claude/workflows/**`, the one place init writes a file ESLint lints and the one format ESLint cannot parse; a user's own workflow script there is ignored for the same reason, which the guide and the header say. Nothing else of the host directories is ignored globally: `.claude/hooks/*.ts` and a user's own skills' scripts stay linted by their own config, `.claude/skills/<name>` and `.agents/skills/<name>` are directories of Markdown, `.codex/` holds `hooks.json`. The per-block `IGNORES` keep their bytes (`.claude/**`, `.agents/**`, `.codex/**`, `node_modules/**`, the test globs): they only keep the pack's rules off those paths, as today. `node_modules/**` is ESLint's own default ignore.
3. Rule 6 (wanted twice): a repo with ESLint and the pointers but no pack (a non-Expo app) has the same defect and no export to carry the fix. Not observed yet; logged as E-056 with the proposal (the setup skill offers a `{ ignores: ['.claude/**', '.agents/**', '.codex/**'] }` line into an existing config when `host.pointers` finds a workflow pointer and an `eslint.config.*` that does not name `.claude`), built when it is met.
4. Rule 3: the real-ESLint proof is the fixture, as stage 4 decided (disposition 25): after init it runs `npx eslint . --format json` on the scaffold and asserts that no reported file lies under `.claude/`, and that `App.tsx` is reported under `i18next/no-literal-string`, which also shows the pack's rules reach the user's own run. The unit test asserts the block's shape and that it covers the pointer paths.
5. Rule 3: the standards guide gains the sentence a user needs: their own lint run reports every violation at error severity, legacy ones included, since that run is the editor's view; the hook and the gate judge only the change. One sentence, in "Where they are measured".

Dispositions from the adversarial read, 2026-10-26:

6. Rule 3 (findings 0 and 5, P1 and P3): the fixture runs under `set -euo pipefail`, so the lint-run step captures the exit (`code=0; npx eslint . --format json > "$WORK/lint.json" || code=$?`) and accepts only 0 or 1, failing on 2 or more (a config failure) before it parses the JSON; its failure texts are `MSG_` strings like the script's others. A negative control is part of the verification (§7): the step run once against the 0.2.0 export fails naming `.claude/workflows/bundle-phase.js`, so the assertion is known to measure the fix.
7. The state-homes rule of `AGENTS.md` (findings 2 and 6, P3): the README row describes what npm serves, `works; 0.2.0 on npm; your own lint run fails on the workflow pointers in 0.2.0, fixed on main (B-018)`, and is refreshed to `works; 0.2.1 on npm` in the release commit (§9), never ahead of the publish.
8. Rule 3 (finding 3, P2): the global ignore is `.claude/workflows/**` only, disposition 2 as revised; a test asserts the ignores block matches `.claude/workflows/bundle-phase.js` and not `.claude/hooks/x.ts`, `.claude/skills/mine/index.ts` or `.agents/skills/mine/index.ts`.
9. Rule 3 (findings 1 and 4, P1 and P3): the test file's position and shape assumptions are listed in §4: the strings block and the supabase client block are found by name, never by index; the glob-subset test iterates `block.files ?? []`; `applies()` and the coverage assertions consider only blocks with `rules`, which is what the engine's `coverage()` does, so the ignores block is never read as covering a file.
10. Finding 7 (P3): the supabase export's header is rewritten in the same commit (two blocks, the first a global ignore, pointing at the expo header's paragraph).

## 3. Scope

In: the two exports, their test, the fixture step, the guide sentence, the backlog (B-018 closed, E-056 opened), the closeout. Out: the non-pack repo (E-056), the hook and the engine (unaffected, measured), doctor rows, init, the user's own files under the host directories (never ignored, disposition 2).

## 4. Design

- `packs/expo/eslint.cjs`: `const WORKFLOWS = ['.claude/workflows/**']`; `IGNORES` unchanged; `const ignores = { name: 'cookwright/expo/ignores', ignores: WORKFLOWS }`; `blocks(plugin)` returns `[ignores, ...(plugin ? [strings(plugin)] : []), tokens, ...size]`. The header comment gains the paragraph on the global ignore: a rules-less block is a global ignore in flat config; it covers Claude Code's workflow scripts, whose format ESLint cannot parse, the package's pointers among them; nothing else of the user's host directories, which their own config keeps linting.
- `packs/supabase/eslint.cjs`: the same `WORKFLOWS`, a first block `cookwright/supabase/ignores`; its header rewritten: two blocks, the first the global ignore, pointing at the expo header's paragraph (disposition 10).
- `src/lib/packs/eslint.test.mjs` (disposition 9): the shape test allows the ignores block (`name` and `ignores` only, `ignores` exactly `['.claude/workflows/**']`, first in the array) and keeps the rules-only assertion for the others; the strings block is found by `name === 'cookwright/expo/strings'` and the supabase client block by `name === 'cookwright/supabase/client'` wherever the file indexed or destructured; the glob-subset test iterates `block.files ?? []`; `applies()` returns false for a block without `rules`, and the rule-application and coverage assertions filter to blocks with `rules`, as the engine's `coverage()` does; test 55 flat-maps `Object.keys(b.rules ?? {})`. New tests: the ignores block is the first element of each export and survives `withResolver` and `coverage`; its pattern matches `.claude/workflows/bundle-phase.js` and `.claude/workflows/mine.js` and matches none of `.claude/hooks/x.ts`, `.claude/skills/mine/index.ts`, `.agents/skills/mine/index.ts`, `.codex/hooks.json` (disposition 8); `blockCovers` is false for the pointer path under every rules block. The engine test (`standards.test.mjs`) gains one case: `coverage()` over the real export returns the same blocks as over the export with its first element removed.
- `scripts/ci/fixture.sh` (disposition 6): a `lint_run` step after `doctor`: `code=0; npx eslint . --format json > "$WORK/lint.json" || code=$?`; `[ "$code" -le 1 ] || fail` (2 or more is ESLint failing to run, the message naming the code and the file's stderr tail); then `node -e` over `lint.json` asserts no `filePath` contains `/.claude/` (the failure text names the first such path) and that one result for `App.tsx` carries a message with `ruleId === 'i18next/no-literal-string'`; the three failure texts are `MSG_` strings. The header comment lists the step.
- `docs/guides/standards.md`, "Where they are measured": one bullet, **your own lint run** (`npx expo lint`, `npm run lint`, the editor) reports every violation at error severity, legacy ones included; the hook and the gate judge only the change. The pack's export also tells ESLint to ignore `.claude/workflows/`, Claude Code's workflow scripts, whose format (a top-level `return`) ESLint cannot parse, the package's pointers among them; your other files under `.claude/` stay linted as your config says.
- Messages: none (no user-facing string changes; the block name is config).

## 5. Files

Changed: `packages/cookwright/packs/expo/eslint.cjs`, `packages/cookwright/packs/supabase/eslint.cjs`, `packages/cookwright/src/lib/packs/eslint.test.mjs`, `packages/cookwright/src/lib/packs/standards.test.mjs` (one case), `scripts/ci/fixture.sh`, `docs/guides/standards.md`, `docs/dev/backlog.md`, `README.md` (the packs status row per disposition 7). New: `docs/dev/closeouts/b-018.md`.

## 6. Tests

- Export shape: first block named `cookwright/<pack>/ignores`, keys `name` and `ignores` only, ignores exactly the three pointer globs; every other block unchanged (names, files, ignores, rules as today).
- Coverage: `blockCovers` false for `.claude/workflows/bundle-phase.js` under every block; the pointer paths of `.agents/` and `.codex/` likewise.
- Engine: `coverage([item])` returns the same blocks with the ignores block present as without; one existing fake-ESLint measurement repeated through the real export (its blocks already come from the `.cjs`).
- Fixture: the lint-run step as in §4; a failing run names the first `.claude` path reported, or ESLint's exit code when it is 2 or more.
- Ignores pattern: matches the workflow pointer paths, matches no other host-directory path (disposition 8).

## 7. Verification

`npm test` (count measured at the session end); `bash scripts/ci/fixture.sh` locally with real ESLint 9.39.5, the new step green, and once as the negative control with the ignores block removed from the exports in the installed tarball's copy (or the 0.2.0 tarball), the step failing and naming `.claude/workflows/bundle-phase.js` (disposition 6), the result on the closeout line; in the scratch Expo tree from the QA (b) refresh (cookwright installed from this branch's tarball), `npx expo lint` reports only `App.tsx`'s literal string and no `.claude` file, exit 1 for that one legacy error; `npx cookwright standards` and a staged-file hook run unchanged. Then CI on the branch.

## 8. State homes

Backlog: B-018 closed with the commit; E-056 opened (disposition 3). README: the packs row reads `works; 0.2.0 on npm; your own lint run fails on the workflow pointers in 0.2.0, fixed on main (B-018)` until the release commit refreshes it to `works; 0.2.1 on npm` (disposition 7). Closeout `docs/dev/closeouts/b-018.md` with the numbers. Charter unchanged.

## 9. Release, the developer's hands, after the merge

`docs/guides/releases-and-changelog.md`'s order at 0.2.1: `npm version 0.2.1 --no-git-tag-version` in `packages/cookwright`, the release commit, `git tag -a v0.2.1 -m 'released: <date>' -m 'note: Your own lint run no longer fails on the harness pointers (B-018).'`, the README packs row refreshed in the release commit, `npx cookwright changelog`, its commit, `git push --follow-tags`, `npm publish --workspace packages/cookwright`.

## 10. Split

One slice, `fix`, one session `s1`: §4 whole. Checkpoints: the two exports with the shape and coverage tests green; the engine case; the fixture step green locally; the guide bullet and the backlog. Then `review:fix`, `fix:fix`, `review:whole` (the same range, kept for the runner's landing rule), QA (the fresh-scaffold lint run above, recorded as one round), closeout. Base branch `main`; bundle branch `bundle/b-018`.
