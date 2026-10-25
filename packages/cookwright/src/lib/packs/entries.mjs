// src/lib/packs/entries.mjs — what a pack's contract doc must list, and what it does
// list (stage-4 plan §4.3, disposition 33). Doctor's `pack.<name>.docs` row counts
// the difference; it never fails on it (disposition 11).
//
// Two listers, by the manifest doc's `entries`: `components`, the primitives under
// each `code` directory; `migrations`, the migration files under it. Each reads its
// directory and, for components, one level below: no walk, no subprocess. A
// directory that does not exist lists nothing (the blank scaffold); one that cannot
// be read throws, and the row says it could not count. The doc's entries are the
// first cell of every body row of every table, and the text of every `##` or `###`
// heading outside a fenced code block (a doc written one section per primitive).

import fs from 'node:fs';
import path from 'node:path';

export const MIGRATION = /^\d{14}_.+\.sql$/;
const COMPONENT = /\.(tsx|jsx)$/;
// React Native's platform files: `Map.web.tsx` and `Map.native.tsx` are one primitive, `Map`.
const PLATFORM = /\.(ios|android|native|web)$/;
const INDEX = /^index(\.(ios|android|native|web))?\.(tsx|jsx)$/;
// A component's companion files, never a primitive of their own.
const COMPANION = /\.(test|stories|styles|types)\./;

/**
 * The entries of `dir`, or none when it is absent or not a directory. Any other
 * error (EACCES, EIO) throws: an unreadable directory is not an empty one.
 */
function dirents(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return [];
    throw err;
  }
}

const hidden = (name) => name.startsWith('.');

/** A primitive's name from a file directly under a code directory, or null. */
function fileComponent(name) {
  if (hidden(name) || !COMPONENT.test(name) || COMPANION.test(name) || /^index\./.test(name)) return null;
  return name.replace(COMPONENT, '').replace(PLATFORM, '');
}

/** A primitive's name from a directory holding an `index.tsx` or `index.jsx` (a platform one too), or null. */
function dirComponent(dir, name) {
  if (hidden(name)) return null;
  return dirents(path.join(dir, name)).some((e) => e.isFile() && INDEX.test(e.name)) ? name : null;
}

/** The primitives under the `code` directories at `root`, by name, each once, sorted. */
export function listComponents(root, code) {
  const names = new Set();
  for (const rel of code) {
    const dir = path.join(root, rel);
    for (const e of dirents(dir)) {
      const name = e.isFile() ? fileComponent(e.name) : e.isDirectory() ? dirComponent(dir, e.name) : null;
      if (name) names.add(name);
    }
  }
  return [...names].sort();
}

/** The migration files directly under the `code` directories at `root`, by file name, sorted. */
export function listMigrations(root, code) {
  const names = new Set();
  for (const rel of code) {
    for (const e of dirents(path.join(root, rel))) if (e.isFile() && MIGRATION.test(e.name)) names.add(e.name);
  }
  return [...names].sort();
}

/** The lister for a manifest doc's `entries` kind. */
export const LISTERS = Object.freeze({ components: listComponents, migrations: listMigrations });

const SEPARATOR = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/** `text` with its code span or link markup dropped. */
const unwrap = (text) => text.replace(/^\[([^\]]*)\]\([^)]*\)$/, '$1').replace(/^`+|`+$/g, '').trim();

/** A table row's first cell, its code span or link markup dropped. */
const firstCell = (line) => unwrap(line.trim().replace(/^\|/, '').split('|')[0].trim());

/**
 * The first cell of every body row of every pipe table in `text`: a header row is
 * the row a separator row follows, and neither counts. Empty cells are dropped.
 */
export function tableKeys(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const keys = new Set();
  lines.forEach((line, i) => {
    if (!line.trim().startsWith('|') || SEPARATOR.test(line.trim())) return;
    if (SEPARATOR.test((lines[i + 1] ?? '').trim())) return;
    const key = firstCell(line);
    if (key) keys.add(key);
  });
  return keys;
}

const HEADING = /^ {0,3}#{2,3}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * The text of every `##` or `###` heading in `text`, its closing hashes, code span
 * or link markup dropped; a line inside a fenced code block is not a heading.
 */
export function headingKeys(text) {
  const keys = new Set();
  let fence = null;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const open = FENCE.exec(line);
    if (open) fence = fence === null ? open[1][0] : fence === open[1][0] ? null : fence;
    if (open || fence !== null) continue;
    const key = unwrap(HEADING.exec(line)?.[1] ?? '');
    if (key) keys.add(key);
  }
  return keys;
}

/** A contract doc's entries: its tables' first cells and its `##`/`###` headings. */
export const docKeys = (text) => new Set([...tableKeys(text), ...headingKeys(text)]);
