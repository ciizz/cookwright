// src/lib/config.mjs — cookwright.json: where it is, what it may say, what it means.
//
// The config is the ONLY place a user repo tells the harness about itself: where the
// state homes live, which host runs the agent, which commands make up the gate.
// Everything the lifted scripts hardcoded is a key here, and the repo declares its
// level (levels.mjs), which doctor measures.
//
// Validation is by hand (a handful of keys, no dependency). The JSON Schema under
// schema/ is the editor-facing twin; a test keeps the two in step. The loader's
// messages live here, not in messages.mjs: messages.mjs imports this file, so the
// reverse import would close a cycle.

import fs from 'node:fs';
import path from 'node:path';

import { TimedOut, runBounded } from './budget.mjs';
import { KNOWN_HOSTS } from './hosts.mjs';
import { KNOWN_LEVELS } from './levels.mjs';
import { MIGRATIONS } from './migrations.mjs';

export const CONFIG_FILE = 'cookwright.json';
export const CONFIG_VERSION = 2;

export const DEFAULTS = Object.freeze({
  version: CONFIG_VERSION,
  level: 0,
  hosts: ['claude'],
  baseBranch: 'main',
  paths: {
    bundles: 'docs/bundles',
    closeouts: 'docs/closeouts',
    backlog: 'docs/backlog.md',
    changelog: 'CHANGELOG.md',
  },
  gate: { checks: [], flakes: {} },
  hooks: { docSync: [] },
});

/** Paths with no default: absent means the package's own (the playbook, hosts.mjs). */
export const OPTIONAL_PATHS = Object.freeze(['playbook']);

/** Every key the validator knows, per object — the schema test compares these. */
export const KNOWN_KEYS = Object.freeze({
  top: ['$schema', 'version', 'level', 'hosts', 'baseBranch', 'paths', 'gate', 'hooks', 'ci'],
  paths: ['bundles', 'closeouts', 'backlog', 'playbook', 'changelog'],
  gate: ['checks', 'flakes'],
  check: ['name', 'run', 'needs'],
  hooks: ['docSync'],
  docSyncRule: ['name', 'code', 'docs'],
  ci: ['workflow'],
});

/** git's long pathspec magic words (gitglossary); `attr` may carry `:<spec>`. */
export const PATHSPEC_MAGIC = Object.freeze(['top', 'literal', 'icase', 'glob', 'attr', 'exclude']);

/**
 * The git work tree's top directory containing `cwd`, or null (not a work tree, no
 * git). Bounded by the shared budget (budget.mjs); a stalled git throws TimedOut.
 */
export function workTreeRoot(cwd = process.cwd()) {
  const out = runBounded('git', ['rev-parse', '--show-toplevel'], { cwd });
  if (out.timedOut) throw new TimedOut('git rev-parse');
  return out.status === 0 ? out.stdout.trim() : null;
}

const real = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

/**
 * The nearest directory at or above `cwd` holding cookwright.json, or null. With
 * `stopAt` (the work tree's top), the walk never climbs past it: a config in an
 * enclosing directory or an enclosing repo is not this repo's.
 */
export function findRoot(cwd = process.cwd(), { stopAt } = {}) {
  const stop = stopAt ? real(stopAt) : null;
  let dir = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(dir, CONFIG_FILE))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir || (stop && real(dir) === stop)) return null;
    dir = parent;
  }
}

/** The loader's error for `problems`, one per line under the file's name. */
export const invalidConfig = (problems) => new Error(`${CONFIG_FILE}:\n  ${problems.join('\n  ')}`);

/** The refusal for a config written by a newer cookwright. */
export const newerVersion = (version) =>
  `${CONFIG_FILE}: version ${version} is newer than this cookwright's ${CONFIG_VERSION}: update cookwright (npm install cookwright@latest)`;

/** The migration context for the config root `root`: is anything at `rel`, a dangling link included. */
export function migrationContext(root) {
  return {
    exists: (rel) => {
      try {
        fs.lstatSync(path.join(root, rel));
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * `raw` carried to CONFIG_VERSION through `migrations`, as `{ raw, steps }` with one
 * `{ from, to, outcome, detail }` per step; null when there is nothing to run (the
 * current version, or a version the chain does not start from: the validator names
 * it). A newer version throws its refusal. `raw` itself is never changed.
 */
export function applyMigrations(raw, ctx, migrations = MIGRATIONS) {
  const from = raw.version;
  if (Number.isInteger(from) && from > CONFIG_VERSION) throw new Error(newerVersion(from));
  if (!Number.isInteger(from) || from >= CONFIG_VERSION) return null;
  for (let v = from; v < CONFIG_VERSION; v += 1) if (!Object.hasOwn(migrations, v)) return null;
  let current = raw;
  const steps = [];
  for (let v = from; v < CONFIG_VERSION; v += 1) {
    const { raw: next, outcome, detail } = migrations[v](current, ctx);
    current = { ...next, version: v + 1 }; // an existing key keeps its place
    steps.push({ from: v, to: v + 1, outcome, detail });
  }
  return { raw: current, steps };
}

/**
 * Read, migrate, default and validate the config at `root`; throws one message per
 * load. An older version is migrated in memory and loads, with `migratedFrom` set,
 * so no user is ever blocked by a version bump; only `cookwright migrate` writes it.
 */
export function loadConfig(root, { migrations = MIGRATIONS } = {}) {
  const file = path.join(root, CONFIG_FILE);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${CONFIG_FILE}: ${err.code === 'ENOENT' ? 'not found' : err.message}`);
  }
  if (!isObj(raw)) throw new Error(`${CONFIG_FILE}: must be a JSON object`);
  const migrated = applyMigrations(raw, migrationContext(root), migrations);
  const config = withDefaults(migrated ? migrated.raw : raw);
  const problems = validateConfig(config);
  if (problems.length) throw invalidConfig(problems);
  if (migrated) config.migratedFrom = raw.version;
  return config;
}

const isStr = (v) => typeof v === 'string' && v.length > 0;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A path with its trailing slashes removed, so `docs/x/` and `docs/x` are one path. */
const trimSlash = (p) => (typeof p === 'string' ? p.replace(/\/+$/, '') : p);

/**
 * `raw[key]` over its defaults when it is absent or an object; any other value (a
 * string, a list, null) is kept as it is, so the validator refuses it rather than
 * a default hiding it.
 */
function nested(raw, key) {
  const v = raw?.[key];
  if (v === undefined) return { ...DEFAULTS[key] };
  return isObj(v) ? { ...DEFAULTS[key], ...v } : v;
}

/**
 * Defaults applied one level deep: an absent `paths.x`, `gate.x` or `hooks.x` gets its default.
 * `version` is never defaulted — a config must say which format it speaks.
 */
export function withDefaults(raw) {
  const paths = nested(raw, 'paths');
  if (isObj(paths)) for (const k of Object.keys(paths)) paths[k] = trimSlash(paths[k]);
  return {
    ...DEFAULTS,
    ...raw,
    version: raw?.version,
    paths,
    gate: nested(raw, 'gate'),
    hooks: nested(raw, 'hooks'),
  };
}

function unknownKeys(obj, known, where) {
  return Object.keys(obj)
    .filter((k) => !known.includes(k))
    .map((k) => `${where}: unknown key "${k}"`);
}

/** Every problem with a defaulted config, as one line each; empty when valid. */
export function validateConfig(config) {
  if (!isObj(config)) return ['the config must be a JSON object'];
  return [
    ...unknownKeys(config, KNOWN_KEYS.top, 'top level'),
    ...validateTop(config),
    ...validatePaths(config.paths),
    ...validateGate(config.gate),
    ...validateHooks(config.hooks),
    ...validateCi(config.ci),
  ];
}

function validateTop({ $schema, version, level, hosts, baseBranch }) {
  const out = [];
  if ($schema !== undefined && !isStr($schema)) out.push('$schema must be a string');
  if (version !== CONFIG_VERSION) out.push(`version must be ${CONFIG_VERSION}`);
  if (!Number.isInteger(level) || !KNOWN_LEVELS.includes(level)) {
    out.push(`level must be one of ${KNOWN_LEVELS.join(', ')} in this version of cookwright`);
  }
  if (!Array.isArray(hosts) || hosts.length === 0) out.push('hosts must be a non-empty list');
  else {
    for (const h of hosts) {
      if (!KNOWN_HOSTS.includes(h)) {
        out.push(
          `hosts: host "${h}" is not available in this version of cookwright (known: ${KNOWN_HOSTS.join(', ')})`,
        );
      }
    }
    if (new Set(hosts).size !== hosts.length) out.push('hosts: each host once');
  }
  if (!isStr(baseBranch)) out.push('baseBranch must be a non-empty string');
  return out;
}

/** A root-relative path inside the repo: no leading slash, no `..` or `.` segment, forward slashes. */
const isRelPath = (p) =>
  isStr(p) &&
  !p.startsWith('/') &&
  !p.includes('\\') &&
  p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');

/** `a` is `b` or inside it. */
const within = (a, b) => a === b || a.startsWith(`${b}/`);

function validatePaths(paths) {
  if (!isObj(paths)) return ['paths must be an object'];
  const out = unknownKeys(paths, KNOWN_KEYS.paths, 'paths');
  for (const key of KNOWN_KEYS.paths) {
    if (OPTIONAL_PATHS.includes(key) && paths[key] === undefined) continue;
    if (!isRelPath(paths[key])) out.push(`paths.${key} must be a root-relative path inside the repo`);
  }
  // No two paths may nest or coincide: the gate ignores dirt under `bundles`, so a
  // closeout or backlog inside it would be gated over while uncommitted; a
  // changelog or playbook (code) inside a state home would count as non-code; and
  // init would schedule a directory and a file at one path.
  const homes = KNOWN_KEYS.paths.filter((k) => isRelPath(paths[k]));
  for (const a of homes) {
    for (const b of homes) {
      if (a < b && (within(paths[a], paths[b]) || within(paths[b], paths[a]))) {
        out.push(`paths.${a} and paths.${b} overlap (${paths[a]}, ${paths[b]})`);
      }
    }
  }
  return out;
}

function validateGate(gate) {
  if (!isObj(gate)) return ['gate must be an object'];
  const out = unknownKeys(gate, KNOWN_KEYS.gate, 'gate');
  if (!Array.isArray(gate.checks)) out.push('gate.checks must be a list');
  else {
    const names = new Set();
    gate.checks.forEach((c, i) => {
      out.push(...validateCheck(c, i));
      if (isStr(c?.name) && names.has(c.name)) out.push(`gate.checks[${i}]: duplicate name "${c.name}"`);
      if (isStr(c?.name)) names.add(c.name);
    });
  }
  if (!isObj(gate.flakes) || Object.values(gate.flakes).some((v) => !isStr(v))) {
    out.push('gate.flakes must map a flake id to a description');
  }
  return out;
}

function validateCheck(check, i) {
  const where = `gate.checks[${i}]`;
  if (!isObj(check)) return [`${where} must be an object`];
  const out = unknownKeys(check, KNOWN_KEYS.check, where);
  if (!isStr(check.name)) out.push(`${where}.name must be a non-empty string`);
  if (!isStr(check.run)) out.push(`${where}.run must be a non-empty command string`);
  if (check.needs !== undefined && (!Array.isArray(check.needs) || !check.needs.every(isStr))) {
    out.push(`${where}.needs must be a list of executable names`);
  }
  return out;
}

function validateHooks(hooks) {
  if (!isObj(hooks)) return ['hooks must be an object'];
  const out = unknownKeys(hooks, KNOWN_KEYS.hooks, 'hooks');
  if (!Array.isArray(hooks.docSync)) return [...out, 'hooks.docSync must be a list'];
  const names = new Set();
  hooks.docSync.forEach((rule, i) => {
    out.push(...validateDocSyncRule(rule, i));
    if (isStr(rule?.name) && names.has(rule.name)) out.push(`hooks.docSync[${i}]: duplicate name "${rule.name}"`);
    if (isStr(rule?.name)) names.add(rule.name);
  });
  return out;
}

function validateDocSyncRule(rule, i) {
  const where = `hooks.docSync[${i}]`;
  if (!isObj(rule)) return [`${where} must be an object`];
  const out = unknownKeys(rule, KNOWN_KEYS.docSyncRule, where);
  if (!isStr(rule.name)) out.push(`${where}.name must be a non-empty string`);
  for (const key of ['code', 'docs']) out.push(...validatePathspecs(rule[key], `${where}.${key}`));
  return out;
}

function validatePathspecs(list, where) {
  if (!Array.isArray(list) || list.length === 0) return [`${where} must be a non-empty list of git pathspecs`];
  const out = [];
  list.forEach((spec, j) => {
    if (!isStr(spec)) out.push(`${where}[${j}] must be a non-empty string`);
    else {
      const bad = unknownMagic(spec);
      if (bad !== null) out.push(`${where}[${j}]: unknown pathspec magic "${bad}"`);
    }
  });
  return out;
}

/**
 * The magic of `spec` git would refuse, or null. Static, so a typo is a config
 * problem at session start rather than a doc-sync check that never matches: a
 * leading `:` must open a short form (`:!`, `:^`, `:/`, or `::`, the explicit end
 * of no magic) or `:(words)` whose comma-separated words are git's own. Everything
 * else in a pathspec is git's to judge at hook time.
 */
export function unknownMagic(spec) {
  if (!spec.startsWith(':')) return null;
  if ('!^/:'.includes(spec[1] ?? '')) return null;
  if (spec[1] !== '(') return spec.slice(0, 2);
  const end = spec.indexOf(')');
  if (end < 0) return spec.slice(1);
  const words = spec.slice(2, end).split(',');
  const bad = words.find((w) => w !== '' && !PATHSPEC_MAGIC.includes(w) && !w.startsWith('attr:'));
  return bad ?? null;
}

function validateCi(ci) {
  if (ci === undefined) return [];
  if (!isObj(ci)) return ['ci must be an object'];
  const out = unknownKeys(ci, KNOWN_KEYS.ci, 'ci');
  if (!isStr(ci.workflow)) out.push('ci.workflow must name a workflow file (e.g. "ci.yml")');
  return out;
}

/**
 * What is NOT code, as git pathspecs: exactly the configured state homes. A commit
 * touching only these (bundle state, a closeout, the backlog) needs no gate and no
 * review. Everything else — markdown included, since skills and the playbook are
 * product surface — is code.
 */
export function nonCodePathspecs(config) {
  const { bundles, closeouts, backlog } = config.paths;
  return [bundles, closeouts, backlog].map((p) => `:(exclude)${p}`);
}
