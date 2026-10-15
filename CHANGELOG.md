# Changelog

Hand-maintained for now: every user-visible change adds a line under Unreleased, in the same commit.

## Unreleased

- `npx cookwright init` takes a git repo to Level 0: `cookwright.json`, the state homes, the managed rules block in `AGENTS.md`, the Claude Code SessionStart hook, and `.gitignore` lines for env files. It is idempotent and takes `--dry-run`.
- `npx cookwright doctor` checks Level 0 and names what is missing. `--hook` is the session-start form and never fails a session.
- One `cookwright` bin with three commands: `init`, `doctor` and `bundle`.
- The bundle runner keeps only the run id. `phase run` and `phase done` no longer take `--transcript-dir`.
