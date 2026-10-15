/* global agent, phase, parallel */
// ^ injected by the Claude Code Workflow runtime — this file is a workflow
//   script, not application code. It never runs inside the app bundle, and it
//   is written in the Workflow dialect (top-level await + top-level return in
//   a .js file): do not validate it with a raw `node --check`-style ESM parse.

export const meta = {
  name: 'docs-audit',
  description: 'Audit every repo doc against the code, fix drift, adversarially verify the fixes',
  whenToUse:
    'Periodic anti-rot backstop (CLAUDE.md "Ledger discipline"): run when docs feel stale, before major ops, or after a burst of merges/deploys happened outside agent sessions. Run on a dedicated branch with a clean tree; review the diff before merging.',
  phases: [
    { title: 'Audit & fix', detail: 'per-doc auditor-fixers (data-model, design-system, brief)' },
    {
      title: 'Verify',
      detail:
        'read-only ledger/screenshots/deployment auditors + adversarial verifiers over the settled diff',
    },
  ],
};

// Generalized from the 2026-07-02 docs-audit session. What that run caught —
// headline: migration 0073 was rebuilt from the 0034 body and silently
// reverted 0052's post-end chat gate (B-033 root cause) — is recorded in
// docs/claude-code-notes.md (the 2026-07-02 observation); the pre-restructure
// CLAUDE.md state it archived lives in
// docs/phase-closeouts/claude-md-state-archive.md. Self-discovering: agents
// derive migration counts, merge states, and component lists themselves —
// nothing here is pinned to a point-in-time repo state. The ORCHESTRATOR is
// responsible for branching + committing; agents never run git write commands.

const FIX_REPORT = {
  type: 'object',
  additionalProperties: false,
  required: ['fixed', 'simplified', 'preserved_flagged', 'unverifiable', 'notes'],
  properties: {
    fixed: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['location', 'was', 'now', 'evidence'],
        properties: {
          location: { type: 'string' },
          was: { type: 'string' },
          now: { type: 'string' },
          evidence: { type: 'string' },
        },
      },
    },
    simplified: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['location', 'what'],
        properties: { location: { type: 'string' }, what: { type: 'string' } },
      },
    },
    preserved_flagged: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['location', 'text', 'why'],
        properties: {
          location: { type: 'string' },
          text: { type: 'string' },
          why: { type: 'string' },
        },
      },
    },
    unverifiable: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
};

const ISSUES = {
  type: 'object',
  additionalProperties: false,
  required: ['issues', 'checked', 'notes'],
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'location', 'problem', 'severity', 'suggested_fix'],
        properties: {
          file: { type: 'string' },
          location: { type: 'string' },
          problem: { type: 'string' },
          severity: { type: 'string', enum: ['P1', 'P2', 'P3'] },
          suggested_fix: { type: 'string' },
        },
      },
    },
    checked: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
};

const REPO_CONTEXT = `
CONTEXT: The Leeka repo (React Native/Expo + Supabase) = the working directory you are launched in — use relative paths; never assume a specific checkout location. Discover the current state yourself — do NOT trust any doc's claim about counts or versions: count supabase/migrations/*.sql, ls src/components/, read git log for merge states, read docs/deploy-log.md for deploy state. For any DB function/policy, the numerically-LATEST "create or replace" across sorted migrations wins (the 0073-reverted-0052 lesson, B-033 — see the 2026-07-02 observation in docs/claude-code-notes.md).
`;

const FIX_COMMON =
  REPO_CONTEXT +
  `
TASK RULES — sort every claim in your assigned doc into three buckets:
1. WRONG / OUTDATED → fix it, code as source of truth, concrete evidence (file:line or migration number) required.
2. VERBOSE BUT CORRECT → simplify; remove noise/dead entries. Keep diffs minimal — never restyle accurate prose.
3. LOAD-BEARING INVARIANT → preserve VERBATIM: deploy-order rules (migrations to dev+prod BEFORE any client OTA — the E-040 pattern), the OTA fingerprint discipline, RLS posture / grants / SECURITY DEFINER notes, append-only + soft-delete conventions, migration naming, watch items, "when to update this doc" sections, changelog/audit-trail history. When unsure: KEEP + flag in preserved_flagged.
- Claims not verifiable from the repo (prod deploy state — cross-check docs/deploy-log.md first, external sign-offs, store status, device verification) → KEEP, list in unverifiable.

HARD CONSTRAINTS: edit ONLY your assigned file/section. Never touch application code, migrations, or config. NEVER run git commit/add/checkout/restore. After editing: npx prettier --check <file>, and --write it if the check fails. Your final message is consumed by an orchestrator — return the structured report only.
`;

const READ_COMMON =
  REPO_CONTEXT +
  `
YOU ARE A READ-ONLY AUDITOR: do NOT edit, create, or delete ANY file, and never run git write commands — the orchestrator applies changes itself from your findings. Report evidenced problems as issues (P1 = live factual error or lost operational fact; P2 = questionable/unsupported; P3 = nit), each with a concrete proposed edit in suggested_fix. Uncertainty goes in notes, not issues. Your final message is consumed by an orchestrator.
`;

const VERIFY_COMMON =
  REPO_CONTEXT +
  `
A docs-audit pass just edited docs in the UNCOMMITTED working tree (git diff / git status to see it; use git diff -w to skip formatting noise).
YOU ARE A VERIFIER: read-only, adversarial — assume the audit introduced at least one error and hunt for it. Report only evidenced problems (P1 = introduced factual error or lost load-bearing rule; P2 = unsupported claim; P3 = nit). Empty issues = clean. Final message is consumed by an orchestrator.
`;

phase('Audit & fix');

const [dm, ds, brief] = await parallel([
  async () => {
    const tables = await agent(
      FIX_COMMON +
        `
YOUR FILE: docs/data-model.md — YOUR SECTION: top of file through the end of "## Views" (everything BEFORE "## RPCs"; another agent owns the rest — do not touch it).
Audit every table entry (columns/types/defaults/CHECKs vs migrations AND src/types/database.generated.ts — later migrations ALTER earlier tables), RLS claims vs the LATEST policy definitions, indexes/FKs/attached triggers, and the Seeded blocks vs the actual seed files. Any table in database.generated.ts with no doc entry → add one in the doc's style.`,
      { label: 'fix:data-model tables', phase: 'Audit & fix', schema: FIX_REPORT },
    );
    const rpcs = await agent(
      FIX_COMMON +
        `
YOUR FILE: docs/data-model.md — YOUR SECTION: "## RPCs" through EOF (RPCs, Triggers, Scheduled jobs, Edge Functions deploy, Storage buckets, Relationship sketch, Migration changelog, When to update). Another agent already edited above "## RPCs" — Read FRESH, do not touch that part.
Audit every RPC entry against its LATEST definition (signatures, grants, security definer/invoker, behavior). Add entries for undocumented public functions. Verify triggers vs "create trigger" greps, scheduled jobs vs pg_cron statements + the edge-function sources, storage policies vs migrations. Migration changelog: verify a row exists for EVERY migration file, in numeric order, each one-liner matching the file; add missing rows, fix provably-wrong ones — never compress history.`,
      { label: 'fix:data-model rpcs+changelog', phase: 'Audit & fix', schema: FIX_REPORT },
    );
    return { tables, rpcs };
  },
  async () => {
    const part1 = await agent(
      FIX_COMMON +
        `
YOUR FILE: docs/design-system.md — YOUR SECTION: from the top of the file through the end of one primitive entry near the file's midpoint. Pick the boundary yourself: the LAST "### <Component>" entry that ends before the midpoint line (wc -l / 2). Do not edit anything after your boundary. REQUIRED: state your exact boundary in notes as 'BOUNDARY: everything before ### <Name>' — the next agent receives your notes verbatim and starts there.
Audit the foundations/token tables vs src/theme/*.ts (every token name + light/dark value) and each primitive entry in your range vs its src/components/<Name>.tsx (props, defaults, variants, tokens consumed, a11y). Preserve prototype-evidence + contrast-audit rationale unless provably false about the CODE.`,
      { label: 'fix:design-system part 1', phase: 'Audit & fix', schema: FIX_REPORT },
    );
    const part1Notes = JSON.stringify(
      part1 && part1.notes
        ? part1.notes
        : 'NO NOTES RETURNED - take everything after the first ### header past the midpoint line (wc -l / 2) as your section',
    );
    const part2 = await agent(
      FIX_COMMON +
        `
YOUR FILE: docs/design-system.md — YOUR SECTION: everything AFTER the boundary the previous agent declared (its notes, verbatim, follow below) — through EOF, including the Retired section and the guidance/conventions sections at the end. Read the file FRESH (the previous agent already edited its half); do not edit anything before the boundary.
Audit each entry in your range vs its component source. Then run the COVERAGE MATRIX both directions: ls src/components/*.tsx vs entries across the WHOLE doc — every file needs an entry (add missing ones, in-style, appended in your range), every entry needs a file (else move to Retired with rationale). Verify the guidance sections' factual claims vs the theme files.

PREVIOUS AGENT'S NOTES (contains the boundary): ${part1Notes}`,
      { label: 'fix:design-system part 2 + coverage', phase: 'Audit & fix', schema: FIX_REPORT },
    );
    return { part1, part2 };
  },
  () =>
    agent(
      FIX_COMMON +
        `
YOUR FILE: PROJECT_BRIEF.md — STRICTER RULES: the brief is AUTHORITATIVE on direction; never alter direction statements (scope, principles, what-NOT-to-build) — flag contradictions in preserved_flagged instead. ONLY reconciliation edits are allowed: places where the brief's description of ALREADY-SHIPPED behavior factually contradicts the code on main (verify by grepping the implementation first). §17 changelog is append-only — never rewrite old entries; if you make ANY reconciliation edit (to any section), APPEND a dated §17 entry covering all of them; zero edits → zero new entries. Bias strongly to preserve.`,
      {
        label: 'fix:project-brief (reconciliation only)',
        phase: 'Audit & fix',
        schema: FIX_REPORT,
      },
    ),
]);

// Barrier is genuine: the verify/audit wave needs the COMPLETE, settled diff
// from all fixers (the read-only auditors also grep docs the fixers rewrite).
phase('Verify');

const [claudeMd, shots, vDm, vDs, vBrief, vInvariants] = await parallel([
  () =>
    agent(
      READ_COMMON +
        `
TARGET: CLAUDE.md (the tree is settled — fixers are done).
Verify: (1) the "Current state" status line + every Watch item — still true? (git/deploy-log/closeouts as evidence; externally-only-verifiable items → notes, as unverifiable-keep). (2) State-home discipline: CLAUDE.md must hold NO task lists — tasks belong in docs/backlog.md, queued deploys in docs/deploy-log.md "Next deploy", microcopy is decided in-session with Cesar (the queue doc was deleted 2026-07-23 — flag any doc that still points at it), submission checks in docs/submission/review-notes.md; flag any stray task/pending accumulation in CLAUDE.md AND any deploy-log "Next deploy" item whose Ledger row already landed. NOTE: the orchestrator is slimming CLAUDE.md CONCURRENTLY with this run (state sections compressed to verified facts; long-form history entries moved verbatim into docs/phase-closeouts/claude-md-state-archive.md) — audit the file as it is in the tree when you read it, and report anything stale or contradicting git / deploy-log / the migrations dir. (3) The history index vs git log — any merged MAJOR milestone missing its line? Any entry whose linked closeout is missing? (4) Ledger-discipline sweep: grep docs/ for stray live "pending/awaiting/is next" status language in active docs — dated artifacts (strategy plans, audits, closeouts, backlog history, brief §17) are exempt IF they carry a date or snapshot banner; flag exempt-class docs missing their banner.`,
      { label: 'audit:CLAUDE.md ledger (read-only)', phase: 'Verify', schema: ISSUES },
    ),
  () =>
    agent(
      READ_COMMON +
        `
TARGET: docs/screenshots/ + docs/deploy-log.md + docs/deployment.md.
Screenshots: for every dir, check it has a docs/screenshots/README.md index row and whether the depicted UI is still current (git log the feature surfaces since the dir's last commit); report stale dirs, unindexed dirs, and index rows whose dir is gone. Deploy log: check the Ledger table's rows are chronologically ordered and well-formed, and whether the Baseline section is contradicted by newer rows (if so, propose a baseline correction). deployment.md: does its snapshot banner still describe the table's staleness accurately, and do the runbooks still match the scripts they document (scripts/safe-deploy.sh, ota-publish.mjs)?`,
      {
        label: 'audit:screenshots+deploy-log+deployment (read-only)',
        phase: 'Verify',
        schema: ISSUES,
      },
    ),
  () =>
    agent(
      VERIFY_COMMON +
        `TARGET: the diff of docs/data-model.md. Re-derive every content-bearing hunk against migrations / database.generated.ts / seed files / edge functions. Spot-check 10+ random changelog rows against their migration files; verify every changed RPC/trigger/policy claim against the LATEST definition.`,
      { label: 'verify:data-model', phase: 'Verify', schema: ISSUES },
    ),
  () =>
    agent(
      VERIFY_COMMON +
        `TARGET: the diff of docs/design-system.md. Re-derive every changed token list / prop / variant claim line-level against src/components/ and src/theme/. Confirm the coverage matrix really closes 1:1 both directions, that the two-part split left no unaudited seam (compare both fixers' declared ranges against the diff), and that no contrast-audit / prototype-evidence / convention block was deleted.`,
      { label: 'verify:design-system', phase: 'Verify', schema: ISSUES },
    ),
  () =>
    agent(
      VERIFY_COMMON +
        `TARGET: the diff of PROJECT_BRIEF.md. Confirm every change is a factual reconciliation of shipped behavior (verify each against the code), all pre-existing §17 entries are byte-identical, and NO direction statement changed meaning (any direction-meaning change is a P1). §17 accounting: a non-empty diff must include dated new §17 entr(y/ies) covering the reconciliations; an empty diff must include none.`,
      { label: 'verify:brief', phase: 'Verify', schema: ISSUES },
    ),
  () =>
    agent(
      VERIFY_COMMON +
        `TARGET: invariant preservation across the WHOLE diff. Walk every deleted content line (git diff -U0 | grep '^-'), match to replacements, and classify; any lost operational/load-bearing content is a P1. Then positively grep that these still exist: every deploy-order sentence, the OTA-fingerprint section, all watch items + their SQL, RLS-posture conventions, migration-naming rules, "when to update" sections, and (in the brief) §11 what-NOT-to-build untouched.`,
      { label: 'verify:invariants', phase: 'Verify', schema: ISSUES },
    ),
]);

return {
  audit: { dataModel: dm, designSystem: ds, brief },
  readOnlyAudits: { claudeMdLedger: claudeMd, shotsDeployLogDeployment: shots },
  verify: { dataModel: vDm, designSystem: vDs, brief: vBrief, invariants: vInvariants },
};
