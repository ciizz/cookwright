// src/lib/init/hooks.mjs — step 8: the git hooks (plan §4.3). Three rows:
// `hooks.path`, `.githooks/pre-commit`, `.githooks/pre-push` (under the work tree's
// top, so `../../.githooks/…` from a config root two levels below it).
//
// A foreign setup (core.hooksPath elsewhere or from another scope, a user's hook in
// git's hooks directory, a .githooks file that does not call cookwright) skips all
// three with the reason: nothing written, nothing configured, a user's script never
// edited. Otherwise the shims are written (mode 0755) and core.hooksPath is set in
// the local config by a git write, which the runner applies after every file write,
// so the path is never active before both shims exist and are executable.

import { TimedOut } from '../budget.mjs';
import { Refusal } from '../cli.mjs';
import { hookRel, hooksSetup } from '../doctor/hooks.mjs';
import { HOOKS_DIR, HOOK_NAMES, shimText } from '../hooks/shims.mjs';
import { messages } from '../messages.mjs';
import { KEPT, SKIPPED, UPDATED, WROTE, row } from './files.mjs';

const m = messages.init.hooks;
export const PATH_TARGET = 'hooks.path';
const MODE = 0o755;

function setup(root, top) {
  try {
    return hooksSetup(root, top);
  } catch (err) {
    if (err instanceof TimedOut) throw err;
    throw new Refusal(err.message);
  }
}

function pathRow(configured, up) {
  if (configured) return row(KEPT, PATH_TARGET, m.pathKept(HOOKS_DIR));
  const git = ['config', '--local', 'core.hooksPath', HOOKS_DIR];
  return row(WROTE, PATH_TARGET, m.pathSet(HOOKS_DIR), [{ git, inert: HOOK_NAMES.map((n) => hookRel(n, up)) }]);
}

function shimRow(file, name, at) {
  const { rel } = file;
  if (file.kind === 'none') return row(WROTE, rel, m.shim, [{ rel, content: shimText(name, at.rel), mode: MODE }]);
  if (file.kind !== 'file') throw new Refusal(messages.init.notAFile(rel));
  if (!file.executable) return row(UPDATED, rel, m.modeFixed, [{ rel, mode: MODE }]);
  return row(KEPT, rel, file.ours ? m.shimKept : m.calls);
}

/**
 * The shims go to the work tree's top (`repo.top`), where git looks for
 * `.githooks`; when the config root is below it, they enter the config root first.
 */
export function hooksStep(repo) {
  const s = setup(repo.root, repo.top ?? repo.root);
  const targets = [PATH_TARGET, ...HOOK_NAMES.map((n) => hookRel(n, s.at.up))];
  if (s.foreign) return targets.map((t) => row(SKIPPED, t, s.foreign));
  return [pathRow(s.configured, s.at.up), ...HOOK_NAMES.map((name) => shimRow(s.files[name], name, s.at))];
}
