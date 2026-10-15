# implement:s3 — session report

_Stored as the session returned it; the orchestrator verifies before relying on it._

## Commits
- `edb439e feat(init): install the git hooks, step 8, unless they are managed elsewhere`
- `724a070 feat(doctor): five hook checks and the changelog marker; 16 checks`
- `6b2ffe7 feat(rules): managed block v2: generated changelog, enforced doc sync, git hooks`
- `5ce8162 chore(dogfood): the playbook doc-sync rule for the bundle CLI and workflow`
- `d32d41f chore(dogfood): init installs the git hooks here; the rules block goes to v2`
- `990fa8b chore(dogfood): CHANGELOG.md is generated; the hand-written lines drop`
- `b3839f5 docs(hooks): README git hooks and releases; the implementer's doc-sync line; backlog`

## Files
- `packages/cookwright/src/lib/doctor/hooks.mjs`
- `packages/cookwright/src/lib/init/hooks.mjs`
- `packages/cookwright/src/lib/init/files.mjs`
- `packages/cookwright/src/lib/init/steps.mjs`
- `packages/cookwright/src/lib/init/config.mjs`
- `packages/cookwright/src/lib/doctor/registry.mjs`
- `packages/cookwright/src/lib/doctor/homes.mjs`
- `packages/cookwright/src/lib/levels.mjs`
- `packages/cookwright/src/lib/levels.test.mjs`
- `packages/cookwright/src/lib/messages.mjs`
- `packages/cookwright/src/lib/messages.test.mjs`
- `packages/cookwright/src/lib/rules/agents-block.md`
- `packages/cookwright/src/lib/rules/block.mjs`
- `packages/cookwright/src/test-helpers.mjs`
- `packages/cookwright/src/init.test.mjs`
- `packages/cookwright/src/doctor.test.mjs`
- `packages/cookwright/src/hook.test.mjs`
- `cookwright.json`
- `.githooks/pre-commit`
- `.githooks/pre-push`
- `AGENTS.md`
- `CHANGELOG.md`
- `README.md`
- `docs/playbook.md`
- `docs/dev/backlog.md`
- `hosts/claude/workflows/bundle-phase.js`

## User-facing strings
| key | text | context |
|---|---|---|
| `messages.init.hooks.pathSet` | core.hooksPath set to .githooks in the local git config | init row hooks.path, wrote |
| `messages.init.hooks.pathKept` | core.hooksPath is .githooks | init row hooks.path, kept |
| `messages.init.hooks.shim` | the managed shim, executable; it calls the hook in the package | init row .githooks/<name>, wrote |
| `messages.init.hooks.shimKept` | the managed shim | init row .githooks/<name>, kept (ours byte for byte) |
| `messages.init.hooks.calls` | calls cookwright; the rest is yours | init row .githooks/<name>, kept (a user's own hook that calls cookwright) |
| `messages.init.hooks.modeFixed` | made executable; its content untouched | init row .githooks/<name>, updated (mode only) |
| `messages.init.gitWriteFailed` | git <args> failed: <detail>; .githooks/pre-commit, .githooks/pre-push are written but inactive, rerun init | init refusal (exit 2) when setting core.hooksPath fails after the shims were written |
| `messages.foreignHooks.path` | core.hooksPath is <value> (<scope>): hooks are managed elsewhere, cookwright's are not installed | init's three hooks rows skipped, and doctor hooks.path WARN |
| `messages.foreignHooks.dir` | <dir> has <names>: cookwright's hooks are not installed | same, when git's hooks directory holds a user's hook (e.g. .git/hooks has pre-commit) |
| `messages.foreignHooks.file` | <.githooks/name> is not cookwright's: cookwright's hooks are not installed | same, when a .githooks file does not call cookwright |
| `messages.doctor.hooks.notWorkTree` | not a git work tree | doctor hooks.* and tools.gitleaks SKIP outside a work tree |
| `messages.doctor.hooks.pathOk` | core.hooksPath is .githooks (local) | doctor hooks.path PASS |
| `messages.doctor.hooks.pathUnset` | core.hooksPath is not set, so cookwright's git hooks do not run (run npx cookwright init) | doctor hooks.path FAIL |
| `messages.doctor.hooks.elsewhere` | hooks managed elsewhere (see hooks.path) | doctor hooks.pre-commit / hooks.pre-push SKIP when the setup is foreign |
| `messages.doctor.hooks.missing` | <rel> missing (run npx cookwright init) | doctor hooks.pre-commit / pre-push FAIL |
| `messages.doctor.hooks.notAFile` | <rel> is not a file; move it aside, then run npx cookwright init | doctor hooks.pre-commit / pre-push FAIL (a directory or dangling link) |
| `messages.doctor.hooks.notExecutable` | <rel> is not executable (run npx cookwright init, which fixes the mode) | doctor hooks.pre-commit / pre-push FAIL |
| `messages.doctor.hooks.shim` | <rel>: the managed shim | doctor hooks.pre-commit / pre-push PASS (ours) |
| `messages.doctor.hooks.calls` | <rel> calls cookwright; the rest is yours | doctor hooks.pre-commit / pre-push PASS (a user's hook) |
| `messages.doctor.gitleaks.absent` | skipped, needs gitleaks, run setup (brew install gitleaks): the pre-commit secret scan does not run | doctor tools.gitleaks SKIP |
| `messages.doctor.gitleaks.ok` | the pre-commit secret scan runs (gitleaks <version>) | doctor tools.gitleaks PASS (version omitted when unknown) |
| `messages.doctor.gitleaks.broken` | gitleaks does not run (exit <N>): <first stderr line>; the pre-commit secret scan is skipped | doctor tools.gitleaks FAIL |
| `messages.doctor.gateScripts.none` | no gate checks configured | doctor gate.scripts PASS with no checks |
| `messages.doctor.gateScripts.ok` | <n> gate check(s); every npm script they run is in package.json | doctor gate.scripts PASS (FAIL is the gate's own refusal text, verbatim) |
| `messages.doctor.homes.unmarked` | <file>: not generated by cookwright; npx cookwright changelog --adopt replaces the file | doctor homes.changelog WARN |
| `messages.levels[0].summary` | state homes, the managed rules block, the session-start doctor hook, and the git hooks (secret scan and doc sync on commit, the gate and the changelog on push) | Level 0 summary (shown as a next-level line) |
| `agents-block.md (rules block v2)` | Changelog line, doc-sync paragraph and the new Git hooks section, worded as plan §4.7 | the managed block init writes into AGENTS.md |
| `bundle-phase.js DOC_SYNC_LINE / playbook Implementer role` | When the pre-commit hook refuses a commit on doc sync, stage the doc the rule names; a commit with no doc implication goes through with `COOKWRIGHT_SKIP=doc-sync git commit …` and the reason in its message, never `--no-verify`. | implementer and fix prompt header; the playbook's Implementer role and its Prompt header list |
| `README.md` | Line 5 reworded; init, doctor and hook command lines; new 'Git hooks' and 'Releases and the changelog' sections; the Developing paragraph names the live hooks | user docs, plan §7 step 5 |

## Open questions
- Plan §4.3 places the shims at the config root (repo.root), while git resolves a relative core.hooksPath against the work tree top. When cookwright.json sits in a subdirectory of the work tree (a monorepo app), init writes .githooks/ under that subdirectory and git finds no hook there. This is B-002's family and outside s3's scope. Should it go in B-002, or in a new bug?
- Carried over from s2 and not fixed here: withDefaults silently replaces a non-object `hooks` (or `gate`) with the default, so validateHooks' 'hooks must be an object' never fires. It is a candidate backlog bug, and logging it is the orchestrator's call.
- The fix:hooks decision on several pushed refs (run when any pushed sha is HEAD) belongs to fix:hooks and was not touched in s3.

## Notes
s3 is done in 7 commits. Every commit staged named paths only. The tree is clean.

**Test counts (vitest, packages/cookwright)**
- Session start: 14 files, 275 tests.
- Session end: 14 files, 302 tests, all green.

**Dogfood readouts on this repo, measured**
- `npx cookwright init` gave exactly the rows in plan §7: hooks.path and both shims `wrote`, AGENTS.md `updated` (v1 to v2), everything else `kept`.
- `npx cookwright doctor`: `16 checks — 16 PASS, 0 FAIL, 0 WARN, 0 SKIP` and `level 0 declared: complete`. `doctor --hook` prints `cookwright doctor: level 0 complete`. A full doctor run took 0.19 s wall time.
- `npx cookwright changelog --adopt` wrote the header-only file, byte-equal to the template. `--check` passes. A plain run without `--adopt` refused first, exit 2, as designed.

**The hooks are live here from d32d41f**
- Each later commit in this session ran pre-commit `secrets` PASS (gitleaks 8.30.1) and `doc-sync` PASS.
- Plan §8 check: committing hosts/claude/workflows/bundle-phase.js alone was refused with the playbook rule's FAIL line. It landed once docs/playbook.md was staged with it.
- I pushed nothing, so pre-push has not run on this repo yet. The first push runs `npm test` and the changelog check.

**Deviations and choices for the orchestrator to accept**
1. **One shared reader.** `hooksSetup` lives in src/lib/doctor/hooks.mjs and both init's step and doctor's checks use it, so their foreign verdicts cannot differ. Foreign wording is one `messages.foreignHooks` set, shared by init's skipped rows and doctor's WARN.
2. **Foreign rows.** In the foreign case, all three init rows carry the same reason note.
3. **Hooks directory path.** It is shown root-relative. From a linked worktree git returns an absolute path (measured: `rev-parse --git-path hooks`), and an absolute path must never reach a readout. Dotfiles and `*.sample` entries in that directory are not counted as user hooks.
4. **Mode-only fix.** A write `{ rel, mode }` with no content only runs chmod, so a hook's bytes stay intact, CRLF included.
5. **Git writes.** They carry `inert` (the two shim paths) for the refusal text. A test makes .git read-only so `git config` fails, then checks the shims stay executable and the path stays unset; the next init completes the setup. That test and the mode test are skipped on win32, and the .git test also when running as root.
6. **Prompt header.** The doc-sync line is added in `header()` for role `implementer` only, which also covers fix sessions. The playbook's "Prompt header" list gained a matching bullet. The Implementer role gained the line itself.
7. **README line 5.** It now says the npm release lags this repo, per the s1 decision deferring that rewording to s3.
8. **Test helper.** test-helpers.mjs gained `v1Block(v2)`, which rebuilds the shipped v1 block. Checked: it reproduces this repo's real v1 block byte for byte.
9. **Doc sync per commit.** The README's init and doctor lines were updated in their own feature commits. The rest of the README landed in the final checkpoint.

**Commands left for the developer (they leave the repo)**
- `git push` of bundle/stage-2, which also runs the new pre-push hook (`npm test` plus the changelog check).
- Any later `npm publish` of the package.
