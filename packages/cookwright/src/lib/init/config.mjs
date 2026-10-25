// src/lib/init/config.mjs — step 1: cookwright.json. Absent → written with every key
// explicit; present → loaded (a refusal if invalid; an older version migrated in
// memory) and kept, never edited.

import fs from 'node:fs';
import path from 'node:path';

import { Refusal } from '../cli.mjs';
import { CONFIG_FILE, CONFIG_VERSION, DEFAULTS, loadConfig, validateConfig, withDefaults } from '../config.mjs';
import { messages } from '../messages.mjs';
import { packDefaults } from '../packs/registry.mjs';
import { KEPT, WROTE, readTarget, row } from './files.mjs';
import { detectBase } from './repo.mjs';

const m = messages.init.config;

export const SCHEMA_REF = './node_modules/cookwright/schema/cookwright.schema.json';
/** The gate check init writes when the repo's test script is one that exits. */
export const TEST_CHECK = Object.freeze({ name: 'test', run: 'npm test' });

const PLACEHOLDER = /no test specified/;
// `--watch` / `--watchAll` never exit; `--watchAll=false` turns watching off.
const WATCH = /--watch(All)?(?![\w=-])/;

function readPackage(root) {
  const abs = path.join(root, 'package.json');
  if (!fs.existsSync(abs)) return { reason: m.noPackage };
  try {
    return { pkg: JSON.parse(fs.readFileSync(abs, 'utf8')) };
  } catch {
    return { reason: m.badPackage };
  }
}

/** `{ checks, reason }`: npm test when package.json defines a test script that exits, else why not. */
export function gateChecks(root) {
  const { pkg, reason } = readPackage(root);
  if (reason) return { checks: [], reason };
  const test = pkg?.scripts?.test;
  const why =
    typeof test !== 'string' || !test.trim()
      ? m.noTestScript
      : PLACEHOLDER.test(test)
        ? m.placeholder
        : WATCH.test(test)
          ? m.watch
          : null;
  if (why) return { checks: [], reason: why };
  return { checks: [{ ...TEST_CHECK }], reason: null };
}

/** The gate's note: the commands it runs, and why npm test is not one of them. */
function gateNote(checks, reason) {
  if (!checks.length) return m.gateNone(reason);
  const runs = checks.map((c) => c.run);
  return reason ? m.gateWithout(runs, reason) : m.gateRuns(runs);
}

/** No pack: what a fresh config declares when nothing chose one. */
export const NO_PACKS = Object.freeze({ names: Object.freeze([]), note: m.packsNone });

/**
 * The config init writes on a fresh repo, every path explicit; `hosts` from --hosts,
 * `packs` (`{ names, note }`) from --packs or detection, with each pack's doc-sync
 * rules and gate checks.
 */
export function freshConfig(root, base, hosts = DEFAULTS.hosts, packs = NO_PACKS) {
  const test = gateChecks(root);
  const defaults = packDefaults(packs.names);
  const checks = [...test.checks, ...defaults.gate];
  const raw = {
    $schema: SCHEMA_REF,
    version: DEFAULTS.version,
    level: DEFAULTS.level,
    hosts: [...hosts],
    packs: [...packs.names],
    baseBranch: detectBase(root, base),
    paths: { ...DEFAULTS.paths },
    gate: { checks },
    hooks: { docSync: defaults.docSync },
  };
  return { raw, note: m.wrote(raw.baseBranch, packs.note, gateNote(checks, test.reason)) };
}

/** The flags that shape a fresh config, by the key each sets. */
const FRESH_FLAGS = Object.freeze({ base: 'baseBranch', hosts: 'hosts' });

/**
 * Step 1. Sets `repo.config`, which every later step reads. --base and --hosts on an
 * existing config are refused, never ignored: init never edits one.
 */
export function configStep(repo, io) {
  if (readTarget(repo.root, CONFIG_FILE) !== null) {
    const flag = Object.keys(FRESH_FLAGS).find((f) => io[f] !== undefined);
    if (flag) throw new Refusal(m.existing(flag, FRESH_FLAGS[flag]));
    try {
      repo.config = loadConfig(repo.root);
    } catch (err) {
      throw new Refusal(err.message); // the loader's message, verbatim
    }
    // An older version loads migrated in memory; init keeps the file as it is and
    // says how to write it, since only `migrate` edits a config.
    const from = repo.config.migratedFrom;
    return row(KEPT, CONFIG_FILE, from === undefined ? m.kept(repo.config.level) : m.migrated(from, CONFIG_VERSION));
  }
  const { raw, note } = freshConfig(repo.root, io.base, io.hosts);
  repo.config = withDefaults(raw);
  // The same validation as a loaded config, in preflight: init never writes a
  // config that doctor and every later run would refuse.
  const problems = validateConfig(repo.config);
  if (problems.length) throw new Refusal(messages.init.freshInvalid(problems));
  return row(WROTE, CONFIG_FILE, note, [{ rel: CONFIG_FILE, content: `${JSON.stringify(raw, null, 2)}\n` }]);
}
