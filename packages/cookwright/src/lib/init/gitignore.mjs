// src/lib/init/gitignore.mjs — step 6: git ignores the plaintext env files. The
// question is asked of git itself, one path per call (the probe doctor shares), so
// any rule that already covers them, a global one included, counts.

import { Refusal } from '../cli.mjs';
import { PROTECTED } from '../doctor/secrets.mjs';
import { messages } from '../messages.mjs';
import { KEPT, SKIPPED, UPDATED, WROTE, endLine, eolOf, readTarget, row } from './files.mjs';

const m = messages.init.gitignore;
const FILE = '.gitignore';
/** What init appends: the same patterns doctor's secrets.env matches. */
export const ENV_LINES = Object.freeze(['.env', '.env.*', '!.env.example']);

function notIgnored(repo, probes) {
  try {
    return PROTECTED.filter((p) => !probes.ignored(repo.root, p));
  } catch (err) {
    throw new Refusal(err.message);
  }
}

export function gitignoreStep(repo, io) {
  const missing = notIgnored(repo, io.probes);
  const text = readTarget(repo.root, FILE);
  if (!missing.length) return row(text === null ? SKIPPED : KEPT, FILE, text === null ? m.ignoredElsewhere : m.ignored);
  if (text === null) {
    return row(WROTE, FILE, m.wrote(ENV_LINES), [{ rel: FILE, content: `${ENV_LINES.join('\n')}\n` }]);
  }
  const lines = new Set(text.split(/\r?\n/).map((l) => l.trim()));
  if (ENV_LINES.every((l) => lines.has(l))) return row(KEPT, FILE, m.overridden(missing));
  const eol = eolOf(text);
  const content = `${endLine(text, eol)}${ENV_LINES.join(eol)}${eol}`;
  return row(UPDATED, FILE, m.appended(ENV_LINES), [{ rel: FILE, content }]);
}
