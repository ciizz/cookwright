// src/lib/cli.mjs — the argv pieces every cookwright command shares: the parser, the
// refusal type (exit 2), and the flag readers. Their texts live in messages.mjs.

import { messages } from './messages.mjs';

/** A refusal: bad input or a state the command will not act on. Exits 2. */
export class Refusal extends Error {}

/** Positionals and `--flag [value]` pairs; a flag followed by another flag is boolean. */
export function parseArgv(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      pos.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) flags[key] = true;
    else {
      flags[key] = next;
      i += 1;
    }
  }
  return { pos, flags };
}

/** `value`, or a refusal naming `what` when it is absent or a bare boolean flag. */
export const need = (value, what) => {
  if (value === undefined || value === true) throw new Refusal(messages.missing(what));
  return value;
};

/** A flag that must carry a finite number, or undefined when absent. */
export function numberFlag(flags, name) {
  if (flags[name] === undefined) return undefined;
  const n = Number(need(flags[name], `--${name} <number>`));
  if (!Number.isFinite(n)) throw new Refusal(messages.notANumber(name));
  return n;
}

/** A flag that must carry a value, or undefined when absent. */
export const stringFlag = (flags, name) =>
  flags[name] === undefined ? undefined : need(flags[name], `--${name} <value>`);

/** Refuse any flag not in `allowed`: a dropped or mistyped flag is never ignored. */
export function onlyFlags(flags, allowed) {
  const unknown = Object.keys(flags).find((f) => !allowed.includes(f));
  if (unknown !== undefined) throw new Refusal(messages.unknownFlag(unknown, allowed));
}
