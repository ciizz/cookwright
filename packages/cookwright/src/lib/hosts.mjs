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
