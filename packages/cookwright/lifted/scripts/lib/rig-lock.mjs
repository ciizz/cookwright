// scripts/lib/rig-lock.mjs — one machine-wide lock on the local Supabase stack.
//
// WHAT: a lockfile taken by the two consumers that destroy each other's work on the
//   shared local stack — `run-sql-tests.mjs` (its reset wipes the atlas world; its
//   suites write fixture rows into it) and `atlas-capture.mjs` (its reset and seed
//   wipe the suites' virgin database; its flips mutate rows mid-suite). Not a general
//   wrapper: nothing else takes it.
//
// WHY: the orchestrated bundles run a gate, an atlas capture and review sessions on
//   one machine; the only thing that stopped an SQL reset landing mid-capture was the
//   orchestrator remembering not to (bundle workflow v1, the operating model §7.5).
//
// WHERE: `$(git rev-parse --git-common-dir)/leeka-rig.lock` — inside git's own
//   directory, so no `.gitignore` line (which would move the EAS fingerprint), and the
//   COMMON dir, so a linked worktree (where `.git` is a file) contends for the same
//   lock as the main checkout: the resource is one Docker stack, not one checkout.
//   Callers pass their repo root, so the lock never depends on the caller's cwd.
//
// ATOMICITY: the lock body is written to a private temp file and hard-LINKED into
//   place. link(2) fails with EEXIST if the name exists and never exposes a
//   half-written file, so a contender can never read an empty lock and mistake it for
//   a corrupt, stale one. Reaping a stale lock is serialized by a second link-created
//   file (`.reap`), and the reaper re-reads the lock under it: two contenders can
//   never both delete, and neither can delete a lock that became live meanwhile.
//
// NESTING: a parent that holds the lock (`bundle gate --sql`) hands its child the
//   lock's random nonce in LEEKA_RIG_LOCK_TOKEN. The child proceeds only when that
//   nonce equals the one in the file; a holder NAME proves nothing.
//
// STALE: the holder's PID is dead; or alive but not a node process; or a process that
//   STARTED after the lock was taken (the PID was reused). Corrupt content counts as
//   stale only once the file is older than a few seconds.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const LOCK_NAME = 'leeka-rig.lock';
export const TOKEN_ENV = 'LEEKA_RIG_LOCK_TOKEN';
const REAP_STALE_MS = 30_000;
const CORRUPT_GRACE_MS = 5_000;

export class RigLockBusyError extends Error {}

/** The lock's path, in the git common dir of the checkout at `root`. */
export function lockPath(root) {
  const r = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`rig-lock: ${root} is not inside a git checkout`);
  return path.join(path.resolve(root, r.stdout.trim()), LOCK_NAME);
}

/** The lock's content, `null` when absent, `{ corrupt: true, mtimeMs }` when unreadable. */
export function readLock(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    let mtimeMs = Date.now();
    try {
      mtimeMs = fs.statSync(file).mtimeMs;
    } catch {
      /* vanished meanwhile */
    }
    return { corrupt: true, mtimeMs };
  }
}

/** { state: 'node' | 'other' | 'dead', startedAt: ms | null } for a PID. */
export function probePid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return { state: 'dead', startedAt: null };
  try {
    process.kill(pid, 0);
  } catch (err) {
    if (err.code !== 'EPERM') return { state: 'dead', startedAt: null };
  }
  // LC_ALL=C: `ps` prints lstart in the user's locale ("mar. 29 sept. …" here), and
  // the fixed-width parse below would silently turn the PID-reuse check off.
  const r = spawnSync('ps', ['-p', String(pid), '-o', 'lstart=,comm='], {
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C' },
  });
  if (r.status !== 0 || !r.stdout.trim()) return { state: 'dead', startedAt: null };
  // lstart is fixed-width: "Tue Sep 29 17:40:42 2026", then the command.
  const line = r.stdout.trim();
  const startedAt = Date.parse(line.slice(0, 24));
  return {
    state: /node/i.test(line.slice(24)) ? 'node' : 'other',
    startedAt: Number.isFinite(startedAt) ? startedAt : null,
  };
}

/** True when the recorded holder can no longer be holding the lock. */
export function isStale(lock, { probe = probePid, now = Date.now() } = {}) {
  if (!lock) return true;
  if (lock.corrupt) return now - lock.mtimeMs > CORRUPT_GRACE_MS;
  const p = probe(lock.pid);
  if (p.state !== 'node') return true;
  // lstart has one-second resolution; a process started more than 2 s after the lock
  // was written cannot be the process that wrote it.
  const since = Date.parse(lock.since);
  return p.startedAt !== null && Number.isFinite(since) && p.startedAt > since + 2_000;
}

/** Create `file` with `body` atomically; false if it already exists. */
function linkCreate(file, body) {
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, body, { mode: 0o600 });
  try {
    fs.linkSync(tmp, file);
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/**
 * Remove `file` iff it still holds exactly the stale content `seen`, under the reap
 * lock. Returns true when the lock is gone (reaped by us or by someone else).
 */
function reap(file, seen, opts) {
  const reapFile = `${file}.reap`;
  if (!linkCreate(reapFile, `${process.pid}\n`)) {
    const age = Date.now() - (fs.statSync(reapFile, { throwIfNoEntry: false })?.mtimeMs ?? 0);
    if (age > REAP_STALE_MS) fs.rmSync(reapFile, { force: true });
    return false;
  }
  try {
    const now = readLock(file);
    if (!now) return true;
    const same = now.corrupt ? seen?.corrupt : now.nonce === seen?.nonce;
    if (!same || !isStale(now, opts)) return false;
    fs.rmSync(file, { force: true });
    return true;
  } finally {
    fs.rmSync(reapFile, { force: true });
  }
}

/**
 * Take the lock or throw RigLockBusyError naming the holder. Returns
 * `{ file, nonce, nested, release }`; `release` removes the file only while it
 * still carries this holder's nonce, and is safe to call more than once.
 */
export function acquire(holder, opts = {}) {
  const {
    file,
    env = process.env,
    probe = probePid,
    pid = process.pid,
    now = () => new Date().toISOString(),
    warn = (msg) => console.warn(msg),
  } = opts;
  if (!file) throw new Error('rig-lock: acquire() needs { file: lockPath(repoRoot) }');

  const token = env[TOKEN_ENV];
  if (token) return adoptParentLock(file, token);

  const nonce = randomBytes(16).toString('hex');
  const body = JSON.stringify({ pid, holder, nonce, since: now() }) + '\n';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (linkCreate(file, body))
      return { file, nonce, nested: false, release: releaser(file, nonce) };
    const existing = readLock(file);
    if (!isStale(existing, { probe })) throw busyError(existing);
    if (reap(file, existing, { probe }))
      warn(`⚠ rig lock: took over a stale lock (${describe(existing)})`);
  }
  throw busyError(readLock(file));
}

function adoptParentLock(file, token) {
  const existing = readLock(file);
  if (!existing || existing.nonce !== token) {
    throw new RigLockBusyError(
      `rig lock: ${TOKEN_ENV} is set but does not match the lock at ${file} — refusing to run unlocked.`,
    );
  }
  return { file, nonce: token, nested: true, release: () => {} };
}

function releaser(file, nonce) {
  return () => {
    if (readLock(file)?.nonce === nonce) fs.rmSync(file, { force: true });
  };
}

function describe(lock) {
  if (!lock || lock.corrupt) return 'unreadable lock file';
  return `${lock.holder} pid ${lock.pid} since ${lock.since}`;
}

function busyError(lock) {
  return new RigLockBusyError(
    `rig lock is held by ${describe(lock)}. The local stack is in use — wait for it, ` +
      'or run `node scripts/bundle.mjs lock status`.',
  );
}
