// src/run.mjs — `cookwright run <target> -- <command…>`: the target's secrets
// injected into one child process, after target proof (stage-5 plan §4.2).
//
// argv is split at the first `--` before parseArgv sees it (disposition 1):
// everything after it is the child's, verbatim, flags included. The banner goes to
// stderr, so the child's stdout stays a clean stream.
//
// Exit: the child's own status; 128 + n when signal n ended it; 127 when it could
// not be started; 125 for every refusal before the spawn (dispositions 13, 47);
// 2 for a usage error, no config or an invalid one.

import os from 'node:os';

import { TimedOut } from './lib/budget.mjs';
import { Refusal, onlyFlags, parseArgv, splitArgv } from './lib/cli.mjs';
import { openConfig } from './lib/command.mjs';
import { messages } from './lib/messages.mjs';
import { PROBES } from './lib/probes.mjs';
import { BACKENDS } from './lib/secret/backends/index.mjs';
import { REFUSED_EXIT, Refused, realRoot, runTarget } from './lib/secret/engine.mjs';

const m = messages.run;

/** `{ target, child }`; no `--`, nothing after it, or anything but one target before it is the usage. */
function readArgs(argv) {
  const { own, child } = splitArgv(argv);
  if (!child || child.length === 0) throw new Refusal(m.usage);
  const { pos, flags } = parseArgv(own);
  onlyFlags(flags, []);
  if (pos.length !== 1) throw new Refusal(m.usage);
  return { target: pos[0], child };
}

/** A refusal on stderr: a Refused exits 125, a Refusal (usage, config) 2. */
function refuse(err, stderr, usage = false) {
  if (err instanceof TimedOut) err = new Refused(messages.timedOut(err.what));
  if (!(err instanceof Refusal) && !(err instanceof Refused)) throw err;
  stderr.write(`${m.refused(err.message)}\n`);
  if (usage && err.message !== m.usage) stderr.write(`${m.usage}\n`);
  return err instanceof Refused ? REFUSED_EXIT : 2;
}

/**
 * The tests' seams: `cwd`, `env`, `home`, `probes` (capture, spawnChild, hasTool,
 * terminal), `backends`, `platform` and the output streams. The bin passes none.
 */
export async function main(argv = [], io = {}) {
  const stderr = io.stderr ?? process.stderr;
  let args;
  try {
    args = readArgs(argv);
  } catch (err) {
    return refuse(err, stderr, true);
  }
  const ctx = {
    cwd: io.cwd ?? process.cwd(),
    env: io.env ?? process.env,
    home: io.home ?? os.homedir(),
    probes: { ...PROBES, ...io.probes },
    backends: io.backends ?? BACKENDS,
    platform: io.platform ?? process.platform,
    stdout: io.stdout ?? process.stdout,
    stderr,
  };
  try {
    return await runTarget(realRoot(openConfig(ctx.cwd, m)), args.target, args.child, ctx);
  } catch (err) {
    return refuse(err, stderr);
  }
}
