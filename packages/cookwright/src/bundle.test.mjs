// src/bundle.test.mjs
//
// The bundle CLI's decisions, tested without running a bundle: the rig lock, the
// state and its derived phases, the Workflow-args invariant (byte-stable across
// state writes, sensitive to the content it points at), the gate's optional checks,
// the landing-check verdicts, and the CLI entry itself. Git-dependent pieces run
// against scratch repositories, each with its own cookwright.json.
//
// Importing src/bundle.mjs is safe: `main()` runs only when it is the process entry
// point, and under vitest `process.argv[1]` is the vitest binary.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { checkRetry, main, nextAction, parseArgv } from './bundle.mjs';
import {
  bundleChecks,
  ciCheck,
  closeoutCheck,
  qaReviewedCheck,
  gateChecks,
  phaseChecks,
  summarize,
} from './lib/bundle/check.mjs';
import { fiveNumbers, renderCloseoutDraft } from './lib/bundle/closeout.mjs';
import { commandOf, gatePassed, npmScriptOf, passLabel, planChecks, runGate } from './lib/bundle/gate.mjs';
import { dirtyPaths, isAncestor, lastCodeCommit } from './lib/bundle/git.mjs';
import { messages } from './lib/bundle/messages.mjs';
import {
  finishPhase,
  recordFindings,
  recordQa,
  recordReport,
  renderReport,
  startPhase,
  doneBlocker,
  setRunId,
  workflowArgs,
} from './lib/bundle/phases.mjs';
import {
  derivePhases,
  initState,
  saveState,
  validateSplit,
} from './lib/bundle/state.mjs';
import {
  RigLockBusyError,
  TOKEN_ENV,
  acquire,
  isStale,
  lockPath,
  probePid,
} from './lib/rig-lock.mjs';
import { commit, gitInit, run, scratchRepo as scratchRepoIn, scratchRoot } from './test-helpers.mjs';

const TMP = scratchRoot('bundle-test-');
const scratchRepo = (name, config) => scratchRepoIn(TMP, name, config);

const SPLIT = {
  slices: [
    { id: 'schema', sessions: [{ id: 's1', scope: 'plan §3', checkpoints: ['0230'] }] },
    {
      id: 'client',
      sessions: [
        { id: 'c1', scope: 'plan §4' },
        { id: 'c2', scope: 'plan §5' },
      ],
    },
  ],
};

// ── rig lock ─────────────────────────────────────────────────────────────────

describe('rig lock', () => {
  const file = path.join(TMP, 'rig.lock');
  const live = () => ({ state: 'node', startedAt: 0 });
  const quiet = { file, env: {}, warn: () => {} };

  it('takes a free lock and releases only its own, idempotently', () => {
    const a = acquire('a', { ...quiet, probe: live });
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).holder).toBe('a');
    a.release();
    a.release();
    expect(fs.existsSync(file)).toBe(false);
  });

  it('refuses while a live node process holds it', () => {
    const a = acquire('a', { ...quiet, probe: live });
    expect(() => acquire('b', { ...quiet, probe: live })).toThrow(RigLockBusyError);
    a.release();
  });

  it('takes over a lock whose holder is dead or no longer node', () => {
    for (const state of ['dead', 'other']) {
      acquire('a', { ...quiet, probe: live });
      const warnings = [];
      const b = acquire('b', {
        ...quiet,
        probe: () => ({ state, startedAt: null }),
        warn: (m) => warnings.push(m),
      });
      expect(warnings[0]).toMatch(/stale/);
      expect(JSON.parse(fs.readFileSync(file, 'utf8')).holder).toBe('b');
      b.release();
    }
  });

  it('treats a node process that started after the lock as a reused PID', () => {
    const lock = { pid: 42, since: '2026-09-29T10:00:00.000Z' };
    const later = Date.parse('2026-09-29T11:00:00Z');
    expect(isStale(lock, { probe: () => ({ state: 'node', startedAt: later }) })).toBe(true);
    const before = Date.parse('2026-09-29T09:59:00Z');
    expect(isStale(lock, { probe: () => ({ state: 'node', startedAt: before }) })).toBe(false);
  });

  it('gives a corrupt lock a grace period — it may be a writer mid-flight elsewhere', () => {
    const now = Date.now();
    expect(isStale({ corrupt: true, mtimeMs: now - 1_000 }, { now })).toBe(false);
    expect(isStale({ corrupt: true, mtimeMs: now - 60_000 }, { now })).toBe(true);
    expect(isStale(null)).toBe(true);
  });

  it('a nested child needs the parent nonce, not a name', () => {
    const parent = acquire('gate', { ...quiet, probe: live });
    const child = acquire('sql', { ...quiet, env: { [TOKEN_ENV]: parent.nonce } });
    expect(child.nested).toBe(true);
    child.release(); // a nested release must not free the parent's lock
    expect(fs.existsSync(file)).toBe(true);
    expect(() => acquire('sql', { ...quiet, env: { [TOKEN_ENV]: 'forged' } })).toThrow(
      /does not match/,
    );
    parent.release();
  });

  it('refuses to guess the path', () => {
    expect(() => acquire('x', { env: {} })).toThrow(/lockPath/);
  });

  it('lives in the git COMMON dir, so a linked worktree contends for the same lock', () => {
    const repo = scratchRepo('lock-wt');
    commit(repo, { 'a.txt': 'a' }, 'init');
    const wt = path.join(TMP, 'lock-wt-linked');
    run(repo.root, 'git', ['worktree', 'add', '-q', wt, '-b', 'side']);
    expect(fs.realpathSync(path.dirname(lockPath(wt)))).toBe(
      fs.realpathSync(path.join(repo.root, '.git')),
    );
  });
});

// ── state, phases, args ──────────────────────────────────────────────────────

describe('state', () => {
  it('rejects a bad split with every reason', () => {
    const errors = validateSplit({
      slices: [
        { id: 'whole', sessions: [{ id: 'x', scope: 'a' }, { id: 'x' }] },
        { id: 'dup', sessions: [{ id: 'y', scope: 'b' }] },
        { id: 'dup', sessions: [{ id: 'z', scope: 'c' }] },
      ],
    }).join('\n');
    expect(errors).toMatch(/reserved/);
    expect(errors).toMatch(/duplicate session id "x"/);
    expect(errors).toMatch(/session x has no scope/);
    expect(errors).toMatch(/duplicate slice id "dup"/);
    expect(validateSplit({})).toContain('split needs at least one slice');
  });

  it('refuses a slice that asks for a gate leg, with a pointer', () => {
    const bad = { slices: [{ id: 'schema', sql: true, sessions: [{ id: 's', scope: 'a' }] }] };
    expect(validateSplit(bad).join()).toMatch(/slice schema: unknown key "sql" \(gate legs/);
    const typo = { slices: [{ id: 'x', sessions: [{ id: 's', scope: 'a', scopes: [] }] }] };
    expect(validateSplit(typo).join()).toMatch(/session s: unknown key "scopes"/);
  });

  it('derives the phase order from the split — one implement run per session', () => {
    expect(derivePhases(SPLIT).map((p) => p.name)).toEqual([
      'plan-review',
      'implement:s1',
      'review:schema',
      'fix:schema',
      'implement:c1',
      'implement:c2',
      'review:client',
      'fix:client',
      'review:whole',
      'fix:whole',
      'qa',
      'closeout',
    ]);
  });

  it('refuses a write over a state another writer changed (compare-and-swap)', () => {
    const repo = scratchRepo('cas', { paths: { bundles: 'state/bundles' } });
    commit(repo, { 'plan.md': 'p' }, 'init');
    const state = initState({
      repo,
      slug: 'cas',
      planPath: 'plan.md',
      split: SPLIT,
      branch: 'b',
      base: 'x',
      now: 't',
    });
    saveState(repo, state);
    const stale = JSON.parse(JSON.stringify(state));
    saveState(repo, state); // another writer moves the revision on
    expect(() => saveState(repo, stale)).toThrow(/state changed since it was loaded/);
    expect(fs.readdirSync(path.join(repo.root, 'state/bundles/cas'))).toEqual(['state.json']);
  });
});

describe('phases and the args invariant', () => {
  let repo;
  let state;
  let base;
  beforeAll(() => {
    repo = scratchRepo('args');
    base = commit(
      repo,
      { 'plan.md': 'plan v1', 'docs/playbook.md': 'playbook', 'CLAUDE.md': 'rules' },
      'init',
    );
    state = initState({
      repo,
      slug: 'demo',
      planPath: 'plan.md',
      split: SPLIT,
      branch: 'feat-demo',
      base,
      now: 't0',
    });
  });

  it('refuses a phase out of order', () => {
    expect(() => startPhase(state, 'review:whole', { head: base, now: 't' })).toThrow(
      /finish first: plan-review, implement:s1/,
    );
  });

  it('refuses args for a phase that has not started, and for a manual phase', () => {
    expect(() => workflowArgs(state, 'plan-review', repo)).toThrow(/start plan-review first/);
    // A stack pack may add phases the Workflow does not run (E-002); they get no args.
    state.phases.push({ name: 'atlas', status: 'pending', claim: true, runs: [] });
    expect(() => workflowArgs(state, 'atlas', repo)).toThrow(/not a Workflow phase/);
    state.phases.pop();
  });

  it('freezes the review range at start, from the slice first implement start', () => {
    startPhase(state, 'plan-review', { head: base, now: 't1' });
    finishPhase(state, 'plan-review', { now: 't1', head: base });
    startPhase(state, 'implement:s1', { head: base, now: 't1' });
    finishPhase(state, 'implement:s1', { now: 't2', head: base });
    const tip = commit(repo, { 'a.sql': 'x' }, 'slice work');
    const p = startPhase(state, 'review:schema', { head: tip, now: 't3', codex: true });
    expect(p.range).toEqual({ from: base, to: tip });
    commit(repo, { 'b.sql': 'y' }, 'later work');
    expect(workflowArgs(state, 'review:schema', repo).range).toEqual({ from: base, to: tip });
  });

  it('points at the configured playbook, the rules file and the CLI, with hashes', () => {
    const args = workflowArgs(state, 'review:schema', repo);
    expect(args.playbook.path).toBe('docs/playbook.md');
    expect(args.rules).toEqual([{ path: 'CLAUDE.md', sha: expect.stringMatching(/^[0-9a-f]{16}$/) }]);
    expect(args.state).toBe('docs/bundles/demo/state.json');
    expect(args.cli).toBe('npx cookwright bundle');
    expect(args.codex).toBe(true); // frozen at phase start, a measured fact
  });

  it('is byte-stable across state writes that carry run ids and timestamps', () => {
    const before = JSON.stringify(workflowArgs(state, 'review:schema', repo));
    finishPhase(state, 'review:schema', { now: 't4', runId: 'wf_1', usage: 900, keepOpen: true });
    startPhase(state, 'review:schema', { head: 'ignored-while-running', now: 't5', codex: true });
    const after = JSON.stringify(workflowArgs(state, 'review:schema', repo));
    expect(after).toBe(before);
    expect(after).not.toMatch(/wf_1|t4|t5/);
  });

  it('changes when a file it points at changes, so a cached result cannot go stale', () => {
    const before = workflowArgs(state, 'review:schema', repo);
    fs.writeFileSync(path.join(repo.root, 'plan.md'), 'plan v2');
    expect(workflowArgs(state, 'review:schema', repo).plan.sha).not.toBe(before.plan.sha);
    fs.writeFileSync(path.join(repo.root, 'CLAUDE.md'), 'rules v2');
    expect(workflowArgs(state, 'review:schema', repo).rules[0].sha).not.toBe(before.rules[0].sha);
    // Both candidate rules files are read, in order, when both exist.
    fs.writeFileSync(path.join(repo.root, 'AGENTS.md'), 'agents');
    expect(workflowArgs(state, 'review:schema', repo).rules.map((r) => r.path)).toEqual(['AGENTS.md', 'CLAUDE.md']);
    fs.rmSync(path.join(repo.root, 'AGENTS.md'));
  });

  it('stores findings with verdict counts and feeds their hash to the fix args', () => {
    const rel = recordFindings(
      repo,
      state,
      'review:schema',
      {
        issues: [
          { file: 'a', verdict: 'confirmed' },
          { file: 'b', verdict: 'rejected' },
          { file: 'c' },
        ],
      },
      't7',
    );
    expect(rel).toBe('docs/bundles/demo/findings/review-schema-1.json');
    expect(state.findings[0].counts).toEqual({
      confirmed: 1,
      plausible: 0,
      rejected: 1,
      unverified: 1,
    });
    finishPhase(state, 'review:schema', { now: 't8', head: base });
    startPhase(state, 'fix:schema', { head: base, now: 't9' });
    const args = workflowArgs(state, 'fix:schema', repo);
    expect(args.findings[0].path).toBe(rel);
    expect(args.findings[0].sha).toMatch(/^[0-9a-f]{16}$/);
    expect(args.codex).toBe(false); // a run started without the fact reads as absent
  });

  it('records the commit a finished phase ended on', () => {
    finishPhase(state, 'fix:schema', { now: 't10', head: 'endsha' });
    expect(state.phases.find((p) => p.name === 'fix:schema').endCommit).toBe('endsha');
  });

  it('renders a session report with the user-facing strings table', () => {
    const md = renderReport('implement:c1', {
      commits: ['abc123'],
      strings: [{ key: 'home.title', text: 'Home', context: 'tab' }],
    });
    expect(md).toMatch(/\| `home.title` \| Home \| tab \|/);
    expect(md).toMatch(/## Open questions\n- none/);
  });

  it('names the next action, with the host workflow and the resume id once a run has one', () => {
    const phase = state.phases.find((p) => p.name === 'fix:schema');
    phase.status = 'running';
    phase.runs.at(-1).runId = 'wf_9';
    // a FINISHED run is never resumed — its cache would hand back the old result
    expect(nextAction(repo, state, phase)).toMatch(/or a rerun: `phase demo start fix:schema`/);
    delete phase.runs.at(-1).endedAt;
    expect(nextAction(repo, state, phase)).toMatch(
      /scriptPath: 'hosts\/claude\/workflows\/bundle-phase.js', resumeFromRunId: 'wf_9'/,
    );
    expect(nextAction(repo, state, null)).toMatch(/bundle check/);
    expect(nextAction(repo, state, { name: 'qa', status: 'running', runs: [] })).toMatch(
      /record a QA round/,
    );
  });
});

// ── the landing check ────────────────────────────────────────────────────────

describe('check', () => {
  const gate = (commit, extra = {}) => ({ commit, passed: true, slice: null, checks: [], ...extra });
  const phases = [
    { name: 'fix:schema', endCommit: 'a1' },
    { name: 'fix:client', endCommit: 'b2' },
  ];
  const base = { slices: [{ id: 'schema' }, { id: 'client' }], phases };
  // commits in order a1 → b2 → c3; "ancestor" = not later in that order
  const order = ['a1', 'b2', 'c3'];
  const isAncestor = (a, b) => order.indexOf(a) <= order.indexOf(b);
  const verdicts = (state, ctx, opts) =>
    Object.fromEntries(gateChecks(state, { isAncestor, ...ctx }, opts));

  it('passes when every slice gated its end commit and the latest gate is on the last code', () => {
    const state = {
      ...base,
      gates: [gate('a1', { slice: 'schema' }), gate('b2', { slice: 'client' }), gate('c3')],
    };
    const rows = verdicts(state, { lastCode: 'c3' });
    expect(Object.keys(rows)).toEqual([
      'bundle.gate-latest',
      'bundle.gate-slice:schema',
      'bundle.gate-slice:client',
      'bundle.gate-retries',
    ]);
    expect(Object.values(rows).map((r) => r.status)).toEqual(['PASS', 'PASS', 'PASS', 'PASS']);
  });

  it('fails a slice gated only BEFORE its fix ended', () => {
    const early = verdicts(
      { ...base, gates: [gate('a0', { slice: 'schema' }), gate('c3')] },
      { lastCode: 'c3' },
    );
    expect(early['bundle.gate-slice:schema'].note).toMatch(/slice end a1/);
  });

  it('passes a latest gate taken after state-home commits that follow the last code', () => {
    // b2 is the last code commit; c3 is the phase's state commit the gate ran on.
    const rows = verdicts({ ...base, gates: [gate('c3')] }, { lastCode: 'b2' });
    expect(rows['bundle.gate-latest'].status).toBe('PASS');
    expect(rows['bundle.gate-latest'].note).toMatch(
      /passed on c3, which contains the last code b2/,
    );
    const equal = verdicts({ ...base, gates: [gate('c3')] }, { lastCode: 'c3' });
    expect(equal['bundle.gate-latest'].note).toBe('passed on c3');
  });

  it('warns on a latest gate that passed with skipped checks, naming them', () => {
    const holed = gate('c3', {
      checks: [
        { name: 'test', result: 'skipped', note: 'skipped, needs deno, run setup' },
        { name: 'lint', result: 'pass' },
      ],
    });
    const rows = verdicts({ ...base, gates: [holed] }, { lastCode: 'c3' });
    expect(rows['bundle.gate-latest']).toMatchObject({ status: 'WARN' });
    expect(rows['bundle.gate-latest'].note).toMatch(/passed on c3; skipped: test/);
  });

  it('fails a stale latest gate and a red latest gate', () => {
    const stale = verdicts({ ...base, gates: [gate('a1')] }, { lastCode: 'c3' });
    expect(stale['bundle.gate-latest'].status).toBe('FAIL');
    const red = verdicts({ ...base, gates: [gate('c3', { passed: false })] }, { lastCode: 'c3' });
    expect(red['bundle.gate-latest'].note).toMatch(/failed/);
  });

  it('allows one retry of the latest failed gate, on the same commit only', () => {
    const state = { gates: [gate('c3', { passed: false })] };
    expect(checkRetry(state, 'c3')).toBe(0);
    expect(() => checkRetry(state, 'c4')).toThrow(/same commit/);
    state.gates.push(gate('c3', { passed: false, retryOf: 0 }));
    expect(() => checkRetry(state, 'c3')).toThrow(/already retried/);
    expect(() => checkRetry({ gates: [gate('c3')] }, 'c3')).toThrow(/needs a failed gate/);
  });

  it('keeps a red gate visible in the closeout when a retry passes', () => {
    const state = {
      gates: [gate('z9', { passed: false }), gate('z9', { retryOf: 0 })],
      phases: [],
      findings: [],
      costs: [],
      qaRounds: [],
      decisions: [],
      slug: 's',
      branch: 'b',
      base: 'x',
      plan: { path: 'p', sha: 'h' },
    };
    const md = renderCloseoutDraft(state);
    expect(md).toMatch(/\| 0 \| `z9` .*FAIL/);
    expect(md).toMatch(/\| 1 \| `z9` .*pass \| 0 \|/);
    expect(md).not.toMatch(/SQL/);
  });

  it('skips CI when none is configured, warns without gh, and otherwise needs the newest run green', () => {
    expect(ciCheck('c3', {}).status).toBe('SKIP');
    expect(ciCheck('c3', { workflow: 'ci.yml', hasGh: () => false })).toMatchObject({
      status: 'WARN',
      note: messages.noGh,
    });
    const gh =
      (runs, status = 0) =>
      () => ({ status, stdout: JSON.stringify(runs) });
    const ci = (exec) => ciCheck('c3', { workflow: 'ci.yml', hasGh: () => true, exec });
    expect(ci(gh([], 1)).status).toBe('FAIL');
    expect(ci(gh([])).note).toMatch(/push the branch/);
    const pending = [{ status: 'in_progress', createdAt: '2026-09-29T10:00:00Z' }];
    expect(ci(gh(pending)).status).toBe('FAIL');
    const rerun = [
      { status: 'completed', conclusion: 'failure', createdAt: '2026-09-29T10:00:00Z' },
      { status: 'completed', conclusion: 'success', createdAt: '2026-09-29T11:00:00Z' },
    ];
    expect(ci(gh(rerun)).status).toBe('PASS');
    let argv = [];
    ci((cmd, a) => {
      argv = a;
      return { status: 0, stdout: '[]' };
    });
    expect(argv).toContain('ci.yml');
  });

  it('summarizes rows so a pass with holes reads as one', () => {
    const rows = [
      ['a', { status: 'PASS' }],
      ['b', { status: 'SKIP' }],
      ['c', { status: 'WARN' }],
      ['d', { status: 'WARN' }],
    ];
    expect(summarize(rows)).toEqual({ failed: 0, skipped: 1, warned: 2 });
    expect(messages.summary(summarize(rows))).toBe('passed, 1 skipped, 2 warning(s)');
    expect(messages.summary({ failed: 2, skipped: 0, warned: 0 })).toMatch(/FAILED: 2/);
  });

  it('lists phases that are not done', () => {
    const [[, r]] = phaseChecks({
      phases: [
        { name: 'qa', status: 'running' },
        { name: 'closeout', status: 'done' },
      ],
    });
    expect(r.note).toBe('not done: qa');
  });

  it('counts everything outside the state homes as code; the dirty check sees renames', () => {
    const repo = scratchRepo('code-commit');
    const b = commit(repo, { 'a.txt': '1' }, 'base');
    const code = commit(repo, { 'src.js': '1' }, 'code');
    commit(repo, { 'docs/bundles/x/state.json': '{}' }, 'chore(bundle)');
    const tip = commit(
      repo,
      { 'docs/closeouts/x.md': 'c', 'docs/backlog.md': 'b' },
      'closeout + backlog',
    );
    expect(lastCodeCommit(b, run(repo.root, 'git', ['rev-parse', 'HEAD']), repo)).toBe(code);
    expect(lastCodeCommit(b, tip, repo)).toBe(code);
    // Markdown outside the state homes IS code here: a skill or the playbook.
    const skill = commit(repo, { 'hosts/claude/skills/bundle/SKILL.md': 's' }, 'skill');
    expect(lastCodeCommit(b, skill, repo)).toBe(skill);
    fs.writeFileSync(path.join(repo.root, 'docs/bundles/x/state.json'), '{"a":1}');
    expect(dirtyPaths(repo.root, { exclude: ['docs/bundles/'] })).toEqual([]);
    run(repo.root, 'git', ['mv', 'src.js', 'docs/bundles/x/moved.js']);
    expect(dirtyPaths(repo.root, { exclude: ['docs/bundles/'] })).toEqual(['src.js']);
    fs.writeFileSync(path.join(repo.root, 'a file é.txt'), 'x');
    expect(dirtyPaths(repo.root, { exclude: ['docs/bundles/'] })).toContain('a file é.txt');
  });
});

// ── gate and closeout ────────────────────────────────────────────────────────

describe('gate', () => {
  const quiet = { log: () => {} };
  const withChecks = (checks) => ({
    root: TMP,
    config: { gate: { checks, flakes: {} } },
  });

  it('skips a check whose tool or command is missing, with the note a user acts on', () => {
    const checks = [
      { name: 'a', run: 'true' },
      { name: 'b', run: 'true', needs: ['deno', 'docker'] },
      { name: 'c', run: 'CI=1 FOO=bar no-such-cmd --flag' },
    ];
    const planned = planChecks({ checks, hasTool: (t) => t !== 'docker' && t !== 'no-such-cmd' });
    expect(planned[0].skip).toBeUndefined();
    expect(planned[1].skip).toBe('skipped, needs docker, run setup');
    expect(planned[2].skip).toBe('skipped, command not found: no-such-cmd');
    expect(commandOf('  A=1 npm test')).toBe('npm');
    expect(commandOf('')).toBe('');
  });

  it('runs shell commands, passes over skips, and shows every red at once', () => {
    const out = runGate({
      repo: withChecks([
        { name: 'ok', run: 'echo fine && exit 0' },
        { name: 'needs', run: 'true', needs: ['no-such-tool-xyz'] },
        { name: 'absent', run: 'no-such-command-xyz --flag' },
        { name: 'red', run: 'echo boom >&2; exit 3' },
        // Absence is decided before the run: a 127 from a command that DID start
        // (a runner missing below npm, say) is a failure, never a skip.
        { name: 'inner127', run: 'sh -c "exit 127"' },
      ]),
      ...quiet,
    });
    const by = Object.fromEntries(out.results.map((r) => [r.name, r]));
    expect(by.ok.result).toBe('pass');
    expect(by.needs).toMatchObject({ result: 'skipped', note: messages.skippedNeeds('no-such-tool-xyz') });
    expect(by.absent).toMatchObject({ result: 'skipped', note: messages.skippedNotFound('no-such-command-xyz') });
    expect(by.red.result).toBe('fail');
    expect(by.red.tail).toMatch(/boom/);
    expect(by.inner127.result).toBe('fail');
    expect(gatePassed(out.results)).toBe(false);
    const greens = out.results.filter((r) => !['red', 'inner127'].includes(r.name));
    expect(gatePassed(greens)).toBe(true);
    expect(passLabel({ checks: greens })).toBe('pass (skipped: needs, absent)');
    expect(passLabel({ checks: [by.ok] })).toBe('pass');
  });

  it('reads the npm script a command names', () => {
    expect(npmScriptOf('npm test')).toBe('test');
    expect(npmScriptOf('CI=1 npm t -- --run')).toBe('test');
    expect(npmScriptOf('npm run --silent lint')).toBe('lint');
    expect(npmScriptOf('npm run-script typecheck')).toBe('typecheck');
    expect(npmScriptOf('npm run')).toBeNull();
    expect(npmScriptOf('npm ci')).toBeNull();
    expect(npmScriptOf('npx vitest run')).toBeNull();
    expect(npmScriptOf('yarn lint')).toBeNull();
  });

  it('refuses a check naming an npm script the repo lacks — misconfiguration, not absence', () => {
    const root = path.join(TMP, 'gate-scripts');
    fs.mkdirSync(root, { recursive: true });
    const gate = (checks) => runGate({ repo: { root, config: { gate: { checks, flakes: {} } } }, ...quiet });
    const checks = [
      { name: 'lint', run: 'npm run lint' },
      { name: 'ok', run: 'true' },
    ];
    expect(gate(checks).refused).toBe(messages.noPackageJson('lint', 'lint'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'true' } }));
    expect(gate(checks).refused).toBe(messages.missingScript('lint', 'lint'));
    expect(gate([{ name: 'test', run: 'npm test' }, ...checks]).refused).toBe(messages.missingScript('lint', 'lint'));
    const ran = gate([{ name: 'test', run: 'npm test' }]);
    expect(ran.results.map((r) => [r.name, r.result])).toEqual([['test', 'pass']]);
  });

  it('refuses a gate in which nothing ran, and an empty check list', () => {
    const allSkipped = runGate({
      repo: withChecks([{ name: 'x', run: 'true', needs: ['no-such-tool-xyz'] }]),
      ...quiet,
    });
    expect(allSkipped.refused).toBe(messages.noCheckRan);
    expect(runGate({ repo: withChecks([]), ...quiet }).refused).toBe(messages.noChecksConfigured);
  });
});

describe('closeout numbers', () => {
  it('derives four numbers and marks USD as entered or absent', () => {
    const state = {
      createdAt: '2026-10-01T08:00:00Z',
      phases: [
        {
          name: 'plan-review',
          runs: [
            {
              startedAt: '2026-10-01T09:00:00Z',
              endedAt: '2026-10-01T10:00:00Z',
              turnOutputTokens: 100,
            },
          ],
        },
        {
          name: 'review:whole',
          runs: [{ startedAt: 'x' }, { startedAt: '2026-10-01T11:00:00Z', turnOutputTokens: 50 }],
        },
      ],
      qaRounds: [{}, {}],
      costs: [],
    };
    expect(fiveNumbers(state)).toMatchObject({
      wallClockHours: 3,
      usdEntered: null,
      outputTokens: 150,
      reviewRounds: 3,
      qaRounds: 2,
    });
    expect(fiveNumbers({ ...state, costs: [{ usd: 40 }, { usd: 2.5 }] }).usdEntered).toBe(42.5);
  });
});

describe('argv', () => {
  it('pairs flags with values and treats a flag before a flag as boolean', () => {
    expect(parseArgv(['demo', '--retry', '--slice', 'schema', 'x'])).toEqual({
      pos: ['demo', 'x'],
      flags: { retry: true, slice: 'schema' },
    });
  });
});

// ── review completeness, terminal phases, QA, the closeout ───────────────────

describe('review completeness and phase evidence', () => {
  let repo;
  let state;
  let base;
  beforeAll(() => {
    repo = scratchRepo('terminal');
    base = commit(repo, { 'plan.md': 'p', 'docs/playbook.md': 'pb' }, 'init');
    state = initState({
      repo,
      slug: 'term',
      planPath: 'plan.md',
      split: { slices: [{ id: 'client', sessions: [{ id: 'c1', scope: '§1' }] }] },
      branch: 'b',
      base,
      now: 't',
    });
    startPhase(state, 'plan-review', { head: base, now: 't' });
  });

  it('refuses an incomplete review unless accepted by name', () => {
    const result = { issues: [], incomplete: ['the red-team reviewer returned nothing'] };
    expect(() => recordFindings(repo, state, 'plan-review', result, 't')).toThrow(
      /incomplete review: the red-team reviewer returned nothing/,
    );
    recordFindings(repo, state, 'plan-review', result, 't', { acceptIncomplete: 'reran by hand' });
    expect(state.findings.at(-1).acceptedIncomplete).toBe('reran by hand');
  });

  it('will not close plan review with a P1/P2 open, tolerates P3 residue, rechecks on rerun', () => {
    const issue = (severity, verdict = 'plausible') => ({ file: 'plan.md', severity, verdict });
    recordFindings(repo, state, 'plan-review', { issues: [issue('P2'), issue('P3')] }, 't');
    expect(doneBlocker(state, 'plan-review', { head: base })).toMatch(
      /1 P1\/P2 finding\(s\) still open/,
    );
    expect(doneBlocker(state, 'plan-review', { head: base, acceptOpen: 'product call' })).toBeNull();
    // the rerun re-judges the open findings only
    expect(workflowArgs(state, 'plan-review', repo).recheck.path).toMatch(/plan-review-2\.json$/);
    expect(workflowArgs(state, 'plan-review', repo).rules).toBeUndefined(); // no rules file here
    recordFindings(repo, state, 'plan-review', { issues: [issue('P3')] }, 't');
    expect(doneBlocker(state, 'plan-review', { head: base })).toBeNull();
    expect(workflowArgs(state, 'plan-review', repo).recheck).toBeUndefined();
  });

  it('records the run id of a run in flight, so a crash resumes it', () => {
    setRunId(state, 'plan-review', { runId: 'wf_live' });
    expect(nextAction(repo, state, state.phases[0])).toMatch(/resumeFromRunId: 'wf_live'/);
    finishPhase(state, 'plan-review', { now: 't', head: base });
  });

  it('closes implement/fix only with a session report and a passing gate on HEAD', () => {
    startPhase(state, 'implement:c1', { head: base, now: 't' });
    expect(doneBlocker(state, 'implement:c1', { head: base })).toMatch(/session report first/);
    state.reports.push({ phase: 'implement:c1', path: 'r' });
    expect(doneBlocker(state, 'implement:c1', { head: base })).toMatch(/no passing gate covers/);
    state.gates.push({ commit: base, passed: true, checks: [] });
    expect(doneBlocker(state, 'implement:c1', { head: base })).toBeNull();
    finishPhase(state, 'implement:c1', { now: 't', head: base });
  });

  it('reopens a done phase only while every later phase is pending', () => {
    expect(() => startPhase(state, 'plan-review', { head: base, now: 't' })).toThrow(
      /implement:c1 has started — cannot reopen/,
    );
    startPhase(state, 'implement:c1', { head: base, now: 't' });
    expect(state.phases[1].status).toBe('running');
    finishPhase(state, 'implement:c1', { now: 't', head: base });
  });

  it('refuses closeout args until the closeout exists, then hashes it with the state revision', () => {
    for (const p of state.phases) p.status = 'done';
    state.phases.find((p) => p.name === 'fix:whole').endCommit = base;
    const closeout = state.phases.find((p) => p.name === 'closeout');
    closeout.status = 'pending';
    startPhase(state, 'closeout', { head: base, now: 't' });
    expect(() => workflowArgs(state, 'closeout', repo)).toThrow(/write docs\/closeouts\/term\.md/);
    fs.mkdirSync(path.join(repo.root, 'docs/closeouts'), { recursive: true });
    fs.writeFileSync(path.join(repo.root, 'docs/closeouts/term.md'), 'v1');
    const v1 = workflowArgs(state, 'closeout', repo);
    expect(v1.stateRevision).toBe(0);
    fs.writeFileSync(path.join(repo.root, 'docs/closeouts/term.md'), 'v2');
    expect(workflowArgs(state, 'closeout', repo).closeout.sha).not.toBe(v1.closeout.sha);
  });

  it('passes the closeout check only for a verify run against the current text', () => {
    const sha = workflowArgs(state, 'closeout', repo).closeout.sha;
    recordFindings(repo, state, 'closeout', { issues: [], closeoutSha: 'old' }, 't');
    expect(closeoutCheck(repo, state).note).toMatch(/changed after its last verify/);
    recordFindings(repo, state, 'closeout', { issues: [], closeoutSha: sha }, 't');
    expect(closeoutCheck(repo, state).status).toBe('PASS');
  });

  it('points a QA fix run at the latest round, and requires a review of changed code', () => {
    const qa = state.phases.find((p) => p.name === 'qa');
    qa.status = 'running';
    qa.startCommit = 'q0';
    qa.range = { from: 'q0', to: 'HEAD' };
    qa.runs.push({ startedAt: 't' });
    expect(() => workflowArgs(state, 'qa', repo)).toThrow(/no QA round recorded/);
    recordQa(repo, state, 'round one: the sheet clips', 't');
    recordQa(repo, state, 'round two: the button is off-screen', 't');
    const args = workflowArgs(state, 'qa', repo);
    expect(args.findings[0].path).toBe('docs/bundles/term/qa/round-2.md');
    expect(args.range).toEqual({ from: 'q0', to: 'HEAD' });
    expect(doneBlocker(state, 'qa', { head: 'q0' })).toBeNull(); // no code changed
    state.gates.push({ commit: 'q1', passed: true, checks: [] });
    expect(doneBlocker(state, 'qa', { head: 'q1' })).toMatch(/code changed during QA/);
    recordFindings(repo, state, 'qa', { issues: [] }, 't', { head: 'q1' });
    expect(doneBlocker(state, 'qa', { head: 'q1' })).toBeNull();
  });
});

describe('the QA-review landing check', () => {
  const order = ['w', 'q1', 'q2'];
  const contains = (a, b) => order.indexOf(a) <= order.indexOf(b);
  const state = (findings, decisions = []) => ({
    phases: [{ name: 'fix:whole', endCommit: 'w' }],
    findings,
    decisions,
  });
  const rec = (head, open = 0) => ({
    phase: 'qa',
    head,
    counts: { confirmed: open, plausible: 0, rejected: 0, unverified: 0 },
    openBySeverity: { P1: open, P2: 0, P3: 0 },
  });

  it('passes with no code after the whole-branch fix', () => {
    expect(qaReviewedCheck(state([]), { lastCode: 'w', isAncestor: contains }).status).toBe('PASS');
  });

  it('fails QA code no review has seen, and an open QA finding', () => {
    expect(
      qaReviewedCheck(state([rec('q1')]), { lastCode: 'q2', isAncestor: contains }).status,
    ).toBe('FAIL');
    expect(
      qaReviewedCheck(state([rec('q2', 1)]), { lastCode: 'q2', isAncestor: contains }).status,
    ).toBe('FAIL');
    expect(
      qaReviewedCheck(state([rec('q2')]), { lastCode: 'q2', isAncestor: contains }).status,
    ).toBe('PASS');
  });
});

describe('probePid on this machine', () => {
  it('reads its own start time whatever the locale', () => {
    const p = probePid(process.pid);
    expect(p.state).toBe('node');
    expect(Math.abs(Date.now() - p.startedAt)).toBeLessThan(24 * 3_600_000);
  });
});

// ── runs, reopening, carry-forward, audits ───────────────────────────────────

describe('runs, reopening and the evidence rules', () => {
  let repo;
  let state;
  let base;
  beforeAll(() => {
    repo = scratchRepo('runs');
    base = commit(repo, { 'plan.md': 'p', 'docs/playbook.md': 'pb' }, 'init');
    state = initState({
      repo,
      slug: 'runs',
      planPath: 'plan.md',
      split: { slices: [{ id: 'client', sessions: [{ id: 'c1', scope: '§1' }] }] },
      branch: 'b',
      base,
      now: 't',
    });
  });

  it('gives every rerun its own run and refuses a second id on one run', () => {
    startPhase(state, 'plan-review', { head: base, now: 't1' });
    setRunId(state, 'plan-review', { runId: 'wf_1' });
    expect(() => setRunId(state, 'plan-review', { runId: 'wf_2' })).toThrow(/phase start/);
    startPhase(state, 'plan-review', { head: base, now: 't2' }); // the rerun
    setRunId(state, 'plan-review', { runId: 'wf_2' });
    expect(state.phases[0].runs.map((r) => r.runId)).toEqual(['wf_1', 'wf_2']);
  });

  it('carries forward every open finding a re-check dropped or never judged', () => {
    const issue = (location, severity) => ({
      file: 'plan.md',
      location,
      problem: `p-${location}`,
      severity,
      verdict: 'plausible',
    });
    const first = recordFindings(
      repo,
      state,
      'plan-review',
      { issues: [issue('a', 'P1'), issue('b', 'P2')] },
      't',
    );
    recordFindings(
      repo,
      state,
      'plan-review',
      { issues: [{ ...issue('a', 'P1'), verdict: 'rejected' }], recheckOf: first },
      't',
    );
    expect(state.findings.at(-1).openBySeverity).toEqual({ P1: 0, P2: 1, P3: 0 });
    recordFindings(
      repo,
      state,
      'plan-review',
      { issues: [], incomplete: ['dead'], recheckOf: first },
      't',
      { acceptIncomplete: 'accepted' },
    );
    expect(state.findings.at(-1).openBySeverity).toEqual({ P1: 1, P2: 1, P3: 0 });
  });

  it('refuses a session report that is not the IMPL shape', () => {
    expect(() => recordReport(repo, state, 'plan-review', null, 't')).toThrow(/IMPL shape/);
    expect(() =>
      recordReport(repo, state, 'plan-review', { phase: 'x', results: {} }, 't'),
    ).toThrow(/IMPL shape/);
  });

  it('lets a gate cover code with state-home commits after it', () => {
    const order = ['c', 'g', 'd'];
    const contains = (a, b) => order.indexOf(a) <= order.indexOf(b);
    const s = {
      ...state,
      phases: state.phases.map((p) => ({
        ...p,
        status: p.name === 'implement:c1' ? 'running' : p.status,
      })),
      reports: [{ phase: 'implement:c1' }],
      gates: [{ commit: 'g', passed: true, checks: [] }],
    };
    expect(doneBlocker(s, 'implement:c1', { head: 'd', lastCode: 'c', contains })).toBeNull();
    expect(doneBlocker(s, 'implement:c1', { head: 'd', lastCode: 'd', contains })).toMatch(
      /gate first/,
    );
  });

  it('reopens qa while the closeout has started, resetting the closeout', () => {
    for (const p of state.phases) p.status = 'done';
    const closeout = state.phases.find((p) => p.name === 'closeout');
    closeout.status = 'running';
    startPhase(state, 'qa', { head: base, now: 't' });
    expect(state.phases.find((p) => p.name === 'qa').status).toBe('running');
    expect(closeout.status).toBe('pending');
  });

  it('refuses qa with no round unless the exemption is named', () => {
    expect(doneBlocker(state, 'qa', { head: base })).toMatch(/no QA round/);
    expect(doneBlocker(state, 'qa', { head: base, noDevice: 'CLI-only bundle' })).toBeNull();
  });

  it('audits retries: each must name a flake from the configured allowlist', () => {
    const phases = [{ name: 'fix:client', endCommit: 'a' }];
    const g = (extra) => ({ commit: 'a', passed: true, checks: [], ...extra });
    const rows = (gates, flakes) =>
      Object.fromEntries(
        gateChecks(
          { slices: [{ id: 'client' }], phases, gates },
          { lastCode: 'a', isAncestor: (x, y) => x === y },
          { flakes },
        ),
      );
    const gates = [g({ passed: false }), g({ retryOf: 0, flake: 'B-7' })];
    expect(rows(gates, {})['bundle.gate-retries'].status).toBe('FAIL');
    expect(rows(gates, { 'B-7': 'a slow suite' })['bundle.gate-retries'].status).toBe('PASS');
  });

  it('rejects checkpoints that are not a list of strings', () => {
    const bad = { slices: [{ id: 'x', sessions: [{ id: 's', scope: 'a', checkpoints: 'one' }] }] };
    expect(validateSplit(bad).join()).toMatch(/checkpoints must be a list/);
  });
});

// ── the whole loop, end to end ───────────────────────────────────────────────

describe('a one-slice bundle, every phase, to a passing landing check', () => {
  it('walks the playbook loop and lands with every row green, CI skipped', () => {
    const repo = scratchRepo('e2e', { paths: { closeouts: 'docs/dev/closeouts' } });
    const dir = repo.root;
    commit(repo, { 'src/app.ts': 'v0', 'docs/playbook.md': 'pb', 'CLAUDE.md': 'c' }, 'main');
    run(dir, 'git', ['checkout', '-q', '-b', 'feat-e2e']);
    commit(repo, { 'docs/bundles/e2e/plan.md': 'the plan' }, 'chore(bundle): init');
    const base = run(dir, 'git', ['merge-base', 'main', 'HEAD']);
    const contains = (a, b) => isAncestor(a, b, dir);
    const state = initState({
      repo,
      slug: 'e2e',
      planPath: 'docs/bundles/e2e/plan.md',
      split: { slices: [{ id: 'client', sessions: [{ id: 'c1', scope: '§1' }] }] },
      branch: 'feat-e2e',
      base,
      now: '2026-10-01T08:00:00Z',
    });
    const tip = () => run(dir, 'git', ['rev-parse', 'HEAD']);
    const gate = () => state.gates.push({ commit: tip(), passed: true, slice: null, checks: [] });
    const done = (name, extra = {}) => {
      const ctx = { head: tip(), lastCode: lastCodeCommit(base, tip(), repo), contains, ...extra };
      const phase = state.phases.find((p) => p.name === name);
      ctx.qaLastCode = lastCodeCommit(phase.startCommit, tip(), repo);
      expect(doneBlocker(state, name, ctx)).toBeNull();
      finishPhase(state, name, { now: 't', head: tip(), lastCode: ctx.lastCode });
    };
    const start = (name) => startPhase(state, name, { head: tip(), now: 't', mergeBase: base });
    const clean = { issues: [] };

    start('plan-review');
    recordFindings(repo, state, 'plan-review', clean, 't', { head: tip() });
    done('plan-review');

    start('implement:c1');
    commit(repo, { 'src/app.ts': 'v1' }, 'feat: the change');
    recordReport(repo, state, 'implement:c1', { commits: [tip()], files: ['src/app.ts'] }, 't');
    gate();
    commit(repo, { 'docs/bundles/e2e/sessions/x.md': 'r' }, 'chore(bundle): report'); // state after the gate
    done('implement:c1');

    for (const name of ['review:client', 'review:whole']) {
      start(name);
      recordFindings(
        repo,
        state,
        name,
        { issues: [{ file: 'src/app.ts', severity: 'P2', verdict: 'confirmed' }] },
        't',
        { head: tip() },
      );
      done(name);
      const fixName = name.replace('review', 'fix');
      start(fixName);
      commit(repo, { 'src/app.ts': `fixed after ${name}` }, `fix: ${name}`);
      recordReport(repo, state, fixName, { commits: [tip()], files: ['src/app.ts'] }, 't');
      gate();
      done(fixName);
    }

    start('qa');
    recordQa(repo, state, 'round 1: the button is clipped', 't');
    commit(repo, { 'src/app.ts': 'qa fix' }, 'fix: qa round 1');
    recordReport(repo, state, 'qa', { commits: [tip()], files: ['src/app.ts'] }, 't');
    gate();
    recordFindings(repo, state, 'qa', clean, 't', { head: tip() });
    done('qa');

    start('closeout');
    commit(repo, { 'docs/dev/closeouts/e2e.md': 'the closeout' }, 'docs: closeout');
    const sha = workflowArgs(state, 'closeout', repo).closeout.sha;
    recordFindings(repo, state, 'closeout', { issues: [], closeoutSha: sha }, 't', { head: tip() });
    done('closeout');

    saveState(repo, state);
    commit(repo, {}, 'chore(bundle): state');

    const rows = Object.fromEntries(bundleChecks(repo, state));
    const failing = Object.entries(rows).filter(
      ([n, r]) => n !== 'bundle.ci' && r.status !== 'PASS',
    );
    expect(failing).toEqual([]);
    expect(rows['bundle.ci'].status).toBe('SKIP'); // no ci block configured
    expect(summarize(Object.entries(rows))).toEqual({ failed: 0, skipped: 1, warned: 0 });
  }, 30_000);
});

// ── the CLI entry ────────────────────────────────────────────────────────────

describe('the CLI', () => {
  const logs = [];
  const errors = [];
  let logSpy;
  let errSpy;
  beforeAll(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation((...a) => logs.push(a.join(' ')));
    errSpy = vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a.join(' ')));
  });
  afterAll(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
  });
  afterEach(() => {
    logs.length = 0;
    errors.length = 0;
  });

  it('finds the root from a nested directory, and refuses outside a cookwright repo', () => {
    const repo = scratchRepo('cli-root');
    commit(repo, { 'a/b/c.txt': 'x' }, 'init');
    expect(main(['status'], { cwd: path.join(repo.root, 'a/b') })).toBe(0);
    expect(logs.join('\n')).toMatch(/no bundle state for this branch \(docs\/bundles/);
    const bare = path.join(TMP, 'cli-bare');
    fs.mkdirSync(bare, { recursive: true });
    expect(main(['status'], { cwd: bare })).toBe(2);
    expect(errors.join('\n')).toMatch(/no cookwright\.json here or in any parent directory/);
    expect(main(['bogus'], { cwd: repo.root })).toBe(2);
    expect(errors.join('\n')).toMatch(/usage: npx cookwright bundle </);
  });

  it('refuses a nested repo whose only cookwright.json belongs to the enclosing one', () => {
    const outer = scratchRepo('cli-outer');
    const inner = gitInit(path.join(outer.root, 'vendor/inner'));
    errors.length = 0;
    expect(main(['status'], { cwd: inner })).toBe(2);
    expect(errors.join('\n')).toMatch(/no cookwright\.json here or in any parent directory/);
  });

  it('inits a bundle, gates it with the configured checks, starts a phase and emits args', () => {
    const repo = scratchRepo('cli-walk', {
      gate: { checks: [{ name: 'ok', run: 'true' }, { name: 'opt', run: 'true', needs: ['no-such-tool-xyz'] }] },
    });
    commit(repo, { 'docs/playbook.md': 'pb', 'CLAUDE.md': 'rules' }, 'main');
    const plan = path.join(TMP, 'cli-walk-plan.md');
    const split = path.join(TMP, 'cli-walk-split.json');
    fs.writeFileSync(plan, 'the plan');
    fs.writeFileSync(
      split,
      JSON.stringify({ slices: [{ id: 'core', sessions: [{ id: 's1', scope: '§1' }] }] }),
    );
    const cli = (...argv) => main(argv, { cwd: repo.root });

    expect(cli('init', 'demo', '--plan', plan, '--split', split)).toBe(2); // still on main
    expect(errors.at(-1)).toMatch(/cut the bundle branch first/);
    run(repo.root, 'git', ['checkout', '-q', '-b', 'bundle/demo']);
    expect(cli('init', 'demo', '--plan', plan, '--split', split)).toBe(0);
    expect(fs.existsSync(path.join(repo.root, 'docs/bundles/demo/plan.md'))).toBe(true);
    expect(logs.join('\n')).toMatch(/phases: plan-review → implement:s1 → review:core/);
    expect(cli('init', 'demo', '--plan', plan, '--split', split)).toBe(2);
    expect(errors.at(-1)).toMatch(/already exists/);

    commit(repo, {}, 'chore(bundle): demo initialized');
    expect(cli('gate', 'demo')).toBe(0);
    expect(logs.join('\n')).toMatch(/SKIPPED opt \(skipped, needs no-such-tool-xyz, run setup\)/);
    expect(logs.join('\n')).toMatch(/gate PASSED — recorded as gate #0/);
    expect(cli('gate', 'demo', '--retry', '--flake', 'B-1')).toBe(2);
    expect(errors.at(-1)).toMatch(/names no flake yet/);

    expect(cli('phase', 'demo', 'start', 'plan-review')).toBe(0);
    expect(cli('args', 'demo', 'plan-review')).toBe(0);
    const args = JSON.parse(logs.at(-1));
    expect(args).toMatchObject({
      phase: 'plan-review',
      slug: 'demo',
      branch: 'bundle/demo',
      state: 'docs/bundles/demo/state.json',
      playbook: { path: 'docs/playbook.md' },
      rules: [{ path: 'CLAUDE.md' }],
    });
    expect(typeof args.codex).toBe('boolean');
    expect(cli('status')).toBe(0); // the slug resolves from the branch
    expect(logs.join('\n')).toMatch(/Workflow\(\{ scriptPath: 'hosts\/claude\/workflows\/bundle-phase\.js'/);
    expect(cli('check', '--ci')).toBe(0);
    expect(logs.join('\n')).toMatch(/SKIP  repo  no repo-wide checks configured/);
    // The skipped check is on the recorded event, and status reads it back.
    const state = () => JSON.parse(fs.readFileSync(path.join(repo.root, 'docs/bundles/demo/state.json'), 'utf8'));
    expect(state().gates[0].checks).toEqual([
      { name: 'ok', result: 'pass', ms: expect.any(Number) },
      { name: 'opt', result: 'skipped', ms: 0, note: 'skipped, needs no-such-tool-xyz, run setup' },
    ]);
    expect(logs.join('\n')).toMatch(/last gate: pass \(skipped: opt\) on/);
  });

  it('records findings, closes a phase, takes decisions and costs, and audits a retry', () => {
    const flag = path.join(TMP, 'cli-retry-flag');
    const repo = scratchRepo('cli-retry', {
      gate: {
        checks: [{ name: 'flaky', run: `test -f ${flag}` }],
        flakes: { 'B-1': 'a suite that needs a warm cache' },
      },
    });
    commit(repo, { 'docs/playbook.md': 'pb' }, 'main');
    const plan = path.join(TMP, 'cli-retry-plan.md');
    const split = path.join(TMP, 'cli-retry-split.json');
    fs.writeFileSync(plan, 'the plan');
    fs.writeFileSync(split, JSON.stringify({ slices: [{ id: 'core', sessions: [{ id: 's1', scope: '§1' }] }] }));
    run(repo.root, 'git', ['checkout', '-q', '-b', 'bundle/rt']);
    let stdin = '';
    const cli = (...argv) => main(argv, { cwd: repo.root, input: () => stdin });
    expect(cli('init', 'rt', '--plan', plan, '--split', split)).toBe(0);
    commit(repo, {}, 'chore(bundle): rt initialized');

    expect(cli('gate', 'rt')).toBe(1); // red: the flag file is absent
    expect(cli('gate', 'rt', '--retry', '--flake', 'B-9')).toBe(2);
    expect(errors.at(-1)).toMatch(/--flake B-9 is not an allowlisted flake \(B-1\)/);
    fs.writeFileSync(flag, '');
    expect(cli('gate', 'rt', '--retry', '--flake', 'B-1')).toBe(0);
    const state = () => JSON.parse(fs.readFileSync(path.join(repo.root, 'docs/bundles/rt/state.json'), 'utf8'));
    expect(state().gates.map((g) => [g.passed, g.retryOf, g.flake])).toEqual([
      [false, undefined, undefined],
      [true, 0, 'B-1'],
    ]);
    expect(cli('gate', 'rt', '--retry', '--flake', 'B-1')).toBe(2); // the latest gate passed

    expect(cli('phase', 'rt', 'start', 'plan-review')).toBe(0);
    expect(cli('phase', 'rt', 'done', 'plan-review')).toBe(2);
    expect(errors.at(-1)).toMatch(/record plan-review's findings first/);
    stdin = JSON.stringify({ issues: [{ file: 'plan', severity: 'P3', verdict: 'plausible' }] });
    expect(cli('record', 'rt', 'findings', 'plan-review')).toBe(0);
    expect(logs.at(-1)).toBe('stored docs/bundles/rt/findings/plan-review-1.json');
    expect(cli('phase', 'rt', 'done', 'plan-review', '--usage', '1200')).toBe(0);
    expect(cli('decide', 'rt', '--actor', 'orchestrator', '--source', 'plan §2', '--text', 'kept the P3')).toBe(0);
    expect(cli('cost', 'rt', '--usd', '1.5', '--note', 'plan review')).toBe(0);
    expect(cli('cost', 'rt')).toBe(2);
    const s = state();
    expect(s.phases[0]).toMatchObject({ status: 'done', runs: [{ turnOutputTokens: 1200 }] });
    expect(s.decisions.at(-1)).toMatchObject({ text: 'kept the P3', claim: true });
    expect(s.costs).toEqual([{ at: expect.any(String), usd: 1.5, note: 'plan review', entered: true }]);
    expect(cli('status')).toBe(0);
    expect(logs.at(-1)).toMatch(/next     : npx cookwright bundle phase rt start implement:s1/);
  });

  it('records the run id only, refuses a flag a phase verb does not take, and persists no absolute path', () => {
    const repo = scratchRepo('cli-paths', { gate: { checks: [{ name: 'ok', run: 'true' }] } });
    commit(repo, { 'docs/playbook.md': 'pb' }, 'main');
    const plan = path.join(TMP, 'cli-paths-plan.md');
    const split = path.join(TMP, 'cli-paths-split.json');
    fs.writeFileSync(plan, 'the plan');
    fs.writeFileSync(split, JSON.stringify({ slices: [{ id: 'core', sessions: [{ id: 's1', scope: '§1' }] }] }));
    run(repo.root, 'git', ['checkout', '-q', '-b', 'bundle/paths']);
    let stdin = '';
    const cli = (...argv) => main(argv, { cwd: repo.root, input: () => stdin });
    expect(cli('init', 'paths', '--plan', plan, '--split', split)).toBe(0);
    commit(repo, {}, 'chore(bundle): paths initialized');
    expect(cli('gate', 'paths')).toBe(0);
    expect(cli('phase', 'paths', 'start', 'plan-review')).toBe(0);

    const dir = path.join(TMP, 'transcripts/wf_1');
    expect(cli('phase', 'paths', 'run', 'plan-review', '--run-id', 'wf_1', '--transcript-dir', dir)).toBe(2);
    expect(errors.at(-1)).toMatch(/unknown flag --transcript-dir \(known: --run-id\)/);
    expect(cli('phase', 'paths', 'run', 'plan-review', '--run-id', 'wf_1')).toBe(0);
    expect(cli('phase', 'paths', 'done', 'plan-review', '--transcript-dir', dir)).toBe(2);
    expect(errors.at(-1)).toMatch(/unknown flag --transcript-dir/);
    expect(cli('phase', 'paths', 'start', 'implement:s1', '--tokens', '9')).toBe(2);

    const saved = fs.readFileSync(path.join(repo.root, 'docs/bundles/paths/state.json'), 'utf8');
    const strings = [];
    const walk = (v) => {
      if (typeof v === 'string') strings.push(v);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(JSON.parse(saved));
    expect(strings.length).toBeGreaterThan(10);
    expect(strings.filter((s) => s.startsWith('/') || /^[A-Za-z]:\\/.test(s))).toEqual([]);
    expect(JSON.parse(saved).phases[0].runs[0]).toMatchObject({ runId: 'wf_1' });
    expect(JSON.parse(saved).phases[0].runs[0]).not.toHaveProperty('transcriptDir');

    // Every record beside the state, too: a session's absolute file list becomes
    // root-relative, and any other path on this machine is redacted.
    const scratch = path.join(os.tmpdir(), 'scratchpad/codex.out');
    const home = path.join(os.homedir(), 'notes.md');
    const abs = path.join(repo.root, 'src/a.mjs');
    stdin = JSON.stringify({ commits: ['abc'], files: [abs, 'b.mjs'], notes: `see ${abs}, ${scratch} and ${home}` });
    expect(cli('record', 'paths', 'session', 'implement:s1')).toBe(0);
    stdin = JSON.stringify({ issues: [], notes: `output at ${scratch}`, partialReportPath: scratch });
    expect(cli('record', 'paths', 'findings', 'plan-review')).toBe(0);
    stdin = `QA notes in ${repo.root}/qa.md and ${home}`;
    expect(cli('record', 'paths', 'qa')).toBe(0);
    stdin = JSON.stringify({ commits: [], files: [home] });
    expect(cli('record', 'paths', 'session', 'implement:s1')).toBe(2);
    expect(errors.at(-1)).toMatch(/a session report lists a file outside the repo/);

    const bdir = path.join(repo.root, 'docs/bundles/paths');
    const files = fs.readdirSync(bdir, { recursive: true }).filter((f) => fs.statSync(path.join(bdir, f)).isFile());
    expect(files).toEqual(
      expect.arrayContaining(['state.json', 'sessions/implement-s1-1.md', 'findings/plan-review-1.json', 'qa/round-1.md']),
    );
    const local = [repo.root, fs.realpathSync(repo.root), os.homedir(), os.tmpdir()];
    for (const f of files) {
      const text = fs.readFileSync(path.join(bdir, f), 'utf8');
      expect(local.filter((l) => text.includes(l)), f).toEqual([]);
    }
    const report = fs.readFileSync(path.join(bdir, 'sessions/implement-s1-1.md'), 'utf8');
    expect(report).toContain('- `src/a.mjs`');
    expect(report).toContain('see src/a.mjs, <local path> and <local path>');
  });
});
