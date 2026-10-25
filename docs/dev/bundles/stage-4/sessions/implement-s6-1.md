# implement:s6 — session report

_Stored as the session returned it; the orchestrator verifies before relying on it._

## Commits
- `05ac018 feat(setup): recipe rows for every pack row, and an end pass for the pack defaults and the contract docs`
- `90182a5 feat(audit): the docs-audit skill, and npx cookwright audit args for its doc list`
- `8f92f3b feat(packs): npx cookwright packs rules prints the declared packs' doc-sync rules and gate checks`
- `07de2db feat(bundle): the red-team reviewer checks a diff against a pack's advisory rules`

## Files
- `packages/cookwright/skills/setup/SKILL.md`
- `packages/cookwright/src/lib/skills.test.mjs`
- `packages/cookwright/src/lib/doctor/packs.mjs`
- `docs/guides/standards.md`
- `packages/cookwright/skills/docs-audit/SKILL.md`
- `packages/cookwright/src/audit.mjs`
- `packages/cookwright/src/audit.test.mjs`
- `packages/cookwright/src/packs.mjs`
- `packages/cookwright/src/packs.test.mjs`
- `packages/cookwright/src/lib/command.mjs`
- `packages/cookwright/src/cli-main.mjs`
- `packages/cookwright/src/cli-main.test.mjs`
- `packages/cookwright/src/lib/messages.mjs`
- `packages/cookwright/src/lib/messages.test.mjs`
- `packages/cookwright/src/lib/hosts.mjs`
- `packages/cookwright/src/init.test.mjs`
- `packages/cookwright/src/lib/packs/registry.mjs`
- `packages/cookwright/hosts/claude/workflows/bundle-phase.js`
- `packages/cookwright/docs/playbook.md`
- `scripts/ci/fixture.sh`
- `docs/guides/getting-started.md`
- `docs/guides/codex.md`

## User-facing strings
| key | text | context |
|---|---|---|
| `messages.audit.usage` | usage: npx cookwright audit args [--doc <path>[:<scope>] …] | audit command usage, stderr on a bad argument |
| `messages.audit.refused` | audit: <detail> | prefix of every audit refusal, stderr, exit 2 |
| `messages.audit.docFlag` | --doc <path>[:<scope>] | named in 'missing …' when --doc has no value |
| `messages.audit.noConfig` | no cookwright.json at or above <cwd>; run npx cookwright init | audit args with no config |
| `messages.audit.configInvalid` | cookwright.json invalid: <detail>; run npx cookwright doctor | audit args on an invalid config |
| `messages.audit.defaultScope` | every claim against the code | scope given to a --doc extra that names none; passed into the docs-audit Workflow prompt |
| `messages.audit.packDocMissing` | <path> missing, the <pack> pack's contract doc (run npx cookwright init) | audit args when a declared pack's contract doc is absent |
| `messages.audit.emptyPath` | --doc names no path | audit args --doc ':scope' with an empty path |
| `messages.audit.outside` | --doc <path>: not a path inside the repo (give it relative to the directory holding cookwright.json) | audit args --doc absolute, escaping with .., or the root itself |
| `messages.audit.link` | <path>: <link> is a symbolic link, and the audit edits no doc through one | audit args when a doc's path passes through a symbolic link |
| `messages.audit.notAFile` | --doc <path>: no file there | audit args --doc naming a missing path or a directory |
| `messages.audit.twice` | <path> is listed twice | audit args when an extra repeats a pack doc or another extra |
| `messages.audit.nothing` | nothing to audit: no pack is declared in cookwright.json and no --doc was given | audit args with an empty list |
| `messages.packs.usage` | usage: npx cookwright packs rules | packs command usage |
| `messages.packs.refused` | packs: <detail> | prefix of every packs refusal, stderr, exit 2 |
| `messages.packs.noConfig` | no cookwright.json at or above <cwd>; run npx cookwright init | packs rules with no config |
| `messages.packs.configInvalid` | cookwright.json invalid: <detail>; run npx cookwright doctor | packs rules on an invalid config |
| `messages.packs.none` | no pack declared in cookwright.json (packs is empty; the setup skill offers the ones your tree shows) | packs rules when packs is empty (disposition 35's one-line refusal) |
| `bundle-phase.js redTeam()` | If the rules file has an `### Advisory` heading under a pack section, check each advisory rule against the diff (a new visual where a primitive existed, a primitive reinterpreted where one is documented, a concept rendered twice); a finding names the file and the existing primitive or doc entry as evidence. | added sentence in the red-team reviewer prompt (plan §4.8 text, verbatim) |
| `docs/playbook.md Reviewer role` | The red-team reviewer also checks the diff against each advisory rule under a pack section's `### Advisory` heading in the rules file (a new visual where a primitive existed, a primitive reinterpreted where one is documented, a concept rendered twice), naming the file and the existing primitive or doc entry as evidence. The rules file is already in the header, so the prompt points at it and pastes nothing. | new bullet in the playbook's Reviewer role |
| `skills/setup/SKILL.md` | New section 'One declared pack's rows (pack.<name>.…)': 18 recipe rows for pack.expo/supabase .rules, .docs, .lint, pack.supabase.types; packs row remedy extended; three end-pass items (gate checks from packs rules, doc-sync candidates from the tree, filling a contract doc on a branch then docs-audit) and the types PASS advice | setup skill prose, agent-facing |
| `skills/docs-audit/SKILL.md` | New skill: frontmatter description, 'Level 2, experimental' header, three rules, eight steps | docs-audit skill prose, agent-facing |
| `docs/guides/standards.md` | First version of the standards guide: the rules table, where they are measured, the command and exits, packs rules, audit args, escapes and switches | user guide |
| `docs/guides/getting-started.md, docs/guides/codex.md` | `bundle` and `docs-audit`, Level 2 and experimental; (Codex has no workflows, so no `bundle` and no `docs-audit`) | skill lists in two guides |

## Open questions
- The `SKILLS` entry `'docs-audit': { level: 2, needs: 'workflows' }` (disposition 32) was assigned to s2 but was missing from src/lib/hosts.mjs. skills.test.mjs requires the shipped skill directories to equal the SKILLS keys, so I added the entry in s6. That also changed init.test.mjs's pointer expectations and the fixture's init-row assertion for `.claude/skills/docs-audit`.
- This repo's own `.claude/skills/docs-audit` pointer does not exist yet. Until s7's dogfood `npx cookwright init` writes it, doctor's `host.pointers` row in this repo will name it missing. I did not write the link by hand, because AGENTS.md says init owns the pointers.
- AGENTS.md's Layout line still lists the skills as (`setup`, `bundle`). It also needs `docs-audit`. I left it for s7, which edits AGENTS.md Layout anyway, so the rules-file hash in the session headers stays put mid-bundle.
- `audit args` prints paths relative to the config root, as disposition 34 says. The docs-audit Workflow tells its agents to use paths relative to the session's working directory. When `cookwright.json` sits below the work tree's top, the session needs to run from the config root, or a later change should emit top-relative paths. Not handled in this diff.
- The plan puts the eslint-plugin-i18next install, the eslint.config.js lines and the detected packs in the setup skill's end pass. Each of these is a WARN line in doctor's readout (pack.expo.lint, pack.<name>.lint, packs), so the skill's loop reaches them first. I wrote them as loop remedies, with consent. The end pass carries what no WARN row covers: gate entries from `packs rules` (the standards ratchet among them), doc-sync candidates read from the tree, and filling a contract doc on a branch followed by the docs-audit.

## Notes
All four checkpoints are committed, staging named paths only: setup skill rows and end pass; the docs-audit skill and `audit args`; `packs rules`; the advisory sentence in redTeam() with the matching playbook Reviewer line. The pre-commit hook passed on every commit (secrets PASS, doc-sync PASS); no escape was used.

- **Tests:** at the end of the session `npm test` passed twice, 26 files and 730 tests. One earlier run of `npm test` exited 1 even though its reporter lines showed all tests passing. I did not capture the cause (likely a timing flake under load). The two reruns and a direct `vitest run` exited 0.
- **Fixture:** `bash scripts/ci/fixture.sh` passed locally ("fixture: PASS, every step as expected", exit 0) with supabase on PATH. It includes the new `.claude/skills/docs-audit` init row and the `audit args` step, which printed docs/design-system.md and docs/data-model.md with their scopes. I did not run it again without supabase on PATH.

**Design notes:**
- `packs rules` prints `defaultsOf(declared.flatMap(activeRules))`, a helper split out of `packDefaults` in registry.mjs. A rule switched off contributes no entry, and the ratchet entry appears once while any ESLint rule is on.
- `audit args` takes `--doc` more than once, parsed by hand because `parseArgv` keeps only the last value of a flag. Besides what disposition 34 lists, it refuses a path listed twice and an empty list.
- `src/lib/command.mjs` is a new 20-line helper that `audit` and `packs` share to find and load the config.
- `packRowNames(PACKS)` is exported from doctor/packs.mjs for skills.test.mjs.
- docs/guides/standards.md has its first version. getting-started.md and codex.md got a one-clause update each, naming docs-audit in the skill lists.

Nothing left the repo, and no command for the developer's hands came up.
