# Stage 4 kickoff — the first stack pack: standards with their measurements

Written 2026-10-23, decisions taken 2026-10-25. The first prompt for a fresh session opened in this directory: read `CHARTER.md` (the 2026-10-23 amendment), `AGENTS.md`, `CLAUDE.local.md`, `docs/playbook.md` and `docs/dev/closeouts/stage-3.md`, then enter plan mode. It runs as a bundle through the runner.

## Goal

A developer with an Expo app on Supabase declares a pack in `cookwright.json` and gets the engineering rules cookwright stands for, each one enforced: the sentence in `AGENTS.md`, and the check that measures it. On a new app the rules hold from the first commit. On an existing app nothing the developer did not touch blocks them, and the gate tells them when the repo got worse.

The product sentence this delivers: "detects when your development process drifts", applied to code.

## What stage 4 decides and what it builds

### The pack model (charter, 2026-10-23)

- `packs` in `cookwright.json`, an array of names. Init, doctor and the hooks iterate over it as they iterate over `hosts`.
- One directory per pack in the package, `packages/cookwright/packs/<name>/`, holding what the pack contributes: a rules section for `AGENTS.md`, a lint config, default doc-sync rules, doctor checks, gate checks, doc templates. Nothing outside the package; no plugin API; the one version number.
- Packs are orthogonal to levels. Doctor reports a pack under its own row group, `pack.<name>.*`.
- **Decided 2026-10-25: two packs, `expo` and `supabase`.** An Expo app on another backend takes one, a Supabase app on the web takes the other. The one cross rule (the client import) lives in `supabase`.

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

**Decided 2026-10-25: the ratchet is scoped to the files the branch changed**, cheap, storage-free, judging the change. The whole-repo count on both sides (a worktree per sha, E-024) is not built; the repo-wide number is doctor's `count` row, measured on the checked-out tree.

### Doc contracts

Two templates the pack ships, written by init when absent: `docs/design-system.md` and `docs/data-model.md`, each a header stating what it is the contract for and an empty table in the shape the doc-sync rule expects. On an existing app the setup skill offers to have the agent fill them from the code (the docs-audit workflow's generate mode, if it has one; otherwise a one-off session), and the doc-sync rules are written at the same time (E-039).

### Three tiers of checking, and where each rule drifts

Every enforced rule is measured on every commit (tier 1, the lint; tier 2, the doc-sync tripwire). The tripwire measures that the doc moved with the code, not that it is true: a doc edited wrongly, or edited with a space to get past the hook, passes. That blind spot is stated in the standards guide and covered by the third tier.

**Tier 3, the semantic audit, on a schedule.** The docs-audit workflow the package ships (`hosts/claude/workflows/docs-audit.js`, pointed at by init) reads each doc, sorts every claim against the code, fixes what is wrong and has a second set of agents verify each fix adversarially. Stage 4 gives it its arguments: each pack declares the docs it owns and the audit scope of each (`docs/design-system.md`: every primitive entry against `src/components`; `docs/data-model.md`: every table and RPC entry against the migrations), so the audit runs from the config, never from a prompt someone types. The runner, or the setup skill, offers it when the developer asks or before a release; it runs on a branch the developer reviews, with its cost on the closeout line, never on `main` and never silently.

**The audit is objective by construction, or it is not run:**

- A finding is a contradiction, never an opinion. The doc names a prop the code does not have: drift. The doc could be clearer, is incomplete, uses an old word: not a finding. The workflow's three buckets (wrong, unverifiable, kept) already hold this; a "wrong" needs a file-and-line in the code as evidence.
- Evidence or it did not happen. Each fix carries where, was, now and evidence, and a separate verifier rejects any fix it cannot reproduce. A deployed state, a store status, a device check are kept and listed as unverifiable, never touched.
- Omissions are measured mechanically, not by an agent. "Every component has a doc entry" is a list comparison, files under `src/components` against headings in the doc; "every migration has a changelog row" likewise. Those are doctor rows (`pack.<name>.docs`), deterministic. The agent judges only the truth of an entry that exists.
- Calibrated on a clean repo. In CI the audit runs on the fixture right after init, where the docs are the templates and the code is the scaffold, and the expected finding count is zero. An audit that reports drift there is the bug, and the test fails.

**The advisory rules are checked at review time, not periodically.** Components first, the design-system doc as contract, reuse before build need a human-sized diff and a judgment. The pack puts them into the bundle runner's review prompt, so each `review:*` phase looks for a new visual where a primitive existed, or a primitive reinterpreted where one was documented, and a finding carries the file and the existing primitive as evidence. Outside the runner they are what they say: advisory.

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
6. The doctor rows, the mechanical omission rows among them.
7. The semantic audit wired to the packs: each pack declares its docs and their audit scope, the docs-audit workflow takes them from the config, the clean-repo calibration run in CI with an expected zero, and the advisory rules in the runner's review prompt.
8. B-012 (gate with no checks reads WARN) and B-013 (the summary says "complete" only when every check measured), both small and both in doctor's path.
9. Measured on three repos: the fixture (a fresh Expo scaffold, in CI), a fresh Expo app with `supabase init` as the new-app proof, and Leeka read-only as the existing-app proof: the count rows on Leeka's checkout, the ratchet against a synthetic branch, no write to Leeka.
10. Guides: a `standards` guide (the rules, the three tiers and the tripwire's blind spot, the escape, the ratchet, switching a rule off, running the audit), getting-started updated for a pack, the README's "What you get" gaining its line.
11. Closeout `docs/dev/closeouts/stage-4.md`, with the five numbers.

## Out of scope

Secrets backends (stage 5). The atlas and the SQL suites (Level 1). The pattern-promotion loop (observations → patterns → a rule proposed to the developer), which belongs in the core block, not a pack: backlog. B-011 (init's `.gitignore` and a doctor check on a tracked `node_modules`): small enough to ride along if the plan finds it free, otherwise it stays open. Any third-party pack mechanism. A scheduler for the audit: the developer or the runner starts it; a cron is a later wish.

## Decisions taken 2026-10-25

1. Two packs, `expo` and `supabase`.
2. The ratchet compares the files the branch changed.
3. `eslint-plugin-i18next` is accepted as the `expo` pack's dependency. Rule 9 keeps the core package free of runtime dependencies, so the plugin is not a dependency of `cookwright` itself: init installs it into the user's repo as a devDependency when the `expo` pack is declared, with consent, the way it names `gitleaks`; absent, the string rule reads SKIP with the install line, never FAIL. A pack may carry dependencies this way; the core may not.

## Standard

Plan mode first, a written plan, adversarial review of the plan (P1 and P2 findings only; P3 goes to the plan's residue list), implementation, review of the diff per slice, QA on the three repos, closeout. Every disposition cites a judgment rule by number. The three decisions above are taken; nothing needs the developer until the plan review.
