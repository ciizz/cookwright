// src/lib/doctor/hooks.mjs — where the repo's git hooks stand (plan §4.3, §4.6):
// the effective core.hooksPath and its scope, the user's own hooks in git's hooks
// directory, and cookwright's two files under .githooks. init's hooks step and
// doctor's hooks checks read the same answer, so they never disagree on "foreign".
//
// The scope comes from `--show-scope`, never `--show-origin`, whose absolute path
// (from a linked worktree) must not reach a readout; git's hooks directory is shown
// relative to the root for the same reason.

import fs from 'node:fs';
import path from 'node:path';

import { HOOKS_DIR, HOOK_NAMES, callsCookwright, shimText } from '../hooks/shims.mjs';
import { messages } from '../messages.mjs';
import { gitRun, isLink } from './repo.mjs';

const firstLine = (r) => (r.stderr || '').trim().split('\n')[0] || `exit ${r.status}`;

/** Executable for its owner, group or others; Windows has no such bit. */
const executable = (st) => process.platform === 'win32' || (st.mode & 0o111) !== 0;

/** The root-relative path of hook `name`'s file. */
export const hookRel = (name) => `${HOOKS_DIR}/${name}`;

/** `{ scope, value }` of the effective core.hooksPath, or null when it is set nowhere. */
function configuredPath(root) {
  const r = gitRun(root, ['config', '--show-scope', '--get', 'core.hooksPath']);
  if (r.status === 1) return null;
  if (r.status !== 0) throw new Error(messages.probeFailed('git config core.hooksPath', firstLine(r)));
  const [scope, ...value] = r.stdout.replace(/\r?\n$/, '').split('\t');
  return { scope, value: value.join('\t') };
}

/** git's own hooks directory (root-relative) and the hooks a user put there. */
function hooksDirEntries(root) {
  const r = gitRun(root, ['rev-parse', '--git-path', 'hooks']);
  if (r.status !== 0) throw new Error(messages.probeFailed('git rev-parse --git-path hooks', firstLine(r)));
  const abs = path.resolve(root, r.stdout.trim());
  let entries = [];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    entries = [];
  }
  const names = entries
    .filter((e) => !e.isDirectory() && !e.name.endsWith('.sample') && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
  return { dir: path.relative(root, abs) || '.', names };
}

/**
 * Hook `name`'s file under .githooks: `kind` none, file or other (a directory, a
 * dangling link); for a file, whether it is our shim byte for byte, whether it
 * calls cookwright in a form that keeps a finding's exit code, and its mode.
 */
export function hookFile(root, name) {
  const rel = hookRel(name);
  const abs = path.join(root, rel);
  let st;
  try {
    st = fs.statSync(abs);
  } catch {
    return { rel, kind: isLink(abs) ? 'other' : 'none' };
  }
  if (!st.isFile()) return { rel, kind: 'other' };
  const text = fs.readFileSync(abs, 'utf8');
  return { rel, kind: 'file', ours: text === shimText(name), calls: callsCookwright(text, name), executable: executable(st) };
}

/** Why the hooks are someone else's, or null: the first of the three foreign cases. */
function foreignReason(root, configured, files) {
  const f = messages.foreignHooks;
  if (configured && (configured.value !== HOOKS_DIR || configured.scope !== 'local')) {
    return f.path(configured.value, configured.scope);
  }
  if (!configured) {
    const { dir, names } = hooksDirEntries(root);
    if (names.length) return f.dir(dir, names);
  }
  const theirs = Object.values(files).find((x) => x.kind === 'file' && !x.calls);
  return theirs ? f.file(theirs.rel) : null;
}

/**
 * `{ configured, files, foreign }`: the effective core.hooksPath (null when unset),
 * each hook file by name, and the reason the setup is foreign, or null. Foreign is
 * core.hooksPath set to anything but the relative `.githooks` or from a scope other
 * than `local`; unset with a user's hook in git's hooks directory; or a .githooks
 * file that does not call cookwright. Throws on a git failure (TimedOut on a stall).
 */
export function hooksSetup(root) {
  const configured = configuredPath(root);
  const files = Object.fromEntries(HOOK_NAMES.map((name) => [name, hookFile(root, name)]));
  return { configured, files, foreign: foreignReason(root, configured, files) };
}
