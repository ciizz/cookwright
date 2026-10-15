# fix:whole — session report

_Stored as the session returned it; the orchestrator verifies before relying on it._

## Commits
- `624b497 fix(bundle): scrub machine paths from values before serializing, never JSON text`
- `70a03d2 fix(bundle): a scrubbed machine path must start at a path boundary`
- `1d87bb9 fix(bundle): scrub any macOS home or volume and Windows drive or share paths`
- `8e78cec fix(init): refuse a write through a symlinked parent directory`
- `ace5175 fix(config): no two configured paths may coincide or nest`
- `ba55b0a fix(doctor): a check that outlasts the shared budget is unverified, not FAIL`
- `0c78215 fix(rules): `@./AGENTS.md` counts as the AGENTS.md import`
- `8fb7b7a docs(backlog): B-004, the pre-fix commits still carry machine-local paths`

## Files
- `packages/cookwright/src/lib/bundle/scrub.mjs`
- `packages/cookwright/src/lib/bundle/scrub.test.mjs`
- `packages/cookwright/src/lib/bundle/state.mjs`
- `packages/cookwright/src/lib/bundle/phases.mjs`
- `packages/cookwright/src/bundle.test.mjs`
- `CHANGELOG.md`
- `packages/cookwright/src/lib/init/files.mjs`
- `packages/cookwright/src/lib/messages.mjs`
- `packages/cookwright/src/init.test.mjs`
- `README.md`
- `packages/cookwright/src/lib/config.mjs`
- `packages/cookwright/src/lib/config.test.mjs`
- `packages/cookwright/schema/cookwright.schema.json`
- `packages/cookwright/src/lib/doctor/registry.mjs`
- `packages/cookwright/src/doctor.test.mjs`
- `packages/cookwright/src/lib/rules/block.mjs`
- `packages/cookwright/src/lib/rules/block.test.mjs`
- `docs/dev/backlog.md`

## User-facing strings
| key | text | context |
|---|---|---|
| `messages.init.symlink` | ${rel} is a symbolic link and init does not write through one; replace it with the real file or directory, then rerun | init preflight refusal. It now also names a symlinked parent directory (e.g. `.claude`, `docs`), not only the final target. Changed from '…replace it with the file, then rerun'. |
| `messages.doctor.checkTimedOut` | unverified: ${detail} | New doctor note for a check whose git or claude subprocess outlasted the shared budget (SKIP instead of FAIL). detail is messages.timedOut(what), e.g. 'unverified: git ls-files did not answer in time (is git stalled?)'. |
| `README.md symlink sentence` | init refuses to write through any other symlink, including a linked directory on the way to a file it writes (a `.claude` or `docs` that points elsewhere). | README 'Already have a CLAUDE.md?' paragraph. |
| `CHANGELOG.md Unreleased, runner records line` | paths inside the repo are stored root-relative; home, temp, macOS volume and Windows drive or share paths as `<local path>`; and a session report listing a file outside the repo is refused. | Changelog line on what the bundle runner scrubs from its records. |
| `schema paths.description` | The state homes and code docs, relative to the repo root. No two of these paths may be equal or nest inside one another. | cookwright.schema.json description of `paths`. |
| `backlog B-004` | Six commits on `bundle/stage-1` before B-001's fix (`d00d0bf` to `1d8bb5c`) still carry absolute machine-local paths… | New open bug in docs/dev/backlog.md. |

## Open questions
- Findings 0 and 7 (history rewrite, logged as B-004). Commits d00d0bf through 1d8bb5c still hold /Users/<name> paths. A rewrite from d00d0bf changes every commit id recorded in state.json (gates, phase start/end commits, slice ends), and the CLI has no way to re-map them. There are three options. (a) Rewrite only the record blobs and restart the bundle's evidence: re-gate and reopen fix:core. (b) Add a runner command that maps old ids to new ones after a filter-repo. (c) Squash on landing. plan.md §2(a) still says 'every recorded commit id survives'. I did not edit the plan because it is runner-owned bundle state with a pinned hash, so the correction needs whoever owns the plan. I did not run any history rewrite.
- Findings 1 and 9 (npm name squatting): `npm view cookwright` still returns E404. Plan §2(b) makes reserving the name the developer's job ('a publish, their hands, before s1's docs land') and keeps the invocation `npx cookwright`. I did not change CLI to `npx --no cookwright` or to a direct node path, since either would contradict that dated decision. The developer needs to publish, for example a placeholder with `npm publish --workspace packages/cookwright --access public`, then verify with `npm view cookwright` before the branch lands. The alternative is to decide to change the invocation.

## Notes
I fixed 9 of the 13 review-whole-1 findings in code (3, 6 and 8 in one area; 2 and 12 together), each with tests. Findings 0 and 7 are logged as B-004. I declined finding 4 and left findings 1 and 9 open for the developer. After the fixes, `npm test` passes 191 tests (185 before) and `npx cookwright doctor` on this repo gives 11 PASS, level 0 complete. I never staged docs/dev/bundles/stage-1/state.json (the orchestrator's change is still uncommitted in the tree). I staged named paths only. I amended my own unpushed commit 1d87bb9 once to carry its CHANGELOG doc-sync line.

Fixed:
- **Finding 6 (confirmed P1), 624b497:** saveState and the findings record now scrub every string value and key with the new `scrubValue` before JSON.stringify, instead of running a regex over the serialized JSON. Markdown records are still scrubbed as text. The new test, in bundle.test.mjs's paths test, quotes a scratch path followed by `\n` in a `bundle decide` text and in a finding, then re-parses both files and runs `status`. It fails on the old code with the reviewer's JSON.parse error.
- **Finding 8 (confirmed P2), 70a03d2:** a path match must now start the text, follow a character that cannot be part of a path or URL, or follow `file://`. So `app/tmp/x` and `https://host/tmp` are left alone. The new scrub.test.mjs covers it.
- **Finding 3 (plausible P1), 1d87bb9:** the scrub now also redacts `/Users/<name>`, `/Volumes/<name>`, Windows drive paths (`<local path>`, `<local path>`) and UNC paths (`<local path>`), with backslash separators. I deliberately did not redact every absolute path. `/usr/bin/env`, `/opt/x` and routes like `/media/upload` or `/users/1` identify no machine, and redacting them would mangle a mobile app's API routes. So the reviewer's `/opt/company/private.txt` example stays as written. `/home/<name>` and `/mnt`/`/media` are also left alone because they clash with app routes; this machine's own home is already covered by os.homedir().
- **Findings 2 and 12 (confirmed P1/P3), 8e78cec:** refuseLinks now checks every path component from the root down to the target and names the first symlink. The refusal text now says 'the real file or directory', and the README sentence covers a linked parent. The new init test covers a `.claude` and a `docs` symlinked outside the repo: both are refused, and the outside directory and the repo stay untouched. It fails on the old code.
- **Finding 5 (confirmed P2), ace5175:** the overlap check now covers every key in `paths`, changelog and playbook included. This departs from plan §4.2, which says changelog is 'not part of the nesting check'. The plan's reason (a changelog line is code) is exactly why it must not sit under a non-code home. The config test that asserted `docs/bundles/CHANGELOG.md` is accepted now asserts a refusal, plus the closeouts==changelog case and the playbook cases. I updated the schema description.
- **Finding 10 (plausible P3), ba55b0a:** a TimedOut thrown in a check is now SKIP 'unverified: <what> did not answer in time', not FAIL, so the level line lists it as unverified rather than drift. I did not shrink claudeVersion's 1.5 s share, because the plan sets that number.
- **Finding 11 (plausible P3), 0c78215:** hasImport treats `@./AGENTS.md` as `@AGENTS.md`. `@../AGENTS.md` is still not a match.
- **Findings 0 and 7 (plausible P1/P2), 8fb7b7a:** logged as backlog B-004. The rewrite itself and how to handle the recorded ids are listed under open_questions.

Declined:
- **Finding 4 (plausible P2, B-002 hook from a subdirectory):** fix:core's recorded orchestrator decision deferred it per the plan, and 1eb68ff reverted the attempted fix (a31d247) for that reason. It stays open as B-002, and the upward-search fix is still at a31d247 if the decision changes.
- **Findings 1 and 9 (npm name):** these are release preconditions held by the developer, not code defects. Details are in open_questions.
