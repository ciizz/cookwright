// src/lib/secret/proofs.mjs — target proof: the kinds, and the one function that
// judges resolved values against a target's declared proof (stage-5 plan §4.4).
//
// A kind is data and pure functions: `fields` (its own keys besides `kind` and
// `names`, each required), `valid[field]` (a predicate on the field's value),
// `names` (the names it covers when the proof names none, or null when `names` is
// required), `against(proof)` (the identifier the banner names) and
// `check(value, proof)`, null when the value satisfies the kind, else
// `{ anchor, found? }`: which anchor failed, and a public identifier found in the
// value when the kind may print one. The core has `host`; a pack adds kinds through
// `proofs` in its manifest (packs/supabase/pack.mjs has `supabase`).
//
// A proof names the names it covers, never infers them from a value's shape
// (disposition 2). A reason never carries a value, a host or a password: messages
// render it from the anchor (messages.secrets.proof).
//
// Import rule: config.mjs validates proofs through this file, so it imports only the
// pack registry (never messages.mjs, which imports config.mjs).

import { declaredPacks } from '../packs/registry.mjs';

/**
 * `host` canonicalised as `new URL('https://' + host)` reads it: lower-cased, the
 * default port dropped, IPv6 bracketed, an IDN punycoded, a trailing dot dropped.
 * Null when it is not a bare host (a scheme, path, user, query or space in it).
 */
export function canonicalHost(host) {
  if (typeof host !== 'string' || host === '' || /[\s/?#@\\]/.test(host)) return null;
  let url;
  try {
    url = new URL(`https://${host}`);
  } catch {
    return null;
  }
  const name = url.hostname.toLowerCase().replace(/\.$/, '');
  if (name === '') return null;
  return url.port ? `${name}:${url.port}` : name;
}

const PG_SCHEME = /^postgres(?:ql)?:\/\//i;

/** libpq's connection parameters that override the URI's host, user or credentials (disposition 65). */
export const PG_OVERRIDES = Object.freeze(['host', 'hostaddr', 'user', 'port', 'dbname', 'service', 'options', 'password', 'passfile']);

export const isPostgresUrl = (value) => PG_SCHEME.test(value);

/**
 * For a postgres-scheme value, the first query parameter that libpq would let
 * override the authority (names percent-decoded, as libpq decodes them), as
 * `{ anchor: 'param', param }`; `{ anchor: 'paramName' }` for a name that does not
 * decode; null for any other value. Never the parameter's value.
 */
export function pgQueryProblem(value) {
  if (!isPostgresUrl(value)) return null;
  const rest = value.replace(PG_SCHEME, '');
  const q = rest.indexOf('?', rest.lastIndexOf('@') + 1);
  if (q < 0) return null;
  for (const pair of rest.slice(q + 1).split('&')) {
    const key = pair.split('=', 1)[0];
    let name;
    try {
      name = decodeURIComponent(key);
    } catch {
      return { anchor: 'paramName' };
    }
    if (name.includes('\0')) return { anchor: 'paramName' };
    if (PG_OVERRIDES.includes(name)) return { anchor: 'param', param: name };
  }
  return null;
}

/**
 * For a postgres-scheme value whose user part (up to the last `@`) holds an
 * unencoded `/`, `?`, `#` or `@`: `{ anchor: 'userinfo' }`, since libpq and a
 * last-`@` reading then disagree on where the host starts. Null otherwise.
 */
export function pgUserinfoProblem(value) {
  if (!isPostgresUrl(value)) return null;
  const rest = value.replace(PG_SCHEME, '');
  const at = rest.lastIndexOf('@');
  return at >= 0 && /[/?#@]/.test(rest.slice(0, at)) ? { anchor: 'userinfo' } : null;
}

/**
 * For a postgres-scheme value whose host part (after the last `@`, up to `/`, `?`
 * or `#`) lists more than one host: `{ anchor: 'hostList' }`. libpq splits the
 * host part on commas after percent-decoding it, so `,` and `%2C` both count, and
 * tries the hosts in order: an anchor on one of them would not say where it
 * connects. Null otherwise.
 */
export function pgHostProblem(value) {
  if (!isPostgresUrl(value)) return null;
  const rest = value.replace(PG_SCHEME, '');
  const hostPart = rest.slice(rest.lastIndexOf('@') + 1).split(/[/?#]/)[0];
  return /,|%2c/i.test(hostPart) ? { anchor: 'hostList' } : null;
}

/**
 * A parsed value's host as the declared one is canonicalised: the hostname alone
 * normalised (case, IDN, trailing dot, as canonicalHost reads it), the port kept as
 * the parser normalised it for the value's own scheme: only that scheme's default
 * port is dropped, so `http://h:443` keeps `:443` and never reads as `h`. Null when
 * the hostname is not a bare host.
 */
function valueHost(url) {
  const name = canonicalHost(url.hostname);
  return name === null ? null : url.port ? `${name}:${url.port}` : name;
}

/** The core `host` kind: each covered value is a URL whose host is the declared one. */
const host = {
  fields: ['host'],
  valid: { host: (v) => canonicalHost(v) !== null },
  names: null,
  against: (proof) => canonicalHost(proof.host),
  check(value, proof) {
    let url;
    try {
      url = new URL(value);
    } catch {
      return { anchor: 'notUrl' };
    }
    const got = valueHost(url);
    return got !== null && got === canonicalHost(proof.host) ? null : { anchor: 'host' };
  },
};

export const KINDS = Object.freeze({ host: Object.freeze(host) });

/** The kinds a config may use: the core's, then each declared pack's `proofs`. */
export function proofKinds(config) {
  const kinds = { ...KINDS };
  for (const { manifest } of declaredPacks(config)) Object.assign(kinds, manifest.proofs ?? {});
  return kinds;
}

/** The names `proof` covers: its own `names`, else the kind's defaults the target declares. */
export function coveredNames(proof, kind, targetNames) {
  if (proof.names !== undefined) return proof.names;
  return (kind.names ?? []).filter((n) => targetNames.includes(n));
}

/**
 * Judge `values` (a Map of name → resolved value) against `proof` with `kinds`:
 * `{ ok, proved, against, kind }`, and `reason: { name, anchor, … }` when a covered
 * value fails. No proof → ok, nothing proved. A covered value is never skipped: an
 * absent one is judged as empty, a mismatch. A postgres-scheme value must first
 * pass the query, user-part and host-list rules, whatever the kind.
 */
export function prove(values, proof, kinds) {
  if (proof === undefined) return { ok: true, proved: [], against: null, kind: null };
  const kind = kinds[proof.kind];
  const against = kind.against(proof);
  const names = coveredNames(proof, kind, [...values.keys()]);
  for (const name of names) {
    const value = values.get(name) ?? '';
    const problem = pgQueryProblem(value) ?? pgUserinfoProblem(value) ?? pgHostProblem(value) ?? kind.check(value, proof);
    if (problem) return { ok: false, proved: [], against, kind: proof.kind, reason: { name, ...problem } };
  }
  return { ok: true, proved: [...names], against, kind: proof.kind };
}
