// src/lib/verdict.mjs — the four verdicts every cookwright check speaks, shared by
// the landing check (lib/bundle/check.mjs) and doctor.
//
// PASS and FAIL speak for themselves. WARN is a pass with a hole the reader must see
// (a tool missing, so a claim went unverified). SKIP is a check with no subject here
// (nothing configured). Only FAIL makes a check exit non-zero; the summary counts the
// other two so a pass with holes reads as one.

export const PASS = 'PASS';
export const FAIL = 'FAIL';
export const WARN = 'WARN';
export const SKIP = 'SKIP';

/** One verdict each: `{ status, note }`, the shape every check returns. */
export const pass = (note) => ({ status: PASS, note });
export const fail = (note) => ({ status: FAIL, note });
export const warn = (note) => ({ status: WARN, note });
export const skip = (note) => ({ status: SKIP, note });

/** Counts over `[name, { status }]` rows. */
export function summarize(rows) {
  const count = (status) => rows.filter(([, r]) => r.status === status).length;
  return { failed: count(FAIL), skipped: count(SKIP), warned: count(WARN) };
}
