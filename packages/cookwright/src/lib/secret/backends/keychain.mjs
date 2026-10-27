// src/lib/secret/backends/keychain.mjs — the macOS Keychain backend (stage-5 plan
// §4.3, dispositions 12, 26, 52, 60): each secret a generic password, service
// `cookwright/<secrets.id>/<target>`, account the secret's name. Nothing of it lives
// in the repo.
//
// No value is ever on a command line (disposition 48). `security`'s own prompt
// truncates at 128 characters without a word, so `secrets set` reads the value
// through cookwright's prompt (or `--stdin`) and writes it through `security -i`,
// whose command line arrives on stdin (disposition 60, provisional pending the
// developer). Measured on macOS 26.6.2 (stage-5 s3), on a throwaway keychain:
//
// - `security -i` splits words like a shell: inside double quotes a backslash escapes
//   `"` and `\`, and a bare backslash is dropped; `'`, `$`, `` ` ``, `#`, `;`, a tab,
//   leading spaces and non-ASCII come through as written. So the value goes in double
//   quotes with `\` and `"` escaped.
// - It reads one command of at most 4096 bytes, the newline included; a longer line
//   is split, and `security` echoes the rest of it, a piece of the value, on stderr.
//   So the line is measured first and refused when longer, and `security`'s output
//   is never printed.
// - `find-generic-password -w` prints a value holding a byte outside printable ASCII
//   (a tab, `é`) as bare hex, which reads exactly like a value of hex digits. `-g`
//   tells them apart on stderr: `password: "<value>"`, raw, or `password: 0x<HEX>
//   "<escaped>"`. So a value is read with `-g`, and after every `set` it is read back
//   and compared (sha256) with what was entered; a difference removes the item.
// - One attribute lookup (`find-generic-password -s -a`, no `-g`) takes about 10 ms,
//   a miss (exit 44) about 12 ms; doctor makes one per declared name.
//
// The tests pass `ctx.keychain`, a throwaway keychain's path appended to every
// call; the product never does, so `security` searches the default list.

import crypto from 'node:crypto';

import { messages } from '../../messages.mjs';
import { pass, skip, warn } from '../../verdict.mjs';
import { serviceOf } from '../config.mjs';
import { Refused } from '../engine.mjs';

const m = messages.secrets;
const k = m.keychain;
const t = messages.doctor.secretsTargets;

/** The longest command `security -i` reads whole, its newline included (measured). */
export const LINE_MAX = 4096;
/** `security`'s exit status for an item that is not there. */
const NOT_FOUND = 44;

/** `s` as one double-quoted word of `security -i`'s command line. */
export const quoted = (s) => `"${s.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
const keychainArgs = (ctx) => (ctx.keychain ? [ctx.keychain] : []);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** The `security -i` command that stores `value` as `name` under `service`, one line. */
export function addLine(service, name, value, keychain) {
  const words = ['add-generic-password', '-U', '-s', quoted(service), '-a', name, '-w', quoted(value)];
  return `${[...words, ...(keychain ? [quoted(keychain)] : [])].join(' ')}\n`;
}

/**
 * The value on `find-generic-password -g`'s `password:` line: `{ value }`, `{ value:
 * '' }` for an empty one, `{ why: 'notText' }` for bytes that are not UTF-8, or null
 * when the line is absent.
 */
export function passwordOf(stderr) {
  const line = stderr.split('\n').find((l) => l.startsWith('password:'));
  if (line === undefined) return null;
  const hex = /^password: 0x([0-9A-Fa-f]*)(?:\s|$)/.exec(line);
  if (hex) {
    const value = Buffer.from(hex[1], 'hex').toString('utf8');
    return Buffer.from(value).toString('hex') === hex[1].toLowerCase() ? { value } : { why: 'notText' };
  }
  const raw = 'password: "';
  return { value: line.startsWith(raw) && line.endsWith('"') ? line.slice(raw.length, -1) : '' };
}

/** The value stored as `name` under `service`, '' when there is none. Never prints `security`'s output. */
function readItem(service, name, ctx) {
  const args = ['find-generic-password', '-s', service, '-a', name, '-g', ...keychainArgs(ctx)];
  const res = ctx.probes.capture('security', args, { env: ctx.env });
  if (res.status === NOT_FOUND) return '';
  if (res.status !== 0) throw new Refused(k.failed('find-generic-password', res.status));
  const got = passwordOf(res.stderr) ?? { value: '' };
  if (got.why) throw new Refused(k[got.why](name));
  if (got.value.includes('\0')) throw new Refused(k.nul(name));
  return got.value;
}

/** `resolve`: each declared name's item under the target's service; an absent or empty one refuses. */
export function resolve(name, ctx) {
  const service = serviceOf(ctx.config, name);
  const values = new Map();
  for (const secret of ctx.config.secrets.targets[name].names) {
    const value = readItem(service, secret, ctx);
    if (value === '') throw new Refused(m.missingName(secret, name));
    values.set(secret, value);
  }
  return values;
}

/**
 * `set`: `secret` of target `name` written through `security -i` (disposition 60),
 * then read back; a value that does not come back as entered is removed. Returns
 * the service, for the command's line.
 */
export async function set(name, secret, ctx) {
  if (!ctx.config.secrets.targets[name].names.includes(secret)) throw new Refused(m.undeclared(secret, name));
  const service = serviceOf(ctx.config, name);
  const value = await ctx.readValue();
  const line = addLine(service, secret, value, ctx.keychain);
  if (Buffer.byteLength(line) > LINE_MAX) {
    throw new Refused(k.tooLong(LINE_MAX - Buffer.byteLength(addLine(service, secret, '', ctx.keychain))));
  }
  const res = ctx.probes.capture('security', ['-i'], { input: line, env: ctx.env });
  if (res.status !== 0) throw new Refused(k.failed('-i add-generic-password', res.status));
  if (sha(readItem(service, secret, ctx)) !== sha(value)) {
    const args = ['delete-generic-password', '-s', service, '-a', secret, ...keychainArgs(ctx)];
    ctx.probes.capture('security', args, { env: ctx.env });
    throw new Refused(k.readBack(secret, service));
  }
  return { service };
}

/**
 * Doctor's look at target `name` (disposition 7): each declared name present by its
 * attributes, never its value (no `-g`, no `-w`). Within doctor's budget.
 */
export function inspect(name, ctx) {
  const service = serviceOf(ctx.config, name);
  const missing = [];
  for (const secret of ctx.config.secrets.targets[name].names) {
    const args = ['find-generic-password', '-s', service, '-a', secret, ...keychainArgs(ctx)];
    const res = ctx.probes.capture('security', args, { env: ctx.env });
    if (res.status === NOT_FOUND) missing.push(secret);
    else if (res.status !== 0) return skip(t.keychain.lookup(name, res.status));
  }
  return missing.length ? warn(t.keychain.missing(name, service, missing)) : pass(t.keychain.ok(name, service));
}

function refuseInit() {
  throw new Refused(k.noInit);
}

/** The keychain backend's description, as backends/index.mjs registers it. */
export const KEYCHAIN = Object.freeze({
  name: 'keychain',
  tools: { resolve: ['security'], set: ['security'], inspect: ['security'] },
  install: k.install,
  platforms: ['darwin'],
  control: [],
  files: () => [],
  bannerParts: (target, config) => [k.banner(serviceOf(config, target))],
  resolve,
  set,
  init: refuseInit,
  inspect,
});
