# Bundle playbook

How a Leeka feature bundle runs across many fresh-context sessions with one orchestrator. This is the judgment layer (tier three) of the agent operating model §7. What a script enforces is not repeated here:

- **The state:** `scripts/bundle.mjs`, its only writer.
- **The phase order and the schemas:** `.claude/workflows/bundle-phase.js`.
- **Credentials and denies:** `ops/README.md`.

The entry point is the `/bundle` skill. CLAUDE.md's rules apply throughout; this file names the few a phase needs.

## Phases

Each Workflow phase is one run, and the gate runs between runs.

| Phase | Who | Output |
|---|---|---|
| `plan-review` | Workflow: Codex + a fresh red-team, then verifiers | findings folded into the plan before any code |
| `implement:<session>` | Workflow: one implementer session per run, sequential | commits at checkpoints; a session report; its gate |
| `review:<slice>` | Workflow: Codex + red-team on the range frozen at phase start, then verifiers | a findings file: confirmed / plausible / rejected |
| `fix:<slice>` | Workflow: one fix session | commits; a gate (`--sql` on a schema slice) |
| `review:whole`, `fix:whole` | the same, over `base..HEAD` | final findings and fixes; a gate |
| `atlas` | the atlas operator, in the orchestrator's shell, following the `atlas` skill | a scoped capture with every moved image explained; recaptured after any later UI fix |
| `operator` | **Cesar**: the dev apply, then the preview OTA | deploy-log rows (he runs both; the orchestrator hands him the exact commands) |
| `qa` | Cesar on the device; fix sessions for what he finds | one `record qa` per round; a recapture and a delta review after fixes |
| `closeout` | the docs role drafts from `closeout-draft`, then a Workflow run re-derives every claim | `docs/phase-closeouts/<slug>.md` |
| merge | **Cesar** | `bundle check` passes, then a fast-forward; ops run from `main` |

- **Slices.** A client-only bundle has one slice; a schema bundle has two, schema first.
- **The dev apply** happens immediately before the preview OTA, never mid-bundle, so a migration that has not reached a hosted database can still be edited in place.
- **No device leg** when the bundle has no member-visible surface. The closeout names the exemption and the dry run that stood in.

## The loop, per phase

**The tree rule.** "Clean" before a Workflow run or a gate means clean apart from `docs/bundles/`: the CLI writes the state there between commits. Anything else dirty is someone's unfinished work. The landing check is stricter: it requires everything committed, `docs/bundles/` included, because the bytes it reads must be the bytes that merge.

**Never rebase a running bundle.** Every gate, slice end and frozen range is a commit id. If `main` moves, merge `main` into the branch, so the recorded commits stay reachable. The merge is a code commit and needs a new gate. Then `main` still fast-forwards to the branch.

### Workflow phases

This covers `plan-review`, `implement:*`, `review:*`, `fix:*`, `qa` rounds and `closeout`.

1. `node scripts/bundle.mjs phase <slug> start <phase> [--token-target N]`.
   - The CLI refuses unless every earlier phase is done.
   - The start freezes the review range.
   - A done phase reopens this way only while every later phase is still pending, or is the closeout, which resets with it.
   - **Every rerun starts here too:** on a running phase, `start` opens a new run, so each rerun is counted and keeps its own id.
2. `node scripts/bundle.mjs args <slug> <phase>`, then `Workflow({ scriptPath: '.claude/workflows/bundle-phase.js', args })`.
   - **As soon as the runtime returns the run id**, record it: `bundle phase <slug> run <phase> --run-id <id> --transcript-dir <dir>`. That id is what lets a crashed orchestrator's successor resume the run in flight instead of paying for every finished session again.
   - **Resume** (the orchestrator crashed mid-run) with `resumeFromRunId`: `bundle status` prints the call, and only for a run in flight.
   - **Rerun** (the findings were acted on, or a review came back incomplete) with `phase start` again, then a fresh Workflow run without `resumeFromRunId`. A resume replays every unchanged agent result, a timeout included, and a replayed QA review would describe code it never saw.
   - Never hand-edit args. They are byte-stable for resume and carry the content hash of every file the prompts point at, so an edited plan, findings file or closeout re-runs instead of replaying. The state file itself is pointed at unhashed, deliberately: every CLI write would otherwise defeat the cache. The one exception is the closeout run, whose args carry the state revision.
3. Record the run's `results`:
   - **Findings:** `plan-review`, `review:*` and `closeout` go through `bundle record <slug> findings <phase>`, which stamps the HEAD they were recorded at. A review whose reviewer never finished is refused as incomplete: start a fresh run, or pass `--accept-incomplete "<reason>"`, which is recorded as a decision.
   - **Sessions:** `implement:*` and `fix:*` go through `bundle record <slug> session <phase>`.
   - **A `qa` round returns both:** `results.fix` goes to `record session qa`, and `results.review` to `record findings qa`.
4. **Verify.** See "Between phases" below.
5. **Gate:** `node scripts/bundle.mjs gate <slug> [--sql]`. It needs everything outside `docs/bundles/` committed. A schema slice's `fix:<slice>` gates with `--sql`.
6. `node scripts/bundle.mjs phase <slug> done <phase> --usage <budget.spent()>`. `done` refuses until the phase has its evidence:
   - review phases need a findings record;
   - `implement:*` and `fix:*` need a session report and a passing gate on HEAD (`--sql` for a schema slice's fix);
   - a `qa` phase whose code changed needs a gate and a round review recorded at HEAD.

   It records the end commit that `bundle check` compares with the slice gate, so gate first, then done, on the same HEAD.
7. Commit the state: `git add docs/bundles/<slug> && git commit -m "chore(bundle): <slug> <phase>"`.

**What counts as code.** Anything outside `docs/` and outside markdown files is code. A commit touching only docs (the state, findings, screenshots, a closeout, deploy-log rows, CLAUDE.md) needs no new gate and no review. A gate "covers" code when it passed on a commit containing it. CI's format check still covers every commit.

**Terminal reviews.** `plan-review`, `closeout` and `qa` end on their own findings. `phase done` refuses while the latest record has a P1 or P2 open. P3s never block; they stay in the record as residue.
- **`plan-review`:**
  1. Fold the blocking findings into the plan, which is the bundle's own copy at `docs/bundles/<slug>/plan.md`, committed with it.
  2. Rerun the phase. With open findings on record, the rerun is a **re-check**: one verifier re-judges only those findings against the revised plan. A fresh adversarial pass every round would converge by exhaustion, not by agreement.
- **`closeout`:** fix the text, commit it, rerun. As with the plan, a rerun with findings open is a re-check of those findings.
  - If the closeout is edited after `phase done` (a typo, the state-home line), `bundle check` fails on the changed sha. `phase start closeout` reopens it for a fresh verify.
- **`qa`:** see below.

`--accept-open "<reason>"` closes a terminal phase anyway and records the decision. Use it only when the open finding really is Cesar's call.

**The closeout, in order:**
1. `phase start closeout`.
2. The docs role writes `docs/phase-closeouts/<slug>.md` from `bundle closeout-draft <slug>` and commits it. `bundle args` refuses until the file exists.
3. The Workflow verify run.
4. Record the findings.
5. Fix and rerun until nothing is open.
6. Gate, then done.

### Shell and operator phases: `atlas`, `operator`, `qa`

1. `phase <slug> start <phase>`.
2. Do the work:
   - **`atlas`:** the atlas operator follows the `atlas` skill and commits the capture.
   - **`operator`:** hand Cesar the exact dev-apply and preview-OTA commands. He runs them. Then read the result back with `scripts/ops-status.sh dev`, and commit the deploy-log rows together with CLAUDE.md's Dev schema line. CI's schema-claims check is red on any push where the two disagree.
   - **`qa`:** store each device round Cesar reports with `bundle record <slug> qa` (stdin: his findings as notes). A fix is a Workflow run of the `qa` phase.
     - One run does two things: the fix session, pointed at the latest round and at any open findings the previous round's review left, then a Codex + red-team review of exactly what it committed. QA fixes land after the whole-branch review, and without this nothing would ever read them. The review is bound to that round's notes and commits, so it can never be replayed for a later round.
     - A bundle with no member-visible surface has no device leg: `phase done qa --no-device "<why>"` records the exemption. Otherwise `done` refuses without a recorded round.
     - After the run, the atlas operator recaptures and reviews the delta.
     - When a fix needs a new build on the device, Cesar publishes another preview OTA. That is a new round in the same phase; keep the phase open (`--keep-open`) between rounds.
3. **Gate** whenever the round changed code.
4. `phase <slug> done <phase>`, then the `chore(bundle)` commit.

## Kickoff

- **The canary:** `env -u OPENAI_API_KEY node scripts/guardrail-canary.mjs`. Its dry-run push raises a 1Password prompt that is **meant to be denied**; never ask Cesar to approve a prompt an agent caused.
- **Sibling plans:** `git branch --list 'feat-*' --sort=-committerdate | head`. Two sessions once planned the same item on the same day, and only the reflog showed it (E-213). A branch-level plan doc is invisible to a session that did not write it.
- **Deploy state:** `scripts/ops-status.sh dev` and `scripts/ops-status.sh prod`, the only read path to either.
- **The split.** Propose it to Cesar in about ten lines: slices, sessions, each session's scope as plan sections, checkpoints. `bundle init` writes it once he confirms. Cut the branch first, because `init` records the branch that is checked out.

## Roles

### Orchestrator

It holds the plan, Cesar's decisions and the review rounds, and it checks every session against them.

- **Decides** what the plan already settles, recording each decision with `bundle decide` so the closeout's "Decided on your behalf" section is generated, not remembered.
- **Owns** the tree between sessions and commits the state in its own `chore(bundle)` commits.
- **Never** runs a Workflow over a tree that is dirty outside `docs/bundles/`. Before resuming an implement run, the tree is clean, or the partial work is committed or stashed under a name the resumed session is told about.
- **Enters** the harness's cost readout with `bundle cost` after each phase. The runtime does not expose USD, so the closeout labels it as entered.

### Implementer

- Works only inside its session's scope; anything else goes to `open_questions`.
- Commits at each checkpoint, **staging named paths only**, never `git add -A`, which would sweep the state and other sessions' work into a code commit.
- Follows CLAUDE.md's doc-sync rules in the same commit: `data-model.md` with a migration, `design-system.md` with a primitive, `notification-flows.md` with push copy. Regenerates the DB types on a schema-shape migration.
- **On a schema slice**, also writes the deploy log's "Next deploy (queued)" block for Cesar's hands. It never applies anything to a hosted database.
- Lists every user-facing string it added or changed, EN and FR, in `strings`.

### Reviewer

- Read-only: no edits, no git writes, no supabase/psql/docker. Pinned to the frozen range.
- Every finding names a concrete failure scenario.
- The verifier defaults to **plausible**, never confirmed, when unsure.
- Inside one review run, the Codex reviewer and the red-team run concurrently, since they only read; review runs never overlap an implement or fix run, because phases run in order.

### Docs

Drafts the closeout from `bundle closeout-draft <slug>`, whose numbers and tables are machine-derived and are never retyped. It adds the narrative, the brief-review pass and the state-home updates (CLAUDE.md "Ledger discipline"). The closeout Workflow run then re-derives every claim.

The draft's tables carry the state revision they were generated from. The closeout phase's own run and gate come later and are not in them, and the verifier judges the tables against that revision. `bundle check` passes the closeout only when its latest verify run judged the closeout text as it is now (the sha matches) and left nothing open.

### Atlas operator

- Follows the `atlas` skill: scope from the diff, `--only` for the diffed screens, never `--all` or a widened sweep.
- Explains every moved image and restores environment churn.
- The capture takes the rig lock, so an SQL gate cannot reset the world under it.

## Escalation

Stop and ask Cesar, batched where possible:

- every user-facing string, EN + FR, batched once per session from the report's `strings`
- anything that contradicts the plan or a dated decision of his
- legal and evidence semantics
- a data-classification call that would widen what `agent_ro` can read
- a scope change
- every deploy, OTA, build, store submission, and any dev or prod action. These are his hands: hand him the exact command, never run it, never offer to.

## Between phases

The orchestrator's own verification, beyond the gate:

- the diff surface matches the session's declared scope (`git diff --stat <range>`)
- any redefined SQL function was diffed against the numerically latest body, not the one the branch started from (B-033)
- the strings batch went to Cesar
- the atlas diff has no unexplained image
- one implementer or fix session owns the tree at a time; the local Supabase stack is shared, and `run-sql-tests.mjs --reset` wipes it
- the session's report is read, and its riskiest diff with it, before any fix is spent on it

## Flake policy

The gate has no retry mechanism. A red gate is recorded red.

When the only failures are an allowlisted flake, the orchestrator may re-gate once with `bundle gate <slug> --retry --flake <id>`. The allowlist is `KNOWN_FLAKES` in `scripts/lib/bundle/gate.mjs`: B-102 `ota-publish.check.test.mjs`, B-130 `access_mode_flip`. The retry is a second event marked `retryOf` and `flake`; the red one stays in the state and the closeout, and `bundle check` fails any retry that names no allowlisted flake. Any other failure is a failure. A flake that keeps recurring is fixed, not re-gated.

**Expired fixtures are not flakes.** A suite that dies FATAL with `race_past` is joining a race whose day has passed. B-135 (the seeded races, fixed 2026-10-01) was one. B-136 (literal 2026 dates in nine suites, due before 2026-11-29) is next. Neither the quarantine nor `--retry` covers a whole-suite FATAL: fix the fixture.

## Codex by file reference

Codex reviews by pointing at files and ranges, never by inlining a diff: an inlined diff hits ARG_MAX, and native `codex review --base` times out on a large one.

1. Write the runner script with the Write tool, into a scratch dir:

   ```bash
   #!/bin/bash
   export GSTACK_CODEX_MODEL=gpt-5.6-sol   # the default model is unusable on this account
   cd <repo>
   codex exec -m "$GSTACK_CODEX_MODEL" -c model_reasoning_effort=high --sandbox read-only \
     "<task: the range or plan path; at most N read-only commands, then STOP and write the report>" \
     > <scratch>/codex.out 2>&1
   ```

2. Run it with Bash in the **foreground**, `timeout: 600000`. Inside a Workflow session, a background run can outlive the session and return nothing.
3. **If it hits the ceiling:** find the session id near the top of the output and run `codex exec resume <id> "Stop investigating now. Write the full report from what you have already read."` at `medium` effort. The loaded context survives, and the report comes back in minutes.
4. Transcribe, never embellish. `timedOut: true` with the partial output path is a valid result; an empty list that means "never finished" is not.

## Prompt header

Every session prompt starts from `header()` in the Workflow script:

- the role
- the bundle, branch and phase
- the playbook and plan paths, each with its content hash, and the state path, deliberately unhashed (see the loop, step 2)
- "read these yourself"
- the structured-result instruction

Then come the session's scope as plan sections, the frozen range, and the checkpoints. **Pointers, not paste:** a prompt that pastes state goes stale on the next write and breaks the resume cache.

## Known limits

- **No per-session timeout.** A stalled session is bounded by its phase run and, for Codex, by the 600 s ceiling above.
- **The atlas bounds B-125's stall** with an abort after consecutive TIMEOUTs (`ATLAS_MAX_CONSECUTIVE_TIMEOUTS`, default 6). SIGINT/SIGTERM unwind through its normal restore path. SIGKILL and a hung synchronous child are not covered, and B-127, a system dialog captured as a screen, is untouched.
- **Output tokens** are recorded per run as the turn's `budget.spent()`: exact when a turn runs one workflow, which is this playbook's cadence.
- **The SQL suites are not in CI.** "CI green" excludes them, so a schema slice's `--sql` gate is their only run.
- **Rule 5 during implementation.** The atlas runs after `review:whole`, so an implement or fix commit that touches a captured UI surface is blocked by pre-commit Rule 5. The hook's only escape, `--no-verify`, also skips its doc-sync rules and gitleaks. Until the hook offers a Rule-5-only deferral (E-218, Cesar's call), such a commit runs `git diff --cached` against CLAUDE.md's doc-sync rules by hand before `--no-verify`, and the whole-branch review checks doc sync by name.
