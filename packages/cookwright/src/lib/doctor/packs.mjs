// src/lib/doctor/packs.mjs — doctor's pack rows (stage-4 plan §4.7): the static
// `packs` row, and for each declared pack `pack.<name>.declared`, `.rules` and
// `.docs`, appended after the static rows. Every read is a named file or one
// directory and the one below it: no subprocess, within doctor's budget. Pack rows
// sit outside every level's `requires`, so they never move the level line.

import fs from 'node:fs';
import path from 'node:path';

import { messages } from '../messages.mjs';
import { detectPacks } from '../packs/detect.mjs';
import { LISTERS, tableKeys } from '../packs/entries.mjs';
import { ADVISORY, declaredPacks } from '../packs/registry.mjs';
import { renderSection } from '../packs/section.mjs';
import { RULES_FILE, blockState, packKind } from '../rules/block.mjs';
import { FAIL, PASS, WARN, fail, pass, warn } from '../verdict.mjs';
import { isFile, readLF } from './repo.mjs';

const m = messages.doctor;

/**
 * `packs`: PASS naming the declared packs, or none declared and none detected; WARN
 * when none is declared and the tree shows a stack, so an all-PASS readout still
 * gives a reason to run the setup skill (disposition 22).
 */
export function checkPacks(repo) {
  const declared = declaredPacks(repo.config);
  if (declared.length) return pass(m.packs.declared(declared.map((p) => p.name)));
  const found = detectPacks(repo.root);
  return found.length ? warn(m.packs.detected(found)) : pass(m.packs.none);
}

/** `pack.<name>.declared`: the manifest's version, its measured rules and its advisory count. */
function checkDeclared(pack) {
  const { manifest } = pack;
  const measured = manifest.rules.filter((r) => r.measure !== ADVISORY).map((r) => r.id);
  const advisory = manifest.rules.length - measured.length;
  return pass(m.pack.declared(manifest.name, manifest.version, measured, advisory));
}

/** The section's own verdict: current PASS, newer WARN, anything else FAIL. */
function sectionVerdict(repo, pack) {
  const r = m.pack.rules;
  const { name } = pack;
  const abs = path.join(repo.root, RULES_FILE);
  if (!isFile(abs)) return fail(r.noFile(RULES_FILE, name));
  const s = blockState(readLF(abs), renderSection(pack.manifest, pack.off), packKind(name));
  if (s.state === 'current') return pass(r.current(RULES_FILE, name));
  if (s.state === 'newer') return warn(r.newer(RULES_FILE, name, s.version));
  if (s.state === 'stale') return fail(r.stale(RULES_FILE, name));
  if (s.state === 'malformed') return fail(r.malformed(RULES_FILE, name, s.reason));
  return fail(r.absent(RULES_FILE, name));
}

/**
 * `pack.<name>.rules`: the section's state, and a WARN naming the rules switched off
 * (a chosen state, disposition 8); the worst status wins, both notes on the line.
 */
function checkRules(repo, pack) {
  const v = sectionVerdict(repo, pack);
  if (!pack.off.size) return v;
  const ids = pack.manifest.rules.filter((rule) => pack.off.has(rule.id)).map((rule) => rule.id);
  const note = `${v.note}; ${m.pack.rules.off(ids)}`;
  return v.status === FAIL ? fail(note) : warn(note);
}

/** The pack's doc-sync rule for `doc`, when it is not switched off: what hooks.docSync must carry. */
const docSyncFor = (pack, doc) =>
  pack.manifest.rules.find((r) => r.measure === 'doc-sync' && !pack.off.has(r.id) && r.docSync.docs.includes(doc.path));

/** The problem with the doc-sync rule tying `doc`'s code to it, or null. */
function ruleProblem(repo, pack, doc) {
  const rule = docSyncFor(pack, doc);
  if (!rule) return null;
  const configured = repo.config.hooks.docSync.find((x) => x.name === rule.docSync.name);
  if (!configured) return m.pack.docs.noRule(rule.docSync.name, doc.path);
  return configured.docs.includes(doc.path) ? null : m.pack.docs.ruleOther(rule.docSync.name, doc.path);
}

/** `{ status, note }` of one contract doc: present, tied by its rule, every entry listed. */
function docVerdict(repo, pack, doc) {
  const abs = path.join(repo.root, doc.path);
  const present = isFile(abs);
  const problems = [present ? null : m.pack.docs.missing(doc.path), ruleProblem(repo, pack, doc)].filter(Boolean);
  if (!present) return warn(problems.join('; '));
  const entries = LISTERS[doc.entries](repo.root, doc.code);
  const keys = tableKeys(fs.readFileSync(abs, 'utf8'));
  const omitted = entries.filter((e) => !keys.has(e));
  if (omitted.length) problems.push(m.pack.docs.omitted(omitted, entries.length, doc.entries, doc.path));
  return problems.length ? warn(problems.join('; ')) : pass(m.pack.docs.ok(entries.length, doc.entries, doc.path));
}

/** `pack.<name>.docs`: each contract doc's verdict; any WARN makes the row WARN (disposition 11, never FAIL). */
function checkDocs(repo, pack) {
  const verdicts = pack.manifest.docs.map((doc) => docVerdict(repo, pack, doc));
  const status = verdicts.some((v) => v.status === WARN) ? WARN : PASS;
  const shown = status === PASS ? verdicts : verdicts.filter((v) => v.status === WARN);
  return { status, note: shown.map((v) => v.note).join('; ') };
}

/** The row names of one declared pack, in readout order, each with its check. */
export const PACK_ROWS = Object.freeze({
  declared: (repo, pack) => checkDeclared(pack),
  rules: checkRules,
  docs: checkDocs,
});

/** The row name of `pack`'s check `kind`: `pack.expo.rules`. */
export const packRowName = (name, kind) => `pack.${name}.${kind}`;

/** `[name, run]` for every declared pack's rows, in `packs` order; none without a config. */
export function packChecks(repo) {
  if (!repo.config) return [];
  return declaredPacks(repo.config).flatMap((pack) =>
    Object.entries(PACK_ROWS).map(([kind, run]) => [packRowName(pack.name, kind), () => run(repo, pack)]),
  );
}
