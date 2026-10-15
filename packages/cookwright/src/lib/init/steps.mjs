// src/lib/init/steps.mjs — init's steps, in order, and the preflight that computes
// every row before anything is written.
//
// A step is `(repo, io) → row`; it reads, never writes. Step 1 sets `repo.config`,
// which the later steps read. A second host adds its two steps to HOST_STEPS.

import { claudeHookStep, claudeRulesStep } from './claude.mjs';
import { configStep } from './config.mjs';
import { gitignoreStep } from './gitignore.mjs';
import { backlogStep, changelogStep, closeoutsStep } from './homes.mjs';
import { blockStep } from './rules.mjs';

const HOST_STEPS = Object.freeze({
  claude: { rules: claudeRulesStep, hook: claudeHookStep },
});

/** The default host's step of `kind` (the first configured host). */
const hostStep = (kind) => (repo, io) => HOST_STEPS[repo.config.hosts[0]][kind](repo, io);

export const STEPS = Object.freeze([
  configStep,
  backlogStep,
  closeoutsStep,
  changelogStep,
  blockStep,
  hostStep('rules'),
  hostStep('hook'),
  gitignoreStep,
]);

/** Every row, in order; any refusal throws before a single write. */
export const preflight = (repo, io) => STEPS.map((step) => step(repo, io));
