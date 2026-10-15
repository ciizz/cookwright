# Bundle playbook

How a feature bundle runs across many fresh-context sessions with one orchestrator. This is the judgment layer; what a script enforces is not repeated here:

- **The state:** the bundle CLI (`npx cookwright bundle`, written `bundle …` below), its only writer. It reads `cookwright.json` at the repo root for the paths named `<paths.x>` here.
- **The phase order and the schemas:** the host's `bundle-phase` workflow (`hosts/<host>/workflows/bundle-phase.js`).

The entry point is the `/bundle` skill. The repo's rules file (`AGENTS.md`, which a `CLAUDE.md` may import) applies throughout; this file names the few rules a phase needs.

## Phases

Each Workflow phase is one run, and the gate runs between runs.

| Phase | Who | Output |
|---|---|---|
| `plan-review` | Workflow: a fresh red-team (plus Codex when installed), then verifiers | findings folded into the plan before any code |
| `implement:<session>` | Workflow: one implementer session per run, sequential | commits at checkpoints; a session report; its gate |
| `review:<slice>` | Workflow: red-team (plus Codex) on the range frozen at phase start, then verifiers | a findings file: confirmed / plausible / rejected |
| `fix:<slice>` | Workflow: one fix session | commits; a gate |
| `review:whole`, `fix:whole` | the same, over `base..HEAD` | final findings and fixes; a gate |
| `qa` | the developer, on the built product; fix sessions for what they find | one `record qa` per round; a delta review after fixes |
| `closeout` | the docs role drafts from `closeout-draft`, then a Workflow run re-derives every claim | `<paths.closeouts>/<slug>.md` |
| merge | the developer | `bundle check` passes, then a fast-forward |

- **Slices.** One slice is the common case; several when the work has independent review units (a schema and a client, a library and its CLI).
- **No QA leg** when the bundle has no user-visible surface. The closeout names the exemption and what stood in for it.

## The loop, per phase

**The tree rule.** "Clean" before a Workflow run or a gate means clean apart from `<paths.bundles>/`: the CLI writes the state there between commits. Anything else dirty is someone's unfinished work. The landing check is stricter: it requires everything committed, `<paths.bundles>/` included, because the bytes it reads must be the bytes that merge.

**Never rebase a running bundle.** Every gate, slice end and frozen range is a commit id. If the base branch moves, merge it into the bundle branch, so the recorded commits stay reachable. The merge is a code commit and needs a new gate. Then the base branch still fast-forwards to the bundle.

### Workflow phases

This covers `plan-review`, `implement:*`, `review:*`, `fix:*`, `qa` rounds and `closeout`.

1. `bundle phase <slug> start <phase> [--token-target N]`.
   - The CLI refuses unless every earlier phase is done.
   - The start freezes the review range, and records whether Codex is installed (so a resumed run on another machine still matches its cache).
   - A done phase reopens this way only while every later phase is still pending, or is the closeout, which resets with it.
   - **Every rerun starts here too:** on a running phase, `start` opens a new run, so each rerun is counted and keeps its own id.
2. `bundle args <slug> <phase>`, then `Workflow({ scriptPath: '<the path status prints>', args })`.
   - **As soon as the runtime returns the run id**, record it: `bundle phase <slug> run <phase> --run-id <id>`. That id is what lets a crashed orchestrator's successor resume the run in flight instead of paying for every finished session again.
   - **Resume** (the orchestrator crashed mid-run) with `resumeFromRunId`: `bundle status` prints the call, and only for a run in flight.
   - **Rerun** (the findings were acted on, or a review came back incomplete) with `phase start` again, then a fresh Workflow run without `resumeFromRunId`. A resume replays every unchanged agent result, a timeout included, and a replayed QA review would describe code it never saw.
   - Never hand-edit args. They are byte-stable for resume and carry the content hash of every file the prompts point at (the rules file, the playbook, the plan, findings), so an edited file re-runs instead of replaying. The state file itself is pointed at unhashed, deliberately: every CLI write would otherwise defeat the cache. The one exception is the closeout run, whose args carry the state revision.
3. Record the run's `results`:
   - **Findings:** `plan-review`, `review:*` and `closeout` go through `bundle record <slug> findings <phase>`, which stamps the HEAD they were recorded at. A review whose reviewer never finished is refused as incomplete: start a fresh run, or pass `--accept-incomplete "<reason>"`, which is recorded as a decision.
   - **Sessions:** `implement:*` and `fix:*` go through `bundle record <slug> session <phase>`.
   - **A `qa` round returns both:** `results.fix` goes to `record session qa`, and `results.review` to `record findings qa`.
   - **No local paths.** Every record and the state are written root-relative: a path inside the repo loses its root, a path elsewhere under the home or temp directory becomes `<local path>`, and a session report that lists a file outside the repo is refused.
4. **Verify.** See "Between phases" below.
5. **Gate:** `bundle gate <slug>`. It needs everything outside `<paths.bundles>/` committed.
6. `bundle phase <slug> done <phase> --usage <budget.spent()>`. `done` refuses until the phase has its evidence:
   - review phases need a findings record;
   - `implement:*` and `fix:*` need a session report and a passing gate covering the branch's code;
   - a `qa` phase whose code changed needs a gate and a round review recorded at HEAD.

   It records the end commit that `bundle check` compares with the slice gate, so gate first, then done, on the same HEAD.
7. Commit the state: `git add <paths.bundles>/<slug> && git commit -m "chore(bundle): <slug> <phase>"`.

**What counts as code.** Everything outside the state homes (`<paths.bundles>`, `<paths.closeouts>`, `<paths.backlog>`) — markdown included: a skill, this playbook and the rules file are product surface. A commit touching only the state homes (the state, findings, a closeout, a backlog line) needs no new gate and no review.

**Terminal reviews.** `plan-review`, `closeout` and `qa` end on their own findings. `phase done` refuses while the latest record has a P1 or P2 open. P3s never block; they stay in the record as residue.
- **`plan-review`:**
  1. Fold the blocking findings into the plan, which is the bundle's own copy at `<paths.bundles>/<slug>/plan.md`, committed with it.
  2. Rerun the phase. With open findings on record, the rerun is a **re-check**: one verifier re-judges only those findings against the revised plan. A fresh adversarial pass every round would converge by exhaustion, not by agreement.
- **`closeout`:** fix the text, commit it, rerun. As with the plan, a rerun with findings open is a re-check of those findings.
  - If the closeout is edited after `phase done` (a typo, a state-home line), `bundle check` fails on the changed sha. `phase start closeout` reopens it for a fresh verify.
- **`qa`:** see below.

`--accept-open "<reason>"` closes a terminal phase anyway and records the decision. Use it only when the open finding really is the developer's call.

**The closeout, in order:**
1. `phase start closeout`.
2. The docs role writes `<paths.closeouts>/<slug>.md` from `bundle closeout-draft <slug>` and commits it. `bundle args` refuses until the file exists.
3. The Workflow verify run.
4. Record the findings.
5. Fix and rerun until nothing is open.
6. Gate, then done.

### The QA phase

1. `phase <slug> start qa`.
2. The developer tries the built product and reports what they find. Store each round with `bundle record <slug> qa` (stdin: their findings as notes). A fix is a Workflow run of the `qa` phase.
   - One run does two things: the fix session, pointed at the latest round and at any open findings the previous round's review left, then a review of exactly what it committed. QA fixes land after the whole-branch review, and without this nothing would ever read them. The review is bound to that round's notes and commits, so it can never be replayed for a later round.
   - A bundle with no user-visible surface has no QA leg: `phase done qa --no-device "<why>"` records the exemption. Otherwise `done` refuses without a recorded round.
   - When a fix needs a new build in the developer's hands, that is a new round in the same phase; keep the phase open (`--keep-open`) between rounds.
3. **Gate** whenever the round changed code.
4. `phase <slug> done qa`, then the `chore(bundle)` commit.

## Kickoff

- **The tree:** `git status` clean, or every dirty path named and dealt with.
- **Sibling plans:** `git branch --sort=-committerdate | head`. Two sessions can plan the same item on the same day, and a branch-level plan doc is invisible to a session that did not write it.
- **The split.** Propose it to the developer in about ten lines: slices, sessions, each session's scope as plan sections, checkpoints. `bundle init` writes it once they confirm. Cut the branch first, because `bundle init` records the branch that is checked out.

## Roles

### Orchestrator

It holds the plan, the developer's decisions and the review rounds, and it checks every session against them.

- **Decides** what the plan already settles, recording each decision with `bundle decide` so the closeout's "Decided on your behalf" section is generated, not remembered.
- **Owns** the tree between sessions and commits the state in its own `chore(bundle)` commits.
- **Never** runs a Workflow over a tree that is dirty outside `<paths.bundles>/`. Before resuming an implement run, the tree is clean, or the partial work is committed or stashed under a name the resumed session is told about.
- **Enters** the harness's cost readout with `bundle cost` after each phase. The runtime does not expose USD, so the closeout labels it as entered.

### Implementer

- Works only inside its session's scope; anything else goes to `open_questions`.
- Commits at each checkpoint, **staging named paths only**, never `git add -A`, which would sweep the state and other sessions' work into a code commit.
- Follows the rules file's doc-sync rules in the same commit.
- Never runs anything that leaves the repo (a deploy, a publish, a store action): names the command in `notes` for the developer's hands.
- Lists every user-facing string it added or changed in `strings`; where strings live in the code is the rules file's call.

### Reviewer

- Read-only: no edits, no git writes, no database or container commands. Pinned to the frozen range.
- Every finding names a concrete failure scenario.
- The verifier defaults to **plausible**, never confirmed, when unsure.
- Inside one review run the reviewers run concurrently, since they only read; review runs never overlap an implement or fix run, because phases run in order.

### Docs

Drafts the closeout from `bundle closeout-draft <slug>`, whose numbers and tables are machine-derived and are never retyped. It adds the narrative and the state-home updates. The closeout Workflow run then re-derives every claim.

The draft's tables carry the state revision they were generated from. The closeout phase's own run and gate come later and are not in them, and the verifier judges the tables against that revision. `bundle check` passes the closeout only when its latest verify run judged the closeout text as it is now (the sha matches) and left nothing open.

## Escalation

Stop and ask the developer, batched where possible:

- every user-facing string, batched once per session from the report's `strings`
- anything that contradicts the plan or a dated decision of theirs
- a scope change
- every action that leaves the repo: a deploy, a publish, a build, a store submission. These are their hands: hand over the exact command, never run it, never offer to.

## Between phases

The orchestrator's own verification, beyond the gate:

- the diff surface matches the session's declared scope (`git diff --stat <range>`)
- the strings batch went to the developer
- one implementer or fix session owns the tree at a time
- the session's report is read, and its riskiest diff with it, before any fix is spent on it

## Flake policy

The gate has no retry mechanism. A red gate is recorded red.

When the only failures are an allowlisted flake, the orchestrator may re-gate once with `bundle gate <slug> --retry --flake <id>`. The allowlist is `gate.flakes` in `cookwright.json`: each entry is one of your backlog ids with a one-line description, and each is a known, deterministic fix waiting to land. The retry is a second event marked `retryOf` and `flake`; the red one stays in the state and the closeout, and `bundle check` fails any retry that names no allowlisted flake. Any other failure is a failure. A flake that keeps recurring is fixed, not re-gated.

## The gate's checks

`gate.checks` in `cookwright.json` lists the commands, in order; every one runs even after a failure, so one gate shows every red at once. A check may name the tools it `needs`; when one is missing the check is reported `skipped, needs <tool>, run setup` and the gate goes on. A command the shell cannot find is skipped the same way. A gate in which nothing ran is refused, not recorded: it can never stand as evidence. A check that runs an npm script the repo's `package.json` does not define is misconfiguration, not absence: the gate refuses before anything runs and names the script.

## Codex by file reference

Optional: the review runs a Codex reviewer only when the `codex` CLI was on PATH at `phase start`. Codex reviews by pointing at files and ranges, never by inlining a diff: an inlined diff hits ARG_MAX, and a native review of a large base times out.

1. Write the runner script with the Write tool, into a scratch dir:

   ```bash
   #!/bin/bash
   cd <repo>
   codex exec -c model_reasoning_effort=high --sandbox read-only \
     "<task: the range or plan path; at most N read-only commands, then STOP and write the report>" \
     > <scratch>/codex.out 2>&1
   ```

   The model is your Codex default; pass `-m <model>` to choose another.
2. Run it with Bash in the **foreground**, `timeout: 600000`. Inside a Workflow session, a background run can outlive the session and return nothing.
3. **If it hits the ceiling:** find the session id near the top of the output and run `codex exec resume <id> "Stop investigating now. Write the full report from what you have already read."` at medium effort. The loaded context survives, and the report comes back in minutes.
4. Transcribe, never embellish. `timedOut: true` with the partial output path is a valid result; an empty list that means "never finished" is not.

## Prompt header

Every session prompt starts from `header()` in the Workflow script:

- the role
- the bundle, branch and phase
- the rules file, the playbook and the plan, each with its content hash, and the state path, deliberately unhashed (see the loop, step 2)
- "read these yourself"
- the structured-result instruction

Then come the session's scope as plan sections, the frozen range, and the checkpoints. **Pointers, not paste:** a prompt that pastes state goes stale on the next write and breaks the resume cache.

## Known limits

- **No per-session timeout.** A stalled session is bounded by its phase run and, for Codex, by the 600 s ceiling above.
- **Output tokens** are recorded per run as the turn's `budget.spent()`: exact when a turn runs one workflow, which is this playbook's cadence.
- **CI** is checked only when `ci.workflow` is configured and `gh` is installed; otherwise the landing check says so in its summary line, and "CI green" is a claim nobody made.
