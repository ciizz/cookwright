# Backlog

Bugs are `B-nnn`, enhancements `E-nnn`; ids are stable and never reused. One line per item, dated when opened; a closed item moves to the last section with the bundle or stage that closed it.

## Open bugs

## Open enhancements

- **E-001** (2026-10-15) Supabase ops pack: named gate legs — `gate.legs.<name>: { checks, paths, lock }`, a per-slice leg requirement in the split, `gate --leg <name>`, a destructive-run preflight (daemon answering, free disk), a leg-coverage row in the landing check — and the re-lift of the deploy-log ledger check (`ledger.mjs` + `repoChecks`, recoverable at `a5e0675`). Stage 0 removed the single hardcoded SQL leg rather than generalize it. Bumps `STATE_VERSION`.
- **E-002** (2026-10-15) Atlas pack: manual phases (`atlas`, `operator`) declared in config and inserted into `derivePhases`, plus the re-lift of the UI-surface tripwire and the pre-commit regex reader (recoverable at `a5e0675`). `WORKFLOW_KINDS` and the "not a Workflow phase" branch already leave room.
- **E-003** (2026-10-15) A `/docs-audit` skill, and the doc list for `docs-audit.js` declared in `cookwright.json` instead of hand-written args.
- **E-004** (2026-10-15) Move the remaining user-facing literals of the bundle CLI (refusal texts beside their checks) into `messages.mjs`; stage 0 moved the guidance strings only.
- **E-007** (2026-10-15) How the host adapters under `hosts/` and the playbook reach a user's repo from the npm package (symlinks, thin shims or a generated `.claude/`), and whether `paths.playbook` defaults to the package's own copy. Init's concern; stage 0 only wires this repo.
- **E-008** (2026-10-15) Lint and format tooling for this repo's own gate (`gate.checks` has `npm test` only).
- **E-009** (2026-10-15) A check that fails because its npm script is missing (npm exits 1, not 127) is recorded as a failure, not an absence; detect "missing script" so the charter's "never fails on absence" holds for `npm run x` too.

## Closed

- **E-005** (opened and closed by stage 0, 2026-10-15) What counts as code comes from config: everything outside `paths.bundles`, `paths.closeouts`, `paths.backlog`, markdown included.
- **E-006** (2026-10-15) Folded into E-001.
