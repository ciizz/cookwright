// src/init.mjs — `cookwright init [--base <branch>] [--dry-run]`: take a repo to
// Level 0. Non-interactive and idempotent: every step reports wrote, updated, kept
// or skipped, and a second run changes no byte.
//
// Preflight first: every step reads its target and computes its row; a refusal
// anywhere exits 2 before a single write, so a refused tree is untouched as a whole.
// Then the writes, in order, then doctor, whose exit code is init's.

import { TimedOut } from './lib/budget.mjs';
import { Refusal, onlyFlags, parseArgv, stringFlag } from './lib/cli.mjs';
import { applyRows } from './lib/init/files.mjs';
import { openInitRepo } from './lib/init/repo.mjs';
import { preflight } from './lib/init/steps.mjs';
import { messages } from './lib/messages.mjs';
import { PROBES } from './lib/probes.mjs';
import { main as doctor } from './doctor.mjs';

const m = messages.init;
const FLAGS = ['base', 'dry-run'];
const BUNDLE_FLAGS = ['plan', 'split'];

function readArgs(argv) {
  const { pos, flags } = parseArgv(argv);
  const bundleFlag = BUNDLE_FLAGS.find((f) => Object.hasOwn(flags, f));
  if (bundleFlag) throw new Refusal(m.bundleFlag(bundleFlag));
  if (pos.length) throw new Refusal(m.usage);
  onlyFlags(flags, FLAGS);
  const dry = flags['dry-run'];
  if (dry !== undefined && dry !== true) throw new Refusal(m.usage);
  return { base: stringFlag(flags, 'base'), dry: dry === true };
}

const rowLines = (rows) => {
  const width = Math.max(...rows.map((r) => r.target.length));
  return rows.map((r) => `${r.action.padEnd(7)}  ${r.target.padEnd(width)}  ${r.note}`);
};

function init({ base, dry }, { cwd = process.cwd(), probes: over = {}, home, symlink } = {}) {
  const repo = openInitRepo(cwd, home ? { home } : {});
  const rows = preflight(repo, { probes: { ...PROBES, ...over }, base });
  console.log(dry ? m.dryHeader(repo.root) : m.header(repo.root));
  for (const line of rowLines(rows)) console.log(line);
  console.log('');
  if (dry) {
    console.log(m.dryFooter);
    return 0;
  }
  const refused = applyRows(repo.root, rows, symlink ? { symlink } : {});
  for (const { rel, code } of refused) console.log(m.pointers.linkFailed(rel, code));
  if (refused.length) console.log('');
  return doctor([], { cwd, probes: over, home });
}

/** A refusal on stderr, exit 2; with `usage`, the usage follows the reason. */
function refuse(err, usage) {
  if (err instanceof TimedOut) err = new Refusal(messages.timedOut(err.what));
  if (!(err instanceof Refusal)) throw err;
  console.error(m.refused(err.message));
  if (usage && err.message !== m.usage) console.error(m.usage);
  return 2;
}

/** `io.probes`, `io.home` and `io.symlink` are the tests' seams; the bin passes none. */
export function main(argv = [], io = {}) {
  let args;
  try {
    args = readArgs(argv);
  } catch (err) {
    return refuse(err, true);
  }
  try {
    return init(args, io);
  } catch (err) {
    return refuse(err, false);
  }
}
