// src/lib/hooks/registry.mjs — every hook check, by name, and which hook runs which
// (plan §4.1).
//
// A check is `(repo, ctx) → { status, note }` with the shared verdicts, no WARN in
// a hook. `config: true` means it needs cookwright.json: without a valid one it is
// one SKIP naming the loader's message, while `secrets` still runs. Every check runs
// even after a FAIL, so one commit shows every red at once. Anything wrong with the
// harness inside a check (a throw, a timeout) is that check's SKIP line and never
// touches another check's verdict. A FAIL's detail is printed by the check, above
// its line.

import { TimedOut } from '../budget.mjs';
import { CONFIG_FILE } from '../config.mjs';
import { messages } from '../messages.mjs';
import { FAIL, PASS, skip } from '../verdict.mjs';
import { checkDocSync } from './docsync.mjs';
import { checkChangelog, checkGate, pushContext } from './push.mjs';
import { checkSecrets } from './secrets.mjs';

const m = messages.hook;

export const CHECKS = Object.freeze({
  secrets: { run: checkSecrets },
  'doc-sync': { run: checkDocSync, config: true },
  gate: { run: checkGate, config: true },
  changelog: { run: checkChangelog, config: true },
});

/** Each hook's checks, in order; `prepare` runs once before them when any will run. */
export const HOOKS = Object.freeze({
  'pre-commit': { checks: ['secrets', 'doc-sync'] },
  'pre-push': { checks: ['gate', 'changelog'], prepare: pushContext },
});

export const CHECK_NAMES = Object.freeze(Object.keys(CHECKS));

const firstLine = (err) => String(err?.message ?? err).split('\n')[0];
const harness = (err) => (err instanceof TimedOut ? messages.timedOut(err.what) : firstLine(err));

/** The names in COOKWRIGHT_SKIP, comma-separated; the unknown ones reported apart. */
export function skipList(value) {
  const names = String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    skipped: new Set(names.filter((n) => CHECK_NAMES.includes(n))),
    unknown: names.filter((n) => !CHECK_NAMES.includes(n)),
  };
}

/** Why `repo` cannot run a config-dependent check. */
function configNote(repo) {
  const { configError: e } = repo;
  if (!e) return m.noConfig;
  const prefix = `${CONFIG_FILE}:`;
  return m.configInvalid(e.startsWith(prefix) ? e.slice(prefix.length).trim() : e);
}

function verdict(name, repo, ctx, prep) {
  const check = CHECKS[name];
  if (ctx.skipped.has(name)) return skip(m.skippedByEnv);
  if (check.config && !repo.config) return skip(configNote(repo));
  if (prep.skip) return skip(prep.skip);
  let r;
  try {
    r = check.run(repo, ctx);
  } catch (err) {
    return skip(m.couldNotRun(harness(err)));
  }
  const judged = r.status === PASS || r.status === FAIL;
  return judged && prep.label ? { ...r, note: `${r.note} ${prep.label}` } : r;
}

/** The hook's one-time preparation, or the reason none of its checks can run. */
function prepare(hook, repo, ctx) {
  const runnable = hook.checks.some((n) => !ctx.skipped.has(n) && (!CHECKS[n].config || repo.config));
  if (!hook.prepare || !runnable) return {};
  try {
    return hook.prepare(repo, ctx);
  } catch (err) {
    return { skip: m.couldNotRun(harness(err)) };
  }
}

/**
 * Run hook `name` over `repo`, printing each check's line as it ends (`print`);
 * returns `[check, { status, note }]` rows.
 */
export function runHook(name, repo, ctx, print = console.log) {
  const hook = HOOKS[name];
  const { skipped, unknown } = skipList(ctx.env.COOKWRIGHT_SKIP);
  if (unknown.length) print(m.unknownSkip(name, unknown, CHECK_NAMES));
  const full = { ...ctx, skipped };
  const prep = prepare(hook, repo, full);
  return hook.checks.map((check) => {
    const r = verdict(check, repo, full, prep);
    print(m.line(name, r.status, check, r.note));
    return [check, r];
  });
}
