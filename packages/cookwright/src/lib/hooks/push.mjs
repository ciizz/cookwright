// src/lib/hooks/push.mjs — the pre-push checks, `gate` and `changelog`, and what
// git's stdin says is being pushed (plan §4.1).
//
// They judge the working tree, so they run only when it is a pushed commit (judgment
// rule 3: what is judged must be what is tested, else SKIP with the reason). Each
// pushed sha is peeled to its commit, so an annotated tag on HEAD counts as HEAD.
// They SKIP when no pushed ref is HEAD, and on a dirty tree, which is not HEAD
// either. When HEAD is pushed with other refs they run, and each verdict names the
// refs it tested and the ones it did not. Never a refusal, which would breed
// --no-verify; a temporary worktree per pushed sha is the real fix (backlogged).

import fs from 'node:fs';

import { planChecks, runGate } from '../bundle/gate.mjs';
import { changelogState } from '../changelog/state.mjs';
import { gitRun } from '../doctor/repo.mjs';
import { messages } from '../messages.mjs';
import { fail, pass, skip } from '../verdict.mjs';

const m = messages.hook;
const GIT_CAP_MS = 60_000;

/**
 * The variables git sets for a hook that point at this repository, as
 * `git rev-parse --local-env-vars` lists them (git 2.52); githooks(5) says a hook
 * working in another repository must clear them. The gate's commands run without
 * them, so a suite that runs git in scratch repos is not pointed at this one.
 */
export const GIT_LOCAL_ENV = Object.freeze([
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CONFIG',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_COUNT',
  'GIT_OBJECT_DIRECTORY',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_REPLACE_REF_BASE',
  'GIT_PREFIX',
  'GIT_SHALLOW_FILE',
  'GIT_COMMON_DIR',
]);

/** `env` without git's repository variables. */
export function gateEnv(env) {
  const out = { ...env };
  for (const key of GIT_LOCAL_ENV) delete out[key];
  return out;
}

/** pre-push's stdin: `io.input` in tests; read only when it is not a terminal. */
function pushInput(ctx) {
  if (ctx.input !== undefined) return ctx.input;
  if (process.stdin.isTTY) return '';
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** `<local ref> <local sha> <remote ref> <remote sha>` per line; malformed lines dropped. */
export function parsePushLines(text) {
  return text
    .split('\n')
    .map((l) => l.trim().split(/\s+/))
    .filter((f) => f.length === 4)
    .map(([localRef, localSha, remoteRef, remoteSha]) => ({ localRef, localSha, remoteRef, remoteSha }));
}

const isZero = (sha) => /^0+$/.test(sha);
const shortRef = (ref) => ref.replace(/^refs\/heads\//, '');

/** The commit `rev` names (an annotated tag peeled to its commit), or null. */
function commitOf(root, rev, env) {
  const r = gitRun(root, ['rev-parse', '--verify', '-q', `${rev}^{commit}`], { cap: GIT_CAP_MS, env });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** Uncommitted files (untracked included) outside the bundle state, which the runner writes. */
function uncommitted(repo, env) {
  const args = ['--no-optional-locks', 'status', '--porcelain', '--untracked-files=all', '--', '.'];
  const r = gitRun(repo.root, [...args, `:(exclude)${repo.config.paths.bundles}`], { cap: GIT_CAP_MS, env });
  if (r.status !== 0) throw new Error(messages.probeFailed('git status', r.stderr.trim().split('\n')[0]));
  return r.stdout.split('\n').filter(Boolean).length;
}

/**
 * pre-push's preparation: `{ skip }` when there is nothing to judge (nothing pushed,
 * only deletions, no pushed ref at HEAD, a dirty tree), else `{ label }` naming the
 * refs tested and those not when only some are HEAD, else `{}`.
 */
export function pushContext(repo, ctx) {
  const lines = parsePushLines(pushInput(ctx));
  if (!lines.length) return { skip: m.push.nothing };
  const pushed = lines.filter((l) => !isZero(l.localSha));
  if (!pushed.length) return { skip: m.push.deletions };
  const head = commitOf(repo.root, 'HEAD', ctx.env);
  const atHead = (l) => head !== null && (l.localSha === head || commitOf(repo.root, l.localSha, ctx.env) === head);
  const refs = pushed.map((l) => ({ ref: shortRef(l.localRef), head: atHead(l) }));
  const tested = refs.filter((r) => r.head).map((r) => r.ref);
  const others = refs.filter((r) => !r.head).map((r) => r.ref);
  if (!tested.length) return { skip: m.push.notHead(others) };
  const dirty = uncommitted(repo, ctx.env);
  if (dirty) return { skip: m.push.dirty(dirty, head.slice(0, 8)) };
  return others.length ? { label: m.push.tested(tested, others) } : {};
}

const seconds = (results) => (results.reduce((sum, r) => sum + r.ms, 0) / 1000).toFixed(1);
const withSkipped = (note, skipped) => (skipped.length ? `${note}; ${m.gate.alsoSkipped(skipped)}` : note);

/**
 * `gate`: the configured `gate.checks`, as the bundle gate runs them, with the
 * elapsed time on every line where a check ran. A failing check's tail is printed
 * above the line. Planned first, so a gate with nothing to run names why.
 */
export function checkGate(repo, ctx) {
  const { hasTool } = ctx.probes;
  const planned = planChecks({ checks: repo.config.gate.checks, hasTool });
  if (!planned.length) return skip(m.gate.none);
  if (planned.every((c) => c.skip)) return skip(m.gate.allSkipped(planned.map((c) => m.gate.skippedItem(c.name, c.skip))));
  const out = runGate({ repo, log: console.log, hasTool, env: gateEnv(ctx.env) });
  if (out.refused) return skip(out.refused.split('\n').join('; '));
  const names = (result) => out.results.filter((r) => r.result === result).map((r) => r.name);
  for (const r of out.results.filter((x) => x.result === 'fail')) console.log(m.gate.tail(r.name, r.tail));
  const secs = seconds(out.results);
  const failed = names('fail');
  if (failed.length) return fail(withSkipped(m.gate.ran(failed, secs), names('skipped')));
  return pass(withSkipped(m.gate.ran(names('pass'), secs), names('skipped')));
}

/** `changelog`: the generated file against the release tags, judged on the checked-out tree. */
export function checkChangelog(repo) {
  const file = repo.config.paths.changelog;
  const { state, tags } = changelogState(repo);
  if (state === 'current') return pass(m.changelog.current(file, tags));
  if (state === 'stale') return fail(m.changelog.stale(file));
  return skip(m.changelog[state](file));
}
