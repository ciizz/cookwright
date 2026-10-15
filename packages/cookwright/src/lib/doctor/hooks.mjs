// src/lib/doctor/hooks.mjs — where the repo's git hooks stand (plan §4.3, §4.6),
// and doctor's five hook checks (`hooks.path`, `hooks.pre-commit`, `hooks.pre-push`,
// `tools.gitleaks`, `gate.scripts`). The setup reader answers with the effective
// core.hooksPath and its scope, the user's own hooks in git's hooks directory, and
// cookwright's two files under .githooks. init's hooks step and doctor's checks
// read the same answer, so they never disagree on "foreign".
//
// The scope comes from `--show-scope`, never `--show-origin`, whose absolute path
// (from a linked worktree) must not reach a readout; git's hooks directory and the
// path's value are shown root-relative for the same reason, or as a phrase when
// they are absolute or outside the repo. A git older than 2.26 refuses
// `--show-scope`; the reader then tells local from not-local with `--local`, and
// never fails on the missing option.

import fs from 'node:fs';
import path from 'node:path';

import { TimedOut } from '../budget.mjs';
import { scriptProblems } from '../bundle/gate.mjs';
import { BIN, HOOKS_DIR, HOOK_NAMES, callsCookwright, shimText } from '../hooks/shims.mjs';
import { messages } from '../messages.mjs';
import { fail, pass, skip, warn } from '../verdict.mjs';
import { gitRun, isFile, isLink } from './repo.mjs';

const firstLine = (r) => (r.stderr || '').trim().split('\n')[0] || `exit ${r.status}`;

/** Executable for its owner, group or others; Windows has no such bit. */
const executable = (st) => process.platform === 'win32' || (st.mode & 0o111) !== 0;

const posix = (p) => p.split(path.sep).join('/');

/**
 * Where the hooks sit for a config root `root` in the work tree whose top is `top`:
 * `rel`, the root's path from the top (empty when they are one directory), which
 * the shim enters; `up`, the top's path from the root, where the shims are written,
 * since git runs hooks and resolves `.githooks` from the top.
 */
export const placement = (root, top = root) => ({ rel: posix(path.relative(top, root)), up: posix(path.relative(root, top)) });

/** The root-relative path of hook `name`'s file: under the work tree's top (`up`). */
export const hookRel = (name, up = '') => (up ? `${up}/${HOOKS_DIR}/${name}` : `${HOOKS_DIR}/${name}`);

const configFailed = (r) => new Error(messages.probeFailed('git config core.hooksPath', firstLine(r)));
const chomp = (text) => text.replace(/\r?\n$/, '');

/** git before 2.26 has no `--show-scope`: a usage error, exit 129. */
const noScopes = (r) => r.status === 129 || /unknown option/i.test(r.stderr ?? '');

/**
 * The effective core.hooksPath without `--show-scope`: `local` when the local
 * config holds the effective value, otherwise a scope word saying only that it is
 * not the local config (git before 2.26 cannot name it).
 */
function configuredPathNoScope(root) {
  const any = gitRun(root, ['config', '--get', 'core.hooksPath']);
  if (any.status === 1) return null;
  if (any.status !== 0) throw configFailed(any);
  const value = chomp(any.stdout);
  const local = gitRun(root, ['config', '--local', '--get', 'core.hooksPath']);
  const isLocal = local.status === 0 && chomp(local.stdout) === value;
  return { scope: isLocal ? 'local' : messages.foreignHooks.notLocal, value };
}

/** `{ scope, value }` of the effective core.hooksPath, or null when it is set nowhere. */
function configuredPath(root) {
  const r = gitRun(root, ['config', '--show-scope', '--get', 'core.hooksPath']);
  if (r.status === 1) return null;
  if (r.status !== 0 && noScopes(r)) return configuredPathNoScope(root);
  if (r.status !== 0) throw configFailed(r);
  const [scope, ...value] = chomp(r.stdout).split('\t');
  return { scope, value: value.join('\t') };
}

/** git's own hooks directory (shown from the top) and the hooks a user put there. */
function hooksDirEntries(root, top) {
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
  return { dir: shownDir(path.relative(top, abs)), names };
}

/** git's hooks directory for a readout: root-relative inside the repo, else a phrase. */
function shownDir(rel) {
  if (!rel) return '.';
  const outside = rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
  return outside ? messages.foreignHooks.gitHooksDir : rel.split(path.sep).join('/');
}

/**
 * core.hooksPath for a readout: verbatim when it is a relative path inside the
 * repo, otherwise a phrase, so no machine path (an absolute one, `~/…`, `../…`)
 * reaches a terminal, a transcript or a report.
 */
export function shownHooksPath(value) {
  const f = messages.foreignHooks;
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || value.startsWith('~')) return f.absolutePath;
  const norm = path.posix.normalize(value.replace(/\\/g, '/'));
  return norm === '..' || norm.startsWith('../') ? f.outsidePath : value;
}

/**
 * Hook `name`'s file under .githooks: `kind` none, file or other (a directory, a
 * dangling link); for a file, whether it is our shim byte for byte, whether it
 * calls cookwright in a form that keeps a finding's exit code, and its mode.
 */
export function hookFile(root, name, at = placement(root)) {
  const rel = hookRel(name, at.up);
  const abs = path.join(root, rel);
  let st;
  try {
    st = fs.statSync(abs);
  } catch {
    return { rel, kind: isLink(abs) ? 'other' : 'none' };
  }
  if (!st.isFile()) return { rel, kind: 'other' };
  const text = fs.readFileSync(abs, 'utf8');
  const ours = text === shimText(name, at.rel);
  return { rel, kind: 'file', ours, calls: callsCookwright(text, name, at.rel), executable: executable(st) };
}

/** Why the hooks are someone else's, or null: the first of the three foreign cases. */
function foreignReason(root, top, configured, files) {
  const f = messages.foreignHooks;
  if (configured && (configured.value !== HOOKS_DIR || configured.scope !== 'local')) {
    return f.path(shownHooksPath(configured.value), configured.scope);
  }
  if (!configured) {
    const { dir, names } = hooksDirEntries(root, top);
    if (names.length) return f.dir(dir, names);
  }
  const theirs = Object.values(files).find((x) => x.kind === 'file' && !x.calls);
  return theirs ? f.file(theirs.rel) : null;
}

/**
 * `{ configured, files, at, foreign }`: the effective core.hooksPath (null when
 * unset), each hook file by name (under the work tree's top `top`), the placement,
 * and the reason the setup is foreign, or null. Foreign is core.hooksPath set to
 * anything but the relative `.githooks` or from a scope other than `local`; unset
 * with a user's hook in git's hooks directory; or a .githooks file that does not
 * call cookwright. Throws on a git failure (TimedOut on a stall).
 */
export function hooksSetup(root, top = root) {
  const at = placement(root, top);
  const configured = configuredPath(root);
  const files = Object.fromEntries(HOOK_NAMES.map((name) => [name, hookFile(root, name, at)]));
  return { configured, files, at, foreign: foreignReason(root, top, configured, files) };
}

// ── doctor's checks (plan §4.6) ──────────────────────────────────────────────

const m = messages.doctor;

/** The setup, read once per doctor run: three checks share it. */
const setupOf = (repo) => (repo.hooksSetup ??= hooksSetup(repo.root, repo.top ?? repo.root));

/**
 * `hooks.path`: PASS when core.hooksPath is `.githooks` from the local scope; WARN a
 * foreign setup, which is a chosen state, not drift; FAIL unset with nothing foreign.
 */
export function checkHooksPath(repo) {
  if (!repo.workTree) return skip(m.hooks.notWorkTree);
  const s = setupOf(repo);
  if (s.foreign) return warn(s.foreign);
  return s.configured ? pass(m.hooks.pathOk(HOOKS_DIR)) : fail(m.hooks.pathUnset);
}

/**
 * `hooks.pre-commit`, `hooks.pre-push`: the file calls cookwright and is executable,
 * and the package's bin is where the call looks for it (the config root): without
 * it the hook prints the not-installed line and checks nothing, a WARN.
 */
export const checkHookFile = (name) => (repo) => {
  if (!repo.workTree) return skip(m.hooks.notWorkTree);
  const s = setupOf(repo);
  if (s.foreign) return skip(m.hooks.elsewhere);
  const f = s.files[name];
  if (f.kind === 'none') return fail(m.hooks.missing(f.rel));
  if (f.kind !== 'file') return fail(m.hooks.notAFile(f.rel));
  if (!f.executable) return fail(m.hooks.notExecutable(f.rel));
  if (!isFile(path.join(repo.root, BIN))) return warn(m.hooks.notInstalled(f.rel));
  return pass(f.ours ? m.hooks.shim(f.rel) : m.hooks.calls(f.rel));
};

const stderrLine = (text) => (text ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';

/**
 * `tools.gitleaks`: on PATH, and one bounded dry run of the staged scan (output
 * discarded, at the work tree's top as the hook scans) exits 0 or 3, both meaning
 * it runs. Any other exit is drift the user can clear (a malformed .gitleaks.toml);
 * absent is a SKIP; a timeout unverified.
 */
export function checkGitleaks(repo, probes) {
  if (!probes.hasTool('gitleaks')) return skip(m.gitleaks.absent);
  if (!repo.workTree) return skip(m.hooks.notWorkTree);
  const r = probes.scanStaged(repo.top ?? repo.root, { quiet: true });
  if (r.timedOut) throw new TimedOut('gitleaks');
  if (r.status === 0 || r.status === 3) return pass(m.gitleaks.ok(probes.gitleaksVersion()));
  return fail(m.gitleaks.broken(r.status, stderrLine(r.stderr)));
}

/** `gate.scripts`: every npm script gate.checks runs is in package.json; no subprocess. */
export function checkGateScripts(repo) {
  const { checks } = repo.config.gate;
  if (!checks.length) return pass(m.gateScripts.none);
  const problems = scriptProblems(checks, repo.root);
  return problems.length ? fail(problems.join('; ')) : pass(m.gateScripts.ok(checks.length));
}
