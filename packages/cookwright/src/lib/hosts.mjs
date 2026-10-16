// src/lib/hosts.mjs — the host adapter table: what differs per agent host.
//
// A host is the agent program the developer runs (Claude Code, Codex, …). Each has
// its own manifest location, skill format, workflow mechanism and rules file. The
// CLI never hardcodes any of these: it asks this table for the DEFAULT host, which
// is the first entry of `hosts` in cookwright.json.
//
// A host is an entry here, its init steps (init/steps.mjs) and its doctor checks
// (doctor/registry.mjs); an adapter directory under the package's hosts/<name>/
// holds what it runs that is not a skill (Claude Code's workflows).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The session-start hook's three fallback lines, and the command itself. They live
// here, not in messages.mjs: hosts.mjs imports neither messages.mjs nor config.mjs,
// which would close a cycle (config → hosts → messages → config). One shell line in
// three steps, so each absence reads as itself, and every branch ends at exit 0. No
// npx: it contacts the registry before refusing; a direct node call needs no network.
export const HOOK_LINES = Object.freeze({
  noNode: 'cookwright doctor skipped, needs node, run setup',
  notInstalled: 'cookwright doctor skipped: package not installed (npm install)',
  crashed: 'cookwright doctor crashed (exit $?)',
});

/** Where a local install puts the package, relative to the directory it is installed in. */
export const PACKAGE_DIR = 'node_modules/cookwright';

/**
 * The running package's own root. Used only to list what the package ships, never
 * for a path that enters a prompt or a user's repo: those name PACKAGE_DIR.
 */
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Where the package keeps its host-agnostic skills, relative to the package. */
export const SKILLS_DIR = 'skills';

/**
 * The skills the package ships, by name: the level each belongs to and what a host
 * needs for it (`workflows`: a host with a workflow mechanism). This list, not the
 * installed files, is what init writes pointers for and doctor expects; a pointer
 * resolves when its target holds a SKILL.md.
 */
export const SKILLS = Object.freeze({
  setup: Object.freeze({ level: 0 }),
  bundle: Object.freeze({ level: 2, needs: 'workflows' }),
});

/** The level the workflow scripts belong to: the bundle runner's. */
export const WORKFLOWS_LEVEL = 2;

/**
 * Earlier pointer texts (`readlink`), the way HOOK_COMMANDS_PAST lists earlier hook
 * commands: init replaces one, doctor FAILs it. No release has written a pointer yet.
 */
export const POINTER_TEXTS_PAST = Object.freeze([]);

/** The package's own bundle playbook, relative to the package. */
const PLAYBOOK = 'docs/playbook.md';

const HOOK_BIN = `${PACKAGE_DIR}/bin/cookwright.mjs`;

/**
 * The session-start command after `enter`, the step that enters the directory the
 * package is installed under. No path is interpolated: each host's `enter` is fixed.
 */
const hookCommand = (enter) =>
  [
    enter,
    `command -v node >/dev/null 2>&1 || { echo "${HOOK_LINES.noNode}"; exit 0; }`,
    `[ -f ${HOOK_BIN} ] || { echo "${HOOK_LINES.notInstalled}"; exit 0; }`,
    `node ${HOOK_BIN} doctor --hook || echo "${HOOK_LINES.crashed}"`,
  ].join('; ');

/** The SessionStart command init writes and doctor's `host.hook` looks for, verbatim. */
export const HOOK_COMMAND = hookCommand('cd "${CLAUDE_PROJECT_DIR:-.}"');

/** Earlier versions of HOOK_COMMAND: doctor WARNs on one, init replaces it. */
export const HOOK_COMMANDS_PAST = Object.freeze([]);

/**
 * Codex's SessionStart command. Codex runs a hook in the session's cwd and sets no
 * project variable, so the command enters the work tree's top first: the readout
 * judges from there (a known limit: an AGENTS.override.md in a subdirectory the
 * session started in is caught by doctor run there by hand, not by this line).
 */
export const CODEX_HOOK_COMMAND = hookCommand('cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"');

/** Earlier versions of CODEX_HOOK_COMMAND: doctor WARNs on one, init replaces it. */
export const CODEX_HOOK_COMMANDS_PAST = Object.freeze([]);

export const HOSTS = Object.freeze({
  claude: Object.freeze({
    // The host's name in a line the user reads.
    name: 'Claude Code',
    // Where the package keeps the adapter's workflow scripts, relative to the package.
    workflows: 'hosts/claude/workflows',
    // Where a session finds a skill, relative to the work tree's top: the pointers
    // init writes into the installed package's skills. null: the host has no skills.
    skillsDir: '.claude/skills',
    // Where a session finds a named workflow, relative to the work tree's top: the
    // pointers init writes into the installed package. null: the host has no workflows.
    workflowsDir: '.claude/workflows',
    // The files the host reads its rules from, in the order a session should read
    // them; whichever exist are hashed into every prompt. The charter puts rules in
    // AGENTS.md; Claude Code also reads CLAUDE.md, which may be the whole rules file
    // or a pointer to AGENTS.md.
    rules: ['AGENTS.md', 'CLAUDE.md'],
    // The project settings file init wires the SessionStart hook into; a hook in
    // settings.local.json or the user settings is not what init writes.
    settings: '.claude/settings.json',
    hookCommand: HOOK_COMMAND,
    hookCommandsPast: HOOK_COMMANDS_PAST,
    hookTimeout: 10,
    // null: the hook has no matcher, so it runs on every SessionStart source, and a
    // hook is identified by its command alone.
    hookMatcher: null,
    // The command a user trusts the hooks file with, named after init writes it; null: none.
    hookTrust: null,
    // Any of these in the session's cwd or above makes Claude Code ignore a bare
    // AGENTS.md (~/.claude/CLAUDE.md does not count); a root CLAUDE.md carrying
    // `importLine` brings it back.
    shadowing: Object.freeze(['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md']),
    importLine: '@AGENTS.md',
    // The first Claude Code release in which every session reads AGENTS.md.
    agentsNativeSince: '2.1.281',
  }),
  // No workflow mechanism, so no bundle runner and no Level 2 pointers.
  codex: Object.freeze({
    name: 'Codex',
    workflows: null,
    // Codex scans .agents/skills from the cwd up to the repo root.
    skillsDir: '.agents/skills',
    workflowsDir: null,
    rules: ['AGENTS.md'],
    // In a directory holding one, Codex reads it in place of the AGENTS.md beside it.
    shadowing: Object.freeze(['AGENTS.override.md']),
    importLine: null,
    // The project hooks file; the user trusts its hooks once with /hooks, and again
    // after a rewrite, so init rewrites it as rarely as it can.
    settings: '.codex/hooks.json',
    hookCommand: CODEX_HOOK_COMMAND,
    hookCommandsPast: CODEX_HOOK_COMMANDS_PAST,
    hookTimeout: 10,
    // A Codex hook is identified by its command and its matcher: doctor at a fresh
    // session and on resume, not after a clear or a compaction.
    hookMatcher: 'startup|resume',
    hookTrust: '/hooks',
  }),
});

export const KNOWN_HOSTS = Object.keys(HOSTS);

/** The adapter of the default host (the first configured one). */
export const defaultHost = (config) => HOSTS[config.hosts[0]];

/** The configured hosts that have workflows, and every known one that does. */
export const workflowHosts = (hosts = KNOWN_HOSTS) => hosts.filter((h) => HOSTS[h].workflowsDir);

/**
 * The pointer to workflow `name` of the first configured host that has workflows,
 * relative to the work tree's top; null when no configured host has any.
 */
export function workflowScript(config, name) {
  const [host] = workflowHosts(config.hosts);
  return host ? path.posix.join(HOSTS[host].workflowsDir, `${name}.js`) : null;
}

/**
 * Root-relative paths of the candidate rules files every bundle session reads: those
 * of the host the bundle runs in (the first configured one with workflows, as
 * workflowScript picks), else the default host's.
 */
export const rulesFiles = (config) => (HOSTS[workflowHosts(config.hosts)[0]] ?? defaultHost(config)).rules;

const real = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

/** The work tree's top from the config root, POSIX, empty when they are one directory or there is no top (no git). */
export const upToTop = ({ root, top }) =>
  path.relative(real(root), real(top ?? root)).split(path.sep).join('/');

/**
 * The installed package, relative to the config root: its own `node_modules`, else
 * the work tree top's when the root is below the top (a package hoisted there), the
 * first that holds a package.json; null when neither does.
 */
export function installedPackage(repo) {
  const up = upToTop(repo);
  const candidates = [PACKAGE_DIR, ...(up ? [`${up}/${PACKAGE_DIR}`] : [])];
  return candidates.find((rel) => fs.existsSync(path.join(repo.root, rel, 'package.json'))) ?? null;
}

/**
 * The playbook every bundle session reads, relative to the config root: the user's
 * own when `paths.playbook` names one, else the installed package's copy (the
 * config-root form when the package is not installed, so a refusal can name it).
 */
export const playbookPath = (config, repo) =>
  config.paths.playbook ?? path.posix.join(installedPackage(repo) ?? PACKAGE_DIR, PLAYBOOK);
