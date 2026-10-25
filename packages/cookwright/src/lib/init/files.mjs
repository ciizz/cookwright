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
 * (root-relative; a mode with no content changes the mode only), link writes
 * `{ rel, link }` (a symbolic link at `rel` whose text is `link`), or git writes
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
 * follow a linked parent out of the repo. A link write is exempt for its final
 * component only, which is the pointer it writes or replaces.
 */
export function refuseLinks(root, rows) {
  for (const { writes } of rows) {
    for (const w of writes.filter((x) => x.rel !== undefined)) {
      const link = linkOnPath(root, w.link === undefined ? w.rel : path.posix.dirname(w.rel));
      if (link) throw new Refusal(m.symlink(link));
    }
  }
}

/** The file and link writes of `rows`, as rel → the target of the first row writing it. */
function writers(rows) {
  const seen = new Map();
  for (const { target, writes } of rows) {
    for (const w of writes.filter((x) => x.rel !== undefined && (x.content !== undefined || x.link !== undefined))) {
      if (seen.has(w.rel)) throw new Refusal(m.collision(w.rel, seen.get(w.rel), target));
      seen.set(w.rel, target);
    }
  }
  return seen;
}

/**
 * Refuse, in preflight, two writes to one path, or a write under a path another
 * write makes a file: every step reads the same unchanged tree, so the later would
 * clobber the earlier, or fail midway once the earlier writes have landed.
 */
export function refuseCollisions(rows) {
  const seen = writers(rows);
  for (const [rel, target] of seen) {
    for (let dir = path.posix.dirname(rel); dir !== '.'; dir = path.posix.dirname(dir)) {
      if (seen.has(dir)) throw new Refusal(m.collision(dir, seen.get(dir), target));
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

/** A JSON file's own indent (two spaces when it has none). */
const indentOf = (text) => /^([ \t]+)"/m.exec(text)?.[1] ?? '  ';

/**
 * `obj` as JSON in the indent, line ending and final newline of `text`, the file it
 * replaces. Standard layout otherwise: a caller compares `reserialize(JSON.parse(text),
 * text)` with `text` to say when that relays more than the keys it changed.
 */
export function reserialize(obj, text) {
  const tail = /\n$/.test(text) ? eolOf(text) : '';
  return JSON.stringify(obj, null, indentOf(text)).split('\n').join(eolOf(text)) + tail;
}

function writeFile(root, { rel, content, mode }) {
  const abs = path.join(root, rel);
  if (content !== undefined) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, mode === undefined ? undefined : { mode });
  }
  // The mode option does not touch an existing file; chmod does.
  if (mode !== undefined) fs.chmodSync(abs, mode);
}

const removeQuietly = (abs) => {
  try {
    if (isLink(abs)) fs.unlinkSync(abs);
  } catch {
    // Best effort: the caller reports the failure that led here.
  }
};

/**
 * A link write: the link is made beside `rel` and renamed over it, so a link
 * already there (an earlier pointer, by the step's own reading) is replaced at once
 * and kept whole when anything fails. A failure is returned as `{ rel, code, links }`,
 * never thrown: the run goes on and init reports it. `links` is true when it was the
 * link itself the filesystem refused, false for its directory or the rename.
 */
function writeLink(root, { rel, link }, { symlink, rename }) {
  const abs = path.join(root, rel);
  const tmp = `${abs}.cookwright-${process.pid}`;
  let step = 'dir';
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    removeQuietly(tmp); // one a killed run left
    step = 'link';
    symlink(link, tmp);
    step = 'rename';
    rename(tmp, abs);
    return null;
  } catch (err) {
    if (step === 'rename') removeQuietly(tmp);
    const code = err.code ?? String(err.message ?? err);
    return { rel, code, links: step === 'link' && code !== 'EACCES' };
  }
}

/**
 * Apply every row's file and link writes, in order, creating directories as needed;
 * then its git writes, so a config that activates files never precedes them. A git
 * failure is a refusal naming the files it leaves inert, which the next run
 * completes. Returns the link writes that failed. `symlink` and `rename` are the
 * tests' seams.
 */
export function applyRows(root, rows, { symlink = fs.symlinkSync, rename = fs.renameSync } = {}) {
  const writes = rows.flatMap((r) => r.writes);
  const refused = [];
  for (const w of writes.filter((x) => x.rel !== undefined)) {
    if (w.link === undefined) writeFile(root, w);
    else refused.push(writeLink(root, w, { symlink, rename }));
  }
  for (const { git, inert } of writes.filter((x) => x.git)) {
    const r = gitRun(root, git);
    if (r.status !== 0) throw new Refusal(m.gitWriteFailed(git, r.stderr.trim() || `exit ${r.status}`, inert));
  }
  return refused.filter(Boolean);
}
