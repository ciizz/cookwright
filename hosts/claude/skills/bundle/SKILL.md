---
name: bundle
description: Run an approved feature bundle across fresh-context sessions — start one from an approved plan, or resume one by slug. Drives the phase loop (plan review, one implement run per session, review/fix per slice, whole-branch pass, QA, closeout) through the bundle CLI and the bundle-phase Workflow. Use when the developer approves a plan and says go on work too large for one context, or invokes /bundle.
---

# /bundle

**Start or resume a feature bundle. The procedure is the playbook (`paths.playbook` in `cookwright.json`, `docs/playbook.md` by default); read it first, every time. This skill is only the entry sequence.**

The CLI is `node packages/cookwright/src/bundle.mjs`, written `bundle …` below. Run it from anywhere inside the repo; it finds `cookwright.json` upward.

Two forms:

- `/bundle start <plan-path>`: a new bundle from an approved plan.
- `/bundle <slug>` or bare `/bundle`: resume. With no slug, it finds the bundle whose branch is checked out.

## Steps: start

### 1. Kickoff checks

- `git status`: the tree is clean, or whatever is dirty is named and dealt with first.
- `git branch --sort=-committerdate | head`: a sibling branch already planning the same item goes to the developer before anything else.

### 2. Propose the split

About ten lines in chat:

- the slices (one is the common case; several when the work has independent review units)
- each slice's sessions, with their scope as plan section numbers
- the checkpoints

Wait for the developer's confirmation. Then write it as JSON in the scratchpad:

```json
{
  "slices": [
    {
      "id": "core",
      "sessions": [{ "id": "s1", "scope": "plan §3.1–3.4", "checkpoints": ["the loader + its tests"] }]
    }
  ]
}
```

### 3. Cut the branch, then init

```bash
git checkout -b bundle/<slug>
bundle init <slug> --plan <plan-path> --split <split.json>
git add <paths.bundles>/<slug> && git commit -m "chore(bundle): <slug> initialized"
```

`init` refuses on the base branch, on a dirty tree, and on an existing state. It records the branch that is checked out, which is why the branch comes first. It also copies the plan into `<paths.bundles>/<slug>/plan.md`, and that copy is the plan from then on: revisions go there, committed with the bundle.

### 4. Baseline gate

`bundle gate <slug>`, so a red that predates the bundle is known before the bundle starts. A check whose tool is missing is reported as skipped; a gate in which nothing ran is refused — fix `gate.checks` or run setup before going on.

### 5. Run the phases

Follow the playbook's "The loop, per phase", starting with `plan-review`.

## Steps: resume

1. `bundle status [slug]` prints the phases, the last gate and the next action, including the exact Workflow call with `resumeFromRunId` when the running phase has a run id.
2. **Check the tree.** `git status`. Changes under `<paths.bundles>/` are the CLI's own writes; anything else dirty after a crashed implement run is that session's partial work: read it, then commit it or stash it under a name before resuming. Never resume over it silently.
3. Resume the running phase with the call `status` printed, or start the next one. Finished sessions return from cache when nothing they point at has changed; an edited plan or findings file re-runs them, by design. The resume id exists only if the run's id was recorded with `phase <slug> run` when it launched, which the loop does every time.

## Rules

- **Never write the bundle directory by hand** (`<paths.bundles>/<slug>/`). The CLI is its only writer and you commit what it wrote. The one exception is `plan.md`, the bundle's plan, which you revise in place when plan review asks.
- **Never hand-assemble Workflow args.** Always pass the output of `bundle args <slug> <phase>`.
- **The developer's hands:** anything that leaves the repo — a deploy, a publish, a build, a store submission. Hand over the exact command; never run it, never offer to.
- **Strings:** every implementer report's `strings` go to the developer in one batch per session.
- **The gate records a commit:** commit before you gate. A red gate stays red in the state; the only re-gate is the playbook's flake policy (`--retry --flake <id>`, an id from `gate.flakes`).
- **Landing:** `bundle check <slug>` must pass before you hand the branch over, and the closeout must have passed its verify run. Read the summary line: a pass with skips or warnings names what went unverified.
