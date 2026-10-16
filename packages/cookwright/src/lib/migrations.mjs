// src/lib/migrations.mjs — the config migrations: one pure step per format version,
// keyed by the version it starts from (plan §4.3).
//
// A step takes the raw JSON object (never the defaulted config) and a context whose
// `exists(rel)` says whether anything is at a root-relative path, and returns
// `{ raw, outcome, detail }`: the new object, without its version (the runner sets
// it), and what the step did, as a key the caller renders (messages.mjs holds the
// text; this file imports nothing, so config.mjs can load it without a cycle).

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The playbook path stage 1 wrote into every fresh config, and never wrote a file at. */
export const STALE_PLAYBOOK = 'docs/playbook.md';

/**
 * 1 → 2: `paths.playbook` becomes optional, absent meaning the package's copy. The
 * stage-1 default with nothing at it is dropped; any other value, or the default
 * with a file there, is the user's own playbook and is kept. An absent key meant the
 * stage-1 default at version 1, so with a file there it is written in, keeping it.
 */
function dropStalePlaybook(raw, ctx) {
  const value = isObj(raw.paths) ? raw.paths.playbook : undefined;
  if (value === undefined) return absentPlaybook(raw, ctx);
  if (value !== STALE_PLAYBOOK || ctx.exists(value)) return { raw, outcome: 'playbookKept', detail: value };
  const paths = { ...raw.paths };
  delete paths.playbook;
  return { raw: { ...raw, paths }, outcome: 'playbookDropped', detail: value };
}

/** No key: nothing to change, unless the version-1 default it stood for holds a playbook. */
function absentPlaybook(raw, ctx) {
  const paths = raw.paths === undefined ? {} : raw.paths;
  if (!isObj(paths) || !ctx.exists(STALE_PLAYBOOK)) return { raw, outcome: 'playbookAbsent' };
  return { raw: { ...raw, paths: { ...paths, playbook: STALE_PLAYBOOK } }, outcome: 'playbookPinned', detail: STALE_PLAYBOOK };
}

export const MIGRATIONS = Object.freeze({
  1: dropStalePlaybook,
});
