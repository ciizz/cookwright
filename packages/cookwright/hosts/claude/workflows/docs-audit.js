/* global agent, phase, parallel, args */
// ^ injected by the Claude Code Workflow runtime — this file is a workflow
//   script, not application code. It never runs inside an app bundle, and it
//   is written in the Workflow dialect (top-level await + top-level return in
//   a .js file): do not validate it with a raw `node --check`-style ESM parse.

export const meta = {
  name: 'docs-audit',
  description: 'Audit the named docs against the code, fix drift, adversarially verify the fixes',
  whenToUse:
    'Periodic anti-rot backstop: run when docs feel stale, before a release, or after a burst of merges happened outside agent sessions. Run on a dedicated branch with a clean tree; review the diff before merging.',
  phases: [
    { title: 'Audit & fix', detail: 'one auditor-fixer per doc, each owning only its file' },
    {
      title: 'Verify',
      detail: 'one adversarial verifier per doc diff, plus an invariants verifier over the whole diff',
    },
  ],
};

// Which docs to audit is the caller's call, as args:
//
//   {
//     docs: [
//       { path: 'docs/data-model.md',
//         scope: 'every table entry against the migrations',       // what to audit
//         rules: 'the changelog section is append-only' },           // optional, per doc
//       …
//     ],
//     invariants: ['every deploy-order sentence', 'the secrets policy'],  // optional
//   }
//
// Self-discovering: agents derive counts, versions and lists from the repo
// themselves — nothing here is pinned to a point-in-time state. The ORCHESTRATOR
// owns branching and committing; agents never run git write commands.

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

if (!Array.isArray(args?.docs) || args.docs.length === 0 || args.docs.some((d) => !d?.path)) {
  throw new Error('docs-audit needs args.docs: [{ path, scope, rules? }, …] (see the header of this script)');
}
const DOCS = args.docs;
const INVARIANTS = Array.isArray(args.invariants) ? args.invariants : [];

const REPO_CONTEXT = `
CONTEXT: the repo is the working directory you are launched in — use relative paths; never assume a checkout location. Discover the current state yourself and do NOT trust any doc's claim about counts, versions or what is merged: count the files, read the code, read git log. If the repo has a rules file (CLAUDE.md or AGENTS.md), its rules apply to you.
`;

const FIX_COMMON =
  REPO_CONTEXT +
  `
TASK RULES — sort every claim in your assigned doc into three buckets:
1. WRONG / OUTDATED → fix it, code as source of truth, concrete evidence (file:line) required.
2. VERBOSE BUT CORRECT → simplify; remove noise and dead entries. Keep diffs minimal — never restyle accurate prose, never reformat the file.
3. LOAD-BEARING INVARIANT → preserve VERBATIM: ordering rules, security posture, conventions, "when to update this doc" sections, changelog and history entries. When unsure: KEEP + flag in preserved_flagged.
- Claims not verifiable from the repo (a deployed state, an external sign-off, a store status, a device check) → KEEP, list in unverifiable.

HARD CONSTRAINTS: edit ONLY your assigned file. Never touch code, migrations or config. NEVER run git commit/add/checkout/restore. Your final message is consumed by an orchestrator — return the structured report only.
`;

const VERIFY_COMMON =
  REPO_CONTEXT +
  `
A docs-audit pass just edited docs in the UNCOMMITTED working tree (git diff / git status to see it; use git diff -w to skip whitespace noise).
YOU ARE A VERIFIER: read-only, adversarial — assume the audit introduced at least one error and hunt for it. Report only evidenced problems (P1 = introduced factual error or lost load-bearing rule; P2 = unsupported claim; P3 = nit), each with a concrete proposed edit in suggested_fix. Empty issues = clean. Final message is consumed by an orchestrator.
`;

const label = (prefix, doc) => `${prefix}:${doc.path}`;

phase('Audit & fix');

const audits = await parallel(
  DOCS.map(
    (doc) => () =>
      agent(
        FIX_COMMON +
          `
YOUR FILE: ${doc.path} — the whole file; no other agent edits it.
AUDIT: ${doc.scope ?? 'every factual claim against the code it describes'}.${doc.rules ? `\nDOC-SPECIFIC RULES: ${doc.rules}` : ''}`,
        { label: label('fix', doc), phase: 'Audit & fix', schema: FIX_REPORT },
      ),
  ),
);

// Barrier is genuine: the verify wave needs the COMPLETE, settled diff from every
// fixer, and the invariants verifier reads across all of them.
phase('Verify');

const verifiers = DOCS.map(
  (doc) => () =>
    agent(
      VERIFY_COMMON +
        `TARGET: the diff of ${doc.path}. Re-derive every content-bearing hunk against the code it describes. Confirm nothing load-bearing was deleted${doc.rules ? ` and that these rules held: ${doc.rules}` : ''}.`,
      { label: label('verify', doc), phase: 'Verify', schema: ISSUES },
    ),
);
if (INVARIANTS.length) {
  verifiers.push(() =>
    agent(
      VERIFY_COMMON +
        `TARGET: invariant preservation across the WHOLE diff. Walk every deleted content line (git diff -U0 | grep '^-'), match it to its replacement, and classify; any lost operational or load-bearing content is a P1. Then positively check that each of these still exists and still says what it said:\n${INVARIANTS.map((s) => `- ${s}`).join('\n')}`,
      { label: 'verify:invariants', phase: 'Verify', schema: ISSUES },
    ),
  );
}
const verified = await parallel(verifiers);

const byPath = (list) => Object.fromEntries(DOCS.map((doc, n) => [doc.path, list[n] ?? null]));
return {
  audit: byPath(audits),
  verify: {
    ...byPath(verified),
    ...(INVARIANTS.length ? { invariants: verified[DOCS.length] ?? null } : {}),
  },
};
