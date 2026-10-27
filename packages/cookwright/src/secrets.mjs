// src/secrets.mjs — `cookwright secrets init [--no-passphrase] [--yes]` and
// `cookwright secrets set <target> <NAME> [--stdin]` (stage-5 plan §4.3): the
// developer's two commands that write a backend's state.
//
// `set` reads the value from a terminal with echo off, or one line of stdin with
// `--stdin`, never from an argument (disposition 10), and prints the name, the
// target and the backend, never the value or its length. `init` says what it will
// write and asks first (`--yes` consents).
//
// Exit 0 done; 125 refused by the product (a Refused, nothing written); 2 a usage
// error, no config or an invalid one.

import os from 'node:os';

import { TimedOut } from './lib/budget.mjs';
import { Refusal, onlyFlags, parseArgv } from './lib/cli.mjs';
import { openConfig } from './lib/command.mjs';
import { messages } from './lib/messages.mjs';
import { PROBES } from './lib/probes.mjs';
import { BACKENDS } from './lib/secret/backends/index.mjs';
import { REFUSED_EXIT, Refused, helperEnv, openBackend, openTarget, realRoot, scrubNames } from './lib/secret/engine.mjs';
import { confirm, readValue } from './lib/secret/prompt.mjs';

const m = messages.secrets;
const FLAGS = { init: ['no-passphrase', 'yes'], set: ['stdin'] };
const ARITY = { init: 1, set: 3 };

/** `{ sub, pos, flags }` with every flag a bare switch; anything else is the usage. */
function readArgs(argv) {
  const { pos, flags } = parseArgv(argv);
  const sub = pos[0];
  if (!Object.hasOwn(FLAGS, sub ?? '') || pos.length !== ARITY[sub]) throw new Refusal(m.usage);
  onlyFlags(flags, FLAGS[sub]);
  if (Object.values(flags).some((v) => v !== true)) throw new Refusal(m.usage);
  return { sub, pos, flags };
}

/** A refusal on stderr: a Refused exits 125, a Refusal (usage, config) 2. */
function refuse(err, stderr, usage = false) {
  if (err instanceof TimedOut) err = new Refused(m.timedOut(err.what));
  if (!(err instanceof Refusal) && !(err instanceof Refused)) throw err;
  stderr.write(`${m.refused(err.message)}\n`);
  if (usage && err.message !== m.usage) stderr.write(`${m.usage}\n`);
  return err instanceof Refused ? REFUSED_EXIT : 2;
}

/** The backend context the two commands share: the scrubbed environment, the prompts, the output. */
function backendContext(opened, io, backendOp) {
  const backend = openBackend(opened.config, io, backendOp);
  const ctx = {
    ...opened,
    probes: io.probes,
    env: helperEnv(io.env, scrubNames(opened.config)),
    home: io.home,
    say: (line) => io.stdout.write(`${line}\n`),
    confirm: (question) => confirm(io, question),
  };
  return { backend, ctx };
}

async function setCommand([, target, name], flags, opened, io) {
  openTarget(opened.config, target);
  const { backend, ctx } = backendContext(opened, io, 'set');
  ctx.readValue = () =>
    readValue({ stdin: io.stdin, stderr: io.stderr, fromStdin: flags.stdin === true, prompt: m.prompt.value(name, target) });
  const { keys, service, dropped = [] } = await backend.set(target, name, ctx);
  ctx.say(m.set(name, target, service ? m.withService(backend.name, service) : backend.name));
  if (dropped.length) ctx.say(m.dropped(dropped, target));
  if (keys) ctx.say(m.encryptedTo(keys.map((k) => k.slice(-8))));
  return 0;
}

async function initCommand(_pos, flags, opened, io) {
  const { backend, ctx } = backendContext(opened, io, 'init');
  await backend.init(ctx, { noPassphrase: flags['no-passphrase'] === true, yes: flags.yes === true });
  return 0;
}

/** The tests' seams: `cwd`, `env`, `home`, `probes`, `backends`, `platform`, `stdin`, `stdout`, `stderr`. */
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
    stdin: io.stdin ?? process.stdin,
    stdout: io.stdout ?? process.stdout,
    stderr,
  };
  try {
    const command = args.sub === 'init' ? initCommand : setCommand;
    return await command(args.pos, args.flags, realRoot(openConfig(ctx.cwd, m)), ctx);
  } catch (err) {
    return refuse(err, stderr);
  }
}
