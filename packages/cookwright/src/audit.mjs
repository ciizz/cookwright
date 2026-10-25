// src/audit.mjs — `cookwright audit args [--doc <path>[:<scope>] …]`: the docs-audit
// Workflow's arguments, `{ docs: [{ path, scope, rules? }] }`, printed as JSON
// (stage-4 plan §4.8, dispositions 12 and 34). The docs-audit skill passes them
// to the Workflow as printed, so no doc list is hand-written.
//
// The list is each declared pack's contract docs (their manifests' `docs`), then
// each `--doc` extra, every path relative to the config root. Each doc must be a
// regular file inside the repo with no symbolic link on its path, since the
// Workflow edits it: a pack's doc that is missing names init, an extra that is not
// such a file is refused naming it. A path listed twice is refused, since two
// auditor-fixers would own one file.
//
// Exit 0 with the JSON on stdout; exit 2 refused, the reason on stderr.

import path from 'node:path';

import { TimedOut } from './lib/budget.mjs';
import { Refusal } from './lib/cli.mjs';
import { CONFIG_FILE, findRoot, loadConfig, workTreeRoot } from './lib/config.mjs';
import { oneLine } from './lib/doctor/repo.mjs';
import { kindOf, linkOnPath } from './lib/init/files.mjs';
import { messages } from './lib/messages.mjs';
import { declaredPacks } from './lib/packs/registry.mjs';

const m = messages.audit;
const DOC = 'doc';

/** `{ path, scope? }` of one `--doc` value: the scope follows the first colon. */
function splitDoc(value) {
  const at = value.indexOf(':');
  const rel = at === -1 ? value : value.slice(0, at);
  const scope = at === -1 ? '' : value.slice(at + 1).trim();
  if (!rel.trim()) throw new Refusal(m.emptyPath);
  return { path: rel.trim(), scope };
}

/** The `--doc` extras of `argv` after `args`; anything else refuses. */
function readArgs(argv) {
  const [sub, ...rest] = argv;
  if (sub !== 'args') throw new Refusal(m.usage);
  const extras = [];
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    if (flag !== `--${DOC}`) throw new Refusal(flag.startsWith('--') ? messages.unknownFlag(flag.slice(2), [DOC]) : m.usage);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Refusal(messages.missing(m.docFlag));
    extras.push(splitDoc(value));
  }
  return extras;
}

/** `{ root, config }`: the config found as doctor finds it, loaded. */
function openConfig(cwd) {
  const top = workTreeRoot(cwd);
  const root = findRoot(cwd, { stopAt: top ?? undefined });
  if (!root) throw new Refusal(m.noConfig(cwd));
  try {
    return { root, config: loadConfig(root) };
  } catch (err) {
    const line = oneLine(err.message);
    throw new Refusal(m.configInvalid(line.startsWith(`${CONFIG_FILE}:`) ? line.slice(CONFIG_FILE.length + 1).trim() : line));
  }
}

/** `rel` normalised, or null when it leaves the root (absolute, `..`, the root itself). */
function inside(rel) {
  if (path.isAbsolute(rel) || rel.includes('\\')) return null;
  const norm = path.posix.normalize(rel);
  return norm === '.' || norm === '..' || norm.startsWith('../') ? null : norm;
}

/** Refuse a doc the Workflow cannot edit in place: a link on its path, or no file there. */
function checkDoc(root, rel, missing) {
  const link = linkOnPath(root, rel);
  if (link) throw new Refusal(m.link(rel, link));
  if (kindOf(path.join(root, rel)) !== 'file') throw new Refusal(missing);
}

/** Each declared pack's contract docs, as the Workflow takes them, each checked. */
function packDocs(root, config) {
  return declaredPacks(config).flatMap(({ name, manifest }) =>
    manifest.docs.map((doc) => {
      checkDoc(root, doc.path, m.packDocMissing(doc.path, name));
      return { path: doc.path, scope: doc.scope, ...(doc.rules ? { rules: doc.rules } : {}) };
    }),
  );
}

/** The `--doc` extras, each inside the repo and checked, with the default scope where none is given. */
function extraDocs(root, extras) {
  return extras.map(({ path: given, scope }) => {
    const rel = inside(given);
    if (!rel) throw new Refusal(m.outside(given));
    checkDoc(root, rel, m.notAFile(given));
    return { path: rel, scope: scope || m.defaultScope };
  });
}

/** The Workflow's args for the repo at `cwd`; refuses a duplicate path or an empty list. */
export function auditArgs(cwd, extras) {
  const { root, config } = openConfig(cwd);
  const docs = [...packDocs(root, config), ...extraDocs(root, extras)];
  if (!docs.length) throw new Refusal(m.nothing);
  const seen = new Set();
  for (const doc of docs) {
    if (seen.has(doc.path)) throw new Refusal(m.twice(doc.path));
    seen.add(doc.path);
  }
  return { docs };
}

/** A refusal on stderr, exit 2; with `usage`, the usage follows the reason. */
function refuse(err, usage) {
  if (err instanceof TimedOut) err = new Refusal(messages.timedOut(err.what));
  if (!(err instanceof Refusal)) throw err;
  console.error(m.refused(err.message));
  if (usage && err.message !== m.usage) console.error(m.usage);
  return 2;
}

/** `io.cwd` is the tests' seam; the bin passes none. */
export function main(argv = [], { cwd = process.cwd() } = {}) {
  let extras;
  try {
    extras = readArgs(argv);
  } catch (err) {
    return refuse(err, true);
  }
  try {
    console.log(JSON.stringify(auditArgs(cwd, extras), null, 2));
    return 0;
  } catch (err) {
    return refuse(err, false);
  }
}
