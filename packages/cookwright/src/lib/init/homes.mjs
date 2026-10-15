// src/lib/init/homes.mjs — step 2: the state homes. The backlog and the changelog
// come from templates, seeded once and the user's afterwards; the closeouts
// directory gets a .gitkeep, since git keeps no empty directory.

import fs from 'node:fs';
import path from 'node:path';

import { Refusal } from '../cli.mjs';
import { messages } from '../messages.mjs';
import { KEPT, UPDATED, WROTE, kindOf, readTarget, row } from './files.mjs';

const m = messages.init;

const template = (name) => fs.readFileSync(new URL(`../templates/${name}`, import.meta.url), 'utf8');

/** A file home: from its template when absent, else kept. */
const fileHome = (key, name) => (repo) => {
  const rel = repo.config.paths[key];
  if (readTarget(repo.root, rel) !== null) return row(KEPT, rel, m.homes.present);
  return row(WROTE, rel, m.homes.template, [{ rel, content: template(name) }]);
};

export const backlogStep = fileHome('backlog', 'backlog.md');
export const changelogStep = fileHome('changelog', 'CHANGELOG.md');

export function closeoutsStep(repo) {
  const rel = repo.config.paths.closeouts;
  const keep = path.posix.join(rel, '.gitkeep');
  const kind = kindOf(path.join(repo.root, rel));
  if (kind === 'none') return row(WROTE, `${rel}/`, m.homes.gitkeep, [{ rel: keep, content: '' }]);
  if (kind !== 'dir') throw new Refusal(m.notADir(rel));
  if (fs.readdirSync(path.join(repo.root, rel)).length) return row(KEPT, `${rel}/`, m.homes.present);
  return row(UPDATED, `${rel}/`, m.homes.emptyDir, [{ rel: keep, content: '' }]);
}
