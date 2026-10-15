// src/lib/changelog/state.mjs — what the changelog should say, and whether the file
// says it (plan §4.4). The command and the pre-push check share `changelogState`;
// doctor reads only the marker and never imports this (no `git log` per tag inside
// its budget).

import path from 'node:path';

import { isFile, readLF } from '../doctor/repo.mjs';
import { commitsBetween } from './commits.mjs';
import { hasMarker, renderChangelog } from './render.mjs';
import { notAncestors, releaseTags, tagMeta } from './tags.mjs';

/**
 * The generated text and what the command reports beside it: `tags` (ascending),
 * `skipped` (non-semver names) and `notAncestors` (adjacent pairs out of line).
 */
export function generate(root) {
  const { tags, skipped } = releaseTags(root);
  const releases = tags.map((tag, i) => ({
    version: tag.version,
    meta: tagMeta(root, tag),
    commits: commitsBetween(
      root,
      tag.name,
      tags.slice(0, i).map((t) => t.name),
    ),
  }));
  return {
    text: renderChangelog(releases.reverse()),
    tags,
    skipped,
    notAncestors: notAncestors(root, tags),
  };
}

/**
 * `{ state, tags, generated }` for `repo` (`{ root, config }`): `missing` (no file
 * at paths.changelog), `unmarked` (no marker line), else `stale` or `current`, the
 * file compared LF-normalised with the render. `tags` counts the release tags;
 * `generated` is null when the file was not compared.
 */
export function changelogState(repo, generated = null) {
  const abs = path.join(repo.root, repo.config.paths.changelog);
  if (!isFile(abs)) return { state: 'missing', tags: 0, generated };
  const text = readLF(abs);
  if (!hasMarker(text)) return { state: 'unmarked', tags: 0, generated };
  const g = generated ?? generate(repo.root);
  return { state: text === g.text ? 'current' : 'stale', tags: g.tags.length, generated: g };
}
