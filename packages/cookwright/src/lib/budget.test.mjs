// src/lib/budget.test.mjs — the shared time budget: a call takes what is left, and
// a spent budget times a call out without spawning it.

import { describe, expect, it } from 'vitest';

import { CALL_CAP_MS, runBounded, timeLeft, withBudget } from './budget.mjs';

describe('the subprocess budget', () => {
  it('caps a call outside a budget and shares one budget inside it', () => {
    expect(timeLeft()).toBe(CALL_CAP_MS);
    withBudget(() => {
      expect(timeLeft()).toBeLessThanOrEqual(300);
      const started = Date.now();
      expect(runBounded('/bin/sleep', ['5'])).toMatchObject({ status: null, timedOut: true });
      expect(Date.now() - started).toBeLessThan(1500);
      expect(timeLeft()).toBe(0);
      expect(runBounded('/bin/sleep', ['5'])).toMatchObject({ status: null, timedOut: true });
    }, 300);
    expect(timeLeft()).toBe(CALL_CAP_MS);
  });

  it('reports a finished call as not timed out', () => {
    expect(runBounded('/bin/sh', ['-c', 'exit 3'])).toMatchObject({ status: 3, timedOut: false });
  });
});
