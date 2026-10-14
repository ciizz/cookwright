/* global agent, parallel, pipeline, phase, log, args, budget */
// ^ injected by the Claude Code Workflow runtime — this file is a workflow
//   script, not application code. It never runs inside the app bundle, and it
//   is written in the Workflow dialect (top-level await + top-level return in
//   a .js file): do not validate it with a raw `node --check`-style ESM parse.

export const meta = {
  name: 'bundle-phase',
  description:
    'Run ONE phase of a Leeka feature bundle (plan review, implement, review, fix, closeout verify)',
  whenToUse:
    "Only from the /bundle skill, with args emitted by `node scripts/bundle.mjs args <slug> <phase>` — never hand-written args. One run per phase; the gate, the atlas and Cesar's operator block run between runs, in the orchestrator's shell.",
  phases: [
    {
      title: 'Plan review',
      detail: 'Codex + a fresh red-team on the plan, then adversarial verify',
    },
    { title: 'Implement', detail: 'one implementer session, pinned to its plan sections' },
    { title: 'Review', detail: 'Codex + a fresh red-team on a frozen commit range' },
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

// The Claude adapter of the bundle workflow v1 (agent operating model §7). The
// procedure is ops/PLAYBOOK.md; the state and every fact are scripts/bundle.mjs's.
// This script fixes only what a model must not choose: which phase runs which
// roles, in what order, at which tier, returning which schema.
//
// Prompts are POINTERS, not paste: a session reads the playbook, the plan and the
// state itself. Each prompt carries the content hashes `bundle args` computed, so an
// edited plan or findings file changes the prompt and misses the resume cache
// instead of replaying a result produced against the old text.
//
// Tiers, the only place a model name lives. Every agent() call sets one, so a
// session the orchestrator started on a smaller model still implements on the
// strong tier. Change a model here and nowhere else.
const TIERS = {
  strong: { model: 'opus', effort: 'high' },
  standard: { model: 'sonnet' },
};

// ── schemas ──────────────────────────────────────────────────────────────────

// docs-audit's ISSUES item, plus the failure scenario a reviewer must name.
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
    // Codex only: a run that hit the 600 s ceiling reports it instead of
    // returning an empty list that reads as "clean" (the playbook's resume recipe).
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
  required: ['commits', 'files', 'open_questions', 'strings', 'notes'],
  properties: {
    commits: { type: 'array', items: { type: 'string' } },
    files: { type: 'array', items: { type: 'string' } },
    open_questions: { type: 'array', items: { type: 'string' } },
    // Every user-facing string added or changed, for Cesar in one batch.
    strings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'en', 'fr', 'context'],
        properties: {
          key: { type: 'string' },
          en: { type: 'string' },
          fr: { type: 'string' },
          context: { type: 'string' },
        },
      },
    },
    notes: { type: 'string' },
  },
};

// ── prompts ──────────────────────────────────────────────────────────────────

if (!args || typeof args !== 'object' || !args.phase || !args.plan || !args.playbook) {
  throw new Error('bundle-phase needs the args of `node scripts/bundle.mjs args <slug> <phase>`');
}

const RANGE = args.range ? `${args.range.from}..${args.range.to}` : null;

function header(role) {
  return `You are the ${role} of the Leeka feature bundle "${args.slug}" (branch ${args.branch}, phase ${args.name}).
Before acting, read these yourself — they are not pasted here:
- ops/PLAYBOOK.md (sha ${args.playbook.sha}): the "${role}" role section and "Prompt header".
- the plan ${args.plan.path} (sha ${args.plan.sha}).
- the bundle state ${args.state} — written ONLY by scripts/bundle.mjs; never edit it.
Your final message is consumed by the orchestrator: return the structured result only.`;
}

function codexReviewer(target) {
  return `${header('reviewer')}

You are the CODEX reviewer. Do not review yourself: run Codex, exactly as ops/PLAYBOOK.md "Codex by file reference" says — a runner script written with the Write tool, GSTACK_CODEX_MODEL=gpt-5.6-sol, run in the FOREGROUND with a Bash timeout of 600000, the target named by reference (never inlined), a capped command budget. Target: ${target}.
Transcribe Codex's findings into the schema faithfully; add none of your own. If the run hits the ceiling, do the playbook's recovery YOURSELF before returning: \`codex exec resume <session-id> "Stop investigating now. Write the full report from what you have already read."\` at medium effort. Set timedOut=true (with the session id and the partial output path) only if that also fails — a returned timeout is cached, and a resumed Workflow would replay it.`;
}

function redTeam(target) {
  return `${header('reviewer')}

You are the fresh-context RED-TEAM reviewer, read-only: no file edits, no git writes, no supabase/psql/docker. Target: ${target}.
Try to refute the work: correctness, security (RLS, grants, SECURITY DEFINER, secrets in output), what the plan promised and the code does not deliver, claims wider than the code. Every issue names a concrete failure scenario. Set timedOut=false.`;
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
 * Both reviewers' issues. Two issues from the SAME reviewer are never merged — one
 * location can carry two defects. Across reviewers, the first issue at a location
 * absorbs the other's, keeping its text in `alsoReported` so nothing is dropped.
 */
function merge(codex, red) {
  const out = [];
  const byKey = new Map();
  for (const [reviewer, result] of [
    ['codex', codex],
    ['red-team', red],
  ]) {
    for (const issue of result?.issues ?? []) {
      const k = keyOf(issue);
      const prior = byKey.get(k);
      if (prior && !prior.reviewers.includes(reviewer)) {
        prior.reviewers.push(reviewer);
        prior.alsoReported.push({ reviewer, severity: issue.severity, problem: issue.problem });
        // The merged finding carries the HIGHEST severity either reviewer gave it:
        // a Codex P3 must not hide a red-team P1 below the blocking line.
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

async function review(title, fixed) {
  phase(title);
  const target = reviewTarget(fixed);
  const [codex, red] = await parallel([
    () =>
      agent(codexReviewer(target), {
        label: 'codex',
        phase: title,
        schema: REVIEW,
        ...TIERS.standard,
      }),
    () =>
      agent(redTeam(target), { label: 'red-team', phase: title, schema: REVIEW, ...TIERS.strong }),
  ]);
  const issues = merge(codex, red).map((x, index) => ({ ...x, index }));
  log(
    `${issues.length} distinct issue(s): codex ${codex?.issues?.length ?? 'none'}, red-team ${red?.issues?.length ?? 'none'}`,
  );
  if (codex?.timedOut)
    log(`codex hit its ceiling — session ${codex.codexSessionId ?? '?'}; resume per the playbook`);

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
  // A stage that threw leaves null: its group still goes forward, all plausible.
  const verified = groups.flatMap((g, n) => judged[n] ?? verdictsFor(g, null));

  // A review where a reviewer never finished is NOT a clean review: say so, and
  // `bundle record findings` refuses it unless the orchestrator accepts it by name.
  const incomplete = [];
  if (!codex) incomplete.push('the Codex reviewer returned nothing');
  else if (codex.timedOut) incomplete.push('Codex hit its ceiling (resume per the playbook)');
  if (!red) incomplete.push('the red-team reviewer returned nothing');

  return {
    issues: verified.sort((a, b) => a.index - b.index),
    incomplete,
    checked: [...(codex?.checked ?? []), ...(red?.checked ?? [])],
    notes: [codex?.notes, red?.notes].filter(Boolean).join('\n---\n'),
    codex: {
      returned: Boolean(codex),
      timedOut: Boolean(codex?.timedOut),
      sessionId: codex?.codexSessionId ?? null,
      partialReportPath: codex?.partialReportPath ?? null,
    },
    redTeamReturned: Boolean(red),
  };
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

Your session: ${s.id} — ${s.scope}.
Slice ${args.slice.id}${args.slice.sql ? ' (a SCHEMA slice: you also write the deploy log\'s "Next deploy (queued)" block for Cesar\'s hands; you never apply anything to a hosted database)' : ''}.
Checkpoints — stop and commit at each, staging NAMED paths only, never \`git add -A\`: ${s.checkpoints.length ? s.checkpoints.join('; ') : 'one commit at the end of your scope'}.
Stay inside your scope; anything outside it goes in open_questions, not the diff. List every user-facing string you added or changed in \`strings\`.`;
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
      ? `${files}. The first is Cesar's LATEST device-QA round: fix every issue he reported. Any further file is the previous round's review findings: fix every one not "rejected" (a defaulted verdict counts as plausible). Anything that is a product call goes in open_questions.`
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
