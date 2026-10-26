// src/lib/packs/entries.mjs — what a pack's contract doc must list, and what it does
// list (stage-4 plan §4.3, disposition 33). Doctor's `pack.<name>.docs` row counts
// the difference; it never fails on it (disposition 11).
//
// Two listers, by the manifest doc's `entries`: `components`, the primitives under
// each `code` directory; `migrations`, the migration files under it. Each reads its
// directory and, for components, one level below: no walk, no subprocess. A
// directory that does not exist lists nothing (the blank scaffold); one that cannot
// be read throws, and the row says it could not count. The doc's entries are, outside
// a fenced or indented code block, the first cell of every body row of every table and
// the text of every `##` or `###` heading (a doc written one section per primitive).
// A line is read from where its list item's content starts, so a fence, row or
// heading in an item, on its marker line or a continuation line, nested or not, is
// judged as at the top level; a thematic break (`- - -`, `* * *`) opens no item.
// Indentation is read in columns, a tab to the next multiple of four. A blockquote
// is not read as one (E-052).

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

const HEADING = /^ {0,3}#{2,3}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * The fence `line` opens, as its delimiter run, or null. A backtick run whose info
 * string holds a backtick is inline code, not a fence (CommonMark 4.5).
 */
function opens(line) {
  const m = FENCE.exec(line);
  return m && !(m[1][0] === '`' && m[2].includes('`')) ? m[1] : null;
}

/** Whether `line` closes the fence `run` opened: the same character, at least as many, nothing after. */
const closes = (line, run) => {
  const m = FENCE.exec(line);
  return Boolean(m) && m[1][0] === run[0] && m[1].length >= run.length && m[2].trim() === '';
};

// A list item's marker after up to three spaces, and the spaces after it (CommonMark 5.2).
const MARKER = /^( {0,3}(?:[-*+]|\d{1,9}[.)]))( +)/;
// A thematic break, `- - -` or `* * *`: it wins over a list marker (CommonMark 4.1).
const BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
// A line's indentation and the list markers it opens, with the whitespace after each.
const PREFIX = /^(?:[ \t]*(?:[-*+]|\d{1,9}[.)])(?=[ \t]))*[ \t]*/;

/**
 * `line` with the tabs of its indentation and list-marker prefix expanded to spaces,
 * a tab reaching the next multiple of four columns (CommonMark 2.2), so a length is
 * a column count. The rest of the line is kept as it is.
 */
function expanded(line) {
  const prefix = PREFIX.exec(line)[0];
  let out = '';
  for (const c of prefix) out += c === '\t' ? ' '.repeat(4 - (out.length % 4)) : c;
  return out + line.slice(prefix.length);
}

const indentOf = (line) => line.length - line.trimStart().length;

/**
 * The list items `rest`, a line from column `base` on, opens: `{ opened, rest }`,
 * `opened` the column each item's content starts at, `rest` what follows the last
 * marker. Five or more spaces after a marker put the content one column after it,
 * the rest an indented code line (CommonMark 5.2). A thematic break opens no item.
 */
function items(rest, base) {
  const opened = [];
  for (let m = MARKER.exec(rest); m && !BREAK.test(rest); m = MARKER.exec(rest)) {
    const width = m[1].length + (m[2].length > 4 ? 1 : m[2].length);
    opened.push((base += width));
    rest = rest.slice(width);
  }
  return { opened, rest };
}

/**
 * `text`'s lines, each read from where its list item's content starts (the column
 * of the innermost open item's content, 0 at the top level), its indentation
 * tab-expanded; blank where a line is blank, an indented code line (four or more
 * columns past that start), or a line of a fenced code block, its delimiters too, so
 * the others keep their places. An item stays open while lines are indented as far
 * as its content; a fence in it ends with a line less indented, which ends the item too.
 */
function unfenced(text) {
  const open = [];
  let fence = null;
  return text.replace(/\r\n/g, '\n').split('\n').map(expanded).map((line) => {
    const blank = line.trim() === '';
    if (fence !== null && !blank && indentOf(line) < fence.indent) fence = null;
    if (fence !== null) {
      if (closes(line.slice(fence.indent), fence.run)) fence = null;
      return '';
    }
    if (blank) return '';
    while (open.length && indentOf(line) < open.at(-1)) open.pop();
    const base = open.at(-1) ?? 0;
    const { opened, rest } = items(line.slice(base), base);
    open.push(...opened);
    if (indentOf(rest) >= 4) return '';
    const run = opens(rest);
    if (run === null) return rest;
    fence = { run, indent: open.at(-1) ?? 0 };
    return '';
  });
}

/**
 * The first cell of every body row of every pipe table in `text`, outside a fenced
 * or indented code block: a header row is the row a separator row follows, and
 * neither counts. Empty cells are dropped.
 */
export function tableKeys(text) {
  const lines = unfenced(text);
  const keys = new Set();
  lines.forEach((line, i) => {
    if (!line.trim().startsWith('|') || SEPARATOR.test(line.trim())) return;
    if (SEPARATOR.test((lines[i + 1] ?? '').trim())) return;
    const key = firstCell(line);
    if (key) keys.add(key);
  });
  return keys;
}

/**
 * The text of every `##` or `###` heading in `text`, its closing hashes, code span
 * or link markup dropped; a line inside a fenced or indented code block is not a heading.
 */
export function headingKeys(text) {
  const keys = new Set();
  for (const line of unfenced(text)) {
    const key = unwrap(HEADING.exec(line)?.[1] ?? '');
    if (key) keys.add(key);
  }
  return keys;
}

/** A contract doc's entries: its tables' first cells and its `##`/`###` headings. */
export const docKeys = (text) => new Set([...tableKeys(text), ...headingKeys(text)]);
