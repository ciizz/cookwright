// scripts/lib/bundle/gate.mjs — the gate between phases: every local check, its
// result recorded against the commit it ran on.
//
// THE GATE, reconciled with the operating model §7.5: the spec says `npm run
// test:all`, but in this repo `test:all` already includes `test:sql:reset`. So the
// default gate is the CI set (typecheck, lint, format, vitest, changelog) plus the
// edge suite when Deno is installed, and `--sql` adds exactly one SQL reset + run,
// under the rig lock, after a Docker/disk preflight. The SQL suites are not in CI
// (their workflow is manual), which is why a schema slice gates with `--sql`.
//
// NO RETRY MECHANISM. A gate that fails is recorded failed. The playbook's flake
// policy lets the orchestrator re-gate once for a backlog-named flake; the re-gate
// is a second event marked `retryOf`, and the red one stays in the state.

import { spawnSync } from 'node:child_process';

import { TOKEN_ENV, acquire, lockPath } from '../rig-lock.mjs';

const MIN_FREE_GB = 10;

/**
 * The flakes a `--retry` may name — the playbook's flake policy, as data. Each is a
 * backlog item with a known, deterministic fix; the list shrinks as they land.
 */
export const KNOWN_FLAKES = {
  'B-102': 'ota-publish.check.test.mjs — vitest 5 s default timeout under the parallel runner',
  'B-130': 'access_mode_flip.test.mjs — a fixed pg_sleep hold and a global lock count under load',
};

export const BASE_CHECKS = [
  { name: 'typecheck', cmd: 'npm', args: ['run', 'typecheck'] },
  { name: 'lint', cmd: 'npm', args: ['run', 'lint'] },
  { name: 'format', cmd: 'npm', args: ['run', 'format:check'] },
  { name: 'vitest', cmd: 'npm', args: ['test'] },
  { name: 'changelog', cmd: 'npm', args: ['run', 'changelog:check'] },
];
const EDGE = { name: 'edge', cmd: 'npm', args: ['run', 'test:edge'] };
const SQL = { name: 'sql', cmd: 'npm', args: ['run', 'test:sql:reset'] };

const onPath = (bin) => spawnSync('which', [bin], { encoding: 'utf8' }).status === 0;

/** Docker answering and enough free disk — the two causes of the 2026-09 stalls. */
export function sqlPreflight({ exec = spawnSync, cwd = process.cwd() } = {}) {
  const docker = exec('docker', ['info', '--format', '{{.ServerVersion}}'], {
    encoding: 'utf8',
    timeout: 20_000,
  });
  if (docker.status !== 0) return 'Docker is not answering (`docker info` failed)';
  // Fail CLOSED: a df that fails or prints something unparsable is a refusal, not
  // a pass — the reset that follows is destructive.
  const df = exec('df', ['-Pk', cwd], { encoding: 'utf8' });
  const freeKb = Number(df.stdout?.trim().split('\n').at(-1)?.split(/\s+/)[3]);
  if (df.status !== 0 || !Number.isFinite(freeKb)) return 'could not read free disk space (`df`)';
  if (freeKb < MIN_FREE_GB * 1024 * 1024) {
    return `only ${(freeKb / 1024 / 1024).toFixed(1)} GB free (need ${MIN_FREE_GB})`;
  }
  return null;
}

/** The checks this gate runs, in order. */
export function planChecks({ sql, hasDeno = onPath('deno') }) {
  const checks = [...BASE_CHECKS];
  checks.push(hasDeno ? EDGE : { ...EDGE, skip: 'deno not on PATH' });
  if (sql) checks.push(SQL);
  return checks;
}

function runCheck(check, { cwd, env }) {
  if (check.skip) return { name: check.name, result: 'skipped', note: check.skip, ms: 0 };
  const t0 = Date.now();
  const r = spawnSync(check.cmd, check.args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 30 * 60_000,
  });
  const ms = Date.now() - t0;
  // stdout and stderr tailed SEPARATELY: `supabase db reset` fills stderr, and a
  // joined tail would push the failed-assertion list (stdout) out of view.
  const last = (text, n) => (text ?? '').trim().split('\n').slice(-n).join('\n');
  const tail = `${last(r.stdout, 30)}\n── stderr ──\n${last(r.stderr, 10)}`;
  return { name: check.name, result: r.status === 0 ? 'pass' : 'fail', ms, tail };
}

/**
 * Run the gate. Every check runs even after a failure, so one gate shows every red
 * at once. Returns the event to append to `state.gates` (the `tail` of a failing
 * check is printed by the caller and not stored).
 */
export function runGate({ cwd, sql, log = console.log }) {
  const checks = planChecks({ sql });
  let lock = null;
  const env = {};
  if (sql) {
    const why = sqlPreflight({ cwd });
    if (why) return { refused: why };
    lock = acquire('bundle gate --sql', { file: lockPath(cwd) });
    env[TOKEN_ENV] = lock.nonce;
  }
  try {
    const results = [];
    for (const check of checks) {
      log(`  … ${check.name}`);
      const r = runCheck(check, { cwd, env });
      log(`  ${r.result.toUpperCase().padEnd(7)} ${check.name}${r.note ? ` (${r.note})` : ''}`);
      results.push(r);
    }
    return { results };
  } finally {
    lock?.release();
  }
}

export const gatePassed = (results) => results.every((r) => r.result !== 'fail');
