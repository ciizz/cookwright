// src/lib/levels.test.mjs — the level ladder, held to doctor's check registry.

import { describe, expect, it } from 'vitest';

import { CHECKS } from './doctor/registry.mjs';
import { KNOWN_LEVELS, LEVELS, nextLevel } from './levels.mjs';
import { messages } from './messages.mjs';

describe('levels', () => {
  it('knows Level 0 and nothing above it in this version', () => {
    expect(KNOWN_LEVELS).toEqual([0]);
    expect(nextLevel(0)).toBeNull();
    expect(messages.noNextLevel(0)).toBe('Level 1 is not available in this version of cookwright');
  });

  it('gives every level a name, a summary and a non-empty list of distinct checks', () => {
    for (const level of KNOWN_LEVELS) {
      const { requires } = LEVELS[level];
      expect(requires.length).toBeGreaterThan(0);
      expect(new Set(requires).size).toBe(requires.length);
      expect(messages.levels[level]).toEqual({
        name: expect.any(String),
        summary: expect.any(String),
      });
    }
  });

  it('requires only checks doctor runs', () => {
    for (const level of KNOWN_LEVELS) {
      for (const name of LEVELS[level].requires) expect(Object.keys(CHECKS)).toContain(name);
    }
  });

  it('requires the Level 0 pieces', () => {
    expect(LEVELS[0].requires).toEqual([
      'config',
      'git',
      'homes.backlog',
      'homes.closeouts',
      'homes.changelog',
      'rules.block',
      'host.rules',
      'host.hook',
      'hooks.path',
      'hooks.pre-commit',
      'hooks.pre-push',
      'tools.gitleaks',
      'gate.scripts',
    ]);
  });
});
