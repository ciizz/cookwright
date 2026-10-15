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

/** `text` with the repo root's paths made relative and other machine-local paths redacted. */
export function scrubLocalPaths(text, root) {
  let out = text;
  for (const r of spellings([root])) {
    out = out.replace(new RegExp(`${escape(r)}(/|(?![\\w.-]))`, 'g'), (_, slash) =>
      slash ? '' : '.',
    );
  }
  for (const d of spellings(MACHINE_DIRS())) {
    out = out.replace(new RegExp(`${escape(d)}(?:/[^\\s'"\`)\\]}>,;]*|(?![\\w.-]))`, 'g'), LOCAL_PATH);
  }
  return out;
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
