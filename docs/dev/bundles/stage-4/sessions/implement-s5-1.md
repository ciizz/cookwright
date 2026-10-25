# implement:s5 — session report

_Stored as the session returned it; the orchestrator verifies before relying on it._

## Commits
- `33539db feat(standards): the branch ratchet, against the pushed ref's remote commit`
- `0defa63 feat(standards): the supabase types measure and its doctor row`
- `3efe804 feat(gate): a check's skipExit, and the note it records on every outcome`
- `8e823df feat(doctor): the pack.<name>.lint row, ESLint and the export it names`

## Files
- `packages/cookwright/src/lib/packs/base.mjs`
- `packages/cookwright/src/lib/packs/types.mjs`
- `packages/cookwright/src/lib/packs/standards.mjs`
- `packages/cookwright/src/lib/packs/entries.mjs`
- `packages/cookwright/src/standards.mjs`
- `packages/cookwright/src/standards.test.mjs`
- `packages/cookwright/src/lib/hooks/push.mjs`
- `packages/cookwright/src/lib/hooks/registry.mjs`
- `packages/cookwright/src/hook.test.mjs`
- `packages/cookwright/src/lib/messages.mjs`
- `packages/cookwright/src/lib/doctor/packs.mjs`
- `packages/cookwright/src/lib/init/packs.mjs`
- `packages/cookwright/src/doctor.test.mjs`
- `packages/cookwright/src/lib/bundle/gate.mjs`
- `packages/cookwright/src/lib/bundle/messages.mjs`
- `packages/cookwright/src/lib/bundle/check.mjs`
- `packages/cookwright/src/lib/bundle/closeout.mjs`
- `packages/cookwright/src/bundle.test.mjs`
- `packages/cookwright/docs/playbook.md`
- `scripts/ci/fixture.sh`

## User-facing strings
| key | text | context |
|---|---|---|
| `messages.standards.usage` | usage: npx cookwright standards [--staged | --ratchet [--base <ref>] | --types [--base <ref>]] | standards command usage refusal (changed), stderr, exit 2 |
| `messages.standards.noBase` | skipped, no base to ratchet against (tried: ${tried, comma-separated}) | --ratchet / --types exit 11 when no base candidate resolves |
| `messages.standards.since` | ${sha first 8} (${label}) | how a line names the base it measured since |
| `messages.standards.base.flag` | --base ${ref} | base candidate label |
| `messages.standards.base.upstream` | ${branch}@{upstream} | base candidate label |
| `messages.standards.base.mergeBase` | merge-base ${branch} HEAD | base candidate label |
| `messages.standards.noChange` | 0 files under a pack's rules changed since ${since} | --ratchet exit 0, nothing to measure |
| `messages.standards.ratchet` | ${changes, comma-separated}; ${parts…} (${n} file(s) since ${since}) | --ratchet exit 0, the gate's recorded note; changes like 'expo strings 2 → 1' |
| `messages.standards.ratchetRose` | a pack rule's count rose since ${since}: ${items, comma-separated} | --ratchet exit 10, first line |
| `messages.standards.risenItem` | ${change} in ${files, first five} | item of ratchetRose |
| `messages.standards.types.off` | skipped, the supabase pack's types rule is not on (packs in cookwright.json) | --types exit 11 |
| `messages.standards.types.noScript` | skipped, no ${script} script in package.json (the types measure reads "db:types": "supabase gen types --local > <path>") | --types exit 11 |
| `messages.standards.types.shape` | skipped, the ${script} script's shape is not recognised (accepted: "db:types": "supabase gen types --local > <path>") | --types exit 11 |
| `messages.standards.types.needsCli` | skipped, needs supabase (brew install supabase/tap/supabase) | --types exit 11; same text as doctor's pack.supabase.types SKIP |
| `messages.standards.types.noChange` | skipped, no migration or types change since ${since} | --types exit 11 |
| `messages.standards.types.stackFailed` | skipped, supabase migration list --local failed: ${detail} (is the local stack running? supabase start) | --types exit 11 |
| `messages.standards.types.stackUnread` | skipped, supabase migration list --local printed no table this measure reads | --types exit 11 |
| `messages.standards.types.stackDiffers` | skipped, local stack differs from HEAD's migrations (${ahead} ahead, ${behind} behind) | --types exit 11 (disposition 46) |
| `messages.standards.types.genFailed` | skipped, supabase gen types failed: ${detail} | --types exit 11 |
| `messages.standards.types.current` | ${file} matches what the local stack generates (measured against the local stack, changes since ${since}) | --types exit 0, the gate's recorded note |
| `messages.standards.types.rose` | ${file} differs from what the local stack generates; run npm run ${script} and commit it (measured against the local stack) | --types exit 10 |
| `messages.hook.push.noBase` | no ratchet base: ${refs, comma-separated} at HEAD have different remote commits | pre-push label appended to the gate and changelog lines when the refs at HEAD disagree |
| `messages.doctor.pack.types.needsCli` | skipped, needs supabase (brew install supabase/tap/supabase) | doctor pack.supabase.types SKIP |
| `messages.doctor.pack.types.noScript` | no ${script} script in package.json; add "db:types": "supabase gen types --local > <path>", the shape the gate's types check reads | doctor pack.supabase.types WARN |
| `messages.doctor.pack.types.shape` | the ${script} script is not the shape the gate's types check reads; use "db:types": "supabase gen types --local > <path>" | doctor pack.supabase.types WARN |
| `messages.doctor.pack.types.ok` | measured by the gate against the local stack (${script} writes ${file}) | doctor pack.supabase.types PASS |
| `messages.doctor.pack.lint.noEslint` | not measured; ${setup} installs ESLint | doctor pack.<name>.lint WARN; setup is 'npx expo lint' or 'npm install --save-dev eslint' |
| `messages.doctor.pack.lint.oldEslint` | not measured; the installed eslint ${version || 'of unknown version'} is older than 9, and the standards need its flat config | doctor pack.<name>.lint WARN |
| `messages.doctor.pack.lint.noConfig` | not measured; no ESLint config (eslint.config.js); ${setup} sets ESLint up, then run npx cookwright init | doctor pack.<name>.lint WARN |
| `messages.doctor.pack.lint.unnamed` | ${file} does not name ${spec}; add ${lines, comma-separated} (the setup skill does it with consent) | doctor pack.<name>.lint WARN; lines are the spread, or the import and spread for an ES module config |
| `messages.doctor.pack.lint.ok` | eslint ${version}; ${file} names ${spec} | doctor pack.<name>.lint PASS (a text match) |
| `messages.doctor.pack.lint.needs` | needs ${install} (${reason}) | doctor pack.<name>.lint WARN tail when a plugin an active rule needs is missing |
| `bundle messages.noCheckRan` | no check ran (every check was skipped: ${items, '; '-separated}) — run setup, or fix gate.checks in cookwright.json | gate refusal (changed: now carries each check's skip line); also the pre-push gate SKIP note |
| `bundle messages.skippedItem` | ${name} (${note}) | item of noCheckRan and of partly |
| `bundle messages.partly` | partly measured: ${items, comma-separated} | passLabel ('pass (skipped: a; partly measured: standards (expo strings: skipped, …))'), bundle status, closeout gate table, and the landing check's bundle.gate-latest WARN |
| `closeout gate table header` | | # | Commit | Slice | Result | Retry of | Notes | | closeout draft gate table (changed: Notes column, 'name: note' joined by '; ', '—' when none) |
| `docs/playbook.md The gate's checks` | A check may also say it skipped after it started, when it opts in with `skipExit`: … The closeout's gate table prints every note. (plus 'naming why each check skipped' in the refusal sentence) | playbook paragraph stating the skipExit convention (disposition 48) |
| `scripts/ci/fixture.sh fail texts` | doctor reported a FAIL, or a WARN besides pack.supabase.types | supabase is on PATH but pack.supabase.types does not WARN for the missing db:types script | supabase is not on PATH but pack.supabase.types does not SKIP naming it | pack.$pack.lint is not PASS with ESLint installed and the export spread | standards --ratchet on main with no upstream exited $code, not 11 | standards --ratchet did not name the base it tried | standards --types without a db:types script exited $code, not 11 | standards --types did not name the missing script | the escaped commit was refused | standards --ratchet on a branch with a new violation exited $code, not 10 | the ratchet's first line does not name both risen rules and the file | the ratchet did not name the colour literal | a ratchet line echoed the literal | the tree is dirty after the branch measures | pre-push exited non-zero with no FAIL | the pre-push gate line does not carry both checks' skip lines | fixture FAIL messages (fail()), developer-facing; step title 'npx cookwright standards --ratchet and --types' |

## Open questions
- Types measure: the accepted script shape also requires `--local` among the args (`"db:types": "supabase gen types --local > <path>"`). A `--linked`, `--project-id` or `--db-url` script reads as 'shape not recognised'. My reason: the precheck reads the local stack and the line says 'measured against the local stack', so a remote generation would make that line false (rule 3). Disposition 40 names only the shape. Is this reading right?
- Types measure: the regeneration is captured from `supabase gen types` stdout in memory and compared with the types file at HEAD (`git show HEAD:./<path>`). No temp file is written. This differs from the letter of §4.6 ('temp-file regeneration'): the bytes are the same and nothing is written (rule 5).
- pushContext (disposition 39): a zero remote sha among the refs at HEAD is ignored. So `git push --follow-tags` with a new tag beside main still gives main's remote commit as the base. Only two different non-zero remote shas give no base, with the label `no ratchet base: main, other at HEAD have different remote commits`. Is ignoring the zero sha right?
- Base order: on the base branch, the merge-base is not a candidate, because it would be HEAD itself and a HEAD-vs-HEAD ratchet always passes. So main with no upstream is exit 11 `tried: main@{upstream}`, as §8 expects. An explicit `--base` naming no commit falls through like every other candidate (disposition 20's letter); the line then names the candidate actually used.
- The ratchet's first line drops the plan example's `standards:` prefix. The gate records the note under the check's name already, so the closeout reads `standards: expo strings 2 → 1, …` once.
- `--ratchet` exits 11 when a changed file could not be measured and no rule rose, mirroring `--staged`. A rise among the measured files is still exit 10, with the unmeasured files on the line.
- Doctor's pack.supabase.types checks the CLI first (SKIP), then the script (WARN). This follows disposition 18's fixture expectation (SKIP off PATH, WARN on it). The command `--types` checks the script first, then the CLI; both orders exit 11. pack.supabase.types appears only while the types rule is on. pack.<name>.lint appears only while an ESLint rule of the pack is on.
- The checkpoint 'init's template edit, byte-tested against Expo's eslint.config.js' was not redone. It was met by db036c4 in s2, as the orchestrator recorded (implement:s2 open question 1). init.test.mjs's 'stack packs: eslint.config.js' block holds the byte tests.
- Until s6, a pack.<name>.lint or pack.supabase.types row that is not PASS ends a setup-skill walkthrough with no recipe. The setup skill's pack recipe rows are s6's. skills.test.mjs requires only the static CHECKS keys, so nothing failed.
- The standards guide (the exit-11 convention, `--ratchet`/`--types` and the types shape) and the hooks-and-escapes guide are s6/s7's, as planned. No doc-sync rule of this repo covers this session's non-bundle paths. The bundle paths were staged with docs/playbook.md's 'The gate's checks' section (disposition 48).

## Notes
Four of the five checkpoints are committed, each staging named paths only. The fifth, init's eslint.config.js edit, was already met by db036c4 in s2 (the orchestrator recorded this), so it was not redone. Every commit went through the hooks (core.hooksPath is .githooks): secrets PASS, doc-sync PASS, and standards SKIP because this repo declares no packs.

Measured at the end of the session:
- `npm test`: 24 files, 662 tests passed (637 at the start).
- `bash scripts/ci/fixture.sh` passed twice on Node 20.19.4 with gitleaks and the real ESLint 9.39.5:
  - With supabase 2.98.1 on PATH: `28 checks — 27 PASS, 0 FAIL, 1 WARN, 0 SKIP`. The one WARN is `pack.supabase.types` (the overlay has no db:types script).
  - Without supabase, using a PATH built in the scratchpad: `28 checks — 27 PASS, 0 FAIL, 0 WARN, 1 SKIP`, the SKIP being `pack.supabase.types`.
  - Both runs: `level 0 declared: complete`, and both lint rows PASS (`eslint 9.39.5; eslint.config.js names cookwright/packs/<name>/eslint.cjs`).
- Fixture's new step, run on the real scaffold:
  - On main with no upstream, `standards --ratchet` exits 11: `skipped, no base to ratchet against (tried: main@{upstream})`.
  - `standards --types` exits 11 naming the missing db:types script.
  - On a branch with a violating component committed under COOKWRIGHT_SKIP=standards, `--ratchet` exits 10. Its first line is `a pack rule's count rose since <sha> (merge-base main HEAD): expo strings 0 → 1 in src/components/Farewell.tsx, expo tokens 0 → 1 in …`, with the findings below it and no literal echoed.
  - A first push of main through `hook pre-push` reads `pre-push SKIP gate no check ran (every check was skipped: standards (…); standards:types (…))`.

Design points:
- `--ratchet` and `--types` print their verdict first: the gate records the first stdout line as the note (disposition 45). `--staged` keeps its verdict last, for the hook.
- The base is resolved in lib/packs/base.mjs. Each candidate is checked with `rev-parse --verify`, and a ref starting with '-' is refused.
- The hook passes `prep.base` to the checks as `ctx.pushBase`. `gateEnv(env, base)` sets COOKWRIGHT_PUSH_BASE, or removes an outer value, so it never stands in for this push.
- gate.mjs: `skipExit` is honoured only when the check names it. The note is recorded for opted-in checks only, on every outcome. A pass whose note has a `<part>: skipped, …` segment reads as 'partly measured' in passLabel and status, and as a WARN in the landing check. The closeout gate table gains a Notes column (pipes escaped).
- The types tests use a fake `supabase` shell script on PATH: no seam and no real stack.

Nothing left the repo: no push, no publish, no deploy.
