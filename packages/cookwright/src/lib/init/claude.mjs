// src/lib/init/claude.mjs — the claude host's two steps: the root CLAUDE.md imports
// AGENTS.md when anything would make Claude Code ignore it (step 4), and the
// project settings run doctor at session start (step 5, init/hostfile.mjs). Everything
// about Claude Code comes from its host-table entry; detection is doctor's own.

import path from 'node:path';

import { shadowingFiles } from '../doctor/claude.mjs';
import { sameFile } from '../doctor/repo.mjs';
import { HOSTS } from '../hosts.mjs';
import { messages } from '../messages.mjs';
import { atLeast } from '../probes.mjs';
import { RULES_FILE, hasImport } from '../rules/block.mjs';
import { KEPT, SKIPPED, UPDATED, WROTE, eolOf, readTarget, row } from './files.mjs';
import { hookFileStep } from './hostfile.mjs';

const m = messages.init;
const host = HOSTS.claude;
const ROOT_RULES = 'CLAUDE.md';

/** Step 4. The version probe runs only when nothing shadows AGENTS.md. */
export function claudeRulesStep(repo, io, entry = host) {
  const token = entry.importLine;
  // CLAUDE.md linked to AGENTS.md: Claude reads the rules through the link, and
  // prepending would rewrite AGENTS.md from its pre-block text.
  if (sameFile(path.join(repo.root, ROOT_RULES), path.join(repo.root, RULES_FILE))) {
    return row(KEPT, ROOT_RULES, m.hostRules.linked);
  }
  const text = readTarget(repo.root, ROOT_RULES);
  if (text !== null) {
    if (hasImport(text, token)) return row(KEPT, ROOT_RULES, m.hostRules.imports(token));
    const eol = eolOf(text);
    const content = `${token}${eol}${eol}${text}`;
    return row(UPDATED, ROOT_RULES, m.hostRules.prepended(token), [{ rel: ROOT_RULES, content }]);
  }
  const write = [{ rel: ROOT_RULES, content: `${token}\n` }];
  const shadows = shadowingFiles(repo).map((p) => path.relative(repo.root, p));
  if (shadows.length) return row(WROTE, ROOT_RULES, m.hostRules.shadowed(token, shadows), write);
  const version = io.probes.claudeVersion();
  if (version && !atLeast(version, entry.agentsNativeSince)) {
    return row(WROTE, ROOT_RULES, m.hostRules.old(token, version, entry.agentsNativeSince), write);
  }
  return row(SKIPPED, ROOT_RULES, version ? m.hostRules.native(version) : m.hostRules.noClaude);
}

/** Step 5. No matcher: doctor runs on startup, resume, clear and compact. */
export const claudeHookStep = (repo, io, entry = host) => hookFileStep(repo, entry);
