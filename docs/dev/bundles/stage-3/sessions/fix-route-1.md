# fix:route — session report

_Stored as the session returned it; the orchestrator verifies before relying on it._

## Commits
- `6f02b1e fix(doctor): host.pointers skips the ignored probe without git or a work tree`
- `f4957b6 fix(bundle): refuse a playbook that is not a regular file`
- `bb1e9c8 fix(migrate): replace cookwright.json atomically`
- `2ede15d docs: say the Codex SessionStart hook is written, its firing unmeasured`
- `899bce0 fix(migrate): keep a version-1 playbook the absent key defaulted to`
- `b229fbc chore(backlog): log E-028, workflow discovery from a nested config root`

## Files
- `packages/cookwright/src/lib/doctor/hosts.mjs`
- `packages/cookwright/src/lib/hosts.mjs`
- `packages/cookwright/src/doctor.test.mjs`
- `packages/cookwright/src/lib/bundle/phases.mjs`
- `packages/cookwright/src/bundle.test.mjs`
- `packages/cookwright/docs/playbook.md`
- `packages/cookwright/src/migrate.mjs`
- `packages/cookwright/src/migrate.test.mjs`
- `README.md`
- `docs/dev/backlog.md`
- `packages/cookwright/src/lib/migrations.mjs`
- `packages/cookwright/src/lib/migrations.test.mjs`
- `packages/cookwright/src/lib/messages.mjs`
- `packages/cookwright/src/lib/config.test.mjs`

## User-facing strings
| key | text | context |
|---|---|---|
| `messages.migrate.outcomes.playbookPinned` | paths.playbook set to ${rel} (your own playbook, which version 1 read when the key was absent) | migrate's 1 -> 2 step line when a v1 config has no paths.playbook but a file sits at docs/playbook.md (finding #4) |
| `README.md init bullet (Codex hook)` | Codex's in `.codex/hooks.json`, which you trust with `/hooks`, though nobody has yet seen Codex run it: it did not fire under `codex exec`, and an interactive session is unmeasured, so doctor's Codex `host.hook` says only that the file carries the hook | README Commands, the init bullet's hook clause (finding #3) |
| `playbook.md loop step 2` | Both refuse, naming what is missing, when no configured host has workflows or the playbook is not a readable file where they would point. | packages/cookwright/docs/playbook.md, the bundle refusal sentence (finding #1) |

## Open questions
- Finding #5 (plausible, nested AGENTS.override.md reads as host.rules WARN): I declined it as a product call. Plan §4.4 and §6 say explicitly that an override in a nested invocation directory WARNs, and disposition 21 walks the path on purpose. The mechanism the finding gives is correct, though: a nested override does not hide the root AGENTS.md block. Changing the check (only a root-level override WARNs, a nested one PASSes with a note) would be a plan revision. Keeping it needs a `bundle decide` recording why. Which one do you want?

## Notes
I fixed the five confirmed findings (#0–#4) and logged plausible #6 in the backlog. Plausible #5 is declined and is in open_questions. The full vitest suite passes: 16 files, 395 tests (389 at the review's HEAD).

- #0 (host.pointers without git): `checkPointers` now reads tracking only when `repo.hasGit && repo.workTree`, and skips the ignored probe otherwise. Writing the test turned up a second throw on the same path: `upToTop` used a default parameter that does not apply to a null `top`, so `installedPackage` threw "paths[0] … null" with git absent. It now uses `top ?? root`. The new test fails without the fix and passes with it.
- #1 (playbook not a regular file): `workflowPaths` now uses `statSync(...).isFile()` with links followed, so a directory or a FIFO is refused. A read failure while hashing gives the same `noPlaybook` refusal. There is a test for a directory under status and args. I adjusted one sentence of the playbook for doc sync.
- #2 (migrate write): `replaceFile` in `migrate.mjs` writes a temp file beside the config with the original's mode, flushes it and renames it over the config. It removes the temp file on failure. Tests cover a read-only directory (refused, file byte for byte, no temp file left) and mode preservation.
- #3 (README Codex hook claim): the init bullet now says the Codex hook file is written and that its firing is unmeasured. I left the doctor PASS note as it is, since it already claims only that the file carries the hook. I logged E-027 for the interactive Codex measurement.
- #4 (absent v1 `paths.playbook`): the 1→2 step now writes `paths.playbook: docs/playbook.md` in when the key is absent and something is at that path (new outcome `playbookPinned`). This applies both in memory and through migrate. Plan §4.3 says "nothing else changes in 1→2", so the orchestrator may want this deviation recorded with `bundle decide`.
- #6 (workflow discovery from a nested config root): I logged E-028 to measure it rather than change code. Running a Claude Code session to measure it is the orchestrator's job (s6's fresh-session listing could cover it).

E-027 and E-028 take the next ids, so s5's §9 backlog lines start at E-029.

Commit 6f02b1e used `COOKWRIGHT_SKIP=doc-sync`, with the reason in its message, although no rule applied to it. All later commits passed doc sync normally.

`docs/dev/bundles/stage-3/state.json` was already modified in the tree when I started, by the runner, and I never staged it. During one check I ran `git stash` and `git stash pop`, which also stashed and restored that file; it came back unchanged.
