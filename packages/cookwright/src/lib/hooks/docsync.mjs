// src/lib/hooks/docsync.mjs — the pre-commit `doc-sync` check: each rule of
// `hooks.docSync` whose code is staged needs one of its docs staged too (plan §4.1).
//
// Matching is git's own pathspec machinery through `git diff --cached` only, never
// `ls-files`, which drops the whole result on a leading-star exclude (measured).
// `--no-renames` so a rename out of a watched path counts as its deletion;
// `--diff-filter=ACMRD` so a deleted code file counts. git's environment is kept, so
// a partial commit's GIT_INDEX_FILE is the index judged. Every rule is evaluated
// before the verdict, so one commit shows every miss.

import { gitRun } from '../doctor/repo.mjs';
import { messages } from '../messages.mjs';
import { fail, pass, skip } from '../verdict.mjs';

const m = messages.hook.docSync;
export const GIT_CAP_MS = 60_000;

/** The staged paths matching `specs`; a git failure throws, naming the rule. */
export function stagedMatching(root, specs, { env, rule }) {
  const args = ['diff', '--cached', '--name-only', '-z', '--no-renames', '--diff-filter=ACMRD', '--', ...specs];
  const r = gitRun(root, args, { cap: GIT_CAP_MS, env });
  if (r.status !== 0) {
    throw new Error(m.gitFailed(rule, r.stderr.trim().split('\n')[0] || `exit ${r.status}`));
  }
  return r.stdout.split('\0').filter(Boolean);
}

/** One `unmet` part per rule whose code is staged and none of whose docs is. */
export function unmetRules(root, rules, env) {
  const parts = [];
  for (const rule of rules) {
    const code = stagedMatching(root, rule.code, { env, rule: rule.name });
    if (!code.length) continue;
    if (stagedMatching(root, rule.docs, { env, rule: rule.name }).length) continue;
    parts.push(m.unmet(rule.name, code, rule.docs));
  }
  return parts;
}

export function checkDocSync(repo, { env }) {
  const rules = repo.config.hooks.docSync;
  if (!rules.length) return skip(m.none);
  const parts = unmetRules(repo.root, rules, env);
  return parts.length ? fail(m.failed(parts)) : pass(m.ok(rules.length));
}
