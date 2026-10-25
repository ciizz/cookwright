// src/lib/doctor/packs.mjs — doctor's pack rows (stage-4 plan §4.7): the static
// `packs` row, and for each declared pack `pack.<name>.declared`, `.rules`,
// `.docs`, `.lint` while an ESLint rule is on, and `pack.supabase.types` while
// its rule is on, appended after the static rows. Every read is a named file or one directory and the one below it:
// no subprocess, within doctor's budget. Pack rows sit outside every level's
// `requires`, so they never move the level line.

import fs from 'node:fs';
import path from 'node:path';

import { ESLINT_CONFIGS, exportOf, handLines, installed, installedVersion, namesModule } from '../init/packs.mjs';
import { messages } from '../messages.mjs';
import { detectPacks } from '../packs/detect.mjs';
import { LISTERS, docKeys } from '../packs/entries.mjs';
import { ADVISORY, RATCHET_CHECK, activeRules, declaredPacks } from '../packs/registry.mjs';
import { renderSection } from '../packs/section.mjs';
import { TYPES_SCRIPT, typesScript, typesShape } from '../packs/types.mjs';
import { RULES_FILE, blockState, packKind } from '../rules/block.mjs';
import { FAIL, PASS, SKIP, WARN, fail, pass, skip, warn } from '../verdict.mjs';
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

/** `a` and `b` hold the same strings, in any order. */
const sameSet = (a, b) => new Set(a).size === new Set(b).size && a.every((x) => b.includes(x));

/**
 * The problem with the doc-sync rule tying `doc`'s code to it, or null. The
 * pack-owned name carries the pack's rule exactly: another doc beside it, or a
 * narrower code list, would let a component change pass without the doc while this
 * row read PASS. A rule of the user's own goes under another name.
 */
function ruleProblem(repo, pack, doc) {
  const rule = docSyncFor(pack, doc);
  if (!rule) return null;
  const { name, code, docs } = rule.docSync;
  const configured = repo.config.hooks.docSync.find((x) => x.name === name);
  if (!configured) return m.pack.docs.noRule(name, doc.path);
  return sameSet(configured.code, code) && sameSet(configured.docs, docs) ? null : m.pack.docs.ruleDiffers(name, doc.path);
}

/**
 * A contract doc whose code directory could not be read: the count is not measured,
 * so SKIP, or WARN beside a problem that was; the directory is named root-relative.
 */
function uncounted(repo, doc, err, problems) {
  const where = err.path ? path.relative(repo.root, err.path) : doc.code.join(', ');
  const note = [...problems, m.pack.docs.unreadable(doc.entries, where, err.code ?? String(err.message))].join('; ');
  return problems.length ? warn(note) : skip(note);
}

/** `{ status, note }` of one contract doc: present, tied by its rule, every entry listed. */
function docVerdict(repo, pack, doc) {
  const abs = path.join(repo.root, doc.path);
  const present = isFile(abs);
  const problems = [present ? null : m.pack.docs.missing(doc.path), ruleProblem(repo, pack, doc)].filter(Boolean);
  if (!present) return warn(problems.join('; '));
  let entries;
  try {
    entries = LISTERS[doc.entries](repo.root, doc.code);
  } catch (err) {
    return uncounted(repo, doc, err, problems);
  }
  const keys = docKeys(fs.readFileSync(abs, 'utf8'));
  const omitted = entries.filter((e) => !keys.has(e));
  if (omitted.length) problems.push(m.pack.docs.omitted(omitted, entries.length, doc.entries, doc.path));
  return problems.length ? warn(problems.join('; ')) : pass(m.pack.docs.ok(entries.length, doc.entries, doc.path));
}

/**
 * `pack.<name>.docs`: each contract doc's verdict; any WARN makes the row WARN, else
 * any SKIP makes it SKIP (disposition 11, never FAIL).
 */
function checkDocs(repo, pack) {
  const verdicts = pack.manifest.docs.map((doc) => docVerdict(repo, pack, doc));
  const has = (st) => verdicts.some((v) => v.status === st);
  const status = has(WARN) ? WARN : has(SKIP) ? SKIP : PASS;
  const shown = status === PASS ? verdicts : verdicts.filter((v) => v.status !== PASS);
  return { status, note: shown.map((v) => v.note).join('; ') };
}

/**
 * Whether `run` is cookwright's `standards --<mode>` and nothing else: through npx,
 * node or a path to the bin, with at most `--base <ref>` after it. An `echo …` or a
 * command chained after it measures nothing the gate can record.
 */
const runsStandards = (run, mode) =>
  new RegExp(`^(?:npx (?:--no-install |--no )?|node )?(?:\\S*/)?cookwright(?:\\.mjs)? standards --${mode}(?: --base \\S+)?$`).test(
    String(run ?? '').trim(),
  );

/**
 * The problem with the gate's entry for `want` (a pack's gate check: `{ name, run,
 * skipExit }`), or null: no `gate.checks` entry runs its measure, or none that does
 * opts into its skip exit, so the measure's "cannot measure" would fail the gate
 * (disposition 36). `noGate` names the entry to add.
 */
function gateProblem(repo, want, noGate) {
  const mode = /--(\w+)$/.exec(want.run)[1];
  const runs = (repo.config.gate?.checks ?? []).filter((c) => runsStandards(c.run, mode));
  if (!runs.length) return noGate(JSON.stringify(want));
  return runs.some((c) => c.skipExit === want.skipExit) ? null : m.pack.noSkipExit(runs[0].name, want.skipExit);
}

/**
 * `pack.supabase.types`: what the gate's types check needs, read without running it
 * (the measure needs the local stack): the CLI on PATH, the one script shape, then a
 * `gate.checks` entry that runs it with its skip exit. Init writes that entry only
 * into a fresh config, so a PASS claims a measurement only when the gate has it.
 */
function checkTypes(repo, pack, probes) {
  const t = m.pack.types;
  if (!probes.hasTool('supabase')) return skip(t.needsCli);
  const script = typesScript(repo.root);
  const shape = typesShape(script);
  if (!shape) return warn(script === null ? t.noScript(TYPES_SCRIPT) : t.shape(TYPES_SCRIPT));
  const problem = gateProblem(repo, pack.manifest.rules.find((r) => r.id === 'types').gate, t.noGate);
  return problem ? warn(problem) : pass(t.ok(TYPES_SCRIPT, shape.target));
}

/** Each dependency an active rule of `pack` needs that is not installed. */
const missingDeps = (repo, pack) => {
  const needed = new Set(activeRules(pack).map((r) => r.needs).filter(Boolean));
  return pack.manifest.deps.filter((dep) => needed.has(dep.package) && !installed(repo.root, dep.package));
};

/**
 * `pack.<name>.lint`: ESLint 9 resolvable from the config root, a flat config file,
 * its text naming the pack's export, each plugin an active rule needs, and the
 * gate's ratchet entry, which init writes only into a fresh config. A text match,
 * so the note says "names": the effective config is what the hook measures.
 */
function checkLint(repo, pack) {
  const l = m.pack.lint;
  const { manifest } = pack;
  const version = installedVersion(repo.root, 'eslint');
  if (version === null) return warn(l.noEslint(manifest.setup.eslint));
  if (!(Number(version.split('.')[0]) >= 9)) return warn(l.oldEslint(version));
  const rel = ESLINT_CONFIGS.find((name) => isFile(path.join(repo.root, name)));
  if (!rel) return warn(manifest.setup.writesConfig ? l.noConfig(manifest.setup.eslint) : l.writeConfig(exportOf(manifest)));
  const spec = exportOf(manifest);
  if (!namesModule(fs.readFileSync(path.join(repo.root, rel), 'utf8'), spec)) {
    const { imports = [], spreads } = handLines(repo.root, rel, [manifest]);
    return warn(l.unnamed(rel, spec, [...imports, ...spreads]));
  }
  const problems = [...missingDeps(repo, pack).map((d) => l.needs(d.install, d.reason)), gateProblem(repo, RATCHET_CHECK, l.noGate)].filter(Boolean);
  const named = l.ok(version, rel, spec);
  return problems.length ? warn([named, ...problems].join('; ')) : pass(named);
}

/** Whether `pack` has an ESLint rule on, and so an export to wire. */
const linted = (pack) => Boolean(pack.manifest.eslintExport) && activeRules(pack).some((rule) => rule.measure === 'eslint');

/**
 * The rows of one declared pack, in readout order: each kind's check, and when it
 * `applies` (a row for a measure the pack has on).
 */
export const PACK_ROWS = Object.freeze({
  declared: { run: (repo, pack) => checkDeclared(pack) },
  rules: { run: checkRules },
  docs: { run: checkDocs },
  lint: { run: checkLint, applies: linted },
  types: { run: checkTypes, applies: (pack) => activeRules(pack).some((rule) => rule.id === 'types') },
});

/** The row name of `pack`'s check `kind`: `pack.expo.rules`. */
export const packRowName = (name, kind) => `pack.${name}.${kind}`;

/**
 * Every row name the packs of `packs` (the registry's table) can add, each pack
 * declared with all its rules on: the inventory the setup skill's recipe covers.
 */
export const packRowNames = (packs) =>
  Object.values(packs).flatMap((manifest) => {
    const pack = { name: manifest.name, manifest, off: new Set() };
    const kinds = Object.entries(PACK_ROWS).filter(([, row]) => !row.applies || row.applies(pack));
    return kinds.map(([kind]) => packRowName(manifest.name, kind));
  });

/** `[name, run]` for every declared pack's rows, in `packs` order; none without a config. */
export function packChecks(repo) {
  if (!repo.config) return [];
  return declaredPacks(repo.config).flatMap((pack) =>
    Object.entries(PACK_ROWS)
      .filter(([, row]) => !row.applies || row.applies(pack))
      .map(([kind, row]) => [packRowName(pack.name, kind), (r, probes) => row.run(repo, pack, probes)]),
  );
}
