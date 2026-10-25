# implement:s7 — session report

_Stored as the session returned it; the orchestrator verifies before relying on it._

## Commits
- `7af8617 docs(guides): the standards guide completed; getting-started, hooks and updating for the stack packs`
- `1d4f77e docs(readme): standards for your stack, each one measured; AGENTS.md Layout names packs/`
- `c5de2b3 chore(config): this repo at config version 3, the setup doc-sync rule covering the packs`
- `1969746 docs(backlog): stage 4 closes E-039, E-003 (narrowed), B-011, B-012, B-013; opens E-044 to E-050`

## Files
- `docs/guides/standards.md`
- `docs/guides/getting-started.md`
- `docs/guides/hooks-and-escapes.md`
- `docs/guides/updating.md`
- `README.md`
- `AGENTS.md`
- `cookwright.json`
- `.claude/skills/docs-audit`
- `docs/dev/backlog.md`

## User-facing strings
none

## Open questions
- getting-started's numbered walkthrough (steps 2 to 4) still holds the dated cookwright 0.1.0 transcripts of 2026-10-22. They are labelled with their version, and the prose names where the current tree differs: 19 checks, not verified, and in the current tree init also writes the docs-audit pointer, 16 steps. Should the whole transcript be refreshed from a fresh run at release time, or left as the dated 0.1.0 record?
- README's status table says the stack packs and the docs-audit skill are 'not in 0.1.0'. That stays true after a release, but the row should then name the version that ships them. Release-time edit for the developer or the document-release pass.
- `git ls-files -- <path> ':!*.test.mjs'` lists nothing on this git version (2.52.0), while `git diff` and `git log` honour the same pathspecs. The doc-sync hook uses `git diff --cached`, so the hook is unaffected. Only an ls-files caller using an exclude magic would be, and none exists today. Logged here, not in the backlog, since nothing in the package is affected.

## Notes
s7 is done and committed in four checkpoints, each staging named paths only. The hooks ran on every commit (core.hooksPath is .githooks; secrets PASS, doc-sync PASS, standards SKIP 'no packs declared').

1. Guides. docs/guides/standards.md now covers:
   - the three tiers and the tripwire's blind spot
   - the overridden-options reading and 'not wired'
   - the gate's recorded first line, and skipExit and exit 11
   - the types measure: its one script shape (`--local` required), the change condition, the local-stack precheck, and that it measures only the local stack
   - the contract docs: how primitives and migrations are counted, and fill then audit

   Getting-started:
   - adds an 'An Expo app: the stack packs' section: `npx expo lint`, `supabase init` and eslint-plugin-i18next before init, with init's pack rows and doctor's pack rows quoted from the fixture run of 2026-10-25 (28 checks: 27 PASS, 1 WARN pack.supabase.types)
   - the doctor paragraph now says four rows per pack plus pack.supabase.types (it said three)

   Hooks-and-escapes:
   - adds a standards subsection with the fixture's real FAIL output and the 60 s cap
   - adds `standards` to the COOKWRIGHT_SKIP list
   - adds the skipExit note and the ratchet's push base

   Updating:
   - adds a 'Version 3: the stack packs' section with this repo's real `migrate --dry-run` output
   - explains how a pack is added after migrate (setup skill, then init, then `packs rules`)

2. README and AGENTS.md. README:
   - adds the 'Standards for your stack, each one measured' bullet
   - doctor count corrected to '19 checks, plus four for each stack pack (five for Supabase)'
   - quick-start readout re-measured on a scratch repo: 16 steps, 19 checks, 19 PASS, complete
   - an Expo pointer, a Standards guide link and two status rows

   AGENTS.md Layout names packages/cookwright/packs/<name>/ and the docs-audit skill, and says src/test-fixtures/ is not shipped.

3. Dogfood (plan §7):
   - `npx cookwright migrate` wrote version 3 with `packs: []`. It rewrote the file in standard layout, so the inline `ci` object was expanded.
   - The `setup` doc-sync rule gained `packages/cookwright/packs/**` and `packages/cookwright/src/lib/packs/*`, tied to docs/guides/*.md, plus `:!*.test.mjs`. That exclusion goes beyond plan §7.4, which named only the two paths. It mirrors the `playbook` rule and stops a test-only change from requiring a guide edit. I verified with `git diff` over the bundle's range that the specs match the packs and the src/lib/packs modules and leave out the tests.
   - `npx cookwright init` wrote `.claude/skills/docs-audit` and kept everything else. Doctor: 19 checks, 19 PASS, level 0 declared: complete.

4. Backlog:
   - Closed, each with a one-line note: E-039; E-003, narrowed, with the rest in the already-open E-041; B-011 and B-013, each with a scratch-repo measurement from 2026-10-25; B-012.
   - Opened E-044 to E-050: the whole-repo ratchet, the pattern-promotion loop, a per-rule limits override, an audit scheduler, Windows paths of the ESLint export, a count row, a docs-audit generate mode.
   - Doctor reads 66 ids, each once.

   `npm pack --dry-run` lists 92 files: packs/expo and packs/supabase (pack.mjs, eslint.cjs, templates) are in; src/test-fixtures/ and fake-eslint are not. package.json `files` already included `packs` and excluded `src/test-fixtures/**` before this session, so it was not changed.

Measured this session (not carried):
- `npm test`: 26 files, 730 of 730 passed, 93.5 s.
- `bash scripts/ci/fixture.sh`: PASS, run locally on Node 20 with KEEP=1, its tree in the scratchpad.

No code or user-facing code strings changed, so `strings` is empty. Nothing that leaves the repo was run. Publishing the packs is the developer's step, after the bundle closes and the version is bumped: `cd packages/cookwright && npm publish`.
