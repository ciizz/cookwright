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

## Where they are measured

- **pre-commit**, the `standards` check, per file: each staged file's count of a rule against the same file at `HEAD`. It FAILs only when a count rose in a file, naming the file, the line and the rule, so touching a legacy file without adding a violation passes. It runs as a child process capped at 60 s.
- **the gate**, `npx cookwright standards --ratchet`: each rule's count over the files the branch changed, at `HEAD` against a base: `--base <ref>`, else the remote's commit of the ref being pushed, else the base branch's upstream when `HEAD` is on it, else the merge-base with the base branch.
- **doctor**: the section is current, the contract doc is there with its doc-sync rule, every primitive or migration has an entry in it, and ESLint and the export are in place. Doctor runs no ESLint.

A line names every rule it did not measure (`strings: skipped, needs npm install --save-dev eslint-plugin-i18next`), and the findings print the pack's own message, never ESLint's text, which for a string literal would echo it.

## The command

`npx cookwright standards` with no flag prints the repo-wide count per rule at `HEAD`, the number an existing app sees first. `--staged` is what the hook runs, `--ratchet` and `--types` are the gate's. Exit 0 is measured with no rise, 10 a count rose, 11 cannot measure (one line naming why), 2 a usage error. A gate check that runs it carries `"skipExit": 11`, so exit 11 is recorded as skipped with that line, never as a failure.

`npx cookwright packs rules` prints the declared packs' doc-sync rules and gate checks as JSON, `{ "docSync": […], "gate": […] }`, for copying into an existing `cookwright.json`, which init never edits.

`npx cookwright audit args [--doc <path>[:<scope>] …]` prints the arguments of the `docs-audit` Workflow as JSON: each declared pack's contract doc with what to audit it against, then each extra doc named, a path relative to the directory holding `cookwright.json`. It refuses a pack's doc that is missing (init writes it), an extra that is not a file in the repo or is reached through a symbolic link, and a path listed twice. The `docs-audit` skill (Level 2, experimental) runs the Workflow with them on a branch of its own.

## Escapes and switches

`COOKWRIGHT_SKIP=standards git commit …` skips the check and says so; put the reason in the message. A rule switched off in `packs` (`{ "name": "expo", "rules": { "size": false } }`) is counted by no check and reads WARN on `pack.<name>.rules`; its sentence stays in the section, marked switched off. The editor still shows the ESLint rule, since the export reads no config.
