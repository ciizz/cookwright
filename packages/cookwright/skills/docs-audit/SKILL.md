---
name: docs-audit
description: Audit the repo's contract docs against the code on a dedicated branch — build the doc list with npx cookwright audit args, run the docs-audit Workflow, review the diff, commit it by path. Use when docs feel stale, before a release, after a burst of merges made outside agent sessions, after the setup skill filled a contract doc, or when the developer invokes /docs-audit.
---

# /docs-audit — Level 2, experimental

**The audit is the `docs-audit` Workflow: one auditor-fixer per doc, then an adversarial verifier per doc's diff. This skill only builds its arguments, runs it on a branch of its own and hands the diff to the developer.** The Workflow edits docs only, never code, and never runs git writes; branching and committing are this skill's.

## Rules

- Never on the base branch, never on a dirty tree: the audit's diff must be the only change on its branch.
- Never `git add -A`, never `git commit --no-verify`.
- Never hand-write the doc list: it comes from `npx cookwright audit args`.

## Steps

1. `git status --porcelain` prints nothing; otherwise name what is dirty and stop until the developer deals with it.
2. `git checkout -b docs-audit/<YYYY-MM-DD>` from the branch the developer names (the base branch by default).
3. `npx cookwright audit args`, with `--doc <path>[:<scope>]` once per extra doc the developer names (a path relative to the directory holding `cookwright.json`; the scope says what to audit it against, `every claim against the code` when left out). It prints the Workflow's arguments as JSON: each declared pack's contract docs (`docs/design-system.md`, `docs/data-model.md`) with their scope, then the extras. When it refuses (a pack's doc missing, an extra that is not a file in the repo, nothing to audit), show the line and stop: the line names the remedy.
4. `Workflow({ name: 'docs-audit', args: <that JSON> })`, the printed JSON passed as it is.
5. Read the report: per doc, what was fixed (with evidence), simplified, kept and flagged, and what could not be verified; then the verifiers' issues. Show the developer each P1 and P2 issue.
6. `git diff`: review it against the report. A fix without evidence, or one a verifier refuted, is reverted for that hunk with the developer's consent.
7. Commit the docs by path, `git add <each doc> && git commit -m "docs: audit <docs> against the code"`, with the run's cost as the harness showed it on the message's last line.
8. Name the branch: merging it is the developer's.
