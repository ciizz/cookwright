# Stage 0 — the bundle runner runs outside Leeka

Closed 2026-10-15. Built by hand in one session, outside the runner, per the charter's "How it gets built". Branch `stage-0`, seven commits on top of the bootstrap `a5e0675`; merged by fast-forward.

## What stage 0 was for

The bootstrap commit lifted the bundle machinery from Leeka verbatim into `packages/cookwright/lifted/`. Nothing in it could run here: every path, gate command, phase list and authorization phrase was one repo's. Stage 0 moved each file to its home, replaced every such assumption with `cookwright.json`, made every gate step optional, kept the tests green, and emptied `lifted/`. From stage 1 on, cookwright is built through this runner.

## What shipped

**`cookwright.json`** at the repo root, with a JSON Schema twin in `packages/cookwright/schema/`. Version 1 holds: `hosts` (a list; the first is the default host), `baseBranch`, the four state homes under `paths` (`bundles`, `closeouts`, `backlog`, `playbook`), `gate.checks` (name, shell command, optional `needs`), `gate.flakes` (the retry allowlist, keyed by the repo's own backlog ids), and an optional `ci.workflow`. `src/lib/config.mjs` finds the root by walking up from cwd, applies defaults one level deep and validates by hand, every problem in one message; a test holds the schema and the validator to the same keys and defaults. `src/lib/hosts.mjs` is the host table (one entry, `claude`).

**The bundle CLI** at `packages/cookwright/src/bundle.mjs`, with its library under `src/lib/bundle/`. Every function takes `repo = { root, config }`; nothing is a module constant any more. Guidance strings live in `src/lib/bundle/messages.mjs`.

**The gate.** Checks come from config and run as shell strings. Absence is decided before anything runs: a check whose `needs` tool is absent, or whose command's first word is not on PATH, is skipped with `skipped, needs <tool>, run setup` (or `command not found: <cmd>`) and the gate goes on; once a command has started, every non-zero exit is a failure, 127 included. A gate in which nothing ran is refused and records nothing, so it can never stand as evidence. A gate that passed with skips reads as one everywhere: `status`, the closeout's gate table and the landing check (a WARN naming the skipped checks).

**The landing check** gained `SKIP` beside `PASS`/`WARN`/`FAIL` and a summary line that counts skips and warnings. `bundle.ci` is SKIP without a `ci` block and WARN when `gh` is not installed; only FAIL exits non-zero.

**What counts as code** is now everything outside the configured state homes, markdown included: a skill, the playbook and the rules file are product surface and need a gate and a review like any code.

**The host adapter** under `hosts/claude/`: `workflows/bundle-phase.js`, `workflows/docs-audit.js` and `skills/bundle/SKILL.md`. This repo's `.claude/skills/bundle` and `.claude/workflows/*.js` are symlinks into it, so the repo eats its own cooking without copying a script. The bundle workflow's prompts point at the rules files (`AGENTS.md` and `CLAUDE.md`, whichever exist), the playbook, the plan and the state, each hashed except the state; the Codex reviewer runs only when `args.codex` says the CLI was installed at `phase start` (a measured fact, frozen per run so a resumed run stays byte-identical); an incomplete review names whichever reviewer did not finish. `docs-audit.js` takes its doc list and invariants as args.

**The playbook** at `docs/playbook.md`, generic: the same loop, the roles, the flake policy, the gate's check rules, Codex as optional tooling.

## Where each lifted file went

The table from the deleted `LIFTED-FROM-LEEKA.md`, with the outcome. Leeka commit ids are the commit ids in the origin repo at lift time.

| Lifted (Leeka path) | Leeka commit | Home |
|---|---|---|
| `scripts/bundle.mjs` | `b6dd1a2d` | `packages/cookwright/src/bundle.mjs` |
| `scripts/bundle.test.mjs` | `c1baa645` | `packages/cookwright/src/bundle.test.mjs` |
| `scripts/lib/bundle/check.mjs` | `c1baa645` | `packages/cookwright/src/lib/bundle/check.mjs` |
| `scripts/lib/bundle/closeout.mjs` | `b6dd1a2d` | `packages/cookwright/src/lib/bundle/closeout.mjs` |
| `scripts/lib/bundle/gate.mjs` | `b6dd1a2d` | `packages/cookwright/src/lib/bundle/gate.mjs` |
| `scripts/lib/bundle/git.mjs` | `b6dd1a2d` | `packages/cookwright/src/lib/bundle/git.mjs` |
| `scripts/lib/bundle/ledger.mjs` | `206cb913` | deleted (E-001; recoverable at `a5e0675`) |
| `scripts/lib/bundle/phases.mjs` | `b6dd1a2d` | `packages/cookwright/src/lib/bundle/phases.mjs` |
| `scripts/lib/bundle/state.mjs` | `b6dd1a2d` | `packages/cookwright/src/lib/bundle/state.mjs` |
| `scripts/lib/rig-lock.mjs` | `819e762b` | `packages/cookwright/src/lib/rig-lock.mjs` (generic, tested, unused until E-001) |
| `.claude/workflows/bundle-phase.js` | `b6dd1a2d` | `hosts/claude/workflows/bundle-phase.js` |
| `.claude/workflows/docs-audit.js` | `150c04a6` | `hosts/claude/workflows/docs-audit.js` (rewritten args-driven) |
| `.claude/skills/bundle/SKILL.md` | `b6dd1a2d` | `hosts/claude/skills/bundle/SKILL.md` |
| `ops/PLAYBOOK.md` | `2e773ab6` | `docs/playbook.md` |

The move is one pure-rename commit (`95709f2`), so `git log --follow` crosses it.

## What was replaced, by category

Named by category, not by the origin repo's values.

- **Hardcoded state-home paths** (the bundles directory, the closeouts directory, the playbook) → `paths.*`.
- **The base branch name** in init's refusal, four merge-base calls and the landing check → `baseBranch`.
- **The package's own location as the repo root** → the directory holding `cookwright.json`, found upward from cwd.
- **The Workflow script path** → the host table.
- **Five npm scripts as the gate**, one more behind a runtime check, and one extra "SQL leg" behind a lock and a disk preflight → `gate.checks` with `needs`; the extra leg removed entirely (E-001).
- **A flake allowlist keyed to the origin repo's backlog ids** → `gate.flakes`, empty by default.
- **Two stack-pack phases** (a screenshot atlas, an operator block) in the derived phase list → removed; `qa` stays (E-002 adds manual phases via config).
- **A repo-wide documentary check** of a deploy log against a rules file, **a UI-surface tripwire** reading a pre-commit hook, and **a CI check pinned to one workflow file** → the first two deleted (E-001, E-002), the third configured or skipped.
- **A Codex reviewer with a pinned model and an account remark** → Codex optional, no model pin.
- **Bilingual string reports** → `strings` optional with `key | text | context`; where strings live is the rules file's call.
- **A person's name as the authority** throughout the CLI, the workflows, the skill and the playbook → the developer.
- **Citations of an internal operating-model document** → the sentence each stood for, or dropped.
- **"Not code" = all docs and all markdown** → exactly the three state homes.

## Tests

| | Before (lifted) | After |
|---|---|---|
| Test files | 1 | 2 |
| Tests | 60 | 78 (61 bundle + 17 config) |
| Removed suites | — | ledger, hook/tripwire, SQL preflight |
| Added | — | config discovery/defaults/every refusal/schema parity/trailing slash/overlapping homes; gate skipping, not-found, inner-127-is-red and all-skipped refusal; skipped checks on the recorded event, in `status` and as a landing WARN; CI SKIP/WARN; summary counts; non-code pathspecs; args `cli`/`rules`/`codex`, rules omitted when absent; two CLI walks: `init → gate → phase start → args → status → check --ci`, and a red gate → refused retry → audited retry → `record findings` → `phase done` → `decide` → `cost` |

`npm ci && npm test` at the root: 78 passing.

## Verified by hand

- `node packages/cookwright/src/bundle.mjs status` from the root and from `packages/cookwright/`: root found, exit 0. From a directory with no config: exit 2 with the refusal.
- On a scratch branch `bundle/smoke` (deleted afterwards): `init` with a slice asking for an `sql` leg refused with a pointer; `init` created `docs/dev/bundles/smoke/{plan.md,state.json}` and derived eight phases; `gate smoke` ran `npm test` and recorded gate #0; `phase smoke start plan-review`; `args` printed the state, plan, playbook and rules pointers with hashes, `cli` and `codex`; `status` printed the Workflow call with `scriptPath: 'hosts/claude/workflows/bundle-phase.js'`; `check` failed as a mid-bundle branch should, with the summary line.
- `Workflow({ scriptPath: 'hosts/claude/workflows/docs-audit.js', args: {} })` and the same for `bundle-phase.js`: both scripts parse at the relative path and their args guards throw before any agent starts (0 agents, 0 tokens).
- `/bundle` through the `.claude/skills/bundle` symlink: the host loaded it in this session.
- The literal grep over `packages`, `hosts`, `docs/playbook.md`, `cookwright.json`: no origin-repo path, command, id or name outside the charter and this file's table.

## Reviews

**Plan review** (one fresh-context adversarial reviewer, before code): 15 findings, one P1. The P1 was that making the extra gate leg's checks skippable would let a gate that never ran the suites count as evidence; the fix, after a second opinion from the developer, was to cut gate legs from stage 0 entirely. Other findings folded in: freeze the Codex fact per run instead of reading PATH at `args` time; WARN rather than SKIP when CI is configured but `gh` is missing; refuse an all-skipped gate; treat the state homes, not all markdown, as non-code; point every prompt at the rules file; no formatter requirement in docs-audit prompts; never an absolute path in a printed Workflow call; name the oversized functions to split; list the test breakages by name; keep the origin repo's values out of this closeout.

**Diff review** (one fresh-context adversarial reviewer, read-only, over `main..stage-0`): see "Diff review findings" below.

## Diff review findings

Ten findings, one P1, all addressed in the commit after the review:

- **P1** A shell exit 127 from a command that had started (for example `npm test` with its runner not installed) was recorded as "skipped", so a fresh clone without `npm ci` could gate green with the suite never run. Now absence is decided before the run by probing the command's first word on PATH; once a command starts, 127 is a failure.
- **P2** A gate that passed with skipped checks was indistinguishable from a full pass downstream. Now the skipped names show in `status`, in the closeout's gate table and as a WARN in `bundle.gate-latest`.
- **P2** A trailing slash in `paths.bundles` made the gate's dirty-path exclusion miss and refuse every gate. Paths are normalized on load; `.`, empty and doubled segments are refused.
- **P2** Schema and validator agreed on keys only. Added: hosts unique, `version` required (never defaulted), `$schema` a string, a non-object config refused, a `pattern` on every path, and a check that `bundles`, `closeouts` and `backlog` do not nest.
- **P2** The adapter hashed only `CLAUDE.md` while the charter puts rules in `AGENTS.md`. The host now lists both candidates; whichever exist are hashed into every prompt, in order.
- **P2** Untested paths: `runGate → recordGate` with a skipped check, the retry happy path and its "not allowlisted" refusal, `record`/`phase done`/`decide`/`cost` through `main()`, the omitted `rules` pointer. All covered now (`main` takes an injectable stdin reader).
- **P3** The CLI invocation baked into messages is this monorepo's path; the package has no `bin`. Added to E-007.
- **P3** `review()` in the workflow was 49 lines; the verify stage is its own function.
- **P3** A stale file header in `closeout.mjs`; the Codex recovery line had dropped "at medium effort" that the playbook still prescribes. Both fixed.
- The reviewer confirmed: no dependency beyond vitest, nothing copied into a user repo, no origin-repo value in a committed file outside the kickoff's own text.

## Decided during the stage

- vitest as the one devDependency (asked; node:test would have meant porting a thousand lines of assertions in the same stage).
- `ledger.mjs`, the tripwire and the hook reader deleted rather than parked (asked).
- `docs-audit.js` generic and args-driven rather than moved with Leeka prompts (asked).
- Gate legs cut from stage 0; `hosts` plural (the developer, after a second-opinion review of the plan).
- `rig-lock.mjs` kept, renamed, unused: generic and well tested; deleting it would be churn for E-001 to undo.
- `qa` stays a core phase with a `--no-device "<why>"` exemption: every app has a "the developer tries it" step.

## Open items

Backlog E-001, E-002, E-003, E-004, E-007, E-008, E-009 (see `docs/dev/backlog.md`). Stage 1 is the first bundle through the runner.
