// src/lib/doctor/secrets.mjs — no plaintext env file is tracked, none sits at the
// root, and git ignores the two init protects.
//
// Names only: an env file is never opened, so no value can reach the readout. Tracked
// files come from the index repo-wide (cheap at any size); untracked ones from the
// root directory only (never a walk, never node_modules). The patterns are exactly
// `.env` and `.env.*`, the ones init writes to .gitignore; `.envrc` is not one.

import path from 'node:path';

import { messages } from '../messages.mjs';
import { fail, pass, skip, warn } from '../verdict.mjs';
import { gitRun } from './repo.mjs';

const m = messages.doctor;

const ENV_NAME = /^\.env(\..+)?$/;
const EXEMPT = new Set(['.env.example', '.env.sample', '.env.template']);
/** The paths init makes git ignore, each probed on its own. */
export const PROTECTED = Object.freeze(['.env', '.env.local']);

/** A plaintext env file by name: `.env` or `.env.*`, minus the example files. */
export const isEnvFile = (p) => {
  const base = path.posix.basename(p);
  return ENV_NAME.test(base) && !EXEMPT.has(base);
};

function trackedEnvFiles(root) {
  const out = gitRun(root, ['ls-files', '-z', '--', '.env', '*/.env', '.env.*', '*/.env.*']);
  if (out.status !== 0) throw new Error(messages.probeFailed('git ls-files', out.stderr.trim()));
  return out.stdout.split('\0').filter(Boolean).filter(isEnvFile);
}

export function checkSecrets(repo, probes) {
  if (!repo.workTree) return skip(m.secrets.notWorkTree);
  const tracked = trackedEnvFiles(repo.root);
  const untracked = probes
    .rootFiles(repo.root)
    .filter((n) => isEnvFile(n) && !tracked.includes(n))
    .sort();
  const notIgnored = PROTECTED.filter((p) => !probes.ignored(repo.root, p));
  const notes = [
    tracked.length && m.secrets.tracked(tracked),
    untracked.length && m.secrets.untracked(untracked),
    notIgnored.length && m.secrets.notIgnored(notIgnored),
  ].filter(Boolean);
  if (tracked.length) return fail(notes.join('; '));
  return notes.length ? warn(notes.join('; ')) : pass(m.secrets.ok);
}
