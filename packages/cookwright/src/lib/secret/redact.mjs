// src/lib/secret/redact.mjs — the redactor between `run`'s child and the terminal
// (stage-5 plan §4.5, dispositions 5, 25, 59 and 68).
//
// It works on bytes: needles are Buffers matched with Buffer.indexOf, and bytes no
// needle covers pass through unchanged, so a binary stream (pg_dump -Fc, tar, gzip)
// or invalid UTF-8 comes out byte-identical. Every occurrence of every needle is
// covered: overlapping occurrences merge into one span, replaced by the names of
// the occurrences no other contains (`<A><B>` for two overlapping values, `<A>`
// for a password inside its own URL), so no part of either value leaks.
//
// Streaming holds back only a tail that is a proper prefix of some needle (moved
// back to a span's start when it falls inside one) and writes everything before it
// at once: a `Password:` prompt shows immediately, and there is no timer. A held
// tail is released by more input or by end(), so a value split across chunks is
// redacted exactly as it would be in one buffer.

import { Transform } from 'node:stream';

/** Inherited values (a stale export of a declared or ambient name) shorter than this are not needles (disposition 68). */
export const MIN_INHERITED = 8;
/** A URL password shorter than this is covered only as part of its whole value (disposition 5). */
export const MIN_PASSWORD = 8;

/** The password of a `scheme://user:password@host` value, as written, or null. */
function urlPassword(value) {
  const m = /^[a-z][a-z0-9+.-]*:\/\/(.*)$/is.exec(value);
  if (!m) return null;
  const at = m[1].lastIndexOf('@');
  const userinfo = at < 0 ? '' : m[1].slice(0, at);
  const colon = userinfo.indexOf(':');
  if (colon < 0 || /[/?#]/.test(userinfo)) return null;
  return userinfo.slice(colon + 1);
}

const decoded = (text) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

/** The forms of `value` the redactor covers: itself, its encodeURIComponent form, and a URL password of 8+ characters as written, decoded and encoded. */
function forms(value) {
  const out = [value, encodeURIComponent(value)];
  const raw = urlPassword(value);
  if (raw !== null && decoded(raw).length >= MIN_PASSWORD) out.push(raw, decoded(raw), encodeURIComponent(decoded(raw)));
  return out;
}

/**
 * The needles for `values` (name → resolved value, every length) and `inherited`
 * (name → the inherited value of a declared or ambient name, 8+ characters only),
 * as `[needle, replacement]` Buffer pairs, longest first; empties and duplicates
 * dropped, a resolved value's name winning over an inherited one's.
 */
export function needles(values, inherited = []) {
  const seen = new Set();
  const out = [];
  const add = (name, value) => {
    for (const text of forms(value)) {
      if (text === '' || seen.has(text)) continue;
      seen.add(text);
      out.push([Buffer.from(text), Buffer.from(`<${name}>`)]);
    }
  };
  for (const [name, value] of values) if (typeof value === 'string') add(name, value);
  for (const [name, value] of inherited) if (typeof value === 'string' && value.length >= MIN_INHERITED) add(name, value);
  return out.sort((a, b) => b[0].length - a[0].length);
}

/** Every occurrence of every needle in `buf`, overlapping ones included, by start then longest. */
function occurrences(buf, list) {
  const occ = [];
  for (const [needle, repl] of list) {
    for (let i = buf.indexOf(needle); i !== -1; i = buf.indexOf(needle, i + 1)) occ.push([i, i + needle.length, repl]);
  }
  return occ.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
}

/** The occurrences merged into disjoint spans, each with the replacements of its maximal occurrences. */
function spans(occ) {
  const out = [];
  let maxEnd = -1;
  for (const [start, end, repl] of occ) {
    if (end <= maxEnd) continue; // inside an occurrence that starts no later
    const last = out.at(-1);
    if (last && start < last.end) {
      last.end = end;
      if (!last.repl.at(-1).equals(repl)) last.repl.push(repl);
    } else out.push({ start, end, repl: [repl] });
    maxEnd = end;
  }
  return out;
}

/** `buf[0, end)` with each span before `end` replaced. */
function rewrite(buf, list, end) {
  const parts = [];
  let pos = 0;
  for (const span of list) {
    if (span.end > end) break;
    parts.push(buf.subarray(pos, span.start), ...span.repl);
    pos = span.end;
  }
  if (pos === 0 && end === buf.length) return buf;
  parts.push(buf.subarray(pos, end));
  return Buffer.concat(parts);
}

/** `buf` with every needle covered: the whole-stream answer streaming must equal. */
export function redactBytes(buf, list) {
  return rewrite(buf, spans(occurrences(buf, list)), buf.length);
}

/** Where the longest suffix of `buf` that is a proper prefix of some needle starts; `buf.length` when none is. */
function prefixStart(buf, list) {
  let p = buf.length;
  for (const [needle] of list) {
    for (let k = Math.min(needle.length - 1, buf.length); k > 0; k -= 1) {
      const start = buf.length - k;
      if (start >= p) break;
      if (buf[start] === needle[0] && buf.compare(needle, 0, k, start) === 0) {
        p = start;
        break;
      }
    }
  }
  return p;
}

/**
 * One streaming step over `buf` (the held tail and the new chunk): `out`, the
 * redacted bytes that can be written now, and `rest`, the tail to hold.
 */
export function redactStep(buf, list) {
  const found = spans(occurrences(buf, list));
  let hold = prefixStart(buf, list);
  const inside = found.find((s) => s.start < hold && hold < s.end);
  if (inside) hold = inside.start;
  return { out: rewrite(buf, found, hold), rest: Buffer.from(buf.subarray(hold)) };
}

/** The streaming redactor: a byte Transform, piped with normal backpressure. */
export class Redactor extends Transform {
  constructor(list, options) {
    super(options);
    this.list = list;
    this.held = Buffer.alloc(0);
  }

  _transform(chunk, _encoding, done) {
    const { out, rest } = redactStep(this.held.length ? Buffer.concat([this.held, chunk]) : chunk, this.list);
    this.held = rest;
    if (out.length) this.push(out);
    done();
  }

  _flush(done) {
    if (this.held.length) this.push(redactBytes(this.held, this.list));
    this.held = Buffer.alloc(0);
    done();
  }
}
