// src/secrets.test.mjs — `cookwright secrets init|set` (stage-5 plan §4.3): the
// arguments, the value read through readValue and never printed, the refusals
// (exit 125, nothing written), and the age backend for real in a scratch repo:
// init --no-passphrase, set --stdin, then run through the engine with the real
// spawnChild, binary output byte-identical. The real part skips when age or
// age-keygen is not on PATH. Values are synthetic and asserted by length.

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { messages } from './lib/messages.mjs';
import { hasTool, spawnChild } from './lib/probes.mjs';
import { main as runMain } from './run.mjs';
import { main } from './secrets.mjs';
import { commit, gitInit, run, scratchRoot } from './test-helpers.mjs';

const TMP = scratchRoot('cookwright-secrets-');
const m = messages.secrets;
const REF = 'abcdefghijklmnopqrst';
const VALUES = {
  SUPABASE_URL: `https://${REF}.supabase.co`,
  DB_URL: `postgresql://postgres.${REF}:${'p'.repeat(24)}@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`,
  SERVICE_ROLE_KEY: `eyJ${'s'.repeat(60)}`,
};
const NAMES = Object.keys(VALUES);
const CONFIG = {
  version: 4,
  packs: ['supabase'],
  secrets: { backend: 'age', targets: { dev: { names: NAMES, proof: { kind: 'supabase', ref: REF } } } },
};

function sink() {
  const chunks = [];
  const w = new Writable({
    write(chunk, _e, cb) {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  });
  w.bytes = () => Buffer.concat(chunks);
  w.text = () => w.bytes().toString();
  return w;
}

let count = 0;
/** A committed scratch repo with CONFIG and a home beside it: `{ root, home, env }`. */
function repo(config = CONFIG) {
  const base = path.join(TMP, `s${(count += 1)}`);
  const root = gitInit(path.join(base, 'repo'));
  commit({ root }, { 'cookwright.json': JSON.stringify(config) }, 'config');
  const home = path.join(base, 'home');
  fs.mkdirSync(home);
  const env = { PATH: process.env.PATH, HOME: home, COOKWRIGHT_AGE_IDENTITY: path.join(base, 'keys', 'identity.age') };
  return { root, home, env, identity: env.COOKWRIGHT_AGE_IDENTITY };
}

/** `secrets <argv>` in process: `{ code, out, err }`. */
async function secrets(r, argv, { stdin = Readable.from([]), backends, probes } = {}) {
  const stdout = sink();
  const stderr = sink();
  const io = { cwd: r.root, env: r.env, home: r.home, stdin, stdout, stderr, ...(backends && { backends }), ...(probes && { probes }) };
  const code = await main(argv, io);
  return { code, out: stdout.text(), err: stderr.text() };
}

const line = (text) => Readable.from([Buffer.from(`${text}\n`)]);

describe('secrets: arguments', () => {
  it('refuses anything but init with its two switches or set with a target, a name and --stdin, exit 2', async () => {
    const r = repo();
    for (const argv of [[], ['rekey'], ['init', 'x'], ['set', 'dev'], ['set', 'dev', 'A', 'B'], ['init', '--force'], ['init', '--yes', 'no'], ['set', 'dev', 'A', '--stdin=x']]) {
      const { code, err } = await secrets(r, argv);
      expect([argv, code]).toEqual([argv, 2]);
      expect(err).toContain(m.usage);
    }
  });

  it('refuses no secrets key and an unknown target with 125', async () => {
    const none = repo({ version: 4 });
    expect(await secrets(none, ['init', '--yes'])).toMatchObject({ code: 125, err: `secrets: ${m.none}\n` });
    const r = repo();
    expect(await secrets(r, ['set', 'prod', 'DB_URL', '--stdin'])).toMatchObject({
      code: 125,
      err: 'secrets: no target prod in cookwright.json (declared: dev)\n',
    });
  });

  it("names the operation's missing tool", async () => {
    const r = repo();
    const probes = { hasTool: (bin) => bin !== 'age-keygen' };
    expect(await secrets(r, ['init', '--yes'], { probes })).toMatchObject({
      code: 125,
      err: `secrets: ${m.needsTool('age-keygen', m.age.install)}\n`,
    });
  });
});

describe('secrets set: the value', () => {
  /** A fake backend recording what set received, with the value read through ctx.readValue. */
  const fake = (seen) => ({
    age: {
      name: 'age',
      tools: { set: [] },
      install: '',
      control: [],
      async set(target, name, ctx) {
        seen.env = ctx.env;
        seen.value = await ctx.readValue();
        return { keys: [`age1${'q'.repeat(58)}`] };
      },
    },
  });

  it('reads one line with --stdin and prints the name, the target and the recipients, never the value', async () => {
    const r = repo();
    r.env.DB_URL = 'stale';
    const seen = {};
    const { code, out } = await secrets(r, ['set', 'dev', 'DB_URL', '--stdin'], { stdin: line(VALUES.DB_URL), backends: fake(seen) });
    expect(code).toBe(0);
    expect(seen.value.length).toBe(VALUES.DB_URL.length);
    expect(seen.env.DB_URL).toBeUndefined();
    expect(out).toBe(`${m.set('DB_URL', 'dev', 'age')}\nsecrets: encrypted to 1 recipient(s): …qqqqqqqq\n`);
  });

  it('refuses without a terminal and without --stdin, and two lines on stdin', async () => {
    const r = repo();
    expect(await secrets(r, ['set', 'dev', 'DB_URL'], { stdin: line('x'), backends: fake({}) })).toMatchObject({
      code: 125,
      err: `secrets: ${m.prompt.noTerminal}\n`,
    });
    expect(await secrets(r, ['set', 'dev', 'DB_URL', '--stdin'], { stdin: line('a\nb'), backends: fake({}) })).toMatchObject({
      code: 125,
      err: `secrets: ${m.prompt.oneLine}\n`,
    });
  });
});

const HAS_AGE = hasTool('age') && hasTool('age-keygen');

describe.skipIf(!HAS_AGE)('the age backend for real (skipped without age and age-keygen on PATH)', () => {
  /** `run dev -- <argv>` with the real backend and spawnChild, stdin ignored. */
  async function runDev(r, argv) {
    const stdout = sink();
    const stderr = sink();
    const probes = { spawnChild: (c, a, o) => spawnChild(c, a, { ...o, stdio: ['ignore', 'pipe', 'pipe'] }) };
    const code = await runMain(['dev', '--', ...argv], { cwd: r.root, env: r.env, home: r.home, stdout, stderr, probes });
    return { code, stdout, err: stderr.text() };
  }

  it('inits, sets each value from stdin, and runs a proved target through the engine', async () => {
    const r = repo();
    const init = await secrets(r, ['init', '--no-passphrase', '--yes']);
    expect(init.code).toBe(0);
    expect(fs.statSync(r.identity).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(r.identity, 'utf8')).toMatch(/^AGE-SECRET-KEY-1/m);
    expect(init.out).not.toMatch(/AGE-SECRET-KEY/);
    expect(init.out.trim().split('\n').at(-1)).toBe(m.age.commitFirst('secrets/recipients.txt'));
    const refused = await secrets(r, ['set', 'dev', 'DB_URL', '--stdin'], { stdin: line(VALUES.DB_URL) });
    expect(refused).toMatchObject({ code: 125, err: `secrets: ${m.recipients({ why: 'uncommitted' }, 'secrets/recipients.txt')}\n` });
    run(r.root, 'git', ['add', 'secrets/recipients.txt']);
    run(r.root, 'git', ['commit', '-qm', 'recipients']);
    for (const name of NAMES) {
      const { code, out } = await secrets(r, ['set', 'dev', name, '--stdin'], { stdin: line(VALUES[name]) });
      expect([name, code]).toEqual([name, 0]);
      expect(out.split('\n')[0]).toBe(m.set(name, 'dev', 'age'));
    }
    const cipher = fs.readFileSync(path.join(r.root, 'secrets/dev.env.age'), 'utf8');
    expect(cipher.split('\n')[0]).toBe('-----BEGIN AGE ENCRYPTED FILE-----');
    for (const value of Object.values(VALUES)) expect(cipher.includes(value)).toBe(false);
    run(r.root, 'git', ['add', 'secrets/dev.env.age']);
    run(r.root, 'git', ['commit', '-qm', 'ciphertext']);

    const lengths = await runDev(r, [process.execPath, '-e', `console.log(${JSON.stringify(NAMES)}.map((n) => process.env[n].length).join(' '))`]);
    expect(lengths.code).toBe(0);
    expect(lengths.stdout.text()).toBe(`${NAMES.map((n) => VALUES[n].length).join(' ')}\n`);
    expect(lengths.err).toBe(
      `run: dev · injected ${NAMES.join(', ')} · proved SUPABASE_URL, DB_URL against ${REF} (supabase) · unproved SERVICE_ROLE_KEY` +
        ` · dropped from the environment: COOKWRIGHT_AGE_IDENTITY · ${messages.run.piped}\n`,
    );
    const echoed = await runDev(r, [process.execPath, '-e', 'console.log(process.env.DB_URL)']);
    expect(echoed.stdout.text()).toBe('<DB_URL>\n');

    const blob = randomBytes(256 * 1024);
    fs.writeFileSync(path.join(TMP, 'real.bin'), blob);
    const cat = await runDev(r, [process.execPath, '-e', `require('fs').createReadStream(${JSON.stringify(path.join(TMP, 'real.bin'))}).pipe(process.stdout)`]);
    expect(cat.stdout.bytes().equals(blob)).toBe(true);
  });

  it('replaces a value in place, the others kept', async () => {
    const r = repo();
    await secrets(r, ['init', '--no-passphrase', '--yes']);
    run(r.root, 'git', ['add', 'secrets/recipients.txt']);
    run(r.root, 'git', ['commit', '-qm', 'recipients']);
    for (const name of NAMES) await secrets(r, ['set', 'dev', name, '--stdin'], { stdin: line(VALUES[name]) });
    await secrets(r, ['set', 'dev', 'SERVICE_ROLE_KEY', '--stdin'], { stdin: line('replaced-key') });
    const out = await runDev(r, [process.execPath, '-e', `console.log(${JSON.stringify(NAMES)}.map((n) => process.env[n].length).join(' '))`]);
    expect(out.stdout.text()).toBe(`${VALUES.SUPABASE_URL.length} ${VALUES.DB_URL.length} ${'replaced-key'.length}\n`);
  });
});
