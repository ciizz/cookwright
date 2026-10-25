# Standards: the stack packs

A stack pack ships each engineering rule as a pair: the sentence in a managed section of `AGENTS.md`, which the agent reads, and the check that measures it. A rule no check can measure is advisory, listed apart under its own heading. Two packs ship, `expo` and `supabase`, declared in `packs` in `cookwright.json`. A fresh `npx cookwright init` declares the ones the tree shows; an existing config never gets a pack from init or migrate, and doctor's `packs` row WARNs a stack the tree shows with no pack declared, which the setup skill then offers.

```json
"packs": ["expo", { "name": "supabase", "rules": { "types": false } }]
```

## The rules and what measures them

| pack | rule | measured by |
|---|---|---|
| expo | `strings` | ESLint `i18next/no-literal-string` (needs `eslint-plugin-i18next`) |
| expo | `tokens` | ESLint `no-restricted-syntax`, the pack's own selectors |
| expo | `size` | ESLint `max-lines-per-function`: 150 in a `.tsx` or `.jsx` file, 40 in a `.ts` or `.js` file |
| expo | `design-doc` | the doc-sync rule `expo:design-doc`: a component change stages `docs/design-system.md` |
| supabase | `client` | ESLint `no-restricted-imports` on `@supabase/supabase-js` outside the shared service |
| supabase | `data-doc` | the doc-sync rule `supabase:data-doc`: a migration stages `docs/data-model.md` |
| supabase | `types` | the gate check `standards:types` |

The expo pack's advisory rules (components first, the design-system doc as the visual contract, reuse before build) have no check; the bundle runner's red-team reviewer reads each diff against them, naming the existing primitive or doc entry a change passed over.

The ESLint rules reach ESLint through the pack's export, spread into the app's own `eslint.config.js`: init adds `...require('cookwright/packs/expo/eslint.cjs'),` (and the supabase line) after `expoConfig,` when the file is Expo's template, and names the lines to add by hand otherwise; doctor's `pack.<name>.lint` WARNs until the config names them.

## Three tiers, and the tripwire's blind spot

1. **The lint**, on every commit and every push: the ESLint rules, counted by the `standards` check and the gate's ratchet.
2. **The doc-sync tripwire**, on every commit: a change to the code a contract doc covers stages that doc too. The tripwire measures that the doc moved with the code, not that it is true: a doc edited wrongly, or touched with a space to get past the hook, passes. Doctor's `pack.<name>.docs` adds the mechanical half, a list comparison of the files against the doc's first column, so a primitive or migration with no entry at all is counted.
3. **The semantic audit**, when you start it (before a release, after a burst of merges made outside agent sessions): the `docs-audit` Workflow reads each contract doc against the code, fixes what the code contradicts, and has a second agent verify each fix. It covers what the tripwire cannot see, an entry that exists but is wrong. Nothing schedules it.

## Where they are measured

- **pre-commit**, the `standards` check, per file: each staged file's count of a rule against the same file at `HEAD`. It FAILs only when a count rose in a file, naming the file, the line and the rule, so touching a legacy file without adding a violation passes. It runs as a child process capped at 60 s.
- **the gate**, `npx cookwright standards --ratchet`: each rule's count over the files the branch changed, at `HEAD` against a base: `--base <ref>`, else the remote's commit of the ref being pushed, else the base branch's upstream when `HEAD` is on it, else the merge-base with the base branch.
- **doctor**: the section is current, the contract doc is there with its doc-sync rule, every primitive or migration has an entry in it, and ESLint and the export are in place. Doctor runs no ESLint.

A line names every rule it did not measure (`strings: skipped, needs npm install --save-dev eslint-plugin-i18next`), and the findings print the pack's own message, never ESLint's text, which for a string literal would echo it.

Before counting, the check asks ESLint for the effective config of a file each rule covers and compares the options with the pack's: severity `error`, the 150 and 40 limits, the strings rule's `mode: 'jsx-only'`, and the pack's own tagged message in `no-restricted-syntax` and `no-restricted-imports`. A rule whose options differ reads `overridden by a later block in the ESLint config` and is skipped on the line, never counted as measured: a later block of yours that sets the same ESLint rule replaces the pack's options, and for `no-restricted-imports` on the same files a block of your own replaces the pack's `@supabase/supabase-js` restriction. A rule the config does not reach at all reads `not wired (the ESLint config does not spread …)`.

## The command

`npx cookwright standards` with no flag prints the repo-wide count per rule at `HEAD`, the number an existing app sees first. `--staged` is what the hook runs, `--ratchet` and `--types` are the gate's. Exit 0 is measured with no rise, 10 a count rose, 11 cannot measure (one line naming why), 2 a usage error. A gate check that runs it carries `"skipExit": 11`, so exit 11 is recorded as skipped with that line, never as a failure.

The ratchet's first line is what the gate records with the result, `expo strings 412 → 410, tokens 3 → 3; <rules not measured> (14 file(s) since <base>)`, and the bundle runner's landing check reads a pass whose line names a skipped rule as weak. Exit 11 is recorded as skipped only by a gate check that opts in with `skipExit`; a check without it that exits 11 is a failure. The pre-commit check reads its own child's exit 11 as SKIP.

## The types measure

`npx cookwright standards --types`, the gate check `standards:types` of the supabase pack, compares the tracked database types with what the local stack generates. It reads one script shape only, `"db:types": "supabase gen types --local > <path>"` (other arguments may sit before the redirect, `--local` among them; nothing after the target: no `&&`, `|`, `;`, quote, second redirect or `npx` prefix), since it runs the same generation itself. It measures only when a migration or the types file changed since the base (the ratchet's), and only when the local stack has applied exactly `HEAD`'s migrations (`supabase migration list --local`), so a migration applied for another branch never fails this one. Then it compares the generation's output with the types file at `HEAD`, writing nothing: a difference is exit 10 naming `npm run db:types`, every reason it cannot measure an exit-11 skip naming it. Its line says it measured the local stack, never the remote one. Doctor's `pack.supabase.types` checks the CLI, the script's shape and the gate entry, and runs nothing.

## The contract docs

init writes `docs/design-system.md` (expo) and `docs/data-model.md` (supabase) when absent, each a header and an empty table whose first column is the key: a primitive's name, a migration's file name. Doctor counts the primitives (each `.tsx` or `.jsx` file directly under `src/components/` or `components/`, and each directory there with an `index.tsx` or `index.jsx`; tests, stories, styles, types and `index` at the top excluded) and the migrations (`supabase/migrations/<14 digits>_<name>.sql`) and names those with no row. On an existing app the setup skill offers to fill the doc from the code, on a branch of its own, then to verify the fill with the `docs-audit` skill.

`npx cookwright packs rules` prints the declared packs' doc-sync rules and gate checks as JSON, `{ "docSync": […], "gate": […] }`, for copying into an existing `cookwright.json`, which init never edits.

`npx cookwright audit args [--doc <path>[:<scope>] …]` prints the arguments of the `docs-audit` Workflow as JSON: each declared pack's contract doc with what to audit it against, then each extra doc named, given relative to the directory holding `cookwright.json`. Every printed path is relative to the work tree's top, where the Workflow resolves it, so a `cookwright.json` below the top works from any directory. It refuses a pack's doc that is missing (init writes it), an extra that is not a file in the repo or is reached through a symbolic link, and one file named twice, whether by the same path, a case alias or a hard link. The `docs-audit` skill (Level 2, experimental) runs the Workflow with them on a branch of its own.

## Escapes and switches

`COOKWRIGHT_SKIP=standards git commit …` skips the check and says so; put the reason in the message. A rule switched off in `packs` (`{ "name": "expo", "rules": { "size": false } }`) is counted by no check and reads WARN on `pack.<name>.rules`; its sentence stays in the section, marked switched off. The editor still shows the ESLint rule, since the export reads no config.
