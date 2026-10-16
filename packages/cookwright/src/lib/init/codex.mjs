// src/lib/init/codex.mjs — the codex host's two steps. Codex reads AGENTS.md
// natively, so its rules row derives from the block row (the block step writes
// AGENTS.md in the same run) and writes nothing: it names any AGENTS.override.md
// Codex would read in its place, which is the user's and never touched. The hook
// step writes or merges .codex/hooks.json (init/hostfile.mjs).

import { overrideFiles } from '../doctor/codex.mjs';
import { HOSTS } from '../hosts.mjs';
import { messages } from '../messages.mjs';
import { SKIPPED, row } from './files.mjs';
import { hookFileStep } from './hostfile.mjs';

const m = messages.init.codex;
const host = HOSTS.codex;

/** The rules row: the override Codex would read instead, else the name it would have. */
export function codexRulesStep(repo) {
  const found = overrideFiles(repo);
  if (found.length) return row(SKIPPED, found[0], m.override(found));
  return row(SKIPPED, host.shadowing[0], m.native);
}

/** The hook step: the doctor hook under `startup|resume`, the file rewritten only when it must be. */
export const codexHookStep = (repo, io, entry = host) => hookFileStep(repo, entry);
