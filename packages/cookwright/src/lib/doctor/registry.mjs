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
import { fail, skip } from '../verdict.mjs';
import { checkConfig, checkGit } from './basics.mjs';
import { checkClaudeHook, checkClaudeRules } from './claude.mjs';
import { checkBacklog, checkChangelog, checkCloseouts, checkIds } from './homes.mjs';
import { checkBlock, checkSize } from './rules.mjs';
import { checkSecrets } from './secrets.mjs';

const m = messages.doctor;

/** Each host's two checks; a second host adds its pair here. */
const HOST_CHECKS = Object.freeze({
  claude: { rules: checkClaudeRules, hook: checkClaudeHook },
});

/** The default host's check of `kind` (the first configured host). */
const hostCheck = (kind) => (repo, probes) => HOST_CHECKS[repo.config.hosts[0]][kind](repo, probes);

export const CHECKS = Object.freeze({
  config: { run: checkConfig },
  git: { run: checkGit, git: true },
  'homes.backlog': { run: checkBacklog, config: true },
  'homes.closeouts': { run: checkCloseouts, config: true },
  'homes.changelog': { run: checkChangelog, config: true },
  'backlog.ids': { run: checkIds, config: true },
  'rules.block': { run: checkBlock, config: true },
  'rules.size': { run: checkSize },
  'host.rules': { run: hostCheck('rules'), config: true },
  'host.hook': { run: hostCheck('hook'), config: true },
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
