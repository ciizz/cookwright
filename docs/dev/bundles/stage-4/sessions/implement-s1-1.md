# implement:s1 — session report

_Stored as the session returned it; the orchestrator verifies before relying on it._

## Commits
- `4bf6f3f feat(packs): the expo and supabase manifests and the pack registry`
- `8e2809c feat(config): version 3, packs and a gate check's skipExit, migrated from version 2`
- `77bac09 refactor(rules): block kinds, so a pack section sits beside the core block in AGENTS.md`
- `af35d98 feat(packs): a pack's section of AGENTS.md, rendered from its manifest`

## Files
- `packages/cookwright/packs/expo/pack.mjs`
- `packages/cookwright/packs/supabase/pack.mjs`
- `packages/cookwright/src/lib/packs/registry.mjs`
- `packages/cookwright/src/lib/packs/registry.test.mjs`
- `packages/cookwright/src/lib/packs/section.mjs`
- `packages/cookwright/src/lib/packs/section.test.mjs`
- `packages/cookwright/src/lib/config.mjs`
- `packages/cookwright/src/lib/config.test.mjs`
- `packages/cookwright/src/lib/migrations.mjs`
- `packages/cookwright/src/lib/migrations.test.mjs`
- `packages/cookwright/src/lib/messages.mjs`
- `packages/cookwright/src/lib/messages.test.mjs`
- `packages/cookwright/schema/cookwright.schema.json`
- `packages/cookwright/src/lib/rules/block.mjs`
- `packages/cookwright/src/lib/rules/block.test.mjs`
- `packages/cookwright/src/migrate.test.mjs`
- `packages/cookwright/src/cli-main.test.mjs`
- `packages/cookwright/src/init.test.mjs`
- `packages/cookwright/package.json`

## User-facing strings
| key | text | context |
|---|---|---|
| `messages.migrate.outcomes.packsAdded` | packs added, empty (no stack pack declared; the setup skill offers the ones your tree shows) | migrate's 2 → 3 step line when packs was absent |
| `messages.migrate.outcomes.packsKept` | packs kept as it is | migrate's 2 → 3 step line when packs was present |
| `config.mjs validatePacks (not a list)` | packs must be a list of pack names or { name, rules } objects | loader/validator line (config.mjs holds the loader's messages) |
| `config.mjs validatePacks (duplicate)` | packs: each pack once | validator line |
| `config.mjs validatePack (entry shape)` | packs[<i>] must be a pack name or a { name, rules } object | validator line |
| `config.mjs validatePack (name)` | packs[<i>].name must be a non-empty string | validator line |
| `config.mjs validatePack (unknown pack)` | packs: pack "<name>" is not available in this version of cookwright (known: expo, supabase) | validator line |
| `config.mjs validatePackRules (rules shape)` | packs[<i>].rules must be an object mapping a rule of pack <name> to false | validator line |
| `config.mjs validatePackRules (unknown rule)` | packs: rule "<id>" is not a rule of pack <name> (known: <ids>) | validator line |
| `config.mjs validatePackRules (not false)` | packs[<i>].rules.<id> must be false (switched off); a rule is on unless switched off | validator line |
| `config.mjs validateCheck (skipExit)` | gate.checks[<i>].skipExit must be an exit status from 1 to 255 | validator line |
| `schema properties.version.description` | Config format version, bumped only with a migration. 3 is current; a version-1 or version-2 file is migrated in memory and loads, and npx cookwright migrate writes it at version 3. | editor-facing schema description |
| `schema properties.packs.description` | Stack packs this repo takes, each once: a pack brings engineering rules, each written into AGENTS.md beside the check that measures it. A name, or { name, rules } to switch rules off. Init declares the packs it detects on a fresh config only. | editor-facing schema description |
| `schema packs.items.oneOf[n].properties.rules.description` | Rules of the <name> pack switched off, each set to false. A rule is on unless switched off here; doctor reads a switched-off rule as WARN. | editor-facing schema description, one per pack |
| `schema gate.checks.items.properties.skipExit.description` | An exit status this check uses to say it could not measure: recorded as skipped, with its first output line, never as a failure. Any other non-zero exit fails. | editor-facing schema description |
| `section.mjs heading` | ## Standards: <name> pack | pack section content in AGENTS.md |
| `section.mjs intro` | This section is managed by cookwright: `npx cookwright init` refreshes it from the package. Each enforced rule names the check that measures it. Switch a rule off in `cookwright.json` (`packs`), never by editing here. | pack section content in AGENTS.md |
| `section.mjs measurement (eslint)` | measured by ESLint <ids> on the staged files at commit and against the base branch at the gate[; needs <dep>] | parenthesis after an ESLint rule's sentence |
| `section.mjs measurement (doc-sync)` | measured by the doc-sync rule <name> at commit | parenthesis after a doc-sync rule's sentence |
| `section.mjs measurement (gate)` | measured by the gate check <name> | parenthesis after a gate rule's sentence |
| `section.mjs switched off` | - <sentence> (switched off). | a rule switched off in packs |
| `section.mjs advisory` | ### Advisory / No check measures these; a review reads the diff against them. | heading and line before the advisory rules |
| `packs/expo strings.sentence` | User-facing strings go through `t()`; no literal string in JSX, test files exempt | expo section rule |
| `packs/expo tokens.sentence` | No colour literal (hex, rgb, hsl) and no numeric spacing literal in a component; theme tokens only, the theme, palette and tokens files exempt | expo section rule |
| `packs/expo size.sentence` | A function stays under 40 lines in a `.ts` or `.js` file; a component, any function in a `.tsx` or `.jsx` file, under 150 | expo section rule |
| `packs/expo design-doc.sentence` | A component changes with the design-system doc: a commit touching a component stages `docs/design-system.md` | expo section rule |
| `packs/expo components-first.sentence` | Components first: a recurring visual pattern becomes a primitive in `src/components/` before the screen that uses it | expo advisory rule |
| `packs/expo visual-contract.sentence` | The design-system doc is the visual contract: a new surface composes the primitives it documents | expo advisory rule |
| `packs/expo reuse-first.sentence` | Reuse before build: search for an existing rendering of the concept before writing a new one | expo advisory rule |
| `packs/expo messages.strings` | literal string in JSX; route it through t() | per-finding hook/command message (used from s4) |
| `packs/expo messages.tokens` | colour or spacing literal in a component; use a theme token | per-finding hook/command message (used from s4) |
| `packs/expo messages.size` | function over the size limit (40 lines, 150 in a component file) | per-finding hook/command message (used from s4) |
| `packs/expo docs[0].scope` | every primitive entry against its file under src/components/ (its name, file and props) | docs-audit scope (used from s6) |
| `packs/expo deps[0].reason` | the strings rule | dependency reason a skip line names |
| `packs/supabase client.sentence` | The Supabase client is imported only from the shared service (`services/supabase`, `lib/supabase` or `utils/supabase`), never from `@supabase/supabase-js` in a screen, component or feature file | supabase section rule |
| `packs/supabase data-doc.sentence` | A migration changes with the data-model doc: a commit touching a migration stages `docs/data-model.md` | supabase section rule |
| `packs/supabase types.sentence` | The generated database types match the schema: `npm run db:types` regenerates them after a migration | supabase section rule |
| `packs/supabase messages.client` | Supabase client imported outside the shared service; import it from there | per-finding hook/command message (used from s4) |
| `packs/supabase docs[0].scope` | every migration, table and RPC entry against the files under supabase/migrations/ | docs-audit scope (used from s6) |

## Open questions
- The fixture (scripts/ci/fixture.sh:160) still asserts `already at version 2`. With CONFIG_VERSION now 3 it fails until s2 makes its planned 'version-3 line' edit. fixture.sh belongs to s2 and the plan says the fixture is green from s2 on, so I left it alone. A CI run of the fixture on this branch before s2 lands will be red.
- freshConfig (src/lib/init/config.mjs) does not write `packs` yet. A fresh config gets `[]` from DEFAULTS. Writing the key with detection and `--packs` is s2's work (§10). detect.mjs is listed in §4.1 but the split puts detection in s2, so I did not build it.
- §4.9: of the planned namespaces, s1 added only what its own code prints: messages.migrate.outcomes.{packsAdded,packsKept}, plus the config validator's lines, which live in config.mjs by that file's import rule. messages.doctor.pack.*, hook.standards.*, standards.*, init.pack.*, audit.*, packs.* and the gate's skip text are left for the sessions whose code prints them, so no unused strings land now. The orchestrator should confirm this reading of 's1: §4.9 strings'.
- Disposition 1 lists components-first, visual-contract and reuse-first without naming their pack. All three are visual or component rules, so they ship in expo; supabase has no advisory rules, and its section has no `### Advisory` heading.
- docs/guides/updating.md:18 shows `cookwright.json: already at version 2` as dated output from cookwright 0.1.0. It is still accurate for 0.1.0. Updating the guides is s7's scope.

## Notes
s1 is done in four commits. Order: manifests and registry first, because the config validator and the schema test need the manifests' rule ids. The plan listed config first. `npm test` at the end of the session: 19 files, 528 tests, all passing (baseline before s1: 17 files, 478 tests).

Departures from the plan's wording, each kept small:
- (1) `beginMarker(version = RULES_VERSION, kind = CORE_KIND)` keeps version as the first argument, so existing callers like `beginMarker(RULES_VERSION + 7)` in doctor.test, init.test and block.test still work. Kinds are strings: `CORE_KIND = 'rules'`, `packKind(name) = 'pack <name>'`. `blockState(text, rendered, kind = CORE_KIND)`.
- (2) blockState gained one safeguard: an end marker counts only if no begin marker of any kind comes before it. A block missing its end now reads malformed instead of swallowing the next block, which matters for s2's rulesFileStep. Files with only the core block behave exactly as before. The core render's sha256 was checked before and after the change (cd9ca675…) and is unchanged.
- (3) Manifest shape:
  - `eslint.options` is a list of `{ sample, expect }`: a representative path plus a subset of the rule's options for s4's `wired` to compare. Size has two samples (.tsx with max 150, .ts with max 40).
  - Each tag is `[cookwright <pack> <rule>]`.
  - `types.gate` carries `skipExit: 11` (disposition 30).
  - The shared ratchet entry `{ name: 'standards', run: 'npx cookwright standards --ratchet', skipExit: 11 }` is `RATCHET_CHECK` in registry.mjs, one entry however many packs are declared. Its literal is allowlisted in messages.test like init's 'npm test'.
  - Manifests are plain literals that import nothing; the registry deep-freezes them.
  - `declaredPacks` returns `{ name, manifest, off }`; the plan named only `{ name, off }`.
- (4) The section's measurement parenthesis is built from each rule's data, not written by hand (rule 5). A switched-off rule reads `- <sentence> (switched off).` and claims no measurement. section.mjs is EXEMPT in messages.test as content written into the user's repo.
- (5) The 2→3 migration puts `packs: []` after `hosts` when that key exists, otherwise at the end.
- (6) Validator lines follow the plan's form, e.g. `packs: rule "x" is not a rule of pack expo (known: strings, tokens, size, design-doc)`. Advisory rules cannot be switched off.
- (7) messages.test SCANNED gains only `src/lib/packs`. src/standards.mjs, src/audit.mjs and src/packs.mjs do not exist yet; the scan's statSync would throw on them, so their sessions add them.
- (8) package.json `files` gains `packs`.

Doc sync: none of the repo's doc-sync rules matched these paths, and every commit went through the hooks with no escape. This repo's own cookwright.json stays at version 2 and loads migrated in memory; the dogfood migration is s7. Nothing left the repo, and there is nothing for the developer to run.
