// src/lib/packs/base.mjs — the commit a branch measure compares HEAD with: the
// ratchet's base and the types measure's change condition (stage-4 plan §4.5,
// dispositions 20 and 39).
//
// In order: `--base <ref>`; COOKWRIGHT_PUSH_BASE, which the pre-push hook sets to
// the remote's commit of the pushed ref; when HEAD is on the base branch, its
// upstream; otherwise the merge-base of the base branch and HEAD. Each candidate
// must name a commit that is here (`rev-parse --verify`), else the next is tried, so
// a shallow clone or a remote sha never fetched falls through. On the base branch
// the merge-base is HEAD itself, which would compare HEAD with HEAD, so it is not a
// candidate there: a solo developer on main with no upstream gets no base, and the
// measure says what it tried.

import { runBounded } from '../budget.mjs';
import { messages } from '../messages.mjs';

const m = messages.standards.base;

/** The variable the pre-push hook passes the remote's commit in. */
export const PUSH_BASE_ENV = 'COOKWRIGHT_PUSH_BASE';
const CAP_MS = 60_000;

/** git's trimmed stdout at `top`, or null on a non-zero exit. */
function gitOut(top, args, env) {
  const r = runBounded('git', args, { cwd: top, encoding: 'utf8', ...(env ? { env } : {}) }, CAP_MS);
  return r.status === 0 ? r.stdout.trim() : null;
}

/** The commit `ref` names here, or null; a ref that reads as an option names none. */
const commitOf = (top, ref, env) =>
  String(ref).startsWith('-') ? null : gitOut(top, ['rev-parse', '--verify', '-q', `${ref}^{commit}`], env);

/** The candidates in disposition 20's order, each `{ label, sha: () => sha | null }`. */
function candidates(top, { flag, env, baseBranch }) {
  const out = [];
  if (flag) out.push({ label: m.flag(flag), sha: () => commitOf(top, flag, env) });
  const pushed = env?.[PUSH_BASE_ENV];
  if (pushed) out.push({ label: PUSH_BASE_ENV, sha: () => commitOf(top, pushed, env) });
  const branch = gitOut(top, ['symbolic-ref', '-q', '--short', 'HEAD'], env);
  if (branch === baseBranch) {
    out.push({ label: m.upstream(baseBranch), sha: () => commitOf(top, `${baseBranch}@{upstream}`, env) });
  } else {
    const mergeBase = () => (commitOf(top, baseBranch, env) ? gitOut(top, ['merge-base', baseBranch, 'HEAD'], env) : null);
    out.push({ label: m.mergeBase(baseBranch), sha: mergeBase });
  }
  return out;
}

/**
 * The base, as `{ sha, label }` (`label` names the candidate that resolved), or
 * `{ tried }` with every candidate's label when none did. `env` is git's
 * environment and the source of COOKWRIGHT_PUSH_BASE.
 */
export function resolveBase(top, { flag, env, baseBranch }) {
  const tried = [];
  for (const candidate of candidates(top, { flag, env, baseBranch })) {
    const sha = candidate.sha();
    if (sha) return { sha, label: candidate.label };
    tried.push(candidate.label);
  }
  return { tried };
}
