// src/lib/levels.test.mjs — the level ladder. That every `requires` name is a doctor
// check is held by doctor's registry test, which lands with doctor.

import { describe, expect, it } from 'vitest';

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
    ]);
  });
});
