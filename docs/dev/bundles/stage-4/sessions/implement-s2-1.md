# implement:s2 — session report

_Stored as the session returned it; the orchestrator verifies before relying on it._

## Commits
- `f276902 feat(init): each declared pack's section of AGENTS.md and its contract doc`
- `9ece929 feat(init): a fresh config declares its packs with their doc-sync rules and gate checks`
- `60b1ee3 feat(init): detect the packs a fresh config declares, or take them from --packs`
- `db036c4 feat(init): spread each pack's ESLint export into Expo's eslint.config.js, and name the plugin it needs`
- `c5b11fd test(fixture): the scaffold with npx expo lint's and supabase init's files, both packs asserted`

## Files
- `packages/cookwright/src/lib/init/rules.mjs`
- `packages/cookwright/src/lib/init/packs.mjs`
- `packages/cookwright/src/lib/init/steps.mjs`
- `packages/cookwright/src/lib/init/config.mjs`
- `packages/cookwright/src/init.mjs`
- `packages/cookwright/src/lib/packs/detect.mjs`
- `packages/cookwright/src/lib/packs/detect.test.mjs`
- `packages/cookwright/src/lib/packs/registry.mjs`
- `packages/cookwright/packs/expo/pack.mjs`
- `packages/cookwright/packs/supabase/pack.mjs`
- `packages/cookwright/packs/expo/templates/design-system.md`
- `packages/cookwright/packs/supabase/templates/data-model.md`
- `packages/cookwright/src/lib/templates/eslint.config.js`
- `packages/cookwright/src/lib/messages.mjs`
- `packages/cookwright/src/init.test.mjs`
- `scripts/ci/fixture.sh`
- `fixtures/expo-overlay/eslint.config.js`
- `fixtures/expo-overlay/supabase/config.toml`
- `fixtures/expo-overlay/supabase/migrations/.gitkeep`
- `docs/guides/getting-started.md`
- `README.md`
- `AGENTS.md`

## User-facing strings
| key | text | context |
|---|---|---|
| `messages.init.usage` | usage: npx cookwright init [--base <branch>] [--hosts <host,…>] [--packs <pack,…>] [--dry-run] | init usage line, --packs added |
| `messages.init.bundleFlag` | --${flag} belongs to npx cookwright bundle init; npx cookwright init takes --base, --hosts, --packs and --dry-run | init refusal for --plan/--split, --packs added |
| `messages.init.config.wrote` | baseBranch ${base}; ${packs}; ${gate} | cookwright.json row note on a fresh config (packs part added) |
| `messages.init.config.gateRuns` | gate: ${runs joined by ', '} | replaces gateTest: the gate commands a fresh config runs |
| `messages.init.config.gateWithout` | gate: ${runs}; no npm test (${reason}) | fresh config whose gate holds only pack checks |
| `messages.init.config.packsNone` | packs: none detected | fresh config, no pack detected |
| `messages.init.config.packsDetected` | packs: ${name} (${evidence}), … | fresh config, detected packs with evidence |
| `messages.init.config.packsFlag` | packs: ${names or 'none'} (--packs) | fresh config, packs taken from --packs |
| `messages.detect.dependsOn` | package.json depends on ${pkg} | detection evidence (init config row; doctor packs row in s3) |
| `messages.detect.file` | ${rel} exists | detection evidence for supabase/config.toml |
| `messages.init.pack.section.wrote` | written with the ${name} pack's section | AGENTS.md#<pack> row, file absent |
| `messages.init.pack.section.appended` | the ${name} pack's section added after the managed blocks; your text is untouched | AGENTS.md#<pack> row, section absent |
| `messages.init.pack.section.refreshed` | the ${name} pack's section refreshed to v${v}; the text outside the markers is untouched | AGENTS.md#<pack> row, stale section |
| `messages.init.pack.section.current` | the ${name} pack's section is current | AGENTS.md#<pack> row, current |
| `messages.init.pack.section.newer` | the ${name} pack's section v${v} is newer than this cookwright; left alone (update cookwright) | AGENTS.md#<pack> row, newer |
| `messages.init.pack.section.malformed` | ${file}: the ${name} pack's section is malformed (a begin marker with no end marker | two begin markers); fix the markers by hand | init refusal on a malformed pack section |
| `messages.init.pack.doc.template` | the ${name} pack's contract doc, from its template | docs/design-system.md / docs/data-model.md row, written |
| `messages.init.pack.doc.present` | present; the ${name} pack's contract doc | contract doc row, kept |
| `messages.init.pack.eslint.added` | ${exports} spread after expoConfig; the rest of Expo's template untouched | eslint.config.js row, transformed |
| `messages.init.pack.eslint.names` | names ${exports} | eslint.config.js row, kept |
| `messages.init.pack.eslint.other` | not Expo's template, left alone; add ${lines} to its config array by hand (the setup skill does it with consent) | eslint.config.js row, skipped on a user config |
| `messages.init.pack.eslint.none` | no ESLint config; ${setup} sets ESLint up, then rerun init | eslint.config.js row, skipped with no config (npx expo lint / npm install --save-dev eslint) |
| `messages.init.pack.dep.installed` | installed (${reason}) | eslint-plugin-i18next row, kept |
| `messages.init.pack.dep.needs` | needs ${install} (${reason}) | eslint-plugin-i18next row, skipped: 'needs npm install --save-dev eslint-plugin-i18next (the strings rule)' |
| `packs/expo/templates/design-system.md` | # Design system — header paragraph (the contract for the app's primitives, read by expo:design-doc at commit and pack.expo.docs in doctor; first column is the component's name) and the table | Primitive | File | Props | Notes | | contract doc template written into the user's repo |
| `packs/supabase/templates/data-model.md` | # Data model — header paragraph (the contract for the database, read by supabase:data-doc and pack.supabase.docs; first column is the migration's file name), ## Migrations | Migration | Tables and RPCs touched | Summary |, ## Tables | Table | Purpose | RLS |, ## RPCs | RPC | Signature | Purpose | | contract doc template written into the user's repo |
| `scripts/ci/fixture.sh MSG_HEAD` | fixture: create-expo@5.0.1, template expo-template-blank-typescript@58.0.21, eslint@9.39.5, eslint-config-expo@58.0.4, eslint-plugin-i18next@6.1.5 | fixture's first line, the ESLint pins added |

## Open questions
- Scope choice to confirm: the task's scope text (the s2 scope in state.json) does not name eslintConfigStep or the docs-audit SKILLS entry. The revised plan puts both in s2 (§10 and disposition 38), while state.json's s5 still lists 'init's eslint.config.js line'. I followed the plan and implemented eslintConfigStep, plus packDepsStep (§4.2 lists both in STEPS), so s5's checkpoint 'init's template edit, byte-tested against Expo's eslint.config.js' is already done in db036c4.
- Deferred to s6: the docs-audit SKILLS entry (disposition 32, which the plan's §10 puts in s2). skills.test.mjs requires every SKILLS key to have a shipped skills/<name> directory, so adding the entry needs skills/docs-audit/SKILL.md, which is s6 work. The fixture's .claude/skills/docs-audit row waits for it too.
- Deferred to s3: the tool-aware level-line assertion of disposition 18 ('complete' only with both gitleaks and claude on PATH, otherwise the 'not verified:' list). It depends on B-013's new level line. The fixture still asserts '^level 0 declared: complete' and ' 0 FAIL, 0 WARN, ' unconditionally, which is the until-s5 state disposition 18 describes for WARN.
- Not in the plan: a pack section left in AGENTS.md after its pack is removed from `packs` is left alone by init. Its sentences keep naming checks that no longer run. Should init or doctor report it? Candidate backlog entry. Unlike that, the eslint.config.js transform does drop the line of an undeclared pack when the file is otherwise Expo's template.
- Not in the plan: `init --packs ,` (a list with nothing in it) writes `packs: []` and overrides detection, with the note 'packs: none (--packs)'. It is tested, but no guide documents it as the opt-out. Keep it, document it, or refuse it?
- Temporary state between sessions: until s4 ships packs/<name>/eslint.cjs, an app whose eslint.config.js init has transformed would fail at `npx expo lint`. Until s5 ships `npx cookwright standards`, a fresh config with packs has gate checks (`standards --ratchet`, `standards --types`) that a pre-push cannot run yet. Nothing outside this branch sees either, but QA should not start before s5.

## Notes
I finished all four checkpoints and committed each one, staging named paths only. The doc-sync check passed on every commit, so no skip was needed.

Measured at the end of the session: `npm test` passes 552 tests in 19 files. The fixture (`bash scripts/ci/fixture.sh`) is green locally twice: once with supabase 2.98.1 on PATH, and once with it hidden behind a shadow bin dir in the scratchpad. Both runs end on 'fixture: PASS'. Doctor reads 17 PASS / level 0 complete, the pre-commit hook passes secrets and doc-sync, and migrate reads 'already at version 3'.

What each piece does:
- **AGENTS.md:** `rulesFileStep` (`src/lib/init/rules.mjs`) replaces `blockStep`. It reads AGENTS.md once, writes it once, and reports one row per block: `AGENTS.md`, then `AGENTS.md#<pack>`. A section that is not there yet goes right after the managed blocks, a stale one is refreshed in place, a malformed one is a refusal, and line endings are kept.
- **Pack steps:** `src/lib/init/packs.mjs` holds three. `packDocsStep` writes a contract doc from its template only when the doc is missing. `eslintConfigStep` makes one transform for all declared packs, and only when `eslint.config.js` (after removing our own lines) is byte-equal to Expo's template. The reference copy is `src/lib/templates/eslint.config.js`, taken verbatim from `@expo/cli@58.1.15`; any other config is skipped with the missing lines named. `packDepsStep` reports eslint-plugin-i18next as installed, or as skipped with its npm install line; init never installs it.
- **Fresh config:** `freshConfig` takes `{ names, note }` and writes `packs`, the pack doc-sync rules and the gate checks, through `packDefaults` in `registry.mjs`. The s6 `packs rules` command can reuse `packDefaults`.
- **Detection:** `detect.mjs` reads data in each manifest (`detect: { files, dependencies }`).
- **`--packs`:** goes through `FRESH_FLAGS`, so it is refused on an existing config the same way `--hosts` is.

Fixture pins: eslint 9.39.5 is the latest 9.x, which is the `^9.0.0` range `npx expo lint` installs; the npm latest is 10.13.0. eslint-config-expo is 58.0.4 and eslint-plugin-i18next is 6.1.5. The overlay's `supabase/config.toml` comes from a real `supabase init` (supabase 2.98.1) with project_id set to "app"; gitleaks finds nothing in it.

Doc updates made alongside the changed output:
- getting-started.md: the init usage with `--packs` and its default, and the sample config row.
- README.md: the sample config row.
- AGENTS.md: the fixture sentence in Layout.

The first fixture run used KEEP=1, so its temp dir is still on disk: <local path> The harness refused my rm of it; delete it by hand if you like. Nothing left the repo: the only network use was npm installs and an `npm pack` download of `@expo/cli` into the scratchpad, to read its template.
