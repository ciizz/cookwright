// src/secrets.test.mjs — `cookwright secrets init|set` (stage-5 plan §4.3): the
// arguments, the value read through readValue and never printed, the refusals
// (exit 125, nothing written), and the age backend for real in a scratch repo:
// init --no-passphrase, set --stdin, then run through the engine with the real
// spawnChild, binary output byte-identical; a second repo enrolled with the same
// identity. The real part skips when age or age-keygen is not on PATH. Values are
// synthetic and asserted by length.

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';

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

  it('names on its own line each name dropped as no longer declared', async () => {
    const r = repo();
    const backends = fake({});
    backends.age.set = async (_t, _n, ctx) => (await ctx.readValue(), { keys: [`age1${'q'.repeat(58)}`], dropped: ['OLD_KEY'] });
    const { code, out } = await secrets(r, ['set', 'dev', 'DB_URL', '--stdin'], { stdin: line(VALUES.DB_URL), backends });
    expect(code).toBe(0);
    expect(out.split('\n').slice(0, 2)).toEqual([m.set('DB_URL', 'dev', 'age'), m.dropped(['OLD_KEY'], 'dev')]);
  });

  it('names the keychain service on its line, the value reaching security on stdin only', async () => {
    const r = repo({ version: 4, secrets: { backend: 'keychain', id: 'app', targets: { dev: { names: ['TOKEN'] } } } });
    const store = new Map();
    const capture = (cmd, args, opts = {}) => {
      if (args[0] === '-i') store.set('item', opts.input);
      const value = /-w "(.*)"\n$/.exec(store.get('item') ?? '')?.[1] ?? '';
      return { status: 0, stdout: '', stderr: `password: "${value}"\n`, args };
    };
    const stdout = sink();
    const io = { cwd: r.root, env: r.env, home: r.home, stdin: line('t0ken-value'), stdout, stderr: sink(), platform: 'darwin', probes: { capture, hasTool: () => true } };
    expect(await main(['set', 'dev', 'TOKEN', '--stdin'], io)).toBe(0);
    expect(stdout.text()).toBe('secrets: set TOKEN for dev (keychain, service cookwright/app/dev)\n');
    expect(store.get('item')).toBe('add-generic-password -U -s "cookwright/app/dev" -a TOKEN -w "t0ken-value"\n');
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

/** A fake terminal stdin that answers `typed` once read. */
function tty(typed) {
  const stdin = new PassThrough();
  stdin.isTTY = true;
  stdin.modes = [];
  stdin.setRawMode = (on) => stdin.modes.push(on);
  const resume = stdin.resume.bind(stdin);
  stdin.resume = () => {
    setImmediate(() => stdin.write(typed));
    stdin.resume = resume;
    return resume();
  };
  return stdin;
}

const PUBLIC = `age1${'z'.repeat(58)}`;
/** A fake age-keygen and age (base64 behind the armor line): no tool needed. */
function fakeCapture(cmd, args, opts = {}) {
  if (cmd === 'age-keygen') return { status: 0, stdout: `# public key: ${PUBLIC}\nAGE-SECRET-KEY-1FAKE\n`, stderr: '' };
  if (args[0] === '-a') {
    fs.writeFileSync(args.at(-1), `-----BEGIN AGE ENCRYPTED FILE-----\n${Buffer.from(opts.input).toString('base64')}\n`);
    return { status: 0, stdout: '', stderr: '' };
  }
  return { status: 1, stdout: '', stderr: 'unexpected' };
}
const fakes = (terminal = false) => ({ capture: fakeCapture, terminal: () => terminal, hasTool: () => true });

describe('secrets init: consent, the recipients rule and the ignore refusal', () => {
  const recipients = (r) => path.join(r.root, 'secrets/recipients.txt');

  it('says what it will write and asks; no writes nothing, yes writes', async () => {
    const r = repo();
    const no = await secrets(r, ['init', '--no-passphrase'], { stdin: tty('n\n'), probes: fakes() });
    expect(no.code).toBe(125);
    expect(no.out.split('\n').slice(0, 3)).toEqual([m.age.willWrite, m.age.willIdentity(r.identity, false), m.age.willRecipients('secrets/recipients.txt', false)]);
    expect(no.err).toBe(`${m.prompt.proceed}secrets: ${m.age.declined}\n`);
    expect(fs.existsSync(r.identity) || fs.existsSync(recipients(r))).toBe(false);
    const yes = await secrets(r, ['init', '--no-passphrase'], { stdin: tty('y\n'), probes: fakes() });
    expect(yes.code).toBe(0);
    expect(fs.readFileSync(recipients(r), 'utf8')).toBe(`${PUBLIC}\n`);
  });

  it('refuses without a terminal to consent on unless --yes, and without one for the passphrase', async () => {
    const r = repo();
    expect(await secrets(r, ['init', '--no-passphrase'], { probes: fakes() })).toMatchObject({ code: 125, err: `secrets: ${m.age.consentTerminal}\n` });
    expect(await secrets(r, ['init', '--yes'], { probes: fakes(false) })).toMatchObject({ code: 125, err: `secrets: ${m.age.passphraseTerminal}\n` });
    expect(fs.existsSync(r.identity)).toBe(false);
  });

  it('says the recipients file already holds a key before it asks', async () => {
    const r = repo();
    const held = `age1${'q'.repeat(58)}`;
    commit({ root: r.root }, { 'secrets/recipients.txt': `${held}\n` }, 'recipients');
    const { code, out } = await secrets(r, ['init', '--no-passphrase'], { stdin: tty('n\n'), probes: fakes() });
    expect(code).toBe(125);
    expect(out.split('\n')[3]).toBe(m.age.held('secrets/recipients.txt', ['qqqqqqqq']));
  });

  it('refuses an ignored secrets path naming the .gitignore line, and a changed recipients file', async () => {
    const r = repo();
    commit({ root: r.root }, { '.gitignore': 'node_modules\nsecrets/*.age\n' }, 'ignore');
    const ignored = await secrets(r, ['init', '--no-passphrase', '--yes'], { probes: fakes() });
    expect(ignored).toMatchObject({ code: 125, err: `secrets: ${m.age.ignored('secrets/dev.env.age', { source: '.gitignore', line: 2, pattern: 'secrets/*.age' })}\n` });
    expect(fs.existsSync(r.identity)).toBe(false);
    const changed = repo();
    commit({ root: changed.root }, { 'secrets/recipients.txt': `age1${'q'.repeat(58)}\n` }, 'recipients');
    fs.appendFileSync(recipients(changed), '# a new teammate\n');
    expect(await secrets(changed, ['init', '--no-passphrase', '--yes'], { probes: fakes() })).toMatchObject({
      code: 125,
      err: `secrets: ${m.recipients({ why: 'differs' }, 'secrets/recipients.txt')}\n`,
    });
  });
});

describe('secrets set: the hidden prompt and the recipients rule', () => {
  it('reads the value typed with echo off, restoring the terminal, and refuses a changed recipients file before asking', async () => {
    const r = repo();
    commit({ root: r.root }, { 'secrets/recipients.txt': `${PUBLIC}\n` }, 'recipients');
    const stdin = tty('typed-value\r');
    const { code, out, err } = await secrets(r, ['set', 'dev', 'SERVICE_ROLE_KEY'], { stdin, probes: fakes() });
    expect(code).toBe(0);
    expect(err).toBe(`${m.prompt.value('SERVICE_ROLE_KEY', 'dev')}\n`);
    expect(stdin.modes).toEqual([true, false]);
    expect(out).toBe(`${m.set('SERVICE_ROLE_KEY', 'dev', 'age')}\nsecrets: encrypted to 1 recipient(s): …zzzzzzzz\n`);
    const body = fs.readFileSync(path.join(r.root, 'secrets/dev.env.age'), 'utf8').split('\n')[1];
    expect(Buffer.from(body, 'base64').toString()).toBe('SERVICE_ROLE_KEY=typed-value\n');
    fs.appendFileSync(path.join(r.root, 'secrets/recipients.txt'), `age1${'q'.repeat(58)}\n`);
    const asked = tty('never\r');
    const refused = await secrets(r, ['set', 'dev', 'DB_URL'], { stdin: asked, probes: fakes() });
    expect(refused).toMatchObject({ code: 125, err: `secrets: ${m.recipients({ why: 'differs' }, 'secrets/recipients.txt')}\n` });
    expect(asked.modes).toEqual([]);
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

  it('enrols a second repo with the same identity, so a value set there runs', async () => {
    const first = repo();
    await secrets(first, ['init', '--no-passphrase', '--yes']);
    const identity = fs.readFileSync(first.identity);
    const second = { ...repo(), env: first.env, identity: first.identity };
    const init = await secrets(second, ['init', '--yes']);
    expect(init.code).toBe(0);
    expect(init.out).not.toMatch(/AGE-SECRET-KEY/);
    expect(fs.readFileSync(first.identity).equals(identity)).toBe(true);
    const key = (r) => fs.readFileSync(path.join(r.root, 'secrets/recipients.txt'), 'utf8');
    expect(key(second)).toBe(key(first));
    run(second.root, 'git', ['add', 'secrets/recipients.txt']);
    run(second.root, 'git', ['commit', '-qm', 'recipients']);
    const again = await secrets(second, ['init', '--yes']);
    expect(again.out.trim().split('\n').at(-1)).toBe(m.age.alreadyHeld('secrets/recipients.txt'));
    for (const name of NAMES) await secrets(second, ['set', 'dev', name, '--stdin'], { stdin: line(VALUES[name]) });
    const out = await runDev(second, [process.execPath, '-e', `console.log(${JSON.stringify(NAMES)}.map((n) => process.env[n].length).join(' '))`]);
    expect(out.stdout.text()).toBe(`${NAMES.map((n) => VALUES[n].length).join(' ')}\n`);
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
