// src/lib/packs/section.mjs — a stack pack's section of AGENTS.md, generated from
// its manifest, never a hand-kept file (stage-4 plan §4.2).
//
// The section is a managed block of the pack's kind (rules/block.mjs): its own begin
// marker, `<!-- cookwright:begin pack <name> vN -->` with N the manifest's version,
// and the shared end marker. Each measured rule is its sentence and, in parentheses,
// the check that measures it, derived from the rule's data; a rule switched off in
// `packs` keeps its sentence, marked. The advisory rules follow under their own
// heading. The text is content written into the user's repo, like agents-block.md.

import { CLI } from '../messages.mjs';
import { END_MARKER, beginMarker, packKind } from '../rules/block.mjs';
import { ADVISORY } from './registry.mjs';

const code = (text) => `\`${text}\``;

/** The parenthesis after a measured rule's sentence: what measures it, and where. */
function measurement(rule) {
  if (rule.measure === 'doc-sync') return `measured by the doc-sync rule ${code(rule.docSync.name)} at commit`;
  if (rule.measure === 'gate') return `measured by the gate check ${code(rule.gate.name)}`;
  const ids = rule.eslint.ruleIds.map(code).join(', ');
  const needs = rule.needs ? `; needs ${code(rule.needs)}` : '';
  return `measured by ESLint ${ids} on the staged files at commit and against the ratchet's base at the gate${needs}`;
}

const enforcedLine = (rule, off) =>
  off.has(rule.id) ? `- ${rule.sentence} (switched off).` : `- ${rule.sentence} (${measurement(rule)}).`;

/** The advisory part, or nothing when the pack has no advisory rule. */
function advisory(rules) {
  if (rules.length === 0) return [];
  return ['', '### Advisory', '', 'No check measures these; a review reads the diff against them.', '', ...rules.map((r) => `- ${r.sentence}.`)];
}

/**
 * The whole section of `manifest`, markers included, LF line endings, no trailing
 * newline; `off` is the Set of rule ids switched off.
 */
export function renderSection(manifest, off = new Set()) {
  const enforced = manifest.rules.filter((r) => r.measure !== ADVISORY);
  const lines = [
    beginMarker(manifest.version, packKind(manifest.name)),
    `## Standards: ${manifest.name} pack`,
    '',
    `This section is managed by cookwright: ${code(`${CLI} init`)} refreshes it from the package. Each enforced rule names the check that measures it. Switch a rule off in ${code('cookwright.json')} (${code('packs')}), never by editing here.`,
    '',
    ...enforced.map((r) => enforcedLine(r, off)),
    ...advisory(manifest.rules.filter((r) => r.measure === ADVISORY)),
    END_MARKER,
  ];
  return lines.join('\n');
}
