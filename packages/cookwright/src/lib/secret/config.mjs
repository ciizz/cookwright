// src/lib/secret/config.mjs — what the engine and doctor read from a valid config's
// `secrets` (stage-5 plan §4.1): the names, the files, the keychain service. Pure.
//
// `secrets/` is a fixed directory at the config root (disposition 6). Every git
// path is top-relative (disposition 54): a file under the config root is named
// relative to the work tree's top, so `git show HEAD:<path>`, `ls-files`,
// `check-ignore` and `status` run from the top find it even when the config root
// sits below the top.

import path from 'node:path';

import { declaredPacks } from '../packs/registry.mjs';

/** The secrets directory and its files, relative to the config root. */
export const SECRETS_DIR = 'secrets';
export const RECIPIENTS = `${SECRETS_DIR}/recipients.txt`;
export const templateOf = (target) => `${SECRETS_DIR}/${target}.env.tpl`;
export const ciphertextOf = (target) => `${SECRETS_DIR}/${target}.env.age`;

const unique = (names) => [...new Set(names)];
const targets = (config) => config.secrets?.targets ?? {};

/** Every secret name any target declares, each once, in order. */
export const declaredNames = (config) => unique(Object.values(targets(config)).flatMap((t) => t.names));

/** The names the declared packs' tools read from the environment on their own (disposition 29). */
export const ambientNames = (config) => unique(declaredPacks(config).flatMap((p) => p.manifest.ambient ?? []));

/**
 * libpq's environment names that supply or override a connection's host, address,
 * port, user, database, options or credentials. A postgres URL proves nothing while
 * one is inherited, so the engine drops them from the child whenever an injected
 * value is a postgres-scheme URL, whatever packs are declared (stage-5 review:model
 * finding 5); the supabase pack's `ambient` holds them all.
 */
export const LIBPQ_NAMES = Object.freeze([
  'PGHOSTADDR',
  'PGHOST',
  'PGPORT',
  'PGUSER',
  'PGDATABASE',
  'PGOPTIONS',
  'PGPASSWORD',
  'PGPASSFILE',
  'PGSERVICE',
  'PGSERVICEFILE',
]);

/** The ambient names whose value names a file or a service, never a needle (disposition 22). */
export const pointerNames = (config) => unique(declaredPacks(config).flatMap((p) => p.manifest.pointers ?? []));

/** The target `name` declares, or null. */
export const targetOf = (config, name) => (Object.hasOwn(targets(config), name) ? targets(config)[name] : null);

/** The keychain service of `target` (disposition 52): per repo, by `secrets.id`. */
export const serviceOf = (config, target) => `cookwright/${config.secrets.id}/${target}`;

/**
 * `rel` (relative to the config root `root`) relative to the work tree's `top`, with
 * forward slashes; null when it would leave the top.
 */
export function topRel(root, top, rel) {
  const out = path.relative(top, path.join(root, rel));
  if (out === '' || out === '..' || out.startsWith(`..${path.sep}`) || path.isAbsolute(out)) return null;
  return out.split(path.sep).join('/');
}
