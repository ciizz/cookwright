// src/lib/packs/types.mjs — the supabase pack's `types` rule, measured: the tracked
// database types against what the local stack generates (stage-4 plan §4.6,
// dispositions 30, 40 and 46). The gate runs it as its own check,
// `npx cookwright standards --types`, so its skip is never folded into the ratchet.
//
// One script shape only, `"db:types": "supabase gen types <args> > <path>"`, with
// `--local` among the args and nothing after the target: no `&&`, `|`, `;`, quote,
// second redirect or `npx` prefix, since the measure runs the same generation
// itself and compares. It runs only when a migration or the types file changed
// since the base (lib/packs/base.mjs). The local stack must hold exactly HEAD's
// migrations, either direction (`supabase migration list --local`), so a migration
// applied for another branch never fails this one. Then the generation's stdout is
// compared with the types file at HEAD, both read, nothing written: a difference
// is a rise (exit 10), every reason it cannot measure a skip (exit 11).

import fs from 'node:fs';
import path from 'node:path';

import { runBounded } from '../budget.mjs';
import { messages } from '../messages.mjs';
import { hasTool } from '../probes.mjs';
import { MIGRATION } from './entries.mjs';
import { activeRules, declaredPacks } from './registry.mjs';
import { commandFailed } from './standards.mjs';

const m = messages.standards.types;

export const TYPES_SCRIPT = 'db:types';
const MIGRATIONS = 'supabase/migrations';
const CAP_MS = 60_000;
const TOKEN = /^[A-Za-z0-9_@%+=:,./-]+$/;
const SHAPE = /^supabase +gen +types((?: +\S+)*?) *> *(\S+)$/;
const ANSI = /\x1b\[[0-9;]*m/g;

const firstLine = (text) => String(text ?? '').trim().split('\n')[0];
// The line is the measure's own text, the CLI's error the detail, for stderr only (a caller records the line).
const skipped = (line, detail) => ({ exit: 11, lines: [line], ...(detail ? { details: [detail] } : {}) });

/** The `db:types` script in `root`'s package.json, or null when there is none to read. */
export function typesScript(root) {
  try {
    const script = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))?.scripts?.[TYPES_SCRIPT];
    return typeof script === 'string' ? script : null;
  } catch {
    return null;
  }
}

/** `{ args, target }` when `script` is the one accepted shape, else null. */
export function typesShape(script) {
  const found = typeof script === 'string' && SHAPE.exec(script.trim());
  if (!found) return null;
  const args = found[1].trim().split(/ +/).filter(Boolean);
  const target = found[2];
  if (![...args, target].every((t) => TOKEN.test(t)) || !args.includes('--local')) return null;
  if (target.startsWith('/') || target.split('/').includes('..')) return null;
  return { args, target };
}

/** Whether the declared packs measure `types`: the supabase pack with the rule on. */
export const typesOn = (config) =>
  declaredPacks(config).some((pack) => activeRules(pack).some((rule) => rule.id === 'types'));

/** A command at the config root, bounded; `{ status, stdout, stderr }`. */
const at = (repo, cmd, args) => runBounded(cmd, args, { cwd: repo.root, encoding: 'utf8', env: repo.env }, CAP_MS);

/** git at the config root, its stdout; a failure throws naming the command. */
function git(repo, args) {
  const r = at(repo, 'git', args);
  if (r.status !== 0) throw commandFailed(`git ${args[0]}`, r);
  return r.stdout;
}

/** The migration versions in HEAD's supabase/migrations, by the files' shape. */
function headVersions(repo) {
  const names = git(repo, ['ls-tree', '--name-only', 'HEAD', '--', `${MIGRATIONS}/`]).split('\n').filter(Boolean);
  return names.map((n) => n.split('/').pop()).filter((n) => MIGRATION.test(n)).map((n) => n.slice(0, 14));
}

/** The versions the local database has applied, from `migration list --local`'s Remote column, or null when unreadable. */
export function appliedVersions(text) {
  const rows = String(text).replace(ANSI, '').split('\n').map((l) => l.split('|').map((c) => c.trim()));
  const header = rows.findIndex((r) => r[0] === 'Local' && r[1] === 'Remote');
  if (header === -1) return null;
  return rows.slice(header + 1).map((r) => r[1]).filter((v) => /^\d+$/.test(v ?? ''));
}

/** The skip when the local stack does not hold exactly HEAD's migrations, or null when it does. */
function stackProblem(repo) {
  const r = at(repo, 'supabase', ['migration', 'list', '--local']);
  if (r.status !== 0) return skipped(m.stackFailed, firstLine(r.stderr) || firstLine(r.stdout) || `exit ${r.status}`);
  const applied = appliedVersions(r.stdout);
  if (applied === null) return skipped(m.stackUnread);
  const head = headVersions(repo);
  const ahead = applied.filter((v) => !head.includes(v)).length;
  const behind = head.filter((v) => !applied.includes(v)).length;
  return ahead || behind ? skipped(m.stackDiffers(ahead, behind)) : null;
}

/** The types file at HEAD, or null when HEAD has none. */
function committed(repo, target) {
  const r = at(repo, 'git', ['show', `HEAD:./${target}`]);
  return r.status === 0 ? r.stdout : null;
}

/** The comparison itself: the generation's stdout against the committed file. */
function compare(repo, shape, since) {
  const gen = at(repo, 'supabase', ['gen', 'types', ...shape.args]);
  if (gen.status !== 0) return skipped(m.genFailed, firstLine(gen.stderr) || `exit ${gen.status}`);
  if (gen.stdout === committed(repo, shape.target)) return { exit: 0, lines: [m.current(shape.target, since)] };
  return { exit: 10, lines: [m.rose(shape.target, TYPES_SCRIPT)] };
}

/**
 * `--types` over `repo` (`{ root, config, env }`, `env` the CLI's and git's):
 * `{ exit, lines }`. `base()` resolves the base, throwing what the line says when
 * none does.
 */
export function measureTypes(repo, { base }) {
  if (!typesOn(repo.config)) return skipped(m.off);
  const script = typesScript(repo.root);
  const shape = typesShape(script);
  if (!shape) return skipped(script === null ? m.noScript(TYPES_SCRIPT) : m.shape(TYPES_SCRIPT));
  if (!hasTool('supabase', { PATH: repo.env.PATH ?? '' })) return skipped(m.needsCli);
  const { sha, since } = base();
  const changed = git(repo, ['diff', '--name-only', sha, 'HEAD', '--', MIGRATIONS, shape.target]).trim();
  if (!changed) return skipped(m.noChange(since));
  return stackProblem(repo) ?? compare(repo, shape, since);
}
