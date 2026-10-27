// src/lib/rules/block.mjs — the managed rules block in AGENTS.md: its markers, its
// render, and the one definition of "current" that init and doctor share.
//
// The block sits between `<!-- cookwright:begin rules vN -->` and
// `<!-- cookwright:end -->`; the user's own rules live outside it. The text comes from
// agents-block.md (content, rendered with the config's paths); the version in the
// begin marker is RULES_VERSION. Comparison is on LF text: a CRLF file is judged by
// the same render, so it stays `current` without being rewritten.
//
// A block has a kind: CORE_KIND (`rules`) for that block, packKind(name) (`pack expo`)
// for a stack pack's section (packs/section.mjs). Each kind has its own begin marker
// and they share the end marker; every function here defaults to the core kind, so
// the core block's markers and render are byte for byte what they were.

import fs from 'node:fs';

import { CLI, messages } from '../messages.mjs';

export const RULES_VERSION = 4;
export const RULES_FILE = 'AGENTS.md';
export const END_MARKER = '<!-- cookwright:end -->';
export const CORE_KIND = 'rules';
/** The kind of `name`'s pack section; a pack name is lower-case letters and dashes. */
export const packKind = (name) => `pack ${name}`;
export const beginMarker = (version = RULES_VERSION, kind = CORE_KIND) => `<!-- cookwright:begin ${kind} v${version} -->`;

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Fresh per call (`g` regexes carry lastIndex): a marker is a whole line.
const beginRe = (kind = CORE_KIND) => new RegExp(`^<!-- cookwright:begin ${escapeRe(kind)} v(\\d+) -->[ \\t]*$`, 'gm');
/** A begin marker of any kind, so a block missing its end never takes another block's. */
const anyBeginRe = () => /^<!-- cookwright:begin [a-z][a-z -]* v\d+ -->[ \t]*$/gm;
const endRe = () => /^<!-- cookwright:end -->[ \t]*$/gm;
const TEMPLATE = new URL('./agents-block.md', import.meta.url);

/** `{{a.b}}` → vars.a.b; a placeholder with no value is a packaging bug, thrown. */
export function renderTemplate(text, vars) {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const value = key.split('.').reduce((v, k) => (v == null ? undefined : v[k]), vars);
    if (typeof value !== 'string') throw new Error(messages.templateValue(key));
    return value;
  });
}

/** The whole block, markers included, LF line endings, no trailing newline. */
export function renderBlock(config, { template = fs.readFileSync(TEMPLATE, 'utf8') } = {}) {
  const body = renderTemplate(template, { paths: config.paths, cli: CLI }).trim();
  return `${beginMarker()}\n${body}\n${END_MARKER}`;
}

const toLF = (text) => text.replace(/\r\n/g, '\n');

/**
 * Where the block of `kind` stands in `text` (a whole rules file) against `rendered`:
 *   absent    — no begin marker of that kind
 *   malformed — a begin marker without an end after it (another block's begin
 *               marker coming first counts as none), or two of that kind
 *   newer     — the marker's version is above the package's (update cookwright)
 *   stale     — an older version, or content that differs from the render
 *   current   — byte-identical to the render, line endings aside
 * `start`/`end` are offsets of the block in the LF-normalised text; an end marker
 * after the first one is user text, or another block's, left alone.
 */
export function blockState(text, rendered, kind = CORE_KIND) {
  const lf = toLF(text);
  const begins = [...lf.matchAll(beginRe(kind))];
  if (begins.length === 0) return { state: 'absent' };
  if (begins.length > 1) return { state: 'malformed', reason: 'twoBegins' };
  const [begin] = begins;
  const end = endAfter(lf, begin);
  if (!end) return { state: 'malformed', reason: 'noEnd' };
  const span = { start: begin.index, end: end.index + end[0].length };
  const version = Number(begin[1]);
  const ours = Number(beginRe(kind).exec(rendered)?.[1] ?? RULES_VERSION);
  if (version > ours) return { state: 'newer', version, ...span };
  const same = version === ours && lf.slice(span.start, span.end) === toLF(rendered);
  return { state: same ? 'current' : 'stale', version, ...span };
}

/** The first end marker after `begin`, or null when none comes before the next block's begin. */
function endAfter(lf, begin) {
  const from = begin.index + begin[0].length;
  const endAt = endRe();
  endAt.lastIndex = from;
  const end = endAt.exec(lf);
  if (!end) return null;
  const nextBegin = anyBeginRe();
  nextBegin.lastIndex = from;
  const next = nextBegin.exec(lf);
  return next && next.index < end.index ? null : end;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** `@./X` imports the same file as `@X`: the path resolves from the importing file's directory. */
const sameDir = (word) => word.replace(/^@(?:\.\/)+/, '@');

/**
 * True when `token` (e.g. `@AGENTS.md`) is an import in `text`: a whitespace-
 * delimited word (`@./AGENTS.md` too) on a line outside a fenced block, outside
 * any code span. Claude skips imports in code, so a mention in prose code is not one.
 */
export function hasImport(text, token) {
  let fence = null;
  for (const line of toLF(text).split('\n')) {
    const f = FENCE.exec(line);
    if (f) {
      if (!fence) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    const bare = line.replace(/(`+)[^`][\s\S]*?\1/g, ' ');
    if (bare.split(/\s+/).map(sameDir).includes(token)) return true;
  }
  return false;
}
