// src/lib/init/files.mjs — what every init step needs to read a target and describe
// a write: the row, the target's kind, its text, its line ending.
//
// A step never writes. It returns a row whose `writes` the runner applies after the
// whole preflight has passed, so a refusal anywhere leaves the tree untouched.

import fs from 'node:fs';
import path from 'node:path';

import { Refusal } from '../cli.mjs';
import { messages } from '../messages.mjs';

const m = messages.init;

/** The four things a step can report. */
export const WROTE = 'wrote';
export const UPDATED = 'updated';
export const KEPT = 'kept';
export const SKIPPED = 'skipped';

/** One line of init's report; `writes` are `{ rel, content }`, root-relative. */
export const row = (action, target, note, writes = []) => ({ action, target, note, writes });

/** `none`, `file`, `dir` or `other` (a symlink to nothing, a socket, …). */
export function kindOf(abs) {
  try {
    const st = fs.statSync(abs);
    return st.isFile() ? 'file' : st.isDirectory() ? 'dir' : 'other';
  } catch (err) {
    return err.code === 'ENOENT' ? 'none' : 'other';
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

/** Apply every row's writes, in order, creating directories as needed. */
export function applyRows(root, rows) {
  for (const { writes } of rows) {
    for (const { rel, content } of writes) {
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
  }
}
