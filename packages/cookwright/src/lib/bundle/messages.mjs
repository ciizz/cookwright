// src/lib/bundle/messages.mjs — the strings the bundle CLI prints as guidance, in
// one place: the invocation it names itself by, the next-action lines, the skip and
// refusal notes a user acts on. Error texts that name a specific bad input still
// live beside the check that produces them (backlog E-004 moves the rest).

import { CONFIG_FILE } from '../config.mjs';

/** How this CLI is invoked, as every printed command names it. */
export const CLI = 'node packages/cookwright/src/bundle.mjs';

export const messages = {
  usage: (commands) => `usage: ${CLI} <${commands.join('|')}> …`,
  noConfig: `no ${CONFIG_FILE} here or in any parent directory — run from inside a cookwright repo`,

  // gate
  skippedNeeds: (tool) => `skipped, needs ${tool}, run setup`,
  skippedNotFound: 'skipped, command not found',
  noChecksConfigured: `gate.checks is empty in ${CONFIG_FILE} — add the commands that verify this repo`,
  noCheckRan: `no check ran (every check was skipped) — run setup, or fix gate.checks in ${CONFIG_FILE}`,
  noFlakes: `--retry needs --flake <id>, and gate.flakes in ${CONFIG_FILE} names no flake yet`,

  // landing check
  noRepoChecks: 'no repo-wide checks configured',
  noCi: 'no CI configured (ci.workflow)',
  noGh: 'needs gh, run setup — CI not verified',
  summary: ({ failed, skipped, warned }) =>
    failed
      ? `FAILED: ${failed} check(s)`
      : `passed, ${skipped} skipped, ${warned} warning(s)`,

  // lock
  lockBusy: (holder) =>
    `rig lock is held by ${holder}. The shared local resource is in use — wait for it to finish.`,

  // next actions
  next: {
    allDone: 'every phase done — `bundle check`, then merge',
    start: (slug, phase) => `${CLI} phase ${slug} start ${phase}`,
    qaRound: (slug) =>
      `record a QA round (\`record ${slug} qa\` with your notes on stdin), or \`phase ${slug} done qa --no-device "<why>"\``,
    outsideWorkflow: (slug, phase) =>
      `${phase} runs outside the Workflow — finish it, then \`phase ${slug} done ${phase}\``,
    resume: (script, runId, slug, phase) =>
      `Workflow({ scriptPath: '${script}', resumeFromRunId: '${runId}', args: ` +
      `<output of \`${CLI} args ${slug} ${phase}\`> })`,
    afterRun: (slug, phase) =>
      `record the run's results, gate, \`phase ${slug} done ${phase}\` — or a rerun: \`phase ${slug} start ${phase}\``,
    launch: (script, slug, phase) =>
      `Workflow({ scriptPath: '${script}', args: <output of ` +
      `\`${CLI} args ${slug} ${phase}\`> }), then \`phase ${slug} run ${phase} --run-id <id>\``,
  },
};
