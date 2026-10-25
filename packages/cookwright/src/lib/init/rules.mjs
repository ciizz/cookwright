// src/lib/init/rules.mjs — step 3: AGENTS.md, composed in one pass from one text:
// the managed rules block, then each declared pack's section (stage-4 plan §4.2,
// disposition 27). Each block is judged by the same blockState doctor uses, one row
// per block, and the composed file is one write, so no two steps clobber each other.
// Everything outside the markers stays byte-identical; a block is written with the
// file's dominant line ending.

import { Refusal } from '../cli.mjs';
import { messages } from '../messages.mjs';
import { declaredPacks } from '../packs/registry.mjs';
import { renderSection } from '../packs/section.mjs';
import { CORE_KIND, RULES_FILE, RULES_VERSION, blockState, packKind, renderBlock } from '../rules/block.mjs';
import { KEPT, UPDATED, WROTE, eolOf, endLine, readTarget, row, withEol } from './files.mjs';

const m = messages.init;

/**
 * The offset in `raw` of offset `lf` in raw's LF-normalised text (blockState's
 * offsets are in that text): each CRLF pair counts as one character.
 */
export function rawOffset(raw, lf) {
  let i = 0;
  for (let n = 0; n < lf; n += 1) i += raw[i] === '\r' && raw[i + 1] === '\n' ? 2 : 1;
  return i;
}

/** `block` after `text`, one blank line between, a newline added first if missing. */
export function appendBlock(text, block, eol) {
  const body = endLine(text, eol);
  const gap = body === '' || /\r?\n\r?\n$/.test(body) ? '' : eol;
  return `${body}${gap}${block}${eol}`;
}

/** The core block, absent: appended at the end of the file. */
function appendCore(text, block, eol) {
  const next = appendBlock(text, block, eol);
  return { text: next, end: next.length - eol.length };
}

/**
 * A block absent: inserted after the raw offset `at` (the end of the block before
 * it), one blank line before it and, when text follows, one after.
 */
const insertAt = (at) => (text, block, eol) => {
  const tail = text.slice(at);
  const after = /^\r?\n(?!\r?\n|$)/.test(tail) ? eol : '';
  return { text: `${text.slice(0, at)}${eol}${eol}${block}${after}${tail}`, end: at + 2 * eol.length + block.length };
};

/**
 * One block of `kind` in `text` against `rendered`: `{ action, note, text, end }`,
 * `text` the file after it, `end` the raw offset just past its end marker. `absent`
 * places a block that is not there yet.
 */
function applyBlock(text, rendered, kind, notes, absent) {
  const s = blockState(text, rendered, kind);
  const eol = eolOf(text);
  const block = withEol(rendered, eol);
  if (s.state === 'malformed') throw new Refusal(notes.malformed(s.reason));
  if (s.state === 'current' || s.state === 'newer') {
    const note = s.state === 'current' ? notes.current : notes.newer(s.version);
    return { action: KEPT, note, text, end: rawOffset(text, s.end) };
  }
  if (s.state === 'stale') {
    const start = rawOffset(text, s.start);
    const next = text.slice(0, start) + block + text.slice(rawOffset(text, s.end));
    return { action: UPDATED, note: notes.refreshed, text: next, end: start + block.length };
  }
  return { action: UPDATED, note: notes.appended, ...absent(text, block, eol) };
}

const CORE_NOTES = Object.freeze({
  current: m.block.current,
  newer: m.block.newer,
  malformed: (reason) => messages.doctor.block.malformed(RULES_FILE, reason),
  refreshed: m.block.refreshed(RULES_VERSION),
  appended: m.block.appended,
  wrote: m.block.wrote,
});

const sectionNotes = ({ name, manifest }) => {
  const s = m.pack.section;
  return {
    current: s.current(name),
    newer: (v) => s.newer(name, v),
    malformed: (reason) => s.malformed(RULES_FILE, name, reason),
    refreshed: s.refreshed(name, manifest.version),
    appended: s.appended(name),
    wrote: s.wrote(name),
  };
};

/** The row target of a pack's section: the file, then the pack. */
export const sectionTarget = (name) => `${RULES_FILE}#${name}`;

/** Every block, in order, applied to `text`: `[{ target, notes, action, note, text }]`. */
function composeBlocks(config, text) {
  const out = [];
  let last = applyBlock(text, renderBlock(config), CORE_KIND, CORE_NOTES, appendCore);
  out.push({ target: RULES_FILE, notes: CORE_NOTES, ...last });
  for (const pack of declaredPacks(config)) {
    const notes = sectionNotes(pack);
    const rendered = renderSection(pack.manifest, pack.off);
    last = applyBlock(last.text, rendered, packKind(pack.name), notes, insertAt(last.end));
    out.push({ target: sectionTarget(pack.name), notes, ...last });
  }
  return out;
}

/**
 * Step 3: one row per block, the core block first; the composed file is written
 * once, by the last row that changed it. No file: every block is written.
 */
export function rulesFileStep(repo) {
  const original = readTarget(repo.root, RULES_FILE);
  const blocks = composeBlocks(repo.config, original ?? '');
  const content = blocks.at(-1).text;
  const writer = blocks.findLastIndex((b) => b.action !== KEPT);
  return blocks.map((b, i) => {
    const writes = i === writer && content !== original ? [{ rel: RULES_FILE, content }] : [];
    if (original === null) return row(WROTE, b.target, b.notes.wrote, writes);
    return row(b.action, b.target, b.note, writes);
  });
}
