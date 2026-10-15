// src/lib/rules/block.mjs — the managed rules block in AGENTS.md: its markers, its
// render, and the one definition of "current" that init and doctor share.
//
// The block sits between `<!-- cookwright:begin rules vN -->` and
// `<!-- cookwright:end -->`; the user's own rules live outside it. The text comes from
// agents-block.md (content, rendered with the config's paths); the version in the
// begin marker is RULES_VERSION. Comparison is on LF text: a CRLF file is judged by
// the same render, so it stays `current` without being rewritten.

import fs from 'node:fs';

import { CLI, messages } from '../messages.mjs';

export const RULES_VERSION = 1;
export const RULES_FILE = 'AGENTS.md';
export const END_MARKER = '<!-- cookwright:end -->';
export const beginMarker = (version = RULES_VERSION) => `<!-- cookwright:begin rules v${version} -->`;

// Fresh per call (`g` regexes carry lastIndex): a marker is a whole line.
const beginRe = () => /^<!-- cookwright:begin rules v(\d+) -->[ \t]*$/gm;
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
 * Where the block stands in `text` (a whole rules file) against `rendered`:
 *   absent    — no begin marker
 *   malformed — a begin marker without an end after it, or two begin markers
 *   newer     — the marker's version is above the package's (update cookwright)
 *   stale     — an older version, or content that differs from the render
 *   current   — byte-identical to the render, line endings aside
 * `start`/`end` are offsets of the block in the LF-normalised text; an end marker
 * after the first one is user text, left alone.
 */
export function blockState(text, rendered) {
  const lf = toLF(text);
  const begins = [...lf.matchAll(beginRe())];
  if (begins.length === 0) return { state: 'absent' };
  if (begins.length > 1) return { state: 'malformed', reason: 'twoBegins' };
  const [begin] = begins;
  const endAt = endRe();
  endAt.lastIndex = begin.index;
  const end = endAt.exec(lf);
  if (!end) return { state: 'malformed', reason: 'noEnd' };
  const span = { start: begin.index, end: end.index + end[0].length };
  const version = Number(begin[1]);
  const ours = Number(beginRe().exec(rendered)?.[1] ?? RULES_VERSION);
  if (version > ours) return { state: 'newer', version, ...span };
  const same = version === ours && lf.slice(span.start, span.end) === toLF(rendered);
  return { state: same ? 'current' : 'stale', version, ...span };
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * True when `token` (e.g. `@AGENTS.md`) is an import in `text`: a whitespace-
 * delimited word on a line outside a fenced block, outside any code span. Claude
 * skips imports in code, so a mention in prose code is not one.
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
    if (bare.split(/\s+/).includes(token)) return true;
  }
  return false;
}
