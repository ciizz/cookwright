# cookwright

A guided, incremental, non-rotting agentic harness for solo developers building mobile apps with React Native, TypeScript and Supabase.

Early: Level 0 works, nothing is released yet. See `CHARTER.md` for what it will be and `docs/dev/` for how it is being built.

## Install

Not on npm yet, so install it from a checkout of this repo. In your app's repo (a git repo):

```bash
npm install --save-dev /path/to/cookwright/packages/cookwright
npx cookwright init
```

## Commands

- `npx cookwright init [--base <branch>] [--dry-run]` takes the repo to Level 0. It writes `cookwright.json`, the state homes (a backlog, a closeouts directory, a changelog), a managed rules block in `AGENTS.md`, a Claude Code SessionStart hook that runs doctor, and `.gitignore` lines for plaintext env files. Each step reports `wrote`, `updated`, `kept` or `skipped`. init never overwrites your text, and a second run changes nothing. `--dry-run` prints the report and writes nothing.
- `npx cookwright doctor` checks that Level 0 is still in place and names anything missing. The hook runs it as `doctor --hook` at every session start, and that form never fails a session. Its git calls share a two-second budget, so a stalled git yields a one-line diagnosis, not a killed hook.
- `npx cookwright bundle …` runs a feature bundle across fresh-context sessions. The procedure is `docs/playbook.md`, and the Claude Code adapter is under `hosts/claude/`.

**Already have a `CLAUDE.md`?** Move its rules into `AGENTS.md` and leave `CLAUDE.md` as the single line `@AGENTS.md`. Every host then reads one rules file. If you leave `CLAUDE.md` as it is, init prepends that import line to it. A `CLAUDE.md` that is a symlink to `AGENTS.md` already works and is left alone; init refuses to write through any other symlink.

## Developing cookwright

This repo runs its own bundles through the runner, and init has been run on it.

```bash
npm ci && npm test
npx cookwright doctor
npx cookwright bundle status
```

MIT.
