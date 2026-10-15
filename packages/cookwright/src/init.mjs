// src/init.mjs — `cookwright init`. A placeholder so the bin dispatches it; the
// command itself lands in a later session of the stage-1 bundle (plan §4.4).

import { messages } from './lib/messages.mjs';

export function main() {
  console.error(messages.notBuiltYet('init'));
  return 2;
}
