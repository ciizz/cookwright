// src/lib/doctor/report.mjs — doctor's readout: one line per check, the counts, and
// the level line that measures the declared level against what it requires.
//
// A required check that FAILs is drift. A WARN is weak and a SKIP unverified; neither
// is drift, so a working but imperfect setup reads as complete, and the level line
// always names what is weak or unverified.

import { LEVELS, nextLevel } from '../levels.mjs';
import { messages } from '../messages.mjs';
import { FAIL, PASS, SKIP, WARN, summarize } from '../verdict.mjs';

const m = messages.doctor;

const named = (rows, names, status) =>
  rows.filter(([name, r]) => names.includes(name) && r.status === status).map(([name]) => name);

/** `level N declared: complete|drift…[; weak: …][; unverified: …]`, or level unknown. */
export function levelLine(config, rows) {
  if (!config) return m.levelUnknown;
  const { requires } = LEVELS[config.level];
  const missing = named(rows, requires, FAIL);
  const weak = named(rows, requires, WARN);
  const unverified = named(rows, requires, SKIP);
  return [
    missing.length ? m.levelDrift(config.level, missing) : m.levelComplete(config.level),
    weak.length && m.weak(weak),
    unverified.length && m.unverified(unverified),
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
