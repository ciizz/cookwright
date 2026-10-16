// src/lib/doctor/codex.mjs — the codex host's two checks: Codex reads the AGENTS.md
// rules (`host.rules`), and its project hooks file runs doctor at session start
// (`host.hook`). Everything about Codex comes from its host-table entry; init's
// Codex steps (init/codex.mjs) read the same answers.

import fs from 'node:fs';
import path from 'node:path';

import { HOSTS } from '../hosts.mjs';
import { messages } from '../messages.mjs';
import { RULES_FILE } from '../rules/block.mjs';
import { fail, pass, warn } from '../verdict.mjs';
import { sessionStartHooks } from './claude.mjs';
import { placement } from './hooks.mjs';
import { isFile } from './repo.mjs';

const m = messages.doctor.codex;
const host = HOSTS.codex;

const posix = (p) => p.split(path.sep).join('/');

/**
 * Every override (`AGENTS.override.md`) from the invocation directory up through the
 * config root, root-relative and POSIX, the nearest first. Codex reads one in place
 * of the AGENTS.md beside it. An invocation directory outside the root scans the
 * root alone.
 */
export function overrideFiles({ root, cwd = root }, entry = host) {
  const inside = !path.relative(root, cwd).startsWith('..');
  const found = [];
  for (let dir = inside ? cwd : root; ; dir = path.dirname(dir)) {
    for (const name of entry.shadowing) {
      if (isFile(path.join(dir, name))) found.push(posix(path.relative(root, path.join(dir, name))));
    }
    if (dir === root || path.dirname(dir) === dir) return found;
  }
}

/** PASS: AGENTS.md at the root and no override on the path to it; WARN names each override. */
export function checkCodexRules(repo) {
  if (!isFile(path.join(repo.root, RULES_FILE))) return fail(m.rules.none(RULES_FILE));
  const found = overrideFiles(repo);
  return found.length ? warn(m.rules.override(found)) : pass(m.rules.native(host.shadowing[0]));
}

/**
 * PASS: the hooks file carries the doctor hook, by command and matcher, and no copy
 * of it under another matcher (which would run doctor on that event too). Whether
 * the user trusted it is not measured, and the line says so. WARN when the config
 * root is below the work tree's top, where the hook's readout cannot reach it.
 */
export function checkCodexHook(repo, probes, entry = host) {
  const file = entry.settings;
  const abs = path.join(repo.root, file);
  if (!isFile(abs)) return fail(m.hook.none(file));
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    return fail(messages.doctor.hostHook.invalid(file, err.message));
  }
  const hooks = sessionStartHooks(settings);
  const mine = hooks.filter((h) => h.command === entry.hookCommand);
  const right = mine.some((h) => h.matcher === entry.hookMatcher);
  const stray = mine.find((h) => h.matcher !== entry.hookMatcher);
  if (right && stray) return warn(m.hook.stray(file, stray.matcher, entry.hookMatcher));
  if (right) {
    // The command enters the work tree's top; from there doctor finds no config
    // below it, so for a nested config root the hook gives no readout (B-002).
    const { rel } = placement(repo.root, repo.top ?? repo.root);
    return rel ? warn(m.hook.nested(file, rel)) : pass(m.hook.ok(file, entry.hookTrust));
  }
  if (stray) return warn(m.hook.matcher(file, stray.matcher, entry.hookMatcher));
  if (hooks.some((h) => entry.hookCommandsPast.includes(h.command))) return warn(messages.doctor.hostHook.past(file));
  return fail(m.hook.none(file));
}
