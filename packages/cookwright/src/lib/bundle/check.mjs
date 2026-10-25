// src/lib/bundle/check.mjs — the landing check: machine-written inputs only,
// never prose a model wrote.
//
// Two scopes:
//   * REPO-WIDE, safe on every push (CI runs `check --ci`, which is this scope only).
//     Stage 0 configures none; the hook is kept so a stack pack can add its own.
//   * PER BUNDLE, local, before the merge: gates, slices, phases, the closeout, CI on
//     HEAD. A bundle branch fails these until its end BY DESIGN, which is why CI does
//     not run them — a tick that is red by design teaches everyone to ignore red.
//
// The four verdicts and the summary counts are shared with doctor (../verdict.mjs);
// re-exported here so the runner and its tests keep importing them from this file.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { FAIL, PASS, SKIP, WARN, fail, pass, skip, summarize, warn } from '../verdict.mjs';
import { dirtyPaths, head, isAncestor, lastCodeCommit, mergeBase } from './git.mjs';
import { onPath, partialChecks, skippedNames } from './gate.mjs';
import { messages } from './messages.mjs';
import { blockingOpen, closeoutPath } from './phases.mjs';
import { sha256File } from './state.mjs';

export { FAIL, PASS, SKIP, WARN, summarize };

const ok = pass;
const bad = fail;

/** Repo-wide checks: none in this version. */
export function repoChecks() {
  return [['repo', skip(messages.noRepoChecks)]];
}

/**
 * Gate verdicts over the state.
 *   ctx.lastCode    — the newest code commit on the branch
 *   ctx.isAncestor  — (a, b) => a is b or an ancestor of b
 *   flakes          — the configured retry allowlist
 * Two rules: the latest gate passed on a commit containing the last code commit, and
 * each slice passed a gate on EXACTLY the commit its fix phase ended on. Plus the
 * audit: every retry names an allowlisted flake.
 */
export function gateChecks(state, ctx, { flakes = {} } = {}) {
  const out = [];
  const passed = state.gates.filter((g) => g.passed);
  const row = (name, verdict) => out.push([name, verdict]);
  row('bundle.gate-latest', latestGateCheck(state, ctx));

  for (const slice of state.slices) {
    const name = `bundle.gate-slice:${slice.id}`;
    const fix = state.phases.find((p) => p.name === `fix:${slice.id}`);
    const end = fix?.endCommit;
    const code = fix?.endCode ?? end;
    // A gate taken on the slice's final code: it contains the slice's last code
    // commit and is contained in the commit the fix phase ended on.
    const atEnd = passed.filter(
      (g) => ctx.isAncestor(code, g.commit) && ctx.isAncestor(g.commit, end),
    );
    if (!end) row(name, bad(`fix:${slice.id} has not finished`));
    else if (atEnd.length === 0) row(name, bad(`no passing gate on the slice end ${short(end)}`));
    else row(name, ok(`passed on the slice end ${short(end)}`));
  }

  // Every retry names an allowlisted flake: an unaudited re-gate is a red gate
  // someone re-rolled until it went green.
  const retries = state.gates.filter((g) => g.retryOf !== undefined);
  const unaudited = retries.filter((g) => !flakes[g.flake]);
  row(
    'bundle.gate-retries',
    unaudited.length
      ? bad(`${unaudited.length} retry gate(s) name no allowlisted flake`)
      : ok(`${retries.length} audited retry(ies)`),
  );
  return out;
}

function latestGateCheck(state, ctx) {
  const latest = state.gates.at(-1);
  if (!latest) return bad('no gate recorded');
  if (!latest.passed) return bad(`latest gate failed at ${short(latest.commit)}`);
  // Ancestry, not equality: the playbook commits each phase's state before it gates, so
  // the latest gate sits on a state-home commit after the last code. A gate whose commit
  // CONTAINS lastCode covers every line of code, since nothing after lastCode is code.
  if (!ctx.isAncestor(ctx.lastCode, latest.commit)) {
    return bad(
      `latest gate is on ${short(latest.commit)}, last code commit is ${short(ctx.lastCode)}`,
    );
  }
  const where =
    latest.commit === ctx.lastCode
      ? `passed on ${short(latest.commit)}`
      : `passed on ${short(latest.commit)}, which contains the last code ${short(ctx.lastCode)}`;
  // A pass with skipped checks, or with a check whose note names a part it did not
  // measure (disposition 45), is a pass with holes: say which, as a WARN.
  const skipped = skippedNames(latest.checks ?? []);
  const partly = partialChecks(latest.checks ?? []);
  const holes = [...(skipped.length ? [`skipped: ${skipped.join(', ')}`] : []), ...(partly.length ? [messages.partly(partly)] : [])];
  return holes.length ? warn(`${where}; ${holes.join('; ')}`) : ok(where);
}

export function phaseChecks(state) {
  const open = state.phases.filter((p) => p.status !== 'done').map((p) => p.name);
  return [
    [
      'bundle.phases',
      open.length ? bad(`not done: ${open.join(', ')}`) : ok(`${state.phases.length} phases done`),
    ],
  ];
}

/**
 * The CI workflow's newest run for HEAD, through `gh`. Only the configured workflow
 * counts, only its newest attempt counts (a green rerun supersedes a red one), and
 * anything but a completed success FAILS — unpushed and pending included: the check
 * claims "CI green", so it cannot pass on not knowing. With no `ci` configured the
 * row is SKIP; with `gh` missing it is WARN, a pass with a hole the summary names.
 */
export function ciCheck(sha, { workflow, exec = spawnSync, hasGh = () => onPath('gh'), cwd } = {}) {
  if (!workflow) return skip(messages.noCi);
  if (!hasGh()) return warn(messages.noGh);
  const r = exec(
    'gh',
    ['run', 'list', '--commit', sha, '--workflow', workflow, '--json', 'status,conclusion,createdAt', '--limit', '10'],
    { cwd, encoding: 'utf8', timeout: 30_000 },
  );
  if (r.status !== 0) return bad('gh could not list CI runs — cannot claim CI green');
  const runs = JSON.parse(r.stdout || '[]').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const newest = runs[0];
  if (!newest) return bad(`no CI run for ${short(sha)} — push the branch first`);
  if (newest.status !== 'completed') return bad(`CI still ${newest.status} on ${short(sha)}`);
  if (newest.conclusion !== 'success') return bad(`CI ${newest.conclusion} on ${short(sha)}`);
  return ok(`${workflow} green on HEAD`);
}

/**
 * The closeout was verified AS IT IS NOW: the latest closeout findings record carries
 * the sha of the closeout text it judged, which must equal the file's current sha,
 * and nothing it found may be open unless the phase was closed with --accept-open.
 */
export function closeoutCheck(repo, state) {
  const rel = closeoutPath(repo, state.slug);
  const file = path.join(repo.root, rel);
  if (!fs.existsSync(file)) return bad(`${rel} does not exist`);
  const latest = state.findings.filter((f) => f.phase === 'closeout').at(-1);
  if (!latest) return bad('the closeout was never verified (no closeout findings recorded)');
  if (latest.closeoutSha !== sha256File(file)) {
    return bad('the closeout changed after its last verify run — rerun the closeout phase');
  }
  const open = blockingOpen(latest);
  if (open === 0) return ok('verified, nothing open');
  const accepted = state.decisions.some((d) => d.source === 'phase done closeout --accept-open');
  return accepted
    ? warn(`${open} finding(s) accepted open by a recorded decision`)
    : bad(`${open} closeout finding(s) still open`);
}

/**
 * Code committed after the whole-branch fix (QA rounds) was reviewed: the latest
 * `qa` findings record was taken at a HEAD that contains the last code commit, and
 * leaves nothing blocking open (or the qa phase was closed with --accept-open).
 */
export function qaReviewedCheck(state, { lastCode, isAncestor: contains }) {
  const wholeEnd = state.phases.find((p) => p.name === 'fix:whole')?.endCommit;
  if (!wholeEnd) return bad('fix:whole has not finished');
  if (contains(lastCode, wholeEnd)) return ok('no code after the whole-branch fix');
  const latest = state.findings.filter((f) => f.phase === 'qa').at(-1);
  if (!latest?.head || !contains(lastCode, latest.head)) {
    return bad(`code after the whole-branch fix (last ${short(lastCode)}) was never reviewed`);
  }
  const open = blockingOpen(latest);
  const accepted = state.decisions.some((d) => d.source === 'phase done qa --accept-open');
  if (open && !accepted) return bad(`${open} QA-round finding(s) still open`);
  return ok(`QA-round code reviewed at ${short(latest.head)}`);
}

export function bundleChecks(repo, state) {
  const { root, config } = repo;
  const tip = head(root);
  // The LIVE merge-base: `state.base` goes stale when the base branch moves and the
  // branch is rebased, and a range from it would count the base's own commits as
  // this bundle's.
  const base = mergeBase(config.baseBranch, tip, root);
  const lastCode = lastCodeCommit(base, tip, repo);
  const baseRow =
    base === state.base
      ? ok(`merge-base ${short(base)}`)
      : warn(
          `merge-base moved ${short(state.base)} → ${short(base)} (rebased); ranges use the live one`,
        );
  // Clean — the bundle dir included: every byte this check reads must be the byte
  // that merges. An uncommitted state or closeout could pass here and not ship.
  const dirty = dirtyPaths(root);
  const ancestry = (a, b) => isAncestor(a, b, root);
  return [
    [
      'bundle.clean',
      dirty.length ? bad(`uncommitted: ${dirty.slice(0, 5).join(', ')}`) : ok('tree clean'),
    ],
    ['bundle.base', baseRow],
    ...gateChecks(state, { lastCode, isAncestor: ancestry }, { flakes: config.gate.flakes }),
    ['bundle.qa-reviewed', qaReviewedCheck(state, { lastCode, isAncestor: ancestry })],
    ...phaseChecks(state),
    ['bundle.closeout-verified', closeoutCheck(repo, state)],
    ['bundle.ci', ciCheck(tip, { workflow: config.ci?.workflow, cwd: root })],
  ];
}

const short = (sha) => (sha ? sha.slice(0, 8) : '—');
