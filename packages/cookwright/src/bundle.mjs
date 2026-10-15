#!/usr/bin/env node
// scripts/bundle.mjs — the bundle workflow's CLI: the only writer of bundle state.
//
// WHAT: a feature bundle runs as a chain of phases (plan review, one implement run
//   per session, review/fix per slice, the whole-branch pass, atlas, Cesar's
//   operator block, device QA, closeout). This CLI records each phase, runs the gate
//   between them, emits the Workflow `args`, stores what sessions returned, and runs
//   the landing check. The procedure itself is `ops/PLAYBOOK.md`; the entry point is
//   the `/bundle` skill; the Workflow script is `.claude/workflows/bundle-phase.js`.
//
// WHY: scripts own facts, models own judgment (the agent operating model, §5). Before
//   this, the orchestrator carried commits, gate results and run ids in its context
//   and relayed them into prompts — the class of mistake that put a fabricated claim
//   in a closeout. Now they live in a file a script wrote.
//
// USAGE
//   node scripts/bundle.mjs init <slug> --plan <path> --split <file.json>
//   node scripts/bundle.mjs status [slug]
//   node scripts/bundle.mjs args <slug> <phase>
//   node scripts/bundle.mjs phase <slug> start <phase> [--token-target N]
//   node scripts/bundle.mjs phase <slug> run <phase> --run-id R [--transcript-dir D]
//   node scripts/bundle.mjs phase <slug> done <phase> [--run-id R] [--transcript-dir D]
//                                                     [--usage N] [--keep-open]
//                                                     [--accept-open "<reason>"]
//                                                     [--no-device "<reason>"]   (qa)
//   node scripts/bundle.mjs record <slug> findings <phase> [--accept-incomplete "<reason>"]
//                                                            < result.json
//   node scripts/bundle.mjs record <slug> session <phase>    < impl.json
//   node scripts/bundle.mjs record <slug> qa                 < notes.md
//   node scripts/bundle.mjs decide <slug> --actor A --source S --text T
//   node scripts/bundle.mjs cost <slug> --usd N [--note T]
//   node scripts/bundle.mjs gate <slug> [--sql] [--slice id] [--retry --flake B-NNN]
//   node scripts/bundle.mjs lock status
//   node scripts/bundle.mjs check [slug] [--ci]
//   node scripts/bundle.mjs closeout-draft <slug>
//
// Exit codes: 0 = ok / check passed, 1 = check or gate failed, 2 = refused (bad
// input, wrong branch, dirty tree, busy lock, missing state).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { bundleChecks, repoChecks, FAIL } from './lib/bundle/check.mjs';
import { renderCloseoutDraft } from './lib/bundle/closeout.mjs';
import { KNOWN_FLAKES, gatePassed, runGate } from './lib/bundle/gate.mjs';
import {
  currentBranch,
  dirtyPaths,
  head,
  isAncestor,
  lastCodeCommit,
  mergeBase,
} from './lib/bundle/git.mjs';
import {
  WORKFLOW_KINDS,
  finishPhase,
  kindOf,
  recordFindings,
  recordQa,
  recordReport,
  startPhase,
  doneBlocker,
  setRunId,
  workflowArgs,
} from './lib/bundle/phases.mjs';
import {
  BUNDLES_DIR,
  currentPhase,
  initState,
  listStates,
  loadState,
  saveState,
  SLUG,
  sha256File,
  sliceOfPhase,
  statePath,
  validateSplit,
} from './lib/bundle/state.mjs';
import { lockPath, readLock } from './lib/rig-lock.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW_SCRIPT = '.claude/workflows/bundle-phase.js';
const now = () => new Date().toISOString();

export class Refusal extends Error {}

// ── argv ─────────────────────────────────────────────────────────────────────

/** Positionals and `--flag [value]` pairs; a flag followed by another flag is boolean. */
export function parseArgv(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      pos.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) flags[key] = true;
    else {
      flags[key] = next;
      i += 1;
    }
  }
  return { pos, flags };
}

const need = (value, what) => {
  if (value === undefined || value === true) throw new Refusal(`missing ${what}`);
  return value;
};

/** The named bundle, or the one whose recorded branch is checked out. */
function resolveSlug(slug) {
  if (slug) return slug;
  const branch = currentBranch(ROOT);
  const matches = listStates(ROOT).filter((s) => s.branch === branch);
  if (matches.length === 1) return matches[0].slug;
  if (matches.length > 1) throw new Refusal(`several bundles claim branch ${branch}`);
  return null;
}

function assertOnBranch(state) {
  const branch = currentBranch(ROOT);
  if (branch !== state.branch) {
    throw new Refusal(`bundle ${state.slug} lives on ${state.branch}; checked out: ${branch}`);
  }
}

function readStdin() {
  return fs.readFileSync(0, 'utf8');
}

// ── commands ─────────────────────────────────────────────────────────────────

function cmdInit(pos, flags) {
  const slug = need(pos[0], '<slug>');
  const branch = currentBranch(ROOT);
  if (!branch || branch === 'main') {
    throw new Refusal('cut the bundle branch first — init records the branch checked out now');
  }
  if (fs.existsSync(statePath(ROOT, slug))) throw new Refusal(`bundle ${slug} already exists`);
  const dirty = dirtyPaths(ROOT);
  if (dirty.length) throw new Refusal(`tree is dirty: ${dirty.slice(0, 5).join(', ')}`);
  const split = JSON.parse(fs.readFileSync(need(flags.split, '--split <file>'), 'utf8'));
  // The plan is COPIED into the bundle, committed with it: a plan left in a session
  // scratchpad or ~/.claude/plans is unreadable to the next machine or the next
  // session, and every args call hashes it. Revisions happen to the copy.
  const source = need(flags.plan, '--plan <path>');
  if (!fs.existsSync(source)) throw new Refusal(`no plan at ${source}`);
  // Validate BEFORE touching the tree: a refused init must leave it clean, or the
  // corrected retry is refused as dirty.
  if (!SLUG.test(slug)) throw new Refusal(`bad slug "${slug}" (lowercase, digits, dashes)`);
  const errors = validateSplit(split);
  if (errors.length) throw new Refusal(`invalid split:\n  ${errors.join('\n  ')}`);
  const planPath = path.posix.join(BUNDLES_DIR, slug, 'plan.md');
  fs.mkdirSync(path.join(ROOT, BUNDLES_DIR, slug), { recursive: true });
  fs.copyFileSync(source, path.join(ROOT, planPath));
  const state = initState({
    root: ROOT,
    slug,
    planPath,
    split,
    branch,
    base: mergeBase('main', 'HEAD', ROOT),
    now: now(),
  });
  saveState(ROOT, state);
  console.log(`bundle ${slug} on ${branch}, base ${state.base.slice(0, 8)}; plan → ${planPath}`);
  console.log(`phases: ${state.phases.map((p) => p.name).join(' → ')}`);
  return 0;
}

function cmdStatus(pos) {
  const slug = resolveSlug(pos[0]);
  if (!slug) {
    console.log(`no bundle state for this branch (${BUNDLES_DIR}/<slug>/state.json)`);
    return 0;
  }
  const state = loadState(ROOT, slug);
  const phase = currentPhase(state);
  const lastGate = state.gates.at(-1);
  console.log(`bundle   : ${state.slug} (${state.branch}, base ${state.base.slice(0, 8)})`);
  console.log(`plan     : ${state.plan.path}`);
  console.log(`phases   : ${state.phases.map((p) => `${p.name}[${p.status}]`).join(' ')}`);
  console.log(
    `last gate: ${lastGate ? `${lastGate.passed ? 'pass' : 'FAIL'} on ${lastGate.commit.slice(0, 8)}` : 'none'}`,
  );
  console.log(`next     : ${nextAction(state, phase)}`);
  return 0;
}

export function nextAction(state, phase) {
  if (!phase) return 'every phase done — `bundle check`, then Cesar merges';
  const slug = state.slug;
  if (phase.status === 'pending') {
    return `node scripts/bundle.mjs phase ${slug} start ${phase.name}`;
  }
  const kind = kindOf(phase.name);
  if (kind === 'qa' && state.qaRounds.length === 0) {
    return `record Cesar's device round (\`record ${slug} qa\`), or \`phase ${slug} done qa --no-device "<why>"\``;
  }
  if (!WORKFLOW_KINDS.has(kind)) {
    return `${phase.name} is running outside the Workflow — finish it, then \`phase ${slug} done ${phase.name}\``;
  }
  // Resume ONLY a run in flight: a finished run replayed from cache would hand back
  // its old result — for a QA round, a review of code it never saw.
  const run = phase.runs.at(-1);
  if (run?.runId && !run.endedAt) {
    return (
      `Workflow({ scriptPath: '${WORKFLOW_SCRIPT}', resumeFromRunId: '${run.runId}', args: ` +
      `<output of \`node scripts/bundle.mjs args ${slug} ${phase.name}\`> })`
    );
  }
  if (run?.runId) {
    return `record the run's results, gate, \`phase ${slug} done ${phase.name}\` — or a rerun: \`phase ${slug} start ${phase.name}\``;
  }
  return (
    `Workflow({ scriptPath: '${WORKFLOW_SCRIPT}', args: <output of ` +
    `\`node scripts/bundle.mjs args ${slug} ${phase.name}\`> }), then \`phase ${slug} run ${phase.name} --run-id <id>\``
  );
}

/** A flag that must carry a finite number, or undefined when absent. */
function numberFlag(flags, name) {
  if (flags[name] === undefined) return undefined;
  const n = Number(need(flags[name], `--${name} <number>`));
  if (!Number.isFinite(n)) throw new Refusal(`--${name} must be a number`);
  return n;
}

const stringFlag = (flags, name) =>
  flags[name] === undefined ? undefined : need(flags[name], `--${name} <value>`);

function cmdArgs(pos) {
  const state = loadState(ROOT, need(pos[0], '<slug>'));
  assertOnBranch(state);
  console.log(JSON.stringify(workflowArgs(state, need(pos[1], '<phase>'), ROOT)));
  return 0;
}

function cmdPhase(pos, flags) {
  const state = loadState(ROOT, need(pos[0], '<slug>'));
  assertOnBranch(state);
  const verb = need(pos[1], 'start|run|done');
  const name = need(pos[2], '<phase>');
  if (verb === 'start') {
    const tip = head(ROOT);
    const p = startPhase(state, name, {
      head: tip,
      now: now(),
      tokenTarget: numberFlag(flags, 'token-target'),
      mergeBase: mergeBase('main', tip, ROOT),
      planSha: sha256File(path.join(ROOT, state.plan.path)),
    });
    if (p.range)
      console.log(`range frozen: ${p.range.from.slice(0, 8)}..${p.range.to.slice(0, 8)}`);
  } else if (verb === 'run') {
    setRunId(state, name, {
      runId: need(flags['run-id'], '--run-id <id>'),
      transcriptDir: stringFlag(flags, 'transcript-dir'),
    });
  } else if (verb === 'done') {
    const acceptOpen = stringFlag(flags, 'accept-open');
    const noDevice = stringFlag(flags, 'no-device');
    const tip = head(ROOT);
    const base = mergeBase('main', tip, ROOT);
    const phase = state.phases.find((p) => p.name === name);
    const ctx = {
      head: tip,
      lastCode: lastCodeCommit(base, tip, ROOT),
      qaLastCode: phase?.startCommit ? lastCodeCommit(phase.startCommit, tip, ROOT) : tip,
      contains: (a, b) => isAncestor(a, b, ROOT),
      acceptOpen,
      noDevice,
    };
    const blocker = flags['keep-open'] ? null : doneBlocker(state, name, ctx);
    if (blocker) throw new Refusal(blocker);
    if (noDevice && !flags['keep-open']) {
      state.decisions.push({
        at: now(),
        actor: 'orchestrator',
        source: `phase done ${name} --no-device`,
        text: `no device QA: ${noDevice}`,
        claim: true,
      });
    }
    if (acceptOpen && !flags['keep-open']) {
      state.decisions.push({
        at: now(),
        actor: 'orchestrator',
        source: `phase done ${name} --accept-open`,
        text: `closed ${name} with findings open: ${acceptOpen}`,
        claim: true,
      });
    }
    finishPhase(state, name, {
      now: now(),
      head: tip,
      lastCode: ctx.lastCode,
      runId: stringFlag(flags, 'run-id'),
      transcriptDir: stringFlag(flags, 'transcript-dir'),
      usage: numberFlag(flags, 'usage'),
      keepOpen: Boolean(flags['keep-open']),
    });
  } else throw new Refusal(`unknown phase verb "${verb}"`);
  saveState(ROOT, state);
  console.log(
    `${name}: ${{ start: 'running', run: 'run id recorded' }[verb] ?? (flags['keep-open'] ? 'run recorded' : 'done')}`,
  );
  return 0;
}

function cmdRecord(pos, flags) {
  const state = loadState(ROOT, need(pos[0], '<slug>'));
  assertOnBranch(state);
  const kind = need(pos[1], 'findings|session|qa');
  const input = readStdin();
  let rel;
  if (kind === 'findings') {
    const phaseName = need(pos[2], '<phase>');
    const acceptIncomplete = stringFlag(flags, 'accept-incomplete');
    rel = recordFindings(ROOT, state, phaseName, JSON.parse(input), now(), {
      acceptIncomplete,
      head: head(ROOT),
    });
    if (acceptIncomplete) {
      state.decisions.push({
        at: now(),
        actor: 'orchestrator',
        source: `record findings ${phaseName} --accept-incomplete`,
        text: `accepted an incomplete review of ${phaseName}: ${acceptIncomplete}`,
        claim: true,
      });
    }
  } else if (kind === 'session') {
    rel = recordReport(ROOT, state, need(pos[2], '<phase>'), JSON.parse(input), now());
  } else if (kind === 'qa') rel = recordQa(ROOT, state, input, now());
  else throw new Refusal(`unknown record kind "${kind}"`);
  saveState(ROOT, state);
  console.log(`stored ${rel}`);
  return 0;
}

function cmdDecide(pos, flags) {
  const state = loadState(ROOT, need(pos[0], '<slug>'));
  assertOnBranch(state);
  state.decisions.push({
    at: now(),
    actor: need(flags.actor, '--actor'),
    source: need(flags.source, '--source'),
    text: need(flags.text, '--text'),
    claim: true,
  });
  saveState(ROOT, state);
  return 0;
}

function cmdCost(pos, flags) {
  const state = loadState(ROOT, need(pos[0], '<slug>'));
  assertOnBranch(state);
  const usd = numberFlag(flags, 'usd');
  if (usd === undefined) throw new Refusal('missing --usd <number>');
  state.costs.push({
    at: now(),
    usd,
    note: typeof flags.note === 'string' ? flags.note : '',
    entered: true,
  });
  saveState(ROOT, state);
  return 0;
}

/** The slice a gate belongs to: --slice, else the running or last finished phase's. */
function gateSlice(state, flags) {
  if (typeof flags.slice === 'string') return flags.slice;
  const touched = state.phases.filter((p) => p.status !== 'pending');
  for (const p of touched.reverse()) {
    const slice = sliceOfPhase(state, p.name);
    if (slice) return slice.id;
    if (p.name.endsWith(':whole') || !p.name.includes(':')) return null;
  }
  return null;
}

/**
 * The flake policy's one re-gate: of the LATEST gate, which failed, on the same
 * commit with the same SQL leg, and has not been retried already. A retry after a
 * code change is a new gate, not a retry; a second retry is a pattern, not a flake.
 */
export function checkRetry(state, commit, sql) {
  const index = state.gates.length - 1;
  const last = state.gates[index];
  if (!last || last.passed) throw new Refusal('--retry needs a failed gate to retry');
  if (last.commit !== commit || last.sql !== sql) {
    throw new Refusal('--retry re-runs the failed gate as it was: same commit, same --sql');
  }
  if (last.retryOf !== undefined || state.gates.some((g) => g.retryOf === index)) {
    throw new Refusal('that failure was already retried once — it is a failure, not a flake');
  }
  return index;
}

function cmdGate(pos, flags) {
  const state = loadState(ROOT, need(pos[0], '<slug>'));
  assertOnBranch(state);
  const dirty = dirtyPaths(ROOT, { exclude: [`${BUNDLES_DIR}/`] });
  if (dirty.length)
    throw new Refusal(
      `commit first — a gate records a commit. Dirty: ${dirty.slice(0, 5).join(', ')}`,
    );
  const commit = head(ROOT);
  const sql = Boolean(flags.sql);
  const retryOf = flags.retry ? checkRetry(state, commit, sql) : undefined;
  const flake = flags.retry
    ? need(flags.flake, `--flake <${Object.keys(KNOWN_FLAKES).join('|')}>`)
    : undefined;
  if (flake && !KNOWN_FLAKES[flake]) {
    throw new Refusal(
      `--flake ${flake} is not an allowlisted flake (${Object.keys(KNOWN_FLAKES).join(', ')})`,
    );
  }
  console.log(`gate on ${commit.slice(0, 8)}${sql ? ' (with SQL)' : ''}`);
  const out = runGate({ cwd: ROOT, sql });
  if (out.refused) throw new Refusal(`gate preflight: ${out.refused}`);
  const passed = gatePassed(out.results);
  // Reload: a gate runs for minutes, and the compare-and-swap in saveState would
  // otherwise throw the whole result away over an unrelated write meanwhile.
  const fresh = loadState(ROOT, state.slug);
  fresh.gates.push({
    commit,
    at: now(),
    slice: gateSlice(fresh, flags),
    sql,
    passed,
    checks: out.results.map(({ name, result, ms, note }) => ({
      name,
      result,
      ms,
      ...(note ? { note } : {}),
    })),
    ...(retryOf !== undefined ? { retryOf, flake } : {}),
  });
  saveState(ROOT, fresh);
  for (const r of out.results.filter((x) => x.result === 'fail')) {
    console.log(`\n── ${r.name} (stdout tail, then stderr tail) ──\n${r.tail}`);
  }
  console.log(
    `\ngate ${passed ? 'PASSED' : 'FAILED'} — recorded as gate #${fresh.gates.length - 1}`,
  );
  return passed ? 0 : 1;
}

function cmdLock(pos) {
  if (pos[0] !== 'status')
    throw new Refusal('only `lock status` exists — the lock is taken by its users');
  const file = lockPath(ROOT);
  const lock = readLock(file);
  console.log(lock ? `held: ${JSON.stringify({ ...lock, nonce: undefined })}` : `free (${file})`);
  return 0;
}

function cmdCheck(pos, flags) {
  const rows = [...repoChecks(ROOT)];
  if (!flags.ci) {
    const slug = resolveSlug(pos[0]);
    if (slug) {
      const state = loadState(ROOT, slug);
      assertOnBranch(state);
      rows.push(...bundleChecks(ROOT, state));
    } else rows.push(['bundle', { status: 'SKIP', note: 'no bundle state for this branch' }]);
  }
  const width = Math.max(...rows.map(([name]) => name.length));
  for (const [name, r] of rows)
    console.log(`${r.status.padEnd(4)}  ${name.padEnd(width)}  ${r.note}`);
  return rows.some(([, r]) => r.status === FAIL) ? 1 : 0;
}

function cmdCloseoutDraft(pos) {
  const state = loadState(ROOT, need(pos[0], '<slug>'));
  process.stdout.write(
    renderCloseoutDraft(state, { planSha: sha256File(path.join(ROOT, state.plan.path)) }),
  );
  return 0;
}

const COMMANDS = {
  init: cmdInit,
  status: cmdStatus,
  args: cmdArgs,
  phase: cmdPhase,
  record: cmdRecord,
  decide: cmdDecide,
  cost: cmdCost,
  gate: cmdGate,
  lock: cmdLock,
  check: cmdCheck,
  'closeout-draft': cmdCloseoutDraft,
};

export function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  const fn = COMMANDS[command];
  if (!fn) {
    console.error(`usage: node scripts/bundle.mjs <${Object.keys(COMMANDS).join('|')}> …`);
    return 2;
  }
  const { pos, flags } = parseArgv(rest);
  try {
    return fn(pos, flags);
  } catch (err) {
    console.error(`bundle ${command}: ${err.message}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
