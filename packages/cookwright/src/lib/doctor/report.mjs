// src/lib/doctor/report.mjs — doctor's readout: one line per check, the counts, and
// the level line that measures the declared level against what it requires.
//
// The level line is a truth table over the level's required checks (B-013): any
// FAIL is drift; else any SKIP is "not verified", since a check that could not
// measure claims nothing; else complete. A WARN was measured, so it never keeps
// the level from complete: it is named as weak on any of the three lines.

import { LEVELS, nextLevel } from '../levels.mjs';
import { messages } from '../messages.mjs';
import { FAIL, PASS, SKIP, WARN, summarize } from '../verdict.mjs';

const m = messages.doctor;

const named = (rows, names, status) =>
  rows.filter(([name, r]) => names.includes(name) && r.status === status).map(([name]) => name);

/** The level line's head: drift, not verified, or complete. */
function levelHead(level, missing, unverified) {
  if (missing.length) return m.levelDrift(level, missing);
  return unverified.length ? m.levelNotVerified(level, unverified) : m.levelComplete(level);
}

/**
 * `level N declared: drift…|not verified: …|complete`, then `; weak: …`, and after a
 * drift `; not verified: …`; or level unknown.
 */
export function levelLine(config, rows) {
  if (!config) return m.levelUnknown;
  const { requires } = LEVELS[config.level];
  const missing = named(rows, requires, FAIL);
  const weak = named(rows, requires, WARN);
  const unverified = named(rows, requires, SKIP);
  return [
    levelHead(config.level, missing, unverified),
    weak.length && m.weak(weak),
    missing.length && unverified.length && m.notVerified(unverified),
  ]
    .filter(Boolean)
    .join('; ');
}

const nextText = (level) => {
  const next = nextLevel(level);
  return next === null ? messages.noNextLevel(level) : messages.levels[next].summary;
};

export function summaryLine(rows) {
  const c = summarize(rows);
  return m.summary(rows.length, { ...c, passed: rows.length - c.failed - c.warned - c.skipped });
}

const rowLines = (rows) => {
  const width = Math.max(...rows.map(([name]) => name.length));
  return rows.map(([name, r]) => `${r.status.padEnd(4)}  ${name.padEnd(width)}  ${r.note}`);
};

/**
 * The lines doctor prints. By hand: every check, the counts, the level line and the
 * next level. With `hook`: only what is not PASS, the counts and the level line, or
 * one line when everything passes, so the session knows doctor ran.
 */
export function renderReport(config, rows, { hook = false } = {}) {
  if (hook) {
    if (config && rows.every(([, r]) => r.status === PASS)) return [m.hookComplete(config.level)];
    const open = rows.filter(([, r]) => r.status !== PASS);
    return [...rowLines(open), m.hookLine(summaryLine(rows)), levelLine(config, rows)];
  }
  const lines = [...rowLines(rows), '', summaryLine(rows), levelLine(config, rows)];
  return config ? [...lines, m.next(nextText(config.level))] : lines;
}
