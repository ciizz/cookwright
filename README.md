# cookwright

A guided, incremental, non-rotting agentic harness for solo developers building mobile apps with React Native, TypeScript and Supabase.

Early: Level 0 works, and the npm release lags this repo (install from a checkout to try what is here, see First run). See `CHARTER.md` for what it will be and `docs/dev/` for how it is being built.

## First run

In your app's repo (a git repo), in order:

1. `npm install --save-dev cookwright`
2. `npx cookwright init`, which takes the repo to Level 0 and names every file it wrote; commit them by path. init sets the repo up for Claude Code by default; for Codex run `npx cookwright init --hosts codex` instead, or `--hosts claude,codex` for both.
3. Open your agent host (Claude Code, or Codex) in the repo. Codex reads its hooks file only at startup: open it after init, or restart it, at the work tree's top, trust the session-start hook with `/hooks`, then start a new session (see Codex).
4. At session start the hook's doctor readout reaches the agent's context, not your screen: `cookwright doctor: level 0 complete`, or the checks that are not PASS. Ask the agent what doctor reported. In Codex it arrives once the hook is trusted, in a new session (see Codex). If no readout reached the agent, run `npx cookwright doctor` yourself.
5. For anything not PASS, run the `setup` skill (`/setup` in Claude Code, `$setup` in Codex). It runs doctor, applies one remedy for the first line that is not PASS, runs doctor again, and stops at what is yours to decide or at a line its remedy did not clear.

To try a change that is not published yet, install the package as npm would publish it: `npm pack` in a checkout's `packages/cookwright`, then `npm install --save-dev /path/to/cookwright-X.Y.Z.tgz` in your repo. Installing the directory itself links `node_modules/cookwright` outside your repo, which the pointers below are not made for.

## Updating

1. `npm install cookwright@latest`
2. Run `npx cookwright doctor` (or open a session): it says what the new version changed. `config` weak means your `cookwright.json` loads only by migrating in memory: `npx cookwright migrate` writes it. `rules.block` stale or `host.pointers` missing means the package ships a newer rules block or a new skill: `npx cookwright init` refreshes them and leaves your own text alone. The `setup` skill walks the same readout, but only once init has written its pointer: on a repo set up before the skill shipped (`host.pointers` names `.claude/skills/setup` missing), run `npx cookwright init` yourself first, then `/setup` (`$setup` in Codex), in a new session if the host does not list it yet.
3. `git add` the paths migrate and init name, never `-A`, and commit.

## Skills and workflows

The package's skills (`setup`; `bundle`, Level 2 and experimental) and Claude Code's workflows reach a session through pointers: symbolic links init writes at the work tree's top, `.claude/skills/<name>` and `.claude/workflows/<name>.js` for Claude Code, `.agents/skills/<name>` for Codex, each into `node_modules/cookwright`. Nothing is copied, so an update of the package updates them. Commit the links. init replaces a link in one step, so one it could not rewrite stays as it was, and it names every pointer it could not write (a directory it may not write in, a filesystem that refuses links) after its report.

- **A fresh clone** has the links but not their targets until `npm install`; doctor reads them as weak (`not installed where it points`) until then.
- **A local install under `node_modules` only.** The links do not resolve with yarn Plug'n'Play or a global install.
- **Windows** is not supported in this version: git checks a symbolic link out as a text file unless `core.symlinks` is on, and doctor then reads a committed pointer as a file of your own (`is your own; it shadows cookwright's …`). Only a pointer init could not write reads as weak naming Windows (backlog item E-029).
- **A skill of your own with the same name** (a directory or a link of yours at `.claude/skills/setup`) wins. init leaves it alone and doctor says that cookwright's is unreachable under that name. A personal skill of that name (`~/.claude/skills/setup`) may win as well, since Claude Code documents personal skills as taking precedence over project ones; doctor does not look there and reads the pointer as PASS (backlog item E-037).
- **A Level 2 pointer you do not want** (`bundle`, the workflows): removing it reads as weak, not drift, at Level 0, and the next `npx cookwright init` writes it back.

## Codex

With `codex` in `hosts` (`npx cookwright init --hosts claude,codex` on a fresh repo, or the key edited in `cookwright.json` and init rerun), init writes `.agents/skills/setup` (Codex has no workflows, so no `bundle`) and the session-start hook in `.codex/hooks.json`. Codex runs a project hook only once you trust it with `/hooks`, and again after every rewrite of that file, which init keeps as rare as it can. Codex reads the file only at startup, so a Codex already open when init first writes it lists no hook to trust (`/hooks` shows SessionStart installed 0). After the first write and after every rewrite alike, restart Codex at the work tree's top, trust the hook with `/hooks`, and the readout comes in the next new session. Measured on 2026-10-18 with Codex 0.163.0, interactive only: after `/hooks` trust, a new session's agent received the doctor readout from the hook, and `$setup` was listed through the pointer. Under `codex exec`, measured on 2026-10-16 with Codex 0.145.0 (3 runs), no project hook fired. Doctor's Codex `host.hook` says that the file carries the hook, since trust is not readable from outside Codex. The hook runs on `startup|resume`; a copy of it under another matcher (`compact`, say) reads as weak, and init moves or removes it. The hook enters the work tree's top before running doctor, so its readout judges from there: an `AGENTS.override.md` in a subdirectory the session started in is caught by `npx cookwright doctor` run by hand in that directory, not by the hook line. For the same reason the hook gives no readout at all when `cookwright.json` sits below the top (`apps/mobile/` in a monorepo): doctor's Codex `host.hook` reads weak there, and doctor is run by hand from the config root (backlog item B-002).

## Commands

- `npx cookwright init [--base <branch>] [--hosts <host,…>] [--dry-run]` takes the repo to Level 0. It writes `cookwright.json`, the state homes (a backlog, a closeouts directory, a changelog), a managed rules block in `AGENTS.md`, for each host a SessionStart hook that runs doctor (Claude Code's in `.claude/settings.json`; Codex's in `.codex/hooks.json`, see Codex) and pointers to the skills and workflows in the installed package (see Skills and workflows), `.gitignore` lines for plaintext env files, and two git hooks, `.githooks/pre-commit` and `.githooks/pre-push`, activated by `core.hooksPath` in the local git config (see Git hooks below). Each step reports `wrote`, `updated`, `kept` or `skipped`. init never overwrites your text, and a second run changes nothing. `--base` and `--hosts` (`claude`, `codex`, or both, comma-separated; `claude` by default) shape a fresh `cookwright.json`, and init refuses them when one exists: change `baseBranch` or `hosts` there instead. `--dry-run` prints the report and writes nothing.
- `npx cookwright doctor` checks that Level 0 is still in place and names anything missing: 17 checks, the git hooks, gitleaks, the gate's npm scripts and the skill and workflow pointers among them. A hooks setup managed elsewhere (husky, lefthook) reads as weak, not missing, and gitleaks not installed as unverified. The hook runs it as `doctor --hook` at every session start, and that form never fails a session. Its git calls share a two-second budget, so a stalled git yields a one-line diagnosis, not a killed hook.
- `npx cookwright migrate [--dry-run]` writes `cookwright.json` at the current format version. An older file already loads, migrated in memory, and doctor reads its `config` check as weak until you run this; each step prints one line, the file keeps its indent and line endings, and `--dry-run` prints the steps and writes nothing.
- `npx cookwright changelog [--check | --unreleased | --adopt]` generates the changelog from the release tags (`vX.Y.Z`) and the conventional commit subjects between them: `feat`, `fix` and `perf` are listed, the rest counted as internal, and a release's date and notes come from its annotated tag body (`released: YYYY-MM-DD`, `note: …`). It is never edited by hand. `--check` exits 1 when the file is missing, not generated or out of date, and a refusal (a git failure, a file it cannot read or write) exits 2; `--unreleased` prints what no release tag holds yet. A changelog it did not generate is replaced only with `--adopt`, so keep a copy of what you want from it.
- `npx cookwright hook <pre-commit|pre-push>` is what the git hooks call; you rarely run it by hand (see Git hooks below).
- `npx cookwright bundle …` runs a feature bundle across fresh-context sessions. The procedure is the package's playbook (`node_modules/cookwright/docs/playbook.md`, or your own named by `paths.playbook`), and the Claude Code adapter is under `hosts/claude/` in the package.

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

To release, in this order:

```bash
npm version 1.2.0 --no-git-tag-version
git commit -m 'chore: release 1.2.0' package.json package-lock.json
git tag -a v1.2.0 -m 'released: 2026-10-15' -m 'note: The first release with offline mode.'
npx cookwright changelog
git commit -m 'docs: changelog for v1.2.0' CHANGELOG.md
git push --follow-tags
npm publish
```

The version bump is its own commit, so the tag sits on it; the changelog is generated after the tag, from it, and committed on top. `git push --follow-tags` runs pre-push, the gate and the changelog check, which passes only once the changelog matches the new tag. `npm publish` is last, for a package that is published at all.

The tag body is `key: value` lines: `released` dates the heading, `note` becomes a quote, any other key renders as a labelled line. A lightweight tag has no body, so its section has no date. Until the changelog is regenerated after a tag, `--check` and the pre-push changelog check fail, which is the reminder. To adopt the generator on an existing hand-kept changelog, run `npx cookwright changelog --adopt` once: it replaces the file, and anything not derivable from the tags and the commit subjects is lost, so keep a copy of what you want.

**Already have a `CLAUDE.md`?** Move its rules into `AGENTS.md` and leave `CLAUDE.md` as the single line `@AGENTS.md`. Every host then reads one rules file. If you leave `CLAUDE.md` as it is, init prepends that import line to it. A `CLAUDE.md` that is a symlink to `AGENTS.md` already works and is left alone; init refuses to write through any other symlink, including a linked directory on the way to a file it writes (a `.claude` or `docs` that points elsewhere).

## Developing cookwright

This repo runs its own bundles through the runner, and init has been run on it, so its git hooks are live: every commit runs the secret scan and two doc-sync rules (the bundle CLI and workflow need `packages/cookwright/docs/playbook.md` or the bundle skill staged; the setup skill and the managed rules block need `README.md` staged), and every push runs `npm test` and the changelog check.

```bash
npm ci && npm test
npx cookwright doctor
npx cookwright bundle status
```

MIT.
