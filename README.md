# cookwright

A guided, incremental, non-rotting agentic harness for solo developers building mobile apps with React Native, TypeScript and Supabase.

Early: Level 0 works, and the npm release lags this repo (install from a checkout to try what is here, see Install). See `CHARTER.md` for what it will be and `docs/dev/` for how it is being built.

## Install

In your app's repo (a git repo):

```bash
npm install --save-dev cookwright
npx cookwright init
```

To try a change that is not published yet, install from a checkout of this repo instead: `npm install --save-dev /path/to/cookwright/packages/cookwright`.

## Commands

- `npx cookwright init [--base <branch>] [--dry-run]` takes the repo to Level 0. It writes `cookwright.json`, the state homes (a backlog, a closeouts directory, a changelog), a managed rules block in `AGENTS.md`, a Claude Code SessionStart hook that runs doctor, `.gitignore` lines for plaintext env files, and two git hooks, `.githooks/pre-commit` and `.githooks/pre-push`, activated by `core.hooksPath` in the local git config (see Git hooks below). Each step reports `wrote`, `updated`, `kept` or `skipped`. init never overwrites your text, and a second run changes nothing. `--dry-run` prints the report and writes nothing.
- `npx cookwright doctor` checks that Level 0 is still in place and names anything missing: 16 checks, the git hooks, gitleaks and the gate's npm scripts among them. A hooks setup managed elsewhere (husky, lefthook) reads as weak, not missing, and gitleaks not installed as unverified. The hook runs it as `doctor --hook` at every session start, and that form never fails a session. Its git calls share a two-second budget, so a stalled git yields a one-line diagnosis, not a killed hook.
- `npx cookwright changelog [--check | --unreleased | --adopt]` generates the changelog from the release tags (`vX.Y.Z`) and the conventional commit subjects between them: `feat`, `fix` and `perf` are listed, the rest counted as internal, and a release's date and notes come from its annotated tag body (`released: YYYY-MM-DD`, `note: …`). It is never edited by hand. `--check` exits 1 when the file is missing, not generated or out of date, and a refusal (a git failure, a file it cannot read or write) exits 2; `--unreleased` prints what no release tag holds yet. A changelog it did not generate is replaced only with `--adopt`, so keep a copy of what you want from it.
- `npx cookwright hook <pre-commit|pre-push>` is what the git hooks call; you rarely run it by hand (see Git hooks below).
- `npx cookwright bundle …` runs a feature bundle across fresh-context sessions. The procedure is `docs/playbook.md`, and the Claude Code adapter is under `hosts/claude/`.

## Git hooks

init writes two shims, `.githooks/pre-commit` and `.githooks/pre-push`, and sets `core.hooksPath` to `.githooks` in the repo's local git config. The shims hold no logic: they call `cookwright hook` in the installed package, so a fix reaches you with a version bump. Without node, or with the package not installed, a shim prints one line and lets the commit or push through; doctor reads a hook whose package is not installed where it runs as weak, since it checks nothing.

- **pre-commit** scans the staged diff for secrets with gitleaks (`brew install gitleaks`; skipped with a line when it is not installed; values are redacted in the output) and checks the doc-sync rules in `cookwright.json` (`hooks.docSync`): each rule names code pathspecs and the docs that must be staged with them, and git's own pathspec matching applies (`:!*.test.mjs` excludes).
- **pre-push** runs the `gate.checks` suite, the same one the bundle gate runs, with its elapsed time on the line, and checks that `CHANGELOG.md` matches the release tags. It judges the working tree, so it runs only when that is a pushed commit: both checks are skipped, naming why, when the tree has uncommitted files or when no pushed ref is the checked-out commit. An annotated tag on that commit counts as it, so the release push checks the changelog. When the checked-out commit is pushed with other refs, the checks run and each line names the refs it tested and the ones it did not.
- **Escapes.** `COOKWRIGHT_SKIP=doc-sync git commit …` skips the named checks (comma-separated: `secrets`, `doc-sync`, `gate`, `changelog`) and says so; since the escape leaves no trace, put the reason in the commit message. `git commit --no-verify` skips everything and is the last resort.
- **Merge commits.** A clean `git merge` runs no pre-commit. A `--no-commit` merge or a conflict resolution does, and its staged diff is the whole merged side, so a doc-sync rule can fail for commits that each passed on their own; the escape with the reason is the answer.
- **Hooks managed elsewhere** (husky, lefthook, a hook in `.git/hooks`, a global `core.hooksPath`, a `.githooks` file of your own that does not call cookwright): init installs nothing and says why, and doctor reads `hooks.path` as weak, not missing. Appending the cookwright call into those hooks is backlog item E-018. Your own hook may call `node node_modules/cookwright/bin/cookwright.mjs hook pre-commit "$@"` itself, as its last line, with `exec`, or followed by `|| exit 1`, and init and doctor count it.
- **Older git.** init and doctor read where `core.hooksPath` is set with `git config --show-scope`, which git 2.26 added. On an older git they tell only the local config from the rest (`not the local config`); nothing else changes.
- **A config below the top** (an app in a monorepo, `cookwright.json` in `apps/mobile/`): init writes the shims at the work tree's top, where git looks, and each shim enters `apps/mobile` before calling cookwright, which is installed there. The secret scan still runs at the top, over the whole staged diff, with the top's `.gitleaks.toml`, as doctor's dry run does. Your own hook does the same with `cd apps/mobile && ` before the call.
- **Linked worktrees** share `core.hooksPath`, so a worktree whose branch has no `.githooks/` runs no hook; doctor there reports the shims missing, and init there writes them on that branch.

## Releases and the changelog

`CHANGELOG.md` is generated from git, never written by hand. A commit's subject is what reaches it, in the conventional form `type(scope)!: text`: `feat`, `fix` and `perf` are listed under Features, Fixes and Performance, `!` marks a breaking change, and every other type (`docs`, `chore`, `refactor`, `test`, …) is counted as internal.

To release: tag, then regenerate, then commit.

```bash
git tag -a v1.2.0 -m 'released: 2026-10-15' -m 'note: The first release with offline mode.'
npx cookwright changelog
git commit -m 'docs: changelog for v1.2.0' CHANGELOG.md
```

The tag body is `key: value` lines: `released` dates the heading, `note` becomes a quote, any other key renders as a labelled line. A lightweight tag has no body, so its section has no date. Until the changelog is regenerated after a tag, `--check` and the pre-push changelog check fail, which is the reminder. To adopt the generator on an existing hand-kept changelog, run `npx cookwright changelog --adopt` once: it replaces the file, and anything not derivable from the tags and the commit subjects is lost, so keep a copy of what you want.

**Already have a `CLAUDE.md`?** Move its rules into `AGENTS.md` and leave `CLAUDE.md` as the single line `@AGENTS.md`. Every host then reads one rules file. If you leave `CLAUDE.md` as it is, init prepends that import line to it. A `CLAUDE.md` that is a symlink to `AGENTS.md` already works and is left alone; init refuses to write through any other symlink, including a linked directory on the way to a file it writes (a `.claude` or `docs` that points elsewhere).

## Developing cookwright

This repo runs its own bundles through the runner, and init has been run on it, so its git hooks are live: every commit runs the secret scan and one doc-sync rule (the bundle CLI and workflow need `docs/playbook.md` or the bundle skill staged), and every push runs `npm test` and the changelog check.

```bash
npm ci && npm test
npx cookwright doctor
npx cookwright bundle status
```

MIT.
