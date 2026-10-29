// src/lib/secret/backends/onepassword.mjs — the 1Password backend (stage-5 plan
// §4.3, dispositions 15, 30, 50, 53): a target's values are items in 1Password,
// named by `secrets/<target>.env.tpl`, a tracked template of references and
// nothing else. `op inject` resolves them; cookwright never writes an item, so
// `secrets set` and `secrets init` refuse with one line.
//
// The template's grammar (disposition 15): a line is `NAME=op://<vault>/<item>/<field>`
// or `NAME=op://<vault>/<item>/<section>/<field>`, each segment of letters, digits,
// spaces, `.`, `_` and `-` (so no `$`, `{` or `}`, which `op inject` would expand
// from the environment), a blank line, or a `#` comment that does not itself look
// like `NAME=…`. Anything else is a literal: `run` refuses it and doctor FAILs it,
// naming the line number, never printing the line.
//
// `op inject` copies a template's comment and blank lines into its output, so it is
// fed only the reference lines, one per declared name, each reference wrapped in
// `{{ }}`, op's documented template form, so a vault or item name holding a space is
// read whole (stage-5 review:engine finding 8). They go in a private temporary file
// (mode 600 in a mode 700 directory under the OS temp folder, removed whatever
// happens), named by `-i`: `op` refuses a stdin that is not a pipe, and Node hands a
// child's stdin over as a socket (stage-5 qa round 2, P1). The file holds references
// only, the lines already committed, never a value. Its output is read against them
// in order (stage-5 s2's decision, disposition 53):
// exactly one `NAME=value` line per reference, so a field holding more than one line
// is refused. `op` runs with the scrubbed environment; its own control names (a
// service-account token, a Connect host, a session) reach it and never the child
// (disposition 50).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { messages } from '../../messages.mjs';
import { fail, pass, warn } from '../../verdict.mjs';
import { templateOf } from '../config.mjs';
import { Refused } from '../engine.mjs';
import { parseAgainst } from '../envfile.mjs';

const m = messages.secrets;
const o = m.op;
const t = messages.doctor.secretsTargets;

const SEG = '[A-Za-z0-9 ._-]+';
const REF_LINE = new RegExp(`^([A-Z][A-Z0-9_]*)=(op://${SEG}/${SEG}(?:/${SEG})?/${SEG})$`);
/** A comment that looks like an assignment, `# DB_URL=…`, may hold a value: a literal. */
const COMMENTED_ASSIGNMENT = /^\s*#\s*(export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=/;

const firstLine = (text) => (text ?? '').trim().split('\n')[0];
/** op's first line is about sign-in (not signed in, a locked app, a dismissed prompt): the hint applies. */
const SIGN_IN = /sign(ed)?[ -]?in|unlock|locked|authori[sz]/i;

/**
 * A template's lines (disposition 15): `{ refs: [{ name, ref, line }], literals:
 * [line numbers] }`. A trailing CR is dropped, so a Windows checkout reads alike.
 */
export function parseTemplate(text) {
  const refs = [];
  const literals = [];
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  for (const [i, raw] of lines.entries()) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.trim() === '') continue;
    if (line.trimStart().startsWith('#') && !COMMENTED_ASSIGNMENT.test(line)) continue;
    const found = REF_LINE.exec(line);
    if (found) refs.push({ name: found[1], ref: found[2], line: i + 1 });
    else literals.push(i + 1);
  }
  return { refs, literals };
}

/**
 * The first problem of a parsed template against the target's `names`: a literal,
 * a name referenced twice, a reference to an undeclared name, a declared name with
 * no reference; null when it holds exactly one reference per declared name.
 */
export function templateProblem({ refs, literals }, names) {
  if (literals.length) return { why: 'literal', lines: literals };
  const seen = new Set();
  for (const { name } of refs) {
    if (seen.has(name)) return { why: 'duplicate', name };
    if (!names.includes(name)) return { why: 'undeclared', name };
    seen.add(name);
  }
  const missing = names.find((n) => !seen.has(n));
  return missing === undefined ? null : { why: 'missing', name: missing };
}

/** The template of target `name`, parsed, or null when the file is absent. */
function readTemplate(name, ctx) {
  const file = path.join(ctx.root, templateOf(name));
  if (!fs.existsSync(file)) return null;
  return parseTemplate(fs.readFileSync(file, 'utf8'));
}

/**
 * `fn(file)` with `text` (reference lines, never a value) in a private temporary
 * file: mode 600 in a fresh mode 700 directory under the OS temp folder, both
 * removed whatever `fn` does.
 */
export function withReferenceFile(text, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cookwright-op-'));
  try {
    fs.chmodSync(dir, 0o700);
    const file = path.join(dir, 'references.tpl');
    fs.writeFileSync(file, text, { mode: 0o600, flag: 'wx' });
    return fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** `resolve`: the target's values through `op inject`, read against its references (disposition 53). */
export function resolve(name, ctx) {
  const target = ctx.config.secrets.targets[name];
  const rel = templateOf(name);
  const parsed = readTemplate(name, ctx);
  if (!parsed) throw new Refused(o.noTemplate(rel));
  const problem = templateProblem(parsed, target.names);
  if (problem) throw new Refused(o.template[problem.why]({ ...problem, rel, target: name }));
  const lines = parsed.refs.map((r) => `${r.name}={{ ${r.ref} }}\n`).join('');
  const res = withReferenceFile(lines, (file) =>
    ctx.probes.capture('op', ['inject', '-f', '-i', file], { env: ctx.env, cwd: ctx.root }),
  );
  if (res.status !== 0) {
    const line = firstLine(res.stderr || res.error?.message);
    throw new Refused(o.failed(line, SIGN_IN.test(line)));
  }
  const read = parseAgainst(res.stdout, parsed.refs.map((r) => r.name), { ordered: true });
  if (read.problem) throw new Refused(o.resolved(name, m.envfile[read.problem.why](read.problem)));
  return read.values;
}

/** `set` and `init`: items are written in 1Password, never by cookwright. */
function refuseWrite() {
  throw new Refused(o.noWrite);
}

/**
 * Doctor's look at target `name` (disposition 7): the template present, tracked
 * and parsed, never resolved. `ctx.states` maps each backend file to its git state.
 */
export function inspect(name, ctx) {
  const rel = templateOf(name);
  const parsed = readTemplate(name, ctx);
  if (!parsed) return warn(t.op.noTemplate(name, rel));
  const problem = templateProblem(parsed, ctx.config.secrets.targets[name].names);
  if (problem?.why === 'literal') return fail(t.op.literal(name, rel, problem.lines));
  if (problem) return warn(t.target(name, o.template[problem.why]({ ...problem, rel, target: name })));
  const state = ctx.states.get(rel);
  if (state !== 'tracked') return warn(t.file(name, rel, state));
  return pass(t.op.ok(name));
}

/** The 1Password backend's description, as backends/index.mjs registers it. */
export const ONEPASSWORD = Object.freeze({
  name: '1password',
  tools: { resolve: ['op'] },
  install: o.install,
  control: ['OP_SERVICE_ACCOUNT_TOKEN', 'OP_CONNECT_HOST', 'OP_CONNECT_TOKEN', 'OP_SESSION_*'],
  files: (target) => [templateOf(target)],
  resolve,
  set: refuseWrite,
  init: refuseWrite,
  /** Doctor's `secrets.backend` once `op` is on PATH: sign-in is proved at `run` (disposition 45). */
  health: () => pass(messages.doctor.secretsBackend.op),
  inspect,
});
