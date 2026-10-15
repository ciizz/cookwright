// src/lib/bundle/state.mjs — <paths.bundles>/<slug>/state.json, and the only code
// that writes it.
//
// Two kinds of content, never confused (scripts own facts, models own judgment):
//   * FACTS this CLI measured itself — branch, base, commits, gate results, hashes,
//     timestamps, run ids and token counts handed over from the Workflow runtime.
//   * CLAIMS it merely serializes — phase status, decisions, entered costs, and the
//     reports a model returned. Each carries `claim: true` (or lives in a `stored`
//     file), so a closeout generated from the state can say which is which.
//
// The plan lives IN the bundle (`init` copies it to <bundles>/<slug>/plan.md, and
// revisions happen there, committed): a plan left in a session scratchpad is
// unreadable to the next session. `plan.sha` is the sha at init; each run records
// the sha it started against.
//
// Every function takes `repo` = { root, config }: the checkout and its cookwright.json.

import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { scrubValue } from './scrub.mjs';

export const STATE_VERSION = 1;

export const SLUG = /^[a-z0-9][a-z0-9-]{1,48}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const SLICE_KEYS = ['id', 'sessions'];
const SESSION_KEYS = ['id', 'scope', 'checkpoints'];

export const bundlesDir = (repo) => path.join(repo.root, repo.config.paths.bundles);
export const bundleDir = (repo, slug) => path.join(bundlesDir(repo), slug);
export const statePath = (repo, slug) => path.join(bundleDir(repo, slug), 'state.json');
/** Root-relative, forward-slash path of a bundle file, as prompts and args name it. */
export const bundleRel = (repo, slug, ...parts) =>
  path.posix.join(repo.config.paths.bundles, slug, ...parts);

export function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
}

export function loadState(repo, slug) {
  const file = statePath(repo, slug);
  if (!fs.existsSync(file)) {
    throw new Error(`no bundle state at ${path.relative(repo.root, file)}`);
  }
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (state.version !== STATE_VERSION) {
    throw new Error(`state version ${state.version} is not ${STATE_VERSION}`);
  }
  return state;
}

/**
 * Write via a UNIQUE temp file + rename, so a crash never leaves half a state file
 * and two writers never share a temp name. Compare-and-swap on `revision`: a writer
 * whose loaded revision is no longer the file's refuses instead of silently dropping
 * the other writer's update. (The check-then-rename window is not atomic; the CLI's
 * writers are one orchestrator's sequential commands, so this catches the real case —
 * a second shell — without a lock of its own.)
 */
export function saveState(repo, state) {
  const file = statePath(repo, state.slug);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const onDisk = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).revision : 0;
  if (onDisk !== state.revision) {
    throw new Error(
      `state changed since it was loaded (revision ${state.revision}, on disk ${onDisk}) — rerun`,
    );
  }
  const next = { ...state, revision: state.revision + 1 };
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(scrubValue(next, repo.root), null, 2) + '\n');
  fs.renameSync(tmp, file);
  state.revision = next.revision;
}

/** Every bundle state in the repo, for lookup by branch. */
export function listStates(repo) {
  const dir = bundlesDir(repo);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((slug) => fs.existsSync(statePath(repo, slug)))
    .map((slug) => loadState(repo, slug));
}

// ── the split ────────────────────────────────────────────────────────────────

const unknown = (obj, known, where) =>
  Object.keys(obj ?? {})
    .filter((k) => !known.includes(k))
    .map((k) => `${where}: unknown key "${k}"${k === 'sql' ? ' (gate legs are not in this version; see the backlog)' : ''}`);

/**
 * Validate the split the orchestrator proposed and the developer confirmed:
 *   { slices: [{ id, sessions: [{ id, scope, checkpoints: [] }] }] }
 * One slice is the common case; several when the work has independent review units.
 */
export function validateSplit(split) {
  const errors = [];
  const slices = Array.isArray(split?.slices) ? split.slices : [];
  if (slices.length === 0) errors.push('split needs at least one slice');
  const seen = new Set();
  const sliceIds = new Set();
  for (const slice of slices) {
    errors.push(...unknown(slice, SLICE_KEYS, `slice ${slice?.id}`));
    if (!ID.test(slice.id ?? '')) errors.push(`bad slice id "${slice.id}"`);
    if (sliceIds.has(slice.id)) errors.push(`duplicate slice id "${slice.id}"`);
    sliceIds.add(slice.id);
    if (slice.id === 'whole') errors.push('"whole" is reserved for the whole-branch review');
    const sessions = Array.isArray(slice.sessions) ? slice.sessions : [];
    if (sessions.length === 0) errors.push(`slice ${slice.id} has no session`);
    for (const s of sessions) errors.push(...validateSession(s, seen));
  }
  return errors;
}

function validateSession(s, seen) {
  const errors = unknown(s, SESSION_KEYS, `session ${s?.id}`);
  if (!ID.test(s.id ?? '')) errors.push(`bad session id "${s.id}"`);
  if (seen.has(s.id)) errors.push(`duplicate session id "${s.id}"`);
  seen.add(s.id);
  if (!s.scope) errors.push(`session ${s.id} has no scope`);
  const cps = s.checkpoints ?? [];
  if (!Array.isArray(cps) || cps.some((c) => typeof c !== 'string' || !c)) {
    errors.push(`session ${s.id}: checkpoints must be a list of non-empty strings`);
  }
  return errors;
}

/**
 * The phase list, derived from the split — never hand-written, so a resumed bundle
 * and a fresh one agree on the order. `qa` is the developer's own round on the
 * built product plus the fix sessions around it; the CLI tracks it so the closeout
 * can count QA rounds. A stack pack may add manual phases later (backlog E-002).
 */
export function derivePhases(split) {
  const names = ['plan-review'];
  for (const slice of split.slices) {
    for (const s of slice.sessions) names.push(`implement:${s.id}`);
    names.push(`review:${slice.id}`, `fix:${slice.id}`);
  }
  names.push('review:whole', 'fix:whole', 'qa', 'closeout');
  return names.map((name) => ({ name, status: 'pending', claim: true, runs: [] }));
}

export function initState({ repo, slug, planPath, split, branch, base, now }) {
  if (!SLUG.test(slug)) throw new Error(`bad slug "${slug}" (lowercase, digits, dashes)`);
  const errors = validateSplit(split);
  if (errors.length) throw new Error(`invalid split:\n  ${errors.join('\n  ')}`);
  return {
    version: STATE_VERSION,
    revision: 0,
    slug,
    branch,
    base,
    createdAt: now,
    plan: { path: planPath, sha: sha256File(path.resolve(repo.root, planPath)) },
    slices: split.slices.map((s) => ({
      id: s.id,
      sessions: s.sessions.map(({ id, scope, checkpoints = [] }) => ({ id, scope, checkpoints })),
    })),
    phases: derivePhases(split),
    gates: [],
    findings: [],
    reports: [],
    qaRounds: [],
    decisions: [],
    costs: [],
  };
}

// ── lookups ──────────────────────────────────────────────────────────────────

export function findPhase(state, name) {
  const p = state.phases.find((x) => x.name === name);
  if (!p)
    throw new Error(`no phase "${name}" (have: ${state.phases.map((x) => x.name).join(', ')})`);
  return p;
}

/** The slice a phase belongs to, or null (plan-review, whole-branch, closeout…). */
export function sliceOfPhase(state, name) {
  const [kind, id] = name.split(':');
  if (kind === 'implement') return state.slices.find((s) => s.sessions.some((x) => x.id === id));
  if ((kind === 'review' || kind === 'fix') && id !== 'whole') {
    return state.slices.find((s) => s.id === id) ?? null;
  }
  return null;
}

export function currentPhase(state) {
  return (
    state.phases.find((p) => p.status === 'running') ??
    state.phases.find((p) => p.status === 'pending') ??
    null
  );
}
