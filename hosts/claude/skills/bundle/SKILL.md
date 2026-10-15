---
name: bundle
description: Run a Cesar-approved feature bundle across fresh-context sessions — start one from an approved plan, or resume one by slug. Drives the phase loop (plan review, one implement run per session, review/fix per slice, whole-branch pass, atlas, Cesar's operator block, device QA, closeout) through scripts/bundle.mjs and the bundle-phase Workflow. Use when Cesar approves a plan and says go on a bundle too large for one context, or invokes /bundle.
---

# /bundle

**Start or resume a feature bundle. The procedure is `ops/PLAYBOOK.md`; read it first, every time. This skill is only the entry sequence.**

Two forms:

- `/bundle start <plan-path>`: a new bundle from an approved plan.
- `/bundle <slug>` or bare `/bundle`: resume. With no slug, it finds the bundle whose branch is checked out.

## Steps: start

### 1. Kickoff checks

Run these from the playbook's "Kickoff" section:

- `env -u OPENAI_API_KEY node scripts/guardrail-canary.mjs`, with its push prompt denied
- `git branch --list 'feat-*' --sort=-committerdate | head`
- `scripts/ops-status.sh dev` and `scripts/ops-status.sh prod`

A canary FAIL, or a sibling branch planning the same item, goes to Cesar before anything else.

### 2. Propose the split

About ten lines in chat:

- the slices (one if client-only, schema first if two)
- each slice's sessions, with their scope as plan section numbers
- the checkpoints
- which slices gate with `--sql`

Wait for Cesar's confirmation. Then write it as JSON in the scratchpad:

```json
{
  "slices": [
    {
      "id": "schema",
      "sql": true,
      "sessions": [{ "id": "s1", "scope": "plan §3.1–3.4", "checkpoints": ["0230 + data-model"] }]
    }
  ]
}
```

### 3. Cut the branch, then init

```bash
git checkout -b feat-<slug>
node scripts/bundle.mjs init <slug> --plan <plan-path> --split <split.json>
git add docs/bundles/<slug> && git commit -m "chore(bundle): <slug> initialized"
```

`init` refuses on `main`, on a dirty tree, and on an existing state. It records the branch that is checked out, which is why the branch comes first. It also copies the plan into `docs/bundles/<slug>/plan.md`, and that copy is the plan from then on: revisions go there, committed with the bundle.

### 4. Baseline gate

`node scripts/bundle.mjs gate <slug>`, so a red that predates the bundle is known before the bundle starts.

### 5. Run the phases

Follow the playbook's "The loop, per phase", starting with `plan-review`.

## Steps: resume

1. `node scripts/bundle.mjs status [slug]` prints the phases, the last gate and the next action, including the exact Workflow call with `resumeFromRunId` when the running phase has a run id.
2. **Check the tree.** `git status`. Changes under `docs/bundles/` are the CLI's own writes; anything else dirty after a crashed implement run is that session's partial work: read it, then commit it or stash it under a name before resuming. Never resume over it silently.
3. Resume the running phase with the call `status` printed, or start the next one. Finished sessions return from cache when nothing they point at has changed; an edited plan or findings file re-runs them, by design. The resume id exists only if the run's id was recorded with `phase <slug> run` when it launched, which the loop does every time.

## Rules

- **Never write the bundle directory by hand** (`docs/bundles/<slug>/`). The CLI is its only writer and you commit what it wrote. The one exception is `plan.md`, the bundle's plan, which you revise in place when plan review asks.
- **Never hand-assemble Workflow args.** Always pass the output of `bundle args <slug> <phase>`.
- **Cesar's hands:** every dev or prod apply, OTA, build and submission. Hand him the exact command; never run it, never offer to.
- **Strings:** every implementer report's `strings` go to Cesar in one batch per session, EN + FR.
- **The gate records a commit:** commit before you gate. A red gate stays red in the state; the only re-gate is the playbook's flake policy (`--retry --flake <id>`).
- **Landing:** `node scripts/bundle.mjs check <slug>` must pass before you hand the branch to Cesar, and the closeout must have passed its verify run.
