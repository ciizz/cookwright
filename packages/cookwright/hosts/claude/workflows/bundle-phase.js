/* global agent, parallel, pipeline, phase, log, args, budget */
// ^ injected by the Claude Code Workflow runtime — this file is a workflow
//   script, not application code. It never runs inside an app bundle, and it
//   is written in the Workflow dialect (top-level await + top-level return in
//   a .js file): do not validate it with a raw `node --check`-style ESM parse.

export const meta = {
  name: 'bundle-phase',
  description:
    'Run ONE phase of a cookwright bundle (plan review, implement, review, fix, QA round, closeout verify)',
  whenToUse:
    'Only from the /bundle skill, with args emitted by the bundle CLI (`bundle args <slug> <phase>`) — never hand-written args. One run per phase; the gate and the developer\'s own steps run between runs, in the orchestrator\'s shell.',
  phases: [
    {
      title: 'Plan review',
      detail: 'A fresh red-team on the plan (plus Codex when installed), then adversarial verify',
    },
    { title: 'Implement', detail: 'one implementer session, pinned to its plan sections' },
    { title: 'Review', detail: 'A fresh red-team (plus Codex when installed) on a frozen commit range' },
    { title: 'Verify', detail: 'one skeptic per file group: confirmed / plausible / rejected' },
    {
      title: 'Fix',
      detail: 'one session applies the confirmed and plausible findings, or a QA round',
    },
    {
      title: 'Closeout verify',
      detail: 're-derive every closeout claim against the diff and the state',
    },
  ],
};

// The Claude adapter of the cookwright bundle workflow. The procedure is the
// playbook; the state and every fact are the bundle CLI's. This script fixes only
// what a model must not choose: which phase runs which roles, in what order, at
// which tier, returning which schema.
//
// Prompts are POINTERS, not paste: a session reads the rules file, the playbook,
// the plan and the state itself. Each prompt carries the content hashes `bundle
// args` computed, so an edited plan or findings file changes the prompt and misses
// the resume cache instead of replaying a result produced against the old text.
//
// Tiers, the only place a model name lives. Every agent() call sets one, so a
// session the orchestrator started on a smaller model still implements on the
// strong tier. Change a model here and nowhere else.
const TIERS = {
  strong: { model: 'opus', effort: 'high' },
  standard: { model: 'sonnet' },
};

// ── schemas ──────────────────────────────────────────────────────────────────

// A reviewer's issue, with the failure scenario it must name.
const ISSUE = {
  type: 'object',
  additionalProperties: false,
  required: ['file', 'location', 'problem', 'severity', 'suggested_fix', 'failure_scenario'],
  properties: {
    file: { type: 'string' },
    location: { type: 'string' },
    problem: { type: 'string' },
    severity: { type: 'string', enum: ['P1', 'P2', 'P3'] },
    suggested_fix: { type: 'string' },
    failure_scenario: { type: 'string' },
  },
};

const REVIEW = {
  type: 'object',
  additionalProperties: false,
  required: ['issues', 'checked', 'notes', 'timedOut'],
  properties: {
    issues: { type: 'array', items: ISSUE },
    checked: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
    // Codex only: a run that hit its time ceiling reports it instead of returning
    // an empty list that reads as "clean" (the playbook's resume recipe).
    timedOut: { type: 'boolean' },
    codexSessionId: { type: 'string' },
    partialReportPath: { type: 'string' },
  },
};

const VERDICTS = {
  type: 'object',
  additionalProperties: false,
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'verdict', 'evidence'],
        properties: {
          index: { type: 'integer' },
          verdict: { type: 'string', enum: ['confirmed', 'plausible', 'rejected'] },
          evidence: { type: 'string' },
        },
      },
    },
  },
};

// A re-check returns the prior issues with fresh verdicts.
const RECHECK = {
  type: 'object',
  additionalProperties: false,
  required: ['issues', 'checked', 'notes', 'timedOut'],
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        required: [...ISSUE.required, 'verdict', 'evidence'],
        properties: {
          ...ISSUE.properties,
          verdict: { type: 'string', enum: ['confirmed', 'plausible', 'rejected'] },
          evidence: { type: 'string' },
        },
      },
    },
    checked: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
    timedOut: { type: 'boolean' },
  },
};

const IMPL = {
  type: 'object',
  additionalProperties: false,
  required: ['commits', 'files', 'open_questions', 'notes'],
  properties: {
    commits: { type: 'array', items: { type: 'string' } },
    files: { type: 'array', items: { type: 'string' } },
    open_questions: { type: 'array', items: { type: 'string' } },
    // Every user-facing string added or changed, so the developer reviews them in
    // one batch. Where they live in the code is the rules file's call.
    strings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'text', 'context'],
        properties: {
          key: { type: 'string' },
          text: { type: 'string' },
          context: { type: 'string' },
        },
      },
    },
    notes: { type: 'string' },
  },
};

// ── prompts ──────────────────────────────────────────────────────────────────

if (!args || typeof args !== 'object' || !args.phase || !args.plan || !args.playbook || !args.cli) {
  throw new Error('bundle-phase needs the args of `bundle args <slug> <phase>` (see the /bundle skill)');
}

const RANGE = args.range ? `${args.range.from}..${args.range.to}` : null;
const CODEX = Boolean(args.codex);

// The implementer's (and the fix session's) one line on the doc-sync hook, as the
// playbook's Implementer role says it.
const DOC_SYNC_LINE =
  'When the pre-commit hook refuses a commit on doc sync, stage the doc the rule names; a commit with no doc implication goes through with `COOKWRIGHT_SKIP=doc-sync git commit …` and the reason in its message, never `--no-verify`.\n';

function header(role) {
  const rules = (args.rules ?? [])
    .map((r) => `- the repo's rules file ${r.path} (sha ${r.sha}): every rule in it applies to you.\n`)
    .join('');
  return `You are the ${role} of the cookwright bundle "${args.slug}" (branch ${args.branch}, phase ${args.name}).
Before acting, read these yourself — they are not pasted here:
${rules}- the playbook ${args.playbook.path} (sha ${args.playbook.sha}): the "${role}" role section and "Prompt header".
- the plan ${args.plan.path} (sha ${args.plan.sha}).
- the bundle state ${args.state} — written ONLY by the bundle CLI (${args.cli}); never edit it.
${role === 'implementer' ? DOC_SYNC_LINE : ''}Your final message is consumed by the orchestrator: return the structured result only.`;
}

function codexReviewer(target) {
  return `${header('reviewer')}

You are the CODEX reviewer. Do not review yourself: run Codex, exactly as the playbook's "Codex by file reference" says — a runner script written with the Write tool, run in the FOREGROUND with a Bash timeout of 600000, the target named by reference (never inlined), a capped command budget. Target: ${target}.
Transcribe Codex's findings into the schema faithfully; add none of your own. If the run hits the ceiling, do the playbook's recovery YOURSELF before returning: \`codex exec resume <session-id> "Stop investigating now. Write the full report from what you have already read."\` at medium effort. Set timedOut=true (with the session id and the partial output path) only if that also fails — a returned timeout is cached, and a resumed Workflow would replay it.`;
}

function redTeam(target) {
  return `${header('reviewer')}

You are the fresh-context RED-TEAM reviewer, read-only: no file edits, no git writes, no database or container commands. Target: ${target}.
Try to refute the work: correctness, security (authentication, data access rules, secrets in output or on disk), what the plan promised and the code does not deliver, claims wider than the code, rules in the rules file the change breaks. Every issue names a concrete failure scenario.
If the rules file has an \`### Advisory\` heading under a pack section, check each advisory rule against the diff (a new visual where a primitive existed, a primitive reinterpreted where one is documented, a concept rendered twice); a finding names the file and the existing primitive or doc entry as evidence. Set timedOut=false.`;
}

function reviewTarget(fixed) {
  if (args.phase === 'plan-review')
    return `the plan ${args.plan.path}, against the repo it will change`;
  if (args.phase === 'qa') {
    // Bound to THIS round: its notes' hashes and the fix's own commits make the
    // prompt differ every round, so no round can replay an earlier round's review.
    const round = args.findings.map((f) => f.sha).join(', ');
    const commits = fixed?.commits?.length ? fixed.commits.join(', ') : 'none reported';
    return `what this QA round's fix session just committed (round notes sha ${round}; commits ${commits}): the range ${args.range.from}..HEAD (git diff ${args.range.from}..HEAD; git show for context)`;
  }
  return `the commit range ${RANGE} only (git diff ${RANGE}; git show for context)`;
}

const keyOf = (i) => `${i.file}::${i.location}`.toLowerCase();

/**
 * Every reviewer's issues. Two issues from the SAME reviewer are never merged — one
 * location can carry two defects. Across reviewers, the first issue at a location
 * absorbs the other's, keeping its text in `alsoReported` so nothing is dropped.
 */
function merge(results) {
  const out = [];
  const byKey = new Map();
  for (const [reviewer, result] of results) {
    for (const issue of result?.issues ?? []) {
      const k = keyOf(issue);
      const prior = byKey.get(k);
      if (prior && !prior.reviewers.includes(reviewer)) {
        prior.reviewers.push(reviewer);
        prior.alsoReported.push({ reviewer, severity: issue.severity, problem: issue.problem });
        // The merged finding carries the HIGHEST severity any reviewer gave it:
        // one reviewer's P3 must not hide another's P1 below the blocking line.
        if (issue.severity < prior.severity) prior.severity = issue.severity;
        continue;
      }
      const entry = { ...issue, reviewers: [reviewer], alsoReported: [] };
      if (!prior) byKey.set(k, entry);
      out.push(entry);
    }
  }
  return out;
}

/**
 * Verdicts for one group, trusting only the indices that group was given. A missing
 * or foreign index cannot reach another group's issue; an issue with no verdict
 * defaults to PLAUSIBLE — the playbook's rule when unsure — so it still reaches the
 * fix session, marked so the defaulting is visible.
 */
function verdictsFor(group, result) {
  const mine = new Set(group.issues.map((x) => x.index));
  const got = new Map();
  for (const v of result?.verdicts ?? []) {
    if (mine.has(v.index) && !got.has(v.index)) got.set(v.index, v);
  }
  return group.issues.map((x) => {
    const v = got.get(x.index);
    return v
      ? { ...x, verdict: v.verdict, evidence: v.evidence }
      : { ...x, verdict: 'plausible', evidence: 'no verdict returned', verdictDefaulted: true };
  });
}

function verifyPrompt(file, issues) {
  const list = issues
    .map(
      (x) =>
        `[${x.index}] ${x.severity} ${x.location}: ${x.problem}\n    scenario: ${x.failure_scenario}`,
    )
    .join('\n');
  return `${header('reviewer')}

You are an ADVERSARIAL VERIFIER, read-only. For each finding below on ${file}, try to REFUTE it against ${RANGE ? `the range ${RANGE}` : `the plan ${args.plan.path} and the repo`}. confirmed = you reproduced the reasoning and it holds; plausible = it may hold and you could not refute it; rejected = the code or plan already handles it, or the scenario cannot happen. Default to plausible when unsure — never to confirmed. Evidence = file:line.

${list}`;
}

// ── phases ───────────────────────────────────────────────────────────────────

/** The reviewers of a review run: the red-team always, Codex when it is installed. */
function reviewers(title, target) {
  const red = () =>
    agent(redTeam(target), { label: 'red-team', phase: title, schema: REVIEW, ...TIERS.strong });
  if (!CODEX) return [['red-team', red]];
  const codex = () =>
    agent(codexReviewer(target), { label: 'codex', phase: title, schema: REVIEW, ...TIERS.standard });
  return [
    ['codex', codex],
    ['red-team', red],
  ];
}

/** Why a review run is NOT a clean review: a reviewer that never finished. */
function incompleteness(named) {
  const out = [];
  for (const [name, result] of named) {
    if (!result) out.push(`the ${name} reviewer returned nothing`);
    else if (result.timedOut) out.push(`${name} hit its ceiling (resume per the playbook)`);
  }
  return out;
}

async function review(title, fixed) {
  phase(title);
  const target = reviewTarget(fixed);
  const who = reviewers(title, target);
  const results = await parallel(who.map(([, start]) => start));
  const named = who.map(([name], n) => [name, results[n]]);
  const issues = merge(named).map((x, index) => ({ ...x, index }));
  log(
    `${issues.length} distinct issue(s): ${named.map(([n, r]) => `${n} ${r?.issues?.length ?? 'none'}`).join(', ')}`,
  );
  const codex = CODEX ? results[0] : null;
  if (codex?.timedOut)
    log(`codex hit its ceiling — session ${codex.codexSessionId ?? '?'}; resume per the playbook`);
  const verified = await verify(issues);
  // A review where a reviewer never finished is NOT a clean review: say so, and
  // `bundle record findings` refuses it unless the orchestrator accepts it by name.
  return {
    issues: verified.sort((a, b) => a.index - b.index),
    incomplete: incompleteness(named),
    checked: results.flatMap((r) => r?.checked ?? []),
    notes: results.map((r) => r?.notes).filter(Boolean).join('\n---\n'),
    reviewers: named.map(([name, r]) => ({ name, returned: Boolean(r) })),
    codex: {
      installed: CODEX,
      returned: Boolean(codex),
      timedOut: Boolean(codex?.timedOut),
      sessionId: codex?.codexSessionId ?? null,
      partialReportPath: codex?.partialReportPath ?? null,
    },
  };
}

/** One adversarial verifier per file group; a group whose verifier threw stays plausible. */
async function verify(issues) {
  const groups = [...new Set(issues.map((x) => x.file))].map((file) => ({
    file,
    issues: issues.filter((x) => x.file === file),
  }));
  const judged = await pipeline(
    groups,
    (g) =>
      agent(verifyPrompt(g.file, g.issues), {
        label: `verify:${g.file}`,
        phase: 'Verify',
        schema: VERDICTS,
        ...TIERS.standard,
      }),
    (result, g) => verdictsFor(g, result),
  );
  return groups.flatMap((g, n) => judged[n] ?? verdictsFor(g, null));
}

/**
 * A plan-review RERUN after the plan was revised: re-judge only the previous round's
 * open findings against the revised plan. No new adversarial pass — each would find
 * something new, and the phase would close by exhaustion instead of by agreement.
 */
async function recheck(title) {
  phase(title);
  const subject =
    args.phase === 'closeout'
      ? `The closeout ${args.closeout.path} (sha ${args.closeout.sha})`
      : `The plan ${args.plan.path} (sha ${args.plan.sha})`;
  const prompt = `${header('reviewer')}

You are the RE-CHECK verifier, read-only. ${subject} was revised after review. Read the previous round's findings ${args.recheck.path} (sha ${args.recheck.sha}) and, for EVERY issue in it whose verdict is not "rejected", judge it against ${subject} as it is now: rejected = the revision resolves it; confirmed / plausible = it still holds. Return each issue unchanged except verdict and evidence (evidence = the section that resolves it, or why it still holds). Set timedOut=false and checked to the issue locations.`;
  const result = await agent(prompt, {
    label: 'recheck',
    phase: title,
    schema: RECHECK,
    ...TIERS.strong,
  });
  if (!result) {
    return {
      issues: [],
      incomplete: ['the re-check verifier returned nothing'],
      recheckOf: args.recheck.path,
    };
  }
  const out = { ...result, incomplete: [], recheckOf: args.recheck.path };
  // The closeout's record must still say which text it judged.
  return args.phase === 'closeout' ? { ...out, closeoutSha: args.closeout.sha } : out;
}

async function implement() {
  phase('Implement');
  const s = args.session;
  const prompt = `${header('implementer')}

Your session: ${s.id} — ${s.scope}. Slice ${args.slice.id}.
Checkpoints — stop and commit at each, staging NAMED paths only, never \`git add -A\`: ${s.checkpoints.length ? s.checkpoints.join('; ') : 'one commit at the end of your scope'}.
Stay inside your scope; anything outside it goes in open_questions, not the diff. Anything that leaves the repo (a deploy, a publish, a store action) is the developer's hands: name the command in notes, never run it. List every user-facing string you added or changed in \`strings\`; where strings live in the code is the rules file's call.`;
  return agent(prompt, {
    label: `implement:${s.id}`,
    phase: 'Implement',
    schema: IMPL,
    ...TIERS.strong,
  });
}

async function fix() {
  phase('Fix');
  const files = args.findings.map((f) => `${f.path} (sha ${f.sha})`).join(', ');
  const what =
    args.phase === 'qa'
      ? `${files}. The first is the developer's LATEST QA round: fix every issue it reports. Any further file is the previous round's review findings: fix every one not "rejected" (a defaulted verdict counts as plausible). Anything that is a product call goes in open_questions.`
      : `the findings files ${files}. Fix every "confirmed" and "plausible" finding (a defaulted verdict counts as plausible); for any you decline, say why in notes (a finding that is really a product call goes in open_questions). Leave "rejected" ones alone.`;
  const prompt = `${header('implementer')}

You are the FIX session for ${args.name}. Read ${what}
Commit per logical fix, staging named paths only.`;
  return agent(prompt, { label: args.name, phase: 'Fix', schema: IMPL, ...TIERS.strong });
}

async function closeoutVerify() {
  phase('Closeout verify');
  const prompt = `${header('docs')}

You are the CLOSEOUT VERIFIER, read-only. The closeout is ${args.closeout.path} (sha ${args.closeout.sha}). Re-derive EVERY claim in it — what shipped, what was verified and how, counts, commit ids, gate results, decisions — from the range ${RANGE}, the state file and the recorded findings/session files it lists. Its generated tables are as of the state revision named in its header; judge them against that revision, not against later writes. The state is now at revision ${args.stateRevision}. Assume at least one claim is fabricated or wider than the evidence, and find it. Report each unsupported or wrong claim as an issue (file = the closeout path, location = its section). Set timedOut=false.`;
  const result = await agent(prompt, {
    label: 'closeout-verify',
    phase: 'Closeout verify',
    schema: REVIEW,
    ...TIERS.strong,
  });
  if (!result) return { issues: [], incomplete: ['the closeout verifier returned nothing'] };
  // A verifier's own finding is unjudged: count it as open (plausible) until fixed
  // and re-verified. The sha pins which closeout text this verdict is about.
  return {
    ...result,
    issues: result.issues.map((x) => ({ ...x, verdict: 'plausible' })),
    incomplete: [],
    closeoutSha: args.closeout.sha,
  };
}

let results;
switch (args.phase) {
  case 'plan-review':
    results = args.recheck ? await recheck('Plan review') : await review('Plan review');
    break;
  case 'implement':
    results = await implement();
    break;
  case 'review':
    results = await review('Review');
    break;
  case 'fix':
    results = await fix();
    break;
  case 'qa':
    // A QA round: the fix, then a review of exactly what it committed — QA fixes
    // land after the whole-branch review, and nothing else would ever read them.
    // Record `results.fix` as the session report and `results.review` as findings.
    {
      const fixed = await fix();
      results = { fix: fixed, review: await review('Review', fixed) };
    }
    break;
  case 'closeout':
    results = args.recheck ? await recheck('Closeout verify') : await closeoutVerify();
    break;
  default:
    throw new Error(`unknown bundle phase "${args.phase}"`);
}

return { phase: args.phase, name: args.name, results, usage: budget.spent() };
