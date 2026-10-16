// src/lib/bundle/messages.mjs — the strings the bundle CLI prints as guidance, in
// one place: the invocation it names itself by, the next-action lines, the skip and
// refusal notes a user acts on. Error texts that name a specific bad input still
// live beside the check that produces them (backlog E-004 moves the rest).

import { CONFIG_FILE } from '../config.mjs';
import { CLI } from '../messages.mjs';

/** How the bundle runner is invoked, as every printed command names it. */
export const BUNDLE_CLI = `${CLI} bundle`;

export const messages = {
  usage: (commands) => `usage: ${BUNDLE_CLI} <${commands.join('|')}> …`,
  noConfig: `no ${CONFIG_FILE} here or in any parent directory — run from inside a cookwright repo`,

  // what a Workflow call needs: the playbook its prompts point at, a host that runs it
  noPlaybook: (rel, configured) =>
    `the playbook is not at ${rel} (${
      configured
        ? 'paths.playbook names it'
        : 'cookwright is not installed under the config root or the work tree top: npm install --save-dev cookwright'
    })`,
  noWorkflowHost: (withWorkflows, hosts) =>
    `the bundle runner needs a host with workflows (${withWorkflows.join(', ')}); hosts is [${hosts.join(', ')}]`,
  pointerMissing: (rel) => `run init: the workflow pointer ${rel} is missing`,

  // gate
  skippedNeeds: (tool) => `skipped, needs ${tool}, run setup`,
  skippedNotFound: (cmd) => `skipped, command not found: ${cmd}`,
  noChecksConfigured: `gate.checks is empty in ${CONFIG_FILE} — add the commands that verify this repo`,
  noCheckRan: `no check ran (every check was skipped) — run setup, or fix gate.checks in ${CONFIG_FILE}`,
  noFlakes: `--retry needs --flake <id>, and gate.flakes in ${CONFIG_FILE} names no flake yet`,
  missingScript: (check, script) =>
    `gate check "${check}" runs npm script "${script}", which package.json does not define — add the script or fix gate.checks in ${CONFIG_FILE}`,
  noPackageJson: (check, script) =>
    `gate check "${check}" runs npm script "${script}", but there is no package.json at the root — fix gate.checks in ${CONFIG_FILE}`,

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
    start: (slug, phase) => `${BUNDLE_CLI} phase ${slug} start ${phase}`,
    qaRound: (slug) =>
      `record a QA round (\`record ${slug} qa\` with your notes on stdin), or \`phase ${slug} done qa --no-device "<why>"\``,
    outsideWorkflow: (slug, phase) =>
      `${phase} runs outside the Workflow — finish it, then \`phase ${slug} done ${phase}\``,
    resume: (workflow, runId, slug, phase) =>
      `Workflow({ name: '${workflow}', resumeFromRunId: '${runId}', args: ` +
      `<output of \`${BUNDLE_CLI} args ${slug} ${phase}\`> })`,
    afterRun: (slug, phase) =>
      `record the run's results, gate, \`phase ${slug} done ${phase}\` — or a rerun: \`phase ${slug} start ${phase}\``,
    launch: (workflow, slug, phase) =>
      `Workflow({ name: '${workflow}', args: <output of ` +
      `\`${BUNDLE_CLI} args ${slug} ${phase}\`> }), then \`phase ${slug} run ${phase} --run-id <id>\``,
  },
};
