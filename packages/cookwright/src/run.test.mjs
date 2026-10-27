// src/run.test.mjs — `cookwright run` end to end with a fake backend (stage-5 plan
// §4.2, §6 "Engine"): the `--` split, the refusals (exit 125, nothing spawned), the
// two environments, the proof, the argv check, the banner's uncommitted part, the
// redaction of both streams (a prompt shown at once, binary byte-identical, a slow
// consumer, a grandchild holding the pipe), the exit codes and the signals. The
// child is a real `node -e`, through the real spawnChild with stdin ignored. Values
// are synthetic and asserted by length or as their redaction, never printed.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CONFIG_FILE } from './lib/config.mjs';
import { messages } from './lib/messages.mjs';
import { spawnChild } from './lib/probes.mjs';
import { main } from './run.mjs';
import { commit, gitInit, scratchRoot } from './test-helpers.mjs';

const TMP = scratchRoot('cookwright-run-');
const NODE = process.execPath;
const REF = 'abcdefghijklmnopqrst';
const OTHER = 'tsrqponmlkjihgfedcba';
const VALUES = {
  SUPABASE_URL: `https://${REF}.supabase.co`,
  DB_URL: `postgresql://postgres.${REF}:s3cret-pass-word@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`,
  SERVICE_ROLE_KEY: `eyJ${'k'.repeat(40)}`,
};
const NAMES = Object.keys(VALUES);
const PIPED = messages.run.piped;

const CONFIG = {
  version: 4,
  packs: ['supabase'],
  secrets: {
    backend: 'age',
    targets: {
      dev: { names: NAMES, proof: { kind: 'supabase', ref: REF } },
      prod: { names: NAMES, proof: { kind: 'supabase', ref: OTHER } },
      bare: { names: ['API_TOKEN'] },
    },
  },
};

let count = 0;
/** A committed scratch repo with CONFIG (or `config`), its root optionally below the top. */
function repo(config = CONFIG, sub = '') {
  const top = gitInit(path.join(TMP, `r${(count += 1)}`));
  const root = path.join(top, sub);
  const rel = sub ? `${sub}/${CONFIG_FILE}` : CONFIG_FILE;
  commit({ root: top }, { [rel]: JSON.stringify(config) }, 'config');
  return root;
}

/** A Writable recording bytes and when each chunk arrived; `delay` ms per write plays a slow consumer. */
function sink({ delay = 0, highWaterMark } = {}) {
  const chunks = [];
  const w = new Writable({
    highWaterMark,
    write(chunk, _enc, cb) {
      chunks.push({ at: Date.now(), bytes: Buffer.from(chunk) });
      if (delay) setTimeout(cb, delay);
      else cb();
    },
  });
  w.bytes = () => Buffer.concat(chunks.map((c) => c.bytes));
  w.text = () => w.bytes().toString();
  w.chunks = chunks;
  return w;
}

/** A fake backend: `values` resolved, the helper's environment recorded in `seen`. */
function backend(values = VALUES, seen = {}) {
  return {
    name: 'age',
    tools: { resolve: ['node'] },
    install: 'get it',
    control: ['COOKWRIGHT_AGE_IDENTITY', 'OP_SESSION_*'],
    files: (target) => [`secrets/${target}.env.age`],
    resolve(target, ctx) {
      seen.env = ctx.env;
      seen.target = target;
      return new Map(Object.entries(values));
    },
  };
}

const BASE_ENV = { PATH: process.env.PATH, HOME: process.env.HOME ?? '/' };

/** `run <argv>` in process: `{ code, out, err }`, the streams' sinks, stdin ignored. */
async function runIt(cwd, argv, { env = BASE_ENV, values, seen, stdout = sink(), stderr = sink(), probes = {} } = {}) {
  const io = {
    cwd,
    env,
    stdout,
    stderr,
    backends: { age: backend(values, seen) },
    probes: { spawnChild: (cmd, args, opts) => spawnChild(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] }), ...probes },
  };
  const code = await main(argv, io);
  return { code, out: stdout.text(), err: stderr.text(), stdout, stderr };
}

const js = (code) => ['--', NODE, '-e', code];

describe('run: arguments and refusals', () => {
  it('refuses without --, with nothing after it, or without exactly one target, exit 2', async () => {
    const root = repo();
    for (const argv of [['dev'], ['dev', '--'], ['--', 'true'], ['dev', 'prod', '--', 'true'], ['dev', '--x', '--', 'true']]) {
      const { code, err } = await runIt(root, argv);
      expect([argv, code]).toEqual([argv, 2]);
      expect(err).toContain(messages.run.usage);
    }
  });

  it('passes everything after the first -- verbatim, flags and a second -- included', async () => {
    const root = repo();
    // node's own `--` ends its options; the child sees the rest as its arguments
    const argv = ['dev', ...js('console.log(JSON.stringify(process.argv.slice(1)))'), '--', '--flag', '--', '-x'];
    const { code, out } = await runIt(root, argv);
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual(['--flag', '--', '-x']);
  });

  it('refuses a missing config with 2, and an unknown target, no secrets key or a missing tool with 125', async () => {
    const empty = gitInit(path.join(TMP, 'noconfig'));
    expect((await runIt(empty, js('1'))).code).toBe(2);
    const root = repo();
    const unknown = await runIt(root, ['staging', ...js('1')]);
    expect(unknown.code).toBe(125);
    expect(unknown.err).toBe('run: no target staging in cookwright.json (declared: dev, prod, bare)\n');
    const none = await runIt(repo({ version: 4 }), ['dev', ...js('1')]);
    expect([none.code, none.err]).toEqual([125, `run: ${messages.secrets.none}\n`]);
    const noTool = await runIt(root, ['dev', ...js('1')], { probes: { hasTool: () => false } });
    expect([noTool.code, noTool.err]).toEqual([125, 'run: needs node: get it\n']);
  });

  it('refuses a missing or empty declared name before spawning, naming its secrets set line', async () => {
    const root = repo();
    const marker = path.join(root, 'ran');
    const touch = js(`require('fs').writeFileSync(${JSON.stringify(marker)}, '')`);
    for (const values of [{ ...VALUES, SERVICE_ROLE_KEY: undefined }, { ...VALUES, SERVICE_ROLE_KEY: '' }]) {
      const { code, err } = await runIt(root, ['dev', ...touch], { values });
      expect([code, err]).toEqual([125, `run: ${messages.secrets.missingName('SERVICE_ROLE_KEY', 'dev')}\n`]);
    }
    expect(fs.existsSync(marker)).toBe(false);
  });
});

describe('run: proof and banner', () => {
  it('runs a proved target, the banner on stderr naming what was proved and what was not', async () => {
    const root = repo();
    const { code, err, out } = await runIt(root, ['dev', ...js('process.stdout.write("ok")')]);
    expect(code).toBe(0);
    expect(out).toBe('ok');
    expect(err).toBe(
      `run: dev · injected ${NAMES.join(', ')} · proved SUPABASE_URL, DB_URL against ${REF} (supabase) · unproved SERVICE_ROLE_KEY · ${PIPED}\n`,
    );
  });

  it('refuses a target whose proof fails, exit 125, nothing spawned', async () => {
    const root = repo();
    const marker = path.join(root, 'ran');
    const { code, err } = await runIt(root, ['prod', ...js(`require('fs').writeFileSync(${JSON.stringify(marker)}, '')`)]);
    expect(code).toBe(125);
    expect(err).toBe(
      `run: SUPABASE_URL is not proved against ${OTHER} (supabase): expected https://${OTHER}.supabase.co, found ref ${REF}\n`,
    );
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('runs a target without a proof, every name unproved', async () => {
    const root = repo();
    const { code, err } = await runIt(root, ['bare', ...js('1')], { values: { API_TOKEN: 'tok-123456' } });
    expect(code).toBe(0);
    expect(err).toBe(`run: bare · injected API_TOKEN · unproved API_TOKEN · ${PIPED}\n`);
  });

  it('names each file that differs from HEAD, read top-relative from a nested config root', async () => {
    const root = repo(CONFIG, 'app');
    const top = path.dirname(root);
    fs.mkdirSync(path.join(top, 'secrets'));
    fs.writeFileSync(path.join(top, 'secrets/dev.env.age'), 'decoy at the top\n');
    const clean = await runIt(root, ['dev', ...js('1')]);
    expect(clean.err).not.toContain('uncommitted');
    fs.writeFileSync(path.join(root, CONFIG_FILE), `${JSON.stringify(CONFIG, null, 2)}\n`);
    expect((await runIt(root, ['dev', ...js('1')])).err).toContain(' · uncommitted: cookwright.json · ');
    fs.mkdirSync(path.join(root, 'secrets'));
    fs.writeFileSync(path.join(root, 'secrets/dev.env.age'), 'ciphertext\n');
    expect((await runIt(root, ['dev', ...js('1')])).err).toContain(' · uncommitted: cookwright.json, secrets/dev.env.age · ');
    commit({ root: top }, {}, 'all');
    expect((await runIt(root, ['dev', ...js('1')])).err).not.toContain('uncommitted');
  });
});

describe('run: the two environments', () => {
  const env = {
    ...BASE_ENV,
    DB_URL: 'postgresql://postgres.stale:stale-password@prod.example/postgres',
    API_TOKEN: 'another-targets-token',
    SUPABASE_DB_URL: 'postgresql://ambient:ambient-pass@prod.example/db',
    PGHOST: 'prod.example',
    COOKWRIGHT_AGE_IDENTITY: '/somewhere/identity.age',
    OP_SESSION_me: 'session-token',
    COPY_OF_KEY: VALUES.SERVICE_ROLE_KEY,
    KEEP: 'kept',
  };

  it('gives the helper and the child each exactly its environment, and names every dropped name', async () => {
    const root = repo();
    const seen = {};
    const show = 'console.log(JSON.stringify(Object.fromEntries(Object.keys(process.env).sort().map((k) => [k, process.env[k].length]))))';
    const { code, out, err } = await runIt(root, ['dev', ...js(show)], { env, seen });
    expect(code).toBe(0);
    expect(Object.keys(seen.env).sort()).toEqual(['COOKWRIGHT_AGE_IDENTITY', 'COPY_OF_KEY', 'HOME', 'KEEP', 'OP_SESSION_me', 'PATH']);
    const child = JSON.parse(out);
    const expected = ['DB_URL', 'HOME', 'KEEP', 'PATH', 'SERVICE_ROLE_KEY', 'SUPABASE_URL'];
    expect(Object.keys(child).filter((k) => expected.includes(k) || k in env)).toEqual(expected);
    for (const name of NAMES) expect(child[name]).toBe(VALUES[name].length);
    expect(err).toContain(
      ' · dropped from the environment: API_TOKEN, COOKWRIGHT_AGE_IDENTITY, COPY_OF_KEY, DB_URL, OP_SESSION_me, PGHOST, SUPABASE_DB_URL · ',
    );
  });
});

describe('run: the argv check', () => {
  const stale = { ...BASE_ENV, DB_URL: 'postgresql://postgres.stale:stale-password@prod.example/postgres', SUPABASE_ACCESS_TOKEN: 'abc' };
  const tunnel = { ...BASE_ENV, DB_URL: 'postgresql://postgres.prodref:real-prod-pw@localhost:5433/postgres' };

  it("refuses a resolved value, a stale inherited one (a loopback tunnel included) and a URL with a password on the child's command line", async () => {
    const root = repo();
    const cases = [
      [['dev', '--', 'echo', VALUES.SERVICE_ROLE_KEY], {}, messages.run.argValue(2, 'SERVICE_ROLE_KEY')],
      [['dev', '--', 'echo', `x=${encodeURIComponent(VALUES.DB_URL)}`], {}, messages.run.argValue(2, 'DB_URL')],
      [['dev', '--', 'psql', stale.DB_URL], { env: stale }, messages.run.argValue(2, 'DB_URL')],
      [['dev', '--', 'psql', tunnel.DB_URL], { env: tunnel }, messages.run.argValue(2, 'DB_URL')],
      [['dev', '--', 'psql', 'postgres://u:hunter22@db.example.com/x'], {}, messages.run.argUrl(2)],
    ];
    for (const [argv, opts, line] of cases) {
      const { code, err, out } = await runIt(root, argv, opts);
      expect([code, err, out]).toEqual([125, `run: ${line}\n`, '']);
    }
  });

  it('passes a loopback URL with its public password and a short inherited value', async () => {
    const root = repo();
    const local = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
    const { code, out } = await runIt(root, ['dev', ...js('console.log(process.argv.slice(1).join(" "))'), local, 'abc'], {
      env: stale,
    });
    expect(code).toBe(0);
    expect(out).toBe(`${local} abc\n`);
  });
});

describe('run: the redactor on both streams', () => {
  it('redacts stdout and stderr independently and in order', async () => {
    const root = repo();
    const code = [
      'const e = process.env;',
      'process.stdout.write("a " + e.DB_URL + " b\\n");',
      'process.stderr.write("c " + e.SERVICE_ROLE_KEY + " d\\n");',
      'process.stdout.write("pw=" + encodeURIComponent(new URL(e.DB_URL).password) + " " + e.SUPABASE_URL + "\\n");',
    ].join('');
    const { out, err } = await runIt(root, ['dev', ...js(code)]);
    expect(out).toBe('a <DB_URL> b\npw=<DB_URL> <SUPABASE_URL>\n');
    expect(err.split('\n').slice(1)).toEqual(['c <SERVICE_ROLE_KEY> d', '']);
  });

  it('shows a prompt with no newline at once', async () => {
    const root = repo();
    const stdout = sink();
    const started = Date.now();
    const { code } = await runIt(root, ['dev', ...js('process.stdout.write("Password: "); setTimeout(() => {}, 700)')], { stdout });
    expect(code).toBe(0);
    const first = stdout.chunks.find((c) => c.bytes.toString().includes('Password: '));
    expect(first.at - started).toBeLessThan(Date.now() - started - 300);
  });

  it('passes binary output byte-identical, through a slow consumer', async () => {
    const root = repo();
    const file = path.join(TMP, 'blob.bin');
    const blob = Buffer.concat([Buffer.from('PGDMP\u0001\u000e\u0000'), randomBytes(2 * 1024 * 1024), Buffer.from([0xff, 0xfe, 0xc3])]);
    fs.writeFileSync(file, blob);
    const cat = js(`require('fs').createReadStream(${JSON.stringify(file)}).pipe(process.stdout)`);
    const fast = await runIt(root, ['dev', ...cat]);
    expect(fast.stdout.bytes().equals(blob)).toBe(true);
    const slow = await runIt(root, ['dev', ...cat], { stdout: sink({ delay: 1, highWaterMark: 1024 }) });
    expect(slow.code).toBe(0);
    expect(slow.stdout.bytes().equals(blob)).toBe(true);
  });

  it('waits for a grandchild holding the pipe before it returns', async () => {
    const root = repo();
    const grandchild = `setTimeout(() => console.log('late ' + process.env.DB_URL), 800)`;
    const code = `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: ['ignore', 'inherit', 'inherit'], detached: true }).unref()`;
    const started = Date.now();
    const { out } = await runIt(root, ['dev', ...js(code)]);
    expect(out).toBe('late <DB_URL>\n');
    expect(Date.now() - started).toBeGreaterThanOrEqual(700);
  });
});

describe('run: exit codes', () => {
  it("returns the child's status, 128 + n for a signal, and 127 for a command that cannot start", async () => {
    const root = repo();
    expect((await runIt(root, ['dev', ...js('process.exit(3)')])).code).toBe(3);
    expect((await runIt(root, ['dev', ...js("process.kill(process.pid, 'SIGTERM')")])).code).toBe(143);
    const missing = await runIt(root, ['dev', '--', 'no-such-command-cookwright']);
    expect(missing.code).toBe(127);
    expect(missing.err.split('\n').at(-2)).toBe('run: no-such-command-cookwright could not be started (ENOENT)');
  });
});

describe('run: signals', () => {
  const RUN = pathToFileURL(path.join(import.meta.dirname, 'run.mjs')).href;
  const PROBES = pathToFileURL(path.join(import.meta.dirname, 'lib/probes.mjs')).href;

  /** `run dev -- node -e <child>` in its own process with the fake backend; resolves `{ code, err }`. */
  function outer(root, child, send, delay = 0) {
    const script = [
      `import { main } from ${JSON.stringify(RUN)};`,
      `import { spawnChild } from ${JSON.stringify(PROBES)};`,
      `const values = ${JSON.stringify(VALUES)};`,
      "const backend = { name: 'age', tools: { resolve: [] }, install: '', control: [], files: () => [], resolve: () => new Map(Object.entries(values)) };",
      'const probes = { spawnChild: (c, a, o) => spawnChild(c, a, { ...o, stdio: ["ignore", "pipe", "pipe"] }) };',
      `process.exitCode = await main(['dev', '--', process.execPath, '-e', ${JSON.stringify(child)}], { cwd: ${JSON.stringify(root)}, backends: { age: backend }, probes });`,
    ].join('\n');
    return new Promise((resolve) => {
      const p = spawn(NODE, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
      let err = '';
      p.stderr.on('data', (d) => {
        err += d;
        if (err.includes('ready') && send) {
          const signal = send;
          setTimeout(() => p.kill(signal), delay);
          send = null;
        }
      });
      p.on('close', (code, signal) => resolve({ code, signal, err }));
    });
  }

  it('forwards SIGTERM to the child and exits 128 + 15 from its end', async () => {
    const root = repo();
    const { code, err } = await outer(root, "console.error('ready'); setTimeout(() => {}, 10000)", 'SIGTERM');
    expect(code).toBe(143);
    expect(err).toContain('ready');
  });

  it('ends the wait with 128 + 15 on a SIGTERM once the child has exited and a descendant holds its output', async () => {
    const root = repo();
    const child = [
      "const { spawn } = require('node:child_process');",
      "spawn(process.execPath, ['-e', 'setTimeout(() => {}, 4000)'], { stdio: ['ignore', 'inherit', 'inherit'] }).unref();",
      "console.error('ready');",
    ].join(' ');
    const start = Date.now();
    const { code, err } = await outer(root, child, 'SIGTERM', 500);
    expect(code).toBe(143);
    expect(err).toContain('ready');
    expect(Date.now() - start).toBeLessThan(3500);
  });

  it('ignores a SIGINT sent to cookwright alone; the child ends on its own', async () => {
    const root = repo();
    const { code } = await outer(root, "console.error('ready'); setTimeout(() => process.exit(7), 600)", 'SIGINT');
    expect(code).toBe(7);
  });
});
