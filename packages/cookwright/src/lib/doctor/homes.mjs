// src/lib/doctor/homes.mjs — the state homes exist, the changelog is the generated
// one, and the backlog's ids are unique.

import path from 'node:path';

import { hasMarker } from '../changelog/render.mjs';
import { fail, pass, skip, warn } from '../verdict.mjs';
import { messages } from '../messages.mjs';
import { isDir, isFile, readLF } from './repo.mjs';

const m = messages.doctor;

/** The backlog's three sections, as `## <heading>` lines. */
export const BACKLOG_HEADINGS = Object.freeze(['Open bugs', 'Open enhancements', 'Closed']);

/** An id OCCURRENCE is the leading `- **B-nnn**` of an item line; prose mentions are not. */
const ITEM_ID = /^[ \t]*- \*\*([BE]-\d+)\*\*/gm;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasHeading = (text, h) => new RegExp(`^## ${escape(h)}[ \\t]*$`, 'm').test(text);

export function checkBacklog(repo) {
  const file = repo.config.paths.backlog;
  const abs = path.join(repo.root, file);
  if (!isFile(abs)) return fail(m.homes.missing(file));
  const text = readLF(abs);
  const missing = BACKLOG_HEADINGS.filter((h) => !hasHeading(text, h));
  return missing.length ? warn(m.homes.headingsMissing(file, missing)) : pass(m.homes.backlogOk(file));
}

export function checkCloseouts(repo) {
  const dir = repo.config.paths.closeouts;
  return isDir(path.join(repo.root, dir)) ? pass(m.homes.dirOk(dir)) : fail(m.homes.missing(`${dir}/`));
}

/**
 * The changelog exists and carries the generated marker. Only the marker is read:
 * comparing it with the release tags (a `git log` per tag) is the changelog
 * command's and the pre-push check's, never inside doctor's budget.
 */
export function checkChangelog(repo) {
  const file = repo.config.paths.changelog;
  const abs = path.join(repo.root, file);
  if (!isFile(abs)) return fail(m.homes.missing(file));
  return hasMarker(readLF(abs)) ? pass(m.homes.fileOk(file)) : warn(m.homes.unmarked(file));
}

/** Every backlog id once, counting item lines only. */
export function checkIds(repo) {
  const abs = path.join(repo.root, repo.config.paths.backlog);
  if (!isFile(abs)) return skip(m.ids.noBacklog);
  const ids = [...readLF(abs).matchAll(ITEM_ID)].map((x) => x[1]);
  const dups = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  return dups.length ? warn(m.ids.duplicates(dups)) : pass(m.ids.ok(ids.length));
}
