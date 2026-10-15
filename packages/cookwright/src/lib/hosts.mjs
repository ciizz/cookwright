// src/lib/hosts.mjs — the host adapter table: what differs per agent host.
//
// A host is the agent program the developer runs (Claude Code, Codex, …). Each has
// its own manifest location, skill format, workflow mechanism and rules file. The
// CLI never hardcodes any of these: it asks this table for the DEFAULT host, which
// is the first entry of `hosts` in cookwright.json.
//
// Stage 0 knows one host. A second host is a second entry here plus an adapter
// directory under hosts/<name>/; nothing else changes.

import path from 'node:path';

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

const HOOK_BIN = 'node_modules/cookwright/bin/cookwright.mjs';

/**
 * The SessionStart command init writes and doctor's `host.hook` looks for, verbatim.
 * Claude's cwd may be a subdirectory of the repo and the package hoisted to a
 * workspace root, so the bin is looked for from the cwd upward, as node resolves a
 * package; doctor then runs in the cwd and finds the root itself.
 */
export const HOOK_COMMAND = [
  'cd "${CLAUDE_PROJECT_DIR:-.}"',
  `command -v node >/dev/null 2>&1 || { echo "${HOOK_LINES.noNode}"; exit 0; }`,
  `d=$PWD; until [ -f "$d/${HOOK_BIN}" ] || [ "$d" = / ]; do d=$(dirname "$d"); done`,
  `[ -f "$d/${HOOK_BIN}" ] || { echo "${HOOK_LINES.notInstalled}"; exit 0; }`,
  `node "$d/${HOOK_BIN}" doctor --hook || echo "${HOOK_LINES.crashed}"`,
].join('; ');

/**
 * Earlier versions of HOOK_COMMAND, byte for byte as they were written: doctor WARNs
 * on one, init replaces it. Literals, never rebuilt from HOOK_LINES.
 */
export const HOOK_COMMANDS_PAST = Object.freeze([
  // stage-1, before the upward search
  'cd "${CLAUDE_PROJECT_DIR:-.}"; command -v node >/dev/null 2>&1 || { echo "cookwright doctor skipped, needs node, run setup"; exit 0; }; [ -f node_modules/cookwright/bin/cookwright.mjs ] || { echo "cookwright doctor skipped: package not installed (npm install)"; exit 0; }; node node_modules/cookwright/bin/cookwright.mjs doctor --hook || echo "cookwright doctor crashed (exit $?)"',
]);

export const HOSTS = Object.freeze({
  claude: Object.freeze({
    // Where this repo keeps the adapter's workflow scripts, relative to the root.
    workflows: 'hosts/claude/workflows',
    skills: 'hosts/claude/skills',
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
    // Any of these in the session's cwd or above makes Claude Code ignore a bare
    // AGENTS.md (~/.claude/CLAUDE.md does not count); a root CLAUDE.md carrying
    // `importLine` brings it back.
    shadowing: Object.freeze(['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md']),
    importLine: '@AGENTS.md',
    // The first Claude Code release in which every session reads AGENTS.md.
    agentsNativeSince: '2.1.281',
  }),
});

export const KNOWN_HOSTS = Object.keys(HOSTS);

/** The adapter of the default host (the first configured one). */
export const defaultHost = (config) => HOSTS[config.hosts[0]];

/** Root-relative path of a workflow script of the default host. */
export const workflowScript = (config, name) =>
  path.posix.join(defaultHost(config).workflows, `${name}.js`);

/** Root-relative paths of the default host's candidate rules files. */
export const rulesFiles = (config) => defaultHost(config).rules;
