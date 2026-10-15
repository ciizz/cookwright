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

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { KNOWN_HOSTS } from './hosts.mjs';
import { KNOWN_LEVELS } from './levels.mjs';

export const CONFIG_FILE = 'cookwright.json';
export const CONFIG_VERSION = 1;

export const DEFAULTS = Object.freeze({
  version: CONFIG_VERSION,
  level: 0,
  hosts: ['claude'],
  baseBranch: 'main',
  paths: {
    bundles: 'docs/bundles',
    closeouts: 'docs/closeouts',
    backlog: 'docs/backlog.md',
    playbook: 'docs/playbook.md',
    changelog: 'CHANGELOG.md',
  },
  gate: { checks: [], flakes: {} },
});

/** Every key the validator knows, per object — the schema test compares these. */
export const KNOWN_KEYS = Object.freeze({
  top: ['$schema', 'version', 'level', 'hosts', 'baseBranch', 'paths', 'gate', 'ci'],
  paths: ['bundles', 'closeouts', 'backlog', 'playbook', 'changelog'],
  gate: ['checks', 'flakes'],
  check: ['name', 'run', 'needs'],
  ci: ['workflow'],
});

/** The git work tree's top directory containing `cwd`, or null (not a work tree, no git). */
export function workTreeRoot(cwd = process.cwd()) {
  const out = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
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

/** Read, default and validate the config at `root`; throws one message per load. */
export function loadConfig(root) {
  const file = path.join(root, CONFIG_FILE);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${CONFIG_FILE}: ${err.code === 'ENOENT' ? 'not found' : err.message}`);
  }
  if (!isObj(raw)) throw new Error(`${CONFIG_FILE}: must be a JSON object`);
  const config = withDefaults(raw);
  const problems = validateConfig(config);
  if (problems.length) throw new Error(`${CONFIG_FILE}:\n  ${problems.join('\n  ')}`);
  return config;
}

const isStr = (v) => typeof v === 'string' && v.length > 0;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A path with its trailing slashes removed, so `docs/x/` and `docs/x` are one path. */
const trimSlash = (p) => (typeof p === 'string' ? p.replace(/\/+$/, '') : p);

/**
 * Defaults applied one level deep: an absent `paths.x` or `gate.x` gets its default.
 * `version` is never defaulted — a config must say which format it speaks.
 */
export function withDefaults(raw) {
  const obj = (v) => (isObj(v) ? v : {});
  const paths = { ...DEFAULTS.paths, ...obj(raw?.paths) };
  for (const k of Object.keys(paths)) paths[k] = trimSlash(paths[k]);
  return {
    ...DEFAULTS,
    ...raw,
    version: raw?.version,
    paths,
    gate: { ...DEFAULTS.gate, ...obj(raw?.gate) },
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
    if (!isRelPath(paths[key])) out.push(`paths.${key} must be a root-relative path inside the repo`);
  }
  // The state homes must not nest: the gate ignores dirt under `bundles`, and a
  // closeout or backlog inside it would be gated over while uncommitted.
  const homes = ['bundles', 'closeouts', 'backlog'].filter((k) => isRelPath(paths[k]));
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
