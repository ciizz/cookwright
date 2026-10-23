# Stage 4 kickoff — the first stack pack: standards with their measurements

Draft 2026-10-23, for the developer's review before it opens a session. When approved: read `CHARTER.md` (the 2026-10-23 amendment), `AGENTS.md`, `CLAUDE.local.md`, `docs/playbook.md` and `docs/dev/closeouts/stage-3.md`, then enter plan mode. It runs as a bundle through the runner.

## Goal

A developer with an Expo app on Supabase declares a pack in `cookwright.json` and gets the engineering rules cookwright stands for, each one enforced: the sentence in `AGENTS.md`, and the check that measures it. On a new app the rules hold from the first commit. On an existing app nothing the developer did not touch blocks them, and the gate tells them when the repo got worse.

The product sentence this delivers: "detects when your development process drifts", applied to code.

## What stage 4 decides and what it builds

### The pack model (charter, 2026-10-23)

- `packs` in `cookwright.json`, an array of names. Init, doctor and the hooks iterate over it as they iterate over `hosts`.
- One directory per pack in the package, `packages/cookwright/packs/<name>/`, holding what the pack contributes: a rules section for `AGENTS.md`, a lint config, default doc-sync rules, doctor checks, gate checks, doc templates. Nothing outside the package; no plugin API; the one version number.
- Packs are orthogonal to levels. Doctor reports a pack under its own row group, `pack.<name>.*`.
- **Open decision 1:** one pack `expo-supabase`, or two, `expo` and `supabase`. The rules below are partitioned either way; two directories cost nothing now and a rename migration later.

### The rule about rules

A rule ships as a pair: the sentence and its measurement. A rule with no measurement is listed under an **Advisory** heading in the pack's section of `AGENTS.md`, apart from the enforced ones, so the agent and the developer both know which rules are wishes. The table is the spec; the plan may move a row between enforced and advisory only by naming what makes the measurement impossible.

| Rule (the sentence in AGENTS.md) | Pack | Measured by | Runs in | Needs |
|---|---|---|---|---|
| User-facing strings go through `t()`; no literal string in JSX | expo | ESLint `i18next/no-literal-string`, markup only, test files exempt | pre-commit (staged), gate (ratchet) | `eslint-plugin-i18next`: a dependency, asked for first (rule 9); SKIP with the install line when absent |
| No colour literal (hex, rgb, hsl) and no numeric spacing literal in a component; tokens only, the palette file exempt | expo | ESLint `no-restricted-syntax` selectors over `Literal` nodes, config only | pre-commit, gate | nothing beyond ESLint |
| Functions under 40 lines, components under 150 | expo | ESLint `max-lines-per-function` and `max-lines` with the limits in the pack config | pre-commit, gate | nothing. Note: Leeka states this rule and does not enforce it; the pack does |
| A component changes with the design-system doc | expo | doc-sync rule `src/components/**` → `docs/design-system.md` (through E-039's path) | pre-commit | the doc exists (template below) |
| The Supabase client is imported only from the shared service, never from `@supabase/supabase-js` in a screen, component or feature file | supabase | ESLint `no-restricted-imports`, config only | pre-commit, gate | nothing |
| A migration changes with the data-model doc | supabase | doc-sync rule `supabase/migrations/**` → `docs/data-model.md` | pre-commit | the doc exists |
| Generated database types match the schema | supabase | gate check: regenerate to a temp file and diff against the tracked file | gate | the Supabase CLI and a local stack; SKIP with the reason when absent |
| Components first: a recurring visual pattern is a primitive in `src/components` before the screen that uses it | expo | none | — | **advisory** |
| The design-system doc is the visual contract; a new surface composes existing primitives | expo | none (the doc-sync rule measures that the doc moved, not that it was obeyed) | — | **advisory** |
| Reuse before build: grep for an existing rendering of the concept first | expo | none | — | **advisory** |

Rules that are Leeka's alone (tracking through `track()`, the bounded-container rule, the Meta SDK import ban) do not ship. The pack is opinionated about the stack, not about one app.

### Hooks judge the change

A new pre-commit check, `standards`, runs the repo's own ESLint with the pack's config over the **staged files only**, the way `doc-sync` reads the staged diff. A file the developer did not touch never fails a commit (rule 1's sentence: only a finding in the user's own change fails a hook). FAIL names the file, the rule and the line; the escape is `COOKWRIGHT_SKIP=standards` with the reason in the message (rule 8). ESLint missing, or the pack's config not wired in: SKIP with the line that fixes it.

The lint config is **imported, never copied** (rule 4): the package exports it (`cookwright/packs/expo/eslint`), and the repo's `eslint.config.js` gains one line that spreads it. Init writes that line with consent when the file is the Expo scaffold's; otherwise it names the line and doctor reads "pack config not wired" as WARN until it is.

### The gate ratchets

A new gate check, `standards`, measures whether the repo got worse. It stores nothing (rule 5). For the files changed between the base branch and HEAD, it lints both versions (the base version materialised from `git show`, never a checkout) and compares violation counts per rule. A rise is drift, FAIL, with the rules and files that rose. A standing count or a fall is PASS with the number on the line. An existing app with four hundred violations therefore passes its first push and fails the first push that adds a four-hundred-and-first.

**Open decision 2:** the ratchet is scoped to changed files (cheap, storage-free, judges the change) rather than the whole repo on both sides (true repo count, needs a worktree per sha, E-024). The plan should cost both; the spec prefers the first.

### Doc contracts

Two templates the pack ships, written by init when absent: `docs/design-system.md` and `docs/data-model.md`, each a header stating what it is the contract for and an empty table in the shape the doc-sync rule expects. On an existing app the setup skill offers to have the agent fill them from the code (the docs-audit workflow's generate mode, if it has one; otherwise a one-off session), and the doc-sync rules are written at the same time (E-039).

### Doctor

New rows, all under `pack.<name>.`:

- `pack.<name>.declared` — the pack is declared and the package knows it.
- `pack.<name>.rules` — the pack's section is current in `AGENTS.md` (as `rules.block` reads the core block).
- `pack.<name>.lint` — ESLint present and the pack config wired in; otherwise WARN with the line.
- `pack.<name>.docs` — the contract docs exist and the doc-sync rules point at them.
- `pack.<name>.count` — the repo's current violation count per rule, measured, PASS with the number; this is the row the ratchet makes bearable on an existing app. If measuring takes longer than doctor's budget allows, the row reads SKIP with the gate named as where it is measured.
- `pack.supabase.types` — the CLI present; otherwise SKIP.

Every row follows the judgment rules: a state the developer chose (a rule switched off in the pack config) is WARN with the reason; a FAIL the developer cannot clear is a bug.

### Init on a new app, init on an existing app

New app (the Expo scaffold, `supabase init` run): init writes the pack section into `AGENTS.md`, the one line into `eslint.config.js`, the two doc templates, the two doc-sync rules, and reports each as it reports every step today. Doctor reaches all PASS, the count rows at zero.

Existing app: init writes the same, except that it never overwrites a doc that exists and asks before touching an `eslint.config.js` that is not the scaffold's. Doctor reports the counts and the two docs as whatever they are. The first push passes if nothing rose. Nothing in the existing code blocks a commit.

### Switching a rule off

`packs` entries may be objects: `{ "name": "expo", "rules": { "max-lines": false } }`. A rule switched off is a chosen state: doctor's `rules` row reads WARN naming it, the sentence stays in `AGENTS.md` marked as switched off, and the measurement does not run. This is the only per-rule configuration; limits (40, 150) are the pack's and change with its version.

## Scope

1. The pack model: the config key, the directory convention, the iteration in init, doctor and the hooks, the schema, the config migration (version 3).
2. The `expo` and `supabase` rules above, as a pack section in `AGENTS.md` generated from the package, and the exported ESLint config(s).
3. The pre-commit `standards` check over staged files.
4. The gate `standards` ratchet.
5. The doc templates, the default doc-sync rules, and E-039 (the setup skill proposes and writes doc-sync rules with consent), since the pack's defaults travel that path.
6. The doctor rows.
7. B-012 (gate with no checks reads WARN) and B-013 (the summary says "complete" only when every check measured), both small and both in doctor's path.
8. Measured on three repos: the fixture (a fresh Expo scaffold, in CI), a fresh Expo app with `supabase init` as the new-app proof, and Leeka read-only as the existing-app proof: the count rows on Leeka's checkout, the ratchet against a synthetic branch, no write to Leeka.
9. Guides: a `standards` guide (the rules, the escape, the ratchet, switching a rule off), getting-started updated for a pack, the README's "What you get" gaining its line.
10. Closeout `docs/dev/closeouts/stage-4.md`, with the five numbers.

## Out of scope

Secrets backends (stage 5). The atlas and the SQL suites (Level 1). The pattern-promotion loop (observations → patterns → a rule proposed to the developer), which belongs in the core block, not a pack: backlog. B-011 (init's `.gitignore` and a doctor check on a tracked `node_modules`): small enough to ride along if the plan finds it free, otherwise it stays open. Any third-party pack mechanism.

## Open decisions for the developer, before plan mode

1. One pack or two (above).
2. The ratchet's scope (above).
3. Whether `eslint-plugin-i18next` is accepted as the pack's one dependency, or the string rule ships advisory until a dependency-free measurement exists. Rule 9 says ask; this is the asking.

## Standard

Plan mode first, a written plan, adversarial review of the plan (P1 and P2 findings only; P3 goes to the plan's residue list), implementation, review of the diff per slice, QA on the three repos, closeout. Every disposition cites a judgment rule by number. The developer answers the three open decisions before the plan is written; nothing else needs him until the plan review.
