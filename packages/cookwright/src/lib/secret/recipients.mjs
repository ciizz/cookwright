// src/lib/secret/recipients.mjs — `secrets/recipients.txt`, the public age keys a
// ciphertext is written to, governed as the origin governs it (stage-5 plan
// disposition 23): every line a recipient or a comment, no secret key anywhere, and
// the file committed, still tracked, and equal to HEAD in the index and the work
// tree before anything is encrypted to it, so a new recipient is reviewed in a
// commit first. Git paths are top-relative (disposition 54): the caller passes
// `topRel` (secret/config.mjs) and git runs from the top.

import fs from 'node:fs';
import path from 'node:path';

import { gitRun } from '../doctor/repo.mjs';

/** An age recipient: `age1` and 58 bech32 characters. */
export const RECIPIENT = /^age1[a-z0-9]{58}$/;

/**
 * The recipients in `text`, as `{ keys }`, or `{ problem: { why, line? } }`: a line
 * holding an age secret key, even in a comment (`secretKey`); a line that is
 * neither blank, a `#` comment nor a recipient (`malformed`); no recipient (`empty`).
 */
export function parseRecipients(text) {
  const keys = [];
  for (const [i, raw] of text.split('\n').entries()) {
    const line = raw.trim();
    if (/AGE-SECRET-KEY-/i.test(line)) return { problem: { why: 'secretKey', line: i + 1 } };
    if (line === '' || line.startsWith('#')) continue;
    if (!RECIPIENT.test(line)) return { problem: { why: 'malformed', line: i + 1 } };
    keys.push(line);
  }
  return keys.length ? { keys } : { problem: { why: 'empty' } };
}

/** Each key's last eight characters, what a line prints to tell recipients apart. */
export const tails = (keys) => keys.map((k) => k.slice(-8));

/**
 * The recipients of the file at `topRel` under the work tree `top`, once it is
 * present, committed, still tracked, and identical to `HEAD:<topRel>` in the index
 * and in the work tree: `{ keys }`, or `{ problem: { why } }` with why `missing`,
 * `uncommitted` (not in HEAD), `removed` (a staged deletion), `staged` (the index
 * differs from HEAD), `differs` (the work tree does), or a parseRecipients problem.
 * `cap` bounds each git call (ms). The path is a literal pathspec, so a config
 * root named with `[`, `*` or `?` matches no sibling (disposition 54).
 */
export function requireCommittedRecipients(top, topRel, { cap } = {}) {
  let text;
  try {
    text = fs.readFileSync(path.join(top, topRel), 'utf8');
  } catch {
    return { problem: { why: 'missing' } };
  }
  const git = (args) => gitRun(top, args, cap === undefined ? {} : { cap });
  const head = git(['show', `HEAD:${topRel}`]);
  if (head.status !== 0) return { problem: { why: 'uncommitted' } };
  const literal = (args) => git(['--literal-pathspecs', ...args, '--', topRel]);
  if (literal(['ls-files', '--error-unmatch']).status !== 0) return { problem: { why: 'removed' } };
  if (literal(['diff', '--cached', '--quiet']).status !== 0) return { problem: { why: 'staged' } };
  if (head.stdout !== text) return { problem: { why: 'differs' } };
  return parseRecipients(text);
}
