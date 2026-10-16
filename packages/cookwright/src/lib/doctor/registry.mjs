// src/lib/doctor/registry.mjs — every doctor check, by name, in readout order.
//
// A check is `(repo, probes) → { status, note }`. The registry says what each one
// needs: `config` (SKIP `config invalid` when the config did not load) and `git`
// (SKIP `skipped, needs git, run setup` when git is not on PATH). A check that
// throws is a FAIL naming why, never a crash of doctor: the hook must always exit 0.
// A check whose subprocess outlasts the shared budget is a SKIP (unverified), not a
// FAIL: a slow machine is not a missing piece.
// levels.mjs names checks from this table; a test holds the two together.

import { TimedOut } from '../budget.mjs';
import { messages } from '../messages.mjs';
import { FAIL, PASS, SKIP, WARN, fail, skip } from '../verdict.mjs';
import { checkConfig, checkGit } from './basics.mjs';
import { checkClaudeHook, checkClaudeRules } from './claude.mjs';
import { checkCodexHook, checkCodexRules } from './codex.mjs';
import { checkBacklog, checkChangelog, checkCloseouts, checkIds } from './homes.mjs';
import { checkGateScripts, checkGitleaks, checkHookFile, checkHooksPath } from './hooks.mjs';
import { checkPointers } from './hosts.mjs';
import { checkBlock, checkSize } from './rules.mjs';
import { checkSecrets } from './secrets.mjs';

const m = messages.doctor;

/** Each host's two checks; a host adds its pair here. */
const HOST_CHECKS = Object.freeze({
  claude: { rules: checkClaudeRules, hook: checkClaudeHook },
  codex: { rules: checkCodexRules, hook: checkCodexHook },
});

const RANK = { [FAIL]: 0, [WARN]: 1, [SKIP]: 2, [PASS]: 3 };

/**
 * Every configured host's check of `kind`. One host: its verdict as it is. Several:
 * the worst status, with each host's note by name, only those not PASS when any is not.
 */
const hostCheck = (kind) => (repo, probes) => {
  const verdicts = repo.config.hosts.map((h) => [h, HOST_CHECKS[h][kind](repo, probes)]);
  if (verdicts.length === 1) return verdicts[0][1];
  const sorted = [...verdicts].sort(([, a], [, b]) => RANK[a.status] - RANK[b.status]);
  const status = sorted[0][1].status;
  const named = status === PASS ? verdicts : sorted.filter(([, v]) => v.status !== PASS);
  return { status, note: named.map(([h, v]) => m.byHost(h, v.note)).join('; ') };
};

export const CHECKS = Object.freeze({
  config: { run: checkConfig },
  git: { run: checkGit, git: true },
  'homes.backlog': { run: checkBacklog, config: true },
  'homes.closeouts': { run: checkCloseouts, config: true },
  'homes.changelog': { run: checkChangelog, config: true },
  'backlog.ids': { run: checkIds, config: true },
  'rules.block': { run: checkBlock, config: true },
  'rules.size': { run: checkSize },
  // Every configured host's rules, hook, and skill and workflow pointers.
  'host.rules': { run: hostCheck('rules'), config: true },
  'host.hook': { run: hostCheck('hook'), config: true },
  'host.pointers': { run: (repo, probes) => checkPointers(repo, probes), config: true },
  'hooks.path': { run: checkHooksPath, git: true },
  'hooks.pre-commit': { run: checkHookFile('pre-commit'), git: true },
  'hooks.pre-push': { run: checkHookFile('pre-push'), git: true },
  'tools.gitleaks': { run: checkGitleaks, git: true },
  'gate.scripts': { run: checkGateScripts, config: true },
  'secrets.env': { run: checkSecrets, git: true },
});

const firstLine = (text) => String(text).split('\n')[0];

function runOne(check, repo, probes) {
  if (check.config && !repo.config) return skip(m.configInvalid);
  if (check.git && !repo.hasGit) return skip(m.needsGit);
  try {
    return check.run(repo, probes);
  } catch (err) {
    if (err instanceof TimedOut) return skip(m.checkTimedOut(messages.timedOut(err.what)));
    return fail(m.checkThrew(firstLine(err?.message ?? err)));
  }
}

/** `[name, { status, note }]` for every registered check, in order. */
export const runChecks = (repo, probes) =>
  Object.entries(CHECKS).map(([name, check]) => [name, runOne(check, repo, probes)]);
