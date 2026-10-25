// src/lib/packs/section.test.mjs — a pack's section of AGENTS.md: generated from the
// manifest, each enforced rule with its measurement, the switched-off ones marked,
// the advisory ones apart, and judged by the same blockState as the core block.

import { describe, expect, it } from 'vitest';

import { DEFAULTS } from '../config.mjs';
import { CLI } from '../messages.mjs';
import { END_MARKER, beginMarker, blockState, packKind, renderBlock } from '../rules/block.mjs';
import { ADVISORY, KNOWN_PACKS, PACKS } from './registry.mjs';
import { renderSection } from './section.mjs';

const bullets = (text) => text.split('\n').filter((l) => l.startsWith('- '));

describe.each(KNOWN_PACKS)('the %s section', (name) => {
  const manifest = PACKS[name];
  const section = renderSection(manifest);
  const lines = section.split('\n');

  it('sits between its own begin marker, at the manifest’s version, and the shared end marker', () => {
    expect(lines[0]).toBe(beginMarker(manifest.version, packKind(name)));
    expect(lines[0]).toBe(`<!-- cookwright:begin pack ${name} v${manifest.version} -->`);
    expect(lines.at(-1)).toBe(END_MARKER);
    expect(lines[1]).toBe(`## Standards: ${name} pack`);
    expect(section).toContain(`\`${CLI} init\``);
    expect(section).not.toMatch(/\r|\{\{|\n\n\n|[ \t]$/m);
  });

  it('carries every rule once, in the manifest’s order, enforced before advisory', () => {
    const enforced = manifest.rules.filter((r) => r.measure !== ADVISORY);
    const advisory = manifest.rules.filter((r) => r.measure === ADVISORY);
    const sentences = bullets(section).map((b) => b.slice(2));
    expect(sentences.length).toBe(manifest.rules.length);
    [...enforced, ...advisory].forEach((rule, i) => {
      expect([rule.id, sentences[i].startsWith(`${rule.sentence} `) || sentences[i] === `${rule.sentence}.`]).toEqual([rule.id, true]);
    });
  });

  it('names the check that measures each enforced rule', () => {
    for (const rule of manifest.rules.filter((r) => r.measure !== ADVISORY)) {
      const line = bullets(section).find((b) => b.startsWith(`- ${rule.sentence}`));
      const names = rule.eslint?.ruleIds ?? [rule.docSync?.name ?? rule.gate.name];
      for (const n of names) expect(line).toContain(`\`${n}\``);
      if (rule.needs) expect(line).toContain(`needs \`${rule.needs}\``);
      expect(line).toMatch(/ \(measured by [^\n]+\)\.$/);
    }
  });

  it('is current against itself in a file beside the core block, and stale against another render', () => {
    const file = `# Rules\n\n${renderBlock(DEFAULTS)}\n\n${section}\n`;
    expect(blockState(file, section, packKind(name)).state).toBe('current');
    expect(blockState(file, renderBlock(DEFAULTS)).state).toBe('current');
    const someOff = new Set([manifest.rules[0].id]);
    expect(blockState(file, renderSection(manifest, someOff), packKind(name)).state).toBe('stale');
  });
});

describe('a rule switched off', () => {
  it('keeps its sentence, marked, with no measurement claimed, the others as they were', () => {
    const on = renderSection(PACKS.expo);
    const off = renderSection(PACKS.expo, new Set(['size']));
    const size = PACKS.expo.rules.find((r) => r.id === 'size');
    expect(bullets(off)).toContain(`- ${size.sentence} (switched off).`);
    expect(off).not.toContain('max-lines-per-function');
    const differ = bullets(on).filter((b, i) => b !== bullets(off)[i]);
    expect(differ).toEqual([bullets(on).find((b) => b.startsWith(`- ${size.sentence} (`))]);
  });
});

describe('the advisory heading', () => {
  it('lists the expo pack’s unmeasured rules under it, and is absent from a pack with none', () => {
    const expo = renderSection(PACKS.expo);
    const [, advisory] = expo.split('\n### Advisory\n');
    expect(bullets(advisory)).toEqual(PACKS.expo.rules.filter((r) => r.measure === ADVISORY).map((r) => `- ${r.sentence}.`));
    expect(renderSection(PACKS.supabase)).not.toContain('### Advisory');
  });
});

it('renders the supabase section byte for byte', () => {
  expect(renderSection(PACKS.supabase)).toBe(
    [
      '<!-- cookwright:begin pack supabase v1 -->',
      '## Standards: supabase pack',
      '',
      'This section is managed by cookwright: `npx cookwright init` refreshes it from the package. Each enforced rule names the check that measures it. Switch a rule off in `cookwright.json` (`packs`), never by editing here.',
      '',
      '- The Supabase client is imported only from the shared service (`services/supabase`, `lib/supabase` or `utils/supabase`), never from `@supabase/supabase-js` in a screen, component or feature file (measured by ESLint `no-restricted-imports` on the staged files at commit and against the base branch at the gate).',
      '- A migration changes with the data-model doc: a commit touching a migration stages `docs/data-model.md` (measured by the doc-sync rule `supabase:data-doc` at commit).',
      '- The generated database types match the schema: `npm run db:types` regenerates them after a migration (measured by the gate check `standards:types`).',
      '<!-- cookwright:end -->',
    ].join('\n'),
  );
});
