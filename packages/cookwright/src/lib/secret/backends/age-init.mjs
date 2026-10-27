// src/lib/secret/backends/age-init.mjs — `secrets init` on the age backend (stage-5
// plan §4.3, dispositions 10, 23, 24, 42, 46, 51, 57, 71): a new identity outside
// every git work tree, its public key appended to `secrets/recipients.txt`.
//
// Everything is checked before anything is written (disposition 57): no identity
// yet, its nearest existing directory inside no work tree by realpath, the
// recipients file committed and well formed when present, the secrets paths not
// ignored by git, both places writable, a terminal for age's passphrase prompt, and
// consent (or `--yes`). A failure after the identity was written removes it, and
// the directories init created while they are empty, so a retry starts clean. The identity is written binary (`age -p -o`, never `-a`), mode
// 600 in a directory created 700, so its header says it is passphrase-protected
// (disposition 24); `--no-passphrase` writes age-keygen's key as it is.

import fs from 'node:fs';
import path from 'node:path';

import { messages } from '../../messages.mjs';
import { RECIPIENTS, SECRETS_DIR, ciphertextOf, topRel } from '../config.mjs';
import { Refused } from '../engine.mjs';
import { requireCommittedRecipients, tails } from '../recipients.mjs';
import {
  enclosingWorkTree,
  firstLine,
  identityPath,
  isPassphraseProtected,
  nearestExistingAncestor,
} from './age.mjs';

const a = messages.secrets.age;
const PUBLIC_KEY = /^# public key: (age1[a-z0-9]{58})$/m;

/** Refuse when git ignores the secrets directory, the recipients file or a target's ciphertext (disposition 42). */
function refuseIgnored(ctx) {
  const rels = [`${SECRETS_DIR}/`, RECIPIENTS, ...Object.keys(ctx.config.secrets.targets).map(ciphertextOf)];
  for (const rel of rels) {
    const atTop = topRel(ctx.root, ctx.top, rel);
    const rule = ctx.probes.ignoredBy(ctx.top, rel.endsWith('/') ? `${atTop}/` : atTop);
    if (rule) throw new Refused(a.ignored(rel, rule));
  }
}

/** The keys the recipients file already holds ([] when absent or holding none), once it is committed (disposition 23). */
function heldKeys(ctx) {
  if (!fs.existsSync(path.join(ctx.root, RECIPIENTS))) return [];
  const got = requireCommittedRecipients(ctx.top, topRel(ctx.root, ctx.top, RECIPIENTS));
  if (got.problem?.why === 'empty') return [];
  if (got.problem) throw new Refused(messages.secrets.recipients(got.problem, RECIPIENTS));
  return got.keys;
}

/** True when anything is at `p`, a dangling link included. */
function present(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch (err) {
    return err.code !== 'ENOENT';
  }
}

function refuseUnwritable(dir) {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    throw new Refused(a.notWritable(dir));
  }
}

/** Every check before anything is written: `{ identity, held, recipients }`. */
export function preflight(ctx, { noPassphrase }) {
  const identity = identityPath(ctx.env, ctx.home);
  if (present(identity)) throw new Refused(a.identityExists(identity));
  const ancestor = nearestExistingAncestor(identity);
  const top = enclosingWorkTree(ancestor, ctx.env);
  if (top !== null) throw new Refused(a.inWorkTree(ancestor, top));
  if (!ctx.top || topRel(ctx.root, ctx.top, RECIPIENTS) === null) throw new Refused(messages.secrets.notWorkTree);
  refuseIgnored(ctx);
  const held = heldKeys(ctx);
  const recipients = path.join(ctx.root, RECIPIENTS);
  refuseUnwritable(ancestor);
  refuseUnwritable(nearestExistingAncestor(recipients));
  if (!noPassphrase && !ctx.probes.terminal()) throw new Refused(a.passphraseTerminal);
  return { identity, held, recipients };
}

/** Consent, or `--yes`: what init will write, said first. */
async function consent(plan, ctx, { noPassphrase, yes }) {
  const lines = [
    a.willWrite,
    a.willIdentity(plan.identity, !noPassphrase),
    a.willRecipients(RECIPIENTS, fs.existsSync(plan.recipients)),
  ];
  if (plan.held.length) lines.push(a.held(RECIPIENTS, tails(plan.held)));
  for (const line of lines) ctx.say(line);
  if (yes) return;
  const answer = await ctx.confirm(messages.secrets.prompt.proceed);
  if (answer === null) throw new Refused(a.consentTerminal);
  if (!answer) throw new Refused(a.declined);
}

/** A new key from age-keygen: `{ key, publicKey }`, the key text never printed. */
function generate(ctx) {
  const res = ctx.probes.capture('age-keygen', [], { env: ctx.env });
  if (res.status !== 0) throw new Refused(a.failed('age-keygen', firstLine(res.stderr || res.error?.message)));
  const publicKey = PUBLIC_KEY.exec(res.stdout)?.[1];
  if (!publicKey) throw new Refused(a.noPublicKey);
  return { key: res.stdout, publicKey };
}

/**
 * The identity written at `file`, mode 600: the key itself with `noPassphrase`,
 * else through `age -p -o`, age prompting on its terminal (uncapped). The file is
 * created 600 first so age writes into it and its mode never widens.
 */
function writeIdentity(file, key, ctx, noPassphrase) {
  fs.writeFileSync(file, noPassphrase ? key : '', { mode: 0o600, flag: 'wx' });
  if (noPassphrase) return;
  const res = ctx.probes.capture('age', ['-p', '-o', file], { input: key, env: ctx.env, cap: null });
  if (/autogenerated passphrase/i.test(res.stderr)) throw new Refused(a.autogenerated);
  if (res.status !== 0) throw new Refused(a.failed('age -p', firstLine(res.stderr || res.error?.message)));
  fs.chmodSync(file, 0o600);
  if (!isPassphraseProtected(file)) throw new Refused(a.notProtected);
}

/** The directories `mkdir -p dir` would create, deepest first. */
function missingDirs(dir) {
  const out = [];
  for (let d = dir; !fs.existsSync(d) && path.dirname(d) !== d; d = path.dirname(d)) out.push(d);
  return out;
}

/**
 * Remove `dirs` (deepest first), each only while empty, never recursively: a file
 * another process put there meanwhile is left, with its directory (finding 2).
 */
function removeEmpty(dirs) {
  for (const dir of dirs) {
    try {
      fs.rmdirSync(dir);
    } catch {
      return;
    }
  }
}

/** `publicKey` appended to the recipients file, created with it when absent. */
function appendRecipient(file, publicKey) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  fs.appendFileSync(file, `${text === '' || text.endsWith('\n') ? '' : '\n'}${publicKey}\n`);
}

/**
 * `secrets init` on age: preflight, consent, then the identity and the recipient.
 * `ctx` adds `say(line)` and `confirm(question)` to the backend context.
 */
export async function initAge(ctx, flags) {
  const plan = preflight(ctx, flags);
  await consent(plan, ctx, flags);
  const { key, publicKey } = generate(ctx);
  const created = missingDirs(path.dirname(plan.identity));
  fs.mkdirSync(path.dirname(plan.identity), { recursive: true, mode: 0o700 });
  try {
    writeIdentity(plan.identity, key, ctx, flags.noPassphrase);
    appendRecipient(plan.recipients, publicKey);
  } catch (err) {
    if (present(plan.identity)) {
      fs.rmSync(plan.identity, { force: true });
      ctx.say(a.removed(plan.identity));
    }
    removeEmpty(created);
    throw err;
  }
  ctx.say(a.wroteIdentity(plan.identity, !flags.noPassphrase));
  ctx.say(a.wroteRecipients(RECIPIENTS, tails([...plan.held, publicKey])));
  ctx.say(a.commitFirst(RECIPIENTS));
}
