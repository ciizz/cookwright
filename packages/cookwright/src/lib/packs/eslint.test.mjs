// src/lib/packs/eslint.test.mjs — the packs' ESLint exports, loaded under node as a
// repo's eslint.config.js requires them (stage-4 plan §4.4, §6): the blocks, their
// names and ignores, every ESLint id a manifest rule names in exactly that rule's
// blocks with the manifest's options, the Supabase service exemption, and the
// strings block left out when eslint-plugin-i18next does not resolve.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { scratchRoot } from '../../test-helpers.mjs';
import { PACKS } from './registry.mjs';

const require = createRequire(import.meta.url);
const { matchesAny } = require('../../test-fixtures/fake-eslint/glob.cjs');
const expoExport = require('../../../packs/expo/eslint.cjs');
const supabaseExport = require('../../../packs/supabase/eslint.cjs');

const TMP = scratchRoot('cookwright-eslint-export-');
const STUB = path.join(TMP, 'i18next-stub.cjs');
fs.writeFileSync(STUB, 'module.exports = { rules: {} };\n');

/** Each pack's blocks with the plugin resolving (the expo pack's strings block in). */
const EXPORTS = { expo: expoExport.withResolver(() => STUB), supabase: supabaseExport };
const HARNESS = ['.claude/**', '.agents/**', '.codex/**', 'node_modules/**', '**/*.test.*', '**/__tests__/**'];

const ruleOf = (pack, block) => block.name.split('/')[2];
const applies = (block, rel) => matchesAny(block.files, rel) && !matchesAny(block.ignores ?? [], rel);
const eslintRules = (name) => PACKS[name].rules.filter((r) => r.measure === 'eslint');

/** Every string under `value`, at any depth. */
const strings = (value) =>
  typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];

describe.each(Object.keys(PACKS))('the %s export', (name) => {
  const blocks = EXPORTS[name];

  it('is an array of named blocks carrying rules only, every one ignoring the harness and tests', () => {
    expect(Array.isArray(blocks)).toBe(true);
    const ids = eslintRules(name).map((r) => r.id);
    for (const block of blocks) {
      expect(block.name).toMatch(new RegExp(`^cookwright/${name}/[a-z-]+(/[a-z-]+)?$`));
      expect(ids).toContain(ruleOf(name, block));
      expect(Object.keys(block).every((k) => ['name', 'files', 'ignores', 'plugins', 'rules'].includes(k))).toBe(true);
      expect(block.files.length).toBeGreaterThan(0);
      expect(block.ignores).toEqual(expect.arrayContaining(HARNESS));
    }
  });

  it('names each ESLint id of a manifest rule in exactly that rule’s blocks, with its options at each sample', () => {
    for (const rule of eslintRules(name)) {
      const own = blocks.filter((b) => ruleOf(name, b) === rule.id);
      expect(own.length).toBeGreaterThan(0);
      for (const block of own) expect(Object.keys(block.rules).sort()).toEqual([...rule.eslint.ruleIds].sort());
      const others = blocks.filter((b) => ruleOf(name, b) !== rule.id).flatMap((b) => Object.keys(b.rules));
      for (const id of rule.eslint.ruleIds) expect(others).not.toContain(id);
      for (const { sample, expect: want } of rule.eslint.options) {
        const at = own.filter((b) => applies(b, sample));
        expect([rule.id, sample, at.length]).toEqual([rule.id, sample, 1]);
        for (const id of rule.eslint.ruleIds) {
          const [severity, ...options] = at[0].rules[id];
          expect(severity).toBe('error');
          expect(options[0]).toMatchObject(want);
          if (rule.eslint.tag) {
            const messages = strings(options).filter((s) => s.startsWith('[cookwright'));
            expect(messages.length).toBeGreaterThan(0);
            for (const text of messages) expect(text.startsWith(`${rule.eslint.tag} `)).toBe(true);
          }
        }
      }
    }
  });

  it('reads no file of the harness, no dependency and no test', () => {
    for (const rel of ['.claude/workflows/bundle-phase.js', '.agents/skills/x/a.ts', 'node_modules/x/index.js', 'src/components/Card.test.tsx', 'src/components/__tests__/Card.tsx']) {
      expect([rel, blocks.filter((b) => applies(b, rel)).map((b) => b.name)]).toEqual([rel, []]);
    }
  });
});

describe('the expo export', () => {
  it('leaves the strings block out when eslint-plugin-i18next does not resolve, and keeps the rest', () => {
    const absent = expoExport.withResolver(() => {
      throw new Error('Cannot find module');
    });
    expect(absent.map((b) => b.name)).toEqual(EXPORTS.expo.filter((b) => b.name !== 'cookwright/expo/strings').map((b) => b.name));
    const strings = EXPORTS.expo.find((b) => b.name === 'cookwright/expo/strings');
    expect(strings.plugins.i18next).toBe(require(STUB));
  });

  it('spreads as plain blocks: the seam is not an element', () => {
    expect([...expoExport].every((b) => typeof b.name === 'string')).toBe(true);
    expect(Object.keys(expoExport).every((k) => /^\d+$/.test(k))).toBe(true);
  });

  it('keeps the user-facing attributes measured and the attribute names that are never text out', () => {
    const { exclude } = EXPORTS.expo[0].rules['i18next/no-literal-string'][1]['jsx-attributes'];
    // The plugin's own matching: each pattern anchored at the end, after the start or a dot.
    const excluded = (attr) => exclude.some((p) => new RegExp(`(^|\\.)${p}$`).test(attr));
    for (const attr of ['accessibilityLabel', 'accessibilityHint', 'placeholder', 'title', 'label', 'value', 'alt', 'children']) {
      expect([attr, excluded(attr)]).toEqual([attr, false]);
    }
    for (const attr of ['testID', 'onPress', 'contentContainerStyle', 'backgroundColor', 'paddingHorizontal', 'className', 'titleKey']) {
      expect([attr, excluded(attr)]).toEqual([attr, true]);
    }
  });

  it('measures colour and spacing literals in components only, the theme, palette and tokens files exempt', () => {
    const tokens = EXPORTS.expo.find((b) => b.name === 'cookwright/expo/tokens');
    expect(applies(tokens, 'components/Card.tsx')).toBe(true);
    expect(applies(tokens, 'src/components/ui/Card.ts')).toBe(true);
    for (const rel of ['src/screens/Home.tsx', 'src/components/theme/colors.ts', 'src/components/palette.ts', 'src/components/tokens.ts']) {
      expect([rel, applies(tokens, rel)]).toEqual([rel, false]);
    }
  });
});

describe('the supabase export', () => {
  const [client] = supabaseExport;

  it('exempts the shared service files and the Edge Functions by its own ignores', () => {
    for (const rel of ['src/services/supabase.ts', 'lib/supabase.ts', 'src/utils/supabase.js', 'supabase/functions/hello/index.ts']) {
      expect([rel, applies(client, rel)]).toEqual([rel, false]);
    }
    for (const rel of ['src/screens/Home.tsx', 'app/(tabs)/index.tsx', 'src/features/feed/api.ts']) {
      expect([rel, applies(client, rel)]).toEqual([rel, true]);
    }
  });

  it('restricts @supabase/supabase-js and nothing else', () => {
    const [, { paths, ...rest }] = client.rules['no-restricted-imports'];
    expect(rest).toEqual({});
    expect(paths.map((p) => p.name)).toEqual(['@supabase/supabase-js']);
  });
});
