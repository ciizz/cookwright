// src/lib/packs/standards.mjs — the standards engine: the declared packs' ESLint
// rules, counted per file over git's blobs (stage-4 plan §4.5, dispositions 26, 28,
// 29, 31, 41, 47).
//
// Async end to end (ESLint's Node API is Promise-based), so the hook never runs it
// in process: the pre-commit check spawns `cookwright standards --staged`, which
// calls this. ESLint is the repo's own, resolved from the config root (`io.loadESLint`
// is the tests' seam); nothing here depends on it.
//
// One path base (disposition 28): every entry is a path relative to the work tree's
// top; git runs at the top with the config root as pathspec, so a sibling
// workspace is never listed; ESLint gets the absolute path and runs with its cwd at
// the config root; a line shows the path from the config root. Both sides of a
// count are blobs (the index's, a commit's), never the working tree, and nothing is
// written. A symbolic link or a submodule is never linted (disposition 19).
//
// A rule counts only when `wired` finds it in the effective config as the pack set
// it (disposition 29): severity error, the pack's tag in a shared id's options, the
// manifest's options. A rule switched off, overridden, not wired or missing its
// plugin counts nothing and is named on the line (disposition 37). Then per file
// (`scopeAt`): a file counts only by the rules whose pack blocks cover it, and a
// covered file the repo's config ignores, or where a later block changed a covering
// rule, is not measured rather than counted 0.

import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { TimedOut, runBounded } from '../budget.mjs';
import { installed } from '../init/packs.mjs';
import { messages } from '../messages.mjs';
import { blockCovers } from './glob.mjs';
import { activeRules, declaredPacks } from './registry.mjs';

const m = messages.standards;

/** Exit codes: a count rose (the hook's FINDINGS_EXIT), and cannot measure (the gate's skipExit). */
export const ROSE_EXIT = 10;
export const SKIP_EXIT = 11;
/** Each git call's ceiling: the hook bounds the whole child at the same 60 s. */
export const GIT_CAP_MS = 60_000;

const LINTED = /\.(tsx|ts|jsx|js)$/;
const REGULAR = new Set(['100644', '100755']);
const BATCH = 500;
const MEASURED = 'measured';
const ABSENT = 'absent';

const posix = (p) => p.split(path.sep).join('/');
const firstLine = (err) => String(err?.message ?? err).split('\n')[0];

/**
 * A state in which the engine cannot measure at all: its message is the line, exit
 * 11. A line is always the engine's own text: a caller records it (the gate, in
 * the bundle's state), so an exception's message, which can carry a local path or
 * a source literal, never goes in it; it is the `detail`, printed on stderr.
 */
export class Unmeasurable extends Error {
  constructor(line, detail) {
    super(line);
    if (detail) this.detail = detail;
  }
}

/**
 * The declared packs' ESLint rules that are on, as `{ key, pack, rule }`: `key` is
 * `<pack> <rule>`, the name a line gives it.
 */
export const eslintRules = (config) =>
  declaredPacks(config).flatMap((pack) =>
    activeRules(pack)
      .filter((rule) => rule.measure === 'eslint')
      .map((rule) => ({ key: `${pack.name} ${rule.id}`, pack, rule })),
  );

/** ESLint 9 or later from the config root, as `{ eslint, version }`; Unmeasurable otherwise. */
export async function loadESLint(root, setup) {
  let entry;
  try {
    entry = createRequire(path.join(root, 'package.json')).resolve('eslint');
  } catch {
    throw new Unmeasurable(m.noEslint(setup));
  }
  const mod = await import(pathToFileURL(entry).href);
  const ESLint = mod.ESLint ?? mod.default?.ESLint;
  const version = String(ESLint?.version ?? '');
  if (!ESLint || !(Number(version.split('.')[0]) >= 9)) throw new Unmeasurable(m.oldEslint(version));
  return { eslint: new ESLint({ cwd: root }), version };
}

// ── wired: the effective config against what the pack set (disposition 29) ──

/** Whether any string under `value` starts with `tag`. */
const tagged = (value, tag) =>
  typeof value === 'string'
    ? value.startsWith(tag)
    : Boolean(value) && typeof value === 'object' && Object.values(value).some((v) => tagged(v, tag));

const subset = (want, have) =>
  Object.entries(want).every(([k, v]) => Boolean(have) && typeof have === 'object' && isDeepStrictEqual(have[k], v));

/** One ESLint id's effective entry against `rule` at a sample: MEASURED, ABSENT or overridden. */
function judge(entry, rule, want) {
  if (entry === undefined) return ABSENT;
  const [severity, ...options] = [].concat(entry);
  if (severity !== 2 && severity !== 'error') return 'overridden';
  if (rule.eslint.tag && !tagged(options, rule.eslint.tag)) return 'overridden';
  return subset(want, options[0]) ? MEASURED : 'overridden';
}

/** Why a rule absent from the effective config is not measured: its missing plugin, or the export not spread. */
function absent(root, { pack, rule }) {
  const dep = rule.needs && pack.manifest.deps.find((d) => d.package === rule.needs);
  if (dep && !installed(root, dep.package)) return { state: 'needs', why: m.needs(dep.install) };
  return { state: 'unwired', why: m.notWired(`cookwright/${pack.manifest.eslintExport}`) };
}

/** How one rule is measured: `{ state, why? }`, `state` MEASURED, `needs`, `unwired` or `overridden`. */
async function wiring(eslint, root, item) {
  for (const { sample, expect: want } of item.rule.eslint.options) {
    const config = await eslint.calculateConfigForFile(path.join(root, sample));
    for (const id of item.rule.eslint.ruleIds) {
      const state = judge(config?.rules?.[id], item.rule, want);
      if (state === ABSENT) return absent(root, item);
      if (state !== MEASURED) return { state, why: m.overridden };
    }
  }
  return { state: MEASURED };
}

/**
 * Every rule of `rules` with its wiring: `{ measured, skipped }`, `skipped` the
 * line parts naming each unmeasured rule. A config ESLint cannot load is Unmeasurable.
 */
export async function wired(eslint, root, rules) {
  let states;
  try {
    states = await Promise.all(rules.map((item) => wiring(eslint, root, item)));
  } catch (err) {
    throw new Unmeasurable(m.configFailed, firstLine(err));
  }
  const measured = rules.filter((_, i) => states[i].state === MEASURED);
  const skipped = rules.flatMap((item, i) => (states[i].state === MEASURED ? [] : [m.ruleSkipped(item.key, states[i].why)]));
  return { measured, skipped };
}

// ── scope: which measured rules cover a file, and whether they hold there ──

const own = createRequire(import.meta.url);

/** The blocks of `pack`'s export as this package ships it; `coverage` when it has one (every block, whatever resolves). */
function exportBlocks(pack) {
  const exported = own(`../../../${pack.manifest.eslintExport}`);
  return [...(exported.coverage ?? exported)];
}

/**
 * Where each rule of `measured` reaches, by its pack's own blocks: `[{ item, blocks }]`,
 * `blocks` those that set one of its ESLint ids (each id is set by its rule's blocks
 * only, which eslint.test.mjs keeps true).
 */
export function coverage(measured) {
  const byPack = new Map();
  const blocksOf = (pack) => byPack.get(pack.name) ?? byPack.set(pack.name, exportBlocks(pack)).get(pack.name);
  return measured.map((item) => ({
    item,
    blocks: blocksOf(item.pack).filter((b) => item.rule.eslint.ruleIds.some((id) => b.rules && id in b.rules)),
  }));
}

/** Whether the effective `entry` is what the pack's `block` set for `id`: severity error and the same options. */
function asSet(entry, block, id) {
  const [severity, ...options] = [].concat(entry ?? []);
  const [, ...want] = [].concat(block.rules[id]);
  return (severity === 2 || severity === 'error') && isDeepStrictEqual(options, want);
}

/** The keys of the covering rules whose effective entry at the file is not the pack's last covering block's. */
const changedAt = (config, covering) =>
  covering
    .filter(({ item, blocks }) => item.rule.eslint.ruleIds.some((id) => {
      const last = blocks.findLast((b) => id in b.rules);
      return last && !asSet(config.rules?.[id], last, id);
    }))
    .map(({ item }) => item.key);

/**
 * The measured rules that cover the file at `topRel` and hold there, as `{ rules }`
 * (none when no pack block reaches the file: it is not under a pack's rules), or
 * `{ unmeasured, detail? }` when one reaches it but the repo's config ignores the
 * file or a later block changed the rule for it. The samples `wired` reads cannot
 * see a path-specific ignore or override; this reads the file's own config.
 */
export async function scopeAt(eslint, top, root, topRel, cover) {
  const abs = path.join(top, topRel);
  const rel = posix(path.relative(root, abs));
  const covering = cover.map((c) => ({ ...c, blocks: c.blocks.filter((b) => blockCovers(b, rel)) })).filter((c) => c.blocks.length);
  if (!covering.length) return { rules: [] };
  let config;
  try {
    config = await eslint.calculateConfigForFile(abs);
  } catch (err) {
    return { unmeasured: m.configAtFile, detail: firstLine(err) };
  }
  if (!config) return { unmeasured: m.fileIgnored };
  const changed = changedAt(config, covering);
  return changed.length ? { unmeasured: m.changedHere(changed) } : { rules: covering.map((c) => c.item) };
}

// ── entries: what git lists, every path relative to the top ──

/** The Unmeasurable for a command that failed: its name and exit on the line, its stderr the detail. */
export const commandFailed = (what, r) =>
  new Unmeasurable(m.couldNotRun(messages.probeFailed(what, `exit ${r.status ?? r.error?.code ?? 'none'}`)), String(r.stderr || r.error?.message || '').trim().split('\n')[0]);

/** git at the top; a failure is Unmeasurable naming the command, a timeout is TimedOut. */
function git(top, args, { env, input, encoding = 'utf8' } = {}) {
  const opts = { cwd: top, encoding, ...(env ? { env } : {}), ...(input === undefined ? {} : { input }) };
  const r = runBounded('git', args, opts, GIT_CAP_MS);
  if (r.timedOut) throw new TimedOut(`git ${args[0]}`);
  if (r.status !== 0) throw commandFailed(`git ${args[0]}`, r);
  return r.stdout;
}

/** The config root as a pathspec from the top: `.` when they are one directory. */
export const rootSpec = (top, root) => {
  const rel = posix(path.relative(top, root));
  return rel ? `:(literal)${rel}` : '.';
};

/**
 * `git diff --raw -z` output as entries `{ status, path, basePath, mode, baseMode,
 * sha, baseSha }`; a rename's (or copy's) `basePath` is its source path.
 */
export function parseRaw(out) {
  const parts = out.split('\0');
  const entries = [];
  for (let i = 0; i < parts.length; ) {
    const head = parts[i++];
    if (!head.startsWith(':')) continue;
    const [baseMode, mode, baseSha, sha, code] = head.slice(1).split(' ');
    const status = code[0];
    const basePath = parts[i++];
    const to = 'RC'.includes(status) ? parts[i++] : basePath;
    entries.push({ status, path: to, basePath, mode, baseMode, sha, baseSha });
  }
  return entries;
}

/**
 * The staged entries under the config root, against HEAD (an unborn HEAD lists every
 * file as added). A type change (T) is listed too: a link replaced by a regular file
 * is linted with no HEAD side (`hasBase` reads the link's mode), and a file replaced
 * by a link is not linted (`lintable` reads the new mode).
 */
export function stagedEntries(top, root, env) {
  const args = ['diff', '--cached', '--raw', '-z', '--no-abbrev', '-M', '--diff-filter=ACMRTD', '--', rootSpec(top, root)];
  return parseRaw(git(top, args, { env }));
}

/** The entries under the config root that changed from commit `base` to HEAD, both sides commits (disposition 2). */
export function rangeEntries(top, root, base, env) {
  const args = ['diff', '--raw', '-z', '--no-abbrev', '-M', '--diff-filter=ACMRTD', base, 'HEAD', '--', rootSpec(top, root)];
  return parseRaw(git(top, args, { env }));
}

/** HEAD's files under the config root as entries, or null on an unborn HEAD. */
export function headEntries(top, root, env) {
  const rel = posix(path.relative(top, root));
  const verify = runBounded('git', ['rev-parse', '--verify', '-q', 'HEAD^{commit}'], { cwd: top, ...(env ? { env } : {}) }, GIT_CAP_MS);
  if (verify.status !== 0) return null;
  const out = git(top, ['ls-tree', '-r', '-z', 'HEAD', '--', ...(rel ? [rel] : [])], { env });
  return out
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const [meta, file] = line.split('\t');
      const [mode, , sha] = meta.split(' ');
      return { status: 'M', path: file, basePath: file, mode, baseMode: mode, sha, baseSha: sha };
    });
}

/** Whether the engine lints `entry`'s new side: a regular file of a linted extension. */
export const lintable = (entry) => entry.status !== 'D' && REGULAR.has(entry.mode) && LINTED.test(entry.path);

/** Whether `entry` has a HEAD side to lint: not added, and a regular file there. */
export const hasBase = (entry) => entry.status !== 'A' && REGULAR.has(entry.baseMode);

/** Whether a deletion would have been linted: what the line's "not counted" counts. */
export const deletedLintable = (entry) => entry.status === 'D' && REGULAR.has(entry.baseMode) && LINTED.test(entry.basePath);

// ── blobs and counts ──

/** `git cat-file --batch` output into `blobs` (sha → text, null when missing). */
function parseBatch(buf, blobs) {
  let at = 0;
  while (at < buf.length) {
    const nl = buf.indexOf(10, at);
    const [sha, type, size] = buf.toString('utf8', at, nl).split(' ');
    at = nl + 1;
    if (type !== 'blob') {
      blobs.set(sha, null);
      continue;
    }
    blobs.set(sha, buf.toString('utf8', at, at + Number(size)));
    at += Number(size) + 1;
  }
}

/** The text of each blob in `shas`, read in batches: one git call per BATCH blobs. */
export function readBlobs(top, shas, env) {
  const wanted = [...new Set(shas)];
  const blobs = new Map();
  for (let i = 0; i < wanted.length; i += BATCH) {
    const input = `${wanted.slice(i, i + BATCH).join('\n')}\n`;
    parseBatch(git(top, ['cat-file', '--batch'], { env, input: Buffer.from(input), encoding: 'buffer' }), blobs);
  }
  return blobs;
}

/**
 * ESLint's messages of one file counted by pack rule: severity 2, an id of a
 * measured rule and, on a shared id, the rule's tag in the message: anywhere, since
 * ESLint renders some rules' configured message after its own text
 * (no-restricted-imports: `'<name>' import is restricted from being used. <message>`). Returns
 * `{ counts: Map(key → n), findings: [{ key, line, column, text }] }`, `text` the
 * manifest's own line, never ESLint's.
 */
export function countBy(results, measured) {
  const counts = new Map();
  const findings = [];
  for (const msg of results) {
    if (msg.severity !== 2) continue;
    const owner = measured.find(
      ({ rule }) => rule.eslint.ruleIds.includes(msg.ruleId) && (!rule.eslint.tag || String(msg.message).includes(rule.eslint.tag)),
    );
    if (!owner) continue;
    counts.set(owner.key, (counts.get(owner.key) ?? 0) + 1);
    findings.push({ key: owner.key, line: msg.line, column: msg.column, text: owner.pack.manifest.messages[owner.rule.id] });
  }
  return { counts, findings };
}

/** The counts of nothing: the absent side of an added file. */
export const NOTHING = Object.freeze({ counts: new Map(), findings: [] });

/**
 * One side of one file: `code` linted as the file at `topRel`. A blob git could not
 * read, a parsing error or a rejected lint is `{ unmeasured: why, detail? }`, `why`
 * the engine's own text and `detail` the exception's first line, for stderr only.
 */
export async function lintAt(eslint, top, topRel, code, measured) {
  if (code === null || code === undefined) return { unmeasured: m.noBlob };
  let results;
  try {
    [results] = await eslint.lintText(code, { filePath: path.join(top, topRel) });
  } catch (err) {
    return { unmeasured: m.lintThrew, detail: firstLine(err) };
  }
  const messagesOf = results?.messages ?? [];
  const fatal = messagesOf.find((x) => x.fatal);
  if (fatal) return { unmeasured: m.parseError(fatal.line, fatal.column) };
  return countBy(messagesOf, measured);
}

/** How a line shows the top-relative `topRel`: from the config root. */
export const shownPath = (top, root, topRel) => posix(path.relative(root, path.join(top, topRel)));

/** A finding as its line (disposition 41). */
export const render = (file, f) => m.finding(file, f.line, f.column, f.key, f.text);
