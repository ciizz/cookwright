# Stage 1 — doctor and init (Level 0)

Written 2026-10-15; revised the same day after an adversarial read (two P1s, six P2s folded in) and approved by the developer with three amendments (§7 moves this repo's rules to AGENTS.md first; an unknown host is a config FAIL; test counts are measured, never carried). The first bundle through cookwright's own runner. Sections are numbered so the split can name them (`plan §4.4`).

## 1. Context

The charter's first two properties are guided setup and graceful degradation, and its third is that the harness knows its own level and detects drift. Stage 0 made the bundle runner run here; nothing a user could install exists yet. Stage 1 builds the two commands every later level hangs off: `init`, which takes a repo to Level 0, and `doctor`, which checks at every session start that Level 0 is still there and reports what is missing, never failing a hook.

What Leeka offers for this (read 2026-10-15, read-only): no agent-host hooks, no doctor, no setup script. Its Level-0 material is the state-homes vocabulary and rules in its rules file ("Ledger discipline", "Backlog discipline", "Conventions"), the backlog format, a tag-driven changelog generator, husky git hooks (secret scan, doc-sync rules, tests on push) and a manual guardrail canary whose `PASS/FAIL/WARN/SKIP` readout is the shape doctor adopts. The rules and the readout shape are extracted here; the git hooks and the changelog generator are deferred (decided by the developer, 2026-10-15).

## 2. Decisions (the developer, 2026-10-15)

- **Scope:** init + doctor + state homes + managed rules block + session-start hook. Git hooks and the changelog generator are stage 2, logged in the backlog.
- **CLI:** one `cookwright` bin: `cookwright init`, `cookwright doctor`, `cookwright bundle …`. Closes the CLI half of E-007.
- **Rules:** a managed block in `AGENTS.md` between markers; the user's own text lives outside it; rerunning init refreshes only the block. Claude Code reads `AGENTS.md` natively since 2.1.277 (verified in the official docs 2026-10-15). init writes no `CLAUDE.md`, except: when a `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` exists in or above the repo, any of them makes Claude ignore a bare `AGENTS.md`, so init ensures a `CLAUDE.md` at the root carries `@AGENTS.md`. doctor checks that case and warns on an old Claude Code.
- **Level:** declared in `cookwright.json` (`level`, default 0) and measured by doctor; a missing piece is drift against the declared level.

Facts fixed by the review (Claude Code docs, 2026-10-15): the rule names `CLAUDE.md`, `.claude/CLAUDE.md` and `CLAUDE.local.md` "in your working directory or any directory above it"; `~/.claude/CLAUDE.md` and managed files do not count. Direct `AGENTS.md` reading landed in 2.1.277, but some sessions read only `CLAUDE.md` until 2.1.281, so doctor's threshold is **2.1.281**. "Working directory" is Claude's cwd, which may be a subdirectory of the repo; scanning the root and its ancestors is the approximation init and doctor use, and the note says so.

## 3. Scope

In: §4 entirely, the tests in §6, the dogfood in §7, the doc and backlog updates in §9.

Out (backlog entries, §9): git hooks (secret scan, doc-sync, tests on push); the changelog generator; the `/setup` skill that drives init interactively; config migrations between versions; the `create-expo-app` CI fixture; Levels 1 and 2; `.envrc` and other plaintext secret carriers (Level 2's concern); how skills and workflows reach a user repo (the adapter half of E-007, which Level 2 needs and Level 0 does not).

## 4. Design

### 4.1 The `cookwright` bin

`packages/cookwright/bin/cookwright.mjs`, `#!/usr/bin/env node`. It dispatches the first argument: `init` → `src/init.mjs`, `doctor` → `src/doctor.mjs`, `bundle` → `main()` of `src/bundle.mjs` with the remaining argv (so `cookwright bundle` with nothing after it prints the bundle usage). Anything else prints the usage and exits 2. Each subcommand's `main(argv, { cwd, input })` returns the exit code, as `bundle.mjs` does today, so tests call it without a process.

`package.json` gains `"bin": { "cookwright": "bin/cookwright.mjs" }`; `files` becomes `["bin", "src", "schema", "!src/**/*.test.mjs", "!src/test-helpers.mjs"]`. npm workspaces link a workspace package's bin into the root `node_modules/.bin` (`node_modules/cookwright` is already a symlink to the package here), so `npx cookwright` works in this repo after `npm ci`; s1 verifies it, and if it fails the root `package.json` gets a `cookwright` script instead.

**The invocation is `npx cookwright`**, since `cookwright` is on nobody's PATH: in this repo and in a user repo it is `node_modules/.bin/cookwright`. `CLI = 'npx cookwright'` and `BUNDLE_CLI = 'npx cookwright bundle'`; every printed next-action line and every doc uses them. Note for the orchestrator: `cli` is a field of the Workflow args (`phases.mjs`, consumed by `bundle-phase.js`), so once s1 lands, a run of this very bundle that was in flight before it cannot resume from cache; new runs recompute their args and are unaffected.

Shared CLI pieces move out of `bundle.mjs` into `src/lib/cli.mjs`: `parseArgv`, `Refusal`, `need`, `stringFlag`, `numberFlag`. `bundle.mjs` imports them and keeps re-exporting `parseArgv` and `Refusal` for its tests.

Strings: `src/lib/messages.mjs` is the home for the bin's, init's and doctor's strings and for `CLI`; s1 creates it with the bin's strings and `CLI`, and each later session adds its own. `src/lib/bundle/messages.mjs` keeps the bundle strings and imports `CLI` to build `BUNDLE_CLI`. Every place that prints or documents the old invocation changes: `src/lib/bundle/messages.mjs`, the usage header of `bundle.mjs`, `hosts/claude/skills/bundle/SKILL.md`, `docs/playbook.md`, `README.md`, E-007's text in the backlog. The stage-0 closeout and kickoff are history and keep the old string.

### 4.2 Config: `level` and `paths.changelog`

`src/lib/config.mjs`: `level` joins `KNOWN_KEYS.top`, `DEFAULTS.level = 0`, validated as one of `KNOWN_LEVELS` (§4.3), an integer; `paths.changelog` joins `KNOWN_KEYS.paths` with default `CHANGELOG.md` and the same root-relative rule as the other paths (not part of the nesting check, and not a non-code pathspec: a changelog line is a code change). The schema twin gains both; the parity test in `config.test.mjs` holds them to the validator, the level enum to `KNOWN_LEVELS`.

### 4.3 Levels: `src/lib/levels.mjs`

The ladder, in one place: `LEVELS = { 0: { name, summary, requires: [doctor check names] } }`, `KNOWN_LEVELS`, `nextLevel(level)` (null in this version; the message says Level 1 is not available in this version of cookwright). `requires` is what doctor measures the declared level against: **a required check that is FAIL is drift**; a WARN is reported separately as weak, never as drift, so a working but imperfect setup reads as complete. Level 0 requires: `config`, `git`, `homes.backlog`, `homes.closeouts`, `homes.changelog`, `rules.block`, `host.rules`, `host.hook`. A test holds every name in `requires` to doctor's check registry.

### 4.4 init

`npx cookwright init [--base <branch>] [--dry-run]`. Non-interactive and idempotent: every step reports `wrote`, `updated`, `kept` (present, left alone) or `skipped`, and a second run reports `kept` everywhere and changes no byte. `--dry-run` prints the same report, writes nothing and skips the doctor step, saying so. It never deletes or overwrites user content.

Root: the directory holding `cookwright.json` found upward from cwd, else `git rev-parse --show-toplevel`. Not a git work tree: refused, exit 2. init works from a subdirectory.

Steps, in order (library under `src/lib/init/`, one function per step, each `(repo, io) → row`):

1. **`cookwright.json`:** absent → write `{ $schema: "./node_modules/cookwright/schema/cookwright.schema.json", version: 1, level: 0, hosts: ["claude"], baseBranch, paths (every key, explicit defaults), gate: { checks } }`. `baseBranch` is `--base`, else an existing `main`, else an existing `master`, else the checked-out branch (`git symbolic-ref --short HEAD`, which works on an unborn HEAD), else `main`. `gate.checks` is `[{ name: "test", run: "npm test" }]` when `package.json` defines `test` and it is not npm's `no test specified` placeholder, else `[]`. Present → load (a refusal if invalid) and `kept`; init never edits an existing config.
2. **State homes:** `paths.backlog` from the template (§4.6) when absent, creating its directory; `paths.closeouts` created with a `.gitkeep` when absent; `paths.changelog` from the template when absent. Present → `kept`.
3. **Rules block** (§4.5): by `blockState`: `absent` with no `AGENTS.md` → written with the block; `absent` in an existing file → block appended after one blank line (a file without a trailing newline gets one first); `stale` → block replaced between the markers, everything outside byte-identical (`updated`); `current` → `kept`; `malformed` → refused with the path, nothing written.
4. **Host rules import** (claude): if `CLAUDE.md` exists at the root → ensure an import line (prepend `@AGENTS.md` as the first line when none is present, `updated`); else if `.claude/CLAUDE.md` or `CLAUDE.local.md` exists at the root, or a `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` exists in any ancestor directory → write `CLAUDE.md` containing `@AGENTS.md` (`wrote`); else `skipped` with the reason (AGENTS.md is read natively). "Present" for the import means the token `@AGENTS.md` on a line outside a fenced block and outside backticks; a mention in prose code is not an import (Claude skips imports in code spans).
5. **Host hook** (claude): `.claude/settings.json` absent → written with the hook; present → parsed, the `hooks.SessionStart` entry appended when no command in any `SessionStart` group contains `cookwright doctor`, everything else preserved (other groups, other matchers, other keys), written back with the file's own indent (two spaces when new), `updated`; unparseable → refused with the path, nothing written. The entry has no `matcher`, deliberately: doctor runs on startup, resume, clear and compact. It carries `"timeout": 10`. The command is one constant, `HOOK_COMMAND`, defined in `src/lib/hosts.mjs` next to the claude entry **together with its not-installed line** (`hosts.mjs` imports nothing from `messages.mjs` or `config.mjs`, which would close a module cycle: `config` → `hosts` → `messages` → `config`):

   ```sh
   cd "${CLAUDE_PROJECT_DIR:-.}" && [ -f node_modules/cookwright/bin/cookwright.mjs ] && node node_modules/cookwright/bin/cookwright.mjs doctor --hook || echo "cookwright doctor skipped: package not installed (npm install)"
   ```

   No `npx`: `npx --no-install` is deprecated and contacts the registry before refusing (measured: a 404 round trip in a repo without the package), and it adds most of a second of startup. A direct `node` call is about 60 ms, needs no network, and the `||` keeps the hook at exit 0 whatever happens. Hooks run through `sh -c` with `CLAUDE_PROJECT_DIR` exported; the `cd` makes the cwd the project root even when Claude was started in a subdirectory.
6. **`.gitignore`:** ensure `.env` and `.env.*` are ignored (probe with `git check-ignore -q .env .env.local`, not by grepping for literal lines); when not, append `.env`, `.env.*` and `!.env.example` (`updated`; a file without a trailing newline gets one first); absent file → `wrote`.
7. **Doctor:** run §4.8 and print its full readout. init's exit code is doctor's.

No stack detection in this stage: init is the same on an Expo app and on this repo.

### 4.5 The managed rules block

Template `packages/cookwright/src/lib/rules/agents-block.md`, rendered with the config's paths (`{{paths.backlog}}` and the like); `RULES_VERSION = 1`. Markers: `<!-- cookwright:begin rules v1 -->` and `<!-- cookwright:end -->`. The block opens by saying it is managed, that edits inside the markers are lost on refresh, and that the user's rules go outside.

Why a block in the repo rather than an import of a file under `node_modules`: `AGENTS.md` has no import syntax, other hosts read it plainly, and the rules must exist before `npm install` has run. The block's version and hash, refreshed by init, are how "updates reach users" for text.

**One definition of "current":** `blockState(text, rendered) → { state: absent | current | stale | malformed, …}` in `src/lib/rules/block.mjs`, used by init step 3 and doctor's `rules.block`. Line endings are normalised to LF before comparing and hashing; the block is written with the file's dominant line ending, so a CRLF file stays CRLF and a second run is `kept`. `stale` = the begin marker's version differs from `RULES_VERSION`, or the content between the markers differs from the render; a version newer than the package's is its own state (`newer`) so doctor can say "update cookwright". `malformed` = a begin marker without an end, or two begin markers; refused, never rewritten. A second end marker after the first is user text and is left alone.

Content (prose written in s3, from Leeka's generic sections, with nothing of Leeka's in it), about 50 lines:

- **State homes.** Every kind of state has exactly one home; the rules file is the map, not the store. Tasks, bugs and enhancements → the backlog. Feature narratives → a closeout, written once, past tense, at close. User-visible changes → the changelog's Unreleased section. Don't record what is derivable (merge state is git, test state is the suite). No "pending" or "next" narrative in an active doc: a thing to do is a backlog entry. The agent updates the state homes at every status change it takes part in or learns of.
- **Backlog discipline.** An out-of-scope discovery is logged, not fixed: a bug → Open bugs with a `B-nnn` id, an enhancement → Open enhancements with `E-nnn`; ids are stable and never reused. The bar: touching files outside the declared surface, or more than about five lines outside scope. Plan-mode discoveries count. Closing moves the line to Closed with a one-line note; a commit that fixes an item names the id.
- **Doc sync.** A change with doc implications updates the doc in the same commit; when unsure, update.
- **Session start.** `cookwright doctor` runs at session start and its readout is in context; a FAIL is dealt with before other work, a WARN names the next step.
- **Secrets.** Never write a plaintext env file; never put a secret value in a doc, a commit, or a transcript.
- **Conventions.** Ask before adding a dependency. Re-read the rules file when it changes mid-session. Retrospectives go in closeouts, not in the rules file.

### 4.6 State-home templates

`src/lib/templates/backlog.md`: the title, a short "How to use" (the id scheme, the log-instead-of-fix bar, close by moving the line), then `## Open bugs`, `## Open enhancements`, `## Closed`, one line per item, the compact form this repo's own backlog uses. `src/lib/templates/CHANGELOG.md`: a title, one line saying it is hand-maintained (the generator is a later bundle), `## Unreleased`. The templates and the rules block are content seeded once and owned by the user afterwards (init keeps them); nothing init writes is a script.

### 4.7 Host wiring

The claude entry in `src/lib/hosts.mjs` gains `settings: '.claude/settings.json'`, `HOOK_COMMAND` with its not-installed line, `hookTimeout: 10`, `importLine: '@AGENTS.md'`, and the three file names of the ignore rule (`CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`). init and doctor read the host table; nothing about Claude Code is hardcoded elsewhere. A second host adds its entry and its two functions (write hook, check hook).

### 4.8 doctor

`npx cookwright doctor [--hook]`. Library under `src/lib/doctor/`: one function per check, `(repo, probes) → { status, note }`, registered by name in one table; the verdict constants are shared with the landing check (`PASS`, `FAIL`, `WARN`, `SKIP` and `summarize` move from `src/lib/bundle/check.mjs` to `src/lib/verdict.mjs`; `check.mjs` imports and re-exports them, so `bundle.mjs` and `bundle.test.mjs` keep their imports). Probes (`hasTool`, `claudeVersion`, `checkIgnore`) are injected so tests need no Claude binary. No network, no npm, no stdin read, no recursive directory walk; budget under two seconds. `claude --version` is spawned only when its answer matters (see `host.rules`), with a five-second timeout; a failure is "version unverified".

| check | PASS | WARN | FAIL | SKIP |
|---|---|---|---|---|
| `config` | valid, `level N` | | invalid (the loader's message); or `hosts` names a host with no entry in the host table: `host <x> is not available in this version of cookwright` (a config FAIL, never a `host.hook` FAIL; the host checks are then SKIP) | |
| `git` | work tree (an unborn HEAD is fine) and `baseBranch` resolves | `baseBranch` does not exist | not a git work tree | |
| `homes.backlog` | file with the three section headings | headings missing | file missing | |
| `homes.closeouts` | directory exists | | missing | |
| `homes.changelog` | file exists | | missing | |
| `backlog.ids` | every `B-nnn`/`E-nnn` id once | duplicate id(s), named | | no backlog file |
| `rules.block` | `current` | `stale` (`run npx cookwright init`), `newer` (`update cookwright`), `malformed` (the path) | no `AGENTS.md`, or `absent` | |
| `rules.size` | every rules file under 60 KB, no line over 3000 chars | over either cap (the file, the size) | | |
| `host.rules` | no `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` at the root or in an ancestor, with Claude Code 2.1.281 or newer, or claude not on PATH (note: version unverified); or the root `CLAUDE.md` carries the import | none of the three anywhere and Claude Code older than 2.1.281 (the rules are ignored by this version; add the import or upgrade) | one of the three at the root or above and the root `CLAUDE.md` does not import `AGENTS.md` (the rules are ignored) | |
| `host.hook` | the project `.claude/settings.json` has a `SessionStart` command containing `cookwright doctor` | | missing (doctor runs only by hand; the note names the project file, since a hook in `settings.local.json` or the user settings is not what init wires) | |
| `secrets.env` | at the root: no tracked `.env*`, none on disk, and `.env`/`.env.local` are ignored | an untracked `.env*` on disk (a plaintext env file; Level 2 replaces it), or `.env` not ignored | a tracked `.env*` | |

`secrets.env` looks at the repo root only (never a walk, never `node_modules`), exempts `.env.example`, `.env.sample` and `.env.template`, decides "ignored" with `git check-ignore`, and only lists names: it never opens an env file, so no value can reach the readout. Its notes never claim "no plaintext secret anywhere"; `.envrc` and the like are Level 2's.

Verdicts are strict where Level 0 is silently off (a missing home, an ignored rules file, no hook) and lenient where the user has a working but weaker setup.

Output, by hand: one line per check, `STATUS  name  note`, then `N checks — a PASS, b FAIL, c WARN, d SKIP`, then the level line: `level 0 declared: complete` or `level 0 declared: drift, k piece(s) missing: …` (FAILs among `requires`), with `weak: …` naming any WARN among `requires`; then `next: <nextLevel message>`. Exit 0, 1 on any FAIL, 2 when refused (no `cookwright.json`: the note says `run npx cookwright init`).

`--hook`: the same checks; prints only the non-PASS lines, the summary and the level line (one line, `cookwright doctor: level 0 complete`, when everything passes, so the session knows it ran); always exits 0: on FAIL, on a thrown probe (printed as one line), and with no `cookwright.json` (prints the `run npx cookwright init` line). Everything goes to stdout, which a SessionStart hook adds to the session's context; stderr is not shown to the agent.

### 4.9 Messages

Every user-facing line of the bin, init and doctor lives in `src/lib/messages.mjs`: the usage, each step's `wrote/updated/kept/skipped` templates, every check's notes, the summary and level lines, the refusals. The two exceptions, by construction: `HOOK_COMMAND` and its not-installed line in `hosts.mjs` (§4.4 step 5), and the templates and the rules block, which are content. The reviewer greps for literals outside these.

## 5. Files

New: `packages/cookwright/bin/cookwright.mjs`, `src/init.mjs`, `src/doctor.mjs`, `src/lib/cli.mjs`, `src/lib/messages.mjs`, `src/lib/levels.mjs`, `src/lib/verdict.mjs`, `src/lib/rules/block.mjs`, `src/lib/rules/agents-block.md`, `src/lib/init/*.mjs` (one file per step is fine; functions under 40 lines), `src/lib/doctor/*.mjs`, `src/lib/templates/backlog.md`, `src/lib/templates/CHANGELOG.md`, `src/init.test.mjs`, `src/doctor.test.mjs`, `src/lib/levels.test.mjs`, `src/lib/rules/block.test.mjs`, `src/test-helpers.mjs` (`scratchRepo`, `commit`, `run` lifted from `bundle.test.mjs`).

Changed: `packages/cookwright/package.json` (bin, files), `src/bundle.mjs` (imports from `cli.mjs`, usage header), `src/lib/config.mjs` + `schema/cookwright.schema.json` + `config.test.mjs` (level, changelog), `src/lib/hosts.mjs` (settings, hook, import, ignore-rule files), `src/lib/bundle/messages.mjs` (`BUNDLE_CLI`), `src/lib/bundle/check.mjs` (verdicts re-exported from `verdict.mjs`), `src/bundle.test.mjs` (helpers import, the usage regex, the `args.cli` assertion), `hosts/claude/skills/bundle/SKILL.md`, `docs/playbook.md`, `README.md`, `docs/dev/backlog.md`, and the dogfood files of §7.

## 6. Tests

Vitest, scratch git repos via `test-helpers.mjs`, no network, no Claude binary (probes injected).

- **config:** `level` default and refusal (`1`, `"0"`, `-1`, `0.5`); `paths.changelog` default and the path rule; schema parity (keys, defaults, the level enum equals `KNOWN_LEVELS`).
- **levels:** every name in `requires` exists in doctor's registry; `nextLevel(0)` is null.
- **block:** `absent`, `current`, `stale` by version, `stale` by content, `newer`, `malformed` (no end; two begins); end marker twice (first wins, the rest kept); CRLF file round-trips as CRLF and is `current`; render with the config's paths.
- **doctor:** each row of the §4.8 table hit at least once, each verdict with its note; a config naming an unknown host → `config` FAIL with the "not available in this version" line and no `host.*` FAIL (the loader's unknown-host message becomes that text); the level line in the `complete`, `drift` and `weak` forms; `--hook` exits 0 on a FAIL, on a thrown probe and with no config, and prints exactly one line when all pass; outside a repo exits 2; `git` on an unborn HEAD; `rules.size` on an oversized line; `backlog.ids` on a duplicate; `host.rules` with `claudeVersion` returning `2.1.280`, `2.1.281` and null, with `.claude/CLAUDE.md` and no root `CLAUDE.md`, with the token only in a code span; `host.hook` with the hook in `settings.local.json` only (FAIL, with the project-file note); `secrets.env` with a tracked `.env.example` (PASS), a tracked `.env` (FAIL), an untracked `.env.local` (WARN), `.gitignore` with `.env*` (PASS, by `check-ignore`).
- **init:** fresh repo → every row `wrote`, the files match the templates, doctor passes; second run → every row `kept`, tree byte-identical (`git status` clean after a commit of the first run); `--dry-run` → report printed, no file, doctor skipped; not a git repo → exit 2; run from a subdirectory; `paths.backlog` in a directory that does not exist yet; existing `AGENTS.md` without block (with and without a trailing newline) → appended, original text intact; stale block → replaced, text outside byte-identical; malformed block → refused, untouched; existing `settings.json` with another `SessionStart` group and another hook → merged, both intact, four-space indent kept; unparseable `settings.json` → refused, untouched; `CLAUDE.md` at root → import line prepended once; `.claude/CLAUDE.md` or `CLAUDE.local.md` at root, or `CLAUDE.md` in an ancestor → root `CLAUDE.md` written with only the import; neither → nothing written; existing config kept untouched even when it lacks `level`; `baseBranch` from `--base`, from an existing `main`, from the checked-out branch, then `main`; `gate.checks` from `package.json`, empty on npm's placeholder; `.gitignore` already covering `.env*` → `kept`.
- **bin:** unknown command → usage, exit 2; `bundle` with no further args → the bundle usage, exit 2; `bundle status` through the bin reaches `bundle.mjs`'s `main` (the existing CLI walk, invoked via the bin's dispatcher).
- **strings:** a test greps `src/` for user-facing literals outside `messages.mjs`, `bundle/messages.mjs`, `hosts.mjs`, the templates and the block (or the reviewer does; the plan prefers the test).
- The existing tests stay green; the two asserting the printed CLI string follow the rename. s1 measures the test count at its start (`npm test`) and records it in its report; the closeout quotes measured numbers only, never a carried figure (the developer, 2026-10-15).

## 7. Dogfood: this repo

In s3, first `git mv CLAUDE.md AGENTS.md`, so this repo's own rules live in `AGENTS.md` outside the managed block (the developer, 2026-10-15). Then run `npx cookwright init` here and commit what it wrote: the block appended to `AGENTS.md`; a new `CLAUDE.md` containing only `@AGENTS.md` (a `CLAUDE.local.md` exists here, and `~/.claude/CLAUDE.md` does not count); `.claude/settings.json` with the SessionStart hook; `CHANGELOG.md`; `docs/dev/closeouts/` already exists; `docs/dev/backlog.md` already has the three headings; `.gitignore` already covers `.env*`. Add `"level": 0` to `cookwright.json` by hand (init keeps an existing config). Then `npx cookwright doctor` reads all PASS; the closeout quotes the readout. The README gets one line for users with an existing `CLAUDE.md`: move the rules to `AGENTS.md`, keep `CLAUDE.md` as the import. The next session opened here sees the doctor line, which is the first real use of the hook. `node_modules/cookwright/bin/cookwright.mjs` resolves here through the workspace symlink, so the hook command is the same one a user gets.

## 8. Verification

- `npm ci && npm test` at the root: every suite green (the count measured at s1 start plus the new ones).
- `ls node_modules/.bin/cookwright` exists after `npm ci`. `npx cookwright` → usage, exit 2. `npx cookwright bundle status` → today's output apart from the invocation string.
- Scratch repo by hand: `git init`, `npm init -y`, `npm install --save-dev <path to packages/cookwright>`, `npx cookwright init`: the report, the files, doctor all PASS on the first run (no commit needed); rerun → all `kept`; delete `AGENTS.md` → doctor FAIL `rules.block` and the drift line; `touch .env` → WARN; `git add -f .env` → FAIL; `npx cookwright doctor --hook` → exit 0 with the compact readout; time it (under two seconds).
- On this repo after §7: `npx cookwright doctor` all PASS; a fresh Claude Code session here prints the hook's line at start (the developer's eyes).
- QA leg: the developer runs `init` on the personal app (the charter's test bed) and reports; this is the bundle's `qa` round. Installing the package there is their hands: `npm install --save-dev /path/to/cookwright/packages/cookwright`.

## 9. State homes to update

- **Backlog, close:** E-007's CLI half (bin + invocation); the adapter half stays as E-007 with the narrowed text.
- **Backlog, open:** git hooks for Level 0 (secret scan with skip-on-absence, tests on push, the doc-sync rule mechanism; the origin repo's pre-commit hook is the source); the changelog generator (`--check`, `--unreleased`; hand-maintained until then); the `/setup` skill (interactive, drives init and the level upgrades); config migrations (`cookwright migrate`, needed before `version` ever moves); the `create-expo-app` CI fixture plus overlay; `paths.playbook` for Level 2 user repos (the rest of E-007); plaintext secret carriers beyond `.env*` (`.envrc`, shell rc files) for Level 2's doctor checks; `host.rules` reading Claude's actual cwd rather than the repo root.
- **README:** install and the two commands.
- **Playbook and the bundle skill:** the invocation.
- **Closeout:** `docs/dev/closeouts/stage-1.md`, from `closeout-draft`, at the end.

## 10. Proposed split

One slice, `core` (one review unit: the CLI surface), three sessions, sequential. Doctor comes before init because init's last step runs doctor and init's tests assert on its readout; doctor depends on nothing init writes.

- **s1** — plan §4.1, §4.2, §4.3 and the helper extraction (§5: `cli.mjs`, `verdict.mjs`, `test-helpers.mjs`; `messages.mjs` with the bin's strings and `CLI`). Checkpoints: the bin dispatches and `bundle status` works through it, `.bin` link verified; config `level` + `changelog` with tests and schema parity; `levels.mjs` with its test (the registry check lands with s2); every existing test green; the invocation renamed in code and docs.
- **s2** — plan §4.8, §4.5 (`block.mjs` and `blockState`, the template text's markers and render; the prose can wait for s3), the check half of §4.7 (the host table's new fields): doctor and its library. Checkpoints: `verdict.mjs` and the registry; every check with its tests; the readout and the level line; `--hook` mode; `levels.requires` held to the registry.
- **s3** — plan §4.4, §4.6, the block's prose (§4.5), the write half of §4.7, §7, §9 (docs, backlog, README; the closeout is the closeout phase's): init and its library, templates, the dogfood, the doc updates. Checkpoints: fresh-repo init with tests; idempotence, refresh and refusal cases; the host cases (import line, settings merge); dogfood committed with the readout all PASS; docs and backlog.

If s3 runs long, §7 and §9 become a fourth session. QA: one round on the personal app. Base branch `main`; bundle branch `bundle/stage-1`.
