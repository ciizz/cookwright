// src/standards.mjs — `cookwright standards [--staged | --ratchet | --types]`: the
// declared packs' rules, measured (stage-4 plan §4.5, §4.6). The engine is
// lib/packs/standards.mjs; the types measure is lib/packs/types.mjs.
//
// No flag: the count per pack rule over HEAD's files under the config root, the
// number an existing app sees first. `--staged` (what the pre-commit check spawns,
// disposition 26): the per-file ratchet over the staged files (disposition 31), a
// file's count of a rule at the index against HEAD, so touching a legacy file
// without adding a violation passes. `--ratchet` (the gate's check): each rule's
// count over the files the branch changed, at HEAD against the base
// (lib/packs/base.mjs), so a rise is drift. `--types` (the gate's other check):
// the Supabase types measure alone, never folded into the ratchet (disposition 30).
//
// Exit 0 measured (no rise), 10 a count rose, 11 cannot measure, 2 a usage error.
// `--staged` prints its findings first and its verdict last, the line the hook
// records; `--ratchet` and `--types` print their verdict first, the line the gate
// records as the check's note (disposition 45), the findings below it. A line names
// every rule it did not measure (disposition 37).

import fs from 'node:fs';

import { TimedOut } from './lib/budget.mjs';
import { Refusal, onlyFlags, parseArgv } from './lib/cli.mjs';
import { CONFIG_FILE, findRoot, loadConfig, workTreeRoot } from './lib/config.mjs';
import { oneLine } from './lib/doctor/repo.mjs';
import { messages } from './lib/messages.mjs';
import { resolveBase } from './lib/packs/base.mjs';
import * as engine from './lib/packs/standards.mjs';
import { measureTypes } from './lib/packs/types.mjs';

const m = messages.standards;
const { ROSE_EXIT, SKIP_EXIT, Unmeasurable } = engine;

/** `{ top, root, config }` from `cwd`, real paths; Unmeasurable outside a work tree or without a valid config. */
function openRepo(cwd) {
  const top = workTreeRoot(cwd);
  if (!top) throw new Unmeasurable(m.notWorkTree);
  const root = findRoot(cwd, { stopAt: top });
  if (!root) throw new Unmeasurable(m.noConfig);
  let config;
  try {
    config = loadConfig(root);
  } catch (err) {
    const line = oneLine(err.message);
    throw new Unmeasurable(m.configInvalid(line.startsWith(`${CONFIG_FILE}:`) ? line.slice(CONFIG_FILE.length + 1).trim() : line));
  }
  return { top: fs.realpathSync(top), root: fs.realpathSync(root), config };
}

/**
 * The repo with ESLint loaded and each rule's wiring read; Unmeasurable when no rule
 * can count. A mode calls it only once git listed a file to lint, so a commit with
 * none never pays ESLint's start-up (about 1.1 s) nor skips for its absence.
 */
async function prepare(repo, io) {
  const rules = engine.eslintRules(repo.config);
  const load = io.loadESLint ?? engine.loadESLint;
  const { eslint } = await load(repo.root, rules[0].pack.manifest.setup.eslint);
  const { measured, skipped } = await engine.wired(eslint, repo.root, rules);
  if (!measured.length) throw new Unmeasurable(m.noneMeasured(skipped));
  return { ...repo, eslint, measured, skipped };
}

/** Each rule whose count in one file rose, in the rules' order: `{ key, from, to }`. */
function rises(ctx, { now, before }) {
  return ctx.measured
    .map(({ key }) => ({ key, from: before.counts.get(key) ?? 0, to: now.counts.get(key) ?? 0 }))
    .filter((c) => c.to > c.from);
}

/** One staged entry, both sides: the index's blob, and HEAD's (none for an added file). */
async function judgeFile(ctx, entry, blobs) {
  const { eslint, top, measured } = ctx;
  const now = await engine.lintAt(eslint, top, entry.path, blobs.get(entry.sha), measured);
  // A rename's HEAD side is linted at its new path, which is on disk and in the project (disposition 47).
  const before = engine.hasBase(entry) ? await engine.lintAt(eslint, top, entry.path, blobs.get(entry.baseSha), measured) : engine.NOTHING;
  return { entry, now, before, file: engine.shownPath(top, ctx.root, entry.path) };
}

/** The `--staged` report over the judged files: exit and lines. */
function stagedReport(ctx, judged, deleted) {
  const unmeasured = judged.filter((j) => j.now.unmeasured || j.before.unmeasured);
  const items = unmeasured.map((j) => m.notMeasuredItem(j.file, j.now.unmeasured ?? j.before.unmeasured));
  const extras = [...ctx.skipped, ...(items.length ? [m.notMeasured(items)] : []), ...(deleted ? [m.deleted(deleted)] : [])];
  const risen = judged.filter((j) => !unmeasured.includes(j)).map((j) => ({ j, changes: rises(ctx, j) })).filter((r) => r.changes.length);
  if (risen.length) {
    const findings = risen.flatMap(({ j, changes }) =>
      j.now.findings.filter((f) => changes.some((c) => c.key === f.key)).map((f) => engine.render(j.file, f)),
    );
    const rose = m.rose(risen.map(({ j, changes }) => m.roseItem(j.file, changes.map((c) => m.change(c.key, c.from, c.to)))));
    return { exit: ROSE_EXIT, lines: [...findings, m.tail(rose, extras)] };
  }
  if (items.length) return { exit: SKIP_EXIT, lines: [m.tail(m.skippedBecause(m.notMeasured(items)), [...ctx.skipped, ...(deleted ? [m.deleted(deleted)] : [])])] };
  return { exit: 0, lines: [m.tail(m.noRise(judged.length), extras)] };
}

/** `--staged`: the per-file ratchet over the staged entries under the config root. */
async function stagedMode(repo, io) {
  const all = engine.stagedEntries(repo.top, repo.root, repo.env);
  const files = all.filter(engine.lintable);
  const deleted = all.filter(engine.deletedLintable).length;
  if (!files.length) return { exit: 0, lines: [m.tail(m.noStaged, deleted ? [m.deleted(deleted)] : [])] };
  const ctx = await prepare(repo, io);
  const shas = files.flatMap((e) => (engine.hasBase(e) ? [e.sha, e.baseSha] : [e.sha]));
  const blobs = engine.readBlobs(ctx.top, shas, ctx.env);
  const judged = [];
  for (const entry of files) judged.push(await judgeFile(ctx, entry, blobs));
  return stagedReport(ctx, judged, deleted);
}

/** The base of a branch measure, `{ sha, since }`; Unmeasurable naming every candidate when none resolves. */
export function branchBase(repo, flags, env) {
  const base = resolveBase(repo.top, { flag: flags.base, env, baseBranch: repo.config.baseBranch });
  if (!base.sha) throw new Unmeasurable(m.noBase(base.tried));
  return { sha: base.sha, since: m.since(base.sha, base.label) };
}

/** Each measured rule's count summed over the judged files, `{ key, from, to, files }`, `files` those it rose in. */
function sumsOf(ctx, judged) {
  return ctx.measured.map(({ key }) => {
    const side = (j, s) => j[s].counts.get(key) ?? 0;
    const from = judged.reduce((n, j) => n + side(j, 'before'), 0);
    const to = judged.reduce((n, j) => n + side(j, 'now'), 0);
    return { key, from, to, files: judged.filter((j) => side(j, 'now') > side(j, 'before')).map((j) => j.file) };
  });
}

/** The `--ratchet` report over the judged files: the verdict line first, the risen rules' findings after. */
function ratchetReport(ctx, judged, deleted, since) {
  const unmeasured = judged.filter((j) => j.now.unmeasured || j.before.unmeasured);
  const items = unmeasured.map((j) => m.notMeasuredItem(j.file, j.now.unmeasured ?? j.before.unmeasured));
  const gone = deleted ? [m.deleted(deleted)] : [];
  const extras = [...ctx.skipped, ...(items.length ? [m.notMeasured(items)] : []), ...gone];
  const measured = judged.filter((j) => !unmeasured.includes(j));
  const sums = sumsOf(ctx, measured);
  const risen = sums.filter((c) => c.to > c.from);
  if (risen.length) {
    const line = m.tail(m.ratchetRose(risen.map((c) => m.risenItem(m.change(c.key, c.from, c.to), c.files)), since), extras);
    const findings = measured.flatMap((j) =>
      j.now.findings.filter((f) => risen.some((c) => c.key === f.key && c.files.includes(j.file))).map((f) => engine.render(j.file, f)),
    );
    return { exit: ROSE_EXIT, lines: [line, ...findings] };
  }
  if (items.length) return { exit: SKIP_EXIT, lines: [m.tail(m.skippedBecause(m.notMeasured(items)), [...ctx.skipped, ...gone])] };
  return { exit: 0, lines: [m.ratchet(sums.map((c) => m.change(c.key, c.from, c.to)), extras, judged.length, since)] };
}

/** `--ratchet`: each rule's count over the files changed since the base, HEAD against the base. */
async function ratchetMode(repo, flags, io) {
  const { sha, since } = branchBase(repo, flags, repo.env);
  const all = engine.rangeEntries(repo.top, repo.root, sha, repo.env);
  const files = all.filter(engine.lintable);
  const deleted = all.filter(engine.deletedLintable).length;
  if (!files.length) return { exit: 0, lines: [m.tail(m.noChange(since), deleted ? [m.deleted(deleted)] : [])] };
  const ctx = await prepare(repo, io);
  const blobs = engine.readBlobs(ctx.top, files.flatMap((e) => (engine.hasBase(e) ? [e.sha, e.baseSha] : [e.sha])), ctx.env);
  const judged = [];
  for (const entry of files) judged.push(await judgeFile(ctx, entry, blobs));
  return ratchetReport(ctx, judged, deleted, since);
}

/** No flag: the count per measured rule over HEAD's files. */
async function countMode(repo, io) {
  const entries = engine.headEntries(repo.top, repo.root, repo.env);
  if (!entries) throw new Unmeasurable(m.noHead);
  const ctx = await prepare(repo, io);
  const files = entries.filter(engine.lintable);
  const blobs = engine.readBlobs(ctx.top, files.map((e) => e.sha), ctx.env);
  const totals = new Map(ctx.measured.map(({ key }) => [key, 0]));
  const items = [];
  for (const entry of files) {
    const side = await engine.lintAt(ctx.eslint, ctx.top, entry.path, blobs.get(entry.sha), ctx.measured);
    if (side.unmeasured) items.push(m.notMeasuredItem(engine.shownPath(ctx.top, ctx.root, entry.path), side.unmeasured));
    else for (const [key, n] of side.counts) totals.set(key, totals.get(key) + n);
  }
  const lines = ctx.measured.map(({ key, pack, rule }) => m.count(pack.name, rule.id, totals.get(key)));
  const extras = [...ctx.skipped, ...(items.length ? [m.notMeasured(items)] : [])];
  return { exit: 0, lines: [...lines, m.tail(m.counted(files.length - items.length), extras)] };
}

const MODES = ['staged', 'ratchet', 'types'];

/** The flags, or a Refusal: no positional, at most one mode, `--base <ref>` only with a branch measure. */
function parse(argv) {
  const { pos, flags } = parseArgv(argv);
  onlyFlags(flags, [...MODES, 'base']);
  const modes = MODES.filter((f) => flags[f] !== undefined);
  const base = flags.base === undefined || (typeof flags.base === 'string' && Boolean(flags.ratchet || flags.types));
  if (pos.length || modes.length > 1 || modes.some((f) => flags[f] !== true) || !base) throw new Refusal(m.usage);
  return flags;
}

/** The measure `flags` names over `repo`: `{ exit, lines }`. */
async function measure(repo, flags, io) {
  const env = io.env ?? process.env;
  if (flags.types) return measureTypes({ ...repo, env }, { base: () => branchBase(repo, flags, env) });
  if (!engine.eslintRules(repo.config).length) throw new Unmeasurable(m.noRules);
  const ctx = { ...repo, env };
  if (flags.staged) return stagedMode(ctx, io);
  return flags.ratchet ? ratchetMode(ctx, flags, io) : countMode(ctx, io);
}

const harness = (err) => (err instanceof TimedOut ? messages.timedOut(err.what) : String(err?.message ?? err).split('\n')[0]);

/**
 * `io.cwd`, `io.env` (git's and the supabase CLI's environment, and the source of
 * COOKWRIGHT_PUSH_BASE; process.env by default) and `io.loadESLint` (the fake
 * ESLint's seam) are the tests'; the bin passes none.
 */
export async function main(argv = [], io = {}) {
  let flags;
  try {
    flags = parse(argv);
  } catch (err) {
    if (!(err instanceof Refusal)) throw err;
    if (err.message !== m.usage) console.error(err.message);
    console.error(m.usage);
    return 2;
  }
  try {
    const { exit, lines } = await measure(openRepo(io.cwd ?? process.cwd()), flags, io);
    for (const line of lines) console.log(line);
    return exit;
  } catch (err) {
    console.log(err instanceof Unmeasurable ? err.message : m.couldNotRun(harness(err)));
    return SKIP_EXIT;
  }
}
