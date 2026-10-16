// src/lib/doctor/basics.mjs — the `config` and `git` checks.

import { CONFIG_VERSION } from '../config.mjs';
import { fail, pass, warn } from '../verdict.mjs';
import { messages } from '../messages.mjs';
import { gitRun } from './repo.mjs';

const m = messages.doctor;

/**
 * The config loaded: PASS with its level; WARN when it loaded only by migrating an
 * older version in memory (weak, never drift: every check still runs); else the
 * loader's message, verbatim.
 */
export function checkConfig(repo) {
  if (!repo.config) return fail(repo.configError);
  const from = repo.config.migratedFrom;
  return from === undefined ? pass(m.config.ok(repo.config.level)) : warn(m.config.migrated(from, CONFIG_VERSION));
}

/**
 * A work tree whose baseBranch resolves; or an unborn HEAD that IS baseBranch (a
 * fresh `git init`). Without a config only the work tree can be judged.
 */
export function checkGit(repo) {
  if (!repo.workTree) return fail(m.git.notWorkTree);
  if (!repo.config) return pass(m.git.configInvalid);
  const base = repo.config.baseBranch;
  const resolves = gitRun(repo.root, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
  if (resolves.status === 0) return pass(m.git.ok(base));
  const born = gitRun(repo.root, ['rev-parse', '--verify', '--quiet', 'HEAD']).status === 0;
  const branch = gitRun(repo.root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (!born && branch.status === 0 && branch.stdout.trim() === base) return pass(m.git.unborn(base));
  return warn(m.git.noBase(base));
}
