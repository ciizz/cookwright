# Getting started

From an app repo with nothing installed to a Level 0 the agent checks at every session start. The output below is real: cookwright 0.1.0 installed from its tarball into a fresh git repo on 2026-10-22, with Claude Code 2.1.308 and gitleaks 8.30.1 on PATH. Your paths and versions will differ.

## 1. Install

In your app's repo (a git repo):

```bash
npm install --save-dev cookwright
```

The package has no runtime dependency.

## 2. Run init

```bash
npx cookwright init
```

```
npx cookwright init in ~/my-app
wrote    cookwright.json                    baseBranch main; gate: npm test
wrote    docs/backlog.md                    from the template
wrote    docs/closeouts/                    created, with a .gitkeep so a clone keeps it
wrote    CHANGELOG.md                       from the template
wrote    AGENTS.md                          written with the managed rules block
skipped  CLAUDE.md                          not needed: claude 2.1.308 reads AGENTS.md natively and nothing shadows it
wrote    .claude/settings.json              SessionStart hook runs doctor
wrote    .claude/skills/bundle              links to ../../node_modules/cookwright/skills/bundle
wrote    .claude/skills/setup               links to ../../node_modules/cookwright/skills/setup
wrote    .claude/workflows/bundle-phase.js  links to ../../node_modules/cookwright/hosts/claude/workflows/bundle-phase.js
wrote    .claude/workflows/docs-audit.js    links to ../../node_modules/cookwright/hosts/claude/workflows/docs-audit.js
wrote    .gitignore                         ignores .env, .env.*, !.env.example
wrote    hooks.path                         core.hooksPath set to .githooks in the local git config
wrote    .githooks/pre-commit               the managed shim, executable; it calls the hook in the package
wrote    .githooks/pre-push                 the managed shim, executable; it calls the hook in the package
```

init then runs doctor once and prints its readout (step 4).

`npx cookwright init [--base <branch>] [--hosts <host,…>] [--dry-run]` takes the repo to Level 0. It writes `cookwright.json`, the state homes (a backlog, a closeouts directory, a changelog), a managed rules block in `AGENTS.md`, for each host a SessionStart hook that runs doctor (Claude Code's in `.claude/settings.json`; Codex's in `.codex/hooks.json`, see [Codex](codex.md)) and pointers to the skills and workflows in the installed package (see [Skills and workflows](#skills-and-workflows)), `.gitignore` lines for plaintext env files, and two git hooks, `.githooks/pre-commit` and `.githooks/pre-push`, activated by `core.hooksPath` in the local git config (see [Hooks and escapes](hooks-and-escapes.md)). Each step reports `wrote`, `updated`, `kept` or `skipped`. init never overwrites your text, and a second run changes nothing. `--base` and `--hosts` (`claude`, `codex`, or both, comma-separated; `claude` by default) shape a fresh `cookwright.json`, and init refuses them when one exists: change `baseBranch` or `hosts` there instead. `--dry-run` prints the report and writes nothing.

init sets the repo up for Claude Code by default; for Codex run `npx cookwright init --hosts codex` instead, or `--hosts claude,codex` for both. A repo that already has a `CLAUDE.md` gets `@AGENTS.md` prepended to it; see [Monorepos and CLAUDE.md](monorepos-and-claude-md.md).

## 3. Commit what init wrote, by path

init names every file it wrote; commit them by path, never `git add -A`. The commit already goes through the hooks init installed:

```bash
git add cookwright.json docs CHANGELOG.md AGENTS.md .claude .gitignore .githooks package.json package-lock.json
git commit -m 'chore: set up cookwright'
```

```
pre-commit  PASS  secrets  staged diff clean (gitleaks 8.30.1)
pre-commit  SKIP  doc-sync  no doc-sync rules configured (hooks.docSync in cookwright.json)
[main 6bbd444] chore: set up cookwright
 15 files changed, 161 insertions(+), 1 deletion(-)
```

(gitleaks prints its own `INF` lines above these.) What the hooks check and how to escape one is in [Hooks and escapes](hooks-and-escapes.md).

## 4. Open your agent and read doctor

Open your agent host (Claude Code, or Codex) in the repo. Codex reads its hooks file only at startup: open it after init, or restart it, at the work tree's top, trust the session-start hook with `/hooks`, then start a new session (see [Codex](codex.md)).

At session start the hook's doctor readout reaches the agent's context, not your screen. On a complete Level 0 it is one line:

```
cookwright doctor: level 0 complete
```

or else the checks that are not PASS. Ask the agent what doctor reported. In Codex it arrives once the hook is trusted, in a new session. If no readout reached the agent, run doctor yourself:

```bash
npx cookwright doctor
```

```
PASS  config            valid, level 0
PASS  git               work tree, baseBranch main
PASS  homes.backlog     docs/backlog.md, with its three sections
PASS  homes.closeouts   docs/closeouts/
PASS  homes.changelog   CHANGELOG.md
PASS  backlog.ids       0 id(s), each once
PASS  rules.block       AGENTS.md: the managed block is current
PASS  rules.size        AGENTS.md: under 60 KB, no line over 3000 chars
PASS  host.rules        claude 2.1.308 reads AGENTS.md natively; nothing shadows it
PASS  host.hook         .claude/settings.json runs doctor at session start
PASS  host.pointers     claude: 2 skills, 2 workflows
PASS  hooks.path        core.hooksPath is .githooks (local)
PASS  hooks.pre-commit  .githooks/pre-commit: the managed shim
PASS  hooks.pre-push    .githooks/pre-push: the managed shim
PASS  tools.gitleaks    the pre-commit secret scan runs (gitleaks 8.30.1)
PASS  gate.scripts      1 gate check(s); every npm script they run is in package.json
PASS  secrets.env       no .env file tracked or at the root; .env and .env.local ignored

17 checks — 17 PASS, 0 FAIL, 0 WARN, 0 SKIP
level 0 declared: complete
next: Level 1 is not available in this version of cookwright
```

A missing tool is a SKIP, never a FAIL. The same repo with neither gitleaks nor `claude` on PATH:

```
SKIP  host.rules        skipped, needs claude, run setup (AGENTS.md support unverified)
SKIP  tools.gitleaks    skipped, needs gitleaks, run setup (brew install gitleaks): the pre-commit secret scan does not run

17 checks — 15 PASS, 0 FAIL, 0 WARN, 2 SKIP
level 0 declared: complete; unverified: host.rules, tools.gitleaks
```

`npx cookwright doctor` checks that Level 0 is still in place and names anything missing: 17 checks, the git hooks, gitleaks, the gate's npm scripts and the skill and workflow pointers among them. A hooks setup managed elsewhere (husky, lefthook) reads as weak, not missing, and gitleaks not installed as unverified. The hook runs it as `doctor --hook` at every session start, and that form never fails a session. Its git calls share a two-second budget, so a stalled git yields a one-line diagnosis, not a killed hook.

## 5. Anything not PASS: the setup skill

Run the `setup` skill (`/setup` in Claude Code, `$setup` in Codex). It runs doctor, applies one remedy for the first line that is not PASS, runs doctor again, and stops at what is yours to decide or at a line its remedy did not clear.

## Trying an unpublished change

To try a change that is not published yet, install the package as npm would publish it: `npm pack` in a checkout's `packages/cookwright`, then `npm install --save-dev /path/to/cookwright-X.Y.Z.tgz` in your repo. Installing the directory itself links `node_modules/cookwright` outside your repo, which the pointers below are not made for.

## Skills and workflows

The package's skills (`setup`; `bundle`, Level 2 and experimental) and Claude Code's workflows reach a session through pointers: symbolic links init writes at the work tree's top, `.claude/skills/<name>` and `.claude/workflows/<name>.js` for Claude Code, `.agents/skills/<name>` for Codex, each into `node_modules/cookwright`. Nothing is copied, so an update of the package updates them. Commit the links. init replaces a link in one step, so one it could not rewrite stays as it was, and it names every pointer it could not write (a directory it may not write in, a filesystem that refuses links) after its report.

- **A fresh clone** has the links but not their targets until `npm install`; doctor reads them as weak (`not installed where it points`) until then.
- **A local install under `node_modules` only.** The links do not resolve with yarn Plug'n'Play or a global install.
- **Windows** is not supported in this version: git checks a symbolic link out as a text file unless `core.symlinks` is on, and doctor then reads a committed pointer as a file of your own (`is your own; it shadows cookwright's …`). Only a pointer init could not write reads as weak naming Windows (backlog item E-029).
- **A skill of your own with the same name** (a directory or a link of yours at `.claude/skills/setup`) wins. init leaves it alone and doctor says that cookwright's is unreachable under that name. A personal skill of that name (`~/.claude/skills/setup`) may win as well, since Claude Code documents personal skills as taking precedence over project ones; doctor does not look there and reads the pointer as PASS (backlog item E-037).
- **A Level 2 pointer you do not want** (`bundle`, the workflows): removing it reads as weak, not drift, at Level 0, and the next `npx cookwright init` writes it back.

## Level 2, experimental: bundles

`npx cookwright bundle …` runs a feature bundle across fresh-context sessions. The procedure is the package's playbook (`node_modules/cookwright/docs/playbook.md`, or your own named by `paths.playbook`), and the Claude Code adapter is under `hosts/claude/` in the package.
