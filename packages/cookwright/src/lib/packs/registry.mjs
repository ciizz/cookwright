// src/lib/packs/registry.mjs — the stack packs the package ships, by name, and the
// one reading of `packs` in cookwright.json that every consumer shares (stage-4 plan
// §4.1).
//
// A pack is a directory under the package's packs/<name>/; its manifest (pack.mjs)
// is data. This table, not a listing of that directory, is what config validates
// against and what init, doctor and the hooks iterate. Packs are orthogonal to
// levels: no pack row is in a level's `requires`.
//
// Import rule: this file imports the manifests and nothing else, so config.mjs can
// validate `packs` through it without a cycle (config → registry; never messages).

import { manifest as expo } from '../../../packs/expo/pack.mjs';
import { manifest as supabase } from '../../../packs/supabase/pack.mjs';

/** `value`, every object and array under it frozen in place. */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const v of Object.values(value)) deepFreeze(v);
  return Object.freeze(value);
}

export const PACKS = deepFreeze({ expo, supabase });

export const KNOWN_PACKS = Object.freeze(Object.keys(PACKS));

/** The measure of a rule no check measures: listed apart, never switched off. */
export const ADVISORY = 'advisory';

/**
 * The gate check that ratchets every pack's ESLint rules, one entry however many
 * packs are declared. Exit 11 is its "cannot measure" (plan disposition 36).
 */
export const RATCHET_CHECK = deepFreeze({ name: 'standards', run: 'npx cookwright standards --ratchet', skipExit: 11 });

/** The ids of `manifest`'s measured rules: the ones `packs[].rules` may switch off. */
export const switchableRules = (manifest) => manifest.rules.filter((r) => r.measure !== ADVISORY).map((r) => r.id);

/** The name of a raw `packs` entry: the string itself, or the object's `name`. */
export const packName = (entry) => (typeof entry === 'string' ? entry : entry?.name);

/**
 * The declared packs of a valid config, in order, as `{ name, manifest, off }`:
 * `off` is the Set of rule ids switched off (`rules: { size: false }`). Call it on a
 * validated config only; the validator reads the raw value.
 */
export function declaredPacks(config) {
  return (config.packs ?? []).map((entry) => {
    const name = packName(entry);
    const rules = typeof entry === 'string' ? {} : (entry.rules ?? {});
    const off = new Set(Object.keys(rules).filter((id) => rules[id] === false));
    return { name, manifest: PACKS[name], off };
  });
}

/** The rules of a declared pack that are measured and not switched off. */
export const activeRules = (pack) => pack.manifest.rules.filter((r) => r.measure !== ADVISORY && !pack.off.has(r.id));
