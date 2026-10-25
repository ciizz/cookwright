// src/lib/packs/entries.mjs — what a pack's contract doc must list, and what it does
// list (stage-4 plan §4.3, disposition 33). Doctor's `pack.<name>.docs` row counts
// the difference; it never fails on it (disposition 11).
//
// Two listers, by the manifest doc's `entries`: `components`, the primitives under
// each `code` directory; `migrations`, the migration files under it. Each reads its
// directory and, for components, one level below: no walk, no subprocess. A
// directory that does not exist lists nothing (the blank scaffold). The table-cell
// reader takes the first cell of every body row of every table in the doc.

import fs from 'node:fs';
import path from 'node:path';

const MIGRATION = /^\d{14}_.+\.sql$/;
const COMPONENT = /\.(tsx|jsx)$/;
// React Native's platform files: `Map.web.tsx` and `Map.native.tsx` are one primitive, `Map`.
const PLATFORM = /\.(ios|android|native|web)$/;
const INDEX = /^index(\.(ios|android|native|web))?\.(tsx|jsx)$/;
// A component's companion files, never a primitive of their own.
const COMPANION = /\.(test|stories|styles|types)\./;

/** The entries of `dir`, or none when it is absent or not a directory. */
function dirents(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
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

/** A table row's first cell, its code span or link markup dropped. */
function firstCell(line) {
  const cell = line.trim().replace(/^\|/, '').split('|')[0].trim();
  return cell.replace(/^\[([^\]]*)\]\([^)]*\)$/, '$1').replace(/^`+|`+$/g, '').trim();
}

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
