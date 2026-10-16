// src/migrate.mjs — `cookwright migrate [--dry-run]`: write cookwright.json at the
// current format version (stage-3 plan §4.3). The loader already migrates an older
// file in memory, so nothing waits on this command; it makes the migration durable.
//
// It reads the raw JSON (never the defaulted config), runs each step with one line
// each, validates the result as the loader would, and writes it in the file's own
// indent, line ending and final newline, never through a symbolic link.
//
// Exit 0: written, already current, or a dry run. Exit 2 when refused (a bad
// argument, no config, a link, unreadable JSON, a newer or unknown version, an
// invalid result, a failed write), with nothing written.

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { TimedOut } from './lib/budget.mjs';
import { Refusal, onlyFlags, parseArgv } from './lib/cli.mjs';
import {
  CONFIG_FILE,
  CONFIG_VERSION,
  applyMigrations,
  findRoot,
  invalidConfig,
  migrationContext,
  newerVersion,
  validateConfig,
  withDefaults,
  workTreeRoot,
} from './lib/config.mjs';
import { oneLine } from './lib/doctor/repo.mjs';
import { kindOf, linkOnPath, reserialize } from './lib/init/files.mjs';
import { messages } from './lib/messages.mjs';
import { MIGRATIONS } from './lib/migrations.mjs';

const m = messages.migrate;
const DRY_RUN = 'dry-run';

/** `{ dryRun }`; a positional, an unknown flag or a value after --dry-run refuse. */
function readArgs(argv) {
  const { pos, flags } = parseArgv(argv);
  if (pos.length) throw new Refusal(m.usage);
  onlyFlags(flags, [DRY_RUN]);
  if (flags[DRY_RUN] !== undefined && flags[DRY_RUN] !== true) throw new Refusal(m.usage);
  return { dryRun: flags[DRY_RUN] === true };
}

/** `{ root, text, raw }`: the config found as doctor finds it, read but not defaulted. */
function openConfig(cwd) {
  const top = workTreeRoot(cwd);
  const root = findRoot(cwd, { stopAt: top ?? undefined });
  if (!root) throw new Refusal(m.noConfig(cwd));
  const link = linkOnPath(root, CONFIG_FILE);
  if (link) throw new Refusal(m.symlink(link));
  if (kindOf(path.join(root, CONFIG_FILE)) !== 'file') throw new Refusal(m.notAFile);
  let text;
  try {
    text = fs.readFileSync(path.join(root, CONFIG_FILE), 'utf8');
  } catch (err) {
    throw new Refusal(m.readFailed(err.code ?? err.message));
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Refusal(m.notJson(err.message));
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Refusal(m.notObject);
  return { root, text, raw };
}

/** A step's line; an outcome this package has no text for is shown by its key. */
const stepLine = ({ from, to, outcome, detail }) =>
  m.step(from, to, Object.hasOwn(m.outcomes, outcome) ? m.outcomes[outcome](detail) : String(outcome));

function migrate(cwd, { dryRun, migrations }) {
  const { root, text, raw } = openConfig(cwd);
  const { version } = raw;
  if (version === CONFIG_VERSION) {
    console.log(m.current(CONFIG_VERSION));
    return 0;
  }
  if (Number.isInteger(version) && version > CONFIG_VERSION) throw new Refusal(newerVersion(version));
  const out = applyMigrations(raw, migrationContext(root), migrations);
  // Not a version the chain starts from: the validator's line, as doctor shows it.
  if (!out) throw new Refusal(oneLine(invalidConfig(validateConfig(withDefaults(raw))).message));
  for (const step of out.steps) console.log(stepLine(step));
  const problems = validateConfig(withDefaults(out.raw));
  if (problems.length) throw new Refusal(m.invalid(problems));
  const relaid = reserialize(JSON.parse(text), text) !== text;
  if (dryRun) {
    console.log(m.dry(CONFIG_VERSION, relaid));
    return 0;
  }
  try {
    replaceFile(path.join(root, CONFIG_FILE), reserialize(out.raw, text));
  } catch (err) {
    throw new Refusal(m.writeFailed(err.code ?? err.message));
  }
  console.log(m.wrote(CONFIG_VERSION, relaid));
  return 0;
}

/**
 * `file` replaced by `body` whole or not at all: a temporary file beside it, written
 * and flushed with the original's mode, renamed over it; removed on any failure, so
 * "not written" leaves the original byte for byte.
 */
function replaceFile(file, body) {
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', fs.statSync(file).mode & 0o7777);
    fs.writeFileSync(fd, body);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, file);
  } catch (err) {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/** A refusal on stderr, exit 2; with `usage`, the usage follows the reason. */
function refuse(err, usage) {
  if (err instanceof TimedOut) err = new Refusal(messages.timedOut(err.what));
  if (!(err instanceof Refusal)) throw err;
  console.error(m.refused(err.message));
  if (usage && err.message !== m.usage) console.error(m.usage);
  return 2;
}

/** `io.cwd` and `io.migrations` are the tests' seams; the bin passes neither. */
export function main(argv = [], { cwd = process.cwd(), migrations = MIGRATIONS } = {}) {
  let args;
  try {
    args = readArgs(argv);
  } catch (err) {
    return refuse(err, true);
  }
  try {
    return migrate(cwd, { ...args, migrations });
  } catch (err) {
    return refuse(err, false);
  }
}
