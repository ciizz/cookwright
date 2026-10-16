// src/lib/doctor/hosts.mjs — the pointers a host's sessions find cookwright's skills
// and workflows through (stage-3 plan §4.4), read once for init and doctor alike, and
// doctor's `host.pointers` check.
//
// A pointer is a symbolic link at the work tree's top (`.claude/skills/<name>`,
// `.claude/workflows/<name>.js`) into the installed package. Ownership is decided by
// the link's text, never by whether it resolves: a text of our shape is ours, one of
// POINTER_TEXTS_PAST is an earlier pointer, any other link and any real file or
// directory is the user's, never replaced. init's pointers step and this check read
// the same answer, so they never disagree on whose a pointer is.

import fs from 'node:fs';
import path from 'node:path';

import { HOSTS, PACKAGE_DIR, PACKAGE_ROOT, POINTER_TEXTS_PAST, SKILLS, SKILLS_DIR, WORKFLOWS_LEVEL, installedPackage } from '../hosts.mjs';
import { messages } from '../messages.mjs';
import { FAIL, PASS, WARN, fail, pass, warn } from '../verdict.mjs';
import { linkOnPath } from '../init/files.mjs';
import { placement } from './hooks.mjs';
import { gitRun, isFile } from './repo.mjs';

const listDir = (abs) => {
  try {
    return fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return [];
  }
};

/**
 * What the package ships for `host`: `{ kind, name, file, level }` per piece, where
 * `file` is the entry's name in the host's directory. A skill is a directory under
 * the package's skills holding a SKILL.md, written only for a host it can run on; a
 * workflow is a `*.js` under the host adapter's workflows.
 */
export function shippedPieces(host, root = PACKAGE_ROOT) {
  const entry = HOSTS[host];
  const skills = !entry.skillsDir
    ? []
    : listDir(path.join(root, SKILLS_DIR))
        .filter((e) => e.isDirectory() && isFile(path.join(root, SKILLS_DIR, e.name, 'SKILL.md')))
        .map((e) => e.name)
        .filter((name) => SKILLS[name]?.needs !== 'workflows' || entry.workflowsDir)
        .sort()
        .map((name) => ({ kind: 'skill', name, file: name, level: SKILLS[name]?.level ?? WORKFLOWS_LEVEL }));
  const workflows = !entry.workflowsDir
    ? []
    : listDir(path.join(root, entry.workflows))
        .filter((e) => e.isFile() && e.name.endsWith('.js'))
        .map((e) => e.name)
        .sort()
        .map((file) => ({ kind: 'workflow', name: file.slice(0, -3), file, level: WORKFLOWS_LEVEL }));
  return [...skills, ...workflows];
}

/** The pointer's directory under the work tree's top, and the package path it links to. */
const layout = (host, piece) => {
  const entry = HOSTS[host];
  return piece.kind === 'skill'
    ? { dir: entry.skillsDir, inPackage: `${SKILLS_DIR}/${piece.file}` }
    : { dir: entry.workflowsDir, inPackage: `${entry.workflows}/${piece.file}` };
};

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Our link text's shape: `(../)*[<rel>/]node_modules/cookwright/<path in the package>`. */
const oursPattern = (rel, inPackage) =>
  new RegExp(`^(\\.\\./)*${rel ? `(${escape(rel)}/)?` : ''}${escape(`${PACKAGE_DIR}/${inPackage}`)}$`);

const posix = (p) => p.split(path.sep).join('/');
const join = (up, rel) => (up ? `${up}/${rel}` : rel);

/**
 * One pointer as it stands. `rel` is root-relative (where init writes), `target`
 * the link text init would write now: the POSIX path from the pointer's directory
 * into the installed package, or into the config root's `node_modules` when the
 * package is not installed. `state` is `none`, `ours`, `past`, `theirsLink` (any
 * other link), `theirs` (a file or directory) or `linkedParent` (a component of the
 * pointer's directory is a link, `parent` names it, root-relative).
 */
export function readPointer(repo, host, piece, past = POINTER_TEXTS_PAST) {
  const top = repo.top ?? repo.root;
  const at = placement(repo.root, top);
  const { dir, inPackage } = layout(host, piece);
  const fromTop = `${dir}/${piece.file}`;
  const rel = join(at.up, fromTop);
  const abs = path.join(repo.root, rel);
  const pkg = installedPackage(repo) ?? PACKAGE_DIR;
  const target = posix(path.relative(path.dirname(abs), path.join(repo.root, pkg, inPackage)));
  const base = { ...piece, host, rel, fromTop, target, resolves: false, targetResolves: fs.existsSync(path.join(path.dirname(abs), target)) };
  const parent = linkOnPath(top, dir);
  if (parent) return { ...base, state: 'linkedParent', parent: join(at.up, parent) };
  let st;
  try {
    st = fs.lstatSync(abs);
  } catch (err) {
    // ENOTDIR: a file of the user's stands where the pointer's directory would be.
    return { ...base, state: err.code === 'ENOENT' ? 'none' : 'theirs' };
  }
  if (!st.isSymbolicLink()) return { ...base, state: 'theirs' };
  const text = fs.readlinkSync(abs);
  const resolves = fs.existsSync(abs);
  const state = past.includes(text) ? 'past' : oursPattern(at.rel, inPackage).test(text) ? 'ours' : 'theirsLink';
  return { ...base, state, text, resolves };
}

/** Every pointer of `host`, as `readPointer` reads it; `io.shipped` and `io.past` are the tests' seams. */
export const hostPointers = (repo, host, io = {}) =>
  (io.shipped ?? shippedPieces)(host).map((piece) => readPointer(repo, host, piece, io.past));

/**
 * An ours pointer that does not resolve while the text init would write now does:
 * written before the package was installed, then installed elsewhere (hoisted).
 */
export const misdirected = (p) => p.state === 'ours' && !p.resolves && p.text !== p.target && p.targetResolves;

// ── doctor's check (plan §4.4) ──────────────────────────────────────────────

const m = messages.doctor.pointers;

/** The top-relative paths among `rels` that git tracks; empty without a work tree. */
function tracked(repo, rels) {
  if (!rels.length || !repo.workTree) return new Set();
  const r = gitRun(repo.top ?? repo.root, ['ls-files', '-z', '--', ...rels]);
  if (r.status !== 0) throw new Error(messages.probeFailed('git ls-files', (r.stderr || '').trim() || `exit ${r.status}`));
  return new Set(r.stdout.split('\0').filter(Boolean));
}

/**
 * One pointer's verdict. `untracked` holds the top-relative paths git does not track;
 * it is empty when tracking cannot be read (no git, no work tree), so the ignored
 * probe never runs where git cannot answer (rule: every piece is optional).
 */
function judge(p, { level, platform, untracked, probes, top }) {
  if (p.state === 'none') {
    if (platform === 'win32') return warn(m.windows(p.rel));
    return p.level <= level ? fail(m.missing(p.rel)) : warn(m.notRequired(p.name, p.level, level));
  }
  if (p.state === 'past') return fail(m.past(p.rel));
  if (p.state === 'theirsLink') return warn(m.theirsLink(p.rel, p.name));
  if (p.state === 'theirs') return warn(m.theirs(p.rel, p.name));
  if (p.state === 'linkedParent') return warn(m.linkedParent(p.parent, p.name));
  if (misdirected(p)) return warn(m.misdirected(p.rel));
  if (!p.resolves) return warn(m.notInstalled(p.rel));
  if (untracked.has(p.fromTop) && probes.ignored(top, p.fromTop)) return warn(m.ignored(p.rel));
  return pass();
}

const RANK = { [FAIL]: 0, [WARN]: 1, [PASS]: 2 };

/** `claude: 1 skill, 2 workflows`, from a host's pointers; a host with no workflows (codex) names skills only. */
const counts = (host, pointers) => {
  const n = (kind) => pointers.filter((p) => p.kind === kind).length;
  return m.counts(host, n('skill'), HOSTS[host].workflowsDir ? n('workflow') : null);
};

/**
 * `host.pointers`, every configured host: PASS with the counts when every pointer
 * is ours and resolves; otherwise the worst status, with each pointer that is not
 * PASS named, worst first. At the declared level, only a missing pointer of a piece
 * at or below it is drift. `platform` is the tests' seam for Windows.
 */
export function checkPointers(repo, probes, { platform = process.platform, ...io } = {}) {
  const top = repo.top ?? repo.root;
  const byHost = repo.config.hosts.map((host) => [host, hostPointers(repo, host, io)]);
  const all = byHost.flatMap(([, ps]) => ps);
  const ours = all.filter((p) => p.state === 'ours' && p.resolves).map((p) => p.fromTop);
  const gitReads = repo.hasGit && repo.workTree;
  const known = gitReads ? tracked(repo, ours) : null;
  const untracked = new Set(gitReads ? ours.filter((rel) => !known.has(rel)) : []);
  const ctx = { level: repo.config.level, platform, untracked, probes, top };
  const verdicts = all.map((p) => ({ p, v: judge(p, ctx) }));
  const open = verdicts.filter(({ v }) => v.status !== PASS).sort((a, b) => RANK[a.v.status] - RANK[b.v.status]);
  if (!open.length) return pass(byHost.map(([host, ps]) => counts(host, ps)).join('; '));
  const note = open.map(({ p, v }) => m.named(p.host, v.note)).join('; ');
  return open[0].v.status === FAIL ? fail(note) : warn(note);
}
