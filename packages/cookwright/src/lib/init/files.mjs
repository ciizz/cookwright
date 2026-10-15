// src/lib/init/files.mjs — what every init step needs to read a target and describe
// a write: the row, the target's kind, its text, its line ending.
//
// A step never writes. It returns a row whose `writes` the runner applies after the
// whole preflight has passed, so a refusal anywhere leaves the tree untouched.

import fs from 'node:fs';
import path from 'node:path';

import { Refusal } from '../cli.mjs';
import { gitRun, isLink } from '../doctor/repo.mjs';
import { messages } from '../messages.mjs';

const m = messages.init;

/** The four things a step can report. */
export const WROTE = 'wrote';
export const UPDATED = 'updated';
export const KEPT = 'kept';
export const SKIPPED = 'skipped';

/**
 * One line of init's report. `writes` are file writes `{ rel, content, mode? }`
 * (root-relative; a mode with no content changes the mode only), or git writes
 * `{ git: [args], inert: [rels] }`, run after every file write of the run.
 */
export const row = (action, target, note, writes = []) => ({ action, target, note, writes });

/** `none`, `file`, `dir` or `other` (a symlink to nothing, a socket, …). */
export function kindOf(abs) {
  try {
    const st = fs.statSync(abs);
    return st.isFile() ? 'file' : st.isDirectory() ? 'dir' : 'other';
  } catch (err) {
    return err.code === 'ENOENT' && !isLink(abs) ? 'none' : 'other';
  }
}

/**
 * The first component of `rel`, from the root down to `rel` itself, that is a
 * symbolic link, or null. The changelog command refuses on it too.
 */
export function linkOnPath(root, rel) {
  const parts = rel.split(/[\\/]/);
  for (let i = 1; i <= parts.length; i += 1) {
    const sub = parts.slice(0, i).join('/');
    if (isLink(path.join(root, sub))) return sub;
  }
  return null;
}

/**
 * Refuse, in preflight, any write that would land through a symbolic link: the
 * target or any directory between the root and it, since mkdir and writeFile
 * follow a linked parent out of the repo.
 */
export function refuseLinks(root, rows) {
  for (const { writes } of rows) {
    for (const { rel } of writes.filter((w) => w.rel !== undefined)) {
      const link = linkOnPath(root, rel);
      if (link) throw new Refusal(m.symlink(link));
    }
  }
}

/** The text of the file `rel` under `root`, null when absent; anything else refuses. */
export function readTarget(root, rel) {
  const kind = kindOf(path.join(root, rel));
  if (kind === 'none') return null;
  if (kind !== 'file') throw new Refusal(m.notAFile(rel));
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

/** The file's dominant line ending: CRLF when most lines end so, else LF. */
export function eolOf(text) {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  return crlf > lf ? '\r\n' : '\n';
}

/** LF text with `eol` line endings. */
export const withEol = (text, eol) => (eol === '\n' ? text : text.split('\n').join(eol));

/** `text` ending in a newline, the file's own, unless it is empty. */
export const endLine = (text, eol) => (text === '' || /\n$/.test(text) ? text : text + eol);

function writeFile(root, { rel, content, mode }) {
  const abs = path.join(root, rel);
  if (content !== undefined) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, mode === undefined ? undefined : { mode });
  }
  // The mode option does not touch an existing file; chmod does.
  if (mode !== undefined) fs.chmodSync(abs, mode);
}

/**
 * Apply every row's file writes, in order, creating directories as needed; then its
 * git writes, so a config that activates files never precedes them. A git failure
 * is a refusal naming the files it leaves inert, which the next run completes.
 */
export function applyRows(root, rows) {
  const writes = rows.flatMap((r) => r.writes);
  for (const w of writes.filter((x) => x.rel !== undefined)) writeFile(root, w);
  for (const { git, inert } of writes.filter((x) => x.git)) {
    const r = gitRun(root, git);
    if (r.status !== 0) throw new Refusal(m.gitWriteFailed(git, r.stderr.trim() || `exit ${r.status}`, inert));
  }
}
