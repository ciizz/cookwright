// src/lib/init/config.mjs — step 1: cookwright.json. Absent → written with every key
// explicit; present → loaded (a refusal if invalid) and kept, never edited.

import fs from 'node:fs';
import path from 'node:path';

import { Refusal } from '../cli.mjs';
import { CONFIG_FILE, DEFAULTS, loadConfig, validateConfig, withDefaults } from '../config.mjs';
import { messages } from '../messages.mjs';
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

/** `{ checks, note }`: npm test when package.json defines a test script that exits. */
export function gateChecks(root) {
  const { pkg, reason } = readPackage(root);
  if (reason) return { checks: [], note: m.gateNone(reason) };
  const test = pkg?.scripts?.test;
  const why =
    typeof test !== 'string' || !test.trim()
      ? m.noTestScript
      : PLACEHOLDER.test(test)
        ? m.placeholder
        : WATCH.test(test)
          ? m.watch
          : null;
  if (why) return { checks: [], note: m.gateNone(why) };
  return { checks: [{ ...TEST_CHECK }], note: m.gateTest(TEST_CHECK.run) };
}

/** The config init writes on a fresh repo, every path explicit. */
export function freshConfig(root, base) {
  const gate = gateChecks(root);
  const raw = {
    $schema: SCHEMA_REF,
    version: DEFAULTS.version,
    level: DEFAULTS.level,
    hosts: [...DEFAULTS.hosts],
    baseBranch: detectBase(root, base),
    paths: { ...DEFAULTS.paths },
    gate: { checks: gate.checks },
    hooks: { docSync: [] },
  };
  return { raw, note: m.wrote(raw.baseBranch, gate.note) };
}

/** Step 1. Sets `repo.config`, which every later step reads. */
export function configStep(repo, io) {
  if (readTarget(repo.root, CONFIG_FILE) !== null) {
    try {
      repo.config = loadConfig(repo.root);
    } catch (err) {
      throw new Refusal(err.message); // the loader's message, verbatim
    }
    return row(KEPT, CONFIG_FILE, m.kept(repo.config.level));
  }
  const { raw, note } = freshConfig(repo.root, io.base);
  repo.config = withDefaults(raw);
  // The same validation as a loaded config, in preflight: init never writes a
  // config that doctor and every later run would refuse.
  const problems = validateConfig(repo.config);
  if (problems.length) throw new Refusal(messages.init.freshInvalid(problems));
  return row(WROTE, CONFIG_FILE, note, [{ rel: CONFIG_FILE, content: `${JSON.stringify(raw, null, 2)}\n` }]);
}
