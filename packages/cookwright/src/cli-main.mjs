// src/cli-main.mjs — the `cookwright` dispatcher: one bin, one subcommand per module.
//
// Each subcommand module exports `main(argv, { cwd, input })` and returns its exit
// code, so tests call it in process. Modules load lazily: the session-start hook runs
// `doctor`, and doctor must not pay for loading the bundle runner.

import { messages } from './lib/messages.mjs';

const COMMANDS = {
  init: () => import('./init.mjs'),
  doctor: () => import('./doctor.mjs'),
  changelog: () => import('./changelog.mjs'),
  hook: () => import('./hook.mjs'),
  migrate: () => import('./migrate.mjs'),
  bundle: () => import('./bundle.mjs'),
  standards: () => import('./standards.mjs'),
};

/** Run `cookwright <command> …`; an unknown or missing command → the usage, exit 2. */
export async function dispatch(argv, io = {}) {
  const [command, ...rest] = argv;
  const load = Object.hasOwn(COMMANDS, command ?? '') ? COMMANDS[command] : undefined;
  if (!load) {
    console.error(messages.usage(Object.keys(COMMANDS)));
    return 2;
  }
  const { main } = await load();
  return main(rest, io);
}
