// scripts/lib/bundle/check.mjs — the landing check: machine-written inputs only,
// never prose a model wrote.
//
// Two scopes:
//   * REPO-WIDE, safe on every push (CI runs `check --ci`, which is this scope only):
//     CLAUDE.md's schema claims agree with the deploy log's Ledger.
//   * PER BUNDLE, local, before the merge: gates, slices, phases, the atlas tripwire,
//     CI on HEAD. A bundle branch fails these until its end BY DESIGN, which is why CI
//     does not run them — a tick that is red by design teaches everyone to ignore red.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  changedFiles,
  dirtyPaths,
  head,
  isAncestor,
  lastCodeCommit,
  lastCommitTouching,
  mergeBase,
} from './git.mjs';
import { KNOWN_FLAKES } from './gate.mjs';
import { schemaDisagreements } from './ledger.mjs';
import { blockingOpen, closeoutPath } from './phases.mjs';
import { sha256File } from './state.mjs';

export const PASS = 'PASS';
export const FAIL = 'FAIL';
export const WARN = 'WARN';

const ok = (note) => ({ status: PASS, note });
const bad = (note) => ({ status: FAIL, note });
const warn = (note) => ({ status: WARN, note });

export function repoChecks(root) {
  const ledger = fs.readFileSync(path.join(root, 'docs/deploy-log.md'), 'utf8');
  const claude = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
  const problems = schemaDisagreements(ledger, claude);
  return [
    [
      'repo.schema-claims',
      problems.length
        ? bad(`${problems.join('; ')} (documentary check; ops-status.sh is the authority)`)
        : ok('CLAUDE.md schema claims match the deploy log'),
    ],
  ];
}

/**
 * The pre-commit hook's Rule 5 matcher, read from the hook itself so there is one
 * copy of the path list. Returns { surface: RegExp, exclude: RegExp }.
 */
export function hookUiRegex(root) {
  const hook = fs.readFileSync(path.join(root, '.husky/pre-commit'), 'utf8');
  const grab = (name) => {
    const m = hook.match(new RegExp(`^${name}='([^']+)'`, 'm'));
    if (!m) throw new Error(`.husky/pre-commit has no ${name}= line`);
    return new RegExp(m[1]);
  };
  return { surface: grab('UI_SURFACE_RE'), exclude: grab('UI_SURFACE_EXCLUDE') };
}

/** Rule 5 over the whole branch: UI surface changed ⇒ some screenshots delta. */
export function atlasTripwire(files, { surface, exclude }) {
  const ui = files.filter((f) => surface.test(f) && !exclude.test(f));
  if (ui.length === 0) return ok('no captured UI surface changed');
  const shots = files.filter((f) => f.startsWith('docs/screenshots/'));
  if (shots.length === 0) return bad(`${ui.length} UI file(s) changed, no docs/screenshots/ delta`);
  return ok(
    `${ui.length} UI file(s), ${shots.length} screenshot file(s) — a tripwire, not coverage: ` +
      'review the atlas diff',
  );
}

/**
 * Gate verdicts over the state.
 *   ctx.lastCode      — the newest code commit on the branch
 *   ctx.lastSupabase  — the newest commit touching supabase/, or null
 *   ctx.isAncestor    — (a, b) => a is b or an ancestor of b
 * Three rules: the latest gate passed on a commit containing the last code commit;
 * each slice passed a gate on EXACTLY the commit its fix phase ended on (with --sql
 * on a schema slice);
 * and the last change under supabase/ — wherever it landed — is covered by a passing
 * --sql gate at or after it, since the SQL suites run nowhere else.
 */
export function gateChecks(state, ctx) {
  const out = [];
  const passed = state.gates.filter((g) => g.passed);
  const latest = state.gates.at(-1);
  const row = (name, verdict) => out.push([name, verdict]);
  if (!latest) row('bundle.gate-latest', bad('no gate recorded'));
  else if (!latest.passed)
    row('bundle.gate-latest', bad(`latest gate failed at ${short(latest.commit)}`));
  // Ancestry, not equality: the playbook commits each phase's state before it gates, so
  // the latest gate sits on a docs-only commit after the last code. A gate whose commit
  // CONTAINS lastCode covers every line of code, since nothing after lastCode is code.
  else if (!ctx.isAncestor(ctx.lastCode, latest.commit)) {
    row(
      'bundle.gate-latest',
      bad(`latest gate is on ${short(latest.commit)}, last code commit is ${short(ctx.lastCode)}`),
    );
  } else if (latest.commit === ctx.lastCode) {
    row('bundle.gate-latest', ok(`passed on ${short(latest.commit)}`));
  } else {
    row(
      'bundle.gate-latest',
      ok(`passed on ${short(latest.commit)}, which contains the last code ${short(ctx.lastCode)}`),
    );
  }

  for (const slice of state.slices) {
    const name = `bundle.gate-slice:${slice.id}`;
    const fix = state.phases.find((p) => p.name === `fix:${slice.id}`);
    const end = fix?.endCommit;
    const code = fix?.endCode ?? end;
    // A gate taken on the slice's final code: it contains the slice's last code
    // commit and is contained in the commit the fix phase ended on.
    const atEnd = passed.filter(
      (g) =>
        ctx.isAncestor(code, g.commit) && ctx.isAncestor(g.commit, end) && (!slice.sql || g.sql),
    );
    if (!end) row(name, bad(`fix:${slice.id} has not finished`));
    else if (atEnd.length === 0) {
      row(name, bad(`no passing ${slice.sql ? '--sql ' : ''}gate on the slice end ${short(end)}`));
    } else row(name, ok(`passed on the slice end ${short(end)}`));
  }

  // Every retry names an allowlisted flake: an unaudited re-gate is a red gate
  // someone re-rolled until it went green.
  const unaudited = state.gates.filter((g) => g.retryOf !== undefined && !KNOWN_FLAKES[g.flake]);
  row(
    'bundle.gate-retries',
    unaudited.length
      ? bad(`${unaudited.length} retry gate(s) name no allowlisted flake`)
      : ok(`${state.gates.filter((g) => g.retryOf !== undefined).length} audited retry(ies)`),
  );

  if (!ctx.lastSupabase) row('bundle.gate-sql', ok('no supabase/ change on the branch'));
  else {
    const covered = passed.some((g) => g.sql && ctx.isAncestor(ctx.lastSupabase, g.commit));
    row(
      'bundle.gate-sql',
      covered
        ? ok(`the last supabase/ change ${short(ctx.lastSupabase)} is covered by a --sql gate`)
        : bad(
            `no passing --sql gate at or after the last supabase/ change ${short(ctx.lastSupabase)}`,
          ),
    );
  }
  return out;
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
 * The CI workflow's newest run for HEAD, through the read-only gh token. Only
 * `ci.yml` counts (a manual SQL-suites run is not CI), only its newest attempt
 * counts (a green rerun supersedes a red one), and anything but a completed success
 * FAILS — unpushed, pending, and gh-unavailable included: the landing check claims
 * "CI green", so it cannot pass on not knowing.
 */
export function ciCheck(sha, { exec = spawnSync, cwd } = {}) {
  const r = exec(
    'gh',
    [
      'run',
      'list',
      '--commit',
      sha,
      '--workflow',
      'ci.yml',
      '--json',
      'status,conclusion,createdAt',
      '--limit',
      '10',
    ],
    { cwd, encoding: 'utf8', timeout: 30_000 },
  );
  if (r.status !== 0) return bad('gh could not list CI runs — cannot claim CI green');
  const runs = JSON.parse(r.stdout || '[]').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const newest = runs[0];
  if (!newest) return bad(`no CI run for ${short(sha)} — push the branch first`);
  if (newest.status !== 'completed') return bad(`CI still ${newest.status} on ${short(sha)}`);
  if (newest.conclusion !== 'success') return bad(`CI ${newest.conclusion} on ${short(sha)}`);
  return ok('CI green on HEAD (the SQL suites are not in CI — see bundle.gate-sql)');
}

/**
 * The closeout was verified AS IT IS NOW: the latest closeout findings record carries
 * the sha of the closeout text it judged, which must equal the file's current sha,
 * and nothing it found may be open unless the phase was closed with --accept-open.
 */
export function closeoutCheck(root, state) {
  const file = path.join(root, closeoutPath(state.slug));
  if (!fs.existsSync(file)) return bad(`${closeoutPath(state.slug)} does not exist`);
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

export function bundleChecks(root, state) {
  const tip = head(root);
  // The LIVE merge-base: `state.base` goes stale when main moves and the branch is
  // rebased, and a range from it would count main's own commits as this bundle's.
  const base = mergeBase('main', tip, root);
  const lastCode = lastCodeCommit(base, tip, root);
  const lastSupabase = lastCommitTouching(base, tip, ['supabase/'], root);
  const files = changedFiles(base, tip, root);
  const baseRow =
    base === state.base
      ? ok(`merge-base ${short(base)}`)
      : warn(
          `merge-base moved ${short(state.base)} → ${short(base)} (rebased); ranges use the live one`,
        );
  // Clean — docs/bundles/ included: every byte this check reads must be the byte
  // that merges. An uncommitted state or closeout could pass here and not ship.
  const dirty = dirtyPaths(root);
  const ancestry = (a, b) => isAncestor(a, b, root);
  return [
    [
      'bundle.clean',
      dirty.length ? bad(`uncommitted: ${dirty.slice(0, 5).join(', ')}`) : ok('tree clean'),
    ],
    ['bundle.base', baseRow],
    ...gateChecks(state, { lastCode, lastSupabase, isAncestor: ancestry }),
    ['bundle.qa-reviewed', qaReviewedCheck(state, { lastCode, isAncestor: ancestry })],
    ...phaseChecks(state),
    ['bundle.closeout-verified', closeoutCheck(root, state)],
    ['bundle.atlas-tripwire', atlasTripwire(files, hookUiRegex(root))],
    ['bundle.ci', ciCheck(tip, { cwd: root })],
  ];
}

const short = (sha) => (sha ? sha.slice(0, 8) : '—');
