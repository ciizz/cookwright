// scripts/lib/bundle/closeout.mjs — the closeout's machine-derived skeleton.
//
// The docs role fills in the narrative around it; the closeout-verify phase then
// re-derives every claim. What this generates is the part no model should type: the
// review trajectory, the gate history, the decisions taken on Cesar's behalf, and the
// five numbers the operating model measures v1 by — with the one number the runtime
// cannot measure (USD) marked as entered.

const short = (sha) => (sha ? sha.slice(0, 8) : '—');

function hours(state) {
  const stamps = state.phases.flatMap((p) => p.runs.flatMap((r) => [r.startedAt, r.endedAt]));
  const times = [state.createdAt, ...stamps].map((t) => Date.parse(t)).filter(Number.isFinite);
  if (times.length < 2) return null;
  return (Math.max(...times) - Math.min(...times)) / 3_600_000;
}

/**
 * Output tokens: the sum of the per-run readings. Each reading is `budget.spent()`
 * at the run's end — cumulative for its TURN — so this is exact only when a turn runs
 * one workflow, which is the playbook's cadence; the table says so.
 */
function outputTokens(state) {
  const readings = state.phases.flatMap((p) => p.runs.map((r) => r.turnOutputTokens));
  const known = readings.filter((n) => Number.isFinite(n));
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}

export function fiveNumbers(state) {
  const reviewRounds = state.phases
    .filter((p) => p.name.startsWith('review:') || p.name === 'plan-review' || p.name === 'qa')
    .reduce((n, p) => n + p.runs.length, 0);
  const usd = state.costs.reduce((a, c) => a + Number(c.usd || 0), 0);
  return {
    wallClockHours: hours(state),
    usdEntered: state.costs.length ? usd : null,
    outputTokens: outputTokens(state),
    reviewRounds,
    qaRounds: state.qaRounds.length,
  };
}

export function renderCloseoutDraft(state, { planSha } = {}) {
  const n = fiveNumbers(state);
  const fmt = (v, digits = 1) => (v === null ? 'not recorded' : Number(v).toFixed(digits));
  const lines = [
    `# ${state.slug} — closeout (draft generated from the bundle state)`,
    '',
    `Branch \`${state.branch}\`, base \`${short(state.base)}\`, plan \`${state.plan.path}\` (sha ${planSha ?? state.plan.sha}${planSha && planSha !== state.plan.sha ? `; ${state.plan.sha} at init` : ''}).`,
    '',
    `_The tables below are generated from bundle state revision ${state.revision ?? '?'}; later phases (the closeout's own run and gate) are not in them._`,
    '',
    '## The five numbers',
    '',
    '| Measure | Value | Source |',
    '|---|---|---|',
    `| Wall clock (h) | ${fmt(n.wallClockHours)} | state timestamps |`,
    `| USD | ${fmt(n.usdEntered, 0)} | ENTERED by the orchestrator from the harness cost readout |`,
    `| Output tokens | ${n.outputTokens ?? 'not recorded'} | sum of per-turn \`budget.spent()\` readings; turns that ran two workflows count once per run |`,
    `| Review rounds | ${n.reviewRounds} | review, plan-review and QA-round runs (each rerun is a run) |`,
    `| QA rounds | ${n.qaRounds} | recorded QA rounds |`,
    '',
    '## Review trajectory',
    '',
    '| Phase | Confirmed | Plausible | Rejected | File |',
    '|---|---|---|---|---|',
    ...state.findings.map(
      (f) =>
        `| ${f.phase} | ${f.counts.confirmed} | ${f.counts.plausible} | ${f.counts.rejected} | \`${f.path}\` |`,
    ),
    '',
    '## Gate history',
    '',
    '| # | Commit | Slice | SQL | Result | Retry of |',
    '|---|---|---|---|---|---|',
    ...state.gates.map(
      (g, i) =>
        `| ${i} | \`${short(g.commit)}\` | ${g.slice ?? '—'} | ${g.sql ? 'yes' : 'no'} | ${
          g.passed
            ? 'pass'
            : `FAIL (${g.checks
                .filter((c) => c.result === 'fail')
                .map((c) => c.name)
                .join(', ')})`
        } | ${g.retryOf ?? '—'} |`,
    ),
    '',
    '## Decided on your behalf',
    '',
    ...(state.decisions.length
      ? state.decisions.map((d) => `- ${d.at} — ${d.text} (${d.actor}; source: ${d.source})`)
      : ['- none recorded']),
    '',
  ];
  return lines.join('\n');
}
