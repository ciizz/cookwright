// src/lib/init/gitignore.mjs — step 6: git ignores the plaintext env files and
// node_modules (B-011: a bare repo has no .gitignore, so a `git add -A` after init
// would commit the installed package). The question is asked of git itself, one
// path per call (the probe doctor shares), so any rule that already covers them, a
// global one included, counts. What is not ignored has its lines appended, after
// any rule that overrides them.

import path from 'node:path';

import { Refusal } from '../cli.mjs';
import { isLink } from '../doctor/repo.mjs';
import { PROTECTED } from '../doctor/secrets.mjs';
import { messages } from '../messages.mjs';
import { KEPT, SKIPPED, UPDATED, WROTE, endLine, eolOf, readTarget, row } from './files.mjs';

const m = messages.init.gitignore;
const FILE = '.gitignore';
/** What init appends for the env files: the same patterns doctor's secrets.env matches. */
export const ENV_LINES = Object.freeze(['.env', '.env.*', '!.env.example']);
/**
 * What init appends for the installed packages, and the path it asks git about:
 * with the slash, git answers for a directory whether or not it exists yet.
 */
export const NODE_MODULES_LINE = 'node_modules/';
/**
 * The same when node_modules is a symbolic link (some Docker, Nix or monorepo
 * setups): a directory pattern never matches a link, and git refuses a slashed
 * pathspec beyond one (exit 128), so both the question and the line drop the slash.
 */
export const NODE_MODULES_LINK = 'node_modules';

const modulesLine = (root) => (isLink(path.join(root, 'node_modules')) ? NODE_MODULES_LINK : NODE_MODULES_LINE);

/** `{ paths, lines }`: the paths git does not ignore, and the lines that cover them, node_modules first. */
function notIgnored(repo, probes) {
  try {
    const env = PROTECTED.filter((p) => !probes.ignored(repo.root, p));
    const line = modulesLine(repo.root);
    const modules = probes.ignored(repo.root, line) ? [] : [line];
    return { paths: [...modules, ...env], lines: [...modules, ...(env.length ? ENV_LINES : [])] };
  } catch (err) {
    throw new Refusal(err.message);
  }
}

export function gitignoreStep(repo, io) {
  const { paths, lines } = notIgnored(repo, io.probes);
  const text = readTarget(repo.root, FILE);
  if (!lines.length) return row(text === null ? SKIPPED : KEPT, FILE, text === null ? m.ignoredElsewhere : m.ignored);
  if (text === null) {
    return row(WROTE, FILE, m.wrote(lines), [{ rel: FILE, content: `${lines.join('\n')}\n` }]);
  }
  // git's last matching rule wins, so the lines go after whatever overrides them,
  // even when they appear earlier. Already last and still not ignored: appending
  // again cannot help, and a rerun must not grow the file.
  const tail = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-lines.length);
  if (tail.join('\n') === lines.join('\n')) return row(KEPT, FILE, m.overridden(paths));
  const eol = eolOf(text);
  const content = `${endLine(text, eol)}${lines.join(eol)}${eol}`;
  return row(UPDATED, FILE, m.appended(lines), [{ rel: FILE, content }]);
}
