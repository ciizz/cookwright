// src/packs.test.mjs — `cookwright packs rules`: the declared packs' doc-sync rules
// and gate checks as a fresh config takes them, a switched-off rule left out, and
// the refusals (stage-4 plan §6, disposition 35).

import fs from 'node:fs';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { dispatch } from './cli-main.mjs';
import { messages } from './lib/messages.mjs';
import { PACKS, RATCHET_CHECK, packDefaults } from './lib/packs/registry.mjs';
import { main } from './packs.mjs';
import { scratchRepo, scratchRoot } from './test-helpers.mjs';

const m = messages.packs;
const TMP = scratchRoot('cookwright-packs-');

const out = [];
const err = [];
let spies;
beforeAll(() => {
  spies = [
    vi.spyOn(console, 'log').mockImplementation((...a) => out.push(a.join(' '))),
    vi.spyOn(console, 'error').mockImplementation((...a) => err.push(a.join(' '))),
  ];
});
afterAll(() => spies.forEach((s) => s.mockRestore()));
afterEach(() => {
  out.length = 0;
  err.length = 0;
});

let n = 0;
const repoWith = (packs) => scratchRepo(TMP, `r${(n += 1)}`, { packs }).root;
const rules = (root) => main(['rules'], { cwd: root });
const printed = () => JSON.parse(out.join('\n'));
const ruleOf = (pack, id) => PACKS[pack].rules.find((r) => r.id === id);

describe('packs rules', () => {
  it('prints what a fresh config takes for the declared packs', () => {
    expect(rules(repoWith(['expo', 'supabase']))).toBe(0);
    expect(printed()).toEqual(packDefaults(['expo', 'supabase']));
    expect(printed()).toEqual({
      docSync: [ruleOf('expo', 'design-doc').docSync, ruleOf('supabase', 'data-doc').docSync],
      gate: [RATCHET_CHECK, ruleOf('supabase', 'types').gate],
    });
    expect(err).toEqual([]);
  });

  it('leaves out a rule switched off, and the ratchet once no ESLint rule is on', () => {
    const off = { name: 'supabase', rules: { 'data-doc': false, client: false } };
    expect(rules(repoWith([off]))).toBe(0);
    expect(printed()).toEqual({ docSync: [], gate: [ruleOf('supabase', 'types').gate] });
    out.length = 0;
    expect(rules(repoWith([{ name: 'expo', rules: { size: false } }]))).toBe(0);
    expect(printed()).toEqual({ docSync: [ruleOf('expo', 'design-doc').docSync], gate: [RATCHET_CHECK] });
  });

  it('is reached through the dispatcher, from a subdirectory', async () => {
    const root = repoWith(['expo']);
    fs.mkdirSync(path.join(root, 'src'));
    expect(await dispatch(['packs', 'rules'], { cwd: path.join(root, 'src') })).toBe(0);
    expect(printed().gate).toEqual([RATCHET_CHECK]);
  });
});

describe('packs rules refuses', () => {
  it('when no pack is declared, in one line', () => {
    expect(rules(repoWith([]))).toBe(2);
    expect(out).toEqual([]);
    expect(err).toEqual([m.refused(m.none)]);
  });

  it('with no config, or an invalid one', () => {
    const bare = path.join(TMP, 'bare');
    fs.mkdirSync(bare);
    expect(rules(bare)).toBe(2);
    expect(err).toEqual([m.refused(m.noConfig(bare))]);
    const root = repoWith([]);
    fs.writeFileSync(path.join(root, 'cookwright.json'), JSON.stringify({ version: 3, packs: ['rails'] }));
    err.length = 0;
    expect(rules(root)).toBe(2);
    expect(err[0]).toMatch(/^packs: cookwright\.json invalid: .*rails/);
  });

  it('anything but rules alone, with the usage', () => {
    const root = repoWith(['expo']);
    for (const argv of [[], ['list'], ['rules', 'extra'], ['rules', '--json']]) {
      err.length = 0;
      expect(main(argv, { cwd: root })).toBe(2);
      expect(err).toEqual([m.refused(m.usage)]);
    }
    expect(out).toEqual([]);
  });
});
