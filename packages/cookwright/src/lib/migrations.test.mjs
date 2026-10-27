// src/lib/migrations.test.mjs — each config migration step, pure: what it drops,
// what it keeps, and that it never changes the object it is given.

import { describe, expect, it } from 'vitest';

import { MIGRATIONS, STALE_PLAYBOOK } from './migrations.mjs';

const ctx = (present = []) => ({ exists: (rel) => present.includes(rel) });
const step = MIGRATIONS[1];
const addPacks = MIGRATIONS[2];

describe('1 → 2: the stale paths.playbook', () => {
  it('drops the stage-1 default when nothing is there, every other key in place', () => {
    const raw = { $schema: 's', version: 1, paths: { bundles: 'b', playbook: STALE_PLAYBOOK, backlog: 'x.md' }, level: 0 };
    const before = structuredClone(raw);
    const out = step(raw, ctx());
    expect(out).toEqual({
      raw: { $schema: 's', version: 1, paths: { bundles: 'b', backlog: 'x.md' }, level: 0 },
      outcome: 'playbookDropped',
      detail: STALE_PLAYBOOK,
    });
    expect(Object.keys(out.raw)).toEqual(Object.keys(raw));
    expect(raw).toEqual(before);
  });

  it('keeps the default when a playbook is there, and any other path', () => {
    const raw = { version: 1, paths: { playbook: STALE_PLAYBOOK } };
    expect(step(raw, ctx([STALE_PLAYBOOK]))).toEqual({ raw, outcome: 'playbookKept', detail: STALE_PLAYBOOK });
    const own = { version: 1, paths: { playbook: 'ops/playbook.md' } };
    expect(step(own, ctx())).toEqual({ raw: own, outcome: 'playbookKept', detail: 'ops/playbook.md' });
  });

  it('has nothing to do without the key, or with a paths the validator will refuse', () => {
    for (const raw of [{ version: 1 }, { version: 1, paths: {} }, { version: 1, paths: 'x' }, { version: 1, paths: null }]) {
      expect(step(raw, ctx())).toEqual({ raw, outcome: 'playbookAbsent' });
    }
    for (const raw of [{ version: 1, paths: 'x' }, { version: 1, paths: null }]) {
      expect(step(raw, ctx([STALE_PLAYBOOK]))).toEqual({ raw, outcome: 'playbookAbsent' });
    }
  });

  it('writes the version-1 default in when the key is absent and a playbook is there', () => {
    const bare = { version: 1, level: 0 };
    const before = structuredClone(bare);
    expect(step(bare, ctx([STALE_PLAYBOOK]))).toEqual({
      raw: { version: 1, level: 0, paths: { playbook: STALE_PLAYBOOK } },
      outcome: 'playbookPinned',
      detail: STALE_PLAYBOOK,
    });
    expect(bare).toEqual(before);
    const trimmed = { version: 1, paths: { backlog: 'x.md' } };
    expect(step(trimmed, ctx([STALE_PLAYBOOK])).raw).toEqual({ version: 1, paths: { backlog: 'x.md', playbook: STALE_PLAYBOOK } });
  });
});

describe('2 → 3: packs', () => {
  it('adds an empty packs after hosts, every other key in place, the object untouched', () => {
    const raw = { $schema: 's', version: 2, level: 0, hosts: ['claude'], baseBranch: 'main', paths: {} };
    const before = structuredClone(raw);
    const out = addPacks(raw);
    expect(out).toEqual({ raw: { ...raw, packs: [] }, outcome: 'packsAdded' });
    expect(Object.keys(out.raw)).toEqual(['$schema', 'version', 'level', 'hosts', 'packs', 'baseBranch', 'paths']);
    expect(raw).toEqual(before);
  });

  it('adds it at the end when there is no hosts key', () => {
    const out = addPacks({ version: 2, level: 0 });
    expect(Object.keys(out.raw)).toEqual(['version', 'level', 'packs']);
    expect(out.outcome).toBe('packsAdded');
  });

  it('keeps any value already there, valid or not, for the validator to judge', () => {
    for (const packs of [[], ['expo'], 'expo', null]) {
      const raw = { version: 2, hosts: ['claude'], packs };
      expect(addPacks(raw)).toEqual({ raw, outcome: 'packsKept' });
    }
  });
});

describe('3 → 4: secrets', () => {
  const addSecrets = MIGRATIONS[3];

  it('changes nothing but the version: no secrets key is written (disposition 16)', () => {
    const raw = { $schema: 's', version: 3, level: 0, hosts: ['claude'], packs: [] };
    const before = structuredClone(raw);
    const out = addSecrets(raw);
    expect(out).toEqual({ raw, outcome: 'secretsNone' });
    expect(Object.hasOwn(out.raw, 'secrets')).toBe(false);
    expect(raw).toEqual(before);
  });

  it('keeps any secrets value already there, valid or not, for the validator to judge', () => {
    for (const secrets of [{ backend: 'age', targets: {} }, 'age', null]) {
      const raw = { version: 3, secrets };
      expect(addSecrets(raw)).toEqual({ raw, outcome: 'secretsKept' });
    }
  });
});
