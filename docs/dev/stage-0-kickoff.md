# Stage 0 kickoff — make the bundle runner run outside Leeka

Written 2026-10-14. The first prompt for a fresh session opened in this directory. Read `CHARTER.md`, `CLAUDE.md` and `CLAUDE.local.md`, then enter plan mode.

## Goal

The bundle machinery under `packages/cookwright/lifted/` runs on this repo, with every Leeka assumption replaced by configuration. At the end of stage 0, `node packages/cookwright/src/bundle.mjs init <slug>` works here, the `bundle-phase` and `docs-audit` workflows run from `hosts/claude/`, and `lifted/` is empty.

## Scope

1. Move each lifted file into its home (`packages/cookwright/src/`, `hosts/claude/workflows/`, `hosts/claude/skills/`, `docs/`), preserving git history of the move in this repo.
2. Find every Leeka assumption: hardcoded paths (`docs/bundles`, `ops/PLAYBOOK.md`, `docs/phase-closeouts`), gate commands (`tsc`, `eslint`, `prettier`, the SQL suites, the atlas), the rig lock, Cesar-specific wording, the "Cesar-approved" authorization language. List them in the plan before touching any.
3. Design the config file (`cookwright.json` at the repo root, JSON with a schema) with only what stage 0 needs: paths for the state homes, the gate command list, the host. Levels and tool detection come later; leave room, do not build them.
4. Make every gate step optional per the charter: a missing tool is reported and skipped, never a failure.
5. Keep the tests (`bundle.test.mjs`) green and extend them to cover the config.
6. Write the stage 0 closeout under `docs/dev/closeouts/stage-0.md`.

## Out of scope

Doctor, init, setup, the hooks, the secrets abstraction, the atlas, Codex adapter. Log anything discovered for those in `docs/dev/backlog.md`.

## Standard

Plan mode first, written plan, adversarial review of the plan before code, review of the diff before done. Stage 0 is the one piece built without the runner, by hand, in one or two sessions.
