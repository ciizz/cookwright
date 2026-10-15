# Backlog

Bugs are `B-nnn`, enhancements `E-nnn`; ids are stable and never reused. One line per item, dated when opened; a closed item moves to the last section with the bundle or stage that closed it.

## Open bugs

## Open enhancements

- **E-001** (2026-10-15) Supabase ops pack: named gate legs — `gate.legs.<name>: { checks, paths, lock }`, a per-slice leg requirement in the split, `gate --leg <name>`, a destructive-run preflight (daemon answering, free disk), a leg-coverage row in the landing check — and the re-lift of the deploy-log ledger check (`ledger.mjs` + `repoChecks`, recoverable at `a5e0675`). Stage 0 removed the single hardcoded SQL leg rather than generalize it. Bumps `STATE_VERSION`.
- **E-002** (2026-10-15) Atlas pack: manual phases (`atlas`, `operator`) declared in config and inserted into `derivePhases`, plus the re-lift of the UI-surface tripwire and the pre-commit regex reader (recoverable at `a5e0675`). `WORKFLOW_KINDS` and the "not a Workflow phase" branch already leave room.
- **E-003** (2026-10-15) A `/docs-audit` skill, and the doc list for `docs-audit.js` declared in `cookwright.json` instead of hand-written args.
- **E-004** (2026-10-15) Move the remaining user-facing literals of the bundle CLI (refusal texts beside their checks) into `messages.mjs`; stage 0 moved the guidance strings only.
- **E-007** (2026-10-15) How the host adapters under `hosts/` and the playbook reach a user's repo from the npm package (symlinks, thin shims or a generated `.claude/`), whether `paths.playbook` defaults to the package's own copy, and the CLI invocation itself: `messages.mjs` names this monorepo's path (`node packages/cookwright/src/bundle.mjs`) and the package has no `bin` yet. Init's concern; stage 0 only wires this repo.
- **E-008** (2026-10-15) Lint and format tooling for this repo's own gate (`gate.checks` has `npm test` only).

## Closed

- **E-009** (opened and closed by stage 0, 2026-10-15) A check naming an npm script the repo does not define is misconfiguration, not absence: the gate refuses before anything runs, naming the check and the script. Skipping stays reserved for tools the developer has not installed (`needs`, or the command's first word absent from PATH).
- **E-005** (opened and closed by stage 0, 2026-10-15) What counts as code comes from config: everything outside `paths.bundles`, `paths.closeouts`, `paths.backlog`, markdown included.
- **E-006** (2026-10-15) Folded into E-001.
