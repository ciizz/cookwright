# implement:s2 — session report

_Stored as the session returned it; the orchestrator verifies before relying on it._

## Commits
- `b5d37a3 feat(doctor): the check registry, probes, the managed block and the host table's hook fields`
- `a57dfa5 test(doctor): every row of the §4.8 table, the unknown-host config FAIL included`
- `22a1142 feat(doctor): the readout, the level line and --hook mode`

## Files
- `packages/cookwright/src/doctor.mjs`
- `packages/cookwright/src/doctor.test.mjs`
- `packages/cookwright/src/lib/doctor/registry.mjs`
- `packages/cookwright/src/lib/doctor/repo.mjs`
- `packages/cookwright/src/lib/doctor/basics.mjs`
- `packages/cookwright/src/lib/doctor/homes.mjs`
- `packages/cookwright/src/lib/doctor/rules.mjs`
- `packages/cookwright/src/lib/doctor/claude.mjs`
- `packages/cookwright/src/lib/doctor/secrets.mjs`
- `packages/cookwright/src/lib/doctor/report.mjs`
- `packages/cookwright/src/lib/probes.mjs`
- `packages/cookwright/src/lib/probes.test.mjs`
- `packages/cookwright/src/lib/rules/block.mjs`
- `packages/cookwright/src/lib/rules/block.test.mjs`
- `packages/cookwright/src/lib/rules/agents-block.md`
- `packages/cookwright/src/lib/hosts.mjs`
- `packages/cookwright/src/lib/messages.mjs`
- `packages/cookwright/src/lib/verdict.mjs`
- `packages/cookwright/src/lib/bundle/check.mjs`
- `packages/cookwright/src/lib/levels.test.mjs`

## User-facing strings
| key | text | context |
|---|---|---|
| `messages.doctor.usage` | usage: npx cookwright doctor [--hook] | doctor refuses a positional or a valued --hook; stderr prefixed 'doctor: ', exit 2 (stdout, exit 0 under --hook) |
| `messages.doctor.refused` | doctor: <detail> | prefix of every by-hand refusal on stderr, e.g. 'doctor: unknown flag --verbose (known: --hook)' |
| `messages.doctor.noConfig` | no cookwright.json at or above <cwd>; run npx cookwright init | no config found from cwd up to the work tree's top: by hand stderr exit 2; under --hook stdout exit 0 |
| `messages.doctor.hookLine` | cookwright doctor: <text> | --hook prefix for a refusal line and for the counts line |
| `messages.doctor.crashed` | cookwright doctor crashed: <first line> | --hook: anything thrown outside a check (e.g. a probe while finding the root); exit 0 |
| `messages.doctor.checkThrew` | the check could not run: <first line> | FAIL note of a check that threw (e.g. a git error from the ignored probe) |
| `messages.doctor.needsGit` | skipped, needs git, run setup | SKIP note of git and secrets.env when git is not on PATH |
| `messages.doctor.configInvalid` | config invalid | SKIP note of every config-dependent check when cookwright.json does not load |
| `messages.doctor.config.ok` | valid, level <N> | config PASS (the FAIL note is the loader's own message, joined to one line) |
| `messages.doctor.git.*` | work tree, baseBranch <b> | work tree, baseBranch <b> (no commits yet) | work tree; baseBranch unverified, config invalid | baseBranch <b> does not exist | not a git work tree | git: PASS, PASS on an unborn HEAD, PASS when the config is invalid, WARN, FAIL |
| `messages.doctor.homes.*` | <file>, with its three sections | <file> lacks "## Open enhancements", "## Closed" | <file> | <dir>/ | <path> missing (run npx cookwright init) | homes.backlog PASS/WARN, homes.changelog PASS, homes.closeouts PASS, any home FAIL |
| `messages.doctor.ids.*` | <n> id(s), each once | duplicate id(s): B-002, E-001 | no backlog file | backlog.ids PASS / WARN / SKIP |
| `messages.doctor.block.*` | AGENTS.md: the managed block is current | AGENTS.md: block v<n> is newer than this cookwright (update cookwright) | no AGENTS.md: Level 0's rules are not what the package ships (run npx cookwright init) | AGENTS.md has no managed block: Level 0's rules are not what the package ships (run npx cookwright init) | AGENTS.md: the managed block is stale (run npx cookwright init) | AGENTS.md: the managed block is malformed (a begin marker with no end marker | two begin markers); fix the markers by hand | rules.block PASS / WARN / FAIL x4 |
| `messages.doctor.size.*` | <files>: under 60 KB, no line over 3000 chars | no rules file to measure | <file> is <kb> KB (cap 60 KB) | <file> line <n> is <chars> chars (cap 3000) | rules.size PASS / PASS / WARN parts joined by '; ' |
| `messages.doctor.hostRules.*` | CLAUDE.md imports @AGENTS.md | claude <v> reads AGENTS.md natively; nothing shadows it | AGENTS.md is shadowed by <files> and the root CLAUDE.md does not carry @AGENTS.md (run npx cookwright init) | claude <v> reads only CLAUDE.md (AGENTS.md needs 2.1.281 or newer; run npx cookwright init, which writes the import) | skipped, needs claude, run setup (AGENTS.md support unverified) | host.rules PASS x2 / FAIL x2 / SKIP |
| `messages.doctor.hostHook.*` | .claude/settings.json runs doctor at session start | .claude/settings.json has an earlier version of the doctor hook (run npx cookwright init) | no doctor SessionStart hook in .claude/settings.json, so doctor runs only by hand (run npx cookwright init; a hook in settings.local.json or the user settings is not what init wires) | .claude/settings.json is not valid JSON (<parser error>) | host.hook PASS / WARN / FAIL / FAIL |
| `messages.doctor.secrets.*` | no .env file tracked or at the root; .env and .env.local ignored | tracked env file(s): <files>; untrack them and rotate what they hold | <files> at the root: a plaintext env file (Level 2 replaces it) | <paths> not ignored by git (run npx cookwright init) | not a git work tree | secrets.env PASS / FAIL part / WARN parts (joined by '; ') / SKIP outside a work tree |
| `messages.doctor.summary` | <n> checks — <a> PASS, <b> FAIL, <c> WARN, <d> SKIP | counts line, by hand; under --hook prefixed 'cookwright doctor: ' |
| `messages.doctor.levelComplete / levelDrift / weak / unverified / levelUnknown` | level 0 declared: complete | level 0 declared: drift, <k> piece(s) missing: <names> | ; weak: <names> | ; unverified: <names> | level unknown: config invalid | the level line; weak and unverified are appended to it with '; ' |
| `messages.doctor.hookComplete` | cookwright doctor: level 0 complete | --hook's single line when every check passes |
| `messages.doctor.next` | next: <text> | last line by hand; today 'next: Level 1 is not available in this version of cookwright' (messages.noNextLevel from s1) |
| `messages.probeFailed` | <what> failed: <detail> | error thrown by the ignored probe and by secrets.env's git ls-files; it reaches the readout as a checkThrew note |
| `messages.templateValue` | agents-block.md: no value for {{<key>}} (a packaging bug) | thrown by renderTemplate when the block template names a placeholder with no value |
| `HOOK_LINES (src/lib/hosts.mjs)` | cookwright doctor skipped, needs node, run setup | cookwright doctor skipped: package not installed (npm install) | cookwright doctor crashed (exit $?) | the three fallback lines of HOOK_COMMAND, verbatim from plan §4.4; they live in hosts.mjs by the plan's import rule |
| `agents-block.md (template content)` | This block is managed by cookwright: `npx cookwright init` refreshes it, and edits between the markers are lost on refresh. Your own rules go outside the markers. / State homes in this repo: the backlog is `<backlog>`, closeouts go in `<closeouts>`, the changelog is `<changelog>`. | placeholder block text between <!-- cookwright:begin rules v1 --> and <!-- cookwright:end -->; s3 writes the real prose |

## Open questions
- Plan §4.8 says the config check shows the loader's message verbatim. The loader's message is multi-line (`cookwright.json:\n  p1\n  p2`), and the readout is one line per check. doctor joins it as `cookwright.json: p1; p2`, keeping the text and dropping only the line breaks. Is that acceptable?
- In --hook mode the counts line is prefixed `cookwright doctor: ` (e.g. `cookwright doctor: 11 checks — 10 PASS, 1 FAIL, 0 WARN, 0 SKIP`), so the session context shows where the lines come from. The by-hand counts line has no prefix, as in the plan. Keep the prefix?
- The weak and unverified lists go on the level line itself, separated by `; ` (`level 0 declared: complete; weak: git; unverified: host.rules`), not on lines of their own. The plan says 'followed by' and allows either reading; one line keeps the hook readout short.
- A check that throws (for example, the `ignored` probe hits a git error) becomes a FAIL row: `the check could not run: <first line>`. doctor itself does not crash, but by hand it exits 1. A probe that throws before any check runs (hasTool while finding the root) prints `cookwright doctor crashed: …` in --hook mode and exits 0. By hand it prints `doctor: …` and exits 2. The plan does not say what a thrown check should be. FAIL keeps it loud.
- --hook takes precedence over refusals: `doctor --hook --bogus` prints the refusal as one line and exits 0, not 2. A hook must never fail a session, even when a newer hook command runs against an older package.
- Hook command, for s3 or the developer: HOOK_COMMAND is exactly the plan §4.4 line. It does `cd "${CLAUDE_PROJECT_DIR:-.}"` and then tests `node_modules/cookwright/bin/cookwright.mjs` there. If Claude Code is started in a subdirectory, or the package is installed in a workspace sub-package, the hook prints 'package not installed' even though doctor itself would find the root from there. No change made.
- rules.size needs no config. It measures every rules file any host reads that exists at the root: AGENTS.md, plus each host's `rules` and `shadowing` names (CLAUDE.md, .claude/CLAUDE.md, CLAUDE.local.md). With none present it is PASS, 'no rules file to measure', because rules.block already FAILs a missing AGENTS.md.
- Hand-offs for s3: `hasImport` (the import rule of plan §4.4 step 4) is in rules/block.mjs, and `sessionStartCommands` is exported from doctor/claude.mjs, so init's steps 4 and 5 can reuse the same detection. `blockState` returns `start`/`end` offsets in the LF-normalised text for the refresh. agents-block.md holds only a two-line placeholder: the managed notice and the paths. s3 writes the prose, and RULES_VERSION can stay 1 because nothing has shipped.
- Out of scope, noted for s3 (§9): README.md still says `init` and `doctor` 'are being built', and doctor now works. This repo's .gitignore has `.env` and `.env.*` but not `!.env.example`. That is harmless for doctor, but it matters for the §7 dogfood.

## Notes
All three s2 checkpoints are committed. Each commit staged named paths only. docs/dev/bundles/stage-1/state.json was never touched or staged.

**Tests:** 92 tests in 4 files at session start (`npm test`). At session end: 138 tests in 7 files, all green.
- New: probes.test (5), block.test (10), doctor.test (31).
- levels.test gained the registry test, which checks that every name in `requires` is a key of `CHECKS` in lib/doctor/registry.mjs.

**Checkpoint 1:**
- verdict.mjs now also exports `pass`, `fail`, `warn` and `skip`, and check.mjs uses them. `summarize` and its shape are unchanged, so bundle.test keeps its exact assertions.
- The registry lists all 11 checks of §4.8 in readout order. Each entry says whether it needs the config or git, and the registry handles the `config invalid` and `skipped, needs git, run setup` SKIPs in one place.
- probes.mjs is built, as the s1 decision assigned it to s2: `hasTool` reads PATH with no subprocess; `claudeVersion` uses a 1.5 s timeout and returns null when it fails; `ignored` checks one path per call and throws on a git error.
- Host table (check half of §4.7): `settings`, `hookCommand` (HOOK_COMMAND, byte-identical to plan §4.4), `HOOK_LINES`, `hookCommandsPast` (empty), `hookTimeout` 10, `shadowing`, `importLine`, `agentsNativeSince` '2.1.281'.
- rules/block.mjs: RULES_VERSION 1, the markers, `renderBlock(config)` and `blockState`.

**Checkpoint 2:** every row of the §4.8 table has a test, including:
- the unknown-host config FAIL with the 'not available in this version' text, the config-dependent checks SKIP, and no `host.*` FAIL;
- the git-absent SKIPs and an unborn HEAD named baseBranch;
- the backlog id rule with a prose cross-reference;
- every block state, and the size caps;
- `host.rules` at 2.1.280, 2.1.281 and null; the shadowing scan from a subdirectory and from an ancestor; `~/.claude/CLAUDE.md` excluded through an injected home;
- `host.hook`: settings.local.json only, an echo command, and the WARN for an earlier command;
- every `secrets.env` case in §6.

**Checkpoint 3:**
- The readout, and the level line in its complete, drift, weak, unverified and unknown forms.
- `--hook` prints exactly one line when everything passes. It exits 0 on a FAIL, on a thrown probe and with no config.
- By hand: no config, an unknown flag or a positional exits 2. A FAIL exits 1.
- Run through the dispatcher from a subdirectory.

**Measured on this repo:** `node packages/cookwright/bin/cookwright.mjs doctor` takes about 90 ms (the --hook run about 75 ms). It reports 4 FAILs, the expected pre-dogfood drift: homes.changelog, rules.block, host.rules and host.hook. `claude --version` on this machine takes 56 ms.

Nothing was run that leaves the repo. The Workflow runtime gave me no budget.spent() figure to report.
