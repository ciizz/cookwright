// src/lib/init/packs.mjs — the steps the declared stack packs add to init (stage-4
// plan §4.2, §4.3): each pack's contract docs from its templates. Each step iterates
// the declared packs itself and writes distinct files, so no two steps write one
// file (disposition 27).

import fs from 'node:fs';

import { messages } from '../messages.mjs';
import { declaredPacks } from '../packs/registry.mjs';
import { KEPT, WROTE, readTarget, row } from './files.mjs';

const m = messages.init.pack;

/** The text of `rel` in pack `name`'s directory of the package. */
const packFile = (name, rel) => fs.readFileSync(new URL(`../../../packs/${name}/${rel}`, import.meta.url), 'utf8');

/** One contract doc: from the pack's template when absent, else kept, whatever it holds. */
function docRow(root, name, doc) {
  if (readTarget(root, doc.path) !== null) return row(KEPT, doc.path, m.doc.present(name));
  return row(WROTE, doc.path, m.doc.template(name), [{ rel: doc.path, content: packFile(name, doc.template) }]);
}

/** Every declared pack's contract docs, in the config's order. */
export const packDocsStep = (repo) =>
  declaredPacks(repo.config).flatMap(({ name, manifest }) => manifest.docs.map((doc) => docRow(repo.root, name, doc)));
