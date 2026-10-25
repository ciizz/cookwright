// src/lib/hooks/docsync.mjs — the pre-commit `doc-sync` check: each rule of
// `hooks.docSync` whose code is staged needs one of its docs staged too (plan §4.1).
//
// Matching is git's own pathspec machinery through `git diff --cached` only, never
// `ls-files`, which drops the whole result on a leading-star exclude (measured).
// `--no-renames` so a rename out of a watched path counts as its deletion;
// `--diff-filter=ACMRD` so a deleted code file counts. git's environment is kept, so
// a partial commit's GIT_INDEX_FILE is the index judged. Every rule is evaluated
// before the verdict, so one commit shows every miss. A pack-owned rule whose pack
// rule is switched off in `packs` (`expo:design-doc` under `design-doc: false`) is
// not enforced, and the line says so: a switched-off rule is counted by no check
// (stage-4 disposition 8), though init never edits the config that still lists it.

import { gitRun } from '../doctor/repo.mjs';
import { messages } from '../messages.mjs';
import { declaredPacks } from '../packs/registry.mjs';
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

/** The pack-owned doc-sync rule names of `config`'s declared packs whose rule is switched off. */
export const switchedOffRules = (config) =>
  declaredPacks(config).flatMap((pack) =>
    pack.manifest.rules.filter((r) => r.measure === 'doc-sync' && pack.off.has(r.id)).map((r) => r.docSync.name),
  );

export function checkDocSync(repo, { env }) {
  const all = repo.config.hooks.docSync;
  if (!all.length) return skip(m.none);
  const offNames = new Set(switchedOffRules(repo.config));
  const off = all.filter((r) => offNames.has(r.name)).map((r) => r.name);
  const rules = all.filter((r) => !offNames.has(r.name));
  if (!rules.length) return skip(m.allOff(off));
  const parts = unmetRules(repo.root, rules, env);
  const tail = off.length ? [m.off(off)] : [];
  const head = parts.length ? m.failed(parts) : m.ok(rules.length);
  const note = [head, ...tail].join('; ');
  return parts.length ? fail(note) : pass(note);
}
