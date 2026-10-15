// src/doctor.mjs — `cookwright doctor`. A placeholder so the bin dispatches it; the
// command itself lands in a later session of the stage-1 bundle (plan §4.8).

import { messages } from './lib/messages.mjs';

export function main() {
  console.error(messages.notBuiltYet('doctor'));
  return 2;
}
