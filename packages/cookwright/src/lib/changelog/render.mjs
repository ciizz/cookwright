// src/lib/changelog/render.mjs — the generated changelog's text (plan §4.4).
//
// Content of the file written into the user's repo, not messages: the strings test
// exempts this module. The header is the template init seeds, so with zero release
// tags the render IS the template, byte for byte, and a fresh repo passes --check.
// One blank line between blocks, no trailing space, LF.

import fs from 'node:fs';

import { SECTIONS, classify } from './commits.mjs';

/** The line that says a changelog is generated: doctor and --check look for it. */
export const MARKER = '<!-- cookwright:changelog -->';

/** The generated file's header, and the whole file when no release tag exists. */
export const TEMPLATE = fs.readFileSync(new URL('../templates/CHANGELOG.md', import.meta.url), 'utf8');

/** True when `text` (LF) carries the marker as a line of its own. */
export const hasMarker = (text) => text.split('\n').some((l) => l.trim() === MARKER);

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const INTERNAL = '(docs, chore, refactor, tests, tooling)';
const capital = (key) => key[0].toUpperCase() + key.slice(1);

const item = ({ sha, c }) =>
  `- ${c.breaking ? '**BREAKING** ' : ''}${c.scope ? `**${c.scope}** — ` : ''}${c.text.trim()} \`${sha.slice(0, 8)}\``;

/** The section blocks for `commits`, then the count of the internal ones. */
function commitBlocks(commits, countLine) {
  const classified = commits.map(({ sha, subject }) => ({ sha, c: classify(subject) }));
  const blocks = [];
  for (const [type, title] of SECTIONS) {
    const items = classified.filter(({ c }) => c?.type === type);
    if (items.length) blocks.push(`### ${title}\n\n${items.map(item).join('\n')}`);
  }
  const internal = classified.filter(({ c }) => !c).length;
  blocks.push(countLine(commits.length, internal));
  return blocks;
}

/** A tag's metadata as blocks: `note` a blockquote, every other key `**Key.** value`. */
const metaBlocks = (meta) =>
  meta
    .filter(({ key, lines }) => key !== 'released' && lines.length)
    .map(({ key, lines }) =>
      key === 'note' ? lines.map((l) => `> ${l}`).join('\n') : `**${capital(key)}.** ${lines.join('\n')}`,
    );

/** The date in a release's heading: its last non-empty `released` value. */
const releasedOf = (meta) => meta.filter((e) => e.key === 'released' && e.lines.length).at(-1)?.lines.join(' ');

/** One release's section: `## X.Y.Z — <released>`, its notes, its commits. */
export function releaseSection({ version, meta, commits }) {
  const released = releasedOf(meta);
  const count = (n, m) => `_${plural(n, 'commit')} in this release, ${m} internal ${INTERNAL}._`;
  const heading = `## ${version}${released ? ` — ${released}` : ''}`;
  return [heading, ...metaBlocks(meta), ...commitBlocks(commits, count)].join('\n\n');
}

/** The whole file: the template, then the releases newest first. */
export function renderChangelog(releases) {
  return TEMPLATE + releases.map((r) => `\n${releaseSection(r)}\n`).join('');
}

/** What `--unreleased` prints: one section, `since` the latest release tag or null. */
export function unreleasedSection(commits, since) {
  const n = plural(commits.length, 'commit');
  const heading = since ? `## Unreleased — ${n} since ${since}` : `## Unreleased — ${n}, no release tag yet`;
  const count = (_, m) => `_${m} internal ${INTERNAL}._`;
  return [heading, ...commitBlocks(commits, count)].join('\n\n');
}
