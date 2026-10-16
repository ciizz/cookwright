// src/lib/migrations.test.mjs — each config migration step, pure: what it drops,
// what it keeps, and that it never changes the object it is given.

import { describe, expect, it } from 'vitest';

import { MIGRATIONS, STALE_PLAYBOOK } from './migrations.mjs';

const ctx = (present = []) => ({ exists: (rel) => present.includes(rel) });
const step = MIGRATIONS[1];

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
  });
});
