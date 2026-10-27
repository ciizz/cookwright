// src/lib/secret/backends/age-init.mjs — `secrets init` on the age backend (stage-5
// plan §4.3, dispositions 10, 23, 24, 42, 46, 51, 57, 71): a new identity outside
// every git work tree, its public key appended to `secrets/recipients.txt`.
//
// One identity per developer (disposition 46): when the identity already exists,
// init writes no identity and enrols this repo instead (stage-5 review:engine
// finding 4). Its public key is derived, by `age-keygen -y <identity>` for an
// unprotected identity, or for a passphrase-protected one by `age -d <identity>`
// (age prompting on its terminal) into memory and `age-keygen -y` on stdin, and
// appended to the recipients file after the same preflight and consent. Nothing
// else is written, and nothing at all when the file already holds that key.
//
// Everything is checked before anything is written (disposition 57): no identity
// yet, its nearest existing directory (and an existing identity's own realpath)
// inside no work tree, the recipients file committed and well formed when present,
// the secrets paths not ignored by git, both places writable, a terminal for age's
// passphrase prompt, and consent (or `--yes`). A failure after this run wrote the
// identity removes it, and the directories init created while they are empty, so a
// retry starts clean. The identity is written binary (`age -p -o`, never `-a`),
// mode 600 in a directory created 700, so its header says it is
// passphrase-protected (disposition 24); `--no-passphrase` writes age-keygen's key
// as it is.

import fs from 'node:fs';
import path from 'node:path';

import { isFile } from '../../doctor/repo.mjs';
import { messages } from '../../messages.mjs';
import { RECIPIENTS, SECRETS_DIR, ciphertextOf, topRel } from '../config.mjs';
import { Refused } from '../engine.mjs';
import { RECIPIENT, requireCommittedRecipients, tails } from '../recipients.mjs';
import { firstLine, identityPath, identityWorkTree, isPassphraseProtected, nearestExistingAncestor } from './age.mjs';

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

/** The existing identity's state: null when there is none, else whether it is passphrase-protected. */
function existingIdentity(identity) {
  if (!present(identity)) return null;
  if (!isFile(identity)) throw new Refused(a.identityNotFile(identity));
  return { protect: isPassphraseProtected(identity) };
}

/**
 * Every check before anything is written: `{ identity, existing, held, recipients }`.
 * `existing` is null for a new identity, else `{ protect }` (the repo is enrolled).
 */
export function preflight(ctx, { noPassphrase }) {
  const identity = identityPath(ctx.env, ctx.home);
  const existing = existingIdentity(identity);
  const inside = identityWorkTree(identity, ctx.env);
  if (inside) throw new Refused(a.inWorkTree(inside.dir, inside.top));
  const ancestor = nearestExistingAncestor(identity);
  if (!ctx.top || topRel(ctx.root, ctx.top, RECIPIENTS) === null) throw new Refused(messages.secrets.notWorkTree);
  refuseIgnored(ctx);
  const held = heldKeys(ctx);
  const recipients = path.join(ctx.root, RECIPIENTS);
  if (!existing) refuseUnwritable(ancestor);
  refuseUnwritable(nearestExistingAncestor(recipients));
  if (existing?.protect && !ctx.probes.terminal()) throw new Refused(a.protectedNoTerminal);
  if (!existing && !noPassphrase && !ctx.probes.terminal()) throw new Refused(a.passphraseTerminal);
  return { identity, existing, held, recipients };
}

/** Consent, or `--yes`: what init will write, said first. */
async function consent(plan, ctx, { noPassphrase, yes }) {
  const lines = [
    a.willWrite,
    plan.existing ? a.willUse(plan.identity, plan.existing.protect) : a.willIdentity(plan.identity, !noPassphrase),
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
 * The public key of the existing identity at `file`: `age-keygen -y` on the file,
 * or on what `age -d` decrypts into memory when it is passphrase-protected (age
 * prompting on its terminal, uncapped). age-keygen's error is never printed, since
 * it may quote the identity.
 */
function derive(file, protect, ctx) {
  let res;
  if (protect) {
    const dec = ctx.probes.capture('age', ['-d', file], { env: ctx.env, cap: null });
    if (dec.status !== 0) throw new Refused(a.failed('age -d', firstLine(dec.stderr || dec.error?.message)));
    res = ctx.probes.capture('age-keygen', ['-y'], { input: dec.stdout, env: ctx.env });
  } else {
    res = ctx.probes.capture('age-keygen', ['-y', file], { env: ctx.env });
  }
  const keys = res.status === 0 ? res.stdout.split('\n').filter(Boolean) : [];
  if (keys.length !== 1 || !RECIPIENT.test(keys[0])) throw new Refused(a.noDerivedKey(file));
  return keys[0];
}

/** The repo enrolled with the existing identity: its public key appended unless already held. */
function enrol(plan, ctx) {
  const publicKey = derive(plan.identity, plan.existing.protect, ctx);
  if (plan.held.includes(publicKey)) {
    ctx.say(a.alreadyHeld(RECIPIENTS));
    return;
  }
  appendRecipient(plan.recipients, publicKey);
  ctx.say(a.usedIdentity(plan.identity));
  ctx.say(a.wroteRecipients(RECIPIENTS, tails([...plan.held, publicKey])));
  ctx.say(a.commitFirst(RECIPIENTS));
}

/**
 * The identity written at `file`, mode 600: the key itself with `noPassphrase`,
 * else through `age -p -o`, age prompting on its terminal (uncapped). The file is
 * created 600 first so age writes into it and its mode never widens. `wrote.identity`
 * turns true once this call created the file, so a failure removes only its own
 * file, never one another init wrote meanwhile (stage-5 review:whole finding 10).
 */
function writeIdentity(file, key, ctx, noPassphrase, wrote) {
  fs.writeFileSync(file, noPassphrase ? key : '', { mode: 0o600, flag: 'wx' });
  wrote.identity = true;
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
  if (plan.existing) return enrol(plan, ctx);
  const { key, publicKey } = generate(ctx);
  const created = missingDirs(path.dirname(plan.identity));
  fs.mkdirSync(path.dirname(plan.identity), { recursive: true, mode: 0o700 });
  const wrote = { identity: false };
  try {
    writeIdentity(plan.identity, key, ctx, flags.noPassphrase, wrote);
    appendRecipient(plan.recipients, publicKey);
  } catch (err) {
    if (wrote.identity && present(plan.identity)) {
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
