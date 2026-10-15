// src/lib/changelog/tags.mjs — the release tags the changelog is built from, and
// the metadata an annotated tag's body carries (plan §4.4).
//
// A release tag is `vX.Y.Z`, strictly, reachable from HEAD (`--merged HEAD`, so a
// branch is judged against the releases it holds). Order is version order. Every
// git call is capped at 60 s, not doctor's per-call cap (plan §4.9), and a failure
// is a refusal carrying git's own stderr.

import { Refusal } from '../cli.mjs';
import { gitRun } from '../doctor/repo.mjs';
import { messages } from '../messages.mjs';

export const GIT_CAP_MS = 60_000;

/** git's result, whatever its exit status; only a timeout throws (TimedOut). */
export const gitTry = (root, args) => gitRun(root, args, { cap: GIT_CAP_MS });

/** A refusal naming `what` and git's first stderr line. */
const gitFailed = (what, r) =>
  new Refusal(messages.changelog.gitFailed(what, r.stderr.trim().split('\n')[0] || `exit ${r.status}`));

/** git's stdout, or a refusal naming `what` and git's first stderr line. */
export function git(root, args, what = args[0]) {
  const r = gitTry(root, args);
  if (r.status !== 0) throw gitFailed(what, r);
  return r.stdout;
}

/**
 * True when HEAD names no commit yet, every user's repo starts there: HEAD is a
 * symbolic ref whose branch does not exist. Any other HEAD that names no commit (a
 * malformed branch ref, an invalid name) is a refusal, never an empty changelog.
 */
export function isUnborn(root) {
  if (gitTry(root, ['rev-parse', '--verify', '-q', 'HEAD']).status === 0) return false;
  const sym = gitTry(root, ['symbolic-ref', '-q', 'HEAD']);
  if (sym.status !== 0) throw gitFailed('symbolic-ref', sym);
  return true;
}

const SEMVER = /^v(\d+)\.(\d+)\.(\d+)$/;
const GLOB = 'v[0-9]*.[0-9]*.[0-9]*';
// `%1f` and not `%x1f`: ref-filter formats take `%<hex>` (a pretty format's `%x1f`
// prints literally here).
const TAG_FORMAT = '--format=%(refname:strip=2)%1f%(objecttype)';

/** The raw `name\x1ftype` lines git returns for the release glob, merged into HEAD. */
export const rawTags = (root) => git(root, ['tag', '-l', GLOB, '--merged', 'HEAD', TAG_FORMAT], 'tag');

/** Two digit strings compared as integers of any size: no leading zero, then length, then lexically. */
const byDigits = (a, b) => {
  const [x, y] = [a.replace(/^0+(?=\d)/, ''), b.replace(/^0+(?=\d)/, '')];
  return x.length - y.length || (x < y ? -1 : x > y ? 1 : 0);
};
const byVersion = (a, b) => byDigits(a.v[0], b.v[0]) || byDigits(a.v[1], b.v[1]) || byDigits(a.v[2], b.v[2]);

/**
 * `{ tags, skipped }`: `tags` are `{ name, version, annotated }` in ascending
 * version order; `skipped` the names that match the glob but are not strict semver.
 * On an unborn HEAD, nothing.
 */
export function releaseTags(root) {
  if (isUnborn(root)) return { tags: [], skipped: [] };
  const tags = [];
  const skipped = [];
  for (const line of rawTags(root).split('\n').filter(Boolean)) {
    const [name, type] = line.split('\x1f');
    const v = SEMVER.exec(name);
    if (!v) skipped.push(name);
    else tags.push({ name, version: name.slice(1), annotated: type === 'tag', v: v.slice(1) });
  }
  tags.sort(byVersion);
  return { tags: tags.map(({ v, ...t }) => t), skipped: skipped.sort() };
}

/** The pairs `[lower, next]` of adjacent versions where lower is not an ancestor of next. */
export function notAncestors(root, tags) {
  const pairs = [];
  for (let i = 1; i < tags.length; i += 1) {
    const [lower, next] = [tags[i - 1].name, tags[i].name];
    const r = gitTry(root, ['merge-base', '--is-ancestor', lower, next]);
    if (r.status === 1) pairs.push([lower, next]);
    else if (r.status !== 0) throw gitFailed('merge-base', r);
  }
  return pairs;
}

// A key line: `key:` then a space or the line's end, so `https://…` and a `word:`
// run into prose are not keys.
const KEY = /^([a-z][\w-]*):(?:\s|$)/;

/**
 * `[{ key, lines }]` in body order, from an annotated tag's message, signature
 * already removed (`tagMessage`): the subject counts only when it is itself a key
 * line; a value continues over the following lines until the next key line or a
 * blank line.
 */
export function parseMeta(contents) {
  const lines = contents.replace(/\r\n/g, '\n').split('\n');
  const entries = [];
  let open = null;
  for (const raw of lines) {
    const line = raw.trim();
    const key = KEY.exec(line);
    if (key) {
      const first = line.slice(key[0].length).trim();
      open = { key: key[1], lines: first ? [first] : [] };
      entries.push(open);
    } else if (!line) open = null;
    else if (open) open.lines.push(line);
  }
  return entries;
}

// The signature first, then byte 037, then the whole message: armour never holds
// byte 037, so the first one splits them whatever the message holds.
const MESSAGE_FORMAT = '--format=%(contents:signature)%1f%(contents)';

/**
 * An annotated tag's message without its signature. git splits the signature off in
 * every format it signs with (PGP, x509, SSH); `%(contents:subject)` and
 * `%(contents:body)` would do it too, but the subject folds a first paragraph of
 * several `key: value` lines into one.
 */
export function tagMessage(root, name) {
  const out = git(root, ['for-each-ref', `refs/tags/${name}`, MESSAGE_FORMAT], 'for-each-ref');
  const cut = out.indexOf('\x1f');
  const [signature, contents] = [out.slice(0, cut), out.slice(cut + 1)];
  return signature && contents.includes(signature) ? contents.slice(0, contents.lastIndexOf(signature)) : contents;
}

/** An annotated tag's metadata entries; a lightweight tag has none (its contents are the commit's). */
export function tagMeta(root, tag) {
  return tag.annotated ? parseMeta(tagMessage(root, tag.name)) : [];
}
