// src/lib/secret/engine.mjs — `run`'s engine (stage-5 plan §4.2): the target's
// values resolved by its backend with a scrubbed environment, proved, checked
// against the child's command line, then injected into one child whose output goes
// through the redactor.
//
// Two environments (disposition 50). Every helper (the backend's tool) runs with the
// inherited environment minus every declared name of every target and every ambient
// name of the declared packs. The child additionally loses the backend's control
// names, libpq's names when a value is a postgres URL (stage-5 review:model finding
// 5) and any variable whose value equals a resolved value, then receives the
// target's values. Every removed name is on the banner; cookwright's own
// `process.env` is never changed, and the values live in one Map until the spawn.
//
// A refusal before the spawn is a `Refused`, exit 125 (dispositions 34, 47), so a
// wrapper tells "cookwright refused" from "the child returned 1"; a command that
// cannot be started is 127, a child ended by a signal 128 + its number
// (disposition 13). SIGINT is ignored while the child runs (the terminal delivers
// it to the child); SIGTERM and SIGHUP are forwarded to it (disposition 66). `run`
// returns only once the child has exited and both its output pipes have closed
// (disposition 59).

import fs from 'node:fs';
import os from 'node:os';

import { TimedOut } from '../budget.mjs';
import { CONFIG_FILE } from '../config.mjs';
import { gitRun } from '../doctor/repo.mjs';
import { messages } from '../messages.mjs';
import { LIBPQ_NAMES, ambientNames, controlNames, declaredNames, pointerNames, targetOf, topRel } from './config.mjs';
import { isPostgresUrl, proofKinds, prove } from './proofs.mjs';
import { Redactor, needles } from './redact.mjs';

const m = messages.secrets;
const r = messages.run;

export const REFUSED_EXIT = 125;
export const NOT_STARTED_EXIT = 127;

/** A product refusal before anything is spawned or written: `run: …` or `secrets: …`, exit 125. */
export class Refused extends Error {}

/** libpq's names that hold a secret rather than point at a file, a service or a host. */
const LIBPQ_SECRETS = ['PGPASSWORD'];

/**
 * `openConfig`'s result with the config root as a real path, as git names the top:
 * a top-relative path (topRel) is computed between the two, so both must be real
 * (a temp or home directory reached through a symlink).
 */
export function realRoot(opened) {
  return { ...opened, root: fs.realpathSync(opened.root) };
}

/** The backend `config` declares, on this platform, with every tool `op` needs on PATH; refuses otherwise. */
export function openBackend(config, { backends, probes, platform, env }, op) {
  if (!config.secrets) throw new Refused(m.none);
  const name = config.secrets.backend;
  const backend = Object.hasOwn(backends, name) ? backends[name] : null;
  if (!backend) throw new Refused(m.noBackend(name));
  if (backend.platforms && !backend.platforms.includes(platform)) throw new Refused(m.platform(name, backend.platforms));
  const missing = (backend.tools[op] ?? []).find((tool) => !probes.hasTool(tool, { PATH: env.PATH ?? '' }));
  if (missing) throw new Refused(m.needsTool(missing, backend.install));
  return backend;
}

/** The declared target `name`, or a refusal naming the declared ones. */
export function openTarget(config, name) {
  if (!config.secrets) throw new Refused(m.none);
  const target = targetOf(config, name);
  if (!target) throw new Refused(m.unknownTarget(name, Object.keys(config.secrets.targets)));
  return target;
}

/** The names no helper receives: every declared name of every target, every ambient name. */
export const scrubNames = (config) => [...new Set([...declaredNames(config), ...ambientNames(config)])];

/** `env` without `names`: the environment every helper runs with. */
export function helperEnv(env, names) {
  const out = { ...env };
  for (const name of names) delete out[name];
  return out;
}

/**
 * The child's environment: `env` without `drop`, libpq's names when a value is a
 * postgres URL, and any variable whose value equals a resolved one, then `values`
 * added. `dropped` names, sorted, every inherited variable removed or replaced.
 */
export function childEnv(env, drop, values) {
  const libpq = [...values.values()].some(isPostgresUrl) ? LIBPQ_NAMES : [];
  const gone = new Set([...drop, ...libpq, ...values.keys()]);
  const resolved = new Set(values.values());
  const out = {};
  const dropped = [];
  for (const [name, value] of Object.entries(env)) {
    if (gone.has(name) || resolved.has(value)) dropped.push(name);
    else out[name] = value;
  }
  for (const [name, value] of values) out[name] = value;
  return { env: out, dropped: dropped.sort(), libpq };
}

/**
 * The inherited values that are needles beside the resolved ones (dispositions 22,
 * 68): those of every declared and ambient name (and libpq's, when dropped), as
 * `[name, value]`, minus the names whose value is a file, a service or a host, and
 * minus the local Supabase stack's public default (publicLocal). Any other
 * loopback URL, a tunnel to production on localhost among them, stays a needle
 * (disposition 43; stage-5 review:engine findings 3 and 6).
 */
export function inheritedValues(env, config, libpq) {
  const pointers = new Set([...pointerNames(config), ...libpq.filter((n) => !LIBPQ_SECRETS.includes(n))]);
  const names = new Set([...declaredNames(config), ...ambientNames(config), ...libpq]);
  const needle = (n) => !pointers.has(n) && typeof env[n] === 'string' && !publicLocal(n, env[n]);
  return [...names].filter(needle).map((n) => [n, env[n]]);
}

/** The local Supabase stack's password, public in every copy of the stack (disposition 43). */
export const LOCAL_STACK_PASSWORD = 'postgres';

/**
 * True when the inherited `value` of `name` is the local stack's public default:
 * a URL on a loopback host whose password is `postgres`, or `PGPASSWORD=postgres`.
 */
export function publicLocal(name, value) {
  if (LIBPQ_SECRETS.includes(name)) return value === LOCAL_STACK_PASSWORD;
  return loopbackUrl(value) && urlPasswordOf(value) === LOCAL_STACK_PASSWORD;
}

const AUTHORITY = /^[a-z][a-z0-9+.-]*:\/\/([^/?#\s]*)/i;

/** True when `value` is a `<scheme>://…` URL whose host, after the last `@`, is a loopback host. */
export function loopbackUrl(value) {
  const authority = AUTHORITY.exec(value)?.[1];
  if (!authority) return false;
  const host = authority.slice(authority.lastIndexOf('@') + 1);
  return host !== '' && isLoopback(host);
}

/** The percent-decoded password of a `<scheme>://user:password@host` value, or null. */
function urlPasswordOf(value) {
  const authority = AUTHORITY.exec(value)?.[1] ?? '';
  const userinfo = authority.slice(0, Math.max(authority.lastIndexOf('@'), 0));
  const colon = userinfo.indexOf(':');
  if (colon < 0) return null;
  try {
    return decodeURIComponent(userinfo.slice(colon + 1));
  } catch {
    return null;
  }
}

const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const LOOPBACK = new RegExp(`^(?:localhost|host\\.docker\\.internal|\\[::1\\]|127(?:\\.${OCTET}){3})(?::\\d+)?$`, 'i');

/**
 * True for a loopback authority, read whole (disposition 43; stage-5 review:whole
 * finding 1): exactly `localhost`, `host.docker.internal`, a valid 127/8 address
 * or `[::1]`, optionally followed by a numeric port. Anything else, a suffix after
 * `]` or an octet above 255 among it, is not loopback.
 */
export function isLoopback(hostport) {
  return LOOPBACK.test(hostport);
}

/** True when `arg` holds `<scheme>://<user>:<password>@<host>` with a non-loopback host. */
export function passwordUrl(arg) {
  for (const found of arg.matchAll(/[a-z][a-z0-9+.-]*:\/\//gi)) {
    const authority = arg.slice(found.index + found[0].length).split(/[/?#\s]/)[0];
    const at = authority.lastIndexOf('@');
    const colon = authority.slice(0, Math.max(at, 0)).indexOf(':');
    if (at < 0 || colon < 0 || colon === at - 1) continue;
    if (!isLoopback(authority.slice(at + 1))) return true;
  }
  return false;
}

/**
 * Refuse a child command line that holds a needle (a value, or a form of one) or a
 * URL with a password (dispositions 21, 22, 43), naming the argument's position
 * (the command is argument 1) and the name, never the argument.
 */
export function argvCheck(argv, list) {
  for (const [i, arg] of argv.entries()) {
    const bytes = Buffer.from(arg);
    const hit = list.find(([needle]) => bytes.includes(needle));
    if (hit) throw new Refused(r.argValue(i + 1, hit[1].toString().slice(1, -1)));
    if (passwordUrl(arg)) throw new Refused(r.argUrl(i + 1));
  }
}

/**
 * The files of `rels` (relative to the config root) that differ from HEAD or are
 * untracked (disposition 49), from one `git status` at the top, top-relative paths
 * (disposition 54); [] outside a work tree, null when git fails.
 */
export function uncommittedFiles(root, top, rels) {
  if (!top) return [];
  const pairs = rels.map((rel) => [rel, topRel(root, top, rel)]).filter(([, t]) => t !== null);
  const args = ['--literal-pathspecs', 'status', '--porcelain', '-z', '--untracked-files=all', '--', ...pairs.map(([, t]) => t)];
  const res = gitRun(top, args);
  if (res.status !== 0) return null;
  const changed = new Set(res.stdout.split('\0').map((entry) => entry.slice(3)));
  return pairs.filter(([, t]) => changed.has(t)).map(([rel]) => rel);
}

/** The banner (disposition 13, plan §4.2 step 6): what was injected, proved, dropped and uncommitted. */
export function banner({ target, names, proof, dropped, uncommitted, extra = [] }) {
  const unproved = names.filter((n) => !proof.proved.includes(n));
  return r.banner(
    [
      r.head(target),
      r.injected(names),
      proof.proved.length > 0 && r.proved(proof.proved, proof.against, proof.kind),
      unproved.length > 0 && r.unproved(unproved),
      dropped.length > 0 && r.dropped(dropped),
      uncommitted === null ? r.uncommittedUnknown : uncommitted.length > 0 && r.uncommitted(uncommitted),
      ...extra,
      r.piped,
    ].filter(Boolean),
  );
}

/** The resolved values, every declared name present and non-empty, in the target's order. */
async function resolveValues(backend, name, target, ctx) {
  const got = await backend.resolve(name, ctx);
  const values = new Map();
  for (const n of target.names) {
    if (typeof got.get(n) !== 'string' || got.get(n) === '') throw new Refused(m.missingName(n, name));
    values.set(n, got.get(n));
  }
  return values;
}

/**
 * Everything before the spawn (plan §4.2 steps 2 to 5): the target and its backend,
 * the values, the proof, the child's environment, the needles, the argv check and
 * the banner. Refuses with a `Refused`, nothing spawned.
 */
export async function prepareRun({ root, top, config }, name, child, io) {
  const target = openTarget(config, name);
  const backend = openBackend(config, io, 'resolve');
  const scrubbed = helperEnv(io.env, scrubNames(config));
  const ctx = { root, top, config, probes: io.probes, env: scrubbed, home: io.home };
  const values = await resolveValues(backend, name, target, ctx);
  const proof = prove(values, target.proof, proofKinds(config), target.names);
  if (!proof.ok) throw new Refused(m.proof.failed(proof));
  const drop = [...scrubNames(config), ...controlNames(backend, io.env)];
  const { env, dropped, libpq } = childEnv(io.env, drop, values);
  const list = needles(values, inheritedValues(io.env, config, libpq));
  argvCheck(child, list);
  const uncommitted = uncommittedFiles(root, top, [CONFIG_FILE, ...backend.files(name)]);
  const extra = backend.bannerParts?.(name, config) ?? [];
  return { env, list, banner: banner({ target: name, names: target.names, proof, dropped, uncommitted, extra }) };
}

/**
 * `src` through a fresh Redactor into `dest`, with backpressure, never ending
 * `dest` (the process's own stream). Resolves when the redactor has ended, or when
 * `dest` fails (a closed pipe downstream): then the child's pipe is closed, so the
 * child meets a closed pipe as it would in a shell pipeline.
 */
function redacted(src, list, dest) {
  return new Promise((resolve) => {
    const redactor = new Redactor(list);
    const stop = () => {
      src.destroy();
      redactor.destroy();
      resolve();
    };
    dest.once('error', stop);
    redactor.on('end', () => {
      dest.off('error', stop);
      resolve();
    });
    src.pipe(redactor).pipe(dest, { end: false });
  });
}

/** The exit code of a child that closed with `code` or `signal`. */
const exitOf = (code, signal) => (signal ? 128 + (os.constants.signals[signal] ?? 0) : code);

/**
 * Spawn `cmd args…` with `env` (stdin inherited, both outputs through the
 * redactor) and resolve its exit code once it has exited and both pipes have closed.
 */
export function runChild(spawnChild, [cmd, ...args], { env, cwd, list, stdout, stderr }) {
  const child = spawnChild(cmd, args, { env, cwd, stdio: ['inherit', 'pipe', 'pipe'] });
  const forward = (signal) => () => child.kill(signal);
  const handlers = { SIGINT: () => {}, SIGTERM: forward('SIGTERM'), SIGHUP: forward('SIGHUP') };
  for (const [signal, handler] of Object.entries(handlers)) process.on(signal, handler);
  let failed = null;
  child.on('error', (err) => {
    failed = err;
  });
  const closed = new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));
  const pipes = [redacted(child.stdout, list, stdout), redacted(child.stderr, list, stderr)];
  return Promise.all([closed, ...pipes]).then(([{ code, signal }]) => {
    for (const [sig, handler] of Object.entries(handlers)) process.off(sig, handler);
    if (failed && child.pid === undefined) {
      stderr.write(`${r.refused(r.notStarted(cmd, failed.code ?? failed.message))}\n`);
      return NOT_STARTED_EXIT;
    }
    return exitOf(code, signal);
  });
}

/** `run <name> -- <child…>`: the banner on stderr, then the child's exit code. */
export async function runTarget(opened, name, child, io) {
  let prepared;
  try {
    prepared = await prepareRun(opened, name, child, io);
  } catch (err) {
    if (err instanceof TimedOut) throw new Refused(m.timedOut(err.what));
    throw err;
  }
  io.stderr.write(`${prepared.banner}\n`);
  return runChild(io.probes.spawnChild, child, { ...prepared, cwd: io.cwd, stdout: io.stdout, stderr: io.stderr });
}
