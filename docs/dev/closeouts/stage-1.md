# Stage 1 — doctor and init (Level 0)

Closed 2026-10-15. The first bundle through cookwright's own runner, per the charter's "How it gets built". Branch `bundle/stage-1` on base `c0322d4a`; the closeout phase's range `c0322d4a..51a1969` holds forty-eight commits, and the closeout's own commits follow it. To be merged into `main` by fast-forward once `bundle check` passes. The branch's history was rewritten once before landing, by the developer's decision, to remove machine-local paths that the runner itself had recorded; the procedure is below.

## What stage 1 was for

Stage 0 left a bundle runner and nothing a user could install. Stage 1 built the two commands every later level hangs off: `init`, which takes a repo to Level 0 (config, state homes, a managed rules block, a session-start hook), and `doctor`, which checks at every session start that Level 0 is still there, reports drift against the declared level, and never fails a hook. It also gave the package its `cookwright` bin and published the name.

## What shipped

**The `cookwright` bin** (`packages/cookwright/bin/cookwright.mjs`, no entry guard since it is always reached through a symlink), dispatching `init`, `doctor` and `bundle` through `src/cli-main.mjs`. The invocation everywhere is `npx cookwright`; `npx cookwright bundle …` replaces `node packages/cookwright/src/bundle.mjs` in every printed line, the playbook, the skill and the README. The package is on npm as `cookwright@0.0.0`, published by the developer during the QA phase; at verification time the registry's `latest` dist-tag pointed at `0.0.0`, after a `0.0.0-stage` placeholder that npm's staged publishing created first. The README still says the package is not on npm: doc drift found by the closeout verify, logged as B-005.

**`cookwright init`**, non-interactive and idempotent. It computes every row in a read-only preflight and refuses before any write (an invalid or unwritable target, a malformed block, an unparseable settings file, a symlink anywhere on the way to a file it writes). Then, in order: `cookwright.json` with `level: 0` and a validated base branch; the backlog, closeouts directory and changelog from templates; the managed rules block appended to or refreshed in `AGENTS.md`; a `CLAUDE.md` import line only when a `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` in or above the invocation directory would shadow `AGENTS.md`, or Claude Code is older than 2.1.281; the SessionStart hook merged into `.claude/settings.json`, detected by equality with the one command constant; `.env`, `.env.*` and `!.env.example` appended to `.gitignore` when `.env` or `.env.local` is not ignored, probed one path per call. A second run changes no byte. A `--dry-run` prints the same report and writes nothing.

**`cookwright doctor`**, eleven checks in a registry with the landing check's four verdicts: `config`, `git`, the three homes, `backlog.ids`, `rules.block`, `rules.size`, `host.rules`, `host.hook`, `secrets.env`. Drift is a FAIL among the declared level's requirements; a WARN is weak, a SKIP unverified, and the level line names both. doctor's git and claude calls share one 1.8 s budget with a 1.5 s cap per call (outside doctor, the 1.5 s cap alone); a timeout is unverified, never drift. `--hook` prints only what is not PASS, always exits 0, and lands in the session's context through the hook. `secrets.env` matches exactly `.env` and `.env.*`, exempts the example files, finds tracked files repo-wide through the index, and never opens one.

**Config**: `level` (0 in this version) and `paths.changelog`; the root walk stops at the git work tree; no two configured paths may coincide or nest; the unknown-host message names the version. The schema twin and its parity test follow.

**The managed rules block** (`src/lib/rules/agents-block.md`, v1): state homes, backlog discipline, doc sync, session start, secrets, conventions, rendered with the repo's paths between `<!-- cookwright:begin rules v1 -->` and `<!-- cookwright:end -->`. `blockState` is the one definition of current, stale, newer and malformed, shared by init and doctor, with CRLF preserved.

**The host table** (`src/lib/hosts.mjs`): the settings file, the hook command with its three fallback lines (node missing, package missing, doctor crashed), the shadowing file names, the import line, the version threshold. Nothing about Claude Code lives elsewhere.

**Runner fixes found by this bundle's own reviews**: the state keeps run ids only (`--transcript-dir` is gone); every record and the state are scrubbed of machine-local paths at write time, by value before serialisation, with a path boundary; a session report listing a file outside the repo is refused; the three `phase` verbs refuse unknown flags.

**The charter** gained its first dated amendment, in the developer's wording: rules live in one `AGENTS.md`, and init writes a `CLAUDE.md` only as an import when Claude Code would otherwise not read it.

**This repo eats its own cooking**: `CLAUDE.md` moved to `AGENTS.md` (`219562b`, so history follows the file); init ran here (`0118099`) and wrote the block, a one-line `CLAUDE.md`, the hook, `CHANGELOG.md`; `cookwright.json` declares `level: 0`. The hook was verified live in the personal app (QA round 3), not in a session opened here.

## Tests

Measured, never carried: 80 tests in 2 files at the start of s1; 92 after s1; 138 after s2; 173 after s3; 185 after fix:core; 191 in 11 files after fix:whole, which is what `npm test` reports at close. No env file is written by any test: a tracked one is an index entry and the root listing is an injected probe.

## Verified by hand

- `npx cookwright doctor` on this repo at close: `11 checks — 11 PASS, 0 FAIL, 0 WARN, 0 SKIP`, `level 0 declared: complete`, `next: Level 1 is not available in this version of cookwright`. In hook mode: the single line `cookwright doctor: level 0 complete`; three runs at close took 0.14 to 0.23 s of wall time (s2 had measured about 75 ms before the budget and scrub landed).
- `npx cookwright init` rerun on this repo: every row `kept`, tree unchanged.
- `npm view cookwright`: `latest` is `0.0.0`; maintainers, the developer's account.
- No commit in `main..bundle/stage-1` contains a home, scratch or checkout path (the remaining `/Users/<user>/…` strings are reviewers' redacted quotations).

## Reviews

**Plan review**, round 1 (red-team plus Codex, then verifiers): 31 findings, 17 confirmed, 14 plausible, 8 of them P1. The ones that changed the design: `git check-ignore -q` with two paths is fatal and without `-q` passes when only one is ignored (one path per call); a Claude Code older than 2.1.281 ignores `AGENTS.md`, so init writes the import and doctor fails rather than warns; hook detection by substring would have passed an `echo`; the bin's entry guard is false through a symlink; the root walk had no git boundary; a config↔messages import cycle; the `npx cookwright` name was unpublished; and the runner was committing absolute transcript paths. The re-check judged all 31 resolved against the revised plan.

**review:core** (the slice's range, before the rewrite): 13 findings, 11 confirmed. fix:core applied twelve commits: records and state scrubbed of local paths, the shared time budget for doctor's subprocesses, the `.gitignore` override case, a validated fresh config, `.gitkeep` by tracked content, symlinked `CLAUDE.md`↔`AGENTS.md` handled, the settings note, the charter amendment, the duplicate heading. Its attempt at B-002 was reverted on the recorded decision.

**review:whole** (`c0322d4a..` the fix:core end): 13 findings, 5 confirmed. Two were reproduced, not inferred: the new scrub ran a regex over serialised JSON and could write invalid state; it had no left boundary and mangled `app/tmp/x`. fix:whole applied eight commits: scrub by value with a boundary and wider machine-dir patterns, symlinked parent directories refused, changelog and playbook in the overlap check, a timed-out check reported as unverified, `@./AGENTS.md` accepted. The reviewer also showed that the plan's claim "every recorded commit id survives the rewrite" was false, which led to the procedure below.

**Closeout verify**, round 1: 11 findings, all on this prose (a severity count, a tense, a decision count, an incomplete artifact list, unsupported sentences, a wrong commit order, a mid-bundle timing presented as current, a commit count), plus one on the evidence: the review:whole findings record was invalid JSON, written by the scrub bug that review had itself reported. All folded in; the record repair is in the history-rewrite section.

## The history rewrite

**What wrote the paths.** Three things, all runner-side: the implementer sessions returned their `files` as absolute paths and `record session` wrote them verbatim; `phase run --transcript-dir` persisted the host's transcript directory; and reviewer notes named a scratch file. In order: `b22cb18` (implement:s1) dropped `--transcript-dir`; `257aeb1` (fix:core) scrubs every record and the state at write time; `6c35426` (the fix:core state commit) scrubbed the six records written before that; `624b497` and the two commits after it (fix:whole) hardened the scrub to work by value, with a boundary and wider patterns. A test walks every file under the bundle directory and refuses an absolute path. doctor is not involved: bundle state is the runner's.

**The procedure** (the developer's decision, recorded in the state: a throwaway script, no product feature; E-016 records the feature with its real justification):

1. Confirmed `main`'s tip was the merge base, so no `main` commit could be touched. Backed up `.git` outside the repo.
2. Built a `--replace-text` list from the strings actually present in the range, by category: the checkout path prefix → root-relative (empty replacement); the host's per-session transcript directory, and the session's scratch directory → `<local path>`; a catch-all for the home directory → `<local path>`.
3. `git filter-repo --force --replace-text <list> --refs main..bundle/stage-1`. `main` and `stage-0` unchanged; 41 of the 42 branch commits got new ids (the first, `06223a0`, held no path); the HEAD tree byte-identical to before, since it had already been scrubbed.
4. A one-off script read filter-repo's commit-map and replaced every old id, as a full sha and as its 7- and 8-character forms at hex-word boundaries, in `state.json`, `sessions/*.md`, `findings/*.json` and the backlog (40 replacements in the state), then verified that no old id remained and that every commit id the state names exists. Committed as `6815f15`.
5. One fresh gate on the new HEAD (gate #7), so `bundle check` passes on real evidence. B-004 closed on it.

Three artifacts to know about. One commit message quotes `/Users/<name>` as a placeholder, which is not a path. A decision recorded between fix:core and fix:whole quoted example paths, which the scrub of that moment, before the boundary fix landed, redacted inside the stored text. And the review:whole findings record (`findings/review-whole-1.json`) was written by that same scrub as invalid JSON with its quotations mangled; during the closeout phase it was regenerated once by hand from the run's original result through the fixed scrub, then passed through the id remap, so it is valid again and quotes the bug it reports verbatim.

## Device QA

Three rounds, the developer's hands, no defect:

1. On this repo: `npm install` of the package reported up to date and three npm audit findings in the dev dependency tree (E-017); init rerun with every row `kept`; doctor 11 PASS.
2. On the personal app, a fresh `create-expo-app` scaffold (the charter's test bed): init wrote the config (base `main`, no gate check since the scaffold has no test script), the three homes, appended the block to the scaffold's own `AGENTS.md`, kept its `CLAUDE.md` (it already imports `@AGENTS.md`), merged the hook into the scaffold's own `.claude/settings.json`, appended the env patterns to `.gitignore`; doctor 11 PASS, level 0 complete.
3. In a Claude Code session opened in that app: the agent quoted the hook's one line, `cookwright doctor: level 0 complete`.

## State at close

- **Backlog:** B-001 and B-004 opened and closed by this stage; B-002 (the hook when Claude starts in a subdirectory or the package is in a workspace sub-package), B-003 (the other bundle subcommands ignore unknown flags) and B-005 (the README's "not on npm" line) open; E-007 narrowed to the adapter half with the skills decision; E-004 widened; E-010 to E-017 opened (git hooks, the changelog generator, the `/setup` skill, config migrations, the CI fixture, secret carriers beyond `.env*`, the remap command, the dev-tree audit findings).
- **Charter:** the dated amendment under Amendments.
- **Changelog:** Unreleased lines for the bin, init, doctor and the runner's records.
- **README:** install from a checkout, the three commands, the line for an existing `CLAUDE.md`; its "not on npm" line is B-005.
- **Plan:** `docs/dev/bundles/stage-1/plan.md` as the re-check judged it; its §2 (a) claim that recorded commit ids survive a rewrite is corrected by this closeout, not in the plan.

## Decided during the stage

The list below is generated from the state. Seven of the decisions are the developer's, asked in chat: the two queued §9 updates (the skills decision in E-007, the charter amendment), the transcript-path fix with a rewrite before push, the npm name reserved now, the amendment's final wording, the rewrite with a throwaway remap, and the npm name held once published. The rest are the orchestrator's dispositions of session open questions and review findings.

## Open items

B-002, B-003, B-005, E-004, E-007, E-010 to E-017 (see `docs/dev/backlog.md`). Stage 2 is the Level 0 git hooks and the changelog generator (E-010, E-011).

## From the bundle state

Branch `bundle/stage-1`, base `c0322d4a`, plan `docs/dev/bundles/stage-1/plan.md` (sha a252db7ad517b7c2; 78b8a834d66ff43b at init).

_The tables below are generated from bundle state revision 68; later phases (the closeout's own run and gate) are not in them._

## The five numbers

| Measure | Value | Source |
|---|---|---|
| Wall clock (h) | 5.1 | state timestamps |
| USD | not recorded | ENTERED by the orchestrator from the harness cost readout |
| Output tokens | 2606565 | sum of per-turn `budget.spent()` readings; turns that ran two workflows count once per run |
| Review rounds | 5 | review, plan-review and QA-round runs (each rerun is a run) |
| QA rounds | 3 | recorded QA rounds |

## Review trajectory

| Phase | Confirmed | Plausible | Rejected | File |
|---|---|---|---|---|
| plan-review | 17 | 14 | 0 | `docs/dev/bundles/stage-1/findings/plan-review-1.json` |
| plan-review | 0 | 0 | 31 | `docs/dev/bundles/stage-1/findings/plan-review-2.json` |
| review:core | 11 | 2 | 0 | `docs/dev/bundles/stage-1/findings/review-core-1.json` |
| review:whole | 5 | 8 | 0 | `docs/dev/bundles/stage-1/findings/review-whole-1.json` |
| closeout | 0 | 11 | 0 | `docs/dev/bundles/stage-1/findings/closeout-1.json` |

## Gate history

| # | Commit | Slice | Result | Retry of |
|---|---|---|---|---|
| 0 | `06223a00` | — | pass | — |
| 1 | `3c39dc3b` | — | pass | — |
| 2 | `b22cb18d` | core | pass | — |
| 3 | `22a1142a` | core | pass | — |
| 4 | `824dddc4` | core | pass | — |
| 5 | `edf4d49f` | core | pass | — |
| 6 | `8fb7b7a3` | — | pass | — |
| 7 | `6815f15f` | — | pass | — |

## Decided on your behalf

- 2026-10-15T08:57:25.610Z — E-007's remaining backlog text records the skills decision: one canonical skills/ directory in the package; Claude Code users receive skills through the plugin (Claude Code reads .claude/skills/, ~/.claude/skills/ and plugin skills, not .agents/skills/, per the docs 2026-10-15); Codex users through .agents/skills/ pointers written by init; nothing copied into a repo. Stage 3 scope. (developer; source: chat 2026-10-15, addendum for plan §9, queued for implement:s3)
- 2026-10-15T08:57:25.679Z — CHARTER.md amendment, dated 2026-10-15: "Rules live in one AGENTS.md. init writes no CLAUDE.md except a one-line @AGENTS.md import when a CLAUDE.md, .claude/CLAUDE.md or CLAUDE.local.md in or above the repo would otherwise shadow it. Decided after verifying the Claude Code docs (AGENTS.md read natively since 2.1.277, all providers since 2.1.281)." (developer; source: chat 2026-10-15, addendum for plan §9, queued for implement:s3)
- 2026-10-15T09:12:55.751Z — The runner's persisted --transcript-dir (an absolute local path in committed bundle state) is fixed in s1: the state keeps the run id only, the flag is dropped; after s1 lands the current runs are re-recorded without the path and the pre-fix state commits are rewritten before the branch is pushed (gate #0 on 06223a0 predates them and stays reachable). Logged as a backlog bug closed by this bundle. (developer; source: chat 2026-10-15, plan-review round 1 (findings 0 and 24))
- 2026-10-15T09:12:55.814Z — The npm name cookwright is reserved by the developer now (a publish, their hands), before s1's docs land; the printed invocation stays npx cookwright. (developer; source: chat 2026-10-15, plan-review round 1 (finding 16))
- 2026-10-15T09:16:54.454Z — doctor's git check when the config does not load: it judges the work tree only (PASS 'work tree; baseBranch unverified, config invalid' / FAIL not a work tree); the baseBranch half needs the config. Implemented in s2 with the §4.8 config-invalid cases. (orchestrator; source: plan-review re-check notes, 2026-10-15)
- 2026-10-15T09:16:54.519Z — The CHARTER amendment quoted in plan §2 says init writes CLAUDE.md only when a shadowing file exists; §4.4 step 4 also writes it when Claude Code is older than 2.1.281 (a version that ignores AGENTS.md). s3 surfaces the amendment wording to the developer in its strings batch before appending it; the developer's wording is final. (orchestrator; source: plan-review re-check notes, 2026-10-15)
- 2026-10-15T09:27:26.325Z — The leftover transcriptDir on plan-review run 0 was removed from state.json by hand (one key deleted, nothing else touched): the CLI refuses to re-record a done phase, so the re-record route of plan §2 (a) was not available. The pre-s1 state commits that still carry the path (d00d0bf, 3c39dc3, 09297eb) are rewritten before the branch is pushed, per the developer's decision. (orchestrator; source: after implement:s1, 2026-10-15)
- 2026-10-15T09:27:26.379Z — probes.mjs (hasTool, claudeVersion, ignored, with tests) was not built in s1 because the recorded s1 scope predates the round-1 plan revision; s2 builds it as part of doctor (§4.8 probes, §4.4 step 6's ignored). levels.mjs holding only requires, with the level names and the no-next-level text in messages.levels / messages.noNextLevel, is accepted (it avoids a config → levels → messages → config cycle). The bundle CLI's other subcommands still ignoring unknown flags goes to the backlog in s3, beside E-004. The strings test of §4.9/§6 is s3's. The init/doctor placeholders are replaced by s3/s2. (orchestrator; source: implement:s1 open questions, 2026-10-15)
- 2026-10-15T09:39:35.140Z — Accepted as built: the loader's multi-line config message joined to one readout line; the 'cookwright doctor: ' prefix on the hook-mode counts line; weak and unverified appended to the level line with '; '; a check that throws is a FAIL row 'the check could not run'; --hook takes precedence over refusals (exit 0 always); rules.size measures every existing rules and shadowing file and is PASS with none. For s3: reuse hasImport (rules/block.mjs) and sessionStartCommands (doctor/claude.mjs) in init steps 4 and 5; write the block's prose in agents-block.md with RULES_VERSION staying 1; during the §7 dogfood add '!.env.example' to this repo's .gitignore so it matches what init writes, and set the README to say init and doctor exist. Backlog in s3: the hook command tests node_modules/cookwright under CLAUDE_PROJECT_DIR, so a Claude session started in a subdirectory of the repo, or a package installed in a workspace sub-package, prints 'package not installed' although doctor would find the root from there. (orchestrator; source: implement:s2 open questions, 2026-10-15)
- 2026-10-15T09:54:01.414Z — Accepted as built: the ignored probe uses git check-ignore --no-index (a tracked path would otherwise always read 'not ignored'); the .gitignore step may append a duplicate pattern line to keep the negation after the patterns; a fresh config writes every paths key as the plan says (Level 2 uses bundles and playbook; omitting them is E-007's question); init without git refuses with exit 2, since init is a command, not a check or hook. For fix:core: this repo's AGENTS.md has two '## State homes' headings (its own section and the managed block's); rename the repo's own section (e.g. '## State homes of this repo'), never the block's headings, which every user receives. The CHARTER.md amendment is appended in fix:core with the developer's final wording, asked after the review starts. (orchestrator; source: implement:s3 open questions, 2026-10-15)
- 2026-10-15T12:19:20.617Z — CHARTER.md amendment, final wording, to append under Amendments in fix:core: "2026-10-15. Rules live in one AGENTS.md. init writes no CLAUDE.md, except one that imports AGENTS.md (the single line @AGENTS.md) when Claude Code would otherwise not read AGENTS.md: a CLAUDE.md, .claude/CLAUDE.md or CLAUDE.local.md in or above the repo shadows it, or the installed Claude Code is older than 2.1.281. An existing root CLAUDE.md gets the import line prepended instead. Decided after verifying the Claude Code docs (AGENTS.md read natively since 2.1.277, all providers since 2.1.281)." (developer; source: chat 2026-10-15, after review:core (finding 8))
- 2026-10-15T12:19:20.670Z — fix:core applies findings 0/6 (record session makes every files entry repo-relative and refuses an absolute one; the no-absolute-path test walks every file under the bundle directory), 2 (append the ignore patterns whenever a protected path is not ignored, even if listed earlier; second run idempotent), 3/11 (one shared 1.5 s timeout for every git call of doctor, init, probes and workTreeRoot), 7 (lstat in init and doctor; CLAUDE.md and AGENTS.md resolving to the same real file is kept and host.rules PASS; any other symlinked target refused in preflight), 8 (append the charter amendment with the developer's final wording), 9 (validateConfig on a fresh config, refuse before any write), 10 (.gitkeep decided by git ls-files, not readdir), 12 (reword the settings note and README to 'other settings preserved (reformatted)'), plus the duplicate '## State homes' heading in this repo's AGENTS.md. Finding 1 is B-002, deferred by the plan: no change. Finding 4: the block's secrets line is reworded to 'Never write a plaintext env file (.env, .env.*) holding a real value, not even as a fallback'; the test fixtures keep writing env files in scratch repos with a value that is visibly a dummy (DUMMY=1), since the secrets check needs files to exist; the developer sees the reworded line in the strings batch. Finding 5 (npm name unpublished): the developer's publish is pending (ENEEDAUTH on the first attempt); the orchestrator verifies npm view cookwright before the branch lands and records the outcome; the invocation does not change. The history rewrite before push now covers every state commit written before fix:core's record-session fix, not only the pre-s1 three. (orchestrator; source: review:core findings, 2026-10-15)
- 2026-10-15T12:36:56.283Z — Accepted as built, over the earlier dispositions: tests write no env file at all (index entries and an injected root listing), so the block's secrets line keeps its stricter wording unchanged; doctor runs inside one 1.8 s total budget with a 1.5 s cap per call rather than a per-call timeout alone; .gitkeep is decided by git ls-files --cached --others --exclude-standard; the settings row says 'the other settings kept' with a layout suffix only when re-serialising changes the layout; the B-002 attempt (a31d247) stays reverted (1eb68ff), B-002 open. The six records committed before the scrub landed (three implement session reports, the three findings files) are scrubbed once in the working tree with the runner's own scrubLocalPaths and committed with this state; the history rewrite before push removes the paths from the earlier commits. (orchestrator; source: fix:core report, 2026-10-15)
- 2026-10-15T12:45:34.997Z — fix:whole applies findings 2/12 (refuse a write when any path component between the root and the target is a symlink, by comparing realpath(dirname) with the real root; README sentence made true), 3 (scrub structured values, not serialized text: walk the object and scrub each string before JSON.stringify, scrub raw text for .md; a local path is one under the repo root (made relative), the home dir, os.tmpdir(), <local path>, <local path>, /Volumes, <local path>, /home/*, or a Windows drive or UNC path; JSON.parse the result before any rename and refuse on failure), 6 (same fix), 8 (a left boundary before every machine-dir pattern; app<local path> and URLs untouched; tests), 5 (changelog and playbook join the overlap check: neither may equal or nest inside bundles, closeouts or backlog, nor equal each other; tests refuse before any write), 10 (a TimedOut check is SKIP 'unverified: <what> did not answer in time', never drift), 11 (hasImport accepts @./AGENTS.md as the same import). Finding 4 is B-002, deferred: no change. Findings 1/9 (npm name) stay the developer's landing precondition. Findings 0/7 (the history rewrite and the commit ids it changes) are decided by the developer before any rewrite; the plan's 'every recorded commit id survives' claim is corrected in the closeout, not in plan.md. (orchestrator; source: review:whole findings, 2026-10-15)
- 2026-10-15T13:43:45.822Z — The npm name cookwright is held by the developer's own account: npm publish printed '+ cookwright@0.0.0' and the registry record (npm view, maintainers) is the developer's; the registry first shows a 2-file placeholder cookwright@0.0.0-stage ('Temporary package placeholder for staged publishing') created by npm's staged publishing while 0.0.0 is processed. Review findings review-core 5 and review-whole 1/9 (an unreserved name behind npx cookwright) are closed on this evidence; the closeout quotes the registry's dist-tags at verification time. (developer; source: npm publish, 2026-10-15 13:42Z)
- 2026-10-15T14:08:19.204Z — History rewrite now, before merge: git filter-repo --replace-text on the branch with a per-path replacement list, after confirming no main commit is rewritten; the recorded ids remapped with a one-off script fed by filter-repo's commit-map, not committed and not a bundle remap subcommand; one fresh gate on the new HEAD so bundle check passes on real evidence; the finding closed on that evidence, not with --accept-open; the remap backlogged as an enhancement with its real justification (a user who purges a leaked secret from history should keep their bundle evidence), built when a second need shows up; the procedure recorded in the closeout minus the developer's values; what wrote the paths and since when the fix is in recorded too. (developer; source: chat 2026-10-15, after review:whole (findings 0 and 7))
