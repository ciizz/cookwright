// src/lib/packs/detect.mjs — the packs a tree shows (stage-4 plan §4.1, disposition
// 14): a default for a fresh config, never a gate, and the evidence for doctor's
// `packs` row. Two named reads, no walk: package.json's dependencies and the files a
// manifest's `detect` names, both at the config root.

import fs from 'node:fs';
import path from 'node:path';

import { messages } from '../messages.mjs';
import { PACKS } from './registry.mjs';

const m = messages.detect;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The names package.json depends on (dependencies and devDependencies); none when it is absent or unreadable. */
function dependencies(root) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  } catch {
    return new Set();
  }
  const keys = (v) => (isObj(v) ? Object.keys(v) : []);
  return new Set(isObj(pkg) ? [...keys(pkg.dependencies), ...keys(pkg.devDependencies)] : []);
}

const isFile = (abs) => {
  try {
    return fs.statSync(abs).isFile();
  } catch {
    return false;
  }
};

/** The first evidence of `detect` at `root`: a file it names, else a dependency; null when none. */
function evidenceOf(detect, root, deps) {
  const file = detect.files.find((rel) => isFile(path.join(root, rel)));
  if (file) return m.file(file);
  const dep = detect.dependencies.find((name) => deps.has(name));
  return dep ? m.dependsOn(dep) : null;
}

/** Each pack the tree at `root` shows, in the registry's order: `[{ name, evidence }]`. */
export function detectPacks(root) {
  const deps = dependencies(root);
  return Object.values(PACKS).flatMap((mf) => {
    const evidence = evidenceOf(mf.detect, root, deps);
    return evidence ? [{ name: mf.name, evidence }] : [];
  });
}
