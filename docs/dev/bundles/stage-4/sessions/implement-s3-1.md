# implement:s3 — session report

_Stored as the session returned it; the orchestrator verifies before relying on it._

## Commits
- `d85c5ba feat(doctor): a packs row, and each declared pack's declared, rules and docs rows`
- `50b5105 fix(doctor): the level reads not verified while a required check cannot measure, and no gate check WARNs`
- `90fd365 fix(init): ignore node_modules when git does not, and doctor FAILs a tracked one (B-011)`

## Files
- `packages/cookwright/src/lib/packs/entries.mjs`
- `packages/cookwright/src/lib/packs/entries.test.mjs`
- `packages/cookwright/src/lib/doctor/packs.mjs`
- `packages/cookwright/src/lib/doctor/registry.mjs`
- `packages/cookwright/src/lib/doctor/report.mjs`
- `packages/cookwright/src/lib/doctor/hooks.mjs`
- `packages/cookwright/src/lib/doctor/repo.mjs`
- `packages/cookwright/src/lib/init/gitignore.mjs`
- `packages/cookwright/src/lib/levels.mjs`
- `packages/cookwright/src/lib/levels.test.mjs`
- `packages/cookwright/src/lib/messages.mjs`
- `packages/cookwright/src/lib/messages.test.mjs`
- `packages/cookwright/src/lib/skills.test.mjs`
- `packages/cookwright/src/doctor.test.mjs`
- `packages/cookwright/src/init.test.mjs`
- `packages/cookwright/skills/setup/SKILL.md`
- `scripts/ci/fixture.sh`
- `docs/guides/getting-started.md`
- `docs/guides/hooks-and-escapes.md`
- `README.md`

## User-facing strings
| key | text | context |
|---|---|---|
| `messages.doctor.packs.declared` | declared: ${names joined by ', '} | doctor packs row PASS, packs declared |
| `messages.doctor.packs.none` | no packs declared, none detected | doctor packs row PASS, nothing declared or detected |
| `messages.doctor.packs.detected` | ${name} detected (${evidence}), …, no pack declared; the setup skill offers it|them | doctor packs row WARN (disposition 22), e.g. 'expo detected (package.json depends on expo), no pack declared; the setup skill offers it' |
| `messages.doctor.pack.declared` | ${name} pack v${version}: ${measured rule ids}[; advisory: ${n}] | pack.<name>.declared PASS, e.g. 'expo pack v1: strings, tokens, size, design-doc; advisory: 3' |
| `messages.doctor.pack.rules.current` | ${file}: the ${name} pack's section is current | pack.<name>.rules PASS |
| `messages.doctor.pack.rules.newer` | ${file}: the ${name} pack's section v${v} is newer than this cookwright (update cookwright) | pack.<name>.rules WARN |
| `messages.doctor.pack.rules.noFile` | no ${file}, so no ${name} pack section (run npx cookwright init) | pack.<name>.rules FAIL, no AGENTS.md |
| `messages.doctor.pack.rules.absent` | ${file} has no ${name} pack section (run npx cookwright init) | pack.<name>.rules FAIL |
| `messages.doctor.pack.rules.stale` | ${file}: the ${name} pack's section is stale (run npx cookwright init) | pack.<name>.rules FAIL |
| `messages.doctor.pack.rules.malformed` | ${file}: the ${name} pack's section is malformed (a begin marker with no end marker | two begin markers); fix the markers by hand | pack.<name>.rules FAIL |
| `messages.doctor.pack.rules.off` | switched off: ${ids} | pack.<name>.rules WARN suffix, appended after the section note with '; ' |
| `messages.doctor.pack.docs.missing` | ${doc} missing (run npx cookwright init) | pack.<name>.docs WARN |
| `messages.doctor.pack.docs.noRule` | no doc-sync rule ${rule} in hooks.docSync, so a change to the code never asks for ${doc} (the setup skill offers it) | pack.<name>.docs WARN |
| `messages.doctor.pack.docs.ruleOther` | the doc-sync rule ${rule} does not name ${doc} in its docs (the setup skill offers the pack's rule) | pack.<name>.docs WARN |
| `messages.doctor.pack.docs.ok` | ${n} primitive(s)|migration(s), ${n} documented in ${doc} | pack.<name>.docs PASS, e.g. '0 primitives, 0 documented in docs/design-system.md' |
| `messages.doctor.pack.docs.omitted` | ${k} of ${n} primitives|migrations has|have no entry in ${doc}: ${first five names, then …} | pack.<name>.docs WARN (disposition 11) |
| `messages.doctor.gateScripts.none` | no gate checks configured; pre-push runs nothing (add a check to gate.checks) | gate.scripts WARN (B-012); was PASS 'no gate checks configured' |
| `messages.doctor.levelNotVerified` | level ${level} declared: not verified: ${names} (see their lines) | doctor level line when a required check SKIPs and none FAILs (B-013) |
| `messages.doctor.notVerified` | not verified: ${names} (see their lines) | level line tail after a drift; replaces 'unverified: …' |
| `messages.doctor.nodeModules.ok` | node_modules is not tracked | repo.node_modules PASS (B-011) |
| `messages.doctor.nodeModules.tracked` | node_modules is tracked (git rm -r --cached node_modules, then commit) | repo.node_modules FAIL (B-011) |
| `messages.doctor.nodeModules.notWorkTree` | not a git work tree | repo.node_modules SKIP |
| `messages.init.gitignore.ignored` | node_modules, .env and .env.local are ignored | .gitignore init row, kept (was '.env and .env.local are ignored') |
| `messages.init.gitignore.ignoredElsewhere` | node_modules, .env and .env.local are ignored by git's own excludes | .gitignore init row, skipped |
| `skills/setup/SKILL.md rows` | gate.scripts WARN row with the gate-check offer; hooks.pre-commit/pre-push WARN 'hooks managed elsewhere'; repo.node_modules FAIL row; packs WARN row; end-pass bullet reduced to the Codex host.hook line; level-line sentence on 'not verified: …' | setup skill recipe, content shipped in the package |
| `scripts/ci/fixture.sh expect_level` | host.rules does not read the scaffold's CLAUDE.md import / level 0 is not complete / gitleaks is absent but the level line does not name exactly tools.gitleaks as not verified | fixture failure lines of the tool-aware level assertion |

## Open questions
- I departed from the letter of disposition 18 on the fixture's level line. When I hid `claude`, the fixture's host.rules still read PASS ('CLAUDE.md imports @AGENTS.md'): the scaffold's CLAUDE.md carries the import, so that row does not need claude. Only gitleaks can make a required row SKIP there. So the fixture now asserts '^level 0 declared: complete$' when gitleaks is on PATH, and otherwise exactly 'not verified: tools.gitleaks (see their lines)'. It also asserts the host.rules PASS, so a future dependence on claude would show up. Does the orchestrator accept this reading of disposition 18?
- Setup skill (s6's file): skills.test.mjs requires every CHECKS key to appear in skills/setup/SKILL.md. I therefore added minimal recipe rows for `packs` and `repo.node_modules`. I also moved the gate.scripts row from PASS (end pass) to WARN (in the loop) for B-012, made the foreign-hooks file rows WARN for disposition 17, and added one sentence on reading a 'not verified' level line. The dynamic pack.<name>.* rows still have no recipe. Until s6 adds them, a pack row that is not PASS ends a setup walkthrough as 'no recipe'.
- Guides and README: the doc-sync rule `setup` and the AGENTS.md doc-sync rule made me update prose in the same commits: getting-started (19 checks, the packs and pack rows, the new level line, B-012's hand-written gate.checks example, the node_modules .gitignore line), hooks-and-escapes (the foreign-hooks rows WARN) and README (19 checks). I left the dated 0.1.0 output samples unchanged ('17 checks — 17 PASS', 'complete; unverified: host.rules, tools.gitleaks', the .gitignore init row), because they must be re-measured, not retyped. That refresh is s7's. Until then, the getting-started prose notes that the 0.1.0 output above still read complete.
- The packs row follows disposition 22 literally: it is PASS listing the declared packs whenever any pack is declared, even when the tree also shows a stack that is not declared (say expo declared, supabase/config.toml present). Should a partly declared tree WARN the missing pack too? If wanted, this is a backlog candidate.
- My reading of disposition 8 in pack.<name>.docs: when the pack's doc-sync rule is switched off (e.g. `rules: { 'design-doc': false }`), the row stops asking for the rule in hooks.docSync. The doc's presence and the omission count still run, since they measure the contract doc itself. This is tested; please confirm.
- Drift form of the level line: after a drift, the line still appends '; weak: …' and '; not verified: … (see their lines)', so no measured fact is dropped. Example: 'level 0 declared: drift, 1 piece(s) missing: rules.block; weak: git; not verified: tools.gitleaks (see their lines)'. The plan's truth table names only the head of each form; please confirm the tails.

## Notes
I finished all three checkpoints and committed each one, staging named paths only. docs/dev/bundles/stage-4/state.json is still modified by the CLI and was never staged. The doc-sync hook passed on every commit, so no skip was needed.

Measured at the end of the session: `npm test` passes 581 tests in 21 files. The fixture (`bash scripts/ci/fixture.sh`) is green locally three times:
1. All tools on PATH: 24 rows, level complete.
2. gitleaks and claude hidden behind a shadow PATH in the scratchpad: level line 'not verified: tools.gitleaks (see their lines)'.
3. After B-011, all tools on PATH: 25 checks, 25 PASS, level complete; .gitignore 'appended .env, .env.*, !.env.example', since the scaffold already ignores node_modules.

What each piece does:
- **Pack rows:** doctor/packs.mjs holds the static `packs` row (registered after secrets.env) and the per-pack rows. runChecks appends pack.<name>.declared, .rules and .docs for each declared pack, in `packs` order, through the same runOne (config-guarded, a throw becomes a FAIL). No level requires a pack row; a test shows a pack FAIL leaves the level line complete.
- **Listers:** src/lib/packs/entries.mjs holds listComponents, listMigrations (disposition 33's shapes, one readdir plus one level below for components) and tableKeys (the first cell of every body row of every table, with code spans and links unwrapped).
- **B-012:** gate.scripts with no checks is WARN 'no gate checks configured; pre-push runs nothing (add a check to gate.checks)'. The doctor test repo now carries a gate check, and the fresh-init tests expect exactly that one WARN.
- **B-013:** report.mjs's levelLine is a truth table: FAIL is drift; else SKIP is 'not verified: … (see their lines)'; else complete; a WARN is named as weak on every form. There is a direct truth-table test.
- **Disposition 17:** hooks.pre-commit and hooks.pre-push read WARN 'hooks managed elsewhere (see hooks.path)' under a foreign setup.
- **B-011:** gitignoreStep probes 'node_modules/' (with the slash, git answers whether or not the directory exists; measured) and writes or appends 'node_modules/' before the env lines. A rerun is stable, including when a rule outside .gitignore overrides it. repo.node_modules runs `git ls-files --error-unmatch -- node_modules` with stdout discarded, so a huge tracked tree cannot overflow the buffer: exit 0 is FAIL, exit 1 is PASS, anything else is a probe error. It joins Level 0's requires.
- **Test counts:** derived from Object.keys(CHECKS) instead of 17.

Nothing left the repo.
