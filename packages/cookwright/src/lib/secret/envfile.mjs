// src/lib/secret/envfile.mjs — the resolved `NAME=value` text a backend returns,
// read against the names expected of it, and one line of it replaced (stage-5 plan
// §4.3, disposition 53). Pure.
//
// The text never reaches disk: a backend's resolved output, or an age ciphertext's
// plaintext held in memory. Anything but the expected lines is refused, naming a
// declared name or a line number and never a line's text: a multi-line value's
// continuation may look like `LD_PRELOAD=x`, and its name is part of a value.

import { messages } from '../messages.mjs';

/** One `NAME=value` line: a secret name, then anything but CR (a value is one line). */
const LINE = /^([A-Z][A-Z0-9_]*)=([^\r]*)$/;

/** The lines of `text`, a final newline ending the last rather than opening another. */
const linesOf = (text) => (text === '' ? [] : (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n'));

const problem = (why, detail = {}) => ({ problem: { why, ...detail } });

/**
 * `text` read against `expected` (secret names): `{ values, stale }`, a Map in the
 * order the lines came, or `{ problem: { why, line?, name? } }`. `ordered`: exactly
 * one line per expected name, in order, and nothing else (a 1Password template's
 * references). Otherwise each line sets an expected name at most once, in any
 * order; `partial` allows an expected name to be absent (`secrets set` reading the
 * file it is about to extend). `stale` keeps a well-formed line of a name not
 * expected out of `values` and lists its name in `stale` instead of refusing it
 * (`secrets set` dropping a name the config no longer declares, stage-5
 * review:whole finding 5). A NUL anywhere, or an empty value, is refused.
 */
export function parseAgainst(text, expected, { ordered = false, partial = false, stale = false } = {}) {
  const nul = text.indexOf('\0');
  if (nul >= 0) return problem('nul', { line: linesOf(text.slice(0, nul + 1)).length });
  const values = new Map();
  const dropped = new Set();
  for (const [i, line] of linesOf(text).entries()) {
    const m = LINE.exec(line);
    const at = { line: i + 1 };
    if (ordered && i >= expected.length) return problem('extra', at);
    if (!m) return problem('malformed', at);
    const [, name, value] = m;
    if (ordered && name !== expected[i]) return problem('unexpected', { ...at, name: expected[i] });
    if (stale && !expected.includes(name)) {
      dropped.add(name);
      continue;
    }
    if (!expected.includes(name)) return problem('unknown', at);
    if (values.has(name)) return problem('duplicate', { name });
    if (value === '') return problem('missing', { name });
    values.set(name, value);
  }
  if (partial) return { values, stale: [...dropped] };
  const absent = expected.find((name) => !values.has(name));
  return absent === undefined ? { values, stale: [...dropped] } : problem('missing', { name: absent });
}

/**
 * `text` with `name`'s line set to `value`, in place, or appended; always ending in
 * a newline. A value is one line without a NUL: anything else throws.
 */
export function replaceLine(text, name, value) {
  if (/[\n\r\0]/.test(value)) throw new RangeError(messages.secrets.envfile.multiLine(name));
  const lines = linesOf(text);
  const i = lines.findIndex((l) => l.startsWith(`${name}=`));
  if (i >= 0) lines[i] = `${name}=${value}`;
  else lines.push(`${name}=${value}`);
  return `${lines.join('\n')}\n`;
}
