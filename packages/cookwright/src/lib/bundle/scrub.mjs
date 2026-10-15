// src/lib/bundle/scrub.mjs — committed bundle records never hold a machine-local
// path. A path under the repo root becomes root-relative; any other path under this
// machine's home or temp directories (a scratchpad, a transcript) becomes LOCAL_PATH.
// The bundle state and every record pass through here on their way to disk.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const LOCAL_PATH = '<local path>';

const realOr = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
};
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const spellings = (dirs) =>
  [...new Set(dirs.flatMap((d) => [d, realOr(d)]))]
    .filter((d) => d && d !== path.sep)
    .sort((a, b) => b.length - a.length);

const MACHINE_DIRS = () => [os.homedir(), os.tmpdir(), '/tmp', '/private/tmp'];

/** A function that scrubs one string: the repo root's paths made relative, other machine-local paths redacted. */
function scrubber(root) {
  const rules = [
    ...spellings([root]).map((r) => [
      new RegExp(`${escape(r)}(/|(?![\\w.-]))`, 'g'),
      (_, slash) => (slash ? '' : '.'),
    ]),
    ...spellings(MACHINE_DIRS()).map((d) => [
      new RegExp(`${escape(d)}(?:/[^\\s'"\`)\\]}>,;]*|(?![\\w.-]))`, 'g'),
      LOCAL_PATH,
    ]),
  ];
  return (text) => rules.reduce((out, [re, to]) => out.replace(re, to), text);
}

/** `text` with the repo root's paths made relative and other machine-local paths redacted. */
export const scrubLocalPaths = (text, root) => scrubber(root)(text);

/**
 * `value` with every string in it (keys included) scrubbed. Scrub before
 * serializing, never after: a regex over JSON text can eat an escape and break it.
 */
export function scrubValue(value, root, scrub = scrubber(root)) {
  if (typeof value === 'string') return scrub(value);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, root, scrub));
  if (value === null || typeof value !== 'object') return value;
  if (typeof value.toJSON === 'function') return scrubValue(value.toJSON(), root, scrub);
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [scrub(k), scrubValue(v, root, scrub)]),
  );
}

/** A session report's file list, root-relative; an absolute path outside the repo is refused. */
export function relativeFiles(files, root) {
  return files.map((f) => {
    if (typeof f !== 'string' || !path.isAbsolute(f)) return f;
    for (const r of spellings([root])) {
      const rel = path.relative(r, f);
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) return rel.split(path.sep).join('/') || '.';
    }
    throw new Error(`a session report lists a file outside the repo: ${f} — list repo files only`);
  });
}
