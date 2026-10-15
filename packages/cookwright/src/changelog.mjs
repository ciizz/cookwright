// src/changelog.mjs — `cookwright changelog [--check | --unreleased | --adopt]`: the
// changelog, generated from the release tags and the conventional commit subjects
// between them (plan §4.4). Nothing in it is hand-written and nothing unreleased is
// stored; `--unreleased` computes what is pending.
//
// Exit 0; 1 when --check finds the file missing, unmarked or stale; 2 when refused
// (a bad argument, not a work tree, no config, a git failure, a link on the path, a
// hand-kept changelog without --adopt, a file that cannot be read or written).

import fs from 'node:fs';
import path from 'node:path';

import { TimedOut } from './lib/budget.mjs';
import { commitsBetween } from './lib/changelog/commits.mjs';
import { unreleasedSection } from './lib/changelog/render.mjs';
import { changelogState, generate } from './lib/changelog/state.mjs';
import { isUnborn, releaseTags } from './lib/changelog/tags.mjs';
import { Refusal, onlyFlags, parseArgv } from './lib/cli.mjs';
import { findRoot, loadConfig, workTreeRoot } from './lib/config.mjs';
import { oneLine } from './lib/doctor/repo.mjs';
import { kindOf, linkOnPath } from './lib/init/files.mjs';
import { messages } from './lib/messages.mjs';

const m = messages.changelog;
const MODES = ['check', 'unreleased', 'adopt'];

/** The one mode asked for (`write` when none); a positional, a value or two flags refuse. */
function readArgs(argv) {
  const { pos, flags } = parseArgv(argv);
  if (pos.length) throw new Refusal(m.usage);
  onlyFlags(flags, MODES);
  const set = Object.keys(flags);
  if (set.length > 1 || set.some((f) => flags[f] !== true)) throw new Refusal(m.usage);
  return set[0] ?? 'write';
}

/** `{ root, config }`: the config's directory inside the work tree holding `cwd`. */
function openRepo(cwd) {
  const top = workTreeRoot(cwd);
  if (!top) throw new Refusal(m.notWorkTree(cwd));
  const root = findRoot(cwd, { stopAt: top });
  if (!root) throw new Refusal(m.noConfig(cwd));
  try {
    return { root, config: loadConfig(root) };
  } catch (err) {
    throw new Refusal(oneLine(err.message));
  }
}

/** The command's own notes, on stderr: non-semver tags, versions out of line. */
function printNotes({ skipped, notAncestors = [] }) {
  for (const tag of skipped) console.error(m.skippedTag(tag));
  for (const [lower, next] of notAncestors) console.error(m.notAncestor(lower, next));
}

/**
 * `fn()`, where an fs error (EACCES, EROFS, …) is a refusal naming `rel` and its
 * code: exit 2, a harness failure, never the exit 1 that --check keeps for drift.
 * Only file work goes through it, never git, which refuses on its own.
 */
function onFile(rel, fn) {
  try {
    return fn();
  } catch (err) {
    if (err instanceof Refusal || typeof err?.code !== 'string') throw err;
    throw new Refusal(m.fileFailed(rel, err.code));
  }
}

/** Default and --adopt: write the generated file, never through a link. */
function writeMode(repo, adopt) {
  const rel = repo.config.paths.changelog;
  const abs = path.join(repo.root, rel);
  const link = linkOnPath(repo.root, rel);
  if (link) throw new Refusal(m.symlink(link));
  const kind = kindOf(abs);
  if (kind !== 'none' && kind !== 'file') throw new Refusal(m.notAFile(rel));
  const g = generate(repo.root);
  printNotes(g);
  onFile(rel, () => {
    if (changelogState(repo, g).state === 'unmarked' && !adopt) throw new Refusal(m.unmarkedRefused(rel));
    if (kind === 'none' || fs.readFileSync(abs, 'utf8') !== g.text) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, g.text);
    }
  });
  console.log(m.regenerated(rel, g.tags.length));
  return 0;
}

/** --check: exit 0 only when the file is the render, LF-normalised. */
function checkMode(repo) {
  const rel = repo.config.paths.changelog;
  const g = generate(repo.root);
  printNotes(g);
  const { state, tags } = onFile(rel, () => changelogState(repo, g));
  const line = m.check[state](rel, tags);
  if (state === 'current') console.log(line);
  else console.error(line);
  return state === 'current' ? 0 : 1;
}

/** --unreleased: HEAD's commits that no release tag holds, printed, nothing written. */
function unreleasedMode(repo) {
  if (isUnborn(repo.root)) {
    console.log(m.noCommits);
    return 0;
  }
  const { tags, skipped } = releaseTags(repo.root);
  printNotes({ skipped });
  const latest = tags.at(-1)?.name ?? null;
  const commits = commitsBetween(
    repo.root,
    'HEAD',
    tags.map((t) => t.name),
  );
  console.log(commits.length ? unreleasedSection(commits, latest) : m.nothingUnreleased(latest));
  return 0;
}

const RUN = { write: writeMode, adopt: (repo) => writeMode(repo, true), check: checkMode, unreleased: unreleasedMode };

/** A refusal on stderr, exit 2; with `usage`, the usage follows the reason. */
function refuse(err, usage) {
  if (err instanceof TimedOut) err = new Refusal(messages.timedOut(err.what));
  if (!(err instanceof Refusal)) throw err;
  console.error(m.refused(err.message));
  if (usage && err.message !== m.usage) console.error(m.usage);
  return 2;
}

/** `io.cwd` is the tests' seam; the bin passes none. */
export function main(argv = [], { cwd = process.cwd() } = {}) {
  let mode;
  try {
    mode = readArgs(argv);
  } catch (err) {
    return refuse(err, true);
  }
  try {
    return RUN[mode](openRepo(cwd), false);
  } catch (err) {
    return refuse(err, false);
  }
}
