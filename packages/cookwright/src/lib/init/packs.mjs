// src/lib/init/packs.mjs — the steps the declared stack packs add to init (stage-4
// plan §4.2, §4.3, dispositions 5, 6, 27, 38): each pack's contract docs from its
// templates; the repo's eslint.config.js spreading every pack's ESLint export, in
// one transform; and each dependency a pack's rule needs, named, never installed
// (init runs no npm). Each step iterates the declared packs itself and writes files
// no other step writes.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { messages } from '../messages.mjs';
import { activeRules, declaredPacks } from '../packs/registry.mjs';
import { KEPT, SKIPPED, UPDATED, WROTE, eolOf, readTarget, row, withEol } from './files.mjs';

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

/** ESLint's flat config file names, in the order ESLint looks for them. */
const ESLINT_CONFIGS = Object.freeze(['js', 'mjs', 'cjs', 'ts', 'mts', 'cts'].map((ext) => `eslint.config.${ext}`));
/**
 * Expo's eslint.config.js as `npx expo lint` writes it, byte for byte (from
 * @expo/cli@58.1.15, static/template/eslint.config.js): the one file init edits.
 */
const EXPO_TEMPLATE = fs.readFileSync(new URL('../templates/eslint.config.js', import.meta.url), 'utf8');
const ANCHOR = '  expoConfig,\n';
/** A line init inserts, for any pack the package ships: what the transform owns. */
const OWN_LINE = /^ {2}\.\.\.require\('cookwright\/packs\/[a-z-]+\/eslint\.cjs'\),\n/gm;

/** The module a pack's export is required by, and the line that spreads it. */
const exportOf = (manifest) => `cookwright/${manifest.eslintExport}`;
export const spreadLine = (manifest) => `  ...require('${exportOf(manifest)}'),`;

/** `text` (LF) as Expo's template with exactly `lines` after expoConfig, or null when it is not the template. */
function transformed(text, lines) {
  if (text.replace(OWN_LINE, '') !== EXPO_TEMPLATE) return null;
  return EXPO_TEMPLATE.replace(ANCHOR, `${ANCHOR}${lines.map((l) => `${l}\n`).join('')}`);
}

/** The eslint.config row for an existing config file `rel` holding `text`. */
function eslintRow(rel, text, manifests) {
  const exports = manifests.map(exportOf);
  const lines = manifests.map(spreadLine);
  const lf = text.replace(/\r\n/g, '\n');
  const next = transformed(lf, lines);
  if (next === lf) return row(KEPT, rel, m.eslint.names(exports));
  if (next !== null) return row(UPDATED, rel, m.eslint.added(exports), [{ rel, content: withEol(next, eolOf(text)) }]);
  const missing = manifests.filter((mf) => !text.includes(`require('${exportOf(mf)}')`)).map(spreadLine);
  if (!missing.length) return row(KEPT, rel, m.eslint.names(exports));
  return row(SKIPPED, rel, m.eslint.other(missing.map((l) => l.trim())));
}

/**
 * The repo's ESLint config spreads every declared pack's export: Expo's template is
 * transformed once for all of them; any other file is left alone, naming the lines;
 * no file names the setup line of the first pack. No pack, no row.
 */
export function eslintConfigStep(repo) {
  const manifests = declaredPacks(repo.config).map((p) => p.manifest).filter((mf) => mf.eslintExport);
  if (!manifests.length) return [];
  for (const rel of ESLINT_CONFIGS) {
    const text = readTarget(repo.root, rel);
    if (text !== null) return eslintRow(rel, text, manifests);
  }
  return row(SKIPPED, ESLINT_CONFIGS[0], m.eslint.none(manifests[0].setup.eslint));
}

/** Whether `pkg` is installed where Node resolves it from `root`, whatever its exports map. */
function installed(root, pkg) {
  const dirs = createRequire(path.join(root, 'package.json')).resolve.paths(pkg) ?? [];
  return dirs.some((dir) => fs.existsSync(path.join(dir, pkg, 'package.json')));
}

/** Each dependency an active rule of a declared pack needs: installed, or the install line. */
export const packDepsStep = (repo) =>
  declaredPacks(repo.config).flatMap((pack) => {
    const needed = new Set(activeRules(pack).map((r) => r.needs).filter(Boolean));
    return pack.manifest.deps
      .filter((dep) => needed.has(dep.package))
      .map((dep) =>
        installed(repo.root, dep.package)
          ? row(KEPT, dep.package, m.dep.installed(dep.reason))
          : row(SKIPPED, dep.package, m.dep.needs(dep.install, dep.reason)),
      );
  });
