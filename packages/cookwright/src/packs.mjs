// src/packs.mjs — `cookwright packs rules`: the declared packs' doc-sync rules and
// gate checks, printed as JSON, `{ docSync: [...], gate: [...] }` (stage-4 plan
// §4.8, disposition 35). Init writes them only into a fresh cookwright.json; for an
// existing one the setup skill copies them from this output, never retyped.
//
// What it prints is what a fresh config takes (registry.mjs `defaultsOf`), for the
// rules each declared pack has on: a rule switched off in `packs` contributes no
// entry, and the ratchet appears once while any ESLint rule is on.
//
// Exit 0 with the JSON on stdout; exit 2 refused (no pack declared, no config, an
// invalid one, a bad argument), the reason on stderr.

import { TimedOut } from './lib/budget.mjs';
import { Refusal, parseArgv } from './lib/cli.mjs';
import { openConfig } from './lib/command.mjs';
import { messages } from './lib/messages.mjs';
import { activeRules, declaredPacks, defaultsOf } from './lib/packs/registry.mjs';

const m = messages.packs;

/** `{ docSync, gate }` of the packs declared at `cwd`; refuses when none is. */
export function packRules(cwd) {
  const { config } = openConfig(cwd, m);
  const declared = declaredPacks(config);
  if (!declared.length) throw new Refusal(m.none);
  return defaultsOf(declared.flatMap(activeRules));
}

/** Refuse anything but `rules` alone. */
function readArgs(argv) {
  const { pos, flags } = parseArgv(argv);
  if (pos.length !== 1 || pos[0] !== 'rules' || Object.keys(flags).length) throw new Refusal(m.usage);
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
  try {
    readArgs(argv);
  } catch (err) {
    return refuse(err, true);
  }
  try {
    console.log(JSON.stringify(packRules(cwd), null, 2));
    return 0;
  } catch (err) {
    return refuse(err, false);
  }
}
