#!/usr/bin/env node
// src/bundle.mjs — the bundle workflow's CLI: the only writer of bundle state.
//
// WHAT: a feature bundle runs as a chain of phases (plan review, one implement run
//   per session, review/fix per slice, the whole-branch pass, QA, closeout). This CLI
//   records each phase, runs the gate between them, emits the Workflow `args`, stores
//   what sessions returned, and runs the landing check. The procedure itself is the
//   playbook (`paths.playbook` in cookwright.json); the entry point is the `/bundle`
//   skill; the Workflow script belongs to the host adapter (hosts/<host>/workflows/).
//
// WHY: scripts own facts, models own judgment. Before this, the orchestrator carried
//   commits, gate results and run ids in its context and relayed them into prompts —
//   the class of mistake that put a fabricated claim in a closeout. Now they live in a
//   file a script wrote.
//
// WHERE: run from anywhere inside a repo that has a cookwright.json; the CLI walks up
//   to it and treats that directory as the root.
//
// USAGE (CLI = npx cookwright bundle; the `cookwright` bin dispatches here)
//   CLI init <slug> --plan <path> --split <file.json>
//   CLI status [slug]
//   CLI args <slug> <phase>
//   CLI phase <slug> start <phase> [--token-target N]
//   CLI phase <slug> run <phase> --run-id R [--transcript-dir D]
//   CLI phase <slug> done <phase> [--run-id R] [--transcript-dir D] [--usage N]
//                                 [--keep-open] [--accept-open "<reason>"]
//                                 [--no-device "<reason>"]   (qa)
//   CLI record <slug> findings <phase> [--accept-incomplete "<reason>"]  < result.json
//   CLI record <slug> session <phase>                                    < impl.json
//   CLI record <slug> qa                                                 < notes.md
//   CLI decide <slug> --actor A --source S --text T
//   CLI cost <slug> --usd N [--note T]
//   CLI gate <slug> [--slice id] [--retry --flake <id>]
//   CLI check [slug] [--ci]
//   CLI closeout-draft <slug>
//
// Exit codes: 0 = ok / check passed, 1 = check or gate failed, 2 = refused (bad
// input, wrong branch, dirty tree, missing state, no cookwright.json).

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { bundleChecks, repoChecks, summarize, FAIL } from './lib/bundle/check.mjs';
import { renderCloseoutDraft } from './lib/bundle/closeout.mjs';
import { gatePassed, onPath, passLabel, runGate } from './lib/bundle/gate.mjs';
import {
  currentBranch,
  dirtyPaths,
  head,
  isAncestor,
  lastCodeCommit,
  mergeBase,
} from './lib/bundle/git.mjs';
import { messages } from './lib/bundle/messages.mjs';
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
  bundleRel,
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
import { Refusal, need, numberFlag, parseArgv, stringFlag } from './lib/cli.mjs';
import { findRoot, loadConfig } from './lib/config.mjs';
import { workflowScript } from './lib/hosts.mjs';

const now = () => new Date().toISOString();

// The shared argv pieces live in lib/cli.mjs; re-exported for the tests.
export { parseArgv, Refusal };

const readStdin = () => fs.readFileSync(0, 'utf8');

// ── the repo ─────────────────────────────────────────────────────────────────

/** The repo = { root, config }: the checkout holding cookwright.json above `cwd`. */
export function openRepo(cwd) {
  const root = findRoot(cwd);
  if (!root) throw new Refusal(messages.noConfig);
  try {
    return { root, config: loadConfig(root) };
  } catch (err) {
    throw new Refusal(err.message);
  }
}

/** The named bundle, or the one whose recorded branch is checked out. */
function resolveSlug(repo, slug) {
  if (slug) return slug;
  const branch = currentBranch(repo.root);
  const matches = listStates(repo).filter((s) => s.branch === branch);
  if (matches.length === 1) return matches[0].slug;
  if (matches.length > 1) throw new Refusal(`several bundles claim branch ${branch}`);
  return null;
}

/** Load a bundle's state and refuse unless its branch is the one checked out. */
function openBundle(repo, slug) {
  const state = loadState(repo, need(slug, '<slug>'));
  const branch = currentBranch(repo.root);
  if (branch !== state.branch) {
    throw new Refusal(`bundle ${state.slug} lives on ${state.branch}; checked out: ${branch}`);
  }
  return state;
}

/** Record a decision the orchestrator took by passing a named flag. */
function decide(state, source, text) {
  state.decisions.push({ at: now(), actor: 'orchestrator', source, text, claim: true });
}

// ── init ─────────────────────────────────────────────────────────────────────

/** Everything `init` needs, validated BEFORE the tree is touched: a refused init must
 * leave it clean, or the corrected retry is refused as dirty. */
function readInitInputs(repo, pos, flags) {
  const slug = need(pos[0], '<slug>');
  const branch = currentBranch(repo.root);
  if (!branch || branch === repo.config.baseBranch) {
    throw new Refusal('cut the bundle branch first — init records the branch checked out now');
  }
  if (fs.existsSync(statePath(repo, slug))) throw new Refusal(`bundle ${slug} already exists`);
  const dirty = dirtyPaths(repo.root);
  if (dirty.length) throw new Refusal(`tree is dirty: ${dirty.slice(0, 5).join(', ')}`);
  const split = JSON.parse(fs.readFileSync(need(flags.split, '--split <file>'), 'utf8'));
  const source = need(flags.plan, '--plan <path>');
  if (!fs.existsSync(source)) throw new Refusal(`no plan at ${source}`);
  if (!SLUG.test(slug)) throw new Refusal(`bad slug "${slug}" (lowercase, digits, dashes)`);
  const errors = validateSplit(split);
  if (errors.length) throw new Refusal(`invalid split:\n  ${errors.join('\n  ')}`);
  return { slug, branch, split, source };
}

function cmdInit(repo, pos, flags) {
  const { slug, branch, split, source } = readInitInputs(repo, pos, flags);
  // The plan is COPIED into the bundle, committed with it: a plan left in a session
  // scratchpad is unreadable to the next machine or the next session, and every args
  // call hashes it. Revisions happen to the copy.
  const planPath = bundleRel(repo, slug, 'plan.md');
  fs.mkdirSync(path.dirname(path.join(repo.root, planPath)), { recursive: true });
  fs.copyFileSync(source, path.join(repo.root, planPath));
  const state = initState({
    repo,
    slug,
    planPath,
    split,
    branch,
    base: mergeBase(repo.config.baseBranch, 'HEAD', repo.root),
    now: now(),
  });
  saveState(repo, state);
  console.log(`bundle ${slug} on ${branch}, base ${state.base.slice(0, 8)}; plan → ${planPath}`);
  console.log(`phases: ${state.phases.map((p) => p.name).join(' → ')}`);
  return 0;
}

// ── status and args ──────────────────────────────────────────────────────────

function cmdStatus(repo, pos) {
  const slug = resolveSlug(repo, pos[0]);
  if (!slug) {
    console.log(`no bundle state for this branch (${repo.config.paths.bundles}/<slug>/state.json)`);
    return 0;
  }
  const state = loadState(repo, slug);
  const phase = currentPhase(state);
  const lastGate = state.gates.at(-1);
  console.log(`bundle   : ${state.slug} (${state.branch}, base ${state.base.slice(0, 8)})`);
  console.log(`plan     : ${state.plan.path}`);
  console.log(`phases   : ${state.phases.map((p) => `${p.name}[${p.status}]`).join(' ')}`);
  console.log(
    `last gate: ${lastGate ? `${lastGate.passed ? passLabel(lastGate) : 'FAIL'} on ${lastGate.commit.slice(0, 8)}` : 'none'}`,
  );
  console.log(`next     : ${nextAction(repo, state, phase)}`);
  return 0;
}

export function nextAction(repo, state, phase) {
  const { next } = messages;
  if (!phase) return next.allDone;
  const slug = state.slug;
  if (phase.status === 'pending') return next.start(slug, phase.name);
  const kind = kindOf(phase.name);
  if (kind === 'qa' && state.qaRounds.length === 0) return next.qaRound(slug);
  if (!WORKFLOW_KINDS.has(kind)) return next.outsideWorkflow(slug, phase.name);
  const script = workflowScript(repo.config, 'bundle-phase');
  // Resume ONLY a run in flight: a finished run replayed from cache would hand back
  // its old result — for a QA round, a review of code it never saw.
  const run = phase.runs.at(-1);
  if (run?.runId && !run.endedAt) return next.resume(script, run.runId, slug, phase.name);
  if (run?.runId) return next.afterRun(slug, phase.name);
  return next.launch(script, slug, phase.name);
}

function cmdArgs(repo, pos) {
  const state = openBundle(repo, pos[0]);
  console.log(JSON.stringify(workflowArgs(state, need(pos[1], '<phase>'), repo)));
  return 0;
}

// ── phase ────────────────────────────────────────────────────────────────────

function phaseStart(repo, state, name, flags) {
  const tip = head(repo.root);
  const p = startPhase(state, name, {
    head: tip,
    now: now(),
    tokenTarget: numberFlag(flags, 'token-target'),
    mergeBase: mergeBase(repo.config.baseBranch, tip, repo.root),
    planSha: sha256File(path.join(repo.root, state.plan.path)),
    codex: onPath('codex'),
  });
  if (p.range) console.log(`range frozen: ${p.range.from.slice(0, 8)}..${p.range.to.slice(0, 8)}`);
  return 'running';
}

function phaseRun(state, name, flags) {
  setRunId(state, name, {
    runId: need(flags['run-id'], '--run-id <id>'),
    transcriptDir: stringFlag(flags, 'transcript-dir'),
  });
  return 'run id recorded';
}

function phaseDone(repo, state, name, flags) {
  const acceptOpen = stringFlag(flags, 'accept-open');
  const noDevice = stringFlag(flags, 'no-device');
  const keepOpen = Boolean(flags['keep-open']);
  const tip = head(repo.root);
  const base = mergeBase(repo.config.baseBranch, tip, repo.root);
  const phase = state.phases.find((p) => p.name === name);
  const ctx = {
    head: tip,
    lastCode: lastCodeCommit(base, tip, repo),
    qaLastCode: phase?.startCommit ? lastCodeCommit(phase.startCommit, tip, repo) : tip,
    contains: (a, b) => isAncestor(a, b, repo.root),
    acceptOpen,
    noDevice,
  };
  const blocker = keepOpen ? null : doneBlocker(state, name, ctx);
  if (blocker) throw new Refusal(blocker);
  if (noDevice && !keepOpen) decide(state, `phase done ${name} --no-device`, `no QA round: ${noDevice}`);
  if (acceptOpen && !keepOpen) {
    decide(state, `phase done ${name} --accept-open`, `closed ${name} with findings open: ${acceptOpen}`);
  }
  finishPhase(state, name, {
    now: now(),
    head: tip,
    lastCode: ctx.lastCode,
    runId: stringFlag(flags, 'run-id'),
    transcriptDir: stringFlag(flags, 'transcript-dir'),
    usage: numberFlag(flags, 'usage'),
    keepOpen,
  });
  return keepOpen ? 'run recorded' : 'done';
}

function cmdPhase(repo, pos, flags) {
  const state = openBundle(repo, pos[0]);
  const verb = need(pos[1], 'start|run|done');
  const name = need(pos[2], '<phase>');
  let outcome;
  if (verb === 'start') outcome = phaseStart(repo, state, name, flags);
  else if (verb === 'run') outcome = phaseRun(state, name, flags);
  else if (verb === 'done') outcome = phaseDone(repo, state, name, flags);
  else throw new Refusal(`unknown phase verb "${verb}"`);
  saveState(repo, state);
  console.log(`${name}: ${outcome}`);
  return 0;
}

// ── records ──────────────────────────────────────────────────────────────────

function cmdRecord(repo, pos, flags, io) {
  const state = openBundle(repo, pos[0]);
  const kind = need(pos[1], 'findings|session|qa');
  const input = io.input();
  let rel;
  if (kind === 'findings') {
    const phaseName = need(pos[2], '<phase>');
    const acceptIncomplete = stringFlag(flags, 'accept-incomplete');
    rel = recordFindings(repo, state, phaseName, JSON.parse(input), now(), {
      acceptIncomplete,
      head: head(repo.root),
    });
    if (acceptIncomplete) {
      decide(
        state,
        `record findings ${phaseName} --accept-incomplete`,
        `accepted an incomplete review of ${phaseName}: ${acceptIncomplete}`,
      );
    }
  } else if (kind === 'session') {
    rel = recordReport(repo, state, need(pos[2], '<phase>'), JSON.parse(input), now());
  } else if (kind === 'qa') rel = recordQa(repo, state, input, now());
  else throw new Refusal(`unknown record kind "${kind}"`);
  saveState(repo, state);
  console.log(`stored ${rel}`);
  return 0;
}

function cmdDecide(repo, pos, flags) {
  const state = openBundle(repo, pos[0]);
  state.decisions.push({
    at: now(),
    actor: need(flags.actor, '--actor'),
    source: need(flags.source, '--source'),
    text: need(flags.text, '--text'),
    claim: true,
  });
  saveState(repo, state);
  return 0;
}

function cmdCost(repo, pos, flags) {
  const state = openBundle(repo, pos[0]);
  const usd = numberFlag(flags, 'usd');
  if (usd === undefined) throw new Refusal('missing --usd <number>');
  state.costs.push({
    at: now(),
    usd,
    note: typeof flags.note === 'string' ? flags.note : '',
    entered: true,
  });
  saveState(repo, state);
  return 0;
}

// ── gate ─────────────────────────────────────────────────────────────────────

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
 * commit, and has not been retried already. A retry after a code change is a new
 * gate, not a retry; a second retry is a pattern, not a flake.
 */
export function checkRetry(state, commit) {
  const index = state.gates.length - 1;
  const last = state.gates[index];
  if (!last || last.passed) throw new Refusal('--retry needs a failed gate to retry');
  if (last.commit !== commit) throw new Refusal('--retry re-runs the failed gate as it was: same commit');
  if (last.retryOf !== undefined || state.gates.some((g) => g.retryOf === index)) {
    throw new Refusal('that failure was already retried once — it is a failure, not a flake');
  }
  return index;
}

/** The retry flags, checked against the state and the configured flake allowlist. */
function gateFlags(repo, state, flags, commit) {
  if (!flags.retry) return {};
  const flakes = repo.config.gate.flakes;
  const ids = Object.keys(flakes);
  if (ids.length === 0) throw new Refusal(messages.noFlakes);
  const retryOf = checkRetry(state, commit);
  const flake = need(flags.flake, `--flake <${ids.join('|')}>`);
  if (!flakes[flake]) {
    throw new Refusal(`--flake ${flake} is not an allowlisted flake (${ids.join(', ')})`);
  }
  return { retryOf, flake };
}

function cmdGate(repo, pos, flags) {
  const state = openBundle(repo, pos[0]);
  const dirty = dirtyPaths(repo.root, { exclude: [`${repo.config.paths.bundles}/`] });
  if (dirty.length) {
    throw new Refusal(`commit first — a gate records a commit. Dirty: ${dirty.slice(0, 5).join(', ')}`);
  }
  const commit = head(repo.root);
  const retry = gateFlags(repo, state, flags, commit);
  console.log(`gate on ${commit.slice(0, 8)}`);
  const out = runGate({ repo });
  if (out.refused) throw new Refusal(out.refused);
  const passed = gatePassed(out.results);
  const index = recordGate(repo, state.slug, { commit, flags, passed, results: out.results, ...retry });
  for (const r of out.results.filter((x) => x.result === 'fail')) {
    console.log(`\n── ${r.name} (stdout tail, then stderr tail) ──\n${r.tail}`);
  }
  console.log(`\ngate ${passed ? 'PASSED' : 'FAILED'} — recorded as gate #${index}`);
  return passed ? 0 : 1;
}

/** Append the gate event to a FRESH state: a gate runs for minutes, and the
 * compare-and-swap in saveState would otherwise throw the whole result away over an
 * unrelated write meanwhile. Returns the event's index. */
function recordGate(repo, slug, { commit, flags, passed, results, retryOf, flake }) {
  const fresh = loadState(repo, slug);
  fresh.gates.push({
    commit,
    at: now(),
    slice: gateSlice(fresh, flags),
    passed,
    checks: results.map(({ name, result, ms, note }) => ({
      name,
      result,
      ms,
      ...(note ? { note } : {}),
    })),
    ...(retryOf !== undefined ? { retryOf, flake } : {}),
  });
  saveState(repo, fresh);
  return fresh.gates.length - 1;
}

// ── check and closeout ───────────────────────────────────────────────────────

function cmdCheck(repo, pos, flags) {
  const rows = [...repoChecks(repo)];
  if (!flags.ci) {
    const slug = resolveSlug(repo, pos[0]);
    if (slug) rows.push(...bundleChecks(repo, openBundle(repo, slug)));
    else rows.push(['bundle', { status: 'SKIP', note: 'no bundle state for this branch' }]);
  }
  const width = Math.max(...rows.map(([name]) => name.length));
  for (const [name, r] of rows)
    console.log(`${r.status.padEnd(4)}  ${name.padEnd(width)}  ${r.note}`);
  const counts = summarize(rows);
  console.log(`\n${messages.summary(counts)}`);
  return rows.some(([, r]) => r.status === FAIL) ? 1 : 0;
}

function cmdCloseoutDraft(repo, pos) {
  const state = loadState(repo, need(pos[0], '<slug>'));
  process.stdout.write(
    renderCloseoutDraft(state, { planSha: sha256File(path.join(repo.root, state.plan.path)) }),
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
  check: cmdCheck,
  'closeout-draft': cmdCloseoutDraft,
};

/** `io.input` reads stdin; tests inject it. */
export function main(argv = process.argv.slice(2), { cwd = process.cwd(), input = readStdin } = {}) {
  const [command, ...rest] = argv;
  const fn = COMMANDS[command];
  if (!fn) {
    console.error(messages.usage(Object.keys(COMMANDS)));
    return 2;
  }
  const { pos, flags } = parseArgv(rest);
  try {
    return fn(openRepo(cwd), pos, flags, { input });
  } catch (err) {
    console.error(`bundle ${command}: ${err.message}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
