// src/lib/levels.mjs — the level ladder, in one place.
//
// A repo declares its level in cookwright.json (`level`); doctor measures it. Each
// level `requires` doctor checks, by name: a required check that FAILs is drift; one
// that SKIPs leaves the level not verified, never complete; a WARN is reported as
// weak and the level can still read complete (doctor/report.mjs).
//
// This module imports nothing: config.mjs validates `level` against KNOWN_LEVELS, and
// an import of messages.mjs here would close a cycle through config.mjs. The level
// names and summaries live in messages.mjs, keyed by level.

export const LEVELS = Object.freeze({
  0: Object.freeze({
    requires: Object.freeze([
      'config',
      'git',
      'homes.backlog',
      'homes.closeouts',
      'homes.changelog',
      'rules.block',
      'host.rules',
      'host.hook',
      'host.pointers',
      'hooks.path',
      'hooks.pre-commit',
      'hooks.pre-push',
      'tools.gitleaks',
      'gate.scripts',
    ]),
  }),
});

/** The levels this version of cookwright knows, ascending. */
export const KNOWN_LEVELS = Object.freeze(
  Object.keys(LEVELS)
    .map(Number)
    .sort((a, b) => a - b),
);

/** The level above `level`, or null when this version has none. */
export const nextLevel = (level) => (KNOWN_LEVELS.includes(level + 1) ? level + 1 : null);
