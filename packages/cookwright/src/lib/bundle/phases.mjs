// src/lib/bundle/phases.mjs — phase transitions, the Workflow args, and the
// records of what sessions returned.
//
// THE ARGS INVARIANT. The Workflow runtime resumes a run from cache only when the
// script and its `args` are byte-identical, and a cached session's result is reused
// even if a file it was told to read has changed since. So `args`:
//   * carry NO run id, status or timestamp (they change on every write);
//   * carry the review range FROZEN at `phase start`, never recomputed from HEAD;
//   * carry the content hash of every file a prompt points at (the plan, the
//     playbook, the rules file, the input findings), so an edited file misses the
//     cache instead of returning a result produced against the old text;
//   * carry machine facts (is Codex installed?) as FROZEN at `phase start`, so the
//     same run resumed on another machine still hands back its cached sessions.

import fs from 'node:fs';
import path from 'node:path';

import { rulesFiles } from '../hosts.mjs';
import { BUNDLE_CLI } from './messages.mjs';
import { relativeFiles, scrubLocalPaths } from './scrub.mjs';
import { bundleDir, bundleRel, findPhase, sha256File, sliceOfPhase } from './state.mjs';

/** Kinds that run through the Workflow script; the rest are shell or the developer's hands. */
export const WORKFLOW_KINDS = new Set([
  'plan-review',
  'implement',
  'review',
  'fix',
  'qa',
  'closeout',
]);

/**
 * Kinds whose own findings must be closed before `phase done`: nothing at P1 or P2
 * may stay open. P3s never block — they stay in the record as residue; a loop that
 * waited for an adversarial reviewer to find nothing would close by exhaustion.
 */
export const TERMINAL_KINDS = new Set(['plan-review', 'closeout', 'qa']);

/** Root-relative path of a bundle's closeout. */
export const closeoutPath = (repo, slug) =>
  path.posix.join(repo.config.paths.closeouts, `${slug}.md`);

export const kindOf = (name) => name.split(':')[0];

/**
 * Start a phase, or start a NEW RUN of a running one (a rerun: a fresh Workflow run
 * after findings were acted on — every rerun goes through here, so each is counted
 * and keeps its own run id). Phases run in the derived order: every earlier phase
 * must be done. A DONE phase may be reopened while every later phase is pending —
 * or is the closeout, which is reset to pending with it (a bug found while the
 * closeout is being written reopens `qa`; the closeout's verify must rerun anyway).
 * `mergeBase` is the LIVE merge-base with the base branch; `planSha` records which
 * plan text the run started against; `codex` whether the Codex CLI was on PATH; the
 * state revision is FROZEN per run, so a closeout run resumed after a crash sees the
 * same args it launched with.
 */
export function startPhase(state, name, { head, now, tokenTarget, mergeBase, planSha, codex }) {
  const phase = findPhase(state, name);
  const index = state.phases.indexOf(phase);
  const later = state.phases.slice(index + 1).filter((p) => p.status !== 'pending');
  if (phase.status === 'done') {
    const blocking = later.filter((p) => p.name !== 'closeout');
    if (blocking.length) {
      throw new Error(`phase ${name} is done and ${blocking[0].name} has started — cannot reopen`);
    }
    for (const p of later) p.status = 'pending';
    phase.status = 'reopening';
  }
  const open = state.phases.slice(0, index).filter((p) => p.status !== 'done');
  if (open.length) throw new Error(`finish first: ${open.map((p) => p.name).join(', ')}`);
  if (phase.status !== 'running') {
    phase.status = 'running';
    phase.startCommit = head;
    delete phase.endCommit;
    delete phase.endCode;
    phase.range = rangeFor(state, name, head, mergeBase ?? state.base);
  }
  phase.runs.push({
    startedAt: now,
    stateRevision: state.revision ?? 0,
    ...(planSha ? { planSha } : {}),
    ...(tokenTarget ? { tokenTarget } : {}),
    ...(codex !== undefined ? { codex: Boolean(codex) } : {}),
  });
  return phase;
}

function rangeFor(state, name, head, base) {
  const kind = kindOf(name);
  if (kind === 'closeout' || name === 'review:whole') return { from: base, to: head };
  // A QA round reviews what its fix session commits in the SAME run, so its range
  // ends at the run's HEAD, not at a commit known at phase start.
  if (kind === 'qa') return { from: head, to: 'HEAD' };
  if (kind !== 'review') return null;
  const slice = sliceOfPhase(state, name);
  const first = findPhase(state, `implement:${slice.sessions[0].id}`);
  return { from: first.startCommit, to: head };
}

/**
 * Record the Workflow run id of the run IN FLIGHT, as soon as the runtime hands it
 * back — so a crashed orchestrator's successor can resume it instead of paying for
 * every finished session again. One id per run: a rerun is a new run (`phase start`),
 * never an overwrite that would lose the earlier run's id and tokens. The id only:
 * the run's transcript directory is a machine-local absolute path, derivable from
 * the host's project home and the id, and committed state never holds a local path.
 */
export function setRunId(state, name, { runId }) {
  const phase = findPhase(state, name);
  if (phase.status !== 'running') throw new Error(`phase ${name} is not running`);
  const run = phase.runs.at(-1);
  if (run.runId || run.endedAt) {
    throw new Error(
      `the current run of ${name} already has an id — a rerun starts with \`phase start\``,
    );
  }
  run.runId = runId;
}

/** Close a phase run; a finished phase records the commit it ended on. */
export function finishPhase(
  state,
  name,
  { now, head, lastCode, runId, usage, keepOpen },
) {
  const phase = findPhase(state, name);
  if (phase.status !== 'running') throw new Error(`phase ${name} is not running`);
  const run = phase.runs.at(-1);
  run.endedAt = now;
  if (runId) run.runId = runId;
  // budget.spent() is the TURN's output tokens across the main loop and every
  // workflow, not this run's alone — named so nobody sums it as if it were.
  if (usage !== undefined) run.turnOutputTokens = usage;
  if (!keepOpen) {
    phase.status = 'done';
    phase.endCommit = head;
    // The last CODE commit at done: a slice's gate must sit between it and HEAD
    // (state-home commits — the state, a findings file — may follow the gate).
    if (lastCode) phase.endCode = lastCode;
  }
  return phase;
}

/** `{ path, sha }` of a root-relative file, the shape every pointed-at file takes. */
const pointer = (repo, rel) => ({ path: rel, sha: sha256File(path.resolve(repo.root, rel)) });

/** Workflow `args` for a running phase — see the invariant at the top of the file. */
export function workflowArgs(state, name, repo) {
  const phase = findPhase(state, name);
  const kind = kindOf(name);
  if (!WORKFLOW_KINDS.has(kind)) throw new Error(`${name} is not a Workflow phase`);
  if (phase.status !== 'running') throw new Error(`start ${name} first (bundle phase start)`);
  const rules = rulesFiles(repo.config).filter((f) => fs.existsSync(path.join(repo.root, f)));
  const args = {
    phase: kind,
    name,
    slug: state.slug,
    branch: state.branch,
    cli: BUNDLE_CLI,
    codex: phase.runs.at(-1).codex ?? false,
    state: bundleRel(repo, state.slug, 'state.json'),
    plan: pointer(repo, state.plan.path),
    playbook: pointer(repo, repo.config.paths.playbook),
    ...(rules.length ? { rules: rules.map((f) => pointer(repo, f)) } : {}),
  };
  const slice = sliceOfPhase(state, name);
  if (slice) args.slice = { id: slice.id };
  if (phase.range) args.range = phase.range;
  return { ...args, ...kindArgs(state, phase, kind, repo) };
}

/** The args a phase kind adds: its session, the findings it fixes, what it rechecks. */
function kindArgs(state, phase, kind, repo) {
  const name = phase.name;
  if (kind === 'implement') {
    const slice = sliceOfPhase(state, name);
    return { session: slice.sessions.find((s) => s.id === name.split(':')[1]) };
  }
  if (kind === 'fix') return { findings: findingsFor(state, `review:${name.split(':')[1]}`, repo) };
  if (kind === 'qa') {
    // The latest round's notes, plus the round's own open review findings if a
    // previous run left some: the next fix addresses both.
    const open = latestOpen(state, 'qa', repo);
    return { findings: [latestQa(state, repo), ...(open ? [open] : [])] };
  }
  // plan-review and closeout: a rerun after the text was revised re-judges the open
  // findings only — a fresh adversarial pass every round converges by exhaustion,
  // not by agreement.
  const open = latestOpen(state, name, repo);
  const recheck = open ? { recheck: open } : {};
  return kind === 'closeout' ? { ...recheck, ...closeoutArgs(state, phase, repo) } : recheck;
}

function closeoutArgs(state, phase, repo) {
  const file = closeoutPath(repo, state.slug);
  const abs = path.resolve(repo.root, file);
  if (!fs.existsSync(abs)) throw new Error(`write ${file} first — the closeout run verifies it`);
  // Hashed like every pointed-at file: an edited closeout must miss the cache. The
  // state revision pins which state the verifier judges it against.
  return { closeout: pointer(repo, file), stateRevision: phase.runs.at(-1).stateRevision ?? 0 };
}

/** The latest findings record of `phase` if anything in it blocks, as {path, sha}. */
function latestOpen(state, phaseName, repo) {
  const latest = state.findings.filter((f) => f.phase === phaseName).at(-1);
  if (!latest || blockingOpen(latest, kindOf(phaseName)) === 0) return null;
  return pointer(repo, latest.path);
}

function latestQa(state, repo) {
  const round = state.qaRounds.at(-1);
  if (!round) throw new Error('no QA round recorded — `bundle record <slug> qa` first');
  return pointer(repo, round.path);
}

function findingsFor(state, reviewName, repo) {
  const found = state.findings.filter((f) => f.phase === reviewName);
  if (found.length === 0) throw new Error(`no findings recorded for ${reviewName}`);
  return found.map((f) => pointer(repo, f.path));
}

// ── records ──────────────────────────────────────────────────────────────────

const fileSafe = (name) => name.replace(/:/g, '-');

function writeRecord(repo, state, sub, base, ext, content) {
  const dir = path.join(bundleDir(repo, state.slug), sub);
  fs.mkdirSync(dir, { recursive: true });
  let n = 1;
  while (fs.existsSync(path.join(dir, `${base}-${n}.${ext}`))) n += 1;
  const file = path.join(dir, `${base}-${n}.${ext}`);
  fs.writeFileSync(file, scrubLocalPaths(content, repo.root));
  return path.relative(repo.root, file).split(path.sep).join('/');
}

export const openCount = (counts) => counts.confirmed + counts.plausible + counts.unverified;

const isOpen = (i) => i.verdict !== 'rejected';

/** Open findings that block: P1 and P2 (P3s are residue, recorded, never blocking). */
export function blockingOpen(record) {
  const by = record.openBySeverity ?? { P1: openCount(record.counts), P2: 0, P3: 0 };
  return by.P1 + by.P2;
}

const issueKey = (i) => `${i.file}::${i.location}::${i.problem}`;

/**
 * A re-check's result, completed against the record it re-checked: every prior open
 * issue the verifier did not return is carried forward OPEN. A verifier that dropped
 * a finding — or died, leaving an empty list — can never silently close it.
 */
function carryForward(repo, result) {
  if (!result.recheckOf) return result;
  const prior = JSON.parse(fs.readFileSync(path.resolve(repo.root, result.recheckOf), 'utf8'));
  const seen = new Set((result.issues ?? []).map(issueKey));
  const dropped = (prior.issues ?? [])
    .filter((i) => i.verdict !== 'rejected' && !seen.has(issueKey(i)))
    .map((i) => ({ ...i, verdict: 'plausible', evidence: 'not re-judged by the re-check' }));
  return { ...result, issues: [...(result.issues ?? []), ...dropped] };
}

/**
 * Store a review's findings (the ISSUES shape + verdict) as returned, stamped with
 * the HEAD it was recorded at (a fact: what code this review had seen). A run the
 * Workflow marked `incomplete` (a reviewer that never finished) is refused unless
 * the orchestrator accepts it by name — an empty list from a dead reviewer is not a
 * clean review.
 */
export function recordFindings(repo, state, name, result, now, opts = {}) {
  const { acceptIncomplete, head } = opts;
  findPhase(state, name);
  if (result?.recheckOf) result = carryForward(repo, result);
  const issues = Array.isArray(result?.issues) ? result.issues : null;
  if (!issues) throw new Error('findings input needs an `issues` array');
  const incomplete = result.incomplete ?? [];
  if (incomplete.length && !acceptIncomplete) {
    throw new Error(
      `incomplete review: ${incomplete.join('; ')} — rerun, or --accept-incomplete "<reason>"`,
    );
  }
  const counts = { confirmed: 0, plausible: 0, rejected: 0, unverified: 0 };
  const openBySeverity = { P1: 0, P2: 0, P3: 0 };
  for (const i of issues) {
    counts[i.verdict in counts ? i.verdict : 'unverified'] += 1;
    if (isOpen(i)) openBySeverity[i.severity in openBySeverity ? i.severity : 'P1'] += 1;
  }
  const body = JSON.stringify({ phase: name, stored: true, ...result }, null, 2) + '\n';
  const rel = writeRecord(repo, state, 'findings', fileSafe(name), 'json', body);
  state.findings.push({
    phase: name,
    path: rel,
    counts,
    openBySeverity,
    at: now,
    stored: true,
    ...(head ? { head } : {}),
    ...(incomplete.length ? { incomplete, acceptedIncomplete: acceptIncomplete } : {}),
    ...(result.closeoutSha !== undefined ? { closeoutSha: result.closeoutSha } : {}),
  });
  return rel;
}

/**
 * Why `phase done` must refuse, or null. The evidence a phase kind owes before it can
 * close — so "the gate runs after every session" is enforced, not just written down.
 * ctx: { head, lastCode (newest code commit on the branch), qaLastCode (newest code
 * commit since the phase started), contains(a, b) (a is b or an ancestor), acceptOpen,
 * noDevice }. A gate "covers" code when it passed on a commit containing that code:
 * state-home commits (state, findings) may follow it.
 *   review, plan-review, closeout — a findings record for the phase;
 *   implement, fix               — a session report, and a passing gate covering the
 *                                  branch's code;
 *   qa                           — a recorded QA round (or `noDevice`, a named
 *                                  exemption); if code changed during QA, a gate and
 *                                  a round review covering it;
 *   plan-review, closeout, qa    — nothing P1/P2 open in the latest findings, unless
 *                                  `acceptOpen` (recorded as a decision).
 */
export function doneBlocker(state, name, ctx = {}) {
  const { head, lastCode, qaLastCode, contains = (a, b) => a === b, acceptOpen, noDevice } = ctx;
  const phase = findPhase(state, name);
  const kind = kindOf(name);
  const latest = state.findings.filter((f) => f.phase === name).at(-1);
  const covers = (code) => state.gates.some((g) => g.passed && contains(code, g.commit));
  const noGate = (code) => `no passing gate covers ${code?.slice(0, 8)} — gate first`;

  if (['plan-review', 'review', 'closeout'].includes(kind) && !latest) {
    return `record ${name}'s findings first (bundle record <slug> findings ${name})`;
  }
  if (kind === 'implement' || kind === 'fix') {
    if (!state.reports.some((r) => r.phase === name)) {
      return `record ${name}'s session report first (bundle record <slug> session ${name})`;
    }
    if (!covers(lastCode ?? head)) return noGate(lastCode ?? head);
  }
  if (kind === 'qa') {
    if (state.qaRounds.length === 0 && !noDevice) {
      return 'no QA round recorded — `record <slug> qa`, or --no-device "<why this bundle has no user-visible surface>"';
    }
    const code = qaLastCode ?? head;
    if (code !== phase.startCommit) {
      if (!covers(code)) return noGate(code);
      if (!latest?.head || !contains(code, latest.head)) {
        return 'code changed during QA: review it (a qa Workflow run) and record the findings';
      }
    }
  }
  if (TERMINAL_KINDS.has(kind) && latest && !acceptOpen) {
    const open = blockingOpen(latest);
    if (open) {
      return `${open} P1/P2 finding(s) still open in ${latest.path} — fix and rerun, or --accept-open "<reason>"`;
    }
  }
  return null;
}

/** Store an implementer or fix session's IMPL report as markdown. */
export function recordReport(repo, state, name, report, now) {
  findPhase(state, name);
  // The IMPL shape, or refuse: an agent that died pipes `null`, and piping the whole
  // Workflow return by mistake would otherwise store an all-"none" report that
  // satisfies `phase done`.
  if (!Array.isArray(report?.commits) || !Array.isArray(report?.files)) {
    throw new Error(
      'a session report needs the IMPL shape (commits[], files[], …) — pipe `results`, or `results.fix` for qa',
    );
  }
  const files = relativeFiles(report.files, repo.root);
  const body = renderReport(name, { ...report, files });
  const rel = writeRecord(repo, state, 'sessions', fileSafe(name), 'md', body);
  state.reports.push({ phase: name, path: rel, at: now, stored: true });
  return rel;
}

/** Store one QA round's notes (markdown, as written by the developer or the session). */
export function recordQa(repo, state, text, now) {
  const rel = writeRecord(
    repo,
    state,
    'qa',
    'round',
    'md',
    text.endsWith('\n') ? text : `${text}\n`,
  );
  state.qaRounds.push({ path: rel, at: now, stored: true });
  return rel;
}

const bullets = (items, fmt = String) =>
  items?.length ? items.map((x) => `- ${fmt(x)}`).join('\n') : '- none';

export function renderReport(name, r = {}) {
  const strings = r.strings?.length
    ? [
        '| key | text | context |',
        '|---|---|---|',
        ...r.strings.map((s) => `| \`${s.key}\` | ${s.text} | ${s.context} |`),
      ].join('\n')
    : 'none';
  return [
    `# ${name} — session report`,
    '',
    '_Stored as the session returned it; the orchestrator verifies before relying on it._',
    '',
    '## Commits',
    bullets(r.commits, (c) => `\`${c}\``),
    '',
    '## Files',
    bullets(r.files, (f) => `\`${f}\``),
    '',
    '## User-facing strings',
    strings,
    '',
    '## Open questions',
    bullets(r.open_questions),
    '',
    '## Notes',
    r.notes || 'none',
    '',
  ].join('\n');
}
