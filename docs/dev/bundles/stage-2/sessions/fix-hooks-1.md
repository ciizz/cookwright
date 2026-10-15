# fix:hooks — session report

_Stored as the session returned it; the orchestrator verifies before relying on it._

## Commits
- `f3c1a89 test(cookwright): isolate git's global and system config for the whole suite`
- `fd18e4f fix(cookwright): refuse a non-object hooks, gate or paths instead of defaulting it`
- `34ba709 fix(cookwright): read core.hooksPath on a git without --show-scope`
- `323c739 fix(cookwright): never show a machine path in the foreign-hooks readout`
- `03aca1d fix(cookwright): run the pre-push checks when any pushed ref is HEAD`
- `a5ebf4f fix(cookwright): put the git hooks where git looks when the config is nested`
- `220ee84 fix(cookwright): doctor WARNs a hook whose package is not installed where it runs`

## Files
- `packages/cookwright/vitest.setup.mjs`
- `packages/cookwright/vitest.config.mjs`
- `packages/cookwright/src/lib/config.mjs`
- `packages/cookwright/src/lib/config.test.mjs`
- `packages/cookwright/src/lib/doctor/hooks.mjs`
- `packages/cookwright/src/lib/doctor/repo.mjs`
- `packages/cookwright/src/lib/init/hooks.mjs`
- `packages/cookwright/src/lib/init/repo.mjs`
- `packages/cookwright/src/lib/hooks/shims.mjs`
- `packages/cookwright/src/lib/hooks/push.mjs`
- `packages/cookwright/src/hook.mjs`
- `packages/cookwright/src/lib/messages.mjs`
- `packages/cookwright/src/test-helpers.mjs`
- `packages/cookwright/src/hook.test.mjs`
- `packages/cookwright/src/lib/hooks/docsync.test.mjs`
- `packages/cookwright/src/init.test.mjs`
- `packages/cookwright/src/doctor.test.mjs`
- `README.md`
- `docs/dev/backlog.md`

## User-facing strings
| key | text | context |
|---|---|---|
| `messages.foreignHooks.notLocal` | not the local config | Scope word in 'core.hooksPath is <x> (<scope>): ...' when git before 2.26 cannot name the scope (finding 6). |
| `messages.foreignHooks.absolutePath` | an absolute path | Shown in place of an absolute or ~/ core.hooksPath in the foreign-hooks line (finding 3). |
| `messages.foreignHooks.outsidePath` | a path outside the repo | Shown in place of a relative core.hooksPath that climbs out of the repo (finding 3). |
| `messages.foreignHooks.gitHooksDir` | git's hooks directory | Shown in place of git's hooks directory when it lies outside the work tree, e.g. from a linked worktree: "git's hooks directory has pre-commit: cookwright's hooks are not installed" (finding 3). |
| `messages.hook.push.notHead` | not tested: <refs> is|are not the checked-out branch | Changed: now takes a list of refs (up to five, then …) and agrees in number; both pre-push checks SKIP with it when no pushed ref is HEAD (findings 1, 5). |
| `messages.hook.push.untested` | (not tested: <refs> is|are not the checked-out branch) | New: appended to each pre-push verdict when some pushed refs are HEAD and others are not (findings 1, 5). |
| `shims.fallbackLines.noDir` | cookwright <hook> skipped: <dir> is not in this checkout | New line in the shim written into the user's repo when the config root is below the work tree top and that directory is absent; the hook exits 0 (finding 0). |
| `messages.doctor.hooks.notInstalled` | <rel>: node_modules/cookwright is not installed here, so the hook prints not-installed and checks nothing (npm install) | Doctor WARN on hooks.pre-commit / hooks.pre-push when the package bin is absent under the config root (finding 7). |
| `README.md Git hooks: Older git` | **Older git.** init and doctor read where `core.hooksPath` is set with `git config --show-scope`, which git 2.26 added. On an older git they tell only the local config from the rest (`not the local config`); nothing else changes. | New README bullet (finding 6). |
| `README.md Git hooks: A config below the top` | **A config below the top** (an app in a monorepo, `cookwright.json` in `apps/mobile/`): init writes the shims at the work tree's top, where git looks, and each shim enters `apps/mobile` before calling cookwright, which is installed there. Your own hook does the same with `cd apps/mobile && ` before the call. | New README bullet (finding 0). |
| `README.md Git hooks: pre-push` | It judges the working tree, not the pushed commit: a dirty tree is named on each line, and a pushed ref that is not the checked-out commit is named on each line as not tested. An annotated tag on that commit counts as it, so the release push checks the changelog; when no pushed ref is the checked-out commit, both checks are skipped. | Changed README pre-push sentence (findings 1, 5). |
| `README.md Git hooks: intro` | Without node, or with the package not installed, a shim prints one line and lets the commit or push through; doctor reads a hook whose package is not installed where it runs as weak, since it checks nothing. | Changed README intro sentence (finding 7). |

## Open questions
- Nested config, more than one app: the shims at the top can enter only one config root. A second app's init in the same work tree reads the first app's shim as foreign ('not cookwright's') and skips. Is a backlog enhancement wanted (one shim fanning out to several config roots)?
- A managed shim written for a different config root (cookwright.json moved, or a future shimText change) reads as foreign, not as an earlier managed shim that init would refresh. Should a shim carrying the managed header be 'updated' by init and FAIL 'earlier shim (run init)' in doctor, as the rules block's v1 to v2 refresh works?

## Notes
All nine findings in review-hooks-1.json were dispositioned as the recorded fix:hooks decision (state.json, 2026-10-15) directs: 7 confirmed and 2 plausible, none rejected. Suite before the fixes: 302 tests in 14 files. After: 315 tests in 14 files, all green. Repo doctor: 16 PASS, level 0 complete. git diff --check over cdbfb4c..HEAD is clean, and no absolute paths were added.

- Finding 8 (f3c1a89): added vitest.setup.mjs. It points GIT_CONFIG_GLOBAL at an empty scratch file and sets GIT_CONFIG_NOSYSTEM=1 for the whole suite. The in-process ENV objects in hook.test.mjs and docsync.test.mjs carry both values. Measured: with a global core.hooksPath and no setup file, 13 tests failed; with it, all pass.
- Finding 2 (fd18e4f): withDefaults now applies nested defaults only when the key is absent or an object. I applied this to `paths` as well as `hooks` and `gate`: it is the same masking, two lines. Tests cover a string, a list and null for each key. Closed B-006.
- Finding 6 (34ba709): when `--show-scope` is refused (exit 129 or 'unknown option'), the reader falls back to `config --get` plus `config --local --get`. The scope word is then 'local' or 'not the local config', and the git failure is never a Refusal or a probe FAIL. The tests play an old git with a PATH wrapper (gitWithoutScopes in test-helpers) and fail without the fallback (verified). The README names git 2.26.
- Finding 3 (323c739): a core.hooksPath that is absolute or starts with ~ shows as 'an absolute path'. One that climbs out of the repo shows as 'a path outside the repo'. Git's hooks directory outside the work tree (a linked worktree's common dir) shows as "git's hooks directory". A relative path inside the repo is still shown verbatim. This departs slightly from the decision's single phrase: an absolute path that points inside the repo is not 'outside the repo', so it gets its own phrase. This commit used `COOKWRIGHT_SKIP=doc-sync` with the reason in the message. That was unneeded, since the rule did not match.
- Findings 1 and 5 (03aca1d): each pushed sha is peeled with `rev-parse --verify -q <sha>^{commit}`. The checks run when any pushed ref is HEAD, and each verdict then ends '(not tested: <refs> is/are not the checked-out branch)'. Both SKIP only when no pushed ref is HEAD. Tests cover branch plus an older branch, branch plus an annotated tag (the stale changelog now FAILs on the release push), a tag-only push of a tag on HEAD, and a tag on another commit (SKIP). The README pre-push line is updated.
- Finding 0 (a5ebf4f): the shims are written and read at the work tree top. When the config root is below the top, the shim enters it first. shimText(name, rel), callLine(name, rel) and callsCookwright(text, name, rel) take the root's path from the top. With rel='' the shim is byte-identical, so this repo's .githooks stay valid. Doctor and init repos carry `top`, and nested row targets read '../../.githooks/<name>'. hook.mjs opens the config from its cwd, bounded by the top. Before choosing the cd I measured that a plain commit exports a relative GIT_INDEX_FILE ('.git/index') and that git resolves it against the top from a subdirectory (git 2.52), so the cd does not change the staged diff. Tests: an end-to-end commit through the real hook from apps/mobile (refused without the doc, landed with it, doctor PASS), a shim whose directory is missing (not-here line, exit 0), init rows and idempotence, a user hook in the cd form, and doctor FAILing the B-007 layout. Closed B-007, and B-002's text now says the shims look in the config root.
- Finding 7 (220ee84): hooks.pre-commit and hooks.pre-push WARN when node_modules/cookwright/bin/cookwright.mjs is absent under the config root. The doctor fixtures and init's doctor-pass test now install a stub bin, untracked and excluded.
- Finding 4 (plausible, P3): no change, as the recorded decision says. The plan scheduled the README in s3, and the hooks reached no user before init installed them. Rewriting already-committed history for this is not warranted.

Nothing ran that leaves the repo. The two throwaway measurement scripts are <local path> and <local path> The only uncommitted file is docs/dev/bundles/stage-2/state.json, which was modified by the bundle CLI, not by me.
