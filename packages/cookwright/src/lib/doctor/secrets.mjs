// src/lib/doctor/secrets.mjs — `secrets.env`: no plaintext env file is tracked, none
// sits at the root, and git ignores the two init protects. Then the three rows of
// stage 5 (plan §4.6), registered last: `secrets.backend`, `secrets.targets` and
// `secrets.carriers`.
//
// Names only: an env file is never opened, so no value can reach the readout. Tracked
// files come from the index repo-wide (cheap at any size); untracked ones from the
// root directory only (never a walk, never node_modules). The patterns are exactly
// `.env` and `.env.*`, the ones init writes to .gitignore; `.envrc` is not one.
//
// The secrets rows never prompt and never read a value (disposition 7): a backend's
// `health` and `inspect` look at files, git and attributes only, with the scrubbed
// environment, inside doctor's budget. A row claims only what it measured
// (disposition 45); a budget spent mid-inspection is a SKIP, never a partial PASS.

import fs from 'node:fs';
import path from 'node:path';

import { TimedOut } from '../budget.mjs';
import { messages } from '../messages.mjs';
import { BACKENDS } from '../secret/backends/index.mjs';
import { SECRETS_DIR, pointerNames, topRel } from '../secret/config.mjs';
import { helperEnv, scrubNames } from '../secret/engine.mjs';
import { FAIL, PASS, SKIP, WARN, fail, pass, skip, warn } from '../verdict.mjs';
import { gitRun } from './repo.mjs';

const m = messages.doctor;
const b = m.secretsBackend;
const t = m.secretsTargets;
const c = m.secretsCarriers;

const ENV_NAME = /^\.env(\..+)?$/;
const EXEMPT = new Set(['.env.example', '.env.sample', '.env.template']);
/** The paths init makes git ignore, each probed on its own. */
export const PROTECTED = Object.freeze(['.env', '.env.local']);

/** A plaintext env file by name: `.env` or `.env.*`, minus the example files. */
export const isEnvFile = (p) => {
  const base = path.posix.basename(p);
  return ENV_NAME.test(base) && !EXEMPT.has(base);
};

function trackedEnvFiles(root) {
  const out = gitRun(root, ['ls-files', '-z', '--', '.env', '*/.env', '.env.*', '*/.env.*']);
  if (out.status !== 0) throw new Error(messages.probeFailed('git ls-files', out.stderr.trim()));
  return out.stdout.split('\0').filter(Boolean).filter(isEnvFile);
}

export function checkSecrets(repo, probes) {
  if (!repo.workTree) return skip(m.secrets.notWorkTree);
  const tracked = trackedEnvFiles(repo.root);
  const untracked = probes
    .rootFiles(repo.root)
    .filter((n) => isEnvFile(n) && !tracked.includes(n))
    .sort();
  const notIgnored = PROTECTED.filter((p) => !probes.ignored(repo.root, p));
  const notes = [
    tracked.length && m.secrets.tracked(tracked),
    untracked.length && m.secrets.untracked(untracked),
    notIgnored.length && m.secrets.notIgnored(notIgnored),
  ].filter(Boolean);
  if (tracked.length) return fail(notes.join('; '));
  return notes.length ? warn(notes.join('; ')) : pass(m.secrets.ok);
}

const RANK = { [FAIL]: 0, [WARN]: 1, [SKIP]: 2, [PASS]: 3 };

/** The worst of `parts` with every part's note, joined by `; `. */
const worst = (parts) => ({
  status: parts.reduce((w, p) => (RANK[p.status] < RANK[w] ? p.status : w), PASS),
  note: parts.map((p) => p.note).join('; '),
});

/** The backend context doctor hands a backend: the scrubbed environment, never a prompt. */
const doctorCtx = (repo, probes) => ({
  root: repo.root,
  top: repo.top,
  config: repo.config,
  probes,
  env: helperEnv(repo.env, scrubNames(repo.config)),
  home: repo.home,
  platform: repo.platform,
});

/**
 * `secrets.backend` (disposition 17, 58): no `secrets` key is Level 2 off, a measured
 * fact; a wrong platform or a tool an operation needs is a SKIP naming it; then the
 * backend's own health.
 */
export function checkSecretsBackend(repo, probes) {
  const secrets = repo.config.secrets;
  if (!secrets) return pass(b.none);
  const backend = BACKENDS[secrets.backend];
  if (backend.platforms && !backend.platforms.includes(repo.platform)) return skip(b.platform(backend.name));
  const PATH = repo.env.PATH ?? '';
  for (const op of ['resolve', 'set', 'inspect']) {
    const tool = (backend.tools[op] ?? []).find((name) => !probes.hasTool(name, { PATH }));
    if (tool) return skip(b.needsTool(tool, b.ops[op], backend.install));
  }
  return backend.health(doctorCtx(repo, probes));
}

/** `secrets.backend`'s verdict as the registry would print it, for the targets row to follow. */
function backendRow(repo, probes) {
  try {
    return checkSecretsBackend(repo, probes);
  } catch (err) {
    if (err instanceof TimedOut) return skip(m.checkTimedOut(messages.timedOut(err.what)));
    return fail(m.checkThrew(String(err?.message ?? err).split('\n')[0]));
  }
}

/**
 * A FAIL for each secrets path git ignores (disposition 42), naming the rule to
 * remove: the directory alone when it is ignored, since every file under it follows.
 */
function ignoredParts(repo, probes, rels) {
  const ruleOf = (rel) => probes.ignoredBy(repo.top, topRel(repo.root, repo.top, rel) + (rel.endsWith('/') ? '/' : ''));
  const dir = ruleOf(`${SECRETS_DIR}/`);
  if (dir) return [fail(t.ignored(`${SECRETS_DIR}/`, dir))];
  return rels.flatMap((rel) => {
    const rule = ruleOf(rel);
    return rule ? [fail(t.ignored(rel, rule))] : [];
  });
}

/**
 * Each of `rels` (relative to the config root) as `missing`, `untracked`, `changed`
 * (differs from HEAD in the index or the work tree) or `tracked`: two git calls from
 * the top, top-relative paths (disposition 54).
 */
function fileStates(repo, rels) {
  const pairs = rels.map((rel) => [rel, topRel(repo.root, repo.top, rel)]);
  const run = (args) => {
    const res = gitRun(repo.top, ['--literal-pathspecs', ...args, '--', ...pairs.map(([, at]) => at)]);
    if (res.status !== 0) throw new Error(messages.probeFailed(`git ${args[0]}`, res.stderr.trim()));
    return new Set(res.stdout.split('\0'));
  };
  const inIndex = run(['ls-files', '-z']);
  const changed = new Set([...run(['status', '--porcelain', '-z', '--untracked-files=all'])].map((e) => e.slice(3)));
  const state = (rel, at) => {
    if (!fs.existsSync(path.join(repo.root, rel))) return 'missing';
    if (!inIndex.has(at)) return 'untracked';
    return changed.has(at) ? 'changed' : 'tracked';
  };
  return new Map(pairs.map(([rel, at]) => [rel, state(rel, at)]));
}

/** Every part of the targets row: the ignore rules, what the targets share, then each target. */
function targetParts(repo, probes, names) {
  const backend = BACKENDS[repo.config.secrets.backend];
  const rels = [...(backend.sharedFiles ?? []), ...names.flatMap((n) => backend.files(n))];
  if (rels.length && !repo.workTree) return [skip(m.secrets.notWorkTree)];
  const ignored = rels.length ? ignoredParts(repo, probes, rels) : [];
  if (ignored.length) return ignored;
  const ctx = { ...doctorCtx(repo, probes), states: rels.length ? fileStates(repo, rels) : new Map() };
  ctx.shared = backend.inspectShared?.(ctx) ?? { parts: [], ok: true };
  const unproved = (n) => (repo.config.secrets.targets[n].proof ? [] : [warn(t.unproved(n))]);
  return [...ctx.shared.parts, ...names.flatMap((n) => [backend.inspect(n, ctx), ...unproved(n)])];
}

/**
 * `secrets.targets` (dispositions 42, 44, 45, 58): no `secrets` key, no targets; an
 * empty `targets` is a chosen state, WARN; the backend row SKIP or FAIL is a SKIP
 * with its reason; then the ignore rules and each target through its backend.
 */
export function checkSecretsTargets(repo, probes) {
  const secrets = repo.config.secrets;
  if (!secrets) return pass(t.none);
  const names = Object.keys(secrets.targets);
  if (names.length === 0) return warn(t.empty);
  const row = backendRow(repo, probes);
  if (row.status === SKIP || row.status === FAIL) return skip(t.follows(row.status, row.note));
  try {
    return worst(targetParts(repo, probes, names));
  } catch (err) {
    if (err instanceof TimedOut) return skip(t.timedOut(err.what));
    throw err;
  }
}

/** The shell rc files `secrets.carriers` reads, under the home directory. */
export const RC_FILES = Object.freeze(['.zshenv', '.zshrc', '.zprofile', '.bashrc', '.bash_profile', '.profile']);
/** The most of an rc file read: a bounded read, never the whole of an odd file. */
const RC_CAP = 256 * 1024;
const ASSIGNMENT = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/;

/** The first RC_CAP bytes of `file` as text, or '' when it is absent or unreadable. */
function readCapped(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(RC_CAP);
    return buf.subarray(0, fs.readSync(fd, buf, 0, RC_CAP, 0)).toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** `[name, '~/<file>']` for each line of an rc file that sets one of `names` (comments skipped). */
function rcHits(home, names) {
  return RC_FILES.flatMap((file) =>
    readCapped(path.join(home, file))
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => !line.startsWith('#'))
      .map((line) => ASSIGNMENT.exec(line)?.[1])
      .filter((name) => name && names.includes(name))
      .map((name) => [name, `~/${file}`]),
  );
}

/**
 * The directories whose `.envrc` direnv can load for a command run at the config
 * root, top-relative: the work tree's top, each directory down to the root, the root
 * last (`''` is the top). Outside a work tree, `null`: the root is looked at alone.
 */
function envrcDirs(repo) {
  if (!repo.workTree || !repo.top) return null;
  if (repo.root === repo.top) return [''];
  const rel = topRel(repo.root, repo.top, '.');
  if (rel === null) return null;
  const parts = rel.split('/');
  return ['', ...parts.map((_, i) => parts.slice(0, i + 1).join('/'))];
}

/** The `.envrc` of a top-relative directory (`''` is the top). */
const envrcAt = (dir) => (dir ? `${dir}/.envrc` : '.envrc');

/** Tracked `.envrc` files, top-relative: in each of `dirs`, and anywhere under the root. */
function trackedEnvrc(repo, dirs) {
  const under = envrcAt(dirs.at(-1)).replace(/\.envrc$/, '*/.envrc');
  const specs = [...dirs.map((dir) => `:(literal)${envrcAt(dir)}`), under];
  const out = gitRun(repo.top, ['ls-files', '-z', '--', ...specs]);
  if (out.status !== 0) throw new Error(messages.probeFailed('git ls-files', out.stderr.trim()));
  return out.stdout.split('\0').filter(Boolean);
}

/**
 * The `.envrc` parts (finding 1 of review:surface): tracked at the work tree's top,
 * in a directory above the config root or anywhere under it; untracked at the top,
 * above the root or at the root. Paths are top-relative.
 */
function envrcParts(repo, probes) {
  const dirs = envrcDirs(repo);
  if (!dirs) return probes.rootFiles(repo.root).includes('.envrc') ? [c.envrcRoot] : [];
  const root = dirs.at(-1);
  const tracked = trackedEnvrc(repo, dirs);
  const loose = dirs.filter(
    (dir) => !tracked.includes(envrcAt(dir)) && probes.rootFiles(path.join(repo.top, dir)).includes('.envrc'),
  );
  const atRoot = loose.includes(root);
  const above = loose.filter((dir) => dir !== root).map(envrcAt);
  return [tracked.length && c.envrcTracked(tracked), above.length && c.envrcAbove(above), atRoot && c.envrcRoot].filter(Boolean);
}

/**
 * `secrets.carriers` (dispositions 11, 29; E-015): a place that carries a secret
 * into every process, by name: an `.envrc`, a declared or ambient name exported in
 * doctor's own environment, a line setting one in a shell rc file. A pack's pointer
 * names (`PGHOST`, `PGUSER`) hold no secret and `run` never injects them, so they
 * are left out (stage-5 review:whole finding 7). Names and file names only, never
 * a value. Without a config, only `.envrc`.
 */
export function checkSecretsCarriers(repo, probes) {
  const pointers = new Set(repo.config ? pointerNames(repo.config) : []);
  const names = repo.config ? scrubNames(repo.config).filter((n) => !pointers.has(n)) : [];
  const exported = names.filter((n) => Object.hasOwn(repo.env, n));
  const hits = names.length ? rcHits(repo.home, names) : [];
  const parts = [...envrcParts(repo, probes), exported.length && c.exported(exported), hits.length && c.rcLine(hits)];
  const found = parts.filter(Boolean);
  return found.length ? warn(found.join('; ')) : pass(c.ok);
}
