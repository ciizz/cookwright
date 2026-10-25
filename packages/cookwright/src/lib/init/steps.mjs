// src/lib/init/steps.mjs — init's steps, in order, and the preflight that computes
// every row before anything is written.
//
// A step is `(repo, io) → row`, or a list of rows (the hooks step has three); it
// reads, never writes. Step 1 sets `repo.config`, which the later steps read. A
// host adds its steps to HOST_STEPS; the rules, hook and pointers steps run for every
// configured host, in the config's order; the pack steps iterate the declared packs
// themselves, each writing files no other step writes.

import { claudeHookStep, claudeRulesStep } from './claude.mjs';
import { codexHookStep, codexRulesStep } from './codex.mjs';
import { configStep } from './config.mjs';
import { refuseLinks } from './files.mjs';
import { gitignoreStep } from './gitignore.mjs';
import { hooksStep } from './hooks.mjs';
import { backlogStep, changelogStep, closeoutsStep } from './homes.mjs';
import { packDocsStep } from './packs.mjs';
import { pointersStep } from './pointers.mjs';
import { rulesFileStep } from './rules.mjs';

const HOST_STEPS = Object.freeze({
  claude: { rules: claudeRulesStep, hook: claudeHookStep, pointers: pointersStep('claude') },
  codex: { rules: codexRulesStep, hook: codexHookStep, pointers: pointersStep('codex') },
});

/** Every configured host's step of `kind`, in the config's order. */
const everyHost = (kind) => (repo, io) => repo.config.hosts.flatMap((h) => HOST_STEPS[h][kind](repo, io));

export const STEPS = Object.freeze([
  configStep,
  backlogStep,
  closeoutsStep,
  changelogStep,
  rulesFileStep,
  packDocsStep,
  everyHost('rules'),
  everyHost('hook'),
  everyHost('pointers'),
  gitignoreStep,
  hooksStep,
]);

/** Every row, in order; any refusal throws before a single write. */
export function preflight(repo, io) {
  const rows = STEPS.flatMap((step) => step(repo, io));
  refuseLinks(repo.root, rows);
  return rows;
}
