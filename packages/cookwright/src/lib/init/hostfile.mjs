// src/lib/init/hostfile.mjs — the hook step every host shares: write or merge the
// doctor SessionStart hook into the host's project hooks file (Claude Code's
// .claude/settings.json, Codex's .codex/hooks.json), named by its host-table entry.
//
// A hook is identified by its command and, when the host gives one, its matcher;
// detection is doctor's own reader. The file is rewritten only when the hook is
// absent, an earlier version, or has a copy under another matcher: a Codex user
// trusts the file's hooks with /hooks, and a rewrite asks for that again.

import { Refusal } from '../cli.mjs';
import { sessionStartHooks } from '../doctor/claude.mjs';
import { messages } from '../messages.mjs';
import { KEPT, UPDATED, WROTE, readTarget, reserialize, row } from './files.mjs';

const m = messages.init;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The parsed file, refused when it is not JSON or not a shape init can extend. */
function parseSettings(text, file, host) {
  let settings;
  try {
    settings = JSON.parse(text);
  } catch (err) {
    throw new Refusal(m.settingsInvalid(file, err.message));
  }
  if (!isObj(settings)) throw new Refusal(m.settingsShape(file, undefined, host));
  if (settings.hooks !== undefined && !isObj(settings.hooks)) throw new Refusal(m.settingsShape(file, 'hooks', host));
  const groups = settings.hooks?.SessionStart;
  if (groups !== undefined && !Array.isArray(groups)) throw new Refusal(m.settingsShape(file, 'hooks.SessionStart', host));
  return settings;
}

const groupsOf = (settings) => settings.hooks?.SessionStart ?? [];
const hooksOf = (group) => (Array.isArray(group?.hooks) ? group.hooks : []);
const ours = (entry) => (h) => h?.type === 'command' && h.command === entry.hookCommand;

/** Replace, in place, every hook whose command is an earlier one; true if any. */
function replacePast(settings, entry) {
  let found = false;
  for (const h of groupsOf(settings).flatMap(hooksOf)) {
    if (h?.type === 'command' && entry.hookCommandsPast.includes(h.command)) {
      h.command = entry.hookCommand;
      found = true;
    }
  }
  return found;
}

/** The current hook, as doctor reads it: the command, under the host's matcher when it has one. */
export const hasHook = (settings, entry) =>
  sessionStartHooks(settings).some(
    (h) => h.command === entry.hookCommand && (entry.hookMatcher === null || h.matcher === entry.hookMatcher),
  );

/** A copy of the current hook under another matcher than the host's, beside or instead of the right one. */
const hasStray = (settings, entry) =>
  entry.hookMatcher !== null &&
  sessionStartHooks(settings).some((h) => h.command === entry.hookCommand && h.matcher !== entry.hookMatcher);

/** Take the hook out of every group under another matcher, dropping a group left empty; true if any. */
function unmatch(settings, entry) {
  const groups = groupsOf(settings);
  const wrong = groups.filter((g) => g?.matcher !== entry.hookMatcher && hooksOf(g).some(ours(entry)));
  for (const g of wrong) g.hooks = g.hooks.filter((h) => !ours(entry)(h));
  if (wrong.length) settings.hooks.SessionStart = groups.filter((g) => !wrong.includes(g) || g.hooks.length);
  return wrong.length > 0;
}

/** A SessionStart group holding the doctor hook alone, under the host's matcher when it has one. */
const group = (entry) => ({
  ...(entry.hookMatcher === null ? {} : { matcher: entry.hookMatcher }),
  hooks: [{ type: 'command', command: entry.hookCommand, timeout: entry.hookTimeout }],
});

/** What changed, as the row's note; `how` is replaced, matcher, stray or added. */
function updatedNote(entry, how, relaid) {
  const said = how === 'matcher' || how === 'stray' ? m.hostHook[how](entry.hookMatcher) : m.hostHook[how];
  return `${said}${relaid ? m.hostHook.relaid : ''}${entry.hookTrust ? m.hostHook.trustAgain(entry.name, entry.hookTrust) : ''}`;
}

/** The hook step for the host-table `entry`: a row for its hooks file. */
export function hookFileStep(repo, entry) {
  const file = entry.settings;
  const text = readTarget(repo.root, file);
  if (text === null) {
    const fresh = { hooks: { SessionStart: [group(entry)] } };
    const note = `${m.hostHook.wrote}${entry.hookTrust ? m.hostHook.trust(entry.name, entry.hookTrust) : ''}`;
    return row(WROTE, file, note, [{ rel: file, content: `${JSON.stringify(fresh, null, 2)}\n` }]);
  }
  const settings = parseSettings(text, file, entry.name);
  const had = hasHook(settings, entry);
  if (had && !hasStray(settings, entry)) return row(KEPT, file, m.hostHook.kept);
  const replaced = replacePast(settings, entry);
  let how = replaced ? 'replaced' : 'added';
  if (entry.hookMatcher !== null && unmatch(settings, entry)) how = replaced ? how : had ? 'stray' : 'matcher';
  if (!hasHook(settings, entry)) {
    settings.hooks ??= {};
    settings.hooks.SessionStart ??= [];
    settings.hooks.SessionStart.push(group(entry));
  }
  // The file is re-serialised: say so when that changes more than the hook (a
  // one-line array, unusual spacing), rather than claim the rest is untouched.
  const relaid = reserialize(JSON.parse(text), text) !== text;
  return row(UPDATED, file, updatedNote(entry, how, relaid), [{ rel: file, content: reserialize(settings, text) }]);
}
