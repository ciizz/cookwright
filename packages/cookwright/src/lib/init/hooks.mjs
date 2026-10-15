// src/lib/init/hooks.mjs — step 8: the git hooks (plan §4.3). Three rows:
// `hooks.path`, `.githooks/pre-commit`, `.githooks/pre-push`.
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

function setup(root) {
  try {
    return hooksSetup(root);
  } catch (err) {
    if (err instanceof TimedOut) throw err;
    throw new Refusal(err.message);
  }
}

function pathRow(configured) {
  if (configured) return row(KEPT, PATH_TARGET, m.pathKept(HOOKS_DIR));
  const git = ['config', '--local', 'core.hooksPath', HOOKS_DIR];
  return row(WROTE, PATH_TARGET, m.pathSet(HOOKS_DIR), [{ git, inert: HOOK_NAMES.map(hookRel) }]);
}

function shimRow(file, name) {
  const { rel } = file;
  if (file.kind === 'none') return row(WROTE, rel, m.shim, [{ rel, content: shimText(name), mode: MODE }]);
  if (file.kind !== 'file') throw new Refusal(messages.init.notAFile(rel));
  if (!file.executable) return row(UPDATED, rel, m.modeFixed, [{ rel, mode: MODE }]);
  return row(KEPT, rel, file.ours ? m.shimKept : m.calls);
}

export function hooksStep(repo) {
  const s = setup(repo.root);
  if (s.foreign) return [PATH_TARGET, ...HOOK_NAMES.map(hookRel)].map((t) => row(SKIPPED, t, s.foreign));
  return [pathRow(s.configured), ...HOOK_NAMES.map((name) => shimRow(s.files[name], name))];
}
