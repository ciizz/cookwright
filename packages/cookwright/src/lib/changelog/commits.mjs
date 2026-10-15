// src/lib/changelog/commits.mjs — a release's commits and what their conventional
// subjects say (plan §4.4).
//
// A release holds the commits reachable from its tag and from no earlier version
// (`<tag> --not <every lower version>`), so a maintenance release merged later is
// listed once, under its own version, and never as unreleased.

import { git } from './tags.mjs';

// `-c log.showSignature=false`: a signer's own setting would add gpg lines and make
// the render machine-dependent.
const LOG = ['-c', 'log.showSignature=false', 'log', '--format=%H%x1f%s'];

/** `[{ sha, subject }]`, newest first, reachable from `tip` and from none of `not`. */
export function commitsBetween(root, tip, not = []) {
  const out = git(root, [...LOG, tip, '--not', ...not, '--'], 'log');
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, subject = ''] = line.split('\x1f');
      return { sha, subject };
    });
}

const CONVENTIONAL = /^([a-z]+)(?:\(([^)]*)\))?(!)?: (.+)$/;

/** The types that are user-visible, each with its section title, in render order. */
export const SECTIONS = Object.freeze([
  ['feat', 'Features'],
  ['fix', 'Fixes'],
  ['perf', 'Performance'],
]);
const VISIBLE = new Set(SECTIONS.map(([type]) => type));

/**
 * `{ type, scope, breaking, text }` for a user-visible conventional subject
 * (`feat`, `fix`, `perf`), or null: everything else counts as internal.
 */
export function classify(subject) {
  const m = CONVENTIONAL.exec(subject);
  if (!m || !VISIBLE.has(m[1])) return null;
  return { type: m[1], scope: m[2] || null, breaking: m[3] === '!', text: m[4] };
}
