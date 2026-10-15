// src/lib/hooks/shims.mjs — the git hook files cookwright writes into a user's repo,
// and the test of whether a hook file calls cookwright (plan §4.2).
//
// The shim is content written into the user's repo, like HOOK_COMMAND in hosts.mjs,
// so its lines live here and this module imports nothing. The shim holds no logic:
// it calls `cookwright hook <name>` and maps the exit code, 10 (a check FAILed) to
// 1 for git, any other non-zero code to one crashed line and exit 0, so a module
// that does not load can never block a commit. No `exec` (the mapping needs the
// shell back) and no npx (it contacts the registry before refusing).

export const HOOKS_DIR = '.githooks';
export const HOOK_NAMES = Object.freeze(['pre-commit', 'pre-push']);

/** The exit code `cookwright hook` uses for a FAILed check, and only for that. */
export const FINDINGS_EXIT = 10;

const BIN = 'node_modules/cookwright/bin/cookwright.mjs';

/** What git is doing when the hook runs: the thing that goes through unchecked. */
const subject = (name) => (name === 'pre-push' ? 'push' : 'commit');

/** The shim's three fallback lines; each ends the hook at exit 0. */
export const fallbackLines = (name) =>
  Object.freeze({
    noNode: `cookwright ${name} skipped, needs node, run setup`,
    notInstalled: `cookwright ${name} skipped: package not installed (npm install)`,
    crashed: `cookwright ${name} crashed (exit $s); the ${subject(name)} goes through unchecked`,
  });

/** The call itself, as a user's own hook may carry it. */
export const callLine = (name) => `node ${BIN} hook ${name} "$@"`;

/** The managed shim for hook `name`: LF, written with mode 0755. */
export function shimText(name) {
  const lines = fallbackLines(name);
  return [
    '#!/bin/sh',
    '# Managed by cookwright (npx cookwright init). The logic is in the package; this file only calls it.',
    `command -v node >/dev/null 2>&1 || { echo "${lines.noNode}"; exit 0; }`,
    `[ -f ${BIN} ] || { echo "${lines.notInstalled}"; exit 0; }`,
    `${callLine(name)}; s=$?`,
    '[ $s -eq 0 ] && exit 0',
    `[ $s -eq ${FINDINGS_EXIT} ] && exit 1`,
    `echo "${lines.crashed}"; exit 0`,
    '',
  ].join('\n');
}

/**
 * True when `text` (a hook file) calls cookwright in a form where a finding's exit
 * code reaches git: our shim byte for byte; a line that is `exec <call>`,
 * `<call> || exit 1` or `<call> || exit $?`; or the call alone as the last line
 * that is neither blank nor a comment. `<call> || true`, any other suffix, or the
 * call followed by more commands swallows the status and is not a call. Whole
 * trimmed lines only, never a substring.
 */
export function callsCookwright(text, name) {
  if (text === shimText(name)) return true;
  const call = callLine(name);
  const lines = text.split('\n').map((l) => l.replace(/\r$/, '').trim());
  const forms = [`exec ${call}`, `${call} || exit 1`, `${call} || exit $?`];
  if (lines.some((l) => forms.includes(l))) return true;
  const last = lines.filter((l) => l !== '' && !l.startsWith('#')).at(-1);
  return last === call;
}
