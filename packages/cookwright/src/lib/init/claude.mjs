// src/lib/init/claude.mjs — the claude host's two steps: the root CLAUDE.md imports
// AGENTS.md when anything would make Claude Code ignore it (step 4), and the
// project settings run doctor at session start (step 5). Everything about Claude
// Code comes from its host-table entry; detection is doctor's own.

import path from 'node:path';

import { Refusal } from '../cli.mjs';
import { shadowingFiles, sessionStartCommands } from '../doctor/claude.mjs';
import { sameFile } from '../doctor/repo.mjs';
import { HOSTS } from '../hosts.mjs';
import { messages } from '../messages.mjs';
import { atLeast } from '../probes.mjs';
import { RULES_FILE, hasImport } from '../rules/block.mjs';
import { KEPT, SKIPPED, UPDATED, WROTE, eolOf, readTarget, reserialize, row } from './files.mjs';

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

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The parsed settings, refused when they are not JSON or not a shape init can extend. */
function parseSettings(text, file) {
  let settings;
  try {
    settings = JSON.parse(text);
  } catch (err) {
    throw new Refusal(m.settingsInvalid(file, err.message));
  }
  if (!isObj(settings)) throw new Refusal(m.settingsShape(file));
  if (settings.hooks !== undefined && !isObj(settings.hooks)) throw new Refusal(m.settingsShape(file, 'hooks'));
  const groups = settings.hooks?.SessionStart;
  if (groups !== undefined && !Array.isArray(groups)) throw new Refusal(m.settingsShape(file, 'hooks.SessionStart'));
  return settings;
}

/** Replace, in place, every hook whose command is an earlier HOOK_COMMAND; true if any. */
function replacePast(settings, entry) {
  let found = false;
  for (const group of settings.hooks?.SessionStart ?? []) {
    for (const h of Array.isArray(group?.hooks) ? group.hooks : []) {
      if (h?.type === 'command' && entry.hookCommandsPast.includes(h.command)) {
        h.command = entry.hookCommand;
        found = true;
      }
    }
  }
  return found;
}

/** Step 5. No matcher: doctor runs on startup, resume, clear and compact. */
export function claudeHookStep(repo, io, entry = host) {
  const file = entry.settings;
  const hook = { type: 'command', command: entry.hookCommand, timeout: entry.hookTimeout };
  const text = readTarget(repo.root, file);
  if (text === null) {
    const fresh = { hooks: { SessionStart: [{ hooks: [hook] }] } };
    return row(WROTE, file, m.hostHook.wrote, [{ rel: file, content: `${JSON.stringify(fresh, null, 2)}\n` }]);
  }
  const settings = parseSettings(text, file);
  if (sessionStartCommands(settings).includes(entry.hookCommand)) return row(KEPT, file, m.hostHook.kept);
  const replaced = replacePast(settings, entry);
  if (!replaced) {
    settings.hooks ??= {};
    settings.hooks.SessionStart ??= [];
    settings.hooks.SessionStart.push({ hooks: [hook] });
  }
  // The file is re-serialised: say so when that changes more than the hook (a
  // one-line array, unusual spacing), rather than claim the rest is untouched.
  const relaid = reserialize(JSON.parse(text), text) !== text;
  const note = `${replaced ? m.hostHook.replaced : m.hostHook.added}${relaid ? m.hostHook.relaid : ''}`;
  return row(UPDATED, file, note, [{ rel: file, content: reserialize(settings, text) }]);
}
