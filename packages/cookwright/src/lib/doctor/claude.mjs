// src/lib/doctor/claude.mjs — the claude host's two checks: Claude Code reads the
// AGENTS.md rules (`host.rules`), and the session-start hook runs doctor
// (`host.hook`). Everything about Claude Code comes from its host-table entry.

import fs from 'node:fs';
import path from 'node:path';

import { HOSTS } from '../hosts.mjs';
import { messages } from '../messages.mjs';
import { atLeast } from '../probes.mjs';
import { RULES_FILE, hasImport } from '../rules/block.mjs';
import { fail, pass, skip, warn } from '../verdict.mjs';
import { isFile, sameFile } from './repo.mjs';

const m = messages.doctor;
const host = HOSTS.claude;

/**
 * Every shadowing file from the invocation cwd upward, through the root and its
 * ancestors, as absolute paths. In the home directory, `.claude/` holds the user's
 * own settings (`~/.claude/CLAUDE.md` does not shadow), so it is not scanned there.
 */
export function shadowingFiles({ cwd, home }) {
  const found = [];
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    for (const name of host.shadowing) {
      if (dir === home && name.startsWith('.claude/')) continue;
      if (isFile(path.join(dir, name))) found.push(path.join(dir, name));
    }
    if (path.dirname(dir) === dir) return found;
  }
}

/**
 * PASS: the root CLAUDE.md imports AGENTS.md, or nothing shadows it and Claude Code
 * reads it natively. The version probe runs only when its answer matters.
 */
export function checkClaudeRules(repo, probes) {
  const rootClaude = path.join(repo.root, 'CLAUDE.md');
  const rules = path.join(repo.root, RULES_FILE);
  if (isFile(rules) && sameFile(rootClaude, rules)) return pass(m.hostRules.linked);
  if (isFile(rootClaude) && hasImport(fs.readFileSync(rootClaude, 'utf8'), host.importLine)) {
    return pass(m.hostRules.imports('CLAUDE.md', host.importLine));
  }
  const found = shadowingFiles(repo).map((p) => path.relative(repo.root, p));
  if (found.length) return fail(m.hostRules.shadowed(found, host.importLine));
  const version = probes.claudeVersion();
  if (!version) return skip(m.hostRules.noClaude);
  if (!atLeast(version, host.agentsNativeSince)) {
    return fail(m.hostRules.old(version, host.agentsNativeSince));
  }
  return pass(m.hostRules.native(version));
}

/**
 * Every SessionStart command hook in a parsed hooks file, as `{ command, matcher }`;
 * `matcher` is its group's, undefined when the group has none.
 */
export function sessionStartHooks(settings) {
  const groups = settings?.hooks?.SessionStart;
  if (!Array.isArray(groups)) return [];
  return groups.flatMap((g) =>
    (Array.isArray(g?.hooks) ? g.hooks : [])
      .filter((h) => h?.type === 'command' && typeof h.command === 'string')
      .map((h) => ({ command: h.command, matcher: g.matcher })),
  );
}

/** The `command` of every SessionStart hook entry in a parsed settings object. */
export const sessionStartCommands = (settings) => sessionStartHooks(settings).map((h) => h.command);

/**
 * Detection is by equality with HOOK_COMMAND, never a substring search. `entry` is
 * the host-table entry (a test passes one with a past command).
 */
export function checkClaudeHook(repo, probes, entry = host) {
  const file = entry.settings;
  const abs = path.join(repo.root, file);
  if (!isFile(abs)) return fail(m.hostHook.none(file));
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    return fail(m.hostHook.invalid(file, err.message));
  }
  const commands = sessionStartCommands(settings);
  if (commands.includes(entry.hookCommand)) return pass(m.hostHook.ok(file));
  if (commands.some((c) => entry.hookCommandsPast.includes(c))) return warn(m.hostHook.past(file));
  return fail(m.hostHook.none(file));
}
