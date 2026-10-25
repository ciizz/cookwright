// src/lib/bundle/gate.mjs — the gate between phases: every configured check, its
// result recorded against the commit it ran on.
//
// THE CHECKS come from cookwright.json (`gate.checks`): a name, a shell command and
// optionally the tools it needs and its `skipExit`, the exit with which a check that
// started says it could not measure (the standards checks' 11, stage-4 dispositions
// 4, 36 and 45): that exit records the check skipped, and such a check's first
// stdout line is recorded as its note on every outcome, so a pass says what it
// measured and what it did not (with the repo's path and the home directory
// replaced, and capped: `noteOf`). Without `skipExit`, every non-zero exit is a fail,
// 11 included. Every piece is optional (the charter): a check whose
// tool is missing, or whose command is not on PATH, is SKIPPED with a note and the
// gate goes on. A check that names an npm script the repo lacks is not absence but a
// misconfiguration, and the gate refuses it before anything runs. Two things are never optional: SOMETHING ran (a gate in which every
// check was skipped is refused, not recorded, so it can never stand as evidence), and
// a skip is visible wherever the gate is shown (`skipped` names on the event, in
// status, in the closeout table, as a WARN in the landing check).
//
// NO RETRY MECHANISM. A gate that fails is recorded failed. The playbook's flake
// policy lets the orchestrator re-gate once for a flake named in `gate.flakes`; the
// re-gate is a second event marked `retryOf`, and the red one stays in the state.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { messages } from './messages.mjs';

export const onPath = (bin) => spawnSync('which', [bin], { encoding: 'utf8' }).status === 0;

const words = (run) =>
  run.trim().split(/\s+/).filter((w) => w && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));

/** The executable a shell command starts with, past any leading VAR=value assignments. */
export const commandOf = (run) => words(run)[0] ?? '';

const NPM_ALIASES = { test: 'test', t: 'test', tst: 'test', start: 'start', stop: 'stop', restart: 'restart' };

/** The package.json script an `npm …` command names, or null when it names none. */
export function npmScriptOf(run) {
  const [cmd, sub, ...rest] = words(run);
  if (cmd !== 'npm' || !sub) return null;
  if (NPM_ALIASES[sub]) return NPM_ALIASES[sub];
  if (sub === 'run' || sub === 'run-script') return rest.find((w) => !w.startsWith('-')) ?? null;
  return null;
}

/**
 * A check that names an npm script the repo does not have is MISCONFIGURATION, not
 * absence (E-009): the gate refuses before anything runs, naming the script. Skipping
 * stays reserved for tools the developer has not installed.
 */
export function scriptProblems(checks, root) {
  const file = path.join(root, 'package.json');
  let scripts = null;
  if (fs.existsSync(file)) scripts = JSON.parse(fs.readFileSync(file, 'utf8')).scripts ?? {};
  const out = [];
  for (const check of checks) {
    const script = npmScriptOf(check.run);
    if (!script) continue;
    if (!scripts) out.push(messages.noPackageJson(check.name, script));
    else if (!(script in scripts)) out.push(messages.missingScript(check.name, script));
  }
  return out;
}

/**
 * The checks this gate runs, in order, each marked `skip` when a tool it needs — or
 * the command it starts with — is absent. Absence is decided HERE, before anything
 * runs: once a command has started, every non-zero exit is a failure, 127 included
 * (`npm test` with its runner not installed exits 127 and must stay red).
 */
export function planChecks({ checks, hasTool = onPath }) {
  return checks.map((check) => {
    const missing = (check.needs ?? []).find((tool) => !hasTool(tool));
    if (missing) return { ...check, skip: messages.skippedNeeds(missing) };
    const cmd = commandOf(check.run);
    if (!hasTool(cmd)) return { ...check, skip: messages.skippedNotFound(cmd) };
    return check;
  });
}

/** A check's result from its exit: 0 pass, its own `skipExit` skipped, anything else fail. */
const resultOf = (check, status) => (status === 0 ? 'pass' : check.skipExit !== undefined && status === check.skipExit ? 'skipped' : 'fail');

/** The first non-empty line of `text`, or undefined. */
const firstLine = (text) => (text ?? '').split('\n').map((l) => l.trim()).find(Boolean);

/** The longest note the state keeps; a longer line is cut, ending in `…`. */
export const NOTE_MAX = 400;

/** `p`'s real path, or `p` when it has none. */
const real = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
};

/**
 * A check's first stdout line as the note the bundle's state keeps (committed): the
 * repo's path shown as `.` and the home directory as `~`, so a local path never
 * lands in it, and at most NOTE_MAX characters. The standards command prints only
 * its own text there; this holds for any check that opts in.
 */
export function noteOf(stdout, cwd) {
  let line = firstLine(stdout);
  if (!line) return undefined;
  for (const [abs, shown] of [[real(cwd), '.'], [cwd, '.'], [os.homedir(), '~']]) {
    if (abs && abs.length > 1) line = line.split(abs).join(shown);
  }
  return line.length > NOTE_MAX ? `${line.slice(0, NOTE_MAX - 1)}…` : line;
}

function runCheck(check, { cwd, env }) {
  if (check.skip) return { name: check.name, result: 'skipped', note: check.skip, ms: 0 };
  const t0 = Date.now();
  const r = spawnSync(check.run, {
    cwd,
    env,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 30 * 60_000,
  });
  const ms = Date.now() - t0;
  // stdout and stderr tailed SEPARATELY: a noisy stderr would otherwise push the
  // failed-assertion list (stdout) out of view.
  const last = (text, n) => (text ?? '').trim().split('\n').slice(-n).join('\n');
  const tail = `${last(r.stdout, 30)}\n── stderr ──\n${last(r.stderr, 10)}`;
  // A check that opts into the convention says what it measured on its first line,
  // on every outcome (disposition 45); recorded as its note.
  const note = check.skipExit !== undefined ? noteOf(r.stdout, cwd) : undefined;
  return { name: check.name, result: resultOf(check, r.status), ms, tail, ...(note ? { note } : {}) };
}

/**
 * Run the gate. Every check runs even after a failure, so one gate shows every red
 * at once. Returns `{ results }` (the event the caller appends to `state.gates`; the
 * `tail` of a failing check is printed by the caller and not stored), or
 * `{ refused }` when nothing could run. `env` is the checks' environment (the
 * pre-push hook passes its own with git's hook variables removed); absent, they
 * inherit the process's.
 */
export function runGate({ repo, log = console.log, hasTool = onPath, env }) {
  const configured = repo.config.gate.checks;
  if (configured.length === 0) return { refused: messages.noChecksConfigured };
  const problems = scriptProblems(configured, repo.root);
  if (problems.length) return { refused: problems.join('\n') };
  const results = [];
  for (const check of planChecks({ checks: configured, hasTool })) {
    log(`  … ${check.name}`);
    const r = runCheck(check, { cwd: repo.root, env });
    log(`  ${r.result.toUpperCase().padEnd(7)} ${check.name}${r.note ? ` (${r.note})` : ''}`);
    results.push(r);
  }
  if (results.every((r) => r.result === 'skipped')) return { refused: messages.noCheckRan(results.map((r) => messages.skippedItem(r.name, r.note))) };
  return { results };
}

export const gatePassed = (results) => results.every((r) => r.result !== 'fail');

/** The names of the checks a gate skipped, from its recorded checks. */
export const skippedNames = (checks) => checks.filter((c) => c.result === 'skipped').map((c) => c.name);

/** The parts of a note that name a measurement it skipped: `expo strings: skipped, needs …`. */
const PARTIAL = /^[^;]+: skipped, /;
export const skippedParts = (note) => String(note ?? '').split('; ').filter((part) => PARTIAL.test(part));

/**
 * The checks of a gate that passed while their note names a part they skipped
 * (a standards rule not measured, disposition 45), as `name (parts)`.
 */
export const partialChecks = (checks) =>
  checks.filter((c) => c.result === 'pass' && skippedParts(c.note).length).map((c) => messages.skippedItem(c.name, skippedParts(c.note).join('; ')));

/** "pass" or "pass (skipped: a, b; partly: c (…))" — a pass with holes always reads as one. */
export function passLabel(gate) {
  const skipped = skippedNames(gate.checks ?? []);
  const partly = partialChecks(gate.checks ?? []);
  const holes = [...(skipped.length ? [`skipped: ${skipped.join(', ')}`] : []), ...(partly.length ? [messages.partly(partly)] : [])];
  return holes.length ? `pass (${holes.join('; ')})` : 'pass';
}
