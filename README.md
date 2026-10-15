# cookwright

A guided, incremental, non-rotting agentic harness for solo developers building mobile apps with React Native, TypeScript and Supabase.

Early: Level 0 works, nothing is released yet. See `CHARTER.md` for what it will be and `docs/dev/` for how it is being built.

## Install

In your app's repo (a git repo):

```bash
npm install --save-dev cookwright
npx cookwright init
```

To try a change that is not published yet, install from a checkout of this repo instead: `npm install --save-dev /path/to/cookwright/packages/cookwright`.

## Commands

- `npx cookwright init [--base <branch>] [--dry-run]` takes the repo to Level 0. It writes `cookwright.json`, the state homes (a backlog, a closeouts directory, a changelog), a managed rules block in `AGENTS.md`, a Claude Code SessionStart hook that runs doctor, `.gitignore` lines for plaintext env files, and two git hooks, `.githooks/pre-commit` and `.githooks/pre-push`, activated by `core.hooksPath` in the local git config (see Git hooks below). Each step reports `wrote`, `updated`, `kept` or `skipped`. init never overwrites your text, and a second run changes nothing. `--dry-run` prints the report and writes nothing.
- `npx cookwright doctor` checks that Level 0 is still in place and names anything missing. The hook runs it as `doctor --hook` at every session start, and that form never fails a session. Its git calls share a two-second budget, so a stalled git yields a one-line diagnosis, not a killed hook.
- `npx cookwright changelog [--check | --unreleased | --adopt]` generates the changelog from the release tags (`vX.Y.Z`) and the conventional commit subjects between them: `feat`, `fix` and `perf` are listed, the rest counted as internal, and a release's date and notes come from its annotated tag body (`released: YYYY-MM-DD`, `note: …`). It is never edited by hand. `--check` exits 1 when the file is missing, not generated or out of date, and a refusal (a git failure, a file it cannot read or write) exits 2; `--unreleased` prints what no release tag holds yet. A changelog it did not generate is replaced only with `--adopt`, so keep a copy of what you want from it.
- `npx cookwright bundle …` runs a feature bundle across fresh-context sessions. The procedure is `docs/playbook.md`, and the Claude Code adapter is under `hosts/claude/`.

**Already have a `CLAUDE.md`?** Move its rules into `AGENTS.md` and leave `CLAUDE.md` as the single line `@AGENTS.md`. Every host then reads one rules file. If you leave `CLAUDE.md` as it is, init prepends that import line to it. A `CLAUDE.md` that is a symlink to `AGENTS.md` already works and is left alone; init refuses to write through any other symlink, including a linked directory on the way to a file it writes (a `.claude` or `docs` that points elsewhere).

## Developing cookwright

This repo runs its own bundles through the runner, and init has been run on it.

```bash
npm ci && npm test
npx cookwright doctor
npx cookwright bundle status
```

MIT.
