// src/lib/budget.test.mjs — the shared time budget: a call takes what is left, and
// a spent budget times a call out without spawning it; gitRun's per-call cap, and
// output past Node's default buffer.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { commit, gitInit, run, scratchRoot } from '../test-helpers.mjs';
import { CALL_CAP_MS, TimedOut, runBounded, timeLeft, withBudget } from './budget.mjs';
import { gitRun } from './doctor/repo.mjs';

const TMP = scratchRoot('cookwright-budget-');

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

describe('gitRun', () => {
  it('takes a per-call cap, still bounded by a budget', () => {
    const root = gitInit(path.join(TMP, 'cap'));
    expect(timeLeft(60_000)).toBe(60_000);
    withBudget(() => expect(timeLeft(60_000)).toBeLessThanOrEqual(300), 300);
    expect(() => gitRun(root, ['status'], { cap: 0 })).toThrow(TimedOut);
    expect(gitRun(root, ['status'], { cap: 60_000 }).status).toBe(0);
  });

  it('returns a log longer than Node’s 1 MiB default buffer', () => {
    const root = gitInit(path.join(TMP, 'long'));
    commit({ root }, { 'a.txt': 'a' }, 'init');
    const msg = path.join(TMP, 'msg.txt');
    fs.writeFileSync(msg, `long\n\n${'x'.repeat(99)}\n`.repeat(20_000));
    run(root, 'git', ['commit', '-q', '--no-verify', '--allow-empty', '-F', msg]);
    const r = gitRun(root, ['log', '--format=%B'], { cap: 60_000 });
    expect(r.status).toBe(0);
    expect(r.stdout.length).toBeGreaterThan(2 * 1024 * 1024);
  });
});
