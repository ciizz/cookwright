// scripts/bundle.test.mjs
//
// The bundle CLI's decisions, tested without running a bundle: the rig lock, the
// deploy-log parser, the state and its derived phases, the Workflow-args invariant
// (byte-stable across state writes, sensitive to the content it points at), and the
// landing-check verdicts. Git-dependent pieces run against a scratch repository.
//
// Importing scripts/bundle.mjs is safe: `main()` runs only when it is the process
// entry point, and under vitest `process.argv[1]` is the vitest binary.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { checkRetry, nextAction, parseArgv } from './bundle.mjs';
import {
  atlasTripwire,
  bundleChecks,
  ciCheck,
  closeoutCheck,
  qaReviewedCheck,
  gateChecks,
  hookUiRegex,
  phaseChecks,
} from './lib/bundle/check.mjs';
import { fiveNumbers, renderCloseoutDraft } from './lib/bundle/closeout.mjs';
import { planChecks, sqlPreflight } from './lib/bundle/gate.mjs';
import { dirtyPaths, isAncestor, lastCodeCommit } from './lib/bundle/git.mjs';
import { claudeMdSchemas, ledgerSchemas, schemaDisagreements } from './lib/bundle/ledger.mjs';
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
import { derivePhases, initState, saveState, validateSplit } from './lib/bundle/state.mjs';
import {
  RigLockBusyError,
  TOKEN_ENV,
  acquire,
  isStale,
  lockPath,
  probePid,
} from './lib/rig-lock.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-test-'));
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

const run = (cwd, cmd, args) => execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim();

function scratchRepo(name) {
  const dir = path.join(TMP, name);
  fs.mkdirSync(dir, { recursive: true });
  run(dir, 'git', ['init', '-q', '-b', 'main']);
  run(dir, 'git', ['config', 'user.email', 't@example.invalid']);
  run(dir, 'git', ['config', 'user.name', 'test']);
  run(dir, 'git', ['config', 'commit.gpgsign', 'false']);
  return dir;
}

function commit(dir, files, msg) {
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  run(dir, 'git', ['add', '-A']);
  run(dir, 'git', ['commit', '-q', '--no-verify', '-m', msg]);
  return run(dir, 'git', ['rev-parse', 'HEAD']);
}

const SPLIT = {
  slices: [
    { id: 'schema', sql: true, sessions: [{ id: 's1', scope: 'plan §3', checkpoints: ['0230'] }] },
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
    const dir = scratchRepo('lock-wt');
    commit(dir, { 'a.txt': 'a' }, 'init');
    const wt = path.join(TMP, 'lock-wt-linked');
    run(dir, 'git', ['worktree', 'add', '-q', wt, '-b', 'side']);
    expect(fs.realpathSync(path.dirname(lockPath(wt)))).toBe(
      fs.realpathSync(path.join(dir, '.git')),
    );
  });
});

// ── the deploy log and CLAUDE.md ─────────────────────────────────────────────

const LEDGER = [
  '## Next deploy (queued)',
  '| 2026-12-01 | prod | db push → schema at 0999 (queued, not applied) | — | manual |',
  '## Ledger',
  '| Date (local)     | Target   | Action                                   | Commit | Via            |',
  '| ---------------- | -------- | ---------------------------------------- | ------ | -------------- |',
  '| 2026-07-02       | prod+dev | db push → schema at `0117` (by hand)      | —      | manual         |',
  '| 2026-09-29 10:11 | prod     | db push → schema at 0221; fns: —          | abc    | safe-deploy.sh |',
  '| 2026-09-29 16:16 | prod     | db push → schema at 0224; fns: —          | abc    | safe-deploy.sh |',
  '| ~2026-09-23      | prod     | db push → schema at 0219 (late row)       | —      | manual         |',
  '| 2026-09-29 15:57 | dev      | db push → schema at 0224; fns: —          | abc    | safe-deploy.sh |',
  '| 2026-09-29 16:20 | preview  | OTA ios group=x fp=y                      | abc    | ota-publish    |',
].join('\n');

describe('ledger', () => {
  it('takes the latest row per target by date, not file order, and skips the queue', () => {
    const s = ledgerSchemas(LEDGER);
    expect(s.prod.schema).toBe('0224');
    expect(s.dev.schema).toBe('0224');
  });

  it('counts a prod+dev row for both and accepts a backticked number', () => {
    const s = ledgerSchemas(LEDGER.split('\n').slice(0, 6).join('\n'));
    expect(s.prod.schema).toBe('0117');
    expect(s.dev.schema).toBe('0117');
  });

  it('reads an approximate time, and lets file order decide a date-only row', () => {
    const rows = [
      '## Ledger',
      '| 2026-10-01 ~15:05 | prod | db push → schema at 0230 | — | manual |',
      '| 2026-10-01 09:00  | prod | db push → schema at 0229 | — | safe-deploy.sh |',
    ];
    expect(ledgerSchemas(rows.join('\n')).prod.schema).toBe('0230');
    const dateOnly = [...rows, '| 2026-10-01 | prod | db push → schema at 0231 | — | manual |'];
    expect(ledgerSchemas(dateOnly.join('\n')).prod.schema).toBe('0231');
  });

  it('reads the three CLAUDE.md claims and names each disagreement', () => {
    const claude =
      '**Prod** — schema **`0221`** (…) **Dev** — schema **`0224`** (…)\n' +
      'Migrations **`0150`–`0221` are ON PROD**';
    expect(claudeMdSchemas(claude)).toEqual({ prod: '0221', dev: '0224', onProd: '0221' });
    const problems = schemaDisagreements(LEDGER, claude);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/Prod.*0221.*0224/);
  });

  it('reports a missing claim rather than passing it', () => {
    expect(schemaDisagreements(LEDGER, 'nothing here')).toHaveLength(3);
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
      'atlas',
      'operator',
      'qa',
      'closeout',
    ]);
  });

  it('refuses a write over a state another writer changed (compare-and-swap)', () => {
    const dir = scratchRepo('cas');
    commit(dir, { 'plan.md': 'p' }, 'init');
    const state = initState({
      root: dir,
      slug: 'cas',
      planPath: 'plan.md',
      split: SPLIT,
      branch: 'b',
      base: 'x',
      now: 't',
    });
    saveState(dir, state);
    const stale = JSON.parse(JSON.stringify(state));
    saveState(dir, state); // another writer moves the revision on
    expect(() => saveState(dir, stale)).toThrow(/state changed since it was loaded/);
    expect(fs.readdirSync(path.join(dir, 'docs/bundles/cas'))).toEqual(['state.json']);
  });
});

describe('phases and the args invariant', () => {
  let dir;
  let state;
  let base;
  beforeAll(() => {
    dir = scratchRepo('args');
    base = commit(dir, { 'plan.md': 'plan v1', 'ops/PLAYBOOK.md': 'playbook' }, 'init');
    state = initState({
      root: dir,
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

  it('refuses args for a phase that has not started, and non-Workflow phases', () => {
    expect(() => workflowArgs(state, 'plan-review', dir)).toThrow(/start plan-review first/);
    expect(() => workflowArgs(state, 'atlas', dir)).toThrow(/not a Workflow phase/);
  });

  it('freezes the review range at start, from the slice first implement start', () => {
    startPhase(state, 'plan-review', { head: base, now: 't1' });
    finishPhase(state, 'plan-review', { now: 't1', head: base });
    startPhase(state, 'implement:s1', { head: base, now: 't1' });
    finishPhase(state, 'implement:s1', { now: 't2', head: base });
    const tip = commit(dir, { 'a.sql': 'x' }, 'slice work');
    const p = startPhase(state, 'review:schema', { head: tip, now: 't3' });
    expect(p.range).toEqual({ from: base, to: tip });
    commit(dir, { 'b.sql': 'y' }, 'later work');
    expect(workflowArgs(state, 'review:schema', dir).range).toEqual({ from: base, to: tip });
  });

  it('is byte-stable across state writes that carry run ids and timestamps', () => {
    const before = JSON.stringify(workflowArgs(state, 'review:schema', dir));
    finishPhase(state, 'review:schema', { now: 't4', runId: 'wf_1', usage: 900, keepOpen: true });
    startPhase(state, 'review:schema', { head: 'ignored-while-running', now: 't5' });
    const after = JSON.stringify(workflowArgs(state, 'review:schema', dir));
    expect(after).toBe(before);
    expect(after).not.toMatch(/wf_1|t4|t5/);
  });

  it('changes when a file it points at changes, so a cached result cannot go stale', () => {
    const before = workflowArgs(state, 'review:schema', dir).plan.sha;
    fs.writeFileSync(path.join(dir, 'plan.md'), 'plan v2');
    expect(workflowArgs(state, 'review:schema', dir).plan.sha).not.toBe(before);
  });

  it('stores findings with verdict counts and feeds their hash to the fix args', () => {
    const rel = recordFindings(
      dir,
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
    const args = workflowArgs(state, 'fix:schema', dir);
    expect(args.findings[0].path).toBe(rel);
    expect(args.findings[0].sha).toMatch(/^[0-9a-f]{16}$/);
  });

  it('records the commit a finished phase ended on', () => {
    finishPhase(state, 'fix:schema', { now: 't10', head: 'endsha' });
    expect(state.phases.find((p) => p.name === 'fix:schema').endCommit).toBe('endsha');
  });

  it('renders a session report with the strings table for Cesar', () => {
    const md = renderReport('implement:c1', {
      commits: ['abc123'],
      strings: [{ key: 'home.title', en: 'Home', fr: 'Accueil', context: 'tab' }],
    });
    expect(md).toMatch(/\| `home.title` \| Home \| Accueil \| tab \|/);
    expect(md).toMatch(/## Open questions\n- none/);
  });

  it('names the next action, with the resume id once a run has one', () => {
    const phase = state.phases.find((p) => p.name === 'fix:schema');
    phase.status = 'running';
    phase.runs.at(-1).runId = 'wf_9';
    // a FINISHED run is never resumed — its cache would hand back the old result
    expect(nextAction(state, phase)).toMatch(/or a rerun: `phase demo start fix:schema`/);
    delete phase.runs.at(-1).endedAt;
    expect(nextAction(state, phase)).toMatch(/resumeFromRunId: 'wf_9'/);
    expect(nextAction(state, null)).toMatch(/bundle check/);
  });
});

// ── the landing check ────────────────────────────────────────────────────────

describe('check', () => {
  const gate = (commit, extra = {}) => ({
    commit,
    passed: true,
    sql: false,
    slice: null,
    checks: [],
    ...extra,
  });
  const phases = [
    { name: 'fix:schema', endCommit: 'a1' },
    { name: 'fix:client', endCommit: 'b2' },
  ];
  const base = {
    slices: [
      { id: 'schema', sql: true },
      { id: 'client', sql: false },
    ],
    phases,
  };
  // commits in order a1 → b2 → c3; "ancestor" = not later in that order
  const order = ['a1', 'b2', 'c3'];
  const isAncestor = (a, b) => order.indexOf(a) <= order.indexOf(b);
  const verdicts = (state, ctx) =>
    Object.fromEntries(gateChecks(state, { lastSupabase: null, isAncestor, ...ctx }));

  it('passes when every slice gated its end commit and the latest gate is on the last code', () => {
    const state = {
      ...base,
      gates: [
        gate('a1', { slice: 'schema', sql: true }),
        gate('b2', { slice: 'client' }),
        gate('c3'),
      ],
    };
    const rows = verdicts(state, { lastCode: 'c3', lastSupabase: 'a1' });
    expect(Object.values(rows).map((r) => r.status)).toEqual([
      'PASS',
      'PASS',
      'PASS',
      'PASS',
      'PASS',
    ]);
  });

  it('fails a slice gated only BEFORE its fix ended, and a schema slice without --sql', () => {
    const early = verdicts(
      { ...base, gates: [gate('a0', { slice: 'schema', sql: true }), gate('c3')] },
      { lastCode: 'c3' },
    );
    expect(early['bundle.gate-slice:schema'].note).toMatch(/slice end a1/);
    const noSql = verdicts(
      { ...base, gates: [gate('a1', { slice: 'schema' })] },
      { lastCode: 'a1' },
    );
    expect(noSql['bundle.gate-slice:schema'].note).toMatch(/--sql/);
  });

  it('fails a supabase/ change after the last --sql gate, wherever it landed', () => {
    const state = {
      ...base,
      gates: [
        gate('a1', { slice: 'schema', sql: true }),
        gate('b2', { slice: 'client' }),
        gate('c3'),
      ],
    };
    const rows = verdicts(state, { lastCode: 'c3', lastSupabase: 'c3' });
    expect(rows['bundle.gate-sql'].status).toBe('FAIL');
  });

  it('passes a latest gate taken after docs-only commits that follow the last code', () => {
    // b2 is the last code commit; c3 is the phase's state commit the gate ran on.
    const rows = verdicts({ ...base, gates: [gate('c3')] }, { lastCode: 'b2' });
    expect(rows['bundle.gate-latest'].status).toBe('PASS');
    expect(rows['bundle.gate-latest'].note).toMatch(
      /passed on c3, which contains the last code b2/,
    );
    const equal = verdicts({ ...base, gates: [gate('c3')] }, { lastCode: 'c3' });
    expect(equal['bundle.gate-latest'].note).toBe('passed on c3');
  });

  it('fails a stale latest gate and a red latest gate', () => {
    const stale = verdicts({ ...base, gates: [gate('a1')] }, { lastCode: 'c3' });
    expect(stale['bundle.gate-latest'].status).toBe('FAIL');
    const red = verdicts({ ...base, gates: [gate('c3', { passed: false })] }, { lastCode: 'c3' });
    expect(red['bundle.gate-latest'].note).toMatch(/failed/);
  });

  it('allows one retry of the latest failed gate, on the same commit and SQL leg only', () => {
    const state = { gates: [gate('c3', { passed: false, sql: true })] };
    expect(checkRetry(state, 'c3', true)).toBe(0);
    expect(() => checkRetry(state, 'c4', true)).toThrow(/same commit/);
    expect(() => checkRetry(state, 'c3', false)).toThrow(/same commit, same --sql/);
    state.gates.push(gate('c3', { passed: false, sql: true, retryOf: 0 }));
    expect(() => checkRetry(state, 'c3', true)).toThrow(/already retried/);
    expect(() => checkRetry({ gates: [gate('c3')] }, 'c3', false)).toThrow(/needs a failed gate/);
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
  });

  it('fails CI unless the newest ci.yml run for HEAD completed green', () => {
    const gh =
      (runs, status = 0) =>
      () => ({ status, stdout: JSON.stringify(runs) });
    expect(ciCheck('c3', { exec: gh([], 1) }).status).toBe('FAIL');
    expect(ciCheck('c3', { exec: gh([]) }).note).toMatch(/push the branch/);
    const pending = [{ status: 'in_progress', createdAt: '2026-09-29T10:00:00Z' }];
    expect(ciCheck('c3', { exec: gh(pending) }).status).toBe('FAIL');
    const rerun = [
      { status: 'completed', conclusion: 'failure', createdAt: '2026-09-29T10:00:00Z' },
      { status: 'completed', conclusion: 'success', createdAt: '2026-09-29T11:00:00Z' },
    ];
    expect(ciCheck('c3', { exec: gh(rerun) }).status).toBe('PASS');
    let argv = [];
    ciCheck('c3', {
      exec: (cmd, a) => {
        argv = a;
        return { status: 0, stdout: '[]' };
      },
    });
    expect(argv).toContain('ci.yml');
  });

  it('lists phases that are not done', () => {
    const [[, r]] = phaseChecks({
      phases: [
        { name: 'qa', status: 'running' },
        { name: 'atlas', status: 'done' },
      ],
    });
    expect(r.note).toBe('not done: qa');
  });

  it('reads the Rule 5 matcher from the hook and applies it as a tripwire', () => {
    const rx = hookUiRegex(REPO);
    expect(atlasTripwire(['src/components/Button.tsx'], rx).status).toBe('FAIL');
    expect(atlasTripwire(['src/components/Button.test.tsx'], rx).status).toBe('PASS');
    expect(atlasTripwire(['app/x.tsx', 'docs/screenshots/x/fr-dark.png'], rx).note).toMatch(
      /tripwire/,
    );
    expect(atlasTripwire(['scripts/bundle.mjs'], rx).status).toBe('PASS');
  });

  it('finds the last code commit past docs-only commits; the dirty check sees renames', () => {
    const dir = scratchRepo('code-commit');
    const b = commit(dir, { 'a.txt': '1' }, 'base');
    const code = commit(dir, { 'src.js': '1' }, 'code');
    commit(dir, { 'docs/bundles/x/state.json': '{}' }, 'chore(bundle)');
    const tip = commit(dir, { 'docs/screenshots/s/fr.png': 'p' }, 'atlas');
    commit(
      dir,
      { 'docs/phase-closeouts/x.md': 'c', 'CLAUDE.md': 'state', 'ops/PLAYBOOK.md': 'p' },
      'closeout',
    );
    expect(lastCodeCommit(b, run(dir, 'git', ['rev-parse', 'HEAD']), dir)).toBe(code);
    expect(lastCodeCommit(b, tip, dir)).toBe(code);
    fs.writeFileSync(path.join(dir, 'docs/bundles/x/state.json'), '{"a":1}');
    expect(dirtyPaths(dir, { exclude: ['docs/bundles/'] })).toEqual([]);
    run(dir, 'git', ['mv', 'src.js', 'docs/bundles/x/moved.js']);
    expect(dirtyPaths(dir, { exclude: ['docs/bundles/'] })).toEqual(['src.js']);
    fs.writeFileSync(path.join(dir, 'a file é.txt'), 'x');
    expect(dirtyPaths(dir, { exclude: ['docs/bundles/'] })).toContain('a file é.txt');
  });
});

// ── gate and closeout ────────────────────────────────────────────────────────

describe('gate', () => {
  it('runs the CI set, the edge suite only with Deno, and SQL only on --sql', () => {
    const names = planChecks({ sql: false, hasDeno: false }).map((c) =>
      c.skip ? `${c.name}:skip` : c.name,
    );
    expect(names).toEqual(['typecheck', 'lint', 'format', 'vitest', 'changelog', 'edge:skip']);
    const withSql = planChecks({ sql: true, hasDeno: true }).map((c) => c.name);
    expect(withSql.slice(-2)).toEqual(['edge', 'sql']);
  });

  it('refuses the SQL leg on no Docker, a full disk, or an unreadable df — fail closed', () => {
    const df = (stdout, status = 0) => ({ status, stdout });
    const make = (dockerStatus, dfResult) => (cmd) =>
      cmd === 'docker' ? { status: dockerStatus } : dfResult;
    expect(sqlPreflight({ exec: make(1, df('h\n/dev/x 1 1 99999999 1% /')) })).toMatch(/Docker/);
    expect(sqlPreflight({ exec: make(0, df('h\n/dev/x 1 1 1048576 1% /')) })).toMatch(
      /1\.0 GB free/,
    );
    expect(sqlPreflight({ exec: make(0, df('', 1)) })).toMatch(/could not read/);
    expect(sqlPreflight({ exec: make(0, df('garbage')) })).toMatch(/could not read/);
    expect(sqlPreflight({ exec: make(0, df('h\n/dev/x 1 1 99999999 1% /')) })).toBeNull();
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
    expect(parseArgv(['demo', '--sql', '--slice', 'schema', 'x'])).toEqual({
      pos: ['demo', 'x'],
      flags: { sql: true, slice: 'schema' },
    });
  });
});

// ── slice-B contracts: incomplete reviews, terminal phases, QA, the closeout ──

describe('review completeness and phase evidence', () => {
  let dir;
  let state;
  let base;
  beforeAll(() => {
    dir = scratchRepo('terminal');
    base = commit(dir, { 'plan.md': 'p', 'ops/PLAYBOOK.md': 'pb' }, 'init');
    state = initState({
      root: dir,
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
    const result = { issues: [], incomplete: ['the Codex reviewer returned nothing'] };
    expect(() => recordFindings(dir, state, 'plan-review', result, 't')).toThrow(
      /incomplete review: the Codex reviewer returned nothing/,
    );
    recordFindings(dir, state, 'plan-review', result, 't', { acceptIncomplete: 'reran by hand' });
    expect(state.findings.at(-1).acceptedIncomplete).toBe('reran by hand');
  });

  it('will not close plan review with a P1/P2 open, tolerates P3 residue, rechecks on rerun', () => {
    const issue = (severity, verdict = 'plausible') => ({ file: 'plan.md', severity, verdict });
    recordFindings(dir, state, 'plan-review', { issues: [issue('P2'), issue('P3')] }, 't');
    expect(doneBlocker(state, 'plan-review', { head: base })).toMatch(
      /1 P1\/P2 finding\(s\) still open/,
    );
    expect(doneBlocker(state, 'plan-review', { head: base, acceptOpen: 'Cesar' })).toBeNull();
    // the rerun re-judges the open findings only
    expect(workflowArgs(state, 'plan-review', dir).recheck.path).toMatch(/plan-review-2\.json$/);
    recordFindings(dir, state, 'plan-review', { issues: [issue('P3')] }, 't');
    expect(doneBlocker(state, 'plan-review', { head: base })).toBeNull();
    expect(workflowArgs(state, 'plan-review', dir).recheck).toBeUndefined();
  });

  it('records the run id of a run in flight, so a crash resumes it', () => {
    setRunId(state, 'plan-review', { runId: 'wf_live' });
    expect(nextAction(state, state.phases[0])).toMatch(/resumeFromRunId: 'wf_live'/);
    finishPhase(state, 'plan-review', { now: 't', head: base });
  });

  it('closes implement/fix only with a session report and a passing gate on HEAD', () => {
    startPhase(state, 'implement:c1', { head: base, now: 't' });
    expect(doneBlocker(state, 'implement:c1', { head: base })).toMatch(/session report first/);
    state.reports.push({ phase: 'implement:c1', path: 'r' });
    expect(doneBlocker(state, 'implement:c1', { head: base })).toMatch(/no passing gate covers/);
    state.gates.push({ commit: base, passed: true, sql: false, checks: [] });
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
    expect(() => workflowArgs(state, 'closeout', dir)).toThrow(/write docs\/phase-closeouts/);
    fs.mkdirSync(path.join(dir, 'docs/phase-closeouts'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs/phase-closeouts/term.md'), 'v1');
    const v1 = workflowArgs(state, 'closeout', dir);
    expect(v1.stateRevision).toBe(0);
    fs.writeFileSync(path.join(dir, 'docs/phase-closeouts/term.md'), 'v2');
    expect(workflowArgs(state, 'closeout', dir).closeout.sha).not.toBe(v1.closeout.sha);
  });

  it('passes the closeout check only for a verify run against the current text', () => {
    const sha = workflowArgs(state, 'closeout', dir).closeout.sha;
    recordFindings(dir, state, 'closeout', { issues: [], closeoutSha: 'old' }, 't');
    expect(closeoutCheck(dir, state).note).toMatch(/changed after its last verify/);
    recordFindings(dir, state, 'closeout', { issues: [], closeoutSha: sha }, 't');
    expect(closeoutCheck(dir, state).status).toBe('PASS');
  });

  it('points a QA fix run at the latest round, and requires a review of changed code', () => {
    const qa = state.phases.find((p) => p.name === 'qa');
    qa.status = 'running';
    qa.startCommit = 'q0';
    qa.range = { from: 'q0', to: 'HEAD' };
    expect(() => workflowArgs(state, 'qa', dir)).toThrow(/no QA round recorded/);
    recordQa(dir, state, 'round one: the sheet clips', 't');
    recordQa(dir, state, 'round two: the button is off-screen', 't');
    const args = workflowArgs(state, 'qa', dir);
    expect(args.findings[0].path).toBe('docs/bundles/term/qa/round-2.md');
    expect(args.range).toEqual({ from: 'q0', to: 'HEAD' });
    expect(doneBlocker(state, 'qa', { head: 'q0' })).toBeNull(); // no code changed
    state.gates.push({ commit: 'q1', passed: true, sql: false, checks: [] });
    expect(doneBlocker(state, 'qa', { head: 'q1' })).toMatch(/code changed during QA/);
    recordFindings(dir, state, 'qa', { issues: [] }, 't', { head: 'q1' });
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

// ── whole-branch review round: runs, reopen, carry-forward, audits ───────────

describe('runs, reopening and the evidence rules', () => {
  let dir;
  let state;
  let base;
  beforeAll(() => {
    dir = scratchRepo('runs');
    base = commit(dir, { 'plan.md': 'p', 'ops/PLAYBOOK.md': 'pb' }, 'init');
    state = initState({
      root: dir,
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
      dir,
      state,
      'plan-review',
      { issues: [issue('a', 'P1'), issue('b', 'P2')] },
      't',
    );
    recordFindings(
      dir,
      state,
      'plan-review',
      { issues: [{ ...issue('a', 'P1'), verdict: 'rejected' }], recheckOf: first },
      't',
    );
    expect(state.findings.at(-1).openBySeverity).toEqual({ P1: 0, P2: 1, P3: 0 });
    recordFindings(
      dir,
      state,
      'plan-review',
      { issues: [], incomplete: ['dead'], recheckOf: first },
      't',
      {
        acceptIncomplete: 'accepted',
      },
    );
    expect(state.findings.at(-1).openBySeverity).toEqual({ P1: 1, P2: 1, P3: 0 });
  });

  it('refuses a session report that is not the IMPL shape', () => {
    expect(() => recordReport(dir, state, 'plan-review', null, 't')).toThrow(/IMPL shape/);
    expect(() => recordReport(dir, state, 'plan-review', { phase: 'x', results: {} }, 't')).toThrow(
      /IMPL shape/,
    );
  });

  it('lets a gate cover code with docs-only commits after it', () => {
    const order = ['c', 'g', 'd'];
    const contains = (a, b) => order.indexOf(a) <= order.indexOf(b);
    const s = {
      ...state,
      phases: state.phases.map((p) => ({
        ...p,
        status: p.name === 'implement:c1' ? 'running' : p.status,
      })),
      reports: [{ phase: 'implement:c1' }],
      gates: [{ commit: 'g', passed: true, sql: false, checks: [] }],
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

  it('refuses qa with no device round unless the exemption is named', () => {
    expect(doneBlocker(state, 'qa', { head: base })).toMatch(/no device round/);
    expect(doneBlocker(state, 'qa', { head: base, noDevice: 'CLI-only bundle' })).toBeNull();
  });

  it('audits retries: each must name an allowlisted flake', () => {
    const phases = [{ name: 'fix:client', endCommit: 'a' }];
    const g = (extra) => ({ commit: 'a', passed: true, sql: false, checks: [], ...extra });
    const rows = (gates) =>
      Object.fromEntries(
        gateChecks(
          { slices: [{ id: 'client' }], phases, gates },
          { lastCode: 'a', isAncestor: (x, y) => x === y },
        ),
      );
    expect(rows([g({ passed: false }), g({ retryOf: 0 })])['bundle.gate-retries'].status).toBe(
      'FAIL',
    );
    expect(
      rows([g({ passed: false }), g({ retryOf: 0, flake: 'B-102' })])['bundle.gate-retries'].status,
    ).toBe('PASS');
  });

  it('rejects checkpoints that are not a list of strings', () => {
    const bad = { slices: [{ id: 'x', sessions: [{ id: 's', scope: 'a', checkpoints: 'one' }] }] };
    expect(validateSplit(bad).join()).toMatch(/checkpoints must be a list/);
  });
});

// ── the whole loop, end to end — the flow both whole-branch P1s lived in ─────

describe('a client-only bundle, every phase, to a passing landing check', () => {
  it('walks the playbook loop and lands with every row but CI green', () => {
    const dir = scratchRepo('e2e');
    fs.mkdirSync(path.join(dir, '.husky'), { recursive: true });
    fs.copyFileSync(path.join(REPO, '.husky/pre-commit'), path.join(dir, '.husky/pre-commit'));
    commit(dir, { 'src/app.ts': 'v0', 'ops/PLAYBOOK.md': 'pb', 'CLAUDE.md': 'c' }, 'main');
    run(dir, 'git', ['checkout', '-q', '-b', 'feat-e2e']);
    commit(dir, { 'docs/bundles/e2e/plan.md': 'the plan' }, 'chore(bundle): init');
    const base = run(dir, 'git', ['merge-base', 'main', 'HEAD']);
    const contains = (a, b) => isAncestor(a, b, dir);
    const state = initState({
      root: dir,
      slug: 'e2e',
      planPath: 'docs/bundles/e2e/plan.md',
      split: { slices: [{ id: 'client', sessions: [{ id: 'c1', scope: '§1' }] }] },
      branch: 'feat-e2e',
      base,
      now: '2026-10-01T08:00:00Z',
    });
    const tip = () => run(dir, 'git', ['rev-parse', 'HEAD']);
    const gate = () =>
      state.gates.push({ commit: tip(), passed: true, sql: false, slice: null, checks: [] });
    const done = (name, extra = {}) => {
      const ctx = { head: tip(), lastCode: lastCodeCommit(base, tip(), dir), contains, ...extra };
      const phase = state.phases.find((p) => p.name === name);
      ctx.qaLastCode = lastCodeCommit(phase.startCommit, tip(), dir);
      expect(doneBlocker(state, name, ctx)).toBeNull();
      finishPhase(state, name, { now: 't', head: tip(), lastCode: ctx.lastCode });
    };
    const start = (name) => startPhase(state, name, { head: tip(), now: 't', mergeBase: base });
    const clean = { issues: [] };

    start('plan-review');
    recordFindings(dir, state, 'plan-review', clean, 't', { head: tip() });
    done('plan-review');

    start('implement:c1');
    commit(dir, { 'src/app.ts': 'v1' }, 'feat: the change');
    recordReport(dir, state, 'implement:c1', { commits: [tip()], files: ['src/app.ts'] }, 't');
    gate();
    commit(dir, { 'docs/bundles/e2e/sessions/x.md': 'r' }, 'chore(bundle): report'); // docs after the gate
    done('implement:c1');

    for (const name of ['review:client', 'review:whole']) {
      start(name);
      recordFindings(
        dir,
        state,
        name,
        { issues: [{ file: 'src/app.ts', severity: 'P2', verdict: 'confirmed' }] },
        't',
        { head: tip() },
      );
      done(name);
      const fixName = name.replace('review', 'fix');
      start(fixName);
      commit(dir, { 'src/app.ts': `fixed after ${name}` }, `fix: ${name}`);
      recordReport(dir, state, fixName, { commits: [tip()], files: ['src/app.ts'] }, 't');
      gate();
      done(fixName);
    }

    start('atlas');
    commit(dir, { 'docs/screenshots/home/fr-dark.png': 'img' }, 'docs(atlas)');
    done('atlas');
    start('operator');
    commit(dir, { 'docs/deploy-log.md': 'row', 'CLAUDE.md': 'dev line' }, 'docs(deploy-log): dev');
    done('operator');

    start('qa');
    recordQa(dir, state, 'round 1: the button is clipped', 't');
    commit(dir, { 'src/app.ts': 'qa fix' }, 'fix: qa round 1');
    recordReport(dir, state, 'qa', { commits: [tip()], files: ['src/app.ts'] }, 't');
    gate();
    recordFindings(dir, state, 'qa', clean, 't', { head: tip() });
    commit(dir, { 'docs/screenshots/home/fr-dark.png': 'img2' }, 'docs(atlas): recapture');
    done('qa');

    start('closeout');
    commit(
      dir,
      { 'docs/phase-closeouts/e2e.md': 'the closeout', 'CLAUDE.md': 'history line' },
      'docs: closeout',
    );
    const sha = workflowArgs(state, 'closeout', dir).closeout.sha;
    recordFindings(dir, state, 'closeout', { issues: [], closeoutSha: sha }, 't', { head: tip() });
    done('closeout');

    saveState(dir, state);
    commit(dir, {}, 'chore(bundle): state');

    const rows = Object.fromEntries(bundleChecks(dir, state));
    const failing = Object.entries(rows).filter(
      ([n, r]) => n !== 'bundle.ci' && r.status !== 'PASS',
    );
    expect(failing).toEqual([]);
    expect(rows['bundle.ci'].status).toBe('FAIL'); // no gh runs for a scratch repo — as it should
    // ~2.6 s alone, 6–7 s under the parallel runner on a loaded machine: a whole
    // scratch-repo walk of every phase, so it gets more than vitest's 5 s default.
  }, 30_000);
});
