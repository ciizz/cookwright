// src/lib/init/rules.mjs — step 3: the managed rules block in AGENTS.md, judged by
// the same blockState doctor uses. Everything outside the markers stays byte-
// identical; the block is written with the file's dominant line ending.

import { Refusal } from '../cli.mjs';
import { messages } from '../messages.mjs';
import { RULES_FILE, RULES_VERSION, blockState, renderBlock } from '../rules/block.mjs';
import { KEPT, UPDATED, WROTE, eolOf, endLine, readTarget, row, withEol } from './files.mjs';

const m = messages.init.block;

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

export function blockStep(repo) {
  const rel = RULES_FILE;
  const text = readTarget(repo.root, rel);
  const rendered = renderBlock(repo.config);
  if (text === null) return row(WROTE, rel, m.wrote, [{ rel, content: `${rendered}\n` }]);
  const s = blockState(text, rendered);
  const eol = eolOf(text);
  const block = withEol(rendered, eol);
  switch (s.state) {
    case 'current':
      return row(KEPT, rel, m.current);
    case 'newer':
      return row(KEPT, rel, m.newer(s.version));
    case 'malformed':
      throw new Refusal(messages.doctor.block.malformed(rel, s.reason));
    case 'stale': {
      const content = text.slice(0, rawOffset(text, s.start)) + block + text.slice(rawOffset(text, s.end));
      return row(UPDATED, rel, m.refreshed(RULES_VERSION), [{ rel, content }]);
    }
    default:
      return row(UPDATED, rel, m.appended, [{ rel, content: appendBlock(text, block, eol) }]);
  }
}
